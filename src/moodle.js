import { chromium } from 'playwright';
import { UserError, isCasLogin } from './config.js';
import { normalizeCourses } from './content.js';
import { collectCourseSections, readCoursePage } from './sections.js';
import { LoginError, classifyLoginError, loginOutcome } from './login.js';

const MOODLE = 'https://courses.finki.ukim.mk';
const CAS = 'https://cas.finki.ukim.mk';

export class Moodle {
  constructor(config, { launchBrowser = () => chromium.launch({ headless: true }) } = {}) {
    this.config = config;
    this.launchBrowser = launchBrowser;
    this.queue = Promise.resolve();
  }

  // Serialize operations because all tools share one authenticated page.
  run(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  async close() {
    const browser = this.browser;
    this.browser = this.page = undefined;
    await browser?.close();
  }

  async login() {
    const { username, password } = this.config;
    if (!username || !password) throw new UserError('Fill MOODLE_USERNAME and MOODLE_PASSWORD in the local .env file first.');
    let stage = 'session';
    let networkFailure = false;
    let httpFailure = false;
    let observedPage;
    const mainNavigation = request => request.isNavigationRequest() && request.frame() === observedPage.mainFrame() &&
      [MOODLE, CAS].includes(new URL(request.url()).origin);
    const onFailed = request => { if (mainNavigation(request)) networkFailure = true; };
    const onResponse = response => { if (mainNavigation(response.request()) && response.status() >= 400) httpFailure = true; };
    try {
      if (this.page && await this.isAuthenticated()) return;
      await this.close();
      stage = 'browser';
      this.browser = await this.launchBrowser();
      const context = await this.browser.newContext();
      // No third-party requests, traces, videos, screenshots, or persisted cookies.
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if ([MOODLE, CAS].includes(url.origin)) await route.continue();
        else await route.abort();
      });
      this.page = await context.newPage();
      this.page.setDefaultTimeout(20000);
      observedPage = this.page;
      observedPage.on('requestfailed', onFailed);
      observedPage.on('response', onResponse);
      stage = 'navigation';
      await this.page.goto(`${MOODLE}/login/index.php`, { waitUntil: 'domcontentloaded' });
      if (httpFailure) throw new LoginError('LOGIN_SERVICE');
      if (await this.isAuthenticated()) return;
      const initialOutcome = await this.page.evaluate(loginOutcome, { submitted: false });
      if (initialOutcome === 'authenticated') return;
      if (initialOutcome) throw new LoginError(initialOutcome);
      if (!isCasLogin(this.page.url())) {
        throw new LoginError('LOGIN_FORM_CHANGED');
      }
      // Validate the form destination before entering credentials.
      const user = this.page.locator('input[name="username"]');
      const pass = this.page.locator('input[name="password"]');
      if (await user.count() !== 1 || await pass.count() !== 1) throw new LoginError('LOGIN_FORM_CHANGED');
      const action = await user.evaluate(el => el.form?.action);
      if (!isCasLogin(action)) {
        throw new LoginError('LOGIN_FORM_CHANGED');
      }
      await user.fill(username);
      await pass.fill(password);
      stage = 'submit';
      await pass.press('Enter');
      const handle = await this.page.waitForFunction(loginOutcome, { submitted: true }, { timeout: 30000 });
      const outcome = await handle.jsonValue();
      await handle.dispose();
      if (httpFailure) throw new LoginError('LOGIN_SERVICE');
      if (outcome !== 'authenticated') throw new LoginError(outcome);
    } catch (error) {
      const failure = classifyLoginError(error, { stage, networkFailure, httpFailure });
      // Cleanup errors must never replace the useful failure or leak raw details.
      await this.close().catch(() => {});
      throw failure;
    } finally {
      observedPage?.off('requestfailed', onFailed);
      observedPage?.off('response', onResponse);
    }
  }

  async isAuthenticated() {
    return this.page && new URL(this.page.url()).origin === MOODLE &&
      await this.page.evaluate(() => Boolean(globalThis.M?.cfg?.sesskey &&
        document.querySelector('a[href*="/login/logout.php"]') && !document.querySelector('.usermenu .login')));
  }

  async ajax(methodname, args) {
    const result = await this.page.evaluate(async ({ methodname, args }) => {
      const response = await fetch(`/lib/ajax/service.php?sesskey=${encodeURIComponent(M.cfg.sesskey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ index: 0, methodname, args }]),
      });
      if (!response.ok) return { failed: true };
      const data = await response.json();
      return data[0]?.error ? { failed: true } : { data: data[0]?.data };
    }, { methodname, args });
    if (result.failed || !result.data) throw new UserError('The read-only Moodle course API is unavailable or this session expired. Restart the server to sign in again.');
    return result.data;
  }

  async listCourses() {
    await this.login();
    await this.page.goto(`${MOODLE}/my/courses.php`, { waitUntil: 'domcontentloaded' });
    if (!await this.isAuthenticated()) throw new UserError('Moodle session expired. Restart the server to sign in again.');
    const courses = [];
    let offset = 0;
    // Standard Moodle dashboard AJAX API; fetch every page with a safety cap.
    for (let page = 0; page < 100; page++) {
      const data = await this.ajax('core_course_get_enrolled_courses_by_timeline_classification', {
        classification: 'all', limit: 100, offset, sort: 'fullname', customfieldname: '', customfieldvalue: '',
      });
      if (!Array.isArray(data.courses)) throw new UserError('Moodle returned an unsupported course response.');
      courses.push(...data.courses);
      const next = Number(data.nextoffset);
      if (!data.courses.length || !Number.isFinite(next) || next <= offset) {
        return { courses: normalizeCourses(courses, MOODLE), truncated: false };
      }
      offset = next;
    }
    return { courses: normalizeCourses(courses, MOODLE), truncated: true };
  }

  async getCourse(id) {
    // Only enrolled courses are exposed, even if a caller knows another ID.
    const { courses } = await this.listCourses();
    if (!courses.some(course => course.id === id)) throw new UserError('Course is not in your enrolled course list.');
    return collectCourseSections({ courseId: id, baseUrl: MOODLE,
      readPage: (url, timeout) => readCoursePage(this.page.context().request, url, id, MOODLE, timeout) });
  }
}
