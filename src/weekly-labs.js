import { isMonday } from './labs.js';
import { UserError } from './config.js';

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

export async function collectWeeklyLabs({ courseIds, weekStart, fromDate, readSchedule }) {
  if (!isWeeklyLabRange(weekStart, fromDate)) {
    throw new UserError('Use a valid Monday and an optional fromDate within that Monday–Sunday week.');
  }
  if (!isMonday(weekStart) || !Array.isArray(courseIds) || courseIds.length < 1 || courseIds.length > 4 ||
      courseIds.some(id => !Number.isSafeInteger(id) || id < 1)) {
    throw new UserError('Select 1 to 4 course IDs and a valid Monday in YYYY-MM-DD format.');
  }
  const courses = [];
  const occurrences = [];
  for (const courseId of new Set(courseIds)) {
    try {
      const schedule = await readSchedule(courseId, weekStart);
      courses.push({ courseId, status: schedule.status, checkedAt: schedule.checkedAt,
        attendance: schedule.attendance, selectionSource: schedule.selectionSource,
        warnings: schedule.warnings, coverage: schedule.coverage,
        termLinkedHomework: schedule.termLinkedHomework, scope: schedule.scope });
      for (const occurrence of schedule.datedOccurrences) {
        if (typeof occurrence.date !== 'string' || occurrence.date < (fromDate ?? weekStart) ||
            !isWeeklyLabRange(weekStart, occurrence.date)) continue;
        occurrences.push({ ...occurrence, courseId, checkedAt: schedule.checkedAt });
      }
    } catch {
      courses.push({ courseId, status: 'unknown', warnings: ['LAB_SCHEDULE_UNAVAILABLE'] });
    }
  }
  occurrences.sort((a, b) => a.date.localeCompare(b.date) ||
    (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.courseId - b.courseId);
  const weekEnd = new Date(weekStart + 'T00:00:00Z');
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  return { weekStart, weekEnd: weekEnd.toISOString().slice(0, 10),
    range: { from: fromDate ?? weekStart, through: weekEnd.toISOString().slice(0, 10) },
    timezone: 'Europe/Skopje',
    status: courses.every(course => course.status === 'exempt') ? 'exempt' : 'partial',
    occurrences, courses,
    scope: 'Selected calendar days, inclusive, in Europe/Skopje; fromDate includes the entire day, including earlier sessions that day. Published candidates and undated homework remain distinct. Announcement changes and recurring timetable evidence are not yet integrated; an empty overview does not establish no labs.' };
}
