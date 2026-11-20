import { join, dirname } from 'node:path';
import { z } from 'zod';
import { LabPreferences, defaultPreferenceRoot } from './preferences.js';
import { UserError } from './config.js';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const refreshSelection = {
  courseIds: z.array(id).min(1).max(4),
  documents: z.array(z.object({ courseId: id, resourceId: id }).strict()).max(3).default([]),
};
const selectionSchema = z.object(refreshSelection).strict().refine(value =>
  value.documents.every(document => value.courseIds.includes(document.courseId)));
const recordSchema = z.object({ schemaVersion: z.literal(1), updatedAt: z.iso.datetime(),
  courseIds: z.array(id).min(1).max(4),
  documents: z.array(z.object({ courseId: id, resourceId: id }).strict()).max(3),
  state: z.enum(['ready', 'cancelled', 'complete']),
  results: z.array(z.object({ courseId: id, state: z.enum(['refreshed', 'partial', 'failed']) }).strict()).max(4),
}).strict();

// One bounded job per account; persist IDs and progress only, never fetched text.
export class RefreshJob extends LabPreferences {
  constructor(config, { root = join(dirname(defaultPreferenceRoot()), 'refresh-jobs'), now,
    authorize, refresh } = {}) {
    super(Object.freeze({ baseUrl: config.baseUrl, username: config.username }), { root, now });
    this.authorize = authorize;
    this.refresh = refresh;
  }

  validateRecord(record) {
    if (!recordSchema.safeParse(record).success ||
        new Set(record.courseIds).size !== record.courseIds.length ||
        record.documents.some(document => !record.courseIds.includes(document.courseId)) ||
        record.results.some((result, index) => result.courseId !== record.courseIds[index]) ||
        record.results.length > record.courseIds.length ||
        (record.state === 'complete') !== (record.results.length === record.courseIds.length)) {
      throw new UserError('Refresh job is invalid (REFRESH_JOB_INVALID).');
    }
  }

  async checkAccess(courseIds) {
    for (const courseId of courseIds) {
      let allowed;
      try { allowed = await this.authorize(courseId); } catch { /* Never return upstream details. */ }
      if (allowed !== true) throw new UserError('Refresh access could not be verified (REFRESH_ACCESS_UNAVAILABLE).');
    }
  }

  describe(record) {
    if (!record) return { state: 'empty' };
    return { state: record.state, updatedAt: record.updatedAt, total: record.courseIds.length,
      processed: record.results.length, refreshed: record.results.filter(result => result.state === 'refreshed').length,
      partial: record.results.filter(result => result.state === 'partial').length,
      failed: record.results.filter(result => result.state === 'failed').length,
      pending: record.courseIds.length - record.results.length,
      warnings: [...(record.results.some(result => result.state === 'partial') ? ['REFRESH_PARTIAL_STEPS'] : []),
        ...(record.results.some(result => result.state === 'failed') ? ['REFRESH_FAILED_STEPS'] : [])],
      scope: 'One explicit course per advance; local index refresh only. Complete means all steps attempted, not complete Moodle coverage.' };
  }

  async start(selection) {
    const parsed = selectionSchema.safeParse(selection);
    if (!parsed.success) throw new UserError('Choose 1–4 course IDs and up to 3 documents in those courses (REFRESH_SELECTION_INVALID).');
    const { courseIds, documents } = parsed.data;
    await this.checkAccess(courseIds);
    const record = await this.update(1, current => {
      if (current?.state === 'ready') {
        throw new UserError('Finish or cancel the existing job first (REFRESH_JOB_EXISTS).');
      }
      return { schemaVersion: 1, updatedAt: this.now(), courseIds: [...new Set(courseIds)], documents,
        state: 'ready', results: [] };
    }, { accountLock: true });
    return this.describe(record);
  }

  async status() {
    const file = this.location(1);
    await this.checkDirectories(file);
    const record = await this.load(file);
    if (record) await this.checkAccess(record.courseIds);
    return this.describe(record);
  }

  async advance(action = 'next') {
    if (!['next', 'cancel', 'resume'].includes(action)) throw new UserError('Invalid refresh action (REFRESH_ACTION_INVALID).');
    const record = await this.update(1, async current => {
      if (!current) throw new UserError('Start a refresh job first (REFRESH_JOB_MISSING).');
      await this.checkAccess(current.courseIds);
      if (current.state === 'complete') return current;
      if (action === 'cancel') return { ...current, state: 'cancelled', updatedAt: this.now() };
      if (current.state === 'cancelled' && action !== 'resume') {
        throw new UserError('Resume the cancelled job explicitly (REFRESH_JOB_CANCELLED).');
      }
      const courseId = current.courseIds[current.results.length];
      let state = 'failed';
      try {
        const result = await this.refresh(courseId, current.documents.filter(document => document.courseId === courseId));
        state = result.status === 'read' ? 'refreshed' : 'partial';
      } catch { /* Only aggregate failure state is persisted. */ }
      const results = [...current.results, { courseId, state }];
      return { ...current, updatedAt: this.now(), results,
        state: results.length === current.courseIds.length ? 'complete' : 'ready' };
    }, { accountLock: true });
    return this.describe(record);
  }
}
