import test from 'node:test';
import assert from 'node:assert/strict';
import { errors } from 'playwright';
import { parseChoiceSelection, parseChoiceTerm, readChoiceSelection } from '../src/choices.js';
import { Moodle } from '../src/moodle.js';

const source = 'https://courses.finki.ukim.mk/mod/choice/view.php?id=7';
const html = body => `<body id="page-mod-choice-view" class="course-42"><header>PRIVATE_ACCOUNT</header><main id="region-main">${body}</main></body>`;
const label = text => `<div class="box py-3 generalbox">Your selection: ${text}</div>`;
const course = { id: 42, coverage: { partial: false }, sections: [{ resources: [{ url: source }] }] };

test('recognizes faculty generalbox saved label and nested value without account chrome', () => {
  const result = parseChoiceSelection(html(label('Среда 09:00–10:30 Лаб 321 Група Б')), 42);
  assert.equal(result.status, 'selected');
  assert.deepEqual(result.term, { weekday: 'wednesday', startTime: '09:00', endTime: '10:30', room: '321', group: 'B' });
  assert.ok(!JSON.stringify(result).includes('PRIVATE_ACCOUNT'));
  const nested = parseChoiceSelection(html(label('<strong>Friday 11:00 Lab 99 Group A</strong>')), 42);
  assert.equal(nested.term.weekday, 'friday');
  assert.equal(nested.term.endTime, null);
  assert.ok(nested.unresolvedFields.includes('endTime'));
});

test('bilingual field equivalents resolve, and conflicting bilingual fields stay null', () => {
  const result = parseChoiceTerm('среда, 16:00h, лаб 321аб - група А / Wednesday, 4:00 PM, Lab 321ab – Group A');
  assert.deepEqual(result.term, { weekday: 'wednesday', startTime: '16:00', endTime: null, room: '321ab', group: 'A' });
  const conflict = parseChoiceTerm('среда 16:00 Lab 321 Group A / Thursday 5:00 PM Lab 322 Group B');
  assert.ok(Object.values(conflict.term).every(value => value === null));
});

test('implicit faculty group layout is supported without inferring missing fields', () => {
  const result = parseChoiceTerm('Петок 10:30 - 12:00 Б Лаб. 321');
  assert.equal(result.term.group, 'B');
  assert.equal(result.term.endTime, '12:00');
  const arbitrary = parseChoiceTerm('Do not attend');
  assert.ok(Object.values(arbitrary.term).every(value => value === null));
  assert.equal(parseChoiceTerm('03.11.2026').term.startTime, null);
  const multiple = parseChoiceTerm('Monday 09:00, Tuesday 10:00');
  assert.equal(multiple.term.startTime, null);
  assert.equal(multiple.term.endTime, null);
});

test('invalid/reversed/extra time fields remain unresolved, including AM/PM bounds', () => {
  for (const text of ['Wednesday 28:00 Lab 321', 'Friday 10:99', 'Monday 13:00 PM', 'Monday 17:00-15:00', 'Monday 09:00 10:00 11:00']) {
    const result = parseChoiceTerm(text);
    assert.equal(result.term.startTime, null);
    assert.equal(result.term.endTime, null);
  }
  assert.equal(parseChoiceTerm('Monday 12:00 AM').term.startTime, '00:00');
  assert.equal(parseChoiceTerm('Monday 12:00 PM').term.startTime, '12:00');
});

test('explicit no-choice message differs from unknown/missing selection and default radios', () => {
  assert.equal(parseChoiceSelection(html('<div class="generalbox">You have not made a choice yet.</div>'), 42).status, 'not_selected');
  for (const content of ['', '<form><input type="radio" checked name="answer" value="1">Friday 10:00</form>', label(''), label('x'.repeat(701))]) {
    assert.equal(parseChoiceSelection(html(content), 42).status, 'unknown');
  }
});

test('results tables, forms, intro content and hidden messages do not establish saved choice', () => {
  for (const body of [
    `<table><tr><td>${label('PRIVATE_PARTICIPANT')}</td></tr></table>`,
    `<form>${label('PRIVATE_FORM')}</form>`, `<div id="intro">${label('PRIVATE_INTRO')}</div>`,
    `<div hidden>${label('PRIVATE_HIDDEN')}</div>`,
  ]) {
    const result = parseChoiceSelection(html(body), 42);
    assert.equal(result.status, 'unknown');
    assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
  }
});

test('conflicting selection messages yield unknown without echoing candidate choices', () => {
  for (const body of [label('Wednesday 09:00') + label('Thursday 10:00'), label('Friday 11:00') + '<div class="generalbox">You have not made a choice yet.</div>']) {
    const result = parseChoiceSelection(html(body), 42);
    assert.equal(result.status, 'unknown');
    assert.equal(result.selection, null);
    assert.deepEqual(result.warnings, ['CONFLICTING_SELECTION_MESSAGES']);
  }
  const mk = parseChoiceSelection(html('<div class="generalbox">Вашиот избор: Среда 09:00</div>'), 42);
  assert.equal(mk.status, 'selected');
});

function mockRequest({ status = 200, type = 'text/html; charset=utf-8', body = html(label('Friday 09:00')), length, error } = {}) {
  const calls = [];
  let disposed = false;
  return { calls, disposed: () => disposed, get: async (url, options) => {
    calls.push(url);
    assert.equal(options.maxRedirects, 0);
    assert.equal(options.timeout, 15000);
    if (error) throw error;
    return { status: () => status, headers: () => ({ 'content-type': type, 'content-length': String(length ?? Buffer.byteLength(body)) }),
      body: async () => Buffer.from(body), dispose: async () => { disposed = true; } };
  } };
}

test('request adapter returns provenance using one canonical GET and disposes response', async () => {
  const request = mockRequest();
  const result = await readChoiceSelection({ request, course, choiceId: 7, now: () => '2026-01-01T12:00:00Z' });
  assert.equal(result.status, 'selected');
  assert.equal(result.sourceUrl, source);
  assert.equal(result.checkedAt, '2026-01-01T12:00:00Z');
  assert.deepEqual(request.calls, [source]);
  assert.equal(request.disposed(), true);
});

test('undiscovered choices, redirects, ownership and unsupported responses are safe failures', async () => {
  const request = mockRequest();
  await assert.rejects(readChoiceSelection({ request, course, choiceId: 8 }), /not in this course/);
  assert.equal(request.calls.length, 0);
  for (const [options, code] of [
    [{ status: 302 }, 'CHOICE_REDIRECT_NOT_FOLLOWED'], [{ status: 403 }, 'CHOICE_ACCESS_UNAVAILABLE'],
    [{ body: html('').replace('course-42', 'course-43') }, 'CHOICE_OWNERSHIP_UNVERIFIED'],
    [{ type: 'application/pdf' }, 'UNSUPPORTED_CHOICE_CONTENT_TYPE'],
    [{ length: 3 * 1024 * 1024 }, 'CHOICE_SIZE_LIMIT'],
    [{ body: 'x'.repeat(2 * 1024 * 1024 + 1) }, 'CHOICE_SIZE_LIMIT'],
    [{ error: new errors.TimeoutError('PRIVATE') }, 'CHOICE_TIMEOUT'],
    [{ error: new Error('PRIVATE') }, 'CHOICE_NETWORK_FAILURE'],
  ]) {
    await assert.rejects(readChoiceSelection({ request: mockRequest(options), course, choiceId: 7 }), e => e.code === code && !e.message.includes('PRIVATE'));
  }
});

test('Moodle method uses current authorized course discovery for each choice read', async () => {
  const moodle = new Moodle({});
  let requestedCourse;
  moodle.getCourse = async id => { requestedCourse = id; return course; };
  moodle.page = { context: () => ({ request: mockRequest() }) };
  assert.equal((await moodle.getChoiceSelection(42, 7)).status, 'selected');
  assert.equal(requestedCourse, 42);
});
