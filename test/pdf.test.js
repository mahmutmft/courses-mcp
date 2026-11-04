import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPdfText, pdfLimits } from '../src/pdf.js';
import { readPdfResource, moodlePdfUrl } from '../src/pdf-resource.js';
import { readResourceContent } from '../src/resources.js';
import { errors } from 'playwright';
import { readFileSync } from 'node:fs';

// Small synthetic text-only PDF with real xref offsets; no faculty documents.
function fixturePdf(texts = ['Week one', 'Week two']) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const text of texts) {
    const pageId = objects.length + 1;
    kids.push(`${pageId} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    const stream = text ? `BT /F1 12 Tf 50 700 Td (${text}) Tj ET` : '';
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Count ${texts.length} /Kids [${kids.join(' ')}] >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
const base = 'https://courses.finki.ukim.mk';
const source = `${base}/mod/resource/view.php?id=13`;
const file = `${base}/pluginfile.php/123/mod_resource/content/1/timetable.pdf`;
const course = { id: 42, coverage: { partial: false }, sections: [{ resources: [{ name: 'Synthetic timetable', url: source }] }] };

test('actual isolated PDF parser extracts page-ordered text and reports blank pages', async () => {
  const result = await extractPdfText(fixturePdf(['Wednesday 10:00 Lab 2', '', 'Friday 12:00 Lab 3']));
  assert.equal(result.errorCode, undefined);
  assert.equal(result.pageCount, 3);
  assert.match(result.pages[0].text, /Wednesday 10:00 Lab 2/);
  assert.equal(result.pages[2].pageNumber, 3);
  assert.deepEqual(result.emptyPages, [2]);
});

test('parser rejects malformed/oversized input and enforces page/character/time bounds', async () => {
  assert.equal((await extractPdfText(Buffer.from('not PDF'))).errorCode, 'PDF_INVALID_SIGNATURE');
  assert.equal((await extractPdfText(Buffer.from('%PDF-invalid'))).errorCode, 'PDF_INVALID_OR_UNREADABLE');
  assert.equal((await extractPdfText(fixturePdf(), { limits: { ...pdfLimits, bytes: 5 } })).errorCode, 'PDF_SIZE_LIMIT');
  const limited = await extractPdfText(fixturePdf(), { limits: { ...pdfLimits, pages: 1, characters: 4 } });
  assert.equal(limited.pages.length, 1);
  assert.equal(limited.pages[0].text.length, 4);
  assert.equal(limited.truncated, true);
  assert.equal((await extractPdfText(fixturePdf(), { limits: { ...pdfLimits, milliseconds: 1 } })).errorCode, 'PDF_PARSE_TIMEOUT');
});

test('encrypted synthetic PDF requires a password instead of reporting an empty schedule', async () => {
  // Generated from a blank page with pypdf; test-only password, no private content.
  const bytes = Buffer.from(readFileSync(new URL('./fixtures/encrypted-pdf.base64', import.meta.url), 'utf8').trim(), 'base64');
  const result = await extractPdfText(bytes);
  assert.equal(result.errorCode, 'PDF_PASSWORD_REQUIRED');
});

test('worker startup failure is safe and does not expose a local path', async () => {
  const result = await extractPdfText(fixturePdf(), { workerUrl: new URL('./fixtures/not-a-worker.js', import.meta.url) });
  assert.deepEqual(result, { errorCode: 'PDF_PARSER_FAILED' });
});

function requestFor(entries) {
  const calls = [];
  let disposed = 0;
  return { calls, disposed: () => disposed, get: async (url, options) => {
    assert.equal(options.maxRedirects, 0);
    calls.push(url);
    const entry = entries[calls.length - 1];
    if (!entry) assert.fail('Unexpected request');
    if (entry instanceof Error) throw entry;
    return { status: () => entry.status || 200,
      headers: () => ({ 'content-type': 'application/pdf', ...entry.headers }),
      body: async () => entry.body || fixturePdf(), dispose: async () => { disposed++; } };
  } };
}

test('authorized resource PDF redirect produces per-page source references', async () => {
  const request = requestFor([{ status: 303, headers: { location: file } }, {}]);
  const result = await readResourceContent({ request, course, resourceId: 13 });
  assert.equal(result.status, 'read');
  assert.equal(result.format, 'pdf');
  assert.equal(result.pageCount, 2);
  assert.equal(result.pages[1].sourceUrl, source);
  assert.equal(result.pages[1].pageNumber, 2);
  assert.match(result.text, /\[Page 2\]/);
  assert.ok(!JSON.stringify(result).includes('pluginfile.php'));
  assert.equal(request.disposed(), 2);
});

test('Moodle wrapper file links require course identity and supported resource markup', async () => {
  const wrapper = `<body class="course-42"><main id="region-main"><object id="resourceobject" data="${file}"></object></main></body>`;
  const request = requestFor([{ headers: { 'content-type': 'text/html' }, body: Buffer.from(wrapper) }, {}]);
  assert.equal((await readPdfResource({ request, source, courseId: 42 })).pageCount, 2);
  const wrong = requestFor([{ headers: { 'content-type': 'text/html' }, body: Buffer.from(wrapper.replace('course-42', 'course-43')) }]);
  assert.equal((await readPdfResource({ request: wrong, source, courseId: 42 })).errorCode, 'PDF_OWNERSHIP_UNVERIFIED');
  assert.equal(wrong.calls.length, 1);
});

test('file URL policy rejects external origins, other components, tokens and actions', async () => {
  for (const target of ['https://evil.example/file.pdf', file.replace('mod_resource', 'user'), `${file}?token=PRIVATE`, `${file}?forcedownload=1&delete=1`, `${file}#x`, '/login/index.php']) {
    assert.equal(moodlePdfUrl(target, source), null);
    const request = requestFor([{ status: 303, headers: { location: target } }]);
    assert.equal((await readPdfResource({ request, source, courseId: 42 })).errorCode, 'PDF_UNSAFE_REDIRECT');
    assert.equal(request.calls.length, 1);
  }
  assert.equal(moodlePdfUrl(`${file}?forcedownload=1`, source), `${file}?forcedownload=1`);
  const changed = requestFor([{ status: 303, headers: { location: file } }, { status: 302, headers: { location: file.replace('/123/', '/456/') } }]);
  assert.equal((await readPdfResource({ request: changed, source, courseId: 42 })).errorCode, 'PDF_UNSAFE_REDIRECT');
  assert.equal(changed.calls.length, 2);
});

test('HTTP/MIME/size/download errors and HTML login redirects are explicit', async () => {
  for (const [entry, code] of [
    [{ status: 403 }, 'PDF_ACCESS_UNAVAILABLE'],
    [{ headers: { 'content-type': 'application/zip' } }, 'PDF_UNSUPPORTED_CONTENT_TYPE'],
    [{ headers: { 'content-length': String(pdfLimits.bytes + 1) } }, 'PDF_SIZE_LIMIT'],
    [new Error('PRIVATE'), 'PDF_DOWNLOAD_FAILED'], [new errors.TimeoutError('PRIVATE'), 'PDF_DOWNLOAD_TIMEOUT'],
  ]) {
    const result = await readPdfResource({ request: requestFor([entry]), source, courseId: 42 });
    assert.equal(result.errorCode, code);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
  const login = requestFor([{ status: 303, headers: { location: file } }, { headers: { 'content-type': 'text/html' } }]);
  assert.equal((await readPdfResource({ request: login, source, courseId: 42 })).errorCode, 'PDF_LOGIN_OR_NON_PDF_RESPONSE');
});

test('no text and truncated PDFs are never reported as a complete readable timetable', async () => {
  const blank = await readResourceContent({ request: requestFor([{ body: fixturePdf(['']) }]), course, resourceId: 13 });
  assert.equal(blank.status, 'unsupported');
  assert.deepEqual(blank.warnings, ['PDF_PAGES_WITHOUT_TEXT']);
  const mixed = await readResourceContent({ request: requestFor([{ body: fixturePdf(['Text', '']) }]), course, resourceId: 13 });
  assert.equal(mixed.status, 'partial');
  const invalid = await readResourceContent({ request: requestFor([{ body: Buffer.from('%PDF-invalid') }]), course, resourceId: 13 });
  assert.equal(invalid.status, 'unsupported');
  assert.ok(invalid.warnings.includes('PDF_INVALID_OR_UNREADABLE'));
});

test('malformed or undiscovered module input cannot fetch a file', async () => {
  const request = requestFor([]);
  await assert.rejects(readResourceContent({ request, course, resourceId: 999 }), /not in this course/);
  assert.equal(request.calls.length, 0);
});
