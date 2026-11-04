import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LabPreferences, defaultPreferenceRoot } from '../src/preferences.js';
import { Moodle } from '../src/moodle.js';

const config = { baseUrl: 'https://courses.finki.ukim.mk', username: 'fixture-account', password: 'not-stored' };
const timestamp = '2026-01-02T10:00:00.000Z';
async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'finki-pref-test-'));
  t.after(async () => {
    const target = resolve(root);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('finki-pref-test-')) throw Error('Invalid test cleanup target');
    await rm(target, { recursive: true, force: true });
  });
  return root;
}

test('unset is unknown, explicit attendance persists across instances and reset removes record', async t => {
  const root = await temporary(t);
  const store = new LabPreferences(config, { root, now: () => timestamp });
  const unset = await store.get(42);
  assert.equal(unset.attendance, 'unknown');
  assert.equal(unset.source, 'unset');
  assert.equal(unset.excludeFromLabObligations, false);
  const saved = await store.set(42, 'exempt');
  assert.equal(saved.excludeFromLabObligations, true);
  assert.equal(saved.source, 'user_declared');
  const restarted = new LabPreferences(config, { root });
  assert.deepEqual(await restarted.get(42), saved);
  assert.deepEqual(await restarted.set(42, 'exempt'), saved); // No timestamp churn.
  const raw = await readFile(store.location(42), 'utf8');
  assert.ok(!raw.includes(config.username) && !raw.includes(config.password) && !raw.includes(config.baseUrl));
  const reset = await store.set(42, 'unknown');
  assert.equal(reset.attendance, 'unknown');
  assert.equal(reset.updatedAt, null);
  assert.equal(reset.source, 'unset');
  assert.equal((await readdir(dirname(store.location(42)))).length, 0);
  assert.equal((await store.set(42, 'attending')).excludeFromLabObligations, false);
});

test('account/institution/course namespaces are separate and password changes preserve preferences', async t => {
  const root = await temporary(t);
  const first = new LabPreferences(config, { root });
  await first.set(42, 'exempt');
  assert.equal((await first.get(43)).attendance, 'unknown');
  for (const change of [{ username: 'another-account' }, { baseUrl: 'https://another.example' }]) {
    const second = new LabPreferences({ ...config, ...change }, { root });
    assert.equal((await second.get(42)).attendance, 'unknown');
    assert.notEqual(second.location(42), first.location(42));
  }
  assert.equal((await new LabPreferences({ ...config, password: 'changed' }, { root }).get(42)).attendance, 'exempt');
});

test('invalid input, missing identity and repository-local storage fail without writes', async t => {
  const root = await temporary(t);
  const store = new LabPreferences(config, { root });
  await assert.rejects(store.set(42, 'automatic'), e => e.code === 'INVALID_ATTENDANCE');
  await assert.rejects(store.get(-1), e => e.code === 'INVALID_COURSE_ID');
  await assert.rejects(new LabPreferences({}, { root }).get(42), e => e.code === 'ACCOUNT_REQUIRED');
  const project = fileURLToPath(new URL('../', import.meta.url));
  await assert.rejects(new LabPreferences(config, { root: join(project, 'private-data') }).set(42, 'exempt'), e => e.code === 'REPOSITORY_STORAGE_NOT_ALLOWED');
  assert.deepEqual(await readdir(root), []);
});

test('malformed, oversized and invalid-schema records cannot be silently overwritten/reset', async t => {
  const root = await temporary(t);
  const store = new LabPreferences(config, { root });
  const file = store.location(42);
  await mkdir(dirname(file), { recursive: true });
  for (const value of ['PRIVATE_BAD_JSON', 'x'.repeat(5000), JSON.stringify({ schemaVersion: 99, attendance: 'exempt', updatedAt: timestamp }), JSON.stringify({ schemaVersion: 1, attendance: 'exempt', updatedAt: 'invalid' })]) {
    await writeFile(file, value);
    await assert.rejects(store.get(42), e => e.code === 'INVALID_PREFERENCE_FILE' && !e.message.includes('PRIVATE'));
    await assert.rejects(store.set(42, 'attending'), e => e.code === 'INVALID_PREFERENCE_FILE');
    await assert.rejects(store.set(42, 'unknown'), e => e.code === 'INVALID_PREFERENCE_FILE');
    assert.equal(await readFile(file, 'utf8'), value);
    assert.deepEqual(await readdir(dirname(file)), ['42.json']);
  }
});

test('filesystem lock rejects competing writers without touching their lock or corrupting state', async t => {
  const root = await temporary(t);
  const first = new LabPreferences(config, { root });
  const second = new LabPreferences(config, { root });
  const results = await Promise.allSettled([first.set(42, 'attending'), second.set(42, 'exempt')]);
  assert.ok(results.some(r => r.status === 'fulfilled'));
  for (const result of results.filter(r => r.status === 'rejected')) assert.equal(result.reason.code, 'PREFERENCE_BUSY');
  assert.ok(['attending', 'exempt'].includes((await first.get(42)).attendance));
  const file = first.location(42);
  await writeFile(`${file}.lock`, 'existing');
  await assert.rejects(first.set(42, 'exempt'), e => e.code === 'PREFERENCE_BUSY');
  assert.equal(await readFile(`${file}.lock`, 'utf8'), 'existing');
});

test('storage errors are safe and failed timestamp/write does not erase existing preference', async t => {
  const root = await temporary(t);
  const store = new LabPreferences(config, { root, now: () => timestamp });
  const saved = await store.set(42, 'attending');
  const badClock = new LabPreferences(config, { root, now: () => 'PRIVATE' });
  await assert.rejects(badClock.set(42, 'exempt'), e => e.code === 'INVALID_TIMESTAMP' && !e.message.includes('PRIVATE'));
  assert.deepEqual(await store.get(42), saved);
  assert.deepEqual(await readdir(dirname(store.location(42))), ['42.json']);
  const blocked = join(root, 'not-a-directory');
  await writeFile(blocked, 'x');
  await assert.rejects(new LabPreferences(config, { root: blocked }).set(42, 'attending'), e => !e.message.includes(root));
});

test('default data paths are local application data, not workspace-relative', () => {
  assert.equal(defaultPreferenceRoot({ XDG_DATA_HOME: '/data' }, 'linux', '/home/test'), join('/data', 'courses-mcp', 'lab-preferences'));
  assert.equal(defaultPreferenceRoot({ XDG_DATA_HOME: 'relative' }, 'linux', '/home/test'), join('/home/test', '.local', 'share', 'courses-mcp', 'lab-preferences'));
  assert.ok(defaultPreferenceRoot({}, 'win32', resolve(tmpdir())).includes(join('AppData', 'Local')));
});

test('Moodle checks current enrollment before local reads/writes', async () => {
  const calls = [];
  const moodle = new Moodle({}, { preferences: { get: async id => { calls.push(['get', id]); return {}; }, set: async (id, value) => { calls.push(['set', id, value]); return {}; } } });
  moodle.listCourses = async () => ({ courses: [{ id: 42 }] });
  await moodle.labPreference(42);
  await moodle.labPreference(42, 'exempt');
  await assert.rejects(moodle.labPreference(43, 'exempt'), /not in your enrolled/);
  assert.deepEqual(calls, [['get', 42], ['set', 42, 'exempt']]);
});
