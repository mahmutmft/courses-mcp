import test from 'node:test';
import assert from 'node:assert/strict';
import { collectLabCalendar } from '../src/lab-calendar.js';
import { Moodle } from '../src/moodle.js';

const checkedAt = '2026-11-23T12:00:00.000Z';
const now = () => Date.parse(checkedAt);
const candidate = { id: 'stable-original', courseId: 1, date: '2026-11-24', startTime: '14:00', endTime: null,
  room: '2', group: 'A', timeZone: 'Europe/Skopje', sources: [{ url: 'https://example.test/table', checkedAt }], checkedAt };
const week = (occurrences = [candidate], sessions = []) => ({ answerState: 'scheduled', occurrences,
  courses: [{ courseId: 1, answerState: 'scheduled', checkedAt, warnings: [], evidence: {
    checkedAt, timetableCheckedAt: checkedAt, sessions,
  } }] });
const collect = (readWeek, range = { from: '2026-11-23', through: '2026-11-29' }) => collectLabCalendar({ range, readWeek, now });

test('week projection retains missing end time, original timezone/source and stable IDs', async () => {
  const a = await collect(async () => week());
  const b = await collect(async () => week());
  assert.deepEqual(a, b);
  assert.equal(a.events[0].endTime, null);
  assert.equal(a.events[0].timeZone, candidate.timeZone);
  assert.equal(a.events[0].sources[0].url, candidate.sources[0].url);
  assert.equal(a.events[0].checkedAt, checkedAt);
  assert.equal(a.status, 'read');
});

test('month projection reads at most six Monday weeks and deduplicates repeated snapshots', async () => {
  const starts = [];
  const moved = { ...candidate, date: '2026-08-02', status: 'moved' };
  const result = await collect(async start => { starts.push(start); return week([moved]); },
    { from: '2026-08-01', through: '2026-08-31' });
  assert.equal(starts.length, 6);
  assert.equal(starts[0], '2026-07-27');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].sources.length, 1);
});

test('moved/cancelled sessions retain originals and do not duplicate matching title candidates', async () => {
  const moved = { ...candidate, date: '2026-11-26', status: 'moved' };
  const cancelled = { ...candidate, id: 'cancelled', date: '2026-11-27' };
  const session = { status: 'moved', original: candidate, replacement: moved,
    evidence: [{ sourceUrl: 'https://example.test/change', checkedAt }] };
  const title = { ...moved }; delete title.id;
  const result = await collect(async () => week([title], [session, { status: 'cancelled', original: cancelled, evidence: [] }]));
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events.map(event => event.status), ['moved', 'cancelled']);
  assert.equal(result.events[0].original.date, '2026-11-24');
  assert.equal(result.events[0].changeEvidence.length, 1);
});

test('collisions and changed refresh snapshots preserve uncertainty instead of silent replacement', async () => {
  const sameTime = { ...candidate, id: 'other-course', courseId: 2 };
  const collided = await collect(async () => ({ ...week([candidate, sameTime]), courses: [week().courses[0], { ...week().courses[0], courseId: 2 }] }));
  assert.ok(collided.events.every(event => event.collidesWith.length === 1 && event.uncertain));
  assert.equal(collided.status, 'partial');
  let index = 0;
  const changed = await collect(async () => week([{ ...candidate, startTime: index++ ? '15:00' : '14:00' }]),
    { from: '2026-11-23', through: '2026-12-01' });
  assert.equal(changed.events.length, 1);
  assert.equal(changed.events[0].status, 'conflict');
  assert.equal(changed.events[0].proposals.length, 2);
});

test('DST/year boundaries keep civil dates without UTC conversion or invented timezones', async () => {
  for (const range of [{ from: '2026-03-29', through: '2026-03-29' }, { from: '2026-12-31', through: '2027-01-01' }]) {
    const result = await collect(async () => week([{ ...candidate, date: range.through, timeZone: null }]), range);
    assert.equal(result.events[0].date, range.through);
    assert.equal(result.events[0].startTime, '14:00');
    assert.equal(result.events[0].timeZone, null);
    assert.equal(result.status, 'partial');
  }
});

test('maximum four-digit year cannot turn the week loop into an unbounded lexical comparison', async () => {
  let calls = 0;
  const result = await collect(async () => { calls++; return week([]); }, { from: '9999-12-25', through: '9999-12-31' });
  assert.equal(calls, 2);
  assert.equal(result.weeks.length, 2);
});

test('failed week stops subsequent reads, while old evidence stays partial at return time', async () => {
  let calls = 0;
  const result = await collect(async () => { calls++; throw new Error('PRIVATE_UPSTREAM'); },
    { from: '2026-11-01', through: '2026-11-30' });
  assert.equal(calls, 1);
  assert.equal(result.status, 'partial');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_UPSTREAM/);
  const stale = await collectLabCalendar({ range: { from: '2026-11-23', through: '2026-11-29' },
    now: () => now() + 300001, readWeek: async () => week() });
  assert.equal(stale.events[0].uncertain, true);
  assert.equal(stale.weeks[0].answerState, 'unknown');
});

test('calendar adapter shares only request-local source reads and rechecks final enrollment', async () => {
  const calls = [];
  let enrolled = true;
  const fake = { listCourses: async () => ({ courses: enrolled ? [{ id: 1 }] : [] }),
    getLabTimetable: async () => { calls.push('table'); return {}; },
    getAnnouncements: async () => { calls.push('forum'); return {}; },
    getWeeklyLabs: async (ids, start, from, evidence, readEvidence) => {
      await readEvidence(evidence[0]); return week([]);
    } };
  const range = { from: '2026-11-23', through: '2026-12-01' };
  await Moodle.prototype.getLabCalendar.call(fake, [1], range, [{ courseId: 1, resourceId: 7, forumId: 8 }]);
  assert.deepEqual(calls, ['table', 'forum']);
  fake.getWeeklyLabs = async () => { enrolled = false; return week(); };
  await assert.rejects(Moodle.prototype.getLabCalendar.call(fake, [1], range), /not in your enrolled/);
  await assert.rejects(collect(async () => week(), { from: '2026-11-01', through: '2026-12-02' }), /1 to 31/);
});
