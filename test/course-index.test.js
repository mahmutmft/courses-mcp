import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCourseIndex, rankCourseIndexes } from '../src/course-index.js';

const course = { id: 42, url: '/course/view.php?id=42', sections: [
  { name: 'Недела', resources: [] }, { name: 'Second week', resources: [] },
] };
const pdf = { courseId: 42, sourceUrl: '/mod/resource/view.php?id=1',
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
