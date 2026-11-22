import { isMonday } from './labs.js';
import { UserError } from './config.js';
import { resolveWeeklyEvidence, isFreshWeeklySource } from './weekly-evidence.js';

export function validateWeeklyEvidence(courseIds, evidence = []) {
  if (!Array.isArray(evidence) || evidence.length > 4 || evidence.some(item => !item || typeof item !== 'object') ||
      new Set(evidence.map(item => item.courseId)).size !== evidence.length ||
      evidence.some(item => !courseIds.includes(item.courseId) ||
        [item.courseId, item.resourceId, item.forumId].some(id => !Number.isSafeInteger(id) || id < 1))) {
    throw new UserError('Choose at most one timetable/forum pair per selected course.');
  }
}

export function isWeeklyLabRange(weekStart, fromDate) {
  if (!isMonday(weekStart)) return false;
  if (fromDate === undefined) return true;
  if (typeof fromDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return false;
  const date = new Date(fromDate + 'T00:00:00Z');
  const end = new Date(weekStart + 'T00:00:00Z');
  end.setUTCDate(end.getUTCDate() + 6);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === fromDate &&
    fromDate >= weekStart && date <= end;
}

export async function collectWeeklyLabs({ courseIds, weekStart, fromDate, evidence = [], readSchedule, readEvidence, now = Date.now }) {
  if (!isWeeklyLabRange(weekStart, fromDate)) {
    throw new UserError('Use a valid Monday and an optional fromDate within that Monday–Sunday week.');
  }
  if (!isMonday(weekStart) || !Array.isArray(courseIds) || courseIds.length < 1 || courseIds.length > 4 ||
      courseIds.some(id => !Number.isSafeInteger(id) || id < 1)) {
    throw new UserError('Select 1 to 4 course IDs and a valid Monday in YYYY-MM-DD format.');
  }
  const courses = [];
  const occurrences = [];
  validateWeeklyEvidence(courseIds, evidence);
  const weekEnd = new Date(weekStart + 'T00:00:00Z');
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const range = { from: weekStart, through: weekEnd.toISOString().slice(0, 10) };
  for (const courseId of new Set(courseIds)) {
    try {
      const schedule = await readSchedule(courseId, weekStart);
      let resolution;
      const source = evidence.find(item => item.courseId === courseId);
      let warnings = [...(schedule.warnings ?? [])];
      if (source && schedule.status !== 'exempt') {
        if (schedule.selectionSource?.term?.group) {
          try {
            const { timetable, announcements } = await readEvidence(source);
            resolution = resolveWeeklyEvidence(schedule, timetable, announcements, range, fromDate ?? weekStart, now());
            warnings = warnings.filter(warning => warning !== 'ANNOUNCEMENTS_AND_CANCELLATIONS_UNCHECKED');
            warnings.push(...resolution.warnings);
          } catch { warnings.push('WEEKLY_EVIDENCE_UNAVAILABLE'); }
        } else warnings.push('WEEKLY_GROUP_UNRESOLVED');
      }
      courses.push({ courseId, status: schedule.status, checkedAt: schedule.checkedAt,
        answerState: schedule.status === 'exempt' ? 'exempt' : resolution?.answerState ?? 'unknown',
        evidence: resolution,
        attendance: schedule.attendance, selectionSource: schedule.selectionSource,
        warnings, coverage: schedule.coverage,
        termLinkedHomework: schedule.termLinkedHomework, scope: resolution?.scope ?? schedule.scope });
      for (const occurrence of resolution?.occurrences ?? schedule.datedOccurrences) {
        if (typeof occurrence.date !== 'string' || occurrence.date < (fromDate ?? weekStart) ||
            !isWeeklyLabRange(weekStart, occurrence.date)) continue;
        occurrences.push({ ...occurrence, courseId, checkedAt: schedule.checkedAt });
      }
    } catch {
      courses.push({ courseId, status: 'unknown', answerState: 'unknown', warnings: ['LAB_SCHEDULE_UNAVAILABLE'] });
    }
  }
  const returnedAt = now();
  for (const course of courses) {
    if (!['scheduled', 'confirmed-none'].includes(course.answerState)) continue;
    if (![course.checkedAt, course.evidence.checkedAt, course.evidence.timetableCheckedAt]
      .every(value => isFreshWeeklySource(value, returnedAt))) {
      course.answerState = 'unknown';
      course.evidence.answerState = 'unknown';
      course.evidence.checksComplete = false;
      course.warnings.push('WEEKLY_EVIDENCE_STALE');
    }
  }
  occurrences.sort((a, b) => a.date.localeCompare(b.date) ||
    (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.courseId - b.courseId);
  return { weekStart, weekEnd: weekEnd.toISOString().slice(0, 10),
    range: { from: fromDate ?? weekStart, through: weekEnd.toISOString().slice(0, 10) },
    timezone: 'Europe/Skopje',
    status: courses.every(course => course.status === 'exempt') ? 'exempt' : 'partial',
    answerState: courses.every(course => course.answerState === 'exempt') ? 'exempt' :
      courses.some(course => course.answerState === 'unknown') ? 'unknown' : occurrences.length ? 'scheduled' : 'confirmed-none',
    occurrences, courses,
    scope: 'Selected calendar days in Europe/Skopje, including the entire fromDate. Explicit timetable/forum evidence may resolve supported recurring/change candidates. Answer states apply only to selected sources; an empty discovery never establishes no labs. Undated homework remains separate.' };
}
