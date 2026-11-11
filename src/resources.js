import { load } from 'cheerio';
import { errors } from 'playwright';
import { UserError } from './config.js';
import { readPdfResource } from './pdf-resource.js';

const base = 'https://courses.finki.ukim.mk';
const clean = value => value.replace(/\s+/g, ' ').trim();
export function moduleUrl(value) {
  try {
    const url = new URL(value, base);
    if (url.origin !== base || url.username || url.password || !/^\/mod\/[a-z]+\/view\.php$/.test(url.pathname)) return null;
    const keys = [...url.searchParams.keys()];
    if (keys.length !== 1 || keys[0] !== 'id' || !/^[1-9]\d*$/.test(url.searchParams.get('id') || '')) return null;
    if (!Number.isSafeInteger(Number(url.searchParams.get('id')))) return null;
    return `${base}${url.pathname}?id=${Number(url.searchParams.get('id'))}`;
  } catch { return null; }
}

export class ResourceError extends UserError {
  constructor(code) { super(`Resource could not be read (${code}).`); this.code = code; }
}

export function parseResourceHtml(html, courseId, url, allowed) {
  const $ = load(html);
  const identity = ($('body').attr('class') || '').split(/\s+/).filter(c => /^course-\d+$/.test(c));
  if (identity.length !== 1 || identity[0] !== `course-${courseId}`) throw new ResourceError('RESOURCE_OWNERSHIP_UNVERIFIED');
  if ($('#notice, .errorcode, .alert-danger').length) throw new ResourceError('RESOURCE_ACCESS_UNAVAILABLE');
  // Read server-rendered content only. No script execution, frame loads or form actions.
  $('script, style, noscript, form, input, button, select, textarea, iframe, nav, [hidden], .accesshide, .sr-only, [aria-hidden="true"]').remove();
  const root = $('#region-main');
  const isUrl = new URL(url).pathname === '/mod/url/view.php';
  const content = isUrl ? root.find('.activity-description, .mod_introbox, .urlworkaround')
    : root.find('.generalbox .no-overflow').length ? root.find('.generalbox .no-overflow') : root.find('.generalbox');
  let truncated = false;
  const tables = [];
  content.find('table').each((index, table) => {
    if (index >= 10) { truncated = true; return; }
    const rows = [];
    $(table).find('tr').each((rowIndex, row) => {
      if (rowIndex >= 100) { truncated = true; return; }
      const cells = [];
      $(row).children('th,td').each((colIndex, cell) => {
        const text = clean($(cell).text());
        if (colIndex >= 20 || text.length > 500) truncated = true;
        if (colIndex < 20) cells.push(text.slice(0, 500));
      });
      rows.push(cells);
    });
    const unsupportedLayout = $(table).find('[rowspan],[colspan],table').toArray().some(cell =>
      cell.tagName === 'table' || Number($(cell).attr('rowspan') || 1) !== 1 || Number($(cell).attr('colspan') || 1) !== 1);
    tables.push({ rows, ...(unsupportedLayout ? { unsupportedLayout: true } : {}) });
  });
  const links = new Set();
  content.find('a[href]').each((_, anchor) => {
    const canonical = moduleUrl($(anchor).attr('href'));
    if (canonical && allowed.has(canonical)) {
      if (links.size >= 50) truncated = true;
      else links.add(canonical);
    }
  });
  const target = isUrl ? root.find('.urlworkaround a[href]').first().attr('href') : undefined;
  // Wrapper link text often repeats the full destination (including signed queries).
  // Return safe destination metadata separately instead of echoing it as page text.
  if (isUrl) root.find('.urlworkaround').empty();
  content.find('br').replaceWith('\n');
  content.find('td,th').append(' ');
  content.find('p,div,tr,li,h1,h2,h3,h4').append('\n');
  const text = content.map((_, element) => $(element).text()).get().join('\n')
    .split('\n').map(clean).filter(Boolean).join('\n');
  if (text.length > 20000) truncated = true;
  return { text: text.slice(0, 20000), tables, links: [...links], truncated, target };
}

export async function readResourceContent({ request, course, resourceId, now = () => new Date().toISOString() }) {
  const allowed = new Map();
  for (const resource of course.sections.flatMap(section => section.resources)) {
    const url = moduleUrl(resource.url);
    if (url) allowed.set(url, resource);
  }
  const source = [...allowed.keys()].find(url => Number(new URL(url).searchParams.get('id')) === resourceId);
  if (!source) throw new UserError('Resource is not in this course discovery result. Check get_course and its coverage warnings.');
  const result = { courseId: course.id, resourceId, name: allowed.get(source).name, sourceUrl: source,
    checkedAt: now(), status: 'unsupported', text: '', tables: [], links: [], truncated: false,
    coverage: course.coverage, warnings: [], scope: 'Supported Moodle HTML only; no external browsing, forms, PDFs, folders, or timetable inference.' };
  if (new URL(source).pathname === '/mod/resource/view.php') {
    const pdf = await readPdfResource({ request, source, courseId: course.id });
    result.format = 'pdf';
    result.scope = 'Text from supported Moodle PDFs only; no OCR, semantic table reconstruction, or lab schedule inference.';
    result.pages = (pdf.pages || []).map(page => ({ ...page, sourceUrl: source }));
    result.pageCount = pdf.pageCount ?? null;
    result.truncated = pdf.truncated || false;
    result.emptyPages = pdf.emptyPages || [];
    result.failedPages = pdf.failedPages || [];
    result.text = result.pages.map(page => `[Page ${page.pageNumber}]\n${page.text}`).join('\n\n');
    if (pdf.errorCode) result.warnings.push(pdf.errorCode);
    if (result.emptyPages.length) result.warnings.push('PDF_PAGES_WITHOUT_TEXT');
    if (result.failedPages.length) result.warnings.push('PDF_UNREADABLE_PAGES');
    if (result.truncated) result.warnings.push('PDF_OUTPUT_LIMIT');
    result.status = !result.pages.some(page => page.text.trim()) ? 'unsupported' : result.warnings.length ? 'partial' : 'read';
    return result;
  }
  const visited = new Set();
  let url = source;
  const deadline = Date.now() + 15000;
  const unsupported = code => { result.warnings.push(code); result.status = result.text ? 'partial' : 'unsupported'; return result; };
  for (let hop = 0; hop < 5; hop++) {
    if (!allowed.has(url) || !/^\/mod\/(page|url)\/view\.php$/.test(new URL(url).pathname)) return unsupported('UNSUPPORTED_RESOURCE_TYPE');
    if (visited.has(url)) return unsupported('RESOURCE_REDIRECT_CYCLE');
    visited.add(url);
    let response;
    let target;
    try {
      if (Date.now() >= deadline) throw new ResourceError('RESOURCE_TIMEOUT');
      const fetchUrl = url.includes('/mod/url/') ? `${url}&redirect=0` : url;
      response = await request.get(fetchUrl, { maxRedirects: 0, timeout: Math.max(1, deadline - Date.now()) });
      const status = response.status();
      if (status >= 300 && status < 400) {
        target = response.headers().location;
        if (!target) throw new ResourceError('UNSAFE_RESOURCE_REDIRECT');
      } else {
        if (status !== 200) throw new ResourceError('RESOURCE_ACCESS_UNAVAILABLE');
        if (!/^text\/html(?:;|$)/i.test(response.headers()['content-type'] || '')) return unsupported('UNSUPPORTED_CONTENT_TYPE');
        if (Number(response.headers()['content-length']) > 2 * 1024 * 1024) throw new ResourceError('RESOURCE_SIZE_LIMIT');
        const body = await response.body();
        if (body.byteLength > 2 * 1024 * 1024) throw new ResourceError('RESOURCE_SIZE_LIMIT');
        const parsed = parseResourceHtml(body.toString('utf8'), course.id, url, allowed);
        result.resolvedUrl = url;
        result.text = parsed.text;
        result.tables = parsed.tables;
        result.links = parsed.links;
        result.truncated = parsed.truncated;
        target = parsed.target;
        if (!target) {
          if (url.includes('/mod/url/')) return unsupported('URL_DESTINATION_UNAVAILABLE');
          if (!result.text && !result.tables.length) return unsupported('UNSUPPORTED_CONTENT_LAYOUT');
          result.status = result.truncated ? 'partial' : 'read';
          if (result.truncated) result.warnings.push('RESOURCE_OUTPUT_LIMIT');
          return result;
        }
      }
    } catch (error) {
      if (error instanceof ResourceError) throw error;
      throw new ResourceError(error instanceof errors.TimeoutError ? 'RESOURCE_TIMEOUT' : 'RESOURCE_NETWORK_FAILURE');
    } finally { await response?.dispose().catch(() => {}); }
    let destination;
    try { destination = new URL(target, url); } catch { throw new ResourceError('UNSAFE_RESOURCE_REDIRECT'); }
    if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password) throw new ResourceError('UNSAFE_RESOURCE_REDIRECT');
    if (destination.origin !== base) {
      // Do not disclose destination queries, fragments, paths, or embedded credentials.
      result.externalOrigin = destination.origin;
      return unsupported('EXTERNAL_ORIGIN_NOT_SUPPORTED');
    }
    const canonical = moduleUrl(destination.href);
    if (!canonical || !allowed.has(canonical)) throw new ResourceError('UNSAFE_RESOURCE_REDIRECT');
    url = canonical;
  }
  return unsupported('RESOURCE_REDIRECT_LIMIT');
}
