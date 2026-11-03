import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { load } from 'cheerio';
import { errors } from 'playwright';
import { LoginError, classifyLoginError, loginOutcome } from '../src/login.js';
import { safeError } from '../src/config.js';
import { Moodle } from '../src/moodle.js';

const secret = 'PRIVATE_PASSWORD_COOKIE_TICKET';
function outcome(html, { origin = 'https://cas.finki.ukim.mk', submitted = true, session = false, readyState = 'complete' } = {}) {
  const $ = load(html);
  const elements = selector => $(selector).toArray().map(el => ({
    textContent: $(el).text(), hidden: $(el).is('[hidden]'),
    getClientRects: () => $(el).is('[hidden]') ? [] : [{}],
  }));
  return vm.runInNewContext(`(${loginOutcome.toString()})({ submitted: ${submitted} })`, {
    location: { origin }, M: session ? { cfg: { sesskey: secret } } : {},
    document: { readyState, querySelector: selector => elements(selector)[0], querySelectorAll: elements },
    getComputedStyle: () => ({ visibility: 'visible' }),
  });
}

test('explicit CAS rejection, unknown alerts, and hidden alerts are distinguished', () => {
  assert.equal(outcome('<div id="msg" class="errors">The credentials you provided cannot be determined to be authentic.</div>'), 'LOGIN_REJECTED');
  assert.equal(outcome('<div role="alert">Invalid username or password</div>'), 'LOGIN_REJECTED');
  assert.equal(outcome(`<div class="errors">Service unavailable ${secret}</div>`), 'LOGIN_CAS_ERROR');
  assert.equal(outcome('<div class="errors" hidden>Invalid credentials</div>'), false);
  assert.equal(outcome('<div class="errors">Invalid credentials</div>', { submitted: false }), false);
  assert.equal(outcome('<p>Please enter your username and password</p>'), false);
});

test('extra authentication steps are detected without copying page data', () => {
  for (const html of ['<input name="otp">', '<input autocomplete="one-time-code">', '<div class="g-recaptcha"></div>']) {
    assert.equal(outcome(html), 'LOGIN_CHALLENGE');
  }
  assert.equal(outcome('<input name="otp" hidden>'), false);
});

test('Moodle session recognition waits until the document finishes loading', () => {
  const origin = 'https://courses.finki.ukim.mk';
  assert.equal(outcome('<a href="/login/logout.php">Logout</a>', { origin, session: true }), 'authenticated');
  assert.equal(outcome('', { origin }), 'LOGIN_NO_SESSION');
  assert.equal(outcome('', { origin, readyState: 'loading' }), false);
  assert.equal(outcome('<div class="errors">Invalid credentials</div>', { origin: 'https://evil.example' }), false);
});

test('timeout, network, HTTP, browser, and unknown failures have safe distinct codes', () => {
  const cases = [
    [new errors.TimeoutError(secret), {}, 'LOGIN_TIMEOUT'],
    [new Error(`net::ERR_NAME_NOT_RESOLVED ${secret}`), {}, 'LOGIN_NETWORK'],
    [new errors.TimeoutError(secret), { networkFailure: true }, 'LOGIN_NETWORK'],
    [new errors.TimeoutError(secret), { httpFailure: true }, 'LOGIN_SERVICE'],
    [new Error(`Executable doesn't exist at ${secret}`), { stage: 'browser' }, 'LOGIN_BROWSER_MISSING'],
    [new Error(secret), { stage: 'browser' }, 'LOGIN_BROWSER_FAILED'],
    [new Error(secret), {}, 'LOGIN_FAILED'],
  ];
  for (const [error, context, expected] of cases) {
    const failure = classifyLoginError(error, context);
    assert.equal(failure.code, expected);
    assert.ok(safeError(failure).startsWith(`[${expected}]`));
    assert.ok(!safeError(failure).includes(secret));
    assert.equal(failure.cause, undefined);
  }
  assert.equal(new LoginError(secret).code, 'LOGIN_FAILED');
});

function mockLogin({ result = 'authenticated', gotoError, submitError, waitError, launchError,
  action = 'https://cas.finki.ukim.mk/cas/login', count = 1, httpStatus, failedNavigation = false, cleanupError = false,
  initialOutcome = false } = {}) {
  const calls = { launch: 0, submit: 0, close: 0, fill: 0, wait: 0 };
  const listeners = new Map();
  const request = { isNavigationRequest: () => true, frame: () => page,
    url: () => `https://cas.finki.ukim.mk/cas/login?ticket=${secret}` };
  const page = {
    on: (event, listener) => listeners.set(event, listener),
    off: event => listeners.delete(event),
    mainFrame: () => page,
    setDefaultTimeout() {},
    goto: async () => {
      if (httpStatus) listeners.get('response')({ request: () => request, status: () => httpStatus });
      if (failedNavigation) listeners.get('requestfailed')(request);
      if (gotoError) throw gotoError;
    },
    url: () => 'https://cas.finki.ukim.mk/cas/login',
    evaluate: async () => initialOutcome,
    locator: () => ({
      count: async () => count, evaluate: async () => action,
      fill: async () => { calls.fill++; },
      press: async () => { calls.submit++; if (submitError) throw submitError; },
    }),
    waitForFunction: async () => {
      calls.wait++;
      if (waitError) throw waitError;
      return { jsonValue: async () => result, dispose: async () => {} };
    },
  };
  const browser = {
    newContext: async () => ({ route: async () => {}, newPage: async () => page }),
    close: async () => { calls.close++; if (cleanupError) throw new Error(secret); },
  };
  const moodle = new Moodle({ username: 'fixture-user', password: secret }, {
    launchBrowser: async () => { calls.launch++; if (launchError) throw launchError; return browser; },
  });
  moodle.isAuthenticated = async () => false;
  return { moodle, calls, listeners, page };
}

test('CAS failure outcomes close the browser and never resubmit credentials', async () => {
  for (const result of ['LOGIN_REJECTED', 'LOGIN_CHALLENGE', 'LOGIN_CAS_ERROR', 'LOGIN_NO_SESSION']) {
    const { moodle, calls, listeners } = mockLogin({ result });
    await assert.rejects(moodle.login(), error => error.code === result && !error.message.includes(secret));
    assert.equal(calls.submit, 1);
    assert.equal(calls.close, 1);
    assert.equal(moodle.page, undefined);
    assert.equal(listeners.size, 0);
  }
});

test('network and HTTP login failures are not mislabeled as credential rejection', async () => {
  for (const [options, expected] of [
    [{ gotoError: new Error(`net::ERR_CONNECTION_REFUSED ${secret}`) }, 'LOGIN_NETWORK'],
    [{ failedNavigation: true, waitError: new errors.TimeoutError(secret) }, 'LOGIN_NETWORK'],
    [{ httpStatus: 503 }, 'LOGIN_SERVICE'],
    [{ waitError: new errors.TimeoutError(secret) }, 'LOGIN_TIMEOUT'],
    [{ submitError: new Error(secret), cleanupError: true }, 'LOGIN_FAILED'],
  ]) {
    const { moodle, calls } = mockLogin(options);
    await assert.rejects(moodle.login(), error => error.code === expected && !error.message.includes(secret));
    assert.equal(calls.close, 1);
    assert.ok(calls.submit <= 1);
  }
});

test('missing browser and changed form are actionable and do not submit credentials', async () => {
  for (const [options, expected] of [
    [{ launchError: new Error(`Executable doesn't exist at ${secret}`) }, 'LOGIN_BROWSER_MISSING'],
    [{ action: 'https://evil.example/cas/login' }, 'LOGIN_FORM_CHANGED'],
    [{ count: 0 }, 'LOGIN_FORM_CHANGED'],
    [{ initialOutcome: 'LOGIN_CHALLENGE' }, 'LOGIN_CHALLENGE'],
  ]) {
    const { moodle, calls } = mockLogin(options);
    await assert.rejects(moodle.login(), error => error.code === expected);
    assert.equal(calls.submit, 0);
    assert.equal(calls.fill, 0);
  }
});

test('successful session is kept and reused without a second browser or submission', async () => {
  const { moodle, calls, listeners, page } = mockLogin();
  await moodle.login();
  assert.equal(moodle.page, page);
  assert.equal(calls.close, 0);
  assert.equal(listeners.size, 0);
  moodle.isAuthenticated = async () => true;
  await moodle.login();
  assert.equal(calls.launch, 1);
  assert.equal(calls.submit, 1);
  await moodle.close();
});
