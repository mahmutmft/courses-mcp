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

const revision = (...rows) => rows.map(row => row.replace('Lab change:', 'Lab revision:')).join('\n');
const groupB = 'Lab change: move | B | 2026-11-10 14:00 | 2026-11-13 16:00 | 300ab';

test('a revision replaces multiple slots and preserves separate group identities', () => {
  const result = resolveLabChanges(expansion, forum(revision(cancel, groupB)));
  assert.deepEqual(result.sessions.map(item => item.status), ['cancelled', 'moved']);
  assert.equal(result.sessions[1].replacement.id, 'b');
  assert.equal(result.sessions[1].replacement.date, '2026-11-13');
  assert.equal(result.sessions[1].replacement.room, '300ab');
  assert.equal(result.sessions[1].evidence[0].sourceUrl, 'https://example.test/post/0');
});

test('invalid, unmatched or duplicate revision rows leave the entire revision unapplied', () => {
  for (const badRow of [
    groupB.replace('2026-11-13', '2026-02-30'),
    groupB.replace(' | B |', ' | C |'),
    move,
  ]) {
    const result = resolveLabChanges(expansion, forum(revision(cancel, badRow)));
    assert.equal(result.status, 'partial');
    assert.deepEqual(result.sessions.map(item => item.status), ['timetable', 'timetable']);
    assert.ok(result.unresolved.some(item => item.reason === 'LAB_REVISION_NOT_APPLIED'));
  }
});

test('a separate conflicting announcement preserves both versions', () => {
  const result = resolveLabChanges(expansion, forum(revision(cancel, groupB), move));
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.sessions.map(item => item.status), ['conflict', 'moved']);
  assert.deepEqual(result.sessions[0].proposals.map(item => item.evidence.sourceUrl), [
    'https://example.test/post/0', 'https://example.test/post/1',
  ]);
});

test('semester-wide prose flags a revision without assigning a group or effective date', () => {
  const result = resolveLabChanges(expansion, forum(
    'Терминот од лабораторија 7 во вторник 14:00-15:00 се преместува во лабораторија 9 во вторник 16:00-17:00. Промената ќе важи за целиот семестар.',
  ));
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.sessions.map(item => item.status), ['timetable', 'timetable']);
  assert.equal(result.unresolved[0].statedScope, 'semester');
  assert.equal(result.unresolved[0].evidence.sourceUrl, 'https://example.test/post/0');
  const single = resolveLabChanges(expansion, forum('The lab was moved for one week.'));
  assert.equal(single.unresolved[0].statedScope, undefined);
});
