import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { LabPreferences, PreferenceError, defaultPreferenceRoot } from './preferences.js';
import { courseFilters } from './courses.js';
import { expandLabOccurrences } from './scheduling/occurrences.ts';
import { resolveLabChanges } from './scheduling/lab-changes.js';
import { isFreshWeeklySource } from './weekly-evidence.js';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const instant = z.iso.datetime().refine(value => new Date(value).toISOString() === value);
const date = z.iso.date();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const token = z.string().regex(/^[\p{L}\p{N}-]{1,16}$/u);
export const savedScheduleScope = z.object({
  academicYear: courseFilters.academicYear.unwrap(), semester: courseFilters.semester.unwrap(),
  group: token.transform(value => value.toUpperCase().replace(/А/g, 'A').replace(/Б/g, 'B').replace(/Ц/g, 'C')),
}).strict();
const source = z.object({ url: z.string().regex(/^https:\/\/courses\.finki\.ukim\.mk\/mod\/resource\/view\.php\?id=[1-9]\d*$/),
  checkedAt: instant, kind: z.enum(['html_table', 'html_line', 'pdf_line']),
  page: id.optional(), row: id.optional(), table: id.optional(), line: id.optional() }).strict();
const entry = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/), courseId: id, group: token,
  weekday: z.enum(['monday','tuesday','wednesday','thursday','friday','saturday','sunday']).nullable(),
  startTime: time, endTime: time.nullable(), room: token.nullable(), timeZone: z.literal('Europe/Skopje'),
  dates: z.array(date).max(32), effectiveFrom: date.nullable(), effectiveUntil: date.nullable(),
  recurrence: z.enum(['weekly','alternating']).nullable(), anchorDate: date.nullable(),
  sources: z.array(source).min(1).max(32), warnings: z.array(z.enum(['MISSING_ENDTIME','MISSING_ROOM'])).max(2),
}).strict().refine(value => !value.endTime || value.endTime > value.startTime)
  .refine(value => value.dates.length ? !value.effectiveFrom && !value.effectiveUntil :
    value.effectiveFrom && value.effectiveUntil && value.effectiveFrom <= value.effectiveUntil && value.weekday && value.recurrence &&
    (value.recurrence !== 'alternating' || value.anchorDate && value.anchorDate >= value.effectiveFrom && value.anchorDate <= value.effectiveUntil));
const recordSchema = z.object({ schemaVersion: z.literal(1), updatedAt: instant, verifiedAt: instant,
  initialChangesCheckedAt: instant, scope: savedScheduleScope, courseId: id, resourceId: id, forumId: id,
  preferenceSignature: z.string().regex(/^[a-f0-9]{64}$/), entries: z.array(entry).min(1).max(32),
}).strict();
export const preferenceSignature = (attendance, term) => createHash('sha256')
  .update(JSON.stringify([attendance.attendance, attendance.updatedAt, term.term, term.updatedAt])).digest('hex');
const maxAge = 7 * 86400000;
const maxBytes = 65536;

export class SavedLabSchedules extends LabPreferences {
  constructor(config, scope, options = {}) {
    super(Object.freeze({ baseUrl: config.baseUrl, username: config.username }), {
      root: join(dirname(defaultPreferenceRoot()), 'saved-lab-schedules'), ...options,
    });
    this.scope = Object.freeze(savedScheduleScope.parse(scope));
  }
  location(courseId) {
    const suffix = createHash('sha256').update(JSON.stringify(this.scope)).digest('hex').slice(0, 32);
    return super.location(courseId).replace(/\.json$/, `.${suffix}.json`);
  }
  load(file) { return super.load(file, maxBytes); }
  validateRecord(record) {
    const parsed = recordSchema.safeParse(record);
    if (!parsed.success || JSON.stringify(record.scope) !== JSON.stringify(this.scope) ||
      record.updatedAt < record.verifiedAt || record.updatedAt < record.initialChangesCheckedAt ||
      Buffer.byteLength(JSON.stringify(record) + '\n') > maxBytes || record.entries.some(item =>
        item.courseId !== record.courseId || item.group !== this.scope.group || item.sources.some(ref =>
          ref.url !== `https://courses.finki.ukim.mk/mod/resource/view.php?id=${record.resourceId}` || ref.checkedAt !== record.verifiedAt))) {
      throw new PreferenceError('INVALID_SAVED_SCHEDULE');
    }
  }
  async read(courseId, signature) {
    try {
      const file = this.location(courseId);
      await this.checkDirectories(file);
      const record = await this.load(file);
      if (!record) return { status: 'missing' };
      const age = Date.parse(this.now()) - Date.parse(record.verifiedAt);
      if (record.courseId !== courseId) throw new PreferenceError('INVALID_SAVED_SCHEDULE');
      if (record.preferenceSignature !== signature) return { status: 'selection_changed' };
      if (!(age >= 0 && age < maxAge)) return { status: 'expired' };
      return { status: 'stored', record };
    } catch (error) {
      if (error instanceof PreferenceError) throw error;
      throw new PreferenceError('SAVED_SCHEDULE_READ_FAILED');
    }
  }
  async save(courseId, value) {
    const record = { ...value, schemaVersion: 1, courseId, scope: this.scope, updatedAt: this.now() };
    this.validateRecord(record);
    const age = Date.parse(record.updatedAt) - Date.parse(record.verifiedAt);
    if (!(age >= 0 && age <= 300000) || !isFreshWeeklySource(record.initialChangesCheckedAt, Date.parse(record.updatedAt))) {
      throw new PreferenceError('SCHEDULE_VERIFICATION_EXPIRED');
    }
    await this.update(courseId, async (current, file) => {
      const files = await readdir(dirname(file));
      if (!current && files.filter(name => /^\d+\.[a-f0-9]{32}\.json$/.test(name)).length >= 32) {
        throw new PreferenceError('SAVED_SCHEDULE_QUOTA');
      }
      return record;
    }, { accountLock: true });
    return { status: 'saved', scope: this.scope, verifiedAt: record.verifiedAt,
      changesCheckedAt: record.initialChangesCheckedAt, expiresAt: new Date(Date.parse(record.verifiedAt) + maxAge).toISOString() };
  }
  async clear(courseId) {
    await this.update(courseId, () => null, { accountLock: true, discard: true });
    return { status: 'cleared', scope: this.scope };
  }
}

export function projectSavedSchedule(record, range, announcements, now = Date.now()) {
  const expansion = expandLabOccurrences(record.entries, range);
  const changes = resolveLabChanges(expansion, announcements);
  const fresh = announcements?.status === 'read' && isFreshWeeklySource(announcements.checkedAt, now);
  const slots = new Map();
  for (const session of changes.sessions) {
    if (!['timetable', 'moved'].includes(session.status)) continue;
    const item = session.replacement ?? session.original;
    const key = JSON.stringify([item.date, item.startTime, item.group]);
    const peers = slots.get(key) ?? [];
    peers.push(session);
    slots.set(key, peers);
  }
  for (const peers of slots.values()) if (peers.length > 1) {
    changes.status = 'partial';
    for (const session of peers) { session.status = 'conflict'; session.reason = 'SAVED_TIMETABLE_CONFLICT'; }
  }
  return { status: fresh && changes.status === 'read' ? 'stored_candidates' : 'unknown',
    answerState: 'unknown', scope: record.scope, verifiedAt: record.verifiedAt,
    changesCheckedAt: announcements?.checkedAt ?? null, initialChangesCheckedAt: record.initialChangesCheckedAt,
    sourceUrl: `https://courses.finki.ukim.mk/mod/resource/view.php?id=${record.resourceId}`,
    forumUrl: `https://courses.finki.ukim.mk/mod/forum/view.php?id=${record.forumId}`,
    sessions: fresh ? changes.sessions : expansion.occurrences.map(original => ({ status: 'unverified', original })),
    unresolved: changes.unresolved,
    warnings: ['STORED_TIMETABLE_NOT_LIVE', 'OTHER_COURSEWORK_UNCHECKED', ...(!fresh || changes.status !== 'read' ? ['CURRENT_CHANGES_UNVERIFIED'] : [])],
    evidenceScope: 'User-confirmed saved group timetable and one freshly checked news forum only. Not a fresh poll/timetable check or complete homework coverage. Empty stored candidates do not prove no labs. Refresh explicitly if the faculty changes the timetable/group.',
  };
}
