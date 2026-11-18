import { Moodle } from '../src/moodle.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CourseCache } from '../src/course-cache.js';

test('cache is opt-in, account scoped and rechecks access on every read', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'finki-cache-'));
  t.after(() => rm(temp, { recursive: true }));
  const root = join(temp, 'cache');
  const config = { baseUrl: 'https://courses.finki.ukim.mk', username: 'synthetic' };
  let allowed = true;
  let now = '2026-11-01T00:00:00.000Z';
  const options = { root, enabled: true, now: () => now, authorize: async () => allowed };
  const store = new CourseCache(config, options);
  const input = { content: 'example', index: 'example-index' };
  assert.equal(await new CourseCache(config, { root }).set(1, input), null);
  await store.set(1, input);
  assert.equal((await store.get(1)).content, input.content);
  assert.equal(await new CourseCache({ ...config, username: 'different' }, options).get(1), null);
  allowed = false;
  assert.equal(await store.get(1), null);
  assert.equal(await store.inspect(1), null);
  assert.equal(await store.set(1, { content: 'replacement', index: '' }), null);
  await store.delete(1);
  const offline = new CourseCache(config, { ...options, authorize: async () => { throw new Error('private detail'); } });
  for (const operation of [() => offline.get(1), () => offline.set(1, input), () => offline.inspect(1), () => offline.delete(1)]) {
    await assert.rejects(operation, { message: 'Course cache access could not be verified (CACHE_AUTHORIZATION_UNAVAILABLE).' });
  }
  allowed = true;
  assert.equal((await store.get(1)).content, input.content);
  assert.deepEqual(Object.keys(await store.inspect(1)), ['updatedAt', 'bytes']);
  now = '2026-11-08T00:00:00.000Z';
  assert.equal(await store.get(1), null);
  await store.delete(1);
  assert.equal(await store.inspect(1), null);
});

test('cache refuses busy writes, corrupted records and linked directories', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'finki-cache-'));
  t.after(() => rm(temp, { recursive: true }));
  const config = { baseUrl: 'https://courses.finki.ukim.mk', username: 'synthetic' };
  const options = { root: join(temp, 'cache'), enabled: true, authorize: async () => true };
  const store = new CourseCache(config, options);
  const input = { content: 'example', index: '' };
  await store.set(1, input);
  const path = store.location(1);
  await writeFile(join(dirname(path), '.account.lock'), '');
  await assert.rejects(store.set(1, input), /PREFERENCE_BUSY/);
  assert.equal((await store.get(1)).content, input.content);
  await writeFile(path, '{"schemaVersion":99}');
  await assert.rejects(store.get(1), /CACHE_INVALID_RECORD/);
  await unlink(join(dirname(path), '.account.lock'));
  await store.delete(1);
  assert.equal(await store.inspect(1), null);
  const alias = join(temp, 'alias');
  await symlink(options.root, alias, 'junction');
  await assert.rejects(new CourseCache(config, { ...options, root: alias }).get(1), /UNSAFE_STORAGE_DIRECTORY/);
});

test('account quota allows replacements and reuses a slot after deletion', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'finki-cache-'));
  t.after(() => rm(temp, { recursive: true }));
  const store = new CourseCache({ baseUrl: 'https://courses.finki.ukim.mk', username: 'fixture' }, {
    root: join(temp, 'cache'), enabled: true, authorize: async () => true,
  });
  const record = { content: 'text', index: '' };
  for (let id = 1; id <= 32; id++) await store.set(id, record);
  await assert.rejects(store.set(33, record), /CACHE_ACCOUNT_LIMIT/);
  await store.set(1, { ...record, content: 'updated' });
  assert.equal((await store.get(1)).content, 'updated');
  await store.delete(2);
  await store.set(33, record);
  assert.equal((await store.get(33)).content, 'text');
});


test('Moodle cache management verifies enrollment and permits cleanup with caching off', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'finki-cache-management-'));
  t.after(() => rm(temp, { recursive: true }));
  const key = process.platform === 'win32' ? 'LOCALAPPDATA' : 'XDG_DATA_HOME';
  const previous = process.env[key];
  process.env[key] = temp;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
  const config = { baseUrl: 'https://courses.finki.ukim.mk', username: 'fixture', cacheSearchIndexes: false };
  const store = new CourseCache(config, { enabled: true, authorize: async () => true });
  await store.set(42, { content: 'private content', index: 'private index' });
  const moodle = new Moodle(config);
  let enrolled = true;
  moodle.listCourses = async () => ({ courses: enrolled ? [{ id: 42 }] : [] });
  const inspected = await moodle.manageCourseCache(42);
  assert.equal(inspected.status, 'stored');
  assert.equal(inspected.enabled, false);
  assert.ok(inspected.record.bytes > 0);
  assert.doesNotMatch(JSON.stringify(inspected), /private content|private index|AppData/);
  enrolled = false;
  await assert.rejects(moodle.manageCourseCache(42, true), /not in your enrolled/);
  assert.ok(await store.get(42));
  enrolled = true;
  assert.equal((await moodle.manageCourseCache(42, true)).status, 'cleared');
  assert.equal((await moodle.manageCourseCache(42)).status, 'empty');
  assert.equal((await moodle.manageCourseCache(42, true)).status, 'cleared');
});
