import { z } from 'zod';

export const courseFilters = {
  academicYear: z.string().regex(/^\d{4}\/\d{4}$/)
    .refine(value => Number(value.slice(5)) === Number(value.slice(0, 4)) + 1,
      'Academic year must contain consecutive years, e.g. 2026/2027.')
    .describe('Explicit academic year in YYYY/YYYY format, e.g. 2026/2027. Do not infer from the current date.').optional(),
  semester: z.enum(['winter', 'summer'])
    .describe('winter matches FINKI Z/Зимски labels; summer matches L/Летен labels.').optional(),
};

// These are naming conventions, not official semester or enrollment metadata.
export function courseTerm(course) {
  const years = new Set();
  const semesters = new Set();
  for (const label of [course.name, course.shortName]) {
    const text = String(label || '').normalize('NFKC');
    const pattern = /(?<!\d)(\d{4}|\d{2})\s*[/–-]\s*(\d{4}|\d{2})(?!\d)(?:[\s/_–-]+(winter|summer|зимски|летен|z|l|з|л)(?![\p{L}\p{N}]))?/giu;
    for (const match of text.matchAll(pattern)) {
      const start = match[1].length === 2 ? 2000 + Number(match[1]) : Number(match[1]);
      let end = Number(match[2]);
      if (match[2].length === 2) {
        end += Math.floor(start / 100) * 100;
        if (end < start) end += 100;
      }
      if (end !== start + 1) continue;
      years.add(`${start}/${end}`);
      if (match[3]) semesters.add(/^(winter|зимски|z|з)$/iu.test(match[3]) ? 'winter' : 'summer');
    }
  }
  // Never reconcile conflicting labels by guessing which one is correct.
  const academicYear = years.size === 1 ? [...years][0] : null;
  return { academicYear, semester: academicYear && semesters.size === 1 ? [...semesters][0] : null };
}

export function filterCourseList(result, filters = {}) {
  const selected = [];
  let unclassifiedCount = 0;
  const requested = Object.entries(filters).filter(([key, value]) =>
    ['academicYear', 'semester'].includes(key) && value !== undefined);
  for (const course of result.courses) {
    const term = courseTerm(course);
    // Known non-matches can be excluded even when another requested field is unknown.
    if (requested.some(([key, value]) => term[key] !== null && term[key] !== value)) continue;
    if (requested.some(([key]) => term[key] === null)) {
      unclassifiedCount++;
      continue;
    }
    selected.push({ ...course, ...term });
  }
  return {
    ...result, courses: selected,
    filters: { academicYear: filters.academicYear ?? null, semester: filters.semester ?? null },
    unclassifiedCount,
    classificationSource: 'Course name and short-name labels only; unknown/conflicting labels are not guessed. No date-based inference.',
  };
}
