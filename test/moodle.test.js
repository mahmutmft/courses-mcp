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

test('nonadvancing dashboard cursor reports partial enrollment coverage', async () => {
  const moodle = new Moodle({});
  moodle.login = async () => {};
  moodle.page = { goto: async () => {} };
  moodle.isAuthenticated = async () => true;
  const offsets = [];
  moodle.ajax = async (_, { offset }) => {
    offsets.push(offset);
    return { courses: [{ id: offset + 10, fullname: 'Synthetic' }], nextoffset: 1 };
  };
  const result = await moodle.listCourses();
  assert.deepEqual(offsets, [0, 1]);
  assert.equal(result.truncated, true);
});

test('dashboard streams bounded JSON and cancels an oversized body', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('[{"data":{"courses":[]}}]'));
  const moodle = new Moodle({});
  const previous = globalThis.M;
  globalThis.M = { cfg: { sesskey: 'synthetic' } };
  t.after(() => { if (previous === undefined) delete globalThis.M; else globalThis.M = previous; });
  moodle.page = { evaluate: (fn, args) => fn(args) };
  assert.deepEqual(await moodle.ajax('fixture', {}), { courses: [] });

  let cancelled = false;
  globalThis.fetch.mock.mockImplementation(async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  })));
  await assert.rejects(moodle.ajax('fixture', {}), /COURSE_API_SIZE_LIMIT/);
  assert.equal(cancelled, true);

  globalThis.fetch.mock.mockImplementation(async () => new Response('<html>synthetic private text</html>'));
  await assert.rejects(moodle.ajax('fixture', {}), { message: /COURSE_API_FORMAT/ });
});
