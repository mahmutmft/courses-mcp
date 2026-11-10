import test from 'node:test';
import assert from 'node:assert/strict';
import { errors } from 'playwright';
import { coursePageUrl, searchCourse } from '../src/content.js';
import { collectCourseSections, inspectCoursePage, readCoursePage, traversalLimits, CoursePageError } from '../src/sections.js';
import { Moodle } from '../src/moodle.js';

const base = 'https://courses.finki.ukim.mk';
const root = `${base}/course/view.php?id=42`;
const first = `${base}/course/section.php?id=101`;
const second = `${root}&section=2`;
const section = (dbId, number, name, cmId, description = '') => `<li class="section" data-for="section" data-id="${dbId}" data-number="${number}"><h3 class="sectionname">${name}</h3><div class="summary">Summary ${name}</div>${cmId ? `<li class="activity" data-id="${cmId}"><a href="/mod/resource/view.php?id=${cmId}">Lecture ${cmId}</a><div class="description">${description}</div></li>` : ''}</li>`;
// Use div sections so activity list items do not imply-close the parent li in HTML.
const block = (...args) => section(...args).replace(/^<li/, '<div').replace(/<\/li>$/, '</div>');
const page = (content, courseId = 42) => `<body class="course-${courseId}"><h1>Fixture course</h1><main id="region-main">${content}</main></body>`;
const links = (...urls) => urls.map(url => `<a href="${url.replaceAll('&', '&amp;')}">Section</a>`).join('');
const fixtures = new Map([
  [root, page(block(101, 1, 'One', 1) + links(first, `${second}#top`, first, `${base}/course/view.php?id=43&section=1`))],
  [first, page(block(101, 1, 'One', 1, 'New detail') + block(101, 1, 'One', 2) + links(root, second))],
  [second, page(block(102, 2, 'Two', 3, 'Unique search phrase') + links(first, second))],
]);

function collect(pages = fixtures, overrides = {}) {
  const visited = [];
  return { visited, run: () => collectCourseSections({ courseId: 42, baseUrl: base,
    readPage: async url => {
      visited.push(url);
      const value = pages.get(url);
      if (value instanceof Error) throw value;
      if (value === undefined) throw new Error('Unmapped URL must not leak');
      return inspectCoursePage(value, 42, base);
    }, ...overrides }) };
}

test('course page URLs allow only canonical read-only section routes for this course', () => {
  assert.equal(coursePageUrl('/course/view.php?section=02&id=42#x', 42, base), second);
  assert.equal(coursePageUrl('/course/section.php?id=101', 42, base), first);
  for (const value of ['https://evil.example/course/section.php?id=101', '/course/view.php?id=43&section=2',
    '/course/section.php?id=101&sesskey=secret', '/course/section.php?id=101&delete=1',
    '/course/view.php?id=42&section=2&edit=on', '/course/section.php?id=101&id=102',
    'javascript:alert(1)', '/course/section.php?id=-1', '/course/view.php?id=42&section=-1']) {
    assert.equal(coursePageUrl(value, 42, base), null);
  }
});

test('traverses modern and legacy section links, deduplicates resources, and stops cycles', async () => {
  const { run, visited } = collect();
  const course = await run();
  assert.deepEqual(visited, [root, first, second]);
  assert.equal(course.sections.length, 2);
  assert.deepEqual(course.sections.flatMap(s => s.resources.map(r => r.id)), ['course:42:cm:1', 'course:42:cm:2', 'course:42:cm:3']);
  assert.equal(course.sections[0].resources[0].description, 'New detail');
  assert.equal(course.coverage.partial, false);
  const search = searchCourse(course, 'unique search');
  assert.equal(search.matches.length, 1);
  assert.equal(search.matches[0].url, `${base}/mod/resource/view.php?id=3`);
  assert.deepEqual(search.coverage, course.coverage);
});

test('denied, wrong-course, and unsupported pages become safe partial warnings', async () => {
  for (const failure of [new CoursePageError('PAGE_ACCESS_UNAVAILABLE'), page(block(101, 1, 'Private other course', 99), 43), page('<p>Unsupported layout</p>')]) {
    const pages = new Map(fixtures).set(first, failure);
    const course = await collect(pages).run();
    assert.equal(course.coverage.partial, true);
    assert.ok(course.coverage.warnings.length);
    assert.ok(!JSON.stringify(course).includes('Private other course'));
    assert.equal(searchCourse(course, 'no match').coverage.partial, true);
  }
});

test('unknown section failures never expose raw error text', async () => {
  const course = await collect(new Map(fixtures).set(first, new Error('PRIVATE_PASSWORD_COOKIE'))).run();
  assert.ok(!JSON.stringify(course).includes('PRIVATE_PASSWORD_COOKIE'));
  assert.equal(course.coverage.warnings[0].code, 'SECTION_UNAVAILABLE');
});

test('page, elapsed-time, section, and resource limits report partial coverage', async () => {
  for (const limits of [{ ...traversalLimits, pages: 1 }, { ...traversalLimits, resources: 1 }, { ...traversalLimits, sections: 1 }]) {
    const { run, visited } = collect(fixtures, { limits });
    const course = await run();
    assert.equal(course.coverage.partial, true);
    assert.ok(visited.length <= limits.pages);
    assert.ok(course.sections.length <= limits.sections);
    assert.ok(course.sections.flatMap(s => s.resources).length <= limits.resources);
  }
  let tick = 0;
  const course = await collect(fixtures, { limits: { ...traversalLimits, milliseconds: 3 }, now: () => tick++ }).run();
  assert.equal(course.coverage.partial, true);
});

test('missing section identity is disclosed and unsupported root fails explicitly', async () => {
  const noId = page('<div data-for="section"><h3>Repeated title</h3></div><div data-for="section"><h3>Repeated title</h3></div>');
  const course = await collect(new Map([[root, noId]])).run();
  assert.equal(course.sections.length, 2);
  assert.equal(course.coverage.warnings[0].code, 'SECTION_IDENTITY_UNVERIFIED');
  await assert.rejects(collect(new Map([[root, page('<p>No sections</p>')]])).run(), /No supported course sections/);
});

test('a section index without inline resources can discover readable child sections', async () => {
  const pages = new Map(fixtures).set(root, page(links(first, second)));
  const course = await collect(pages).run();
  assert.equal(course.sections.length, 2);
  assert.equal(course.coverage.partial, true);
  assert.ok(course.coverage.warnings.some(w => w.code === 'UNSUPPORTED_SECTION_LAYOUT'));
  const unreadable = collect(new Map([[root, new CoursePageError('PAGE_ACCESS_UNAVAILABLE')]]));
  await assert.rejects(unreadable.run(), e => e.code === 'PAGE_ACCESS_UNAVAILABLE');
  assert.deepEqual(unreadable.visited, [root]);
});

function response({ status = 200, location, type = 'text/html; charset=utf-8', html = fixtures.get(first), length } = {}) {
  let disposed = false;
  return { status: () => status, headers: () => ({ location, 'content-type': type, ...(length ? { 'content-length': String(length) } : {}) }),
    body: async () => Buffer.from(html), dispose: async () => { disposed = true; }, isDisposed: () => disposed };
}

test('request adapter validates redirects before following and disposes responses', async () => {
  const redirect = response({ status: 302, location: '/course/view.php?id=42&section=2' });
  const final = response({ html: fixtures.get(second) });
  const requested = [];
  const request = { get: async (url, options) => {
    assert.equal(options.maxRedirects, 0);
    requested.push(url);
    return requested.length === 1 ? redirect : final;
  } };
  const result = await readCoursePage(request, first, 42, base, 10000);
  assert.deepEqual(requested, [first, second]);
  assert.equal(result.course.sections[0].number, 2);
  assert.ok(redirect.isDisposed() && final.isDisposed());
  for (const location of ['https://evil.example/', '/login/index.php', '/course/view.php?id=43&section=1', '/course/section.php?id=101&sesskey=x']) {
    let count = 0;
    await assert.rejects(readCoursePage({ get: async () => { count++; return response({ status: 302, location }); } }, first, 42, base, 10000), e => e.code === 'UNSAFE_SECTION_REDIRECT');
    assert.equal(count, 1);
  }
});

test('request adapter distinguishes HTTP/type/size/ownership/network/timeout errors', async () => {
  for (const [options, code] of [
    [{ status: 403 }, 'PAGE_ACCESS_UNAVAILABLE'], [{ type: 'application/pdf' }, 'UNSUPPORTED_PAGE_TYPE'],
    [{ length: 100 }, 'PAGE_SIZE_LIMIT'], [{ html: 'x'.repeat(100) }, 'PAGE_SIZE_LIMIT'],
  ]) {
    const res = response(options);
    await assert.rejects(readCoursePage({ get: async () => res }, first, 42, base, 10000, 50), e => e.code === code);
    assert.equal(res.isDisposed(), true);
  }
  await assert.rejects(readCoursePage({ get: async () => response({ html: page('', 43) }) }, first, 42, base, 10000), e => e.code === 'COURSE_OWNERSHIP_UNVERIFIED');
  for (const [error, code] of [[new Error('PRIVATE'), 'SECTION_NETWORK_FAILURE'], [new errors.TimeoutError('PRIVATE'), 'SECTION_TIMEOUT']]) {
    await assert.rejects(readCoursePage({ get: async () => { throw error; } }, first, 42, base, 10000), e => e.code === code && !e.message.includes('PRIVATE'));
  }
});

test('redirect cycles stop within five response hops', async () => {
  let count = 0;
  await assert.rejects(readCoursePage({ get: async () => {
    count++;
    return response({ status: 302, location: first });
  } }, first, 42, base, 10000), e => e.code === 'SECTION_REDIRECT_LIMIT');
  assert.equal(count, 5);
});

test('Moodle integration authorizes enrollment before using the shared-cookie request adapter', async () => {
  const moodle = new Moodle({});
  const visited = [];
  moodle.listCourses = async () => ({ courses: [{ id: 42 }] });
  moodle.page = { context: () => ({ request: { get: async url => {
    visited.push(url);
    return response({ html: fixtures.get(url) });
  } } }) };
  const course = await moodle.getCourse(42);
  assert.equal(course.sections.length, 2);
  assert.deepEqual(visited, [root, first, second]);
  await assert.rejects(moodle.getCourse(43), /not in your enrolled/);
  assert.equal(visited.length, 3);
});

test('independent sections overlap while results retain discovery order', async () => {
  let releaseFirst;
  const secondStarted = new Promise(resolve => { releaseFirst = resolve; });
  const course = await collectCourseSections({
    courseId: 42, baseUrl: base,
    readPage: async url => {
      if (url === first) await secondStarted;
      if (url === second) releaseFirst();
      return inspectCoursePage(fixtures.get(url), 42, base);
    },
  });
  assert.deepEqual(course.sections.map(section => section.number), [1, 2]);
  assert.equal(course.coverage.partial, false);
});
