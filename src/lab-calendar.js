import { createHash } from 'node:crypto';
import { isOccurrenceRange } from './scheduling/occurrences.ts';
import { isFreshWeeklySource } from './weekly-evidence.js';
import { UserError } from './config.js';

const sourceKey = source => JSON.stringify(source);
const union = (first, second) => [...new Map([...first, ...second].map(source => [sourceKey(source), source])).values()];
const slot = event => JSON.stringify([event.date, event.startTime, event.endTime, event.room, event.timeZone]);
const identitySlot = item => JSON.stringify([item.date, item.startTime, item.group, item.room ?? null]);

export async function collectLabCalendar({ range, readWeek, now = Date.now }) {
  if (!isOccurrenceRange(range)) throw new UserError('Select an inclusive calendar range of 1 to 31 dates.');
  const monday = new Date(range.from + 'T00:00:00Z');
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const end = new Date(range.through + 'T00:00:00Z').getTime();
  const events = new Map();
  const weeks = [];
  const warnings = new Set();
  let stopped = false;
  const add = (courseId, candidate, status, original, changeEvidence = [], checkedAt, answerState, changeProposals = []) => {
    if (!candidate.date || candidate.date < range.from || candidate.date > range.through) return;
    const identity = original?.id ?? candidate.id ?? JSON.stringify([candidate.date, candidate.startTime,
      candidate.group ?? null, candidate.room ?? null]);
    const id = createHash('sha256').update(JSON.stringify([courseId, identity])).digest('hex').slice(0, 24);
    const event = { id, courseId, date: candidate.date, startTime: candidate.startTime ?? null,
      endTime: candidate.endTime ?? null, timeZone: candidate.timeZone ?? null,
      room: candidate.room ?? null, group: candidate.group ?? null, status,
      uncertain: answerState === 'unknown' || status === 'conflict' || !candidate.timeZone,
      checkedAt: checkedAt ?? null, sources: candidate.sources ?? [], changeEvidence,
      changeProposals, endTimeProposals: candidate.endTimeProposals ?? [],
      ...(original ? { original } : {}) };
    const existing = events.get(id);
    if (!existing) { events.set(id, event); return; }
    existing.sources = union(existing.sources, event.sources);
    existing.changeEvidence = union(existing.changeEvidence, event.changeEvidence);
    existing.uncertain ||= event.uncertain;
    if (slot(existing) !== slot(event) || existing.status !== event.status) {
      existing.status = 'conflict'; existing.uncertain = true;
      existing.proposals = [...(existing.proposals ?? [{ date: existing.date, startTime: existing.startTime,
        endTime: existing.endTime, room: existing.room, timeZone: existing.timeZone }]),
      { date: event.date, startTime: event.startTime, endTime: event.endTime, room: event.room, timeZone: event.timeZone }];
      warnings.add('CALENDAR_EVIDENCE_CONFLICT');
    }
  };
  for (let step = 0; step < 6 && monday.getTime() <= end; step++, monday.setUTCDate(monday.getUTCDate() + 7)) {
    const weekStart = monday.toISOString().slice(0, 10);
    if (stopped) { weeks.push({ weekStart, answerState: 'unknown', courses: [] }); continue; }
    try {
      const week = await readWeek(weekStart);
      weeks.push({ weekStart, answerState: week.answerState, courses: week.courses.map(course => ({
        courseId: course.courseId, answerState: course.answerState, checkedAt: course.checkedAt ?? null,
        warnings: course.warnings ?? [],
        timetableCheckedAt: course.evidence?.timetableCheckedAt ?? null,
        forumCheckedAt: course.evidence?.checkedAt ?? null,
      })) });
      if (week.courses.some(course => (course.warnings ?? []).some(warning =>
        ['LAB_SCHEDULE_UNAVAILABLE', 'WEEKLY_EVIDENCE_UNAVAILABLE'].includes(warning)))) {
        stopped = true; warnings.add('CALENDAR_SOURCE_UNAVAILABLE');
      }
      const seen = new Set();
      for (const course of week.courses) {
        for (const session of course.evidence?.sessions ?? []) {
          const effective = session.status === 'moved' ? session.replacement : session.original;
          const matched = session.status !== 'cancelled' && week.occurrences.find(candidate =>
            candidate.courseId === course.courseId && (candidate.id === session.original.id || identitySlot(candidate) === identitySlot(effective)));
          if (matched) seen.add(matched);
          add(course.courseId, matched || effective, matched?.status ?? session.status, session.original,
            union(session.evidence ?? [], matched?.changeEvidence ?? []),
            course.evidence.checkedAt ?? course.checkedAt, course.answerState, session.proposals);
        }
      }
      for (const candidate of week.occurrences) {
        if (seen.has(candidate)) continue;
        const course = week.courses.find(course => course.courseId === candidate.courseId);
        add(candidate.courseId, candidate, candidate.status ?? 'candidate', null, candidate.changeEvidence,
          candidate.checkedAt, course?.answerState ?? 'unknown');
      }
    } catch {
      weeks.push({ weekStart, answerState: 'unknown', courses: [] });
      warnings.add('CALENDAR_WEEK_UNAVAILABLE');
      stopped = true;
    }
  }
  const result = [...events.values()].sort((a, b) => a.date.localeCompare(b.date) ||
    (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.id.localeCompare(b.id));
  const occupied = new Map();
  for (const event of result) {
    if (event.status === 'cancelled' || !event.startTime) continue;
    const key = JSON.stringify([event.date, event.startTime, event.timeZone]);
    const others = occupied.get(key) ?? [];
    for (const other of others) {
      event.collidesWith = [...(event.collidesWith ?? []), other.id];
      other.collidesWith = [...(other.collidesWith ?? []), event.id];
      event.uncertain = other.uncertain = true;
      warnings.add('CALENDAR_TIME_COLLISION');
    }
    others.push(event); occupied.set(key, others);
  }
  const returnedAt = now();
  const staleCourses = new Set();
  for (const week of weeks) for (const course of week.courses) {
    if (!['scheduled', 'confirmed-none'].includes(course.answerState)) continue;
    if (![course.checkedAt, course.timetableCheckedAt, course.forumCheckedAt]
      .every(value => isFreshWeeklySource(value, returnedAt))) {
      staleCourses.add(course.courseId); course.answerState = week.answerState = 'unknown';
      warnings.add('CALENDAR_EVIDENCE_STALE');
    }
  }
  for (const event of result) {
    if (staleCourses.has(event.courseId) || !isFreshWeeklySource(event.checkedAt, returnedAt)) {
      event.uncertain = true; warnings.add('CALENDAR_EVIDENCE_STALE');
    }
  }
  return { range, viewTimezone: 'Europe/Skopje', events: result, weeks, warnings: [...warnings],
    status: warnings.size || result.some(event => event.uncertain) || weeks.some(week => week.answerState === 'unknown') ? 'partial' : 'read',
    scope: 'Read-only civil-date projection of selected weekly evidence. Cancelled entries remain visible; uncertain entries are not confirmed obligations. No UTC instants, default durations, external event writes or complete-course absence claims.' };
}
