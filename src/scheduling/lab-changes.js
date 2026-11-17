import { isOccurrenceRange } from './occurrences.ts';

const date = '(\\d{4}-\\d{2}-\\d{2})';
const time = '((?:[01]\\d|2[0-3]):[0-5]\\d)';
const token = '([\\p{L}\\p{N}-]{1,16})';
const prefix = /^(?:Lab change|Промена на лаб)\s*:/iu;
const revisionPrefix = /^(?:Lab revision|Ревизија на лаб)\s*:/iu;
const labMention = /\blabs?\b|лаборатор|\blaborator/iu;
const changeMention = /\bcancell?ed\b|\b(?:rescheduled|postponed|moved|revised|updated)\b|откаж|премест|одлож|ревидиран|изменет/iu;
const semesterMention = /за (?:целиот|остатокот од) семестар|for the (?:entire semester|rest of the semester)/iu;
const directive = new RegExp(
  '^([^:]+): (cancel|move|откажано|преместено) \\| ' + token +
  ' \\| ' + date + ' ' + time + '(?: \\| ' + date + ' ' + time + '(?:-' + time + ')? \\| ' + token + ')?$', 'iu',
);
const canonical = value => value.toUpperCase().replace(/[АБЦ]/g, letter => ({ А: 'A', Б: 'B', Ц: 'C' })[letter]);
const validDate = value => isOccurrenceRange({ from: value, through: value });

function parseChange(line) {
  const match = directive.exec(line);
  if (!match) return null;
  const [, , action, group, originalDate, originalTime, newDate, newTime, endTime, room] = match;
  const moved = ['move', 'преместено'].includes(action.toLowerCase());
  if (!validDate(originalDate) || moved !== Boolean(newDate)) return null;
  if (moved && (!validDate(newDate) || (endTime && endTime <= newTime))) return null;
  return {
    group: canonical(group), originalDate, originalTime,
    replacement: moved ? { date: newDate, startTime: newTime, endTime: endTime ?? null, room: canonical(room).toLowerCase() } : null,
  };
}

const weekdays = ['недела', 'понеделник', 'вторник', 'среда', 'четврток', 'петок', 'сабота'];
const proseSlot = new RegExp(
  '^(?:Поради [^,]{1,150}, )?Терминот од лабораторија ' + token + ' во (' + weekdays.join('|') + ') ' +
  time + '[-–]' + time + '(?:ч\\.)? се преместува во лабораторија ' + token +
  ' во (' + weekdays.join('|') + ') ' + time + '[-–]' + time + '(?:ч)?\\.(?= |$)', 'iu',
);

function matchPossibleMove(lines, occurrences) {
  const matches = lines.map(line => proseSlot.exec(line.trim())).filter(Boolean);
  if (matches.length !== 1) return null;
  const [, oldRoom, oldDay, oldStart, oldEnd, newRoom, newDay, newStart, newEnd] = matches[0];
  if (oldEnd <= oldStart || newEnd <= newStart) return null;
  const weekday = date => weekdays[new Date(date + 'T00:00:00Z').getUTCDay()];
  const candidates = occurrences.filter(item =>
    weekday(item.date) === oldDay.toLowerCase() && item.startTime === oldStart &&
    item.endTime === oldEnd && item.room === canonical(oldRoom).toLowerCase());
  if (candidates.length !== 1) return null;
  return {
    occurrenceId: candidates[0].id,
    proposedSlot: { weekdayLabel: newDay.toLowerCase(), startTime: newStart, endTime: newEnd, room: canonical(newRoom).toLowerCase() },
  };
}

export function resolveLabChanges(expansion, announcements) {
  const changes = [];
  const unresolved = [];
  for (const post of announcements?.posts ?? []) {
    const evidence = { sourceUrl: post.sourceUrl, publishedAt: post.publishedAt, updatedAt: post.updatedAt, checkedAt: post.checkedAt };
    const lines = post.text.split('\n');
    const revised = lines.some(line => revisionPrefix.test(line));
    const postChanges = [];
    const postUnresolved = [];
    const prose = [post.title ?? '', ...lines.filter(line => !prefix.test(line) && !revisionPrefix.test(line))].join(' ');
    if (labMention.test(prose) && changeMention.test(prose)) {
      const possibleMove = matchPossibleMove(lines, expansion.occurrences);
      unresolved.push({
        reason: 'POSSIBLE_UNSTRUCTURED_LAB_CHANGE',
        ...(possibleMove ? { possibleMove } : {}),
        ...(semesterMention.test(prose) ? { statedScope: 'semester' } : {}),
        evidence,
      });
    }
    for (const line of lines) {
      const revisionLine = revisionPrefix.test(line);
      if (!prefix.test(line) && !revisionLine) continue;
      const change = parseChange(line);
      if (change && (change.originalDate < expansion.range.from || change.originalDate > expansion.range.through)) continue;
      if (!change || (revised && !revisionLine) || !post.publishedAt || post.warnings.length) {
        postUnresolved.push({ reason: 'UNRESOLVED_ANNOUNCEMENT', evidence });
        continue;
      }
      const matches = expansion.occurrences.filter(item => item.group === change.group &&
        item.date === change.originalDate && item.startTime === change.originalTime);
      if (matches.length !== 1) {
        postUnresolved.push({ reason: 'ORIGINAL_OCCURRENCE_NOT_UNIQUE', evidence });
        continue;
      }
      postChanges.push({ id: matches[0].id, replacement: change.replacement, evidence });
    }
    if (revised && new Set(postChanges.map(change => change.id)).size !== postChanges.length) {
      postUnresolved.push({ reason: 'DUPLICATE_LAB_REVISION_SLOT', evidence });
    }
    unresolved.push(...postUnresolved);
    if (!revised || !postUnresolved.length) changes.push(...postChanges);
    else unresolved.push({ reason: 'LAB_REVISION_NOT_APPLIED', evidence });
  }

  const sessions = expansion.occurrences.map(original => {
    const matching = changes.filter(change => change.id === original.id);
    if (!matching.length) return { status: 'timetable', original };
    const evidence = matching.map(change => change.evidence);
    const replacement = matching[0].replacement;
    if (matching.some(change => JSON.stringify(change.replacement) !== JSON.stringify(replacement))) {
      return { status: 'conflict', original, proposals: matching.map(({ replacement, evidence }) => ({ replacement, evidence })) };
    }
    return replacement
      ? { status: 'moved', original, replacement: { ...original, ...replacement }, evidence }
      : { status: 'cancelled', original, evidence };
  });

  return {
    status: announcements?.status === 'read' && !expansion.unresolved.length && !unresolved.length && !sessions.some(item => item.status === 'conflict')
      ? 'read' : 'partial',
    checkedAt: announcements?.checkedAt ?? null,
    forumUrl: announcements?.sourceUrl ?? null,
    sessions,
    unresolved,
    scope: 'Explicit lab changes and revision rows from the selected news forum. Original session must be inside the requested range. Other formats and sources may contain additional changes.',
  };
}
