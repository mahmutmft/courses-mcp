import { load } from 'cheerio';
import { errors } from 'playwright';
import { extractPdfText, pdfLimits } from './pdf.js';

const base = 'https://courses.finki.ukim.mk';
export function moodlePdfUrl(value, relativeTo) {
  try {
    const url = new URL(value, relativeTo);
    if (url.origin !== base || url.username || url.password || url.hash) return null;
    if (!/^\/pluginfile\.php\/[1-9]\d*\/mod_resource\/content\/\d+\/.+\.pdf$/i.test(url.pathname)) return null;
    const keys = [...url.searchParams.keys()];
    if (keys.length && (keys.length !== 1 || keys[0] !== 'forcedownload' || !/^[01]$/.test(url.searchParams.get('forcedownload')))) return null;
    return url.href;
  } catch { return null; }
}

export async function readPdfResource({ request, source, courseId, extract = extractPdfText }) {
  let url = source;
  let filePath;
  const seen = new Set();
  const deadline = Date.now() + 15000;
  const fail = code => ({ errorCode: code });
  for (let hop = 0; hop < 5; hop++) {
    if (seen.has(url)) return fail('PDF_REDIRECT_CYCLE');
    seen.add(url);
    let response;
    let target;
    try {
      if (Date.now() >= deadline) return fail('PDF_DOWNLOAD_TIMEOUT');
      response = await request.get(url, { maxRedirects: 0, timeout: Math.max(1, deadline - Date.now()) });
      const status = response.status();
      if (status >= 300 && status < 400) {
        target = response.headers().location;
        if (!target) return fail('PDF_UNSAFE_REDIRECT');
      } else {
        if (status !== 200) return fail('PDF_ACCESS_UNAVAILABLE');
        const type = response.headers()['content-type'] || '';
        const isPdf = /^application\/pdf(?:;|$)/i.test(type);
        const limit = isPdf ? pdfLimits.bytes : 2 * 1024 * 1024;
        if (Number(response.headers()['content-length']) > limit) return fail('PDF_SIZE_LIMIT');
        if (!isPdf && !/^text\/html(?:;|$)/i.test(type)) return fail('PDF_UNSUPPORTED_CONTENT_TYPE');
        const body = await response.body();
        if (body.byteLength > limit) return fail('PDF_SIZE_LIMIT');
        if (isPdf) return await extract(body);
        // Only the original authorized module wrapper may introduce a file URL.
        if (url !== source) return fail('PDF_LOGIN_OR_NON_PDF_RESPONSE');
        const $ = load(body.toString('utf8'));
        const identities = ($('body').attr('class') || '').split(/\s+/).filter(c => /^course-\d+$/.test(c));
        if (identities.length !== 1 || identities[0] !== `course-${courseId}`) return fail('PDF_OWNERSHIP_UNVERIFIED');
        if ($('#notice, .errorcode, .alert-danger').length) return fail('PDF_ACCESS_UNAVAILABLE');
        const node = $('#region-main object#resourceobject[data], #region-main iframe#resourceobject[src], #region-main .resourceworkaround a[href]').first();
        target = node.attr('data') || node.attr('src') || node.attr('href');
        if (!target) return fail('PDF_UNSUPPORTED_RESOURCE_LAYOUT');
      }
    } catch (error) {
      return fail(error instanceof errors.TimeoutError ? 'PDF_DOWNLOAD_TIMEOUT' : 'PDF_DOWNLOAD_FAILED');
    } finally { await response?.dispose().catch(() => {}); }
    const next = moodlePdfUrl(target, url);
    if (!next) return fail('PDF_UNSAFE_REDIRECT');
    // Do not let a file response redirect to a different file/context.
    const path = new URL(next).pathname;
    if (filePath && path !== filePath) return fail('PDF_UNSAFE_REDIRECT');
    filePath = path;
    url = next;
  }
  return fail('PDF_REDIRECT_LIMIT');
}
