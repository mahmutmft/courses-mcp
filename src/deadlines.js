import { UserError } from './config.js';
import { isOccurrenceRange } from './scheduling/occurrences.ts';

export const maxDeadlineCourses = 10;
const maxActivities = 24;
const activityPath = /^https:\/\/courses\.finki\.ukim\.mk\/mod\/(assign|quiz)\/view\.php\?id=([1-9]\d*)$/;

export async function collectDeadlines({ courseIds, range, discover, read, clock = Date.now }) {
  if (!isOccurrenceRange(range) || !courseIds.length || courseIds.length > maxDeadlineCourses) {
    throw new UserError('Select 1 to 10 courses and an inclusive range of 1 to 31 dates.');
  }
  const budgetEnd = clock() + 45_000;
  const remaining = () => Math.max(0, budgetEnd - clock());
  const warnings = new Set();
  const coverage = [];
  const activities = [];
  const deadlines = [];
  const unavailable = [];

  for (const courseId of new Set(courseIds)) {
    if (!remaining()) {
      coverage.push({ courseId, status: 'skipped' });
      warnings.add('DEADLINE_TIME_LIMIT');
      continue;
    }
    try {
      const course = await discover(courseId, Math.min(6_000, remaining()));
      coverage.push({ courseId, status: course.coverage?.partial ? 'partial' : 'read', discovery: course.coverage });
      if (course.coverage?.partial) warnings.add('PARTIAL_COURSE_COVERAGE');
      const unique = new Set();
      for (const section of course.sections) {
        for (const { url } of section.resources) {
          const match = activityPath.exec(url);
          if (!match || !Number.isSafeInteger(Number(match[2])) || unique.has(url)) continue;
          unique.add(url);
          activities.push({ course, kind: match[1], activityId: Number(match[2]), sourceUrl: url, order: unique.size });
        }
      }
    } catch {
      coverage.push({ courseId, status: 'unavailable' });
      warnings.add('COURSE_DISCOVERY_UNAVAILABLE');
    }
  }

  // Give each selected course a chance before reading its next activity.
  activities.sort((a, b) => a.order - b.order);
  let attempted = 0;
  for (const activity of activities) {
    if (attempted >= maxActivities || !remaining()) {
      warnings.add(attempted >= maxActivities ? 'DEADLINE_ACTIVITY_LIMIT' : 'DEADLINE_TIME_LIMIT');
      break;
    }
    attempted++;
    const { course, kind, activityId, sourceUrl } = activity;
    try {
      const result = await read(activity, Math.min(5_000, remaining()));
      const base = { courseId: course.id, kind, activityId, name: result.name, sourceUrl: result.sourceUrl, checkedAt: result.checkedAt };
      for (const [field, date] of Object.entries(result.dates)) {
        if (!date?.localDateTime) {
          unavailable.push({ ...base, field, status: 'unknown' });
          warnings.add('DEADLINE_FIELDS_UNRESOLVED');
          continue;
        }
        const day = date.localDateTime.slice(0, 10);
        if (range.from <= day && day <= range.through) deadlines.push({ ...base, field, date });
      }
      if (result.warnings.length) warnings.add('PARTIAL_ACTIVITY_METADATA');
    } catch {
      unavailable.push({ courseId: course.id, kind, activityId, sourceUrl, status: 'unavailable' });
      warnings.add('DEADLINE_ACTIVITY_UNAVAILABLE');
    }
  }
  deadlines.sort((a, b) => a.date.localDateTime.localeCompare(b.date.localDateTime));
  return {
    range, deadlines, unavailable, status: warnings.size ? 'partial' : 'read',
    coverage: { courses: coverage, discoveredActivities: activities.length, attempted, warnings: [...warnings] },
    scope: 'Published assignment and quiz fields, filtered by displayed calendar date. Personal extensions, completion and lab presentations are outside this lookup. Partial coverage may omit deadlines.',
  };
}
