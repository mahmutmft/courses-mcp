import test from 'node:test';
import assert from 'node:assert/strict';
import { collectWeeklyLabs } from '../src/weekly-labs.js';
import { Moodle } from '../src/moodle.js';

test('remaining week includes the entire selected day, preserves uncertainty and undated work', async () => {
  const dates = ['2026-12-28', '2026-12-30', '2027-01-03', '2027-01-04'];
  const result = await collectWeeklyLabs({ courseIds: [1], weekStart: '2026-12-28', fromDate: '2026-12-30',
    readSchedule: async () => schedule('partial', dates.map(date => ({ date, startTime: '08:00',
      sources: [{ url: 'https://example.test/lab' }] }))) });
  assert.deepEqual(result.occurrences.map(item => item.date), ['2026-12-30', '2027-01-03']);
  assert.deepEqual(result.range, { from: '2026-12-30', through: '2027-01-03' });
  assert.equal(result.status, 'partial');
  assert.equal(result.courses[0].termLinkedHomework[0].date, null);
  assert.deepEqual(result.courses[0].warnings, ['ANNOUNCEMENTS_AND_CANCELLATIONS_UNCHECKED']);
});

test('remaining week validates dates before reads and handles DST Sunday without UTC drift', async () => {
  for (const fromDate of ['2026-03-22', '2026-03-30', '2026-02-30', 'today', null]) {
    await assert.rejects(collectWeeklyLabs({ courseIds: [1], weekStart: '2026-03-23', fromDate,
      readSchedule: () => assert.fail('unexpected read') }), /fromDate/);
  }
  const result = await collectWeeklyLabs({ courseIds: [1], weekStart: '2026-03-23', fromDate: '2026-03-29',
    readSchedule: async () => schedule('partial', [{ date: '2026-03-28' }, { date: '2026-03-29', endTime: null }]) });
  assert.deepEqual(result.range, { from: '2026-03-29', through: '2026-03-29' });
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0].endTime, null);
});

test('Moodle weekly adapter forwards the selected remaining-week date after authorization', async () => {
  const calls = [];
  const result = await Moodle.prototype.getWeeklyLabs.call({
    listCourses: async () => ({ courses: [{ id: 1 }] }),
    getLabSchedule: async (...args) => { calls.push(args); return schedule('unknown'); },
  }, [1], '2026-12-28', '2027-01-01');
  assert.deepEqual(calls, [[1, '2026-12-28']]);
  assert.equal(result.range.from, '2027-01-01');
  assert.equal(result.status, 'partial');
});

const weekStart = '2026-12-28';
const checkedAt = '2026-12-27T12:00:00Z';
const schedule = (status, datedOccurrences = []) => ({ status, checkedAt,
  warnings: ['ANNOUNCEMENTS_AND_CANCELLATIONS_UNCHECKED'], datedOccurrences,
  termLinkedHomework: [{ date: null, name: 'Undated homework' }] });

test('weekly overview retains mixed evidence, exemptions and failed course uncertainty', async () => {
  const calls = [];
  const result = await collectWeeklyLabs({ courseIds: [1, 2, 3, 1], weekStart,
    readSchedule: async id => {
      calls.push(id);
      if (id === 3) throw new Error('private upstream data');
      return schedule(id === 2 ? 'exempt' : 'partial',
        id === 1 ? [{ date: '2027-01-02', startTime: '14:00', sources: [{ url: 'https://example.test/lab' }] }] : []);
    } });
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(result.weekEnd, '2027-01-03');
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.courses.map(course => course.status), ['partial', 'exempt', 'unknown']);
  assert.equal(result.occurrences[0].checkedAt, checkedAt);
  assert.equal(result.occurrences[0].courseId, 1);
  assert.equal(result.courses[0].termLinkedHomework[0].date, null);
  assert.doesNotMatch(JSON.stringify(result), /private upstream data/);
});

test('empty evidence remains partial and all explicit exemptions are separate', async () => {
  for (const status of ['unknown', 'exempt']) {
    const result = await collectWeeklyLabs({ courseIds: [1], weekStart: '2026-03-23',
      readSchedule: async () => schedule(status) });
    assert.equal(result.weekEnd, '2026-03-29');
    assert.equal(result.status, status === 'exempt' ? 'exempt' : 'partial');
    assert.deepEqual(result.occurrences, []);
  }
});

test('invalid ranges and revoked enrollment stop before reading schedules', async () => {
  await assert.rejects(collectWeeklyLabs({ courseIds: [1], weekStart: '2026-12-29',
    readSchedule: () => assert.fail('unexpected read') }), /valid Monday/);
  await assert.rejects(Moodle.prototype.getWeeklyLabs.call({
    listCourses: async () => ({ courses: [{ id: 1 }] }),
    getLabSchedule: () => assert.fail('unexpected read'),
  }, [1, 2], weekStart), /not in your enrolled/);
});
