import { createHash } from 'node:crypto';

type Range = { from: string; through: string };
type Source = { url: string; kind: string; page?: number; row?: number; line?: number };
type Entry = {
  id: string;
  courseId: number;
  group: string | null;
  weekday: string | null;
  startTime: string | null;
  endTime: string | null;
  room: string | null;
  timeZone: string | null;
  dates: string[];
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  recurrence: 'weekly' | 'alternating' | null;
  anchorDate: string | null;
  sources: Source[];
  warnings: string[];
};

const dayMs = 86_400_000;
const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const optionalFields = new Set(['MISSING_ENDTIME', 'MISSING_ROOM', 'MISSING_GROUP']);

function dayNumber(value: string | null): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value ? +parsed / dayMs : NaN;
}

export function isOccurrenceRange(range: Range): boolean {
  const span = dayNumber(range.through) - dayNumber(range.from);
  return span >= 0 && span < 31;
}

function datesFor(entry: Entry, range: Range): string[] | null {
  if (!entry.timeZone || entry.warnings.some(warning => !optionalFields.has(warning))) return null;
  if (entry.dates.length) return entry.dates.filter(date => range.from <= date && date <= range.through);

  const first = dayNumber(entry.effectiveFrom);
  const last = dayNumber(entry.effectiveUntil);
  const weekday = days.indexOf(entry.weekday ?? '');
  if (!(first <= last) || weekday < 0 || !entry.recurrence) return null;

  // An anchor identifies an active Monday-start teaching week.
  const anchor = dayNumber(entry.anchorDate);
  if (entry.recurrence === 'alternating' && !(anchor >= first && anchor <= last)) return null;
  const mondayWeek = (day: number) => Math.floor((day + 3) / 7);

  const dates: string[] = [];
  for (let day = Math.max(first, dayNumber(range.from)); day <= Math.min(last, dayNumber(range.through)); day++) {
    const date = new Date(day * dayMs);
    if (date.getUTCDay() !== weekday) continue;
    if (entry.recurrence === 'alternating' && (mondayWeek(day) - mondayWeek(anchor)) % 2 !== 0) continue;
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

export function expandLabOccurrences(entries: Entry[], range: Range) {
  if (!isOccurrenceRange(range)) throw new RangeError('Use an inclusive date range of 1 to 31 days.');
  const unresolved = [];
  const occurrences = new Map<string, {
    id: string; courseId: number; group: string | null; date: string;
    startTime: string | null; endTime: string | null; room: string | null;
    timeZone: string | null; sources: Source[];
  }>();

  for (const entry of entries) {
    const dates = datesFor(entry, range);
    if (!dates) {
      unresolved.push({ entryId: entry.id, warnings: entry.warnings.length ? entry.warnings : ['INVALID_RECURRENCE_RULE'] });
      continue;
    }
    for (const date of dates) {
      // Keep wall-clock time across DST. These candidates do not assert a UTC instant.
      const { courseId, group, startTime, endTime, room, timeZone } = entry;
      const term = { courseId, group, date, startTime, endTime, room, timeZone };
      const id = createHash('sha256').update(JSON.stringify(term)).digest('hex').slice(0, 24);
      const existing = occurrences.get(id);
      if (!existing) {
        occurrences.set(id, { id, ...term, sources: [...entry.sources] });
        continue;
      }
      for (const source of entry.sources) {
        if (!existing.sources.some(item => JSON.stringify(item) === JSON.stringify(source))) existing.sources.push(source);
      }
    }
  }

  return {
    range,
    occurrences: [...occurrences.values()].sort((a, b) =>
      a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.id.localeCompare(b.id)),
    unresolved,
  };
}
