import { mkdir, open, readFile, rename, unlink, lstat, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserError } from './config.js';

export const attendanceStates = ['attending', 'exempt', 'unknown'];
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export function defaultPreferenceRoot(env = process.env, platform = process.platform, home = homedir()) {
  const candidate = platform === 'win32' ? env.LOCALAPPDATA : env.XDG_DATA_HOME;
  const data = candidate && isAbsolute(candidate) ? candidate : platform === 'win32' ? join(home, 'AppData', 'Local') : join(home, '.local', 'share');
  return join(data, 'courses-mcp', 'lab-preferences');
}

export class PreferenceError extends UserError {
  constructor(code) { super(`Local lab preference could not be accessed (${code}).`); this.code = code; }
}
const describe = (courseId, record) => ({ courseId, attendance: record?.attendance || 'unknown',
  excludeFromLabObligations: record?.attendance === 'exempt', source: record ? 'user_declared' : 'unset',
  updatedAt: record?.updatedAt || null,
  scope: 'Local personal preference only; not faculty verification, enrollment, poll selection, or proof of a dated lab.' });

export class LabPreferences {
  constructor(config, { root = defaultPreferenceRoot(), now = () => new Date().toISOString() } = {}) {
    this.config = config;
    this.root = resolve(root);
    this.now = now;
  }

  location(courseId) {
    if (!Number.isSafeInteger(courseId) || courseId <= 0) throw new PreferenceError('INVALID_COURSE_ID');
    if (!this.config.username?.trim() || !this.config.baseUrl) throw new PreferenceError('ACCOUNT_REQUIRED');
    const inside = relative(resolve(projectRoot), this.root);
    if (!inside || (!inside.startsWith('..') && !isAbsolute(inside))) throw new PreferenceError('REPOSITORY_STORAGE_NOT_ALLOWED');
    const account = createHash('sha256').update(`${this.config.baseUrl}\0${this.config.username.trim()}`).digest('hex');
    return join(this.root, account, `${courseId}.json`);
  }

  async checkDirectories(file, create = false) {
    // Reject symlink/junction app/account directories; normal app-data ancestors are OS-managed.
    for (const path of [dirname(this.root), this.root, dirname(file)]) {
      if (create) await mkdir(path, { recursive: true, mode: 0o700 });
      try { const stat = await lstat(path); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new PreferenceError('UNSAFE_STORAGE_DIRECTORY'); }
      catch (error) { if (error.code === 'ENOENT' && !create) continue; throw error; }
    }
    try {
      const inside = relative(await realpath(projectRoot), await realpath(this.root));
      if (!inside || (!inside.startsWith('..') && !isAbsolute(inside))) throw new PreferenceError('REPOSITORY_STORAGE_NOT_ALLOWED');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  async load(file) {
    let stat;
    try { stat = await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new PreferenceError('INVALID_PREFERENCE_FILE');
    let record;
    try { record = JSON.parse(await readFile(file, 'utf8')); } catch { throw new PreferenceError('INVALID_PREFERENCE_FILE'); }
    if (!record || Object.keys(record).sort().join(',') !== 'attendance,schemaVersion,updatedAt' || record.schemaVersion !== 1 ||
        !['attending', 'exempt'].includes(record.attendance) || typeof record.updatedAt !== 'string' ||
        !Number.isFinite(Date.parse(record.updatedAt)) || new Date(record.updatedAt).toISOString() !== record.updatedAt) {
      throw new PreferenceError('INVALID_PREFERENCE_FILE');
    }
    return record;
  }

  async get(courseId) {
    try {
      const file = this.location(courseId);
      await this.checkDirectories(file);
      return describe(courseId, await this.load(file));
    } catch (error) { if (error instanceof PreferenceError) throw error; throw new PreferenceError('PREFERENCE_READ_FAILED'); }
  }

  async set(courseId, attendance) {
    let lock;
    let acquiredLockPath;
    let temp;
    let handle;
    try {
      if (!attendanceStates.includes(attendance)) throw new PreferenceError('INVALID_ATTENDANCE');
      const file = this.location(courseId);
      await this.checkDirectories(file, true);
      const lockPath = `${file}.lock`;
      try { lock = await open(lockPath, 'wx', 0o600); }
      catch (error) { if (error.code === 'EEXIST') throw new PreferenceError('PREFERENCE_BUSY'); throw error; }
      acquiredLockPath = lockPath;
      const current = await this.load(file);
      if (attendance === 'unknown') {
        if (current) await unlink(file);
        return describe(courseId, null);
      }
      if (current?.attendance === attendance) return describe(courseId, current);
      const record = { schemaVersion: 1, attendance, updatedAt: this.now() };
      if (!Number.isFinite(Date.parse(record.updatedAt)) || new Date(record.updatedAt).toISOString() !== record.updatedAt) throw new PreferenceError('INVALID_TIMESTAMP');
      temp = join(dirname(file), `.${courseId}.${randomUUID()}.tmp`);
      handle = await open(temp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(record) + '\n');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temp, file);
      temp = undefined;
      return describe(courseId, record);
    } catch (error) { if (error instanceof PreferenceError) throw error; throw new PreferenceError('PREFERENCE_WRITE_FAILED'); }
    finally {
      await handle?.close().catch(() => {});
      if (temp) await unlink(temp).catch(() => {});
      if (lock) { await lock.close().catch(() => {}); await unlink(acquiredLockPath).catch(() => {}); }
    }
  }
}
