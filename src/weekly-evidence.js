import { expandLabOccurrences } from './scheduling/occurrences.ts';
import { resolveLabChanges } from './scheduling/lab-changes.js';

const key = item => JSON.stringify([item.date, item.startTime, item.group, item.room ?? null]);
export const isFreshWeeklySource = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  now - Date.parse(value) >= 0 && now - Date.parse(value) <= 300000;

export function resolveWeeklyEvidence(schedule, timetable, announcements, range, fromDate, now = Date.now()) {
  const group = schedule.selectionSource?.term?.group;
  const selectedEntries = timetable.entries.filter(entry => entry.group === group);
  const expansion = expandLabOccurrences(timetable.entries, range);
  const changes = resolveLabChanges(expansion, announcements);
  const sessions = changes.sessions.filter(session => session.original.group === group);
  const within = item => item.date >= fromDate && item.date <= range.through;
  const replaced = new Set(sessions.filter(session => ['moved', 'cancelled'].includes(session.status))
    .map(session => key(session.original)));
  const candidates = (schedule.datedOccurrences ?? []).filter(item => !replaced.has(key(item)))
    .map(item => ({ ...item, sources: [...(item.sources ?? [])] }));
  let sourceConflict = false;
  for (const session of sessions) {
    if (session.status === 'cancelled') continue;
    const candidate = session.status === 'moved' ? session.replacement : session.original;
    if (candidate.timeZone !== 'Europe/Skopje') continue;
    const value = { ...candidate, status: session.status, changeEvidence: session.evidence ?? [] };
    const existing = candidates.find(item => key(item) === key(value));
    if (existing) {
      existing.sources = [...(existing.sources ?? []), ...(value.sources ?? [])];
      existing.changeEvidence = value.changeEvidence;
      existing.status = existing.status === 'conflict' ? 'conflict' : value.status;
      if (existing.endTime && value.endTime && existing.endTime !== value.endTime) {
        existing.status = 'conflict';
        existing.endTimeProposals = [existing.endTime, value.endTime];
        sourceConflict = true;
      }
    } else candidates.push(value);
  }
  const occurrences = candidates.filter(within);
  const complete = Boolean(group && selectedEntries.length && !sourceConflict && schedule.attendance === 'attending' &&
    timetable.status === 'read' && announcements?.status === 'read' && changes.status === 'read' &&
    !schedule.coverage?.partial && !(schedule.termLinkedHomework ?? []).length &&
    !(schedule.warnings ?? []).some(warning => warning !== 'ANNOUNCEMENTS_AND_CANCELLATIONS_UNCHECKED') &&
    selectedEntries.every(entry => entry.timeZone === 'Europe/Skopje') &&
    (schedule.datedOccurrences ?? []).every(item => sessions.some(session => key(session.original) === key(item))) &&
    isFreshWeeklySource(schedule.checkedAt, now) && isFreshWeeklySource(timetable.checkedAt, now) && isFreshWeeklySource(announcements.checkedAt, now));
  // Explicit cancellations prove absence only for known selected slots, never an empty discovery.
  const knownCancellations = sessions.filter(session => within(session.original));
  const cancelledOnly = knownCancellations.length > 0 && knownCancellations.every(session => session.status === 'cancelled');
  return { answerState: complete && occurrences.length ? 'scheduled' : complete && cancelledOnly ? 'confirmed-none' : 'unknown',
    occurrences, sessions, checkedAt: announcements?.checkedAt ?? null,
    sourceUrl: timetable.sourceUrl, timetableCheckedAt: timetable.checkedAt,
    forumUrl: announcements?.sourceUrl ?? null, checksComplete: complete,
    warnings: complete ? [] : ['WEEKLY_EVIDENCE_INCOMPLETE',
      ...(timetable.status === 'unsupported' ? ['WEEKLY_TIMETABLE_UNSUPPORTED'] : []),
      ...((timetable.coverage?.warnings ?? []).includes('TIMETABLE_ROSTER_UNSUPPORTED') ? ['WEEKLY_TIMETABLE_ROSTER_UNSUPPORTED'] : []),
    ],
    scope: 'Resolved group in the explicitly selected timetable/news forum only. Confirmed-none requires explicit cancellation of all known in-range slots and no additional candidates/undated work. Other sources and moves from outside the original week remain outside scope.' };
}
