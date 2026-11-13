import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  assert.deepEqual(Object.keys(await store.inspect(1)), ['updatedAt', 'bytes']);
  allowed = true;
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
  await writeFile(path + '.lock', '');
  await assert.rejects(store.set(1, input), /PREFERENCE_BUSY/);
  assert.equal((await store.get(1)).content, input.content);
  await writeFile(path, '{"schemaVersion":99}');
  await assert.rejects(store.get(1), /CACHE_INVALID_RECORD/);
  const alias = join(temp, 'alias');
  await symlink(options.root, alias, 'junction');
  await assert.rejects(new CourseCache(config, { ...options, root: alias }).get(1), /UNSAFE_STORAGE_DIRECTORY/);
});
