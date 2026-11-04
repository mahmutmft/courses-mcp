import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLabSchedule, isMonday } from '../src/labs.js';
import { Moodle } from '../src/moodle.js';

const url = (type, id) => `https://courses.finki.ukim.mk/mod/${type}/view.php?id=${id}`;
const activity = (name, id = 2, type = 'assign') => ({ name, url: url(type, id) });
const term = { weekday: 'monday', startTime: '15:30', endTime: '17:00', room: '123', group: 'B' };
const choice = { status: 'selected', term, sourceUrl: url('choice', 1), checkedAt: '2026-10-01T00:00:00Z' };
function run(resources, overrides = {}) {
  return buildLabSchedule({ course: { id: 42, sections: [{ name: 'Laboratory exercises', resources: [activity('Lab presentation term', 1, 'choice'), ...resources] }], coverage: { partial: false } },
    preference: { attendance: 'unknown' }, weekStart: '2026-10-05', readChoice: async () => choice, ...overrides });
}

test('links matching homework to selected term in three languages, without inventing a week', async () => {
  for (const name of ['Домашна задача (лабораториска вежба) 1 - група Б', 'Lab homework 1 - Group B', 'Detyrë laboratori 1 - Grupi B']) {
    const result = await run([activity(name), activity('Lab homework - Group A', 3)]);
    assert.equal(result.termLinkedHomework.length, 1);
    assert.equal(result.termLinkedHomework[0].name, name);
    assert.deepEqual(result.termLinkedHomework[0].term, term);
    assert.equal(result.termLinkedHomework[0].date, null);
    assert.equal(result.termLinkedHomework[0].status, 'date_unconfirmed');
    assert.equal(result.datedOccurrences.length, 0);
    assert.equal(result.status, 'partial');
    assert.equal(result.selectionSource.url, choice.sourceUrl);
    assert.ok(result.warnings.includes('HOMEWORK_WEEK_UNCONFIRMED'));
  }
});

test('published dates match group, weekday, time and room, combining paired sources', async () => {
  const resource = name => activity(name, 2, 'quiz');
  const result = await run([
    resource('[Assignment] Lab 2 (L123, 15:30–17:00, 05.10.2026) – Group B'),
    activity('[Test] Lab 2 (L123, 15:30–17:00, 05.10.2026) – Group B', 3, 'quiz'),
    resource('Lab 2 (L123, 15:30–17:00, 12.10.2026) – Group B'),
    resource('Lab 2 (L123, 17:00–18:30, 05.10.2026) – Group B'),
    resource('Lab 2 (L124, 15:30–17:00, 05.10.2026) – Group B'),
    resource('Lab 2 (L123, 15:30–17:00, 06.10.2026) – Group B'),
    resource('Lab 2 (L123, 15:30–17:00, 05.10.2026) – Group A'),
  ]);
  assert.equal(result.datedOccurrences.length, 1);
  assert.equal(result.datedOccurrences[0].date, '2026-10-05');
  assert.equal(result.datedOccurrences[0].sources.length, 2);
  assert.equal(result.termLinkedHomework.length, 0);
  assert.ok(result.warnings.includes('ANNOUNCEMENTS_AND_CANCELLATIONS_UNCHECKED'));
});

test('missing, ambiguous groups and invalid/conflicting dates never fabricate an occurrence', async () => {
  const result = await run([
    activity('Lab homework - Group A / Group B'), activity('Lab homework'),
    activity('Lab homework Group B 31.02.2026'), activity('Lab homework Group B 05.10.2026 / 12.10.2026'),
    activity('Cancelled Lab 2 (L123, 15:30–17:00, 05.10.2026) – Group B'),
  ]);
  assert.equal(result.datedOccurrences.length, 0);
  assert.equal(result.termLinkedHomework.length, 0);
  assert.equal(result.status, 'unknown');
  assert.ok(result.warnings.includes('ACTIVITY_GROUP_UNRESOLVED'));
  assert.ok(result.warnings.includes('ACTIVITY_DATE_UNRESOLVED'));
  assert.ok(result.warnings.includes('ACTIVITY_EXCEPTION_REQUIRES_REVIEW'));
  const missing = await run([activity('Lab homework Group B')], { readChoice: async () => ({ ...choice, term: { ...term, group: null } }) });
  assert.equal(missing.termLinkedHomework.length, 0);
});

test('missing/multiple choices, unreadable choice and empty course remain unknown', async () => {
  for (const resources of [[], [activity('Lab term', 1, 'choice'), activity('Lab term', 2, 'choice')]]) {
    const result = await run([], { course: { id: 42, sections: [{ name: 'Labs', resources }] }, readChoice: () => assert.fail('no fetch') });
    assert.equal(result.status, 'unknown');
  }
  const failed = await run([], { readChoice: async () => { throw new Error('private secret'); } });
  assert.ok(failed.warnings.includes('CHOICE_READ_FAILED'));
  assert.doesNotMatch(JSON.stringify(failed), /private secret/);
  const unset = await run([], { readChoice: async () => ({ status: 'not_selected' }) });
  assert.equal(unset.status, 'unknown');
});

test('exemptions skip choice fetching and missing end times stay null', async () => {
  const excluded = await run([], { preference: { attendance: 'exempt' }, readChoice: () => assert.fail('no fetch') });
  assert.equal(excluded.status, 'exempt');
  const result = await run([activity('Lab homework Group B')], { readChoice: async () => ({ ...choice, term: { ...term, endTime: null } }) });
  assert.equal(result.termLinkedHomework[0].term.endTime, null);
});

test('week validation is calendar-valid and Monday-based, including DST weeks', async () => {
  for (const date of ['2026-10-05', '2026-10-19', '2026-03-23']) assert.equal(isMonday(date), true);
  for (const date of ['2026-02-30', '2026-11-03', 'current', '2026-1-5', null]) assert.equal(isMonday(date), false);
  const result = await run([], { weekStart: '2026-03-23' });
  assert.equal(result.weekEnd, '2026-03-29');
  await assert.rejects(run([], { weekStart: '2026-11-03' }), /Monday/);
});

test('Moodle authorizes before resolving and skips discovery for an explicit exemption', async () => {
  const moodle = new Moodle({}, { preferences: { get: async () => ({ attendance: 'exempt' }) } });
  moodle.listCourses = async () => ({ courses: [{ id: 42 }] });
  moodle.getCourse = () => assert.fail('exempt must not discover content');
  assert.equal((await moodle.getLabSchedule(42, '2026-10-05')).status, 'exempt');
  await assert.rejects(moodle.getLabSchedule(43, '2026-10-05'), /enrolled/);
});
