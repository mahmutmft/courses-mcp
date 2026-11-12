import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandLabOccurrences, isOccurrenceRange } from '../src/scheduling/occurrences.ts';
import { extractTimetable } from '../src/timetables.js';

function entries(text) {
  return extractTimetable({
    courseId: 1, resourceId: 2, sourceUrl: 'https://courses.example/mod/page/view.php?id=2',
    format: 'html', status: 'read', text,
  }).entries;
}

const slot = 'Group: A | Day: Sunday | Time: 14:00 | Timezone: Europe/Skopje';
const weekly = slot + ' | From: 2026-03-22 | Until: 2026-04-05 | Recurrence: weekly';

test('weekly expansion clips both bounds and keeps local time through Skopje DST', () => {
  const { occurrences, unresolved } = expandLabOccurrences(entries(weekly), { from: '2026-03-15', through: '2026-04-12' });
  assert.deepEqual(occurrences.map(item => [item.date, item.startTime, item.endTime]), [
    ['2026-03-22', '14:00', null], ['2026-03-29', '14:00', null], ['2026-04-05', '14:00', null],
  ]);
  assert.deepEqual(unresolved, []);
  assert.equal(expandLabOccurrences(entries(weekly), { from: '2026-04-06', through: '2026-04-12' }).occurrences.length, 0);
});

test('alternating Monday-start weeks preserve parity across New Year', () => {
  const text = slot + ' | From: 2026-12-21 | Until: 2027-01-20 | Recurrence: alternating';
  const range = { from: '2026-12-21', through: '2027-01-20' };
  const result = expandLabOccurrences(entries(text + ' | Anchor: 2026-12-23'), range);
  assert.deepEqual(result.occurrences.map(item => item.date), ['2026-12-27', '2027-01-10']);
  for (const anchor of ['', ' | Anchor: 2026-12-16']) {
    const unknown = expandLabOccurrences(entries(text + anchor), range);
    assert.equal(unknown.occurrences.length, 0);
    assert.equal(unknown.unresolved.length, 1);
  }
});

test('explicit dates deduplicate with stable IDs and preserve source rows', () => {
  const line = slot + ' | Dates: 2026-03-29, 2026-04-05';
  const range = { from: '2026-03-29', through: '2026-03-29' };
  const { occurrences } = expandLabOccurrences(entries(line + '\n' + line), range);
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].sources.length, 2);
  const [single] = expandLabOccurrences(entries(line), range).occurrences;
  assert.equal(single.id, occurrences[0].id);
});

test('missing timezone and invalid or excessive ranges fail closed', () => {
  const range = { from: '2026-03-15', through: '2026-04-12' };
  const result = expandLabOccurrences(entries(weekly.replace(' | Timezone: Europe/Skopje', '')), range);
  assert.equal(result.occurrences.length, 0);
  assert.equal(result.unresolved.length, 1);
  for (const bad of [
    { from: '2026-02-30', through: '2026-03-04' },
    { from: '2026-03-01', through: '2026-04-01' },
    { from: '2026-03-02', through: '2026-03-01' },
  ]) {
    assert.equal(isOccurrenceRange(bad), false);
    assert.throws(() => expandLabOccurrences([], bad), RangeError);
  }
});
