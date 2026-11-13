import { load } from 'cheerio';
import { errors } from 'playwright';
import { UserError } from './config.js';

const base = 'https://courses.finki.ukim.mk';
const clean = text => text.replace(/\s+/g, ' ').trim();
const labels = {
  opened: ['opened', 'opens', 'allow submissions from', 'отворено', 'се отвора', 'отворена'],
  due: ['due', 'due date', 'рок за предавање', 'краен рок', 'датум на доспевање'],
  cutoff: ['cut-off date', 'cutoff date', 'краен датум за поднесување'],
};
const months = [
  ['january', 'јануари'], ['february', 'февруари'], ['march', 'март'],
  ['april', 'април'], ['may', 'мај'], ['june', 'јуни'],
  ['july', 'јули'], ['august', 'август'], ['september', 'септември'],
  ['october', 'октомври'], ['november', 'ноември'], ['december', 'декември'],
];
const days = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|понеделник|вторник|среда|четврток|петок|сабота|недела';
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

const quizLabels = {
  opened: [...labels.opened, 'open', 'open the quiz', 'се отвора на'],
  closes: ['closes', 'closed', 'close', 'close the quiz', 'се затвора', 'затворено', 'затворена'],
};

class QuizError extends UserError {
  constructor(code) { super(`Quiz could not be read (${code}).`); this.code = code; }
}

export function parseAssignmentHtml(html, courseId) {
  return parseActivityHtml(html, courseId);
}

export function parseQuizHtml(html, courseId, quizId) {
  return parseActivityHtml(html, courseId, quizId);
}

function parseActivityHtml(html, courseId, quizId) {
  const quiz = quizId !== undefined;
  const kind = quiz ? 'QUIZ' : 'ASSIGNMENT';
  const ErrorType = quiz ? QuizError : AssignmentError;
  const dateLabels = quiz ? quizLabels : labels;
  const $ = load(html);
  const identities = ($('body').attr('class') || '').split(/\s+/).filter(c => /^course-\d+$/.test(c));
  if (identities.length !== 1 || identities[0] !== `course-${courseId}`) throw new ErrorType(`${kind}_OWNERSHIP_UNVERIFIED`);
  if (quiz && ($('body').attr('class') || '').split(/\s+/).filter(c => /^cmid-\d+$/.test(c)).join() !== `cmid-${quizId}`) {
    throw new QuizError('QUIZ_OWNERSHIP_UNVERIFIED');
  }
  if ($('body').attr('id') !== (quiz ? 'page-mod-quiz-view' : 'page-mod-assign-view')) throw new ErrorType(`UNSUPPORTED_${kind}_LAYOUT`);
  if ($('#notice, .errorcode, .alert-danger').length) throw new ErrorType(`${kind}_ACCESS_UNAVAILABLE`);
  $('script,style,noscript,form,input,button,select,textarea,iframe,nav,[hidden],[aria-hidden="true"],.accesshide,.sr-only,.activity-attachments').remove();
  if (quiz) $('.que, .quizattemptsummary, .quizreviewsummary, .quizattempt, .grade, #feedback, [data-region="quiz-attempts"]').remove();
  const root = $('#region-main');
  const intro = root.find('#intro');
  const dates = Object.fromEntries(Object.keys(dateLabels).map(field => [field, null]));
  const warnings = [];
  const seen = Object.fromEntries(Object.keys(dates).map(field => [field, []]));
  const invalid = new Set();
  const rows = root.find('[data-region="activity-dates"] > div, .activity-dates > div');
  if (rows.length > 10) warnings.push(`${kind}_DATE_LIMIT`);
  rows.slice(0, 10).each((_, element) => {
    const row = $(element).clone();
    const label = clean(row.find('strong').first().text()).replace(/:$/, '').trim();
    const field = Object.keys(dateLabels).find(key => dateLabels[key].includes(label.toLowerCase()));
    if (!field) { warnings.push(`${kind}_DATE_LABEL_UNRECOGNIZED`); return; }
    row.find('strong').first().remove();
    const raw = clean(row.text());
    const times = row.find('time[datetime]');
    if (raw.length > 500 || label.length > 80 || times.length > 1) { invalid.add(field); warnings.push(`${kind}_DATE_UNRESOLVED`); return; }
    seen[field].push({ label, raw, ...parseAssignmentDate(raw, times.first().attr('datetime')) });
  });
  for (const field of Object.keys(dates)) {
    const entries = seen[field];
    if (invalid.has(field)) continue;
    if (!entries.length) continue;
    if (new Set(entries.map(entry => JSON.stringify(entry))).size > 1) { warnings.push(`CONFLICTING_${kind}_DATES`); continue; }
    dates[field] = entries[0];
    if (dates[field].parsing === 'unresolved') warnings.push(`${kind}_DATE_UNRESOLVED`);
    else if (!dates[field].timeZone) warnings.push(`${kind}_TIMEZONE_UNKNOWN`);
  }
  intro.find('br').replaceWith('\n');
  intro.find('p,div,tr,li,h1,h2,h3,h4').append('\n');
  intro.find('td,th').append(' ');
  const text = intro.text().split('\n').map(clean).filter(Boolean).join('\n');
  const truncated = text.length > 10000;
  if (truncated) warnings.push(`${kind}_OUTPUT_LIMIT`);
  if (!intro.length) warnings.push(`${kind}_DESCRIPTION_UNAVAILABLE`);
  if (!Object.values(dates).some(Boolean)) warnings.push(`${kind}_DATES_NOT_PUBLISHED_OR_UNSUPPORTED`);
  if (!intro.length && !rows.length) throw new ErrorType(`UNSUPPORTED_${kind}_LAYOUT`);
  return { description: text.slice(0, 10000), dates, truncated, warnings: [...new Set(warnings)] };
}

export function readAssignment(options) {
  return readActivity(options);
}

export function readQuiz(options) {
  return readActivity(options);
}

async function readActivity({ request, course, assignmentId, quizId, timeout = 15000, now = () => new Date().toISOString() }) {
  const quiz = quizId !== undefined;
  const kind = quiz ? 'QUIZ' : 'ASSIGNMENT';
  const ErrorType = quiz ? QuizError : AssignmentError;
  const activityId = quiz ? quizId : assignmentId;
  if (!Number.isSafeInteger(activityId) || activityId < 1) throw new UserError(`${quiz ? 'quizId' : 'assignmentId'} must be a positive safe integer.`);
  const sourceUrl = `${base}/mod/${quiz ? 'quiz' : 'assign'}/view.php?id=${activityId}`;
  const resource = course.sections.flatMap(section => section.resources).find(item => item.url === sourceUrl);
  if (!resource) throw new UserError(`${quiz ? 'Quiz' : 'Assignment'} is not in this course discovery result. Check get_course and its coverage warnings.`);
  let response;
  try {
    response = await request.get(sourceUrl, { maxRedirects: 0, timeout: Math.max(1, Math.min(timeout, 15000)) });
    if (response.status() >= 300 && response.status() < 400) throw new ErrorType(`${kind}_REDIRECT_NOT_FOLLOWED`);
    if (response.status() !== 200) throw new ErrorType(`${kind}_ACCESS_UNAVAILABLE`);
    if (!/^text\/html(?:;|$)/i.test(response.headers()['content-type'] || '')) throw new ErrorType(`UNSUPPORTED_${kind}_CONTENT_TYPE`);
    if (Number(response.headers()['content-length']) > 2 * 1024 * 1024) throw new ErrorType(`${kind}_SIZE_LIMIT`);
    const body = await response.body();
    if (body.byteLength > 2 * 1024 * 1024) throw new ErrorType(`${kind}_SIZE_LIMIT`);
    const parsed = parseActivityHtml(body.toString('utf8'), course.id, quizId);
    if (course.coverage?.partial) parsed.warnings.push('PARTIAL_COURSE_COVERAGE');
    return { courseId: course.id, ...(quiz ? { quizId } : { assignmentId }), name: resource.name, sourceUrl, checkedAt: now(),
      status: parsed.warnings.length ? 'partial' : 'read', ...parsed, coverage: course.coverage,
      scope: quiz ? 'Quiz description and published opening and closing dates only. Display dates without offsets have unknown timezone. Dates do not establish lab occurrences.' : 'Assignment description and supported published activity date fields only. No submissions, grades, feedback, attachments, forms or participant data. Dates are not lab occurrence dates; display dates without offsets have unknown timezone.' };
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new ErrorType(error instanceof errors.TimeoutError ? `${kind}_TIMEOUT` : `${kind}_NETWORK_FAILURE`);
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
