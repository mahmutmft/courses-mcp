import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCourseIndex } from '../src/course-index.js';
import { measureRetrieval } from '../scripts/retrieval-scoring.js';

test('retrieval scoring checks the exact PDF page and measures empty results separately', () => {
  const url = 'https://example.test/notes.pdf';
  const [courseId, page] = [42, 2];
  const index = buildCourseIndex({ id: courseId, sections: [] }, [{
    courseId, sourceUrl: url, status: 'read', format: 'pdf',
    pages: [{ pageNumber: page, text: 'SQL joins and indexes' }],
  }]);
  const result = measureRetrieval([index], [
    { id: 'correct-page', query: 'SQL', expected: [{ courseId, url, page }] },
    { id: 'wrong-page', query: 'SQL', expected: [{ courseId, url, page: 3 }] },
    { id: 'no-match', query: 'calculus', expected: [] },
    { id: 'unexpected-match', query: 'joins', expected: [] },
  ]);
  assert.equal(result.answerable, 2);
  assert.equal(result.hitRateAtFive, 0.5);
  assert.equal(result.unanswerable, 2);
  assert.equal(result.correctNoResults, 1);
  assert.deepEqual(result.results.map(item => item.matched), [true, false, true, false]);
});
