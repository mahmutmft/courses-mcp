import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCourse, sourceUrl, searchCourse, normalizeCourses } from '../src/content.js';
import { loadConfig, safeError, UserError, isCasLogin } from '../src/config.js';

const base = 'https://courses.finki.ukim.mk';
const html = `<h1>Algorithms &amp; Data</h1><ul><li class="section" data-for="section">
<h3 class="sectionname">Недела 1</h3><div class="summary">Вежби и материјали</div>
<ul><li class="activity" data-for="cmitem"><a href="/mod/resource/view.php?id=12"><span class="instancename">Lecture slides</span></a><div class="description">Binary trees</div></li>
<li class="activity"><div class="contentwithoutlink">Read chapter one</div></li>
<li class="activity"><a href="https://evil.example/mod/resource/view.php?id=3">Bad link</a></li></ul>
</li></ul>`;

test('parses sections once, decodes text, and preserves read-only source URLs', () => {
  const course = parseCourse(html, 42, base);
  assert.equal(course.name, 'Algorithms & Data');
  assert.equal(course.sections.length, 1);
  assert.equal(course.sections[0].resources.length, 2);
  assert.equal(course.sections[0].resources[0].url, `${base}/mod/resource/view.php?id=12`);
  assert.equal(course.sections[0].resources[1].description, 'Read chapter one');
});

test('rejects foreign origins, active schemes, credentials, and session actions', () => {
  for (const url of ['javascript:alert(1)', '//evil.example/course/view.php?id=1',
    'https://u:p@courses.finki.ukim.mk/course/view.php?id=1', '/login/logout.php?sesskey=x',
    '/mod/resource/view.php?id=12&sesskey=secret', '/admin/index.php']) {
    assert.equal(sourceUrl(url, base), null);
  }
});

test('search handles Macedonian and case-insensitive activity text, with limits', () => {
  const course = parseCourse(html, 42, base);
  assert.equal(searchCourse(course, 'ВЕЖБИ').matches.length, 1);
  assert.equal(searchCourse(course, 'binary').matches[0].name, 'Lecture slides');
  assert.equal(searchCourse(course, 'not found').matches.length, 0);
  assert.equal(searchCourse(course, 'e', 1).truncated, true);
});

test('normalizes API courses without carrying through session-bearing API URLs', () => {
  assert.deepEqual(normalizeCourses([{ id: 5, fullname: 'A &amp; B', shortname: '<b>AB</b>', viewurl: 'https://evil.example' }, { id: 'oops' }], base), [
    { id: 5, name: 'A & B', shortName: 'AB', url: `${base}/course/view.php?id=5` },
  ]);
});

test('configuration rejects destinations that could collect credentials', () => {
  assert.throws(() => loadConfig({ MOODLE_BASE_URL: 'http://courses.finki.ukim.mk' }), UserError);
  assert.throws(() => loadConfig({ MOODLE_BASE_URL: 'https://evil.example' }), UserError);
  assert.equal(loadConfig({}).password, '');
});

test('unexpected exceptions cannot expose secrets to agents', () => {
  const message = safeError(new Error('password=secret; cookie=session'));
  assert.doesNotMatch(message, /password=|cookie=|session$/);
  assert.equal(safeError(new UserError('Fill credentials locally.')), 'Fill credentials locally.');
});

test('accepts faculty CAS URL-rewritten login forms but rejects alternate endpoints', () => {
  assert.equal(isCasLogin('https://cas.finki.ukim.mk/cas/login;jsessionid=ABC123?service=x'), true);
  assert.equal(isCasLogin('https://cas.finki.ukim.mk/cas/login'), true);
  for (const url of ['https://evil.example/cas/login', 'http://cas.finki.ukim.mk/cas/login',
    'https://cas.finki.ukim.mk/cas/logout', 'https://cas.finki.ukim.mk/cas/login/evil']) {
    assert.equal(isCasLogin(url), false);
  }
});
