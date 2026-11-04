import test from 'node:test';
import assert from 'node:assert/strict';
import { errors } from 'playwright';
import { moduleUrl, parseResourceHtml, readResourceContent } from '../src/resources.js';
import { Moodle } from '../src/moodle.js';

const base = 'https://courses.finki.ukim.mk';
const pageUrl = `${base}/mod/page/view.php?id=11`;
const urlUrl = `${base}/mod/url/view.php?id=12`;
const secret = 'PRIVATE_COOKIE_PASSWORD_TICKET';
const html = content => `<body class="course-42"><header>${secret}</header><main id="region-main">${content}</main></body>`;
const pageHtml = html(`<div class="generalbox"><div class="no-overflow"><h2>Распоред</h2><p>Среда 10:00</p><table><tr><th>Ден</th><th>Лаб</th></tr><tr><td>Среда</td><td>Лаб 2</td></tr></table><form><input value="${secret}"><div>${secret}</div></form><script>${secret}</script><a href="${urlUrl}">Information</a><a href="/login/logout.php?sesskey=${secret}">Logout</a></div></div>`);
const course = { id: 42, coverage: { partial: false }, sections: [{ resources: [
  { name: 'Page', url: pageUrl }, { name: 'URL', url: urlUrl }, { name: 'Folder', url: `${base}/mod/folder/view.php?id=13` },
] }] };
const wrapper = target => html(`<div class="activity-description">Project instructions</div><div class="urlworkaround"><a href="${target}">${target}</a></div>`);
function mockRequest(entries) {
  const calls = [];
  let disposals = 0;
  return { calls, disposed: () => disposals, get: async (url, options) => {
    calls.push(url);
    assert.equal(options.maxRedirects, 0);
    const entry = entries[calls.length - 1];
    if (!entry) assert.fail('Unexpected request');
    if (entry instanceof Error) throw entry;
    return { status: () => entry.status || 200, headers: () => ({ 'content-type': 'text/html', ...entry.headers }),
      body: async () => Buffer.from(entry.html || pageHtml), dispose: async () => { disposals++; } };
  } };
}
const read = request => readResourceContent({ request, course, resourceId: 11, now: () => '2026-11-04T10:00:00.000Z' });

test('extracts Macedonian text/tables and safe links, stripping chrome, forms and scripts', () => {
  const content = parseResourceHtml(pageHtml, 42, pageUrl, new Map([[urlUrl, {}]]));
  assert.match(content.text, /Среда 10:00/);
  assert.deepEqual(content.tables[0].rows, [['Ден', 'Лаб'], ['Среда', 'Лаб 2']]);
  assert.deepEqual(content.links, [urlUrl]);
  assert.ok(!JSON.stringify(content).includes(secret));
});

test('reader returns provenance and disposes successful HTML response', async () => {
  const request = mockRequest([{}]);
  const result = await read(request);
  assert.equal(result.status, 'read');
  assert.equal(result.sourceUrl, pageUrl);
  assert.equal(result.resolvedUrl, pageUrl);
  assert.equal(result.checkedAt, '2026-11-04T10:00:00.000Z');
  assert.equal(request.disposed(), 1);
});

test('URL wrapper follows only a discovered same-course supported module', async () => {
  const request = mockRequest([{ html: wrapper(pageUrl) }, {}]);
  const result = await readResourceContent({ request, course, resourceId: 12 });
  assert.deepEqual(request.calls, [`${urlUrl}&redirect=0`, pageUrl]);
  assert.equal(result.status, 'read');
  assert.equal(result.sourceUrl, urlUrl);
  assert.equal(result.resolvedUrl, pageUrl);
});

test('external URL targets are not fetched and query/path data is not echoed', async () => {
  const request = mockRequest([{ html: wrapper(`https://external.example/private/${secret}?ticket=${secret}`) }]);
  const result = await readResourceContent({ request, course, resourceId: 12 });
  assert.equal(request.calls.length, 1);
  assert.equal(result.status, 'partial');
  assert.equal(result.externalOrigin, 'https://external.example');
  assert.deepEqual(result.warnings, ['EXTERNAL_ORIGIN_NOT_SUPPORTED']);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test('unsupported resources and undiscovered module IDs never trigger a request', async () => {
  const request = mockRequest([]);
  assert.equal((await readResourceContent({ request, course, resourceId: 13 })).status, 'unsupported');
  await assert.rejects(readResourceContent({ request, course, resourceId: 99 }), /not in this course/);
  assert.equal(request.calls.length, 0);
});

test('unsafe/undiscovered redirects are rejected before following', async () => {
  for (const target of [`${pageUrl}&sesskey=${secret}`, `${base}/mod/page/view.php?id=99`, 'javascript:alert(1)', 'https://u:p@evil.example/', '/login/index.php']) {
    const request = mockRequest([{ status: 302, headers: { location: target } }]);
    await assert.rejects(read(request), error => error.code === 'UNSAFE_RESOURCE_REDIRECT');
    assert.equal(request.calls.length, 1);
    assert.equal(request.disposed(), 1);
  }
  assert.equal(moduleUrl(`${pageUrl}&id=12`), null);
});

test('HTTP redirects to external destinations return unsupported without leaking URLs', async () => {
  const request = mockRequest([{ status: 302, headers: { location: `https://external.example/${secret}` } }]);
  const result = await read(request);
  assert.equal(result.status, 'unsupported');
  assert.equal(request.calls.length, 1);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test('access/ownership/network/timeout and HTML processing limits have safe errors', async () => {
  for (const [entry, code] of [
    [{ status: 403 }, 'RESOURCE_ACCESS_UNAVAILABLE'],
    [{ html: pageHtml.replace('course-42', 'course-43') }, 'RESOURCE_OWNERSHIP_UNVERIFIED'],
    [{ headers: { 'content-length': '3000000' } }, 'RESOURCE_SIZE_LIMIT'],
    [{ html: 'x'.repeat(2 * 1024 * 1024 + 1) }, 'RESOURCE_SIZE_LIMIT'],
    [new errors.TimeoutError(secret), 'RESOURCE_TIMEOUT'], [new Error(secret), 'RESOURCE_NETWORK_FAILURE'],
  ]) {
    const request = mockRequest([entry]);
    await assert.rejects(read(request), error => error.code === code && !error.message.includes(secret));
  }
  const result = await read(mockRequest([{ headers: { 'content-type': 'application/pdf' } }]));
  assert.equal(result.status, 'unsupported');
});

test('truncation, missing layout, missing URL target and cycles are explicit', async () => {
  const long = html(`<div class="generalbox"><p>${'x'.repeat(21000)}</p></div>`);
  const result = await read(mockRequest([{ html: long }]));
  assert.equal(result.text.length, 20000);
  assert.equal(result.status, 'partial');
  assert.equal((await read(mockRequest([{ html: html('<p>Unknown</p>') }]))).status, 'unsupported');
  const missing = await readResourceContent({ request: mockRequest([{ html: html('<div class="activity-description">Info</div>') }]), course, resourceId: 12 });
  assert.ok(missing.warnings.includes('URL_DESTINATION_UNAVAILABLE'));
  const cycle = await read(mockRequest([{ status: 302, headers: { location: pageUrl } }]));
  assert.ok(cycle.warnings.includes('RESOURCE_REDIRECT_CYCLE'));
});

test('Moodle integration uses authorized course discovery for each resource read', async () => {
  const moodle = new Moodle({});
  let checked;
  moodle.getCourse = async id => { checked = id; return course; };
  moodle.page = { context: () => ({ request: mockRequest([{}]) }) };
  assert.equal((await moodle.readResource(42, 11)).status, 'read');
  assert.equal(checked, 42);
});
