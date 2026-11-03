import { chromium } from 'playwright';
import { UserError, isCasLogin } from './config.js';
import { normalizeCourses, parseCourse } from './content.js';

const MOODLE = 'https://courses.finki.ukim.mk';
const CAS = 'https://cas.finki.ukim.mk';

export class Moodle {
  constructor(config) {
    this.config = config;
    this.queue = Promise.resolve();
  }

  // Serialize operations because all tools share one authenticated page.
  run(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  async close() {
    await this.browser?.close();
    this.browser = this.page = undefined;
  }

  async login() {
    if (this.page && await this.isAuthenticated()) return;
    const { username, password } = this.config;
    if (!username || !password) throw new UserError('Fill MOODLE_USERNAME and MOODLE_PASSWORD in the local .env file first.');
    await this.close();
    this.browser = await chromium.launch({ headless: true });
    const context = await this.browser.newContext();
    // No third-party requests, traces, videos, screenshots, or persisted cookies.
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if ([MOODLE, CAS].includes(url.origin)) await route.continue();
      else await route.abort();
    });
    this.page = await context.newPage();
    this.page.setDefaultTimeout(20000);
    try {
      await this.page.goto(`${MOODLE}/login/index.php`, { waitUntil: 'domcontentloaded' });
      if (await this.isAuthenticated()) return;
      if (!isCasLogin(this.page.url())) {
        throw new UserError('The faculty login flow changed. Credentials were not submitted.');
      }
      // Validate the form destination before entering credentials.
      const user = this.page.locator('input[name="username"]');
      const pass = this.page.locator('input[name="password"]');
      const action = await user.evaluate(el => el.form?.action);
      if (!isCasLogin(action)) {
        throw new UserError('Unrecognized faculty login form. Credentials were not submitted.');
      }
      await user.fill(username);
      await pass.fill(password);
      await Promise.all([
        this.page.waitForURL(url => url.origin === MOODLE, { timeout: 30000 }),
        pass.press('Enter'),
      ]);
      await this.page.waitForLoadState('domcontentloaded');
      if (!await this.isAuthenticated()) throw new UserError('Login did not establish a Moodle session. Check credentials; additional sign-in steps may be required.');
    } catch (error) {
      await this.close();
      if (error instanceof UserError) throw error;
      throw new UserError('Faculty login could not finish. Check connectivity and credentials. CAPTCHA or MFA requires a separate supported login flow.');
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
    await this.page.goto(`${MOODLE}/course/view.php?id=${id}`, { waitUntil: 'domcontentloaded' });
    if (!await this.isAuthenticated()) throw new UserError('Moodle session expired. Restart the server to sign in again.');
    const course = parseCourse(await this.page.content(), id, MOODLE);
    if (!course.sections.length) throw new UserError('No sections found. This course layout may need an additional parser.');
    return { ...course, scope: 'Sections rendered on the main course page; separate section pages and linked files are not fetched.' };
  }
}
