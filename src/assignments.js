import { load } from 'cheerio';
import { errors } from 'playwright';
import { UserError } from './config.js';

const base = 'https://courses.finki.ukim.mk';
const clean = text => text.replace(/\s+/g, ' ').trim();
const labels = {
  opened: ['opened', 'opens', 'allow submissions from', 'отворено', 'се отвора', 'отворена', 'hapur', 'hapet'],
  due: ['due', 'due date', 'рок за предавање', 'краен рок', 'датум на доспевање', 'afati', 'afati i dorëzimit'],
  cutoff: ['cut-off date', 'cutoff date', 'краен датум за поднесување', 'afati përfundimtar'],
};
const months = [
  ['january', 'јануари', 'janar'], ['february', 'февруари', 'shkurt'], ['march', 'март', 'mars'],
  ['april', 'април', 'prill'], ['may', 'мај', 'maj'], ['june', 'јуни', 'qershor'],
  ['july', 'јули', 'korrik'], ['august', 'август', 'gusht'], ['september', 'септември', 'shtator'],
  ['october', 'октомври', 'tetor'], ['november', 'ноември', 'nëntor'], ['december', 'декември', 'dhjetor'],
];
const days = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|понеделник|вторник|среда|четврток|петок|сабота|недела|e hënë|e martë|e mërkurë|e enjte|e premte|e shtunë|e diel';
function validLocal(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(`${value}Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 19) === value;
}
// No Date.parse of localized text or implicit host/session timezone.
export function parseAssignmentDate(raw, machine) {
  if (machine) {
    const match = machine.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?(Z|[+-]\d{2}:\d{2})$/);
    if (match && validLocal(`${match[1]}${match[2] || ':00'}`) &&
      (match[3] === 'Z' || /^[-+](?:(?:0\d|1[0-3]):[0-5]\d|14:00)$/.test(match[3]))) {
      const instant = new Date(machine);
      if (Number.isFinite(+instant)) return { localDateTime: `${match[1]}${match[2] || ':00'}`, instant: instant.toISOString(), timeZone: match[3], parsing: 'machine_offset' };
    }
    return { localDateTime: null, instant: null, timeZone: null, parsing: 'unresolved' };
  }
  const text = clean(raw).toLowerCase().replace(new RegExp(`^(?:${days}),?\\s+`, 'iu'), '');
  const monthNames = months.flat().join('|');
  const match = text.match(new RegExp(`^(\\d{1,2}) (${monthNames}) (\\d{4}),? (\\d{1,2}):(\\d{2})(?:\\s*(am|pm))?$`, 'iu'));
  if (!match) return { localDateTime: null, instant: null, timeZone: null, parsing: 'unresolved' };
  const [, day, month, year, hour, minute, period] = match;
  let hours = Number(hour);
  if (period && (hours < 1 || hours > 12)) return { localDateTime: null, instant: null, timeZone: null, parsing: 'unresolved' };
  if (period) hours = hours % 12 + (period === 'pm' ? 12 : 0);
  const value = `${year}-${String(months.findIndex(names => names.includes(month)) + 1).padStart(2, '0')}-${day.padStart(2, '0')}T${String(hours).padStart(2, '0')}:${minute}:00`;
  return validLocal(value) ? { localDateTime: value, instant: null, timeZone: null, parsing: 'display_text_timezone_unknown' }
    : { localDateTime: null, instant: null, timeZone: null, parsing: 'unresolved' };
}

export class AssignmentError extends UserError {
  constructor(code) { super(`Assignment could not be read (${code}).`); this.code = code; }
}

export function parseAssignmentHtml(html, courseId) {
  const $ = load(html);
  const identities = ($('body').attr('class') || '').split(/\s+/).filter(c => /^course-\d+$/.test(c));
  if (identities.length !== 1 || identities[0] !== `course-${courseId}`) throw new AssignmentError('ASSIGNMENT_OWNERSHIP_UNVERIFIED');
  if ($('body').attr('id') !== 'page-mod-assign-view') throw new AssignmentError('UNSUPPORTED_ASSIGNMENT_LAYOUT');
  if ($('#notice, .errorcode, .alert-danger').length) throw new AssignmentError('ASSIGNMENT_ACCESS_UNAVAILABLE');
  $('script,style,noscript,form,input,button,select,textarea,iframe,nav,[hidden],[aria-hidden="true"],.accesshide,.sr-only,.activity-attachments').remove();
  const root = $('#region-main');
  const intro = root.find('#intro');
  const dates = { opened: null, due: null, cutoff: null };
  const warnings = [];
  const seen = { opened: [], due: [], cutoff: [] };
  const invalid = new Set();
  const rows = root.find('[data-region="activity-dates"] > div, .activity-dates > div');
  if (rows.length > 10) warnings.push('ASSIGNMENT_DATE_LIMIT');
  rows.slice(0, 10).each((_, element) => {
    const row = $(element).clone();
    const label = clean(row.find('strong').first().text()).replace(/:$/, '').trim();
    const field = Object.keys(labels).find(key => labels[key].includes(label.toLowerCase()));
    if (!field) { warnings.push('ASSIGNMENT_DATE_LABEL_UNRECOGNIZED'); return; }
    row.find('strong').first().remove();
    const raw = clean(row.text());
    const times = row.find('time[datetime]');
    if (raw.length > 500 || label.length > 80 || times.length > 1) { invalid.add(field); warnings.push('ASSIGNMENT_DATE_UNRESOLVED'); return; }
    seen[field].push({ label, raw, ...parseAssignmentDate(raw, times.first().attr('datetime')) });
  });
  for (const field of Object.keys(dates)) {
    const entries = seen[field];
    if (invalid.has(field)) continue;
    if (!entries.length) continue;
    if (new Set(entries.map(entry => JSON.stringify(entry))).size > 1) { warnings.push('CONFLICTING_ASSIGNMENT_DATES'); continue; }
    dates[field] = entries[0];
    if (dates[field].parsing === 'unresolved') warnings.push('ASSIGNMENT_DATE_UNRESOLVED');
    else if (!dates[field].timeZone) warnings.push('ASSIGNMENT_TIMEZONE_UNKNOWN');
  }
  intro.find('br').replaceWith('\n');
  intro.find('p,div,tr,li,h1,h2,h3,h4').append('\n');
  intro.find('td,th').append(' ');
  const text = intro.text().split('\n').map(clean).filter(Boolean).join('\n');
  const truncated = text.length > 10000;
  if (truncated) warnings.push('ASSIGNMENT_OUTPUT_LIMIT');
  if (!intro.length) warnings.push('ASSIGNMENT_DESCRIPTION_UNAVAILABLE');
  if (!Object.values(dates).some(Boolean)) warnings.push('ASSIGNMENT_DATES_NOT_PUBLISHED_OR_UNSUPPORTED');
  if (!intro.length && !rows.length) throw new AssignmentError('UNSUPPORTED_ASSIGNMENT_LAYOUT');
  return { description: text.slice(0, 10000), dates, truncated, warnings: [...new Set(warnings)] };
}

export async function readAssignment({ request, course, assignmentId, timeout = 15000, now = () => new Date().toISOString() }) {
  if (!Number.isSafeInteger(assignmentId) || assignmentId < 1) throw new UserError('assignmentId must be a positive safe integer.');
  const sourceUrl = `${base}/mod/assign/view.php?id=${assignmentId}`;
  const resource = course.sections.flatMap(section => section.resources).find(item => item.url === sourceUrl);
  if (!resource) throw new UserError('Assignment is not in this course discovery result. Check get_course and its coverage warnings.');
  let response;
  try {
    response = await request.get(sourceUrl, { maxRedirects: 0, timeout: Math.max(1, Math.min(timeout, 15000)) });
    if (response.status() >= 300 && response.status() < 400) throw new AssignmentError('ASSIGNMENT_REDIRECT_NOT_FOLLOWED');
    if (response.status() !== 200) throw new AssignmentError('ASSIGNMENT_ACCESS_UNAVAILABLE');
    if (!/^text\/html(?:;|$)/i.test(response.headers()['content-type'] || '')) throw new AssignmentError('UNSUPPORTED_ASSIGNMENT_CONTENT_TYPE');
    if (Number(response.headers()['content-length']) > 2 * 1024 * 1024) throw new AssignmentError('ASSIGNMENT_SIZE_LIMIT');
    const body = await response.body();
    if (body.byteLength > 2 * 1024 * 1024) throw new AssignmentError('ASSIGNMENT_SIZE_LIMIT');
    const parsed = parseAssignmentHtml(body.toString('utf8'), course.id);
    if (course.coverage?.partial) parsed.warnings.push('PARTIAL_COURSE_COVERAGE');
    return { courseId: course.id, assignmentId, name: resource.name, sourceUrl, checkedAt: now(),
      status: parsed.warnings.length ? 'partial' : 'read', ...parsed, coverage: course.coverage,
      scope: 'Assignment description and supported published activity date fields only. No submissions, grades, feedback, attachments, forms or participant data. Dates are not lab occurrence dates; display dates without offsets have unknown timezone.' };
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new AssignmentError(error instanceof errors.TimeoutError ? 'ASSIGNMENT_TIMEOUT' : 'ASSIGNMENT_NETWORK_FAILURE');
  } finally { await response?.dispose().catch(() => {}); }
}

export async function enrichLabHomework(schedule, read, { now = Date.now } = {}) {
  const deadline = now() + 30000;
  let reads = 0;
  for (const item of schedule.termLinkedHomework) {
    if (!/^https:\/\/courses\.finki\.ukim\.mk\/mod\/assign\/view\.php\?id=[1-9]\d*$/.test(item.sourceUrl)) continue;
    if (reads >= 5 || now() >= deadline) { schedule.warnings.push('ASSIGNMENT_ENRICHMENT_LIMIT'); break; }
    reads++;
    try {
      item.assignment = await read(Number(new URL(item.sourceUrl).searchParams.get('id')), Math.max(1, deadline - now()));
      const dueDate = item.assignment.dates.due?.localDateTime?.slice(0, 10);
      item.deadlineRelation = !dueDate ? 'unknown' : dueDate < schedule.weekStart ? 'displayed_due_before_week'
        : dueDate > schedule.weekEnd ? 'displayed_due_after_week' : 'displayed_due_within_week';
      item.deadlineScope = 'Calendar comparison of displayed due date only. Not presentation date, completion, availability, or proof this lab occurs in the requested week. Timezone may be unknown.';
      if (item.assignment.status === 'partial') schedule.warnings.push('ASSIGNMENT_DETAILS_PARTIAL');
    } catch { item.assignment = { status: 'unavailable' }; schedule.warnings.push('ASSIGNMENT_DETAILS_UNAVAILABLE'); }
  }
  schedule.warnings = [...new Set(schedule.warnings)];
  schedule.scope += ' Matching assignment homework may include bounded description/date enrichment. Due dates never establish presentation occurrences or completion.';
  return schedule;
}
