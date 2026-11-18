import { isMonday } from './labs.js';
import { UserError } from './config.js';

export async function collectWeeklyLabs({ courseIds, weekStart, readSchedule }) {
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
  return { weekStart, weekEnd: weekEnd.toISOString().slice(0, 10), timezone: 'Europe/Skopje',
    status: courses.every(course => course.status === 'exempt') ? 'exempt' : 'partial',
    occurrences, courses,
    scope: 'Whole Monday–Sunday week for explicit selected courses. Published candidates and undated homework remain distinct. Announcement changes and recurring timetable evidence are not yet integrated; an empty overview does not establish no labs.' };
}
