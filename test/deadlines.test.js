import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectDeadlines } from '../src/deadlines.js';
import { Moodle } from '../src/moodle.js';

const range = { from: '2026-11-12', through: '2026-11-19' };
const resource = (id, kind = 'assign') => ({ url: 'https://courses.finki.ukim.mk/mod/' + kind + '/view.php?id=' + id });
const discovery = (id, resources, partial = false) => ({ id, sections: [{ resources }], coverage: { partial } });
const local = day => ({ localDateTime: day + 'T14:00:00', timeZone: null, instant: null });

test('published dates use inclusive calendar bounds and retain unknown fields and provenance', async () => {
  const assignment = resource(1);
  const quiz = resource(2, 'quiz');
  const result = await collectDeadlines({
    courseIds: [7, 8], range,
    discover: async id => discovery(id, id === 7 ? [assignment, assignment] : [quiz], id === 8),
    read: async ({ kind, sourceUrl }) => ({
      name: kind, sourceUrl, checkedAt: '2026-11-12T10:00:00Z', warnings: [],
      dates: kind === 'assign' ? { opened: local('2026-11-11'), due: local(range.from), cutoff: null }
        : { closes: local(range.through) },
    }),
  });
  assert.deepEqual(result.deadlines.map(item => item.field), ['due', 'closes']);
  assert.equal(result.deadlines[0].date.timeZone, null);
  assert.equal(result.deadlines[0].sourceUrl, assignment.url);
  assert.equal(result.deadlines[0].checkedAt, '2026-11-12T10:00:00Z');
  assert.equal(result.unavailable[0].field, 'cutoff');
  assert.equal(result.coverage.attempted, 2);
  assert.equal(result.status, 'partial');
});

test('limits reads fairly across courses and reports failures without raw details', async () => {
  const attempted = [];
  const result = await collectDeadlines({
    courseIds: [7, 8], range,
    discover: async id => discovery(id, Array.from({ length: 30 }, (_, i) => resource(100 * id + i))),
    read: async ({ course }) => { attempted.push(course.id); throw new Error('private upstream details'); },
  });
  assert.deepEqual(attempted.slice(0, 4), [7, 8, 7, 8]);
  assert.equal(attempted.length, 24);
  assert.ok(result.coverage.warnings.includes('DEADLINE_ACTIVITY_LIMIT'));
  assert.doesNotMatch(JSON.stringify(result), /private upstream details/);
});

test('expiry skips remaining discoveries and reads', async () => {
  let now = 0;
  const result = await collectDeadlines({
    courseIds: [7, 8], range, clock: () => now,
    discover: async id => { now += 45_000; return discovery(id, [resource(1)]); },
    read: () => assert.fail('read after expiry'),
  });
  assert.equal(result.coverage.courses[1].status, 'skipped');
  assert.equal(result.coverage.attempted, 0);
});

test('unenrolled selection stops before discovery', async () => {
  let calls = 0;
  await assert.rejects(Moodle.prototype.getCourseworkDeadlines.call({
    listCourses: async () => { calls++; return { courses: [{ id: 7 }] }; },
  }, [7, 8], range), /not in your enrolled/);
  assert.equal(calls, 1);
});
