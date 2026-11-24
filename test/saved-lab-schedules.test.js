import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SavedLabSchedules, preferenceSignature, projectSavedSchedule } from '../src/saved-lab-schedules.js';
import { extractTimetable } from '../src/timetables.js';
import { Moodle } from '../src/moodle.js';

const config = { baseUrl: 'https://courses.finki.ukim.mk', username: 'synthetic-user' };
const scope = { academicYear: '2026/2027', semester: 'winter', group: 'A' };
const verifiedAt = '2026-11-23T10:00:00.000Z';
const attendance = { attendance: 'attending', updatedAt: verifiedAt };
const term = { term: { group: 'A' }, updatedAt: verifiedAt };
const signature = preferenceSignature(attendance, term);
const range = { from: '2026-11-23', through: '2026-11-29' };
const sourceUrl = 'https://courses.finki.ukim.mk/mod/resource/view.php?id=7';
function table(checkedAt = verifiedAt) {
  return extractTimetable({ courseId: 42, resourceId: 7, sourceUrl, checkedAt, status: 'read', format: 'html',
    tables: [{ rows: [ ['Group','Day','Start','End','Room','From','Until','Recurrence','Timezone'],
      ['A','Tuesday','14:00','15:00','200','2026-11-01','2027-01-31','weekly','Europe/Skopje'] ] }] });
}
function value(checkedAt = verifiedAt) {
  return { resourceId: 7, forumId: 12, verifiedAt: checkedAt, initialChangesCheckedAt: checkedAt,
    preferenceSignature: signature, entries: table(checkedAt).entries.map(({ status: _status, ...fields }) => fields) };
}
const news = (checkedAt = verifiedAt, posts = []) => ({ status: 'read', checkedAt, posts,
  sourceUrl: 'https://courses.finki.ukim.mk/mod/forum/view.php?id=12' });
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'courses-saved-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const create = (account = config, selection = scope, now = () => verifiedAt) => new SavedLabSchedules(account, selection, { root, now, ...options });
  return { root, create, store: create() };
}

test('real JSON survives reconstruction and isolates account, institution, semester and group', async t => {
  const { store, create } = await fixture(t);
  await store.save(42, value());
  assert.equal((await create().read(42, signature)).status, 'stored');
  for (const other of [create({ ...config, username: 'another-user' }), create({ ...config, baseUrl: 'https://other.test' }),
    create(config, { ...scope, academicYear: '2027/2028' }), create(config, { ...scope, semester: 'summer' }),
    create(config, { ...scope, group: 'B' })]) {
    assert.equal((await other.read(42, signature)).status, 'missing');
  }
  const raw = await readFile(store.location(42), 'utf8');
  assert.doesNotMatch(raw, /synthetic-user|password|rawLabel|<html/);
  assert.equal((await store.read(43, signature)).status, 'missing');
});

test('expiry, future clock and changed local selection never return stored sessions', async t => {
  const { store, create } = await fixture(t);
  await store.save(42, value());
  for (const clock of ['2026-11-30T10:00:00.000Z', '2026-11-23T09:59:59.000Z', 'invalid']) {
    assert.deepEqual(await create(config, scope, () => clock).read(42, signature), { status: 'expired' });
  }
  assert.deepEqual(await store.read(42, preferenceSignature(attendance, { ...term, updatedAt: '2026-11-24T10:00:00.000Z' })),
    { status: 'selection_changed' });
  assert.equal((await create(config, scope, () => '2026-11-30T09:59:59.999Z').read(42, signature)).status, 'stored');
});

test('malformed, oversized and mismatched records fail safely and scoped clear can recover', async t => {
  const { store } = await fixture(t);
  await store.save(42, value());
  const original = await readFile(store.location(42), 'utf8');
  for (const raw of ['{private raw error', 'x'.repeat(65537), original.replace('"schemaVersion":1', '"schemaVersion":99'),
    original.replace('"courseId":42', '"courseId":43'), original.replace(sourceUrl, 'https://outside.test/private')]) {
    await writeFile(store.location(42), raw);
    await assert.rejects(store.read(42, signature), error => !error.message.includes('private') && /INVALID/.test(error.code));
  }
  assert.equal((await store.clear(42)).status, 'cleared');
  assert.equal((await store.read(42, signature)).status, 'missing');
  await store.save(42, value());
});

test('quota, bounded entries and fresh verification are enforced without evicting other scopes', async t => {
  const { store, create } = await fixture(t);
  await assert.rejects(store.save(42, { ...value(), entries: [] }));
  await assert.rejects(store.save(42, { ...value(), entries: Array(33).fill(value().entries[0]) }));
  await assert.rejects(create(config, scope, () => '2026-11-23T10:05:00.001Z').save(42, value()), /SCHEDULE_VERIFICATION_EXPIRED/);
  for (let i = 0; i < 32; i++) await create(config, { ...scope, group: `G${i}` }).save(42, {
    ...value(), entries: value().entries.map(entry => ({ ...entry, group: `G${i}` })) });
  await assert.rejects(store.save(42, value()), /SAVED_SCHEDULE_QUOTA/);
  const first = create(config, { ...scope, group: 'G0' });
  await first.clear(42);
  await store.save(42, value());
  await store.save(42, value()); // Replacement at quota is allowed.
});

test('symlink records cannot be read, overwritten or cleared', async t => {
  const { store, root } = await fixture(t);
  await store.save(42, value());
  const file = store.location(42), target = join(root, 'untouched.json');
  await writeFile(target, 'private-target');
  await rm(file);
  try { await symlink(target, file); }
  catch (error) { if (error.code === 'EPERM') { t.skip('OS does not permit symlinks'); return; } throw error; }
  await assert.rejects(store.read(42, signature));
  await assert.rejects(store.save(42, value()));
  await assert.rejects(store.clear(42));
  assert.equal(await readFile(target, 'utf8'), 'private-target');
});

test('projection applies fresh cancellation/move, keeps original provenance and unknown overall coverage', async t => {
  const { store } = await fixture(t);
  await store.save(42, value());
  const { record } = await store.read(42, signature);
  const post = text => ({ text, title: 'Lab update', sourceUrl: 'https://courses.finki.ukim.mk/mod/forum/discuss.php?d=100#p5',
    publishedAt: verifiedAt, updatedAt: null, checkedAt: verifiedAt, warnings: [] });
  const cancel = projectSavedSchedule(record, range, news(verifiedAt, [post('Lab change: cancel | A | 2026-11-24 14:00')]), Date.parse(verifiedAt));
  assert.equal(cancel.sessions[0].status, 'cancelled');
  assert.equal(cancel.answerState, 'unknown');
  assert.equal(cancel.verifiedAt, verifiedAt);
  const moved = projectSavedSchedule(record, range, news(verifiedAt, [post('Lab change: move | A | 2026-11-24 14:00 | 2026-11-25 16:00 | 201')]), Date.parse(verifiedAt));
  assert.equal(moved.sessions[0].status, 'moved');
  assert.equal(moved.sessions[0].replacement.date, '2026-11-25');
  assert.equal(moved.sessions[0].original.sources[0].url, sourceUrl);
  const empty = projectSavedSchedule(record, { from: '2027-03-01', through: '2027-03-02' }, news(), Date.parse(verifiedAt));
  assert.equal(empty.sessions.length, 0);
  assert.equal(empty.answerState, 'unknown');
  const conflicting = structuredClone(record);
  conflicting.entries.push({ ...conflicting.entries[0], id: 'f'.repeat(24), room: '999' });
  const conflict = projectSavedSchedule(conflicting, range, news(), Date.parse(verifiedAt));
  assert.equal(conflict.status, 'unknown');
  assert.ok(conflict.sessions.every(session => session.status === 'conflict'));
});

test('stale/partial/unavailable news never applies a historical cancellation as current', async t => {
  const { store } = await fixture(t);
  await store.save(42, value());
  const { record } = await store.read(42, signature);
  for (const announcements of [null, { ...news(), status: 'partial' }, news('2026-11-23T09:54:59.000Z')]) {
    const result = projectSavedSchedule(record, range, announcements, Date.parse(verifiedAt));
    assert.equal(result.status, 'unknown');
    assert.equal(result.sessions[0].status, 'unverified');
    assert.ok(result.warnings.includes('CURRENT_CHANGES_UNVERIFIED'));
  }
});

function adapter(create, checkedAt, { rejectForum = false, revoked = false } = {}) {
  let reads = 0, enrollmentChecks = 0;
  const instance = new Moodle(config, { preferences: { get: async () => attendance }, termPreferences: { getTerm: async () => term },
    savedSchedules: selection => create(config, selection, () => checkedAt) });
  instance.listCourses = async () => ({ courses: ++enrollmentChecks > 1 && revoked ? [] : [{ id: 42, name: 'Course 2026/2027 winter' }] });
  instance.page = { context: () => ({ request: { get: async url => {
    reads++;
    if (rejectForum) throw new Error('PRIVATE_NETWORK_ERROR');
    assert.equal(url, 'https://courses.finki.ukim.mk/mod/forum/view.php?id=12');
    return { status: () => 200, headers: () => ({ 'content-type': 'text/html' }), dispose: async () => {},
      body: async () => Buffer.from('<body id="page-mod-forum-view" class="course-42 cmid-12 forumtype-news"><main id="region-main"><div class="notification">There are no discussion topics yet in this forum.</div></main></body>') };
  } } }) };
  instance.getCourse = instance.getChoiceSelection = instance.getLabSchedule = instance.getLabTimetable = async () => { throw new Error('UNEXPECTED_COURSE_OR_POLL_FETCH'); };
  return { instance, reads: () => reads };
}

test('Moodle save followed by reconstructed repeat reads makes no course/poll/timetable request', async t => {
  const { create } = await fixture(t);
  const current = new Date().toISOString();
  const first = adapter(create, current);
  first.instance.getLabSchedule = async () => ({ attendance: 'attending', checkedAt: current,
    termResolution: { status: 'resolved' }, selectionSource: { term: { group: 'A' } } });
  first.instance.getLabTimetable = async () => table(current);
  first.instance.getAnnouncements = async () => news(current);
  const args = { courseId: 42, scope, resourceId: 7, forumId: 12, weekStart: range.from };
  assert.equal((await first.instance.savedLabSchedule('save', args)).status, 'saved');
  for (let i = 0; i < 2; i++) {
    const repeat = adapter(create, current);
    const result = await repeat.instance.savedLabSchedule('read', { courseId: 42, scope, range });
    assert.equal(result.status, 'stored_candidates');
    assert.equal(result.verifiedAt, current);
    assert.equal(result.sessions.length, 1);
    assert.equal(repeat.reads(), 1); // Exactly one current forum read, no discovery/poll/document reads.
  }
});

test('Moodle access revocation, changed group and failed news do not return confirmed stale answers', async t => {
  const { create } = await fixture(t);
  const current = new Date().toISOString();
  await create(config, scope, () => current).save(42, value(current));
  const args = { courseId: 42, scope, range };
  const revoked = adapter(create, current, { revoked: true });
  await assert.rejects(revoked.instance.savedLabSchedule('read', args), /not in your enrolled/);
  const changed = adapter(create, current);
  changed.instance.termPreferences.getTerm = async () => ({ ...term, term: { group: 'B' } });
  assert.equal((await changed.instance.savedLabSchedule('read', args)).status, 'selection_changed');
  assert.equal(changed.reads(), 0);
  const unavailable = adapter(create, current, { rejectForum: true });
  const result = await unavailable.instance.savedLabSchedule('read', args);
  assert.equal(result.status, 'unknown');
  assert.equal(result.sessions[0].status, 'unverified');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_NETWORK/);
  await assert.rejects(unavailable.instance.savedLabSchedule('read', { ...args, scope: { ...scope, semester: 'summer' } }), /SCHEDULE_SCOPE_MISMATCH/);
});

test('explicit refresh preserves null end time; conflicting selection and incomplete source cannot be saved', async t => {
  const { create } = await fixture(t);
  const current = new Date().toISOString();
  const { instance } = adapter(create, current);
  const args = { courseId: 42, scope, resourceId: 7, forumId: 12, weekStart: range.from };
  instance.getLabSchedule = async () => ({ attendance: 'attending', checkedAt: current,
    termResolution: { status: 'conflict' }, selectionSource: { term: { group: 'A' } } });
  await assert.rejects(instance.savedLabSchedule('save', args), /SCHEDULE_SELECTION_UNRESOLVED/);
  instance.getLabSchedule = async () => ({ attendance: 'attending', checkedAt: current,
    termResolution: { status: 'resolved' }, selectionSource: { term: { group: 'A' } } });
  instance.getAnnouncements = async () => news(current);
  instance.getLabTimetable = async () => ({ ...table(current), status: 'partial', coverage: { partial: true, warnings: ['PARTIAL_TIMETABLE_SOURCE'] } });
  await assert.rejects(instance.savedLabSchedule('save', args), /SCHEDULE_EVIDENCE_INCOMPLETE/);
  instance.getLabTimetable = async () => ({ ...table(current), status: 'partial',
    coverage: { partial: true, warnings: ['UNRESOLVED_TIMETABLE_FIELDS'] },
    entries: table(current).entries.map(entry => ({ ...entry, endTime: null, warnings: ['MISSING_ENDTIME'] })) });
  await instance.savedLabSchedule('save', args);
  const result = await adapter(create, current).instance.savedLabSchedule('read', { courseId: 42, scope, range });
  assert.equal(result.sessions[0].original.endTime, null);
  assert.equal(result.answerState, 'unknown');
});

test('initial authorization precedes storage; a snapshot replaced during news read is not combined with old news', async t => {
  const { create } = await fixture(t);
  const current = new Date().toISOString();
  await create(config, scope, () => current).save(42, value(current));
  const denied = adapter(create, current);
  denied.instance.listCourses = async () => ({ courses: [] });
  denied.instance.savedSchedules = () => { throw new Error('UNAUTHORIZED_STORAGE_ACCESS'); };
  await assert.rejects(denied.instance.savedLabSchedule('read', { courseId: 42, scope, range }), /not in your enrolled/);
  assert.equal(denied.reads(), 0);
  const changed = adapter(create, current);
  changed.instance.savedSchedules = selection => {
    const store = create(config, selection, () => current);
    const read = store.read.bind(store);
    let calls = 0;
    store.read = async (...args) => {
      const result = await read(...args);
      if (++calls === 2) result.record.forumId = 99;
      return result;
    };
    return store;
  };
  const result = await changed.instance.savedLabSchedule('read', { courseId: 42, scope, range });
  assert.equal(result.status, 'snapshot_changed');
  assert.deepEqual(result.sessions, []);
});
