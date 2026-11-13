import { isOccurrenceRange } from './occurrences.ts';

const date = '(\\d{4}-\\d{2}-\\d{2})';
const time = '((?:[01]\\d|2[0-3]):[0-5]\\d)';
const token = '([\\p{L}\\p{N}-]{1,16})';
const prefix = /^(?:Lab change|Промена на лаб)\s*:/iu;
const labMention = /\blabs?\b|лаборатор|\blaborator/iu;
const changeMention = /\bcancell?ed\b|\b(?:rescheduled|postponed|moved|revised|updated)\b|откаж|премест|одлож|ревидиран|изменет/iu;
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

export function resolveLabChanges(expansion, announcements) {
  const changes = [];
  const unresolved = [];
  for (const post of announcements?.posts ?? []) {
    const evidence = { sourceUrl: post.sourceUrl, publishedAt: post.publishedAt, updatedAt: post.updatedAt, checkedAt: post.checkedAt };
    const lines = post.text.split('\n');
    const prose = [post.title ?? '', ...lines.filter(line => !prefix.test(line))].join(' ');
    if (labMention.test(prose) && changeMention.test(prose)) {
      unresolved.push({ reason: 'POSSIBLE_UNSTRUCTURED_LAB_CHANGE', evidence });
    }
    for (const line of lines) {
      if (!prefix.test(line)) continue;
      const change = parseChange(line);
      if (change && (change.originalDate < expansion.range.from || change.originalDate > expansion.range.through)) continue;
      if (!change || !post.publishedAt || post.warnings.length) {
        unresolved.push({ reason: 'UNRESOLVED_ANNOUNCEMENT', evidence });
        continue;
      }
      const matches = expansion.occurrences.filter(item => item.group === change.group &&
        item.date === change.originalDate && item.startTime === change.originalTime);
      if (matches.length !== 1) {
        unresolved.push({ reason: 'ORIGINAL_OCCURRENCE_NOT_UNIQUE', evidence });
        continue;
      }
      changes.push({ id: matches[0].id, replacement: change.replacement, evidence });
    }
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
    scope: 'Explicit lab change lines from the selected news forum. Original session must be inside the requested range. Other formats and sources may contain additional changes.',
  };
}
