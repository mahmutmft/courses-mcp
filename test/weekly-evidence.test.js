import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWeeklyEvidence } from '../src/weekly-evidence.js';
import { collectWeeklyLabs, validateWeeklyEvidence } from '../src/weekly-labs.js';
import { Moodle } from '../src/moodle.js';

const checkedAt = '2026-11-22T12:00:00.000Z';
const now = Date.parse(checkedAt);
const range = { from: '2026-11-16', through: '2026-11-22' };
const entry = { id: 'entry', courseId: 1, group: 'A', weekday: 'tuesday', startTime: '14:00', endTime: '15:00',
  room: '2', timeZone: 'Europe/Skopje', dates: [], effectiveFrom: '2026-11-01', effectiveUntil: '2026-11-30',
  recurrence: 'weekly', anchorDate: null, warnings: [], sources: [{ url: 'https://example.test/timetable', kind: 'html_row', row: 2 }] };
const timetable = { status: 'read', sourceUrl: 'https://example.test/timetable', checkedAt, entries: [entry] };
const announcements = { status: 'read', sourceUrl: 'https://example.test/news', checkedAt, posts: [] };
const schedule = { status: 'partial', attendance: 'attending', checkedAt, coverage: { partial: false },
  selectionSource: { term: { group: 'A' } }, warnings: ['ANNOUNCEMENTS_AND_CANCELLATIONS_UNCHECKED'],
  datedOccurrences: [], termLinkedHomework: [] };
const resolve = (s = schedule, t = timetable, a = announcements, from = range.from) => resolveWeeklyEvidence(s, t, a, range, from, now);
const news = text => ({ ...announcements, posts: [{ text, sourceUrl: 'https://example.test/news/post/1',
  publishedAt: '2026-11-16T12:00:00Z', checkedAt, warnings: [] }] });

test('current selected recurrence resolves scheduled candidates with source/freshness', () => {
  const result = resolve();
  assert.equal(result.answerState, 'scheduled');
  assert.equal(result.occurrences[0].date, '2026-11-17');
  assert.equal(result.occurrences[0].sources[0].url, timetable.sourceUrl);
  assert.equal(result.checkedAt, checkedAt);
  assert.equal(result.timetableCheckedAt, checkedAt);
});

test('confirmed-none requires explicit cancellation of all known selected slots', () => {
  const result = resolve(schedule, timetable, news('Lab change: cancel | A | 2026-11-17 14:00'));
  assert.equal(result.answerState, 'confirmed-none');
  assert.deepEqual(result.occurrences, []);
  assert.equal(result.sessions[0].evidence[0].sourceUrl, 'https://example.test/news/post/1');
  assert.equal(resolve(schedule, { ...timetable, entries: [] }).answerState, 'unknown');
  assert.equal(resolve(schedule, timetable, announcements, '2026-11-18').answerState, 'unknown');
});

test('moves from earlier in the week remain visible in a remaining-week query', () => {
  const result = resolve(schedule, timetable, news('Lab change: move | A | 2026-11-17 14:00 | 2026-11-19 16:00 | 3'), '2026-11-18');
  assert.equal(result.answerState, 'scheduled');
  assert.equal(result.occurrences[0].date, '2026-11-19');
  assert.equal(result.occurrences[0].endTime, null);
  assert.equal(result.occurrences[0].changeEvidence.length, 1);
});

test('stale/failed/partial/group and attendance uncertainty never produces confirmed absence', () => {
  const cancelled = news('Lab change: cancel | A | 2026-11-17 14:00');
  for (const [s, t, a] of [
    [schedule, { ...timetable, checkedAt: '2026-11-21T12:00:00Z' }, cancelled],
    [schedule, timetable, null], [schedule, timetable, { ...cancelled, status: 'partial' }],
    [{ ...schedule, attendance: 'unknown' }, timetable, cancelled],
    [{ ...schedule, termLinkedHomework: [{ date: null }] }, timetable, cancelled],
    [schedule, { ...timetable, status: 'partial' }, cancelled],
    [schedule, { ...timetable, entries: [{ ...entry, timeZone: 'UTC' }] }, cancelled],
  ]) assert.equal(resolve(s, t, a).answerState, 'unknown');
});

test('conflicting changes and contradictory known end times remain unknown', () => {
  const conflict = news('Lab change: cancel | A | 2026-11-17 14:00\nLab change: move | A | 2026-11-17 14:00 | 2026-11-19 16:00 | 3');
  assert.equal(resolve(schedule, timetable, conflict).answerState, 'unknown');
  const s = { ...schedule, datedOccurrences: [{ date: '2026-11-17', startTime: '14:00', endTime: '16:00', group: 'A', room: '2', sources: [] }] };
  const result = resolve(s);
  assert.equal(result.answerState, 'unknown');
  assert.equal(result.occurrences[0].status, 'conflict');
  assert.deepEqual(result.occurrences[0].endTimeProposals, ['16:00', '15:00']);
  assert.deepEqual(resolve(s), result);
  assert.deepEqual(s.datedOccurrences[0].sources, []);
});

test('mixed courses retain exemptions, missing evidence and safe failed reads separately', async () => {
  let reads = 0;
  const result = await collectWeeklyLabs({ courseIds: [1, 2, 3], weekStart: range.from, now: () => now,
    evidence: [{ courseId: 1, resourceId: 7, forumId: 8 }, { courseId: 2, resourceId: 9, forumId: 10 }],
    readSchedule: async id => { if (id === 3) throw new Error('PRIVATE_SOURCE_ERROR'); return id === 2 ? { ...schedule, status: 'exempt', datedOccurrences: [] } : schedule; },
    readEvidence: async () => { reads++; return { timetable, announcements }; } });
  assert.deepEqual(result.courses.map(course => course.answerState), ['scheduled', 'exempt', 'unknown']);
  assert.equal(result.answerState, 'unknown');
  assert.equal(reads, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SOURCE_ERROR/);
  assert.equal(result.occurrences.length, 1);
});

test('DST and year boundaries keep local dates and explicit selection limits', () => {
  for (const [from, through, date] of [['2026-03-23', '2026-03-29', '2026-03-29'], ['2026-12-28', '2027-01-03', '2027-01-01']]) {
    const result = resolveWeeklyEvidence(schedule, { ...timetable, entries: [{ ...entry, dates: [date] }] },
      announcements, { from, through }, from, now);
    assert.equal(result.occurrences[0].date, date);
    assert.equal(result.occurrences[0].startTime, '14:00');
  }
  assert.throws(() => validateWeeklyEvidence([1], [{ courseId: 2, resourceId: 1, forumId: 2 }]), /selected course/);
  assert.throws(() => validateWeeklyEvidence([1], [{ courseId: 1, resourceId: 1, forumId: 2 }, { courseId: 1, resourceId: 2, forumId: 3 }]), /one timetable/);
});

test('Moodle evidence integration uses enrolled timetable/news readers only', async () => {
  const calls = [];
  const result = await Moodle.prototype.getWeeklyLabs.call({
    listCourses: async () => ({ courses: [{ id: 1 }] }),
    getLabSchedule: async () => schedule,
    getLabTimetable: async (...args) => { calls.push(['timetable', ...args]); return timetable; },
    getAnnouncements: async (...args) => { calls.push(['forum', ...args]); return announcements; },
  }, [1], range.from, undefined, [{ courseId: 1, resourceId: 7, forumId: 8 }]);
  assert.deepEqual(calls, [['timetable', 1, 7], ['forum', 1, 8]]);
  assert.equal(result.occurrences.length, 1);
});

test('missing groups/failed evidence reads retain candidates without duplicate course records', async () => {
  for (const missingGroup of [true, false]) {
    let reads = 0;
    const result = await collectWeeklyLabs({ courseIds: [1], weekStart: range.from, now: () => now,
      evidence: [{ courseId: 1, resourceId: 7, forumId: 8 }],
      readSchedule: async () => ({ ...schedule, selectionSource: missingGroup ? null : schedule.selectionSource,
        datedOccurrences: [{ date: '2026-11-17', startTime: '14:00', sources: [] }] }),
      readEvidence: async () => { reads++; throw new Error('PRIVATE_UPSTREAM'); } });
    assert.equal(result.courses.length, 1);
    assert.equal(result.occurrences.length, 1);
    assert.equal(result.courses[0].answerState, 'unknown');
    assert.equal(reads, missingGroup ? 0 : 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_UPSTREAM/);
  }
});

test('earlier courses that become stale during later reads are unknown at return time', async () => {
  let clock = now;
  const result = await collectWeeklyLabs({ courseIds: [1, 2], weekStart: range.from, now: () => clock,
    evidence: [{ courseId: 1, resourceId: 7, forumId: 8 }],
    readSchedule: async id => { if (id === 2) clock += 300001; return id === 2 ? { ...schedule, status: 'exempt' } : schedule; },
    readEvidence: async () => ({ timetable, announcements }) });
  assert.equal(result.courses[0].answerState, 'unknown');
  assert.ok(result.courses[0].warnings.includes('WEEKLY_EVIDENCE_STALE'));
  assert.equal(result.courses[0].evidence.checksComplete, false);
});
