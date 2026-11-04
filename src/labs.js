import { UserError } from './config.js';
import { parseChoiceTerm } from './choices.js';

export function isMonday(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1;
}
const labWords = /лаборатор|домашн|laborator|homework|presentation|презентир|detyr[ëe]/iu;
const type = resource => resource.url?.match(/\/mod\/([a-z]+)\/view\.php/)?.[1];
const group = text => {
  const values = [...text.matchAll(/(?:група|group|grupi)\s*[:\-]?\s*([ABАБ])(?![\p{L}\p{N}])/giu)]
    .map(match => ({ А: 'A', Б: 'B' }[match[1].toUpperCase()] || match[1].toUpperCase()));
  return { value: new Set(values).size === 1 ? values[0] : null, ambiguous: new Set(values).size > 1 };
};
function titleDates(text) {
  const dates = [...text.matchAll(/(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/g)]
    .map(([, day, month, year]) => `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
  return { dates: [...new Set(dates)], invalid: dates.some(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value;
  }) };
}

// Course text is evidence, never instructions or permission to write preferences.
export async function buildLabSchedule({ course, preference, weekStart, readChoice, checkedAt = new Date().toISOString() }) {
  if (!isMonday(weekStart)) throw new UserError('weekStart must be a valid Monday in YYYY-MM-DD format.');
  const end = new Date(`${weekStart}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const result = { courseId: course.id, weekStart, weekEnd: end.toISOString().slice(0, 10), timezone: 'Europe/Skopje',
    checkedAt, status: 'unknown', attendance: preference.attendance, selectionSource: null,
    datedOccurrences: [], termLinkedHomework: [], warnings: [], coverage: course.coverage,
    scope: 'Title matching plus saved choice. Undated homework is linked to its presentation term, not confirmed in this week. Supported assignment enrichment is reported separately; quiz details and announcements are not read; cancellations are unchecked. Empty results never prove no labs.' };
  if (preference.attendance === 'exempt') { result.status = 'exempt'; return result; }
  const resources = course.sections.flatMap(section => section.resources.map(resource => ({ ...resource, sectionName: section.name })));
  const choices = resources.filter(resource => type(resource) === 'choice' && labWords.test(resource.name));
  if (choices.length !== 1) {
    result.warnings.push(choices.length ? 'MULTIPLE_LAB_CHOICES' : 'NO_LAB_CHOICE');
    return result;
  }
  let selection;
  try { selection = await readChoice(Number(new URL(choices[0].url).searchParams.get('id'))); }
  catch { result.warnings.push('CHOICE_READ_FAILED'); return result; }
  if (selection.status !== 'selected' || !selection.term?.weekday || !selection.term?.startTime) {
    result.warnings.push('SAVED_TERM_UNRESOLVED'); return result;
  }
  result.selectionSource = { url: selection.sourceUrl, checkedAt: selection.checkedAt, term: selection.term };
  if (course.coverage?.partial) result.warnings.push('PARTIAL_COURSE_COVERAGE');
  const selected = selection.term;
  for (const resource of resources) {
    if (!['assign', 'quiz'].includes(type(resource)) || !labWords.test(`${resource.sectionName} ${resource.name}`)) continue;
    if (/откаж|премест|cancel|reschedul|anulu|shtyr/iu.test(resource.name)) {
      result.warnings.push('ACTIVITY_EXCEPTION_REQUIRES_REVIEW'); continue;
    }
    const activityGroup = group(resource.name);
    if (activityGroup.ambiguous || (activityGroup.value && !selected.group)) { result.warnings.push('ACTIVITY_GROUP_UNRESOLVED'); continue; }
    if (activityGroup.value && activityGroup.value !== selected.group) continue;
    const dates = titleDates(resource.name);
    if (dates.invalid || dates.dates.length > 1) { result.warnings.push('ACTIVITY_DATE_UNRESOLVED'); continue; }
    const evidence = { name: resource.name, sourceUrl: resource.url };
    if (!dates.dates.length) {
      if (!activityGroup.value || activityGroup.value !== selected.group) continue;
      result.termLinkedHomework.push({ ...evidence, date: null, term: selected, status: 'date_unconfirmed',
        reason: 'Group-specific homework uses the saved presentation term; its applicable week is not established by the title.' });
      continue;
    }
    const date = dates.dates[0];
    if (date < result.weekStart || date > result.weekEnd) continue;
    // Activity numbers such as "Lab 2" are not room numbers. Only parse a
    // supported parenthesized slot containing the time, not the title prefix.
    const slots = [...resource.name.matchAll(/\(([^()]*)\)/g)].map(match => match[1]).filter(text => /\d{1,2}:\d{2}/.test(text));
    if (slots.length !== 1) { result.warnings.push('ACTIVITY_SLOT_UNRESOLVED'); continue; }
    const parsed = parseChoiceTerm(slots[0].replace(/\bL(\d+[a-z]*)\b/gi, 'Lab $1')).term;
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    if (weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()] !== selected.weekday ||
      parsed.startTime !== selected.startTime || !selected.room || parsed.room !== selected.room ||
      !activityGroup.value || activityGroup.value !== selected.group) continue;
    const existing = result.datedOccurrences.find(item => item.date === date && item.startTime === parsed.startTime && item.endTime === parsed.endTime);
    if (existing) existing.sources.push(evidence);
    else result.datedOccurrences.push({ date, weekday: selected.weekday, startTime: parsed.startTime,
      endTime: parsed.endTime, room: selected.room, group: selected.group, status: 'published', sources: [evidence] });
  }
  if (result.termLinkedHomework.length) result.warnings.push('HOMEWORK_WEEK_UNCONFIRMED');
  result.warnings.push('ANNOUNCEMENTS_AND_CANCELLATIONS_UNCHECKED');
  result.warnings = [...new Set(result.warnings)];
  if (result.datedOccurrences.length || result.termLinkedHomework.length) result.status = 'partial';
  return result;
}
