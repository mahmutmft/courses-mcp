import { dirname, join } from 'node:path';
import { LabPreferences, defaultPreferenceRoot } from './preferences.js';
import { UserError } from './config.js';

const maxBytes = 1024 * 1024;
const maxAgeMs = 7 * 86_400_000;

// The existing storage implementation provides account isolation, file locks and atomic replacement.
export class CourseCache extends LabPreferences {
  constructor(config, { root = join(dirname(defaultPreferenceRoot()), 'course-cache'), enabled = false,
    now, authorize } = {}) {
    super(config, { root, now });
    this.enabled = enabled;
    this.#authorize = authorize;
    this.config = Object.freeze({ baseUrl: config.baseUrl, username: config.username });
  }

  #authorize;

  async #canAccess(courseId) {
    if (!this.enabled || !Number.isSafeInteger(courseId) || courseId < 1) return false;
    try {
      return await this.#authorize?.(courseId) === true;
    } catch {
      throw new UserError('Course cache access could not be verified (CACHE_AUTHORIZATION_UNAVAILABLE).');
    }
  }

  async load(file) {
    return super.load(file, maxBytes);
  }

  validateRecord(record) {
    if (!record || Object.keys(record).sort().join(',') !== 'content,index,schemaVersion,updatedAt' ||
        record.schemaVersion !== 1 || typeof record.content !== 'string' || typeof record.index !== 'string' ||
        typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt)) ||
        Buffer.byteLength(JSON.stringify(record) + '\n') > maxBytes) {
      throw new UserError('Invalid or unsupported course cache record (CACHE_INVALID_RECORD).');
    }
  }

  async get(courseId) {
    if (!await this.#canAccess(courseId)) return null;
    const file = this.location(courseId);
    await this.checkDirectories(file);
    const record = await this.load(file);
    if (!record) return null;
    const age = Date.parse(this.now()) - Date.parse(record.updatedAt);
    return age >= 0 && age < maxAgeMs ? record : null;
  }

  async set(courseId, { content, index }) {
    if (!await this.#canAccess(courseId)) return null;
    return this.update(courseId, () => ({ schemaVersion: 1, updatedAt: this.now(), content, index }));
  }

  async inspect(courseId) {
    if (!await this.#canAccess(courseId)) return null;
    const file = this.location(courseId);
    await this.checkDirectories(file);
    const record = await this.load(file);
    return record ? { updatedAt: record.updatedAt, bytes: Buffer.byteLength(JSON.stringify(record) + '\n') } : null;
  }

  async delete(courseId) {
    if (!await this.#canAccess(courseId)) return null;
    await this.update(courseId, () => null);
  }
}
