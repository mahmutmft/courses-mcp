import { load } from 'cheerio';
import { errors } from 'playwright';
import { UserError } from './config.js';

const base = 'https://courses.finki.ukim.mk';
const clean = text => text.replace(/\s+/g, ' ').trim();
export class ForumError extends UserError {
  constructor(code) { super(`Announcements could not be read (${code}).`); this.code = code; }
}

export function forumLink(value, forumId, kind) {
  try {
    const url = new URL(value, base);
    if (url.origin !== base || url.username || url.password) return null;
    const keys = [...url.searchParams.keys()];
    if (kind === 'discussion') {
      if (url.pathname !== '/mod/forum/discuss.php' || keys.length !== 1 || keys[0] !== 'd') return null;
      const id = url.searchParams.get('d');
      return /^[1-9]\d*$/.test(id || '') && Number.isSafeInteger(Number(id)) ? `${base}/mod/forum/discuss.php?d=${Number(id)}` : null;
    }
    if (url.pathname !== '/mod/forum/view.php' || url.hash || !keys.includes('id') ||
      keys.some(key => !['id', 'p'].includes(key)) || new Set(keys).size !== keys.length ||
      url.searchParams.get('id') !== String(forumId)) return null;
    const page = url.searchParams.get('p');
    if (page !== null && (!/^\d{1,2}$/.test(page))) return null;
    return `${base}/mod/forum/view.php?id=${forumId}${page !== null && Number(page) ? `&p=${Number(page)}` : ''}`;
  } catch { return null; }
}

function document(html, courseId, forumId, kind) {
  const $ = load(html);
  const classes = ($('body').attr('class') || '').split(/\s+/);
  if (classes.filter(c => /^course-\d+$/.test(c)).join() !== `course-${courseId}` ||
    classes.filter(c => /^cmid-\d+$/.test(c)).join() !== `cmid-${forumId}`) throw new ForumError('FORUM_OWNERSHIP_UNVERIFIED');
  if ($('body').attr('id') !== `page-mod-forum-${kind}`) throw new ForumError('UNSUPPORTED_FORUM_LAYOUT');
  // The verified index establishes the forum type; faculty discussion bodies
  // omit forumtype-news, but must still prove the same course and module.
  if (kind === 'view' && !classes.includes('forumtype-news')) throw new ForumError('NOT_AN_ANNOUNCEMENT_FORUM');
  if ($('#notice, .errorcode, .alert-danger').length) throw new ForumError('FORUM_ACCESS_UNAVAILABLE');
  $('script,style,noscript,form,input,button,select,textarea,iframe,nav,[hidden],[aria-hidden="true"],.accesshide,.sr-only').remove();
  if ($('#region-main').length !== 1) throw new ForumError('UNSUPPORTED_FORUM_LAYOUT');
  return $;
}

export function parseForumIndex(html, courseId, forumId) {
  const $ = document(html, courseId, forumId, 'view');
  const root = $('#region-main');
  const list = root.find('table.discussion-list');
  const explicitEmpty = root.find('.notification,.alert-info').toArray().some(el =>
    /^There are no discussion topics yet in this forum\.?$/i.test(clean($(el).text())));
  if (!list.length && !explicitEmpty) throw new ForumError('UNSUPPORTED_FORUM_INDEX_LAYOUT');
  const discussions = new Set(), pages = new Set(), warnings = [];
  list.find('.topic a[href]').each((_, el) => {
    const url = forumLink($(el).attr('href'), forumId, 'discussion');
    if (!url) { warnings.push('UNSUPPORTED_DISCUSSION_LINK'); return; }
    if (discussions.size >= 50 && !discussions.has(url)) { warnings.push('FORUM_INDEX_OUTPUT_LIMIT'); return; }
    discussions.add(url);
  });
  if (list.find('tbody tr').length && !discussions.size) warnings.push('FORUM_DISCUSSION_LINKS_UNRESOLVED');
  root.find('.pagination a[href],.paging a[href]').each((_, el) => {
    const url = forumLink($(el).attr('href'), forumId, 'index');
    if (!url) warnings.push('UNSUPPORTED_FORUM_PAGINATION');
    else pages.add(url);
  });
  return { discussions: [...discussions], pages: [...pages], warnings: [...new Set(warnings)] };
}

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?(Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/);
  if (!match || match[3] === '-00:00') return null;
  const local = `${match[1]}${match[2] || ':00'}`;
  const check = new Date(`${local}Z`), instant = new Date(value);
  return Number.isFinite(+check) && check.toISOString().slice(0, 19) === local && Number.isFinite(+instant) ? instant.toISOString() : null;
}

export function parseForumDiscussion(html, courseId, forumId, discussionUrl) {
  const $ = document(html, courseId, forumId, 'discuss');
  const articles = $('#region-main article[data-region="post"]').filter((_, el) => $(el).children('.forumpost.firstpost.starter').length === 1);
  if (articles.length !== 1) throw new ForumError('FORUM_ROOT_POST_UNVERIFIED');
  const article = articles.first();
  const postId = article.attr('data-post-id');
  if (!/^[1-9]\d*$/.test(postId || '') || !Number.isSafeInteger(Number(postId)) || article.attr('id') !== `p${postId}`) throw new ForumError('FORUM_ROOT_POST_UNVERIFIED');
  article.find('[data-region="replies-container"],article,.attachments,.attachedimages,.fileattachments,[data-region="attachments"],.post-actions').remove();
  const header = article.find('.forumpost > .d-flex > header').first();
  // Supported modern Moodle headers; never use author/profile text as metadata.
  const titleNode = header.find('h3').first();
  const content = article.find('.post-content-container');
  if (!header.length || !titleNode.length || content.length !== 1) throw new ForumError('UNSUPPORTED_FORUM_POST_LAYOUT');
  const published = header.find('time');
  const modified = content.find('.modified time');
  const publishedAt = published.length === 1 ? timestamp(published.attr('datetime')) : null;
  const updatedAt = modified.length === 1 ? timestamp(modified.attr('datetime')) : null;
  const publishedRaw = published.length === 1 ? clean(published.text()).slice(0, 200) : null;
  const updatedRaw = modified.length === 1 ? clean(modified.text()).slice(0, 200) : null;
  content.find('.modified').remove();
  content.find('br').replaceWith('\n');
  content.find('p,div,tr,li,h1,h2,h3,h4').append('\n');
  content.find('td,th').append(' ');
  const text = content.text().split('\n').map(clean).filter(Boolean).join('\n');
  const title = clean(titleNode.text());
  const warnings = [];
  if (!publishedAt) warnings.push('FORUM_PUBLICATION_DATE_UNRESOLVED');
  if (modified.length && !updatedAt) warnings.push('FORUM_UPDATE_DATE_UNRESOLVED');
  if (text.length > 10000 || title.length > 200) warnings.push('FORUM_POST_OUTPUT_LIMIT');
  return { discussionId: Number(new URL(discussionUrl).searchParams.get('d')), postId: Number(postId),
    sourceUrl: `${discussionUrl}#p${postId}`, title: title.slice(0, 200), text: text.slice(0, 10000),
    publishedAt, publishedRaw, updatedAt, updatedRaw, warnings };
}

export async function readAnnouncements({ request, course, forumId, now = () => new Date().toISOString(), clock = Date.now }) {
  if (!Number.isSafeInteger(forumId) || forumId < 1) throw new UserError('forumId must be a positive safe integer.');
  const sourceUrl = `${base}/mod/forum/view.php?id=${forumId}`;
  const resource = course.sections.flatMap(s => s.resources).find(r => r.url === sourceUrl);
  if (!resource) throw new UserError('Forum is not in this course discovery result. Check get_course and its coverage warnings.');
  const result = { courseId: course.id, forumId, name: resource.name, sourceUrl, checkedAt: now(), status: 'read', posts: [], unavailableDiscussions: [],
    coverage: { partial: false, indexPagesVisited: 0, discussionPagesVisited: 0, discussionsDiscovered: 0, course: course.coverage, warnings: [] },
    scope: 'Supported news-forum root posts only, within traversal limits; replies, authors/participants, attachments and forms are excluded. Publication/update dates are not lab occurrence dates. Missing/partial announcements never prove no changes or cancellations; no schedule interpretation or persistence.' };
  const warnings = result.coverage.warnings;
  if (course.coverage?.partial) warnings.push('PARTIAL_COURSE_COVERAGE');
  const deadline = clock() + 30000;
  let bytes = 0, textChars = 0;
  const fetchHtml = async url => {
    let response;
    try {
      if (clock() >= deadline) throw new ForumError('FORUM_TIME_LIMIT');
      if (bytes >= 8 * 1024 * 1024) throw new ForumError('FORUM_SIZE_LIMIT');
      response = await request.get(url, { maxRedirects: 0, timeout: Math.max(1, Math.min(10000, deadline - clock())) });
      if (response.status() >= 300 && response.status() < 400) throw new ForumError('FORUM_REDIRECT_NOT_FOLLOWED');
      if (response.status() !== 200) throw new ForumError('FORUM_ACCESS_UNAVAILABLE');
      if (!/^text\/html(?:;|$)/i.test(response.headers()['content-type'] || '')) throw new ForumError('UNSUPPORTED_FORUM_CONTENT_TYPE');
      if (Number(response.headers()['content-length']) > 2 * 1024 * 1024) throw new ForumError('FORUM_SIZE_LIMIT');
      const body = await response.body();
      bytes += body.byteLength;
      if (body.byteLength > 2 * 1024 * 1024 || bytes > 8 * 1024 * 1024) throw new ForumError('FORUM_SIZE_LIMIT');
      return body.toString('utf8');
    } catch (error) {
      if (error instanceof ForumError) throw error;
      throw new ForumError(error instanceof errors.TimeoutError ? 'FORUM_TIMEOUT' : 'FORUM_NETWORK_FAILURE');
    } finally { await response?.dispose().catch(() => {}); }
  };
  const pages = [sourceUrl], visited = new Set(), discussions = new Set();
  while (pages.length) {
    if (result.coverage.indexPagesVisited >= 3) { warnings.push('FORUM_PAGE_LIMIT'); break; }
    const url = pages.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    result.coverage.indexPagesVisited++;
    try {
      const html = await fetchHtml(url);
      const parsed = parseForumIndex(html, course.id, forumId);
      warnings.push(...parsed.warnings);
      for (const link of parsed.discussions) {
        if (discussions.size >= 50 && !discussions.has(link)) { warnings.push('FORUM_DISCOVERY_LIMIT'); break; }
        discussions.add(link);
      }
      for (const link of parsed.pages) if (!visited.has(link) && !pages.includes(link) && pages.length < 100) pages.push(link);
    } catch (error) {
      if (url === sourceUrl) throw error;
      warnings.push(error instanceof ForumError ? error.code : 'FORUM_INDEX_UNAVAILABLE');
    }
  }
  result.coverage.discussionsDiscovered = discussions.size;
  for (const url of discussions) {
    if (result.coverage.discussionPagesVisited >= 10 || textChars >= 40000 || clock() >= deadline || bytes >= 8 * 1024 * 1024) { warnings.push('FORUM_DISCUSSION_OR_TIME_LIMIT'); break; }
    result.coverage.discussionPagesVisited++;
    try {
      const html = await fetchHtml(url);
      const post = parseForumDiscussion(html, course.id, forumId, url);
      if (textChars + post.text.length > 40000) { post.text = post.text.slice(0, 40000 - textChars); post.warnings.push('FORUM_TOTAL_TEXT_LIMIT'); }
      textChars += post.text.length;
      warnings.push(...post.warnings);
      result.posts.push({ ...post, checkedAt: now() });
    } catch (error) {
      const code = error instanceof ForumError ? error.code : 'FORUM_DISCUSSION_UNAVAILABLE';
      warnings.push(code);
      result.unavailableDiscussions.push({ sourceUrl: url, code });
    }
  }
  result.coverage.warnings = [...new Set(warnings)];
  result.coverage.partial = result.coverage.warnings.length > 0;
  result.status = result.coverage.partial ? 'partial' : 'read';
  return result;
}
