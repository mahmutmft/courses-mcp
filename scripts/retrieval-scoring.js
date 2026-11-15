import { rankCourseIndexes } from '../src/course-index.js';

/**
 * Cases declare relevant citations as { courseId, url, page }.
 * An empty expected array represents a query with no answer in the corpus.
 */
export function measureRetrieval(indexes, cases) {
  const results = cases.map(({ id, query, expected }) => {
    const hits = rankCourseIndexes(indexes, query, 5);
    const matched = expected.length
      ? hits.some(hit => expected.some(source => source.courseId === hit.courseId &&
          source.url === hit.url && source.page === hit.page))
      : hits.length === 0;
    return { id, answerable: expected.length > 0, matched };
  });
  const answerable = results.filter(result => result.answerable);
  const unanswerable = results.filter(result => !result.answerable);
  return {
    answerable: answerable.length,
    hitRateAtFive: answerable.length ? answerable.filter(result => result.matched).length / answerable.length : null,
    unanswerable: unanswerable.length,
    correctNoResults: unanswerable.filter(result => result.matched).length,
    results,
  };
}
