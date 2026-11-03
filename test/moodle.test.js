import test from 'node:test';
import assert from 'node:assert/strict';
import { Moodle } from '../src/moodle.js';
import { UserError } from '../src/config.js';

test('enrolled-course pagination collects every API page', async () => {
  const moodle = new Moodle({});
  moodle.login = async () => {};
  moodle.page = { goto: async () => {} };
  moodle.isAuthenticated = async () => true;
  const offsets = [];
  moodle.ajax = async (name, args) => {
    assert.equal(name, 'core_course_get_enrolled_courses_by_timeline_classification');
    offsets.push(args.offset);
    return args.offset === 0 ? { courses: [{ id: 10, fullname: 'One' }], nextoffset: 1 }
      : { courses: [{ id: 11, fullname: 'Two' }], nextoffset: 0 };
  };
  const result = await moodle.listCourses();
  assert.deepEqual(offsets, [0, 1]);
  assert.deepEqual(result.courses.map(course => course.id), [10, 11]);
  assert.equal(result.truncated, false);
});

test('unenrolled course IDs are rejected before navigating to a course', async () => {
  const moodle = new Moodle({});
  moodle.listCourses = async () => ({ courses: [{ id: 10 }] });
  moodle.page = { goto: () => assert.fail('must not navigate') };
  await assert.rejects(moodle.getCourse(11), UserError);
});

test('expired sessions stop before AJAX calls', async () => {
  const moodle = new Moodle({});
  moodle.login = async () => {};
  moodle.page = { goto: async () => {} };
  moodle.isAuthenticated = async () => false;
  moodle.ajax = () => assert.fail('must not call API');
  await assert.rejects(moodle.listCourses(), /session expired/);
});

test('shared browser operations serialize and recover after an operation fails', async () => {
  const moodle = new Moodle({});
  const events = [];
  const first = moodle.run(async () => { events.push(1); throw new UserError('Expected'); });
  const second = moodle.run(async () => { events.push(2); return 3; });
  await assert.rejects(first, /Expected/);
  assert.equal(await second, 3);
  assert.deepEqual(events, [1, 2]);
});
