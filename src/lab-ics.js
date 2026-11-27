import { UserError } from './config.js';
import { isOccurrenceRange } from './scheduling/occurrences.ts';
import { isFreshWeeklySource } from './weekly-evidence.js';

const eventId = /^[a-f0-9]{24}$/;
const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const hour = 3600000;
const compact = instant => new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

export function escapeCalendarText(value) {
  const text = String(value);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new UserError('Unsupported calendar text (ICS_INVALID_TEXT).');
  return text.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

export function foldCalendarLine(line) {
  const lines = [];
  let part = '', bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > 75) { lines.push(part); part = ' '; bytes = 1; }
    part += character; bytes += size;
  }
  lines.push(part);
  return lines.join('\r\n');
}

// Only explicit supported zones. Ambiguous and nonexistent civil times are
// rejected rather than silently choosing an offset at a DST transition.
export function calendarInstant(date, clock, zone) {
  if (!isOccurrenceRange({ from: date, through: date }) || !time.test(clock ?? '') ||
    Number(date.slice(0, 4)) < 1970 || Number(date.slice(0, 4)) > 9998 ||
    !['Europe/Skopje', 'UTC'].includes(zone)) return null;
  const nominal = Date.parse(`${date}T${clock}:00Z`);
  const format = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const fields = instant => Object.fromEntries(format.formatToParts(instant).map(part => [part.type, part.value]));
  const offsets = new Set([-36, 0, 36].map(delta => {
    const instant = nominal + delta * hour;
    const p = fields(instant);
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - instant;
  }));
  const matches = [...offsets].map(offset => nominal - offset).filter(instant => {
    const p = fields(instant);
    return `${p.year}-${p.month}-${p.day}` === date && `${p.hour}:${p.minute}` === clock;
  });
  return matches.length === 1 ? matches[0] : null;
}

function safeSource(value) {
  try {
    if (typeof value !== 'string' || value.length > 256 || /[\r\n]/.test(value)) return null;
    const url = new URL(value);
    if (url.origin !== 'https://courses.finki.ukim.mk' || url.username || url.password ||
      (url.hash && !/^#p[1-9]\d*$/.test(url.hash))) return null;
    const key = url.pathname === '/mod/forum/discuss.php' ? 'd' : 'id';
    if (!/^\/(?:course\/(?:view|section)|mod\/(?:resource|forum|choice|assign|quiz)\/view|mod\/forum\/discuss)\.php$/.test(url.pathname) ||
      [...url.searchParams.keys()].join() !== key || !/^[1-9]\d*$/.test(url.searchParams.get(key) ?? '') ||
      !Number.isSafeInteger(Number(url.searchParams.get(key)))) return null;
    return url.href;
  } catch { return null; }
}

export function exportLabCalendar(calendar, { eventIds, includeUncertain = false, now = new Date().toISOString() }) {
  if (!isOccurrenceRange(calendar.range) || !Array.isArray(eventIds) || !eventIds.length || eventIds.length > 100 ||
    eventIds.some(id => !eventId.test(id)) || new Set(eventIds).size !== eventIds.length || typeof includeUncertain !== 'boolean') {
    throw new UserError('Select 1 to 100 distinct reviewed calendar event IDs (ICS_INVALID_SELECTION).');
  }
  if (typeof now !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(now) ||
    !Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now) throw new UserError('Calendar export clock is invalid (ICS_INVALID_CLOCK).');
  const skipped = [], components = [];
  for (const id of eventIds) {
    const matches = calendar.events.filter(event => event.id === id);
    const event = matches[0];
    const reject = reason => skipped.push({ eventId: id, reason });
    if (matches.length !== 1) { reject('EVENT_NOT_CURRENT_OR_NOT_UNIQUE'); continue; }
    if (event.status === 'conflict' || (event.endTimeProposals?.length ?? 0) || (event.changeProposals?.length ?? 0) || (event.collidesWith?.length ?? 0)) {
      reject('CONFLICTING_EVIDENCE'); continue;
    }
    if (!['published', 'timetable', 'moved', 'cancelled'].includes(event.status)) { reject('UNRESOLVED_STATUS'); continue; }
    if (event.uncertain && (!includeUncertain || event.status === 'cancelled')) { reject('UNCONFIRMED_EVENT'); continue; }
    if (!isFreshWeeklySource(event.checkedAt, Date.parse(now))) { reject('STALE_EVENT'); continue; }
    if (!event.endTime) { reject('UNKNOWN_END_TIME'); continue; }
    const start = calendarInstant(event.date, event.startTime, event.timeZone);
    const end = calendarInstant(event.date, event.endTime, event.timeZone);
    if (start === null || end === null || end <= start) { reject('UNKNOWN_INVALID_OR_AMBIGUOUS_TIME'); continue; }
    if (event.date < calendar.range.from || event.date > calendar.range.through) { reject('OUTSIDE_RANGE'); continue; }
    if (!Number.isSafeInteger(event.courseId) || event.courseId < 1 ||
      [event.group, event.room].some(value => value !== null && value !== undefined && (typeof value !== 'string' || value.length > 200))) {
      reject('INVALID_EVENT_LABELS'); continue;
    }
    const refs = [...(event.sources ?? []), ...(event.changeEvidence ?? [])];
    const sources = [...new Set(refs.map(ref => safeSource(ref?.url ?? ref?.sourceUrl)).filter(Boolean))].sort();
    if (!sources.length || refs.some(ref => !safeSource(ref?.url ?? ref?.sourceUrl))) { reject('UNSAFE_OR_MISSING_SOURCE'); continue; }
    if (sources.length > 16) { reject('SOURCE_LIMIT'); continue; }
    const description = [
      'Export of explicitly selected lab evidence; not a complete faculty schedule.',
      `Original calendar event ID: ${id}`,
      `Source checked: ${event.checkedAt}`,
      `Civil time: ${event.date} ${event.startTime}-${event.endTime} ${event.timeZone}`,
      `State: ${event.status}${event.uncertain ? ' (tentative; evidence incomplete)' : ''}`,
      ...sources.map(source => `Source: ${source}`),
    ].join('\n');
    components.push(['BEGIN:VEVENT', `UID:${id}@courses-mcp.local`, `DTSTAMP:${compact(now)}`,
      `DTSTART:${compact(start)}`, `DTEND:${compact(end)}`,
      `SUMMARY:${escapeCalendarText(`Laboratory - course ${event.courseId}, group ${event.group ?? 'unknown'}`)}`,
      `LOCATION:${escapeCalendarText(event.room ?? 'Unknown room')}`,
      `DESCRIPTION:${escapeCalendarText(description)}`, `URL:${sources[0]}`,
      `STATUS:${event.status === 'cancelled' ? 'CANCELLED' : event.uncertain ? 'TENTATIVE' : 'CONFIRMED'}`,
      'CLASS:PRIVATE', 'END:VEVENT']);
  }
  const content = components.length ? ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//courses-mcp//Lab export//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...components.flat(), 'END:VCALENDAR'].map(foldCalendarLine).join('\r\n') + '\r\n' : null;
  if (content && Buffer.byteLength(content, 'utf8') > 262144) throw new UserError('Narrow the export selection (ICS_OUTPUT_LIMIT).');
  return { status: !components.length ? 'empty' : skipped.length ? 'partial' : 'ready',
    mediaType: 'text/calendar; charset=utf-8', suggestedFilename: `labs-${calendar.range.from}-${calendar.range.through}.ics`,
    content, exportedCount: components.length, skipped,
    warnings: [...new Set([...(calendar.warnings ?? []), ...(skipped.length ? ['ICS_EVENTS_SKIPPED'] : [])])],
    scope: 'Private export text only; no file was saved or calendar updated. Choose a destination explicitly. Only selected current event IDs are considered; omitted/unknown events do not establish absence. Reimports, cancellations and UID update behavior depend on the calendar client; there is no automatic synchronization.' };
}
