import { buildCourseIndex, rankCourseIndexes } from '../src/course-index.js';
import { measureRetrieval } from './retrieval-scoring.js';

const base = 'https://courses.example';
const groups = [
  [41, 'sql-notes', 2, 'SQL joins inner outer null keys. Спојување табели, надворешен клуч, нормализација и индекси.', [
    'inner joins', 'outer joins', 'надворешен клуч', 'НОРМАЛИЗАЦИЈА', 'SQL индекси',
  ]],
  [41, 'transaction-notes', 4, 'Transactions, isolation levels, deadlocks, rollback, serializability. Трансакции и заклучување.', [
    'transaction isolation levels', 'deadlocks', 'rollback', 'serializability', 'трансакции заклучување',
  ]],
  [42, 'testing-notes', 3, 'Boundary values, equivalence classes, fixtures, mutation testing. Гранични вредности и покриеност.', [
    'boundary values', 'equivalence classes', 'mutation testing', 'fixtures', 'гранични вредности',
  ]],
  [42, 'automation', null, 'Browser automation with Playwright, selectors, assertions and retries. Автоматизација на тестови.', [
    'Playwright selectors', 'browser automation', 'assertions retries', 'автоматизација', 'тестови',
  ]],
  [43, 'statistics', null, 'Regression, covariance, confidence intervals and sampling. Регресија, корелација и примерок. Café survey.', [
    'confidence intervals', 'covariance', 'корелација примерок', 'регресија', 'CAFE\u0301 survey',
  ]],
];

const cases = [];
const byCourse = new Map();
for (const [courseId, slug, page, text, queries] of groups) {
  const url = base + '/material/' + slug;
  const resource = { courseId, sourceUrl: url, status: 'read', text };
  if (page !== null) {
    resource.format = 'pdf';
    resource.pages = [{ pageNumber: page, text }];
  }
  if (!byCourse.has(courseId)) byCourse.set(courseId, []);
  byCourse.get(courseId).push(resource);
  queries.forEach((query, index) => cases.push({ id: slug + '-' + (index + 1), query, expected: [{ courseId, url, page }] }));
}
for (const query of ['integrals', 'геометрија', 'photosynthesis', 'стипендии', 'Kubernetes']) {
  cases.push({ id: 'absent-' + query, query, expected: [] });
}

// Related sources compete for the same five positions.
const distractors = [
  'SQL query planning and execution', 'Joins in a data warehouse', 'Transaction logs and backups',
  'Testing user interfaces', 'Browser settings and accessibility', 'Statistical survey design',
];
for (const [index, text] of distractors.entries()) {
  byCourse.get(43).push({ courseId: 43, sourceUrl: base + '/overview/' + index, status: 'read', text });
}
byCourse.get(43).push({ courseId: 43, sourceUrl: base + '/material/scanned-handout', status: 'unsupported' });
cases.push({ id: 'unindexed-scanned-handout', query: 'spectrophotometer', expected: [] });

const indexes = [...byCourse].map(([id, resources]) => buildCourseIndex({ id, sections: [] }, resources));
const report = measureRetrieval(indexes, cases);
const citations = new Set(indexes.flatMap(index => index.chunks.map(({ url, page }) =>
  JSON.stringify([index.courseId, url, page]))));
const invalidCitations = cases.flatMap(({ query }) => rankCourseIndexes(indexes, query, 5))
  .filter(({ courseId, url, page }) => !citations.has(JSON.stringify([courseId, url, page]))).length;
const unsupportedSources = indexes.flatMap(index => index.sources).filter(source => source.status === 'unsupported').length;
console.log(JSON.stringify({ ...report, invalidCitations, unsupportedSources }, null, 2));
if (cases.length < 30 || report.hitRateAtFive < 0.9 ||
    report.correctNoResults !== report.unanswerable || invalidCitations > 0 || unsupportedSources !== 1) process.exitCode = 1;
