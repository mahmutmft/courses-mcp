import test from 'node:test';
import assert from 'node:assert/strict';
import { errors } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { readResourceContent } from '../src/resources.js';
import { buildCourseIndex, rankCourseIndexes } from '../src/course-index.js';
import { LabPreferences } from '../src/preferences.js';
import { CourseCache } from '../src/course-cache.js';
import { buildLabSchedule } from '../src/labs.js';

const source = 'https://courses.finki.ukim.mk/mod/page/view.php?id=7';
const secrets = 'PASSWORD_SENTINEL COOKIE_SENTINEL AUTH_SENTINEL SYNTHETIC_LOCAL_PATH';
const checkedAt = '2026-11-22T12:00:00.000Z';
const course = { id: 42, url: 'https://courses.finki.ukim.mk/course/view.php?id=42',
  coverage: { partial: false }, sections: [{ name: 'Materials', resources: [{ name: 'Notes', url: source }] }] };

test('reader-to-index results preserve actual citations/freshness while excluding account chrome and secrets', async () => {
  const calls = [];
  let disposed = false;
  const html = `<body class="course-42"><header>${secrets}</header><main id="region-main">
    <div class="generalbox"><div class="no-overflow">Normalization and dependencies.
    <form action="/unsafe"><input value="${secrets}"></form><script>${secrets}</script>
    <a href="/login/logout.php?sesskey=COOKIE_SENTINEL">Logout</a></div></div></main></body>`;
  const request = { get: async url => {
    calls.push(url);
    return { status: () => 200, headers: () => ({ 'content-type': 'text/html', 'set-cookie': secrets }),
      body: async () => Buffer.from(html), dispose: async () => { disposed = true; } };
  } };
  const read = await readResourceContent({ request, course, resourceId: 7, now: () => checkedAt });
  const hits = rankCourseIndexes([buildCourseIndex(course, [read])], 'normalization', 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, source);
  assert.equal(hits[0].checkedAt, checkedAt);
  assert.equal(hits[0].page, null);
  assert.doesNotMatch(JSON.stringify({ read, hits }), /SENTINEL|SYNTHETIC_LOCAL_PATH/);
  assert.deepEqual(calls, [source]);
  assert.equal(disposed, true);
});

test('timeout/network failures hide diagnostic secrets and denied discovery never fetches content', async () => {
  for (const error of [new errors.TimeoutError(secrets), new Error(secrets)]) {
    await assert.rejects(readResourceContent({ request: { get: async () => { throw error; } }, course, resourceId: 7 }),
      failure => /RESOURCE_TIMEOUT|RESOURCE_NETWORK_FAILURE/.test(failure.message) && !/SENTINEL/.test(failure.message));
  }
  await assert.rejects(readResourceContent({ request: { get: () => assert.fail('denied discovery fetch') },
    course: { ...course, sections: [] }, resourceId: 7 }), /not in this course/);
});

test('unsupported PDF responses stay unsupported, not a successful empty document', async () => {
  const pdfSource = source.replace('/page/', '/resource/');
  let disposed = false;
  const request = { get: async () => ({ status: () => 200, headers: () => ({ 'content-type': 'image/png' }),
    body: () => assert.fail('unsupported body read'), dispose: async () => { disposed = true; } }) };
  const result = await readResourceContent({ request, course: { ...course,
    sections: [{ resources: [{ url: pdfSource }] }] }, resourceId: 7, now: () => checkedAt });
  assert.equal(result.status, 'unsupported');
  assert.ok(result.warnings.includes('PDF_UNSUPPORTED_CONTENT_TYPE'));
  assert.equal(result.sourceUrl, pdfSource);
  assert.equal(result.checkedAt, checkedAt);
  assert.equal(disposed, true);
});

test('user-declared exemptions and expired local cache metadata never become faculty evidence', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'finki-trust-'));
  t.after(async () => {
    assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
    assert.ok(basename(temp).startsWith('finki-trust-'));
    await rm(temp, { recursive: true, force: true });
  });
  const config = { baseUrl: 'https://courses.finki.ukim.mk', username: 'synthetic' };
  const preferences = new LabPreferences(config, { root: join(temp, 'preferences'), now: () => checkedAt });
  const preference = await preferences.set(42, 'exempt');
  assert.equal(preference.source, 'user_declared');
  assert.equal(preference.sourceUrl, undefined);
  const schedule = await buildLabSchedule({ course, preference, weekStart: '2026-11-16', checkedAt,
    readChoice: () => assert.fail('exemption should skip poll inference') });
  assert.equal(schedule.status, 'exempt');
  assert.deepEqual(schedule.datedOccurrences, []);
  let now = checkedAt;
  const cache = new CourseCache(config, { root: join(temp, 'cache'), enabled: true, authorize: async () => true, now: () => now });
  await cache.set(42, { content: 'PRIVATE_COURSE_TEXT', index: 'PRIVATE_INDEX' });
  now = '2026-11-29T12:00:00.000Z';
  assert.equal(await cache.get(42), null);
  const metadata = await cache.inspect(42);
  assert.equal(metadata.freshness, 'expired');
  assert.equal(metadata.checkedAt, undefined);
  assert.doesNotMatch(JSON.stringify(metadata), /PRIVATE_|sourceUrl|username/);
});
