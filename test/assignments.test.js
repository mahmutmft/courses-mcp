import test from 'node:test';
import assert from 'node:assert/strict';
import { errors } from 'playwright';
import { parseAssignmentDate, parseAssignmentHtml, readAssignment, enrichLabHomework } from '../src/assignments.js';
import { Moodle } from '../src/moodle.js';
const sourceUrl = 'https://courses.finki.ukim.mk/mod/assign/view.php?id=12';
const course = { id: 42, coverage: { partial: false }, sections: [{ resources: [{ name: 'Homework B', url: sourceUrl }] }] };
const html = (content, intro = '<p>Task instructions</p>') => `<body id="page-mod-assign-view" class="course-42"><main id="region-main"><div id="intro">${intro}</div><div data-region="activity-dates">${content}</div><table class="submissionstatustable"><tr><td>PRIVATE_ANSWER_GRADE</td></tr></table></main></body>`;
const row = (label, value) => `<div><strong>${label}:</strong> ${value}</div>`;
const due = row('Due', 'Thursday, 8 October 2026, 2:30 PM');
function requestFor(body = html(due), { status = 200, headers = {}, error } = {}) {
  let disposed = false;
  const calls = [];
  return { calls, disposed: () => disposed, get: async (url, options) => {
    calls.push({ url, options });
    if (error) throw error;
    return { status: () => status, headers: () => ({ 'content-type': 'text/html; charset=utf-8', ...headers }),
      body: async () => Buffer.from(body), dispose: async () => { disposed = true; } };
  } };
}

test('reads only bounded intro and activity dates, excluding submissions, forms and hidden content', () => {
  const result = parseAssignmentHtml(html(due, '<p>Опис / Description / Përshkrim</p><form>PRIVATE_FORM</form><script>PRIVATE_SCRIPT</script><div hidden>PRIVATE_HIDDEN</div><a href="/pluginfile.php?token=PRIVATE_TOKEN">attachment label</a>'), 42);
  assert.match(result.description, /Опис/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  assert.equal(result.dates.due.localDateTime, '2026-10-08T14:30:00');
  assert.equal(result.dates.due.instant, null);
  assert.equal(result.dates.due.timeZone, null);
  assert.ok(result.warnings.includes('ASSIGNMENT_TIMEZONE_UNKNOWN'));
  assert.equal(result.dates.opened, null);
});

test('MK/EN/SQ published labels and month names map to separate date fields', () => {
  for (const [opened, dueLabel, cutoff, text] of [
    ['Opened', 'Due', 'Cut-off date', 'Thursday, 8 October 2026, 14:30'],
    ['Отворено', 'Рок за предавање', 'Краен датум за поднесување', 'четврток, 8 октомври 2026, 14:30'],
    ['Hapur', 'Afati i dorëzimit', 'Afati përfundimtar', 'e enjte, 8 tetor 2026, 14:30'],
  ]) {
    const result = parseAssignmentHtml(html(row(opened, text) + row(dueLabel, text) + row(cutoff, text)), 42);
    for (const date of Object.values(result.dates)) assert.equal(date.localDateTime, '2026-10-08T14:30:00');
  }
});

test('offset machine timestamps normalize explicitly; ambiguous, invalid and unsupported values stay unresolved', () => {
  assert.equal(parseAssignmentDate('date', '2026-10-08T14:30:00+02:00').instant, '2026-10-08T12:30:00.000Z');
  for (const [text, machine] of [
    ['03/04/2026 10:00'], ['Thursday, 31 February 2026, 10:00'], ['Thursday, 8 October 2026, 24:30'],
    ['Thursday, 8 October 2026, 13:30 PM'], ['date', '2026-02-30T14:30:00Z'],
    ['date', '2026-10-08T14:30:00'], ['date', '2026-10-08T14:30:00+14:30'],
  ]) assert.equal(parseAssignmentDate(text, machine).parsing, 'unresolved');
  const result = parseAssignmentHtml(html(row('Due', '<time datetime="2026-10-08T14:30:00+02:00">Published time</time>')), 42);
  assert.equal(result.dates.due.instant, '2026-10-08T12:30:00.000Z');
});

test('conflicting dates, unknown labels, missing layouts and truncation remain explicit', () => {
  const conflict = parseAssignmentHtml(html(due + row('Due', 'Friday, 9 October 2026, 14:30')), 42);
  assert.equal(conflict.dates.due, null);
  assert.ok(conflict.warnings.includes('CONFLICTING_ASSIGNMENT_DATES'));
  assert.ok(parseAssignmentHtml(html(row('Unknown', 'date')), 42).warnings.includes('ASSIGNMENT_DATE_LABEL_UNRECOGNIZED'));
  assert.ok(parseAssignmentHtml(html(''), 42).warnings.includes('ASSIGNMENT_DATES_NOT_PUBLISHED_OR_UNSUPPORTED'));
  const large = parseAssignmentHtml(html('', 'x'.repeat(10001)), 42);
  assert.equal(large.description.length, 10000);
  assert.equal(large.truncated, true);
  assert.throws(() => parseAssignmentHtml(html(due).replace('course-42', 'course-43'), 42), /OWNERSHIP/);
  assert.throws(() => parseAssignmentHtml(html(due).replace('page-mod-assign-view', 'page-login'), 42), /LAYOUT/);
  assert.throws(() => parseAssignmentHtml(html(due).replace('<main', '<div class="errorcode">denied</div><main'), 42), /ACCESS/);
});

test('adapter requires discovered exact assignment, uses canonical read-only GET, returns provenance and disposes', async () => {
  const request = requestFor();
  const result = await readAssignment({ request, course, assignmentId: 12, now: () => '2026-10-01T00:00:00Z' });
  assert.equal(result.sourceUrl, sourceUrl);
  assert.equal(result.checkedAt, '2026-10-01T00:00:00Z');
  assert.equal(request.calls[0].options.maxRedirects, 0);
  assert.equal(request.calls[0].url, sourceUrl);
  assert.equal(request.disposed(), true);
  assert.equal(result.status, 'partial');
  await assert.rejects(readAssignment({ request, course, assignmentId: 13 }), /not in this course/);
  await assert.rejects(readAssignment({ request, course, assignmentId: -1 }), /positive/);
  assert.equal(request.calls.length, 1);
});

test('redirect, access, MIME, size, ownership, timeout and network errors cannot leak raw details', async () => {
  for (const [body, options, code] of [
    [undefined, { status: 302, headers: { location: 'https://outside.example/PRIVATE' } }, 'REDIRECT'],
    [undefined, { status: 403 }, 'ACCESS'], [undefined, { headers: { 'content-type': 'application/json' } }, 'CONTENT_TYPE'],
    [undefined, { headers: { 'content-length': String(3 * 1024 * 1024) } }, 'SIZE'],
    ['x'.repeat(2 * 1024 * 1024 + 1), {}, 'SIZE'],
    [html(due).replace('course-42', 'course-43'), {}, 'OWNERSHIP'],
    [undefined, { error: new errors.TimeoutError('PRIVATE') }, 'TIMEOUT'],
    [undefined, { error: new Error('PRIVATE') }, 'NETWORK'],
  ]) {
    const request = requestFor(body, options);
    await assert.rejects(readAssignment({ request, course, assignmentId: 12 }), error => error.message.includes(code) && !error.message.includes('PRIVATE'));
    assert.equal(request.disposed(), !options.error);
    assert.equal(request.calls.length, 1);
  }
});

const schedule = (count = 1) => ({ weekStart: '2026-10-05', weekEnd: '2026-10-11', datedOccurrences: [], warnings: [], scope: '',
  termLinkedHomework: Array.from({ length: count }, (_, i) => ({ sourceUrl: sourceUrl.replace('id=12', `id=${12 + i}`), date: null, status: 'date_unconfirmed', term: { weekday: 'monday', startTime: '15:30' } })) });
const details = date => ({ status: 'read', dates: { due: date ? { localDateTime: `${date}T14:30:00` } : null } });

test('enrichment distinguishes deadline relevance from presentation, never hides old homework or invents occurrence', async () => {
  for (const [date, relation] of [['2026-10-01', 'displayed_due_before_week'], ['2026-10-08', 'displayed_due_within_week'], ['2026-10-15', 'displayed_due_after_week'], [null, 'unknown']]) {
    const result = await enrichLabHomework(schedule(), async () => details(date));
    const item = result.termLinkedHomework[0];
    assert.equal(item.deadlineRelation, relation);
    assert.equal(item.date, null);
    assert.equal(item.status, 'date_unconfirmed');
    assert.equal(item.term.startTime, '15:30');
    assert.deepEqual(result.datedOccurrences, []);
  }
});

test('enrichment budgets reads/time and safely retains unavailable homework', async () => {
  let calls = 0;
  const result = await enrichLabHomework(schedule(8), async () => { calls++; return details(null); });
  assert.equal(calls, 5);
  assert.equal(result.termLinkedHomework.length, 8);
  assert.ok(result.warnings.includes('ASSIGNMENT_ENRICHMENT_LIMIT'));
  const failed = await enrichLabHomework(schedule(), async () => { throw Error('PRIVATE'); });
  assert.equal(failed.termLinkedHomework[0].assignment.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(failed), /PRIVATE/);
  let clock = 0;
  const timed = await enrichLabHomework(schedule(8), async () => { clock += 30000; return details(null); }, { now: () => clock });
  assert.ok(timed.warnings.includes('ASSIGNMENT_ENRICHMENT_LIMIT'));
});

test('Moodle assignment method authorizes through current discovery before access', async () => {
  const moodle = new Moodle({});
  moodle.getCourse = async () => { throw Error('not enrolled'); };
  await assert.rejects(moodle.getAssignment(42, 12), /not enrolled/);
  const request = requestFor();
  moodle.getCourse = async id => { assert.equal(id, 42); return course; };
  moodle.page = { context: () => ({ request }) };
  assert.equal((await moodle.getAssignment(42, 12)).assignmentId, 12);
});
