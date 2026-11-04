import { load } from 'cheerio';
import { errors } from 'playwright';
import { UserError } from './config.js';

const fields = ['weekday', 'startTime', 'endTime', 'room', 'group'];
const emptyTerm = () => Object.fromEntries(fields.map(key => [key, null]));
const clean = text => text.replace(/\s+/g, ' ').trim();
const dayNames = {
  понеделник: 'monday', monday: 'monday', вторник: 'tuesday', tuesday: 'tuesday',
  среда: 'wednesday', wednesday: 'wednesday', четврток: 'thursday', thursday: 'thursday',
  петок: 'friday', friday: 'friday', сабота: 'saturday', saturday: 'saturday', недела: 'sunday', sunday: 'sunday',
};
const groupName = value => ({ А: 'A', Б: 'B' }[value.toUpperCase()] || value.toUpperCase());

export function parseChoiceTerm(selection) {
  const candidates = Object.fromEntries(fields.map(key => [key, new Set()]));
  let badTimes = false;
  for (const part of selection.normalize('NFKC').split(/\s*\/\s*/)) {
    const dayPattern = new RegExp(`(?<![\\p{L}])(${Object.keys(dayNames).join('|')})(?![\\p{L}])`, 'giu');
    for (const match of part.matchAll(dayPattern)) candidates.weekday.add(dayNames[match[1].toLowerCase()]);
    const times = [];
    for (const match of part.matchAll(/(?<!\d)(\d{1,2}):(\d{2})\s*(AM|PM)?(?!\d)/gi)) {
      let hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (minutes > 59 || hours > 23 || (match[3] && (hours < 1 || hours > 12))) { badTimes = true; continue; }
      if (match[3]) hours = hours % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
      times.push(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
    }
    if (times.length > 2 || (times.length === 2 && times[1] <= times[0])) badTimes = true;
    if (times[0]) candidates.startTime.add(times[0]);
    if (times[1]) candidates.endTime.add(times[1]);
    for (const match of part.matchAll(/(?:лабораторија|лаб\.?|lab\.?)\s*[:\-]?\s*(\d+[a-zа-шѓќ]*)/giu)) {
      candidates.room.add(match[1].toLowerCase().replace(/а/g, 'a').replace(/б/g, 'b').replace(/ц/g, 'c'));
    }
    for (const match of part.matchAll(/(?:група|group)\s*[:\-]?\s*([a-zа-шѓќ]|\d+)(?![\p{L}\p{N}])/giu)) candidates.group.add(groupName(match[1]));
    // Supported faculty layout: "...17:00 Б Лаб. 123".
    const implicit = part.match(/\d{1,2}:\d{2}\s+([АБAB])\s+(?:лаб\.?|lab\.?)(?!\p{L})/iu);
    if (implicit) candidates.group.add(groupName(implicit[1]));
  }
  const term = Object.fromEntries(fields.map(key => [key, candidates[key].size === 1 ? [...candidates[key]][0] : null]));
  if (badTimes || candidates.weekday.size > 1) term.startTime = term.endTime = null;
  return { term, unresolvedFields: fields.filter(key => term[key] === null) };
}

export class ChoiceError extends UserError {
  constructor(code) { super(`Choice selection could not be read (${code}).`); this.code = code; }
}

export function parseChoiceSelection(html, courseId) {
  const $ = load(html);
  const identities = ($('body').attr('class') || '').split(/\s+/).filter(c => /^course-\d+$/.test(c));
  if (identities.length !== 1 || identities[0] !== `course-${courseId}`) throw new ChoiceError('CHOICE_OWNERSHIP_UNVERIFIED');
  if ($('body').attr('id') && $('body').attr('id') !== 'page-mod-choice-view') throw new ChoiceError('UNSUPPORTED_CHOICE_LAYOUT');
  if ($('#notice, .errorcode, .alert-danger').length) throw new ChoiceError('CHOICE_ACCESS_UNAVAILABLE');
  $('script,style,noscript,form,table,iframe,nav,[hidden],[aria-hidden="true"],#intro,.activity-description').remove();
  const selected = new Set();
  let explicitNone = false;
  let invalidLabel = false;
  $('#region-main .generalbox, #region-main .response').each((_, element) => {
    const node = $(element);
    const direct = clean(node.contents().filter((_, child) => child.type === 'text').text());
    // Do not inspect result tables, participants or unchecked/checked form options.
    if (/^(Your selection|Вашиот избор|Твојот избор)\s*:/iu.test(direct)) {
      const value = clean(node.text()).replace(/^(Your selection|Вашиот избор|Твојот избор)\s*:\s*/iu, '');
      if (!value || value.length > 700) invalidLabel = true;
      else selected.add(value);
    }
    if (/^You have not made a choice yet\.?$/i.test(clean(node.text()))) explicitNone = true;
  });
  if (selected.size !== 1 || invalidLabel || explicitNone) {
    return { status: explicitNone && selected.size === 0 && !invalidLabel ? 'not_selected' : 'unknown', selection: null,
      term: emptyTerm(), unresolvedFields: [...fields],
      warnings: selected.size > 1 || (explicitNone && selected.size) ? ['CONFLICTING_SELECTION_MESSAGES']
        : explicitNone && !invalidLabel ? [] : ['SAVED_SELECTION_NOT_RECOGNIZED'] };
  }
  const selection = [...selected][0];
  const parsed = parseChoiceTerm(selection);
  return { status: 'selected', selection, ...parsed, warnings: parsed.unresolvedFields.length ? ['TERM_FIELDS_UNRESOLVED'] : [] };
}

export async function readChoiceSelection({ request, course, choiceId, now = () => new Date().toISOString() }) {
  const sourceUrl = `https://courses.finki.ukim.mk/mod/choice/view.php?id=${choiceId}`;
  if (!course.sections.flatMap(s => s.resources).some(r => r.url === sourceUrl)) {
    throw new UserError('Choice activity is not in this course discovery result. Check get_course and its coverage warnings.');
  }
  let response;
  try {
    response = await request.get(sourceUrl, { maxRedirects: 0, timeout: 15000 });
    if (response.status() >= 300 && response.status() < 400) throw new ChoiceError('CHOICE_REDIRECT_NOT_FOLLOWED');
    if (response.status() !== 200) throw new ChoiceError('CHOICE_ACCESS_UNAVAILABLE');
    if (!/^text\/html(?:;|$)/i.test(response.headers()['content-type'] || '')) throw new ChoiceError('UNSUPPORTED_CHOICE_CONTENT_TYPE');
    if (Number(response.headers()['content-length']) > 2 * 1024 * 1024) throw new ChoiceError('CHOICE_SIZE_LIMIT');
    const body = await response.body();
    if (body.byteLength > 2 * 1024 * 1024) throw new ChoiceError('CHOICE_SIZE_LIMIT');
    return { courseId: course.id, choiceId, sourceUrl, checkedAt: now(), ...parseChoiceSelection(body.toString('utf8'), course.id),
      coverage: course.coverage,
      scope: 'Current user saved choice only. Parsed term fields are labels, not proof of lab attendance, recurrence, or a dated occurrence. No vote is submitted or changed.' };
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new ChoiceError(error instanceof errors.TimeoutError ? 'CHOICE_TIMEOUT' : 'CHOICE_NETWORK_FAILURE');
  } finally { await response?.dispose().catch(() => {}); }
}
