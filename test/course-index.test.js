import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCourseIndex, decodeCourseIndex, rankCourseIndexes } from '../src/course-index.js';

const course = { id: 42, name: 'Synthetic databases', url: '/course/view.php?id=42', sections: [
  { name: 'Недела', resources: [] }, { name: 'Second week', resources: [] },
] };
const pdf = { courseId: 42, name: 'Synthetic notes', sourceUrl: '/mod/resource/view.php?id=1',
  status: 'partial', format: 'pdf', checkedAt: '2026-11-14T08:00:00Z',
  pages: [{ pageNumber: 2, text: 'Распоред LAB' }, { pageNumber: 3, text: 'Lab notes' }],
};

test('index retains page citations, deduplicates sources and excludes other courses', () => {
  const index = buildCourseIndex(course, [pdf, pdf, { ...pdf, courseId: 43, sourceUrl: '/different' },
    { ...pdf, status: 'unsupported', sourceUrl: '/unsupported' }]);
  assert.deepEqual(index.chunks.map(chunk => chunk.page), [null, 2, 3]);
  assert.deepEqual(index.chunks[1].tokens, ['распоред', 'lab']);
  assert.match(index.chunks[0].excerpt, /Second week/);
  assert.equal(index.sources[1].checkedAt, pdf.checkedAt);
  assert.equal(index.sources[2].status, 'unsupported');
  assert.deepEqual(index, buildCourseIndex(course, [pdf, { ...pdf, status: 'unsupported', sourceUrl: '/unsupported' }]));
});

test('index reports deterministic chunk limits', () => {
  const index = buildCourseIndex(course, [{ ...pdf, status: 'read', pages: [{ pageNumber: 1, text: 'lab '.repeat(50_000) }] }]);
  assert.equal(index.chunks.length, 96);
  assert.ok(index.warnings.includes('INDEX_CHUNK_LIMIT'));
  assert.equal(index.sources.find(source => source.url === pdf.sourceUrl).status, 'partial');
});

test('ranking normalizes case and composed Unicode and returns bounded cited hits', () => {
  const index = buildCourseIndex(course, [{ ...pdf, pages: [
    { pageNumber: 1, text: 'café' },
    { pageNumber: 2, text: 'CAFÉ распоред' },
  ] }]);
  const [hit] = rankCourseIndexes([index], 'CAFÉ РАСПОРЕД', 1);
  assert.equal(hit.score, 2);
  assert.equal(hit.page, 2);
  assert.equal(hit.url, pdf.sourceUrl);
  assert.equal(hit.courseName, course.name);
  assert.equal(hit.sourceName, pdf.name);
  assert.equal(hit.checkedAt, pdf.checkedAt);
  assert.deepEqual(rankCourseIndexes([index], 'missing', 10), []);
});

test('words crossing a chunk boundary remain searchable without fragment hits', () => {
  const index = buildCourseIndex(course, [{ ...pdf, pages: [{
    pageNumber: 2, text: 'x '.repeat(498) + 'распоред for Thursday',
  }] }]);
  assert.equal(rankCourseIndexes([index], 'распоред', 1)[0].page, 2);
  assert.deepEqual(rankCourseIndexes([index], 'расп', 10), []);
});

test('an oversized token is skipped and subsequent words remain searchable', () => {
  const index = buildCourseIndex(course, [{ ...pdf, pages: [{
    pageNumber: 2, text: 'a'.repeat(1600) + ' deadline',
  }] }]);
  assert.ok(index.warnings.includes('INDEX_TOKEN_LIMIT'));
  assert.equal(rankCourseIndexes([index], 'deadline', 1)[0].page, 2);
});

test('stored indexes reject incompatible versions, course IDs and broken citations', () => {
  const index = buildCourseIndex(course, [pdf]);
  const decode = value => decodeCourseIndex(JSON.stringify(value), course.id);
  assert.deepEqual(decode(index), index);
  assert.equal(decode({ ...index, version: 2 }), null);
  assert.equal(decode({ ...index, courseId: 43 }), null);
  assert.equal(decode({ ...index, sources: [] }), null);
  assert.equal(decode({ ...index, chunks: [index.chunks[0], index.chunks[0]] }), null);
  assert.equal(decodeCourseIndex('{', course.id), null);
});

test('index skips repeated or invalid PDF page references and marks coverage partial', () => {
  const index = buildCourseIndex(course, [{ ...pdf, status: 'read', pages: [
    { pageNumber: 2, text: 'original' },
    { pageNumber: 2, text: 'duplicate' },
    { pageNumber: 0, text: 'invalid' },
    { pageNumber: 4, text: 'later page' },
  ] }]);
  assert.deepEqual(index.chunks.filter(chunk => chunk.url === pdf.sourceUrl).map(chunk => chunk.page), [2, 4]);
  assert.equal(index.sources.find(source => source.url === pdf.sourceUrl).status, 'partial');
  assert.ok(index.warnings.includes('INDEX_INVALID_PAGE_REFERENCE'));
  assert.deepEqual(decodeCourseIndex(JSON.stringify(index), course.id), index);
});


test('cached index schema rejects extra result fields and malformed display metadata', () => {
  const index = buildCourseIndex(course, [pdf]);
  const decode = value => decodeCourseIndex(JSON.stringify(value), course.id);
  for (const mutation of [
    value => { value.chunks[0].privateNote = 'unexpected local value'; },
    value => { value.sources[0].name = { text: 'invalid title' }; },
    value => { value.courseName = ['invalid title']; },
    value => { value.sources[0].checkedAt = 123; },
    value => { value.extra = 'unexpected root field'; },
  ]) {
    const changed = structuredClone(index);
    mutation(changed);
    assert.equal(decode(changed), null);
  }
  const legacy = structuredClone(index);
  delete legacy.courseName;
  for (const source of legacy.sources) delete source.name;
  assert.deepEqual(decode(legacy), legacy);
});

test('cached tokens must be exactly derived from the cited excerpt', () => {
  const index = buildCourseIndex(course, [pdf]);
  for (const mutation of [
    value => { value.chunks[0].tokens.push('invented'); },
    value => { value.chunks[0].tokens.reverse(); },
    value => { value.chunks[0].tokens = []; },
    value => { value.chunks[0].excerpt = 'unrelated replacement'; },
    value => { value.sources[0].status = 'unsupported'; },
  ]) {
    const changed = structuredClone(index);
    mutation(changed);
    assert.equal(decodeCourseIndex(JSON.stringify(changed), course.id), null);
  }
});

test('cached citations must belong to the caller fresh authorized source set', () => {
  const index = buildCourseIndex(course, [pdf]);
  const allowed = new Set(index.sources.map(source => source.url));
  assert.deepEqual(decodeCourseIndex(JSON.stringify(index), course.id, allowed), index);
  const changed = structuredClone(index);
  const oldUrl = changed.sources[1].url;
  changed.sources[1].url = 'https://unverified.example/private.pdf';
  for (const chunk of changed.chunks) if (chunk.url === oldUrl) chunk.url = changed.sources[1].url;
  assert.equal(decodeCourseIndex(JSON.stringify(changed), course.id, allowed), null);
  allowed.delete(pdf.sourceUrl);
  assert.equal(decodeCourseIndex(JSON.stringify(index), course.id, allowed), null);
});

test('HTML tables and MK/EN text keep stable source/page identities across rebuilds', () => {
  const html = { courseId: course.id, sourceUrl: '/mod/page/view.php?id=8', status: 'read', checkedAt: pdf.checkedAt,
    text: 'Група А\tMonday\t14:00\nGroup B\tTuesday\t16:00', tables: [{ rows: [['Group', 'Day']] }] };
  const index = buildCourseIndex(course, [html, { ...pdf, status: 'unsupported', pages: [] }]);
  assert.deepEqual(index, buildCourseIndex(course, [html, html, { ...pdf, status: 'unsupported', pages: [] }]));
  assert.equal(rankCourseIndexes([index], 'ГРУПА', 1)[0].url, html.sourceUrl);
  assert.equal(rankCourseIndexes([index], 'Tuesday', 1)[0].page, null);
  assert.ok(!index.chunks.some(chunk => chunk.url === pdf.sourceUrl));
  assert.deepEqual(decodeCourseIndex(JSON.stringify(index), course.id), index);
});

test('cached page numbers must have been observed by the current authorized reader', () => {
  const index = buildCourseIndex(course, [pdf]);
  const urls = new Set(index.sources.map(source => source.url));
  const citations = new Set(index.chunks.map(chunk => JSON.stringify([chunk.url, chunk.page])));
  assert.ok(decodeCourseIndex(JSON.stringify(index), course.id, urls, citations));
  index.chunks.find(chunk => chunk.page === 2).page = 999;
  assert.equal(decodeCourseIndex(JSON.stringify(index), course.id, urls, citations), null);
});

test('global text cuts never leave an excerpt token absent from its searchable tokens', () => {
  const text = 'a'.repeat(191980) + ' validword truncatedlongword';
  const index = buildCourseIndex(course, [{ ...pdf, pages: [{ pageNumber: 2, text }] }]);
  assert.ok(index.warnings.includes('INDEX_TEXT_LIMIT'));
  assert.equal(rankCourseIndexes([index], 'validword', 1)[0].page, 2);
  assert.deepEqual(decodeCourseIndex(JSON.stringify(index), course.id), index);
});

test('source limits disclose omitted selected documents without exceeding index bounds', () => {
  const resources = Array.from({ length: 40 }, (_, i) => ({ ...pdf,
    sourceUrl: `/mod/resource/view.php?id=${i + 1}`, status: 'read' }));
  const index = buildCourseIndex(course, resources);
  assert.equal(index.sources.length, 32);
  assert.ok(index.chunks.length <= 96);
  assert.ok(index.warnings.includes('INDEX_SOURCE_LIMIT'));
  assert.deepEqual(decodeCourseIndex(JSON.stringify(index), course.id), index);
});
