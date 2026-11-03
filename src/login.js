import { errors } from 'playwright';
import { UserError } from './config.js';

const messages = {
  LOGIN_TIMEOUT: 'Faculty sign-in timed out. The service may be slow; try again later. This does not mean your credentials are wrong.',
  LOGIN_NETWORK: 'Could not reach the faculty sign-in service. Check your connection, DNS, or VPN and try again.',
  LOGIN_SERVICE: 'The faculty sign-in service returned an HTTP error. Try again later or check the faculty website.',
  LOGIN_REJECTED: 'Faculty CAS explicitly rejected the sign-in. Check your credentials locally or sign in on the faculty website. Do not repeatedly retry.',
  LOGIN_CHALLENGE: 'Faculty sign-in requires an additional step such as MFA or CAPTCHA. Check the faculty website; this server cannot complete that step.',
  LOGIN_FORM_CHANGED: 'The faculty login page or form changed. Credentials were not submitted. The login adapter needs review.',
  LOGIN_CAS_ERROR: 'Faculty CAS displayed a sign-in error without a recognized credential rejection. Check the faculty website; credentials may still be correct.',
  LOGIN_NO_SESSION: 'Sign-in returned to Moodle without an authenticated session. Check the faculty website; credentials may still be correct.',
  LOGIN_BROWSER_MISSING: 'The login browser is not installed. Run npm run browser:install in the courses-mcp directory, then restart the MCP server.',
  LOGIN_BROWSER_FAILED: 'The login browser could not start. Run npm run browser:install and check that this computer can launch Chromium.',
  LOGIN_FAILED: 'Faculty sign-in could not finish for an unrecognized reason. Run npm run doctor locally or check the faculty website. Credentials may still be correct.',
};

export class LoginError extends UserError {
  constructor(code) {
    const known = Object.hasOwn(messages, code) ? code : 'LOGIN_FAILED';
    super(`[${known}] ${messages[known]}`);
    this.code = known;
  }
}

export function classifyLoginError(error, { stage, networkFailure, httpFailure } = {}) {
  if (error instanceof UserError) return error;
  // Inspect raw diagnostics only in memory; never return them or attach a cause.
  const message = typeof error?.message === 'string' ? error.message : '';
  if (networkFailure || /net::ERR_[A-Z_]+/.test(message)) return new LoginError('LOGIN_NETWORK');
  if (httpFailure) return new LoginError('LOGIN_SERVICE');
  if (error instanceof errors.TimeoutError) return new LoginError('LOGIN_TIMEOUT');
  if (stage === 'browser') return new LoginError(/Executable doesn't exist/.test(message) ? 'LOGIN_BROWSER_MISSING' : 'LOGIN_BROWSER_FAILED');
  return new LoginError('LOGIN_FAILED');
}

// Runs inside the browser via evaluate/waitForFunction. Return only a fixed code,
// never page text, URLs, form fields, or cookies. Keep self-contained for serialization.
export function loginOutcome({ submitted = false } = {}) {
  if (location.origin === 'https://courses.finki.ukim.mk') {
    if (globalThis.M?.cfg?.sesskey && document.querySelector('a[href*="/login/logout.php"]') &&
        !document.querySelector('.usermenu .login')) return 'authenticated';
    return submitted && document.readyState === 'complete' ? 'LOGIN_NO_SESSION' : false;
  }
  if (location.origin !== 'https://cas.finki.ukim.mk') return false;
  const visible = selector => [...document.querySelectorAll(selector)].filter(el =>
    el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (visible('input[name="otp"], input[name="token"], input[autocomplete="one-time-code"], input[name*="captcha" i], .g-recaptcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"]').length) {
    return 'LOGIN_CHALLENGE';
  }
  if (!submitted) return false;
  const alerts = visible('#msg.errors, .errors, .alert-danger, [role="alert"]')
    .map(el => el.textContent || '').join(' ');
  if (/credentials.{0,80}(cannot be determined to be authentic|invalid|incorrect|rejected)|invalid (username|password|credentials)|incorrect (username|password|credentials)|authentication (failed|failure)|bad credentials/i.test(alerts)) {
    return 'LOGIN_REJECTED';
  }
  return alerts.trim() ? 'LOGIN_CAS_ERROR' : false;
}
