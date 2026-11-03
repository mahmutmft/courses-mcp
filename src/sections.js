import { load } from 'cheerio';
import { errors } from 'playwright';
import { coursePageUrl, parseCourse } from './content.js';
import { UserError } from './config.js';

export const traversalLimits = Object.freeze({ pages: 20, milliseconds: 30000, sections: 200, resources: 1000, htmlBytes: 4 * 1024 * 1024 });
export class CoursePageError extends UserError {
  constructor(code) { super(`Course page unavailable (${code}).`); this.code = code; }
}

export function inspectCoursePage(html, courseId, baseUrl) {
  const $ = load(html);
  // Moodle's top-level body course class is not a link supplied in course content.
  const bodyCourses = ($('body').attr('class') || '').split(/\s+/).filter(value => /^course-\d+$/.test(value));
  if (bodyCourses.length !== 1 || bodyCourses[0] !== `course-${courseId}`) throw new CoursePageError('COURSE_OWNERSHIP_UNVERIFIED');
  if ($('#notice, .errorcode, .alert-danger').length) throw new CoursePageError('PAGE_ACCESS_UNAVAILABLE');
  const links = new Set();
  const root = $('#region-main').length ? $('#region-main') : $('body');
  root.find('a[href]').each((_, anchor) => {
    const url = coursePageUrl($(anchor).attr('href'), courseId, baseUrl);
    if (url && url !== `${baseUrl}/course/view.php?id=${courseId}`) links.add(url);
  });
  const course = parseCourse(root.html() || '', courseId, baseUrl);
  // H1 may live outside region-main in the faculty theme.
  course.name = $('h1').first().text().replace(/\s+/g, ' ').trim();
  return { course, links: [...links] };
}

export async function readCoursePage(request, value, courseId, baseUrl, timeout, htmlBytes = traversalLimits.htmlBytes) {
  let url = coursePageUrl(value, courseId, baseUrl);
  if (!url) throw new CoursePageError('UNSAFE_SECTION_LINK');
  const deadline = Date.now() + timeout;
  // Validate every redirect before issuing another request; never follow action/login/foreign URLs.
  for (let hop = 0; hop < 5; hop++) {
    let response;
    try {
      if (Date.now() >= deadline) throw new CoursePageError('SECTION_TIMEOUT');
      response = await request.get(url, { maxRedirects: 0, timeout: Math.max(1, deadline - Date.now()) });
      const status = response.status();
      if (status >= 300 && status < 400) {
        url = coursePageUrl(new URL(response.headers().location || '', url).href, courseId, baseUrl);
        if (!url) throw new CoursePageError('UNSAFE_SECTION_REDIRECT');
        continue;
      }
      if (status !== 200) throw new CoursePageError('PAGE_ACCESS_UNAVAILABLE');
      if (!/^text\/html(?:;|$)/i.test(response.headers()['content-type'] || '')) throw new CoursePageError('UNSUPPORTED_PAGE_TYPE');
      if (Number(response.headers()['content-length']) > htmlBytes) throw new CoursePageError('PAGE_SIZE_LIMIT');
      const body = await response.body();
      if (body.byteLength > htmlBytes) throw new CoursePageError('PAGE_SIZE_LIMIT');
      return inspectCoursePage(body.toString('utf8'), courseId, baseUrl);
    } catch (error) {
      if (error instanceof CoursePageError) throw error;
      throw new CoursePageError(error instanceof errors.TimeoutError ? 'SECTION_TIMEOUT' : 'SECTION_NETWORK_FAILURE');
    } finally { await response?.dispose().catch(() => {}); }
  }
  throw new CoursePageError('SECTION_REDIRECT_LIMIT');
}

export async function collectCourseSections({ courseId, baseUrl, readPage, limits = traversalLimits, now = Date.now }) {
  const deadline = now() + limits.milliseconds;
  const rootUrl = `${baseUrl}/course/view.php?id=${courseId}`;
  const pending = [rootUrl];
  const queued = new Set(pending);
  const sections = new Map();
  const resources = new Map();
  const warnings = [];
  let pagesVisited = 0;
  let name = '';
  const warn = (code, url) => { if (!warnings.some(w => w.code === code && w.url === url)) warnings.push({ code, url }); };
  while (pending.length) {
    if (pagesVisited >= limits.pages || now() >= deadline) { warn('TRAVERSAL_LIMIT', rootUrl); break; }
    const url = pending.shift();
    pagesVisited++;
    let page;
    try { page = await readPage(url, Math.min(10000, Math.max(1, deadline - now()))); }
    catch (error) {
      if (url === rootUrl) throw error;
      warn(error instanceof CoursePageError ? error.code : 'SECTION_UNAVAILABLE', url);
      continue;
    }
    if (url === rootUrl) name = page.course.name;
    if (!page.course.sections.length) warn('UNSUPPORTED_SECTION_LAYOUT', url);
    for (const section of page.course.sections) {
      const key = section.id.includes(':section:text:') ? `${url}:${section.id}` : section.id;
      if (key !== section.id) warn('SECTION_IDENTITY_UNVERIFIED', url);
      let target = sections.get(key);
      // An older section page may omit data-id but retain the same section number.
      if (!target && section.number !== null) target = [...sections.values()].find(s => s.number === section.number);
      if (!target) {
        if (sections.size >= limits.sections) { warn('SECTION_OUTPUT_LIMIT', rootUrl); break; }
        target = { ...section, resources: [] };
        sections.set(key, target);
      }
      if (section.summary.length > target.summary.length) target.summary = section.summary;
      if (target.name === 'Section' && section.name !== 'Section') target.name = section.name;
      for (const item of section.resources) {
        if (resources.has(item.id)) {
          const existing = resources.get(item.id);
          if (item.description.length > existing.description.length) existing.description = item.description;
          continue;
        }
        if (resources.size >= limits.resources) { warn('RESOURCE_OUTPUT_LIMIT', rootUrl); break; }
        const copy = { ...item };
        resources.set(item.id, copy);
        target.resources.push(copy);
      }
    }
    for (const value of page.links) {
      const next = coursePageUrl(value, courseId, baseUrl);
      if (!next || queued.has(next)) continue;
      // Bound the queue as well as the number of requests, reporting omitted links.
      if (queued.size >= limits.pages) { warn('TRAVERSAL_LIMIT', rootUrl); continue; }
      queued.add(next);
      pending.push(next);
    }
  }
  if (!sections.size) throw new UserError('No supported course sections found. This layout needs an additional parser.');
  return { id: courseId, name, url: rootUrl, sections: [...sections.values()],
    coverage: { partial: warnings.length > 0, pagesVisited, warnings },
    scope: 'Main course page and discovered supported section pages, within traversal limits. Folder contents, activity pages and linked files are not fetched.' };
}
