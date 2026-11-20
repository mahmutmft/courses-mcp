import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { RefreshJob } from '../src/refresh-jobs.js';
import { Moodle } from '../src/moodle.js';

async function fixture(t, overrides = {}) {
  const temp = await mkdtemp(join(tmpdir(), 'finki-refresh-'));
  t.after(async () => {
    assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
    assert.ok(basename(temp).startsWith('finki-refresh-'));
    await rm(temp, { recursive: true, force: true });
  });
  const config = { baseUrl: 'https://courses.finki.ukim.mk', username: 'synthetic', cacheSearchIndexes: true };
  const calls = [];
  const options = { root: join(temp, 'jobs'), authorize: async () => true,
    refresh: async (...args) => { calls.push(args); return { status: 'read' }; }, ...overrides };
  return { config, options, calls, job: new RefreshJob(config, options), temp };
}

test('bounded refresh checkpoints survive restart, cancel and resume without repeating completed courses', async t => {
  const { job, config, options, calls } = await fixture(t);
  assert.equal((await job.status()).state, 'empty');
  const selected = { courseIds: [1, 2, 1], documents: [{ courseId: 2, resourceId: 9 }] };
  assert.equal((await job.start(selected)).total, 2);
  assert.equal(calls.length, 0);
  await assert.rejects(job.start(selected), /REFRESH_JOB_EXISTS/);
  assert.equal((await job.advance()).processed, 1);
  const restarted = new RefreshJob(config, options);
  assert.equal((await restarted.advance('cancel')).state, 'cancelled');
  await assert.rejects(restarted.advance(), /REFRESH_JOB_CANCELLED/);
  assert.equal(calls.length, 1);
  const result = await restarted.advance('resume');
  assert.equal(result.state, 'complete');
  assert.equal(result.refreshed, 2);
  assert.deepEqual(calls, [[1, []], [2, [{ courseId: 2, resourceId: 9 }]]]);
  assert.deepEqual(await restarted.advance(), result);
  assert.equal(calls.length, 2);
  assert.equal((await restarted.start({ courseIds: [3] })).state, 'ready');
});

test('partial/deleted sources and safe failures stay visible as counts without persisting content', async t => {
  const { job } = await fixture(t, { refresh: async courseId => {
    if (courseId === 1) return { status: 'partial', text: 'PRIVATE_CONTENT' };
    throw new Error('PRIVATE_ERROR_TOKEN');
  } });
  await job.start({ courseIds: [1, 2] });
  assert.equal((await job.advance()).partial, 1);
  const result = await job.advance();
  assert.equal(result.state, 'complete');
  assert.equal(result.failed, 1);
  assert.equal(result.refreshed, 0);
  assert.deepEqual(result.warnings, ['REFRESH_PARTIAL_STEPS', 'REFRESH_FAILED_STEPS']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|courseIds|resourceId/);
  assert.doesNotMatch(await readFile(job.location(1), 'utf8'), /PRIVATE_/);
});

test('revocation and account switches cannot expose or advance a saved job', async t => {
  let allowed = true;
  const { job, config, options, calls } = await fixture(t, { authorize: async () => allowed });
  await job.start({ courseIds: [1] });
  allowed = false;
  await assert.rejects(job.status(), /REFRESH_ACCESS_UNAVAILABLE/);
  await assert.rejects(job.advance(), /REFRESH_ACCESS_UNAVAILABLE/);
  await assert.rejects(job.advance('cancel'), /REFRESH_ACCESS_UNAVAILABLE/);
  assert.equal(calls.length, 0);
  const other = new RefreshJob({ ...config, username: 'different' }, options);
  assert.equal((await other.status()).state, 'empty');
  allowed = true;
  assert.equal((await job.advance()).refreshed, 1);
});

test('concurrent advances preserve one checkpoint and reject the competing writer', async t => {
  let release, entered;
  const active = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const { job, config, options } = await fixture(t, { refresh: async () => {
    entered(); await gate; return { status: 'read' };
  } });
  await job.start({ courseIds: [1, 2] });
  const pending = job.advance();
  await active;
  try {
    await assert.rejects(new RefreshJob(config, options).advance(), /PREFERENCE_BUSY/);
    assert.equal((await job.status()).processed, 0);
  } finally { release(); await pending; }
  assert.equal((await job.status()).processed, 1);
});

test('invalid selections and corrupt checkpoints fail safely; interrupted locks require explicit recovery', async t => {
  const { job } = await fixture(t);
  for (const selection of [{ courseIds: [] }, { courseIds: [1], documents: [{ courseId: 2, resourceId: 3 }] },
    { courseIds: [1, 2, 3, 4, 5] }]) await assert.rejects(job.start(selection), /REFRESH_SELECTION_INVALID/);
  await job.start({ courseIds: [1] });
  const original = await readFile(job.location(1), 'utf8');
  await writeFile(job.location(1), original.replace('"schemaVersion":1', '"schemaVersion":99'));
  await assert.rejects(job.status(), /REFRESH_JOB_INVALID/);
  await writeFile(job.location(1), original);
  await writeFile(join(dirname(job.location(1)), '.account.lock'), 'interrupted-writer');
  await assert.rejects(job.advance(), /PREFERENCE_BUSY/);
  assert.equal((await job.status()).processed, 0);
});

test('Moodle refresh adapter requires opt-in and forces one selected-course rebuild per step', async t => {
  await assert.rejects(Moodle.prototype.courseRefresh.call({ config: {} }, 'status'), /REFRESH_CACHE_DISABLED/);
  const { config, temp } = await fixture(t);
  const key = process.platform === 'win32' ? 'LOCALAPPDATA' : 'XDG_DATA_HOME';
  const previous = process.env[key]; process.env[key] = temp;
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  const moodle = new Moodle(config);
  moodle.listCourses = async () => ({ courses: [{ id: 1 }] });
  const calls = [];
  moodle.searchCourses = async (...args) => {
    calls.push(args); return { status: 'read', coverage: [{ warnings: ['CACHE_WRITE_FAILED'] }] };
  };
  await moodle.courseRefresh('start', { courseIds: [1] });
  const result = await moodle.courseRefresh('next');
  assert.equal(result.partial, 1);
  assert.deepEqual(calls, [[[1], 'refresh', 1, [], true]]);
});
