import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveLabChanges } from '../src/scheduling/lab-changes.js';

const occurrence = { id: 'a', group: 'A', date: '2026-11-10', startTime: '14:00', timeZone: 'Europe/Skopje' };
const expansion = { range: { from: '2026-11-09', through: '2026-11-15' }, occurrences: [occurrence, { ...occurrence, id: 'b', group: 'B' }], unresolved: [] };
const cancel = 'Lab change: cancel | A | 2026-11-10 14:00';
const move = 'Lab change: move | A | 2026-11-10 14:00 | 2026-11-12 15:00 | 200ab';
const forum = (...lines) => ({
  status: 'read', posts: lines.map((text, index) => ({
    text, warnings: [], sourceUrl: 'https://example.test/post/' + index,
    publishedAt: '2026-11-09T12:00:00Z', checkedAt: '2026-11-09T13:00:00Z',
  })),
});

test('one-group cancellation leaves the other group and unrelated announcements alone', () => {
  const result = resolveLabChanges(expansion, forum(cancel, 'The project deadline was moved.'));
  assert.deepEqual(result.sessions.map(item => item.status), ['cancelled', 'timetable']);
  assert.equal(result.sessions[0].evidence[0].publishedAt, '2026-11-09T12:00:00Z');
});

test('identical moves produce one replacement for the original with both citations', () => {
  const { sessions } = resolveLabChanges(expansion, forum(move, move));
  const moved = sessions[0];
  assert.equal(moved.status, 'moved');
  assert.equal(moved.original, occurrence);
  assert.deepEqual(moved.replacement, { ...occurrence, date: '2026-11-12', startTime: '15:00', endTime: null, room: '200ab' });
  assert.equal(moved.evidence.length, 2);
});

test('conflicting updates and nonunique originals remain unresolved', () => {
  const result = resolveLabChanges(expansion, forum(cancel, move));
  assert.equal(result.status, 'partial');
  assert.equal(result.sessions[0].status, 'conflict');
  const ambiguous = resolveLabChanges({ ...expansion, occurrences: [occurrence, { ...occurrence, id: 'x' }] }, forum(cancel));
  assert.equal(ambiguous.unresolved[0].reason, 'ORIGINAL_OCCURRENCE_NOT_UNIQUE');
});

test('failed or incomplete refresh preserves candidates with partial status', () => {
  assert.equal(resolveLabChanges(expansion, null).status, 'partial');
  const malformed = resolveLabChanges(expansion, forum('Lab change: cancel | A | 2026-02-30 14:00'));
  assert.equal(malformed.status, 'partial');
  assert.equal(malformed.sessions[0].status, 'timetable');
});

test('unstructured lab changes retain evidence without altering timetable candidates', () => {
  const result = resolveLabChanges(expansion, forum(
    'Laboratory exercises were moved to Thursday.',
    'Лабораториските се одложени.',
    'The project deadline was moved.',
  ));
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.sessions.map(item => item.status), ['timetable', 'timetable']);
  assert.equal(result.unresolved.length, 2);
  assert.equal(result.unresolved[0].reason, 'POSSIBLE_UNSTRUCTURED_LAB_CHANGE');
  assert.equal(result.unresolved[0].evidence.sourceUrl, 'https://example.test/post/0');
});
