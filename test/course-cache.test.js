import { Moodle } from '../src/moodle.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, symlink, unlink, readFile, readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { CourseCache } from '../src/course-cache.js';

async function lifecycleFixture(t, extra = {}) {
  const temp = await mkdtemp(join(tmpdir(), 'finki-cache-lifecycle-'));
  t.after(async () => {
    const target = resolve(temp);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('finki-cache-lifecycle-'));
    await rm(target, { recursive: true, force: true });
  });
  const config = { baseUrl: 'https://courses.finki.ukim.mk', username: 'crash-fixture', password: 'NOT_PERSISTED' };
  const options = { root: join(temp, 'cache'), enabled: true, authorize: async () => true, ...extra };
  return { config, options, store: new CourseCache(config, options) };
}

test('cache freshness survives restart and rejects expired, future and unverifiable clock reads', async t => {
  let now = '2026-11-01T00:00:00.000Z';
  const { config, options, store } = await lifecycleFixture(t, { now: () => now });
  await store.set(1, { content: 'synthetic-content', index: 'synthetic-index' });
  const restarted = new CourseCache(config, options);
  for (const [clock, expected] of [
    ['2026-11-07T23:59:59.999Z', 'fresh'], ['2026-11-08T00:00:00.000Z', 'expired'],
    ['2026-10-31T23:59:59.999Z', 'future'], ['invalid', 'unknown'],
  ]) {
    now = clock;
    assert.equal((await restarted.inspect(1)).freshness, expected);
    assert.equal((await restarted.get(1)) !== null, expected === 'fresh');
    assert.doesNotMatch(JSON.stringify(await restarted.inspect(1)), /synthetic-content|synthetic-index/);
  }
  await restarted.delete(1);
  assert.equal(await restarted.inspect(1), null);
});

test('account snapshot, institution separation and password changes preserve isolation', async t => {
  const { config, options, store } = await lifecycleFixture(t);
  await store.set(1, { content: 'synthetic-content', index: 'synthetic-index' });
  const original = { ...config };
  config.username = 'switched-account';
  assert.ok(await store.get(1)); // Caller mutation cannot retarget an existing store.
  for (const identity of [config, { ...original, baseUrl: 'https://other.example' }]) {
    const other = new CourseCache(identity, options);
    assert.notEqual(other.location(1), store.location(1));
    assert.equal(await other.get(1), null);
    await other.delete(1);
    assert.ok(await store.get(1));
  }
  assert.ok(await new CourseCache({ ...original, password: 'CHANGED' }, options).get(1));
  const raw = await readFile(store.location(1), 'utf8');
  assert.doesNotMatch(raw, /NOT_PERSISTED|crash-fixture|courses.finki/);
  if (process.platform !== 'win32') {
    assert.equal((await stat(store.location(1))).mode & 0o777, 0o600);
    assert.equal((await stat(dirname(store.location(1)))).mode & 0o777, 0o700);
  }
});

test('competing cache writers cannot exceed the final account quota slot', async t => {
  const { config, options, store } = await lifecycleFixture(t);
  const input = { content: 'synthetic', index: '' };
  for (let id = 1; id <= 31; id++) await store.set(id, input);
  const results = await Promise.allSettled([store.set(32, input), new CourseCache(config, options).set(33, input)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failure = results.find(result => result.status === 'rejected');
  assert.match(failure.reason.message, /PREFERENCE_BUSY|CACHE_ACCOUNT_LIMIT/);
  const files = await readdir(dirname(store.location(1)));
  assert.equal(files.filter(name => /^\d+\.json$/.test(name)).length, 32);
  assert.ok(!files.includes('.account.lock'));
});

test('interrupted writer preserves the previous snapshot and leaves a recoverable lock', async t => {
  const { options, store } = await lifecycleFixture(t);
  await store.set(1, { content: 'original', index: 'original-index' });
  const script = `
    import { CourseCache } from ${JSON.stringify(new URL('../src/course-cache.js', import.meta.url).href)};
    const store = new CourseCache({ baseUrl: 'https://courses.finki.ukim.mk', username: 'crash-fixture' }, {
      root: process.env.CACHE_TEST_ROOT, enabled: true, authorize: async () => true,
    });
    await store.update(1, async () => {
      process.send('locked');
      await new Promise(() => { setInterval(() => {}, 1000); });
    }, { accountLock: true });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, CACHE_TEST_ROOT: options.root }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; });
  const [message] = await once(child, 'message', { signal: AbortSignal.timeout(10000) });
  assert.equal(message, 'locked');
  child.kill();
  await exited;
  assert.equal((await store.get(1)).content, 'original');
  await assert.rejects(store.set(1, { content: 'replacement', index: '' }), /PREFERENCE_BUSY/);
  // Explicit manual recovery after all writers stopped; production does not steal locks.
  await unlink(join(dirname(store.location(1)), '.account.lock'));
  await store.set(1, { content: 'replacement', index: '' });
  assert.equal((await store.get(1)).content, 'replacement');
  assert.deepEqual(await readdir(dirname(store.location(1))), ['1.json']);
});

test('oversized replacements and invalid timestamp formats preserve the previous record', async t => {
  const { store } = await lifecycleFixture(t);
  await store.set(1, { content: 'original', index: '' });
  await assert.rejects(store.set(1, { content: 'x'.repeat(1024 * 1024), index: '' }), /CACHE_INVALID_RECORD/);
  assert.equal((await store.get(1)).content, 'original');
  assert.deepEqual(await readdir(dirname(store.location(1))), ['1.json']);
  const raw = JSON.parse(await readFile(store.location(1), 'utf8'));
  raw.updatedAt = '2026-11-01';
  await writeFile(store.location(1), JSON.stringify(raw));
  await assert.rejects(store.get(1), /CACHE_INVALID_RECORD/);
  await store.delete(1); // Malformed records can still be discarded explicitly.
  assert.equal(await store.inspect(1), null);
});

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
  assert.deepEqual(Object.keys(await store.inspect(1)), ['updatedAt', 'bytes', 'freshness']);
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
  assert.equal(inspected.record.freshness, 'fresh');
  assert.doesNotMatch(JSON.stringify(inspected), /private content|private index|AppData/);
  enrolled = false;
  await assert.rejects(moodle.manageCourseCache(42, true), /not in your enrolled/);
  assert.ok(await store.get(42));
  enrolled = true;
  assert.equal((await moodle.manageCourseCache(42, true)).status, 'cleared');
  assert.equal((await moodle.manageCourseCache(42)).status, 'empty');
  assert.equal((await moodle.manageCourseCache(42, true)).status, 'cleared');
});
