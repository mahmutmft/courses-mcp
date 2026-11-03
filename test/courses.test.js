import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { courseFilters, courseTerm, filterCourseList } from '../src/courses.js';

const course = (id, name, shortName = '') => ({ id, name, shortName, url: `https://courses.finki.ukim.mk/course/view.php?id=${id}` });
const result = { courses: [
  course(1, 'Предмет A-2026/2027/Z', 'ПА 26/27'),
  course(2, 'Subject B-2026/2027/L'),
  course(3, 'Предмет В-2025/2026/Z'),
  course(4, 'Информативни'),
  course(5, 'Subject D-2026/2027'),
], truncated: false };

test('recognizes supported full/short year and semester naming variants', () => {
  for (const name of ['A-2026/2027/Z', 'A-2026/27/z', 'A_26-27_З', 'A 2026-2027 Зимски', 'A 2026/2027 winter']) {
    assert.deepEqual(courseTerm(course(1, name)), { academicYear: '2026/2027', semester: 'winter' });
  }
  for (const name of ['A-2026/2027/L', 'A-26/27/l_49_12345', 'A 2026/2027 Летен', 'A 2026/2027 summer']) {
    assert.deepEqual(courseTerm(course(1, name)), { academicYear: '2026/2027', semester: 'summer' });
  }
  assert.deepEqual(courseTerm(course(1, 'A', 'A_26-27_Z')), { academicYear: '2026/2027', semester: 'winter' });
  assert.equal(courseTerm(course(1, 'A-2099/00/Z')).academicYear, '2099/2100');
});

test('unknown, malformed and conflicting labels are not guessed', () => {
  assert.deepEqual(courseTerm(course(1, 'General')), { academicYear: null, semester: null });
  assert.deepEqual(courseTerm(course(1, 'A-2026/2028/Z')), { academicYear: null, semester: null });
  assert.deepEqual(courseTerm(course(1, 'A-2026/2027/Z', 'A-25/26/Z')), { academicYear: null, semester: null });
  assert.deepEqual(courseTerm(course(1, 'A-2026/2027/Z', 'A-26/27/L')), { academicYear: '2026/2027', semester: null });
  assert.equal(courseTerm(course(1, 'A-2026/2027/Zoology')).semester, null);
});

test('no filters preserves every enrollment including unknown labels and source URLs', () => {
  const response = filterCourseList(result);
  assert.deepEqual(response.courses.map(item => item.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(response.courses.map(item => item.url), result.courses.map(item => item.url));
  assert.deepEqual(response.filters, { academicYear: null, semester: null });
  assert.equal(response.unclassifiedCount, 0);
  assert.equal(response.courses[3].academicYear, null);
  assert.equal(result.courses[0].academicYear, undefined); // Input is not mutated.
});

test('combined filters match labels and report unresolved possible matches', () => {
  const response = filterCourseList(result, { academicYear: '2026/2027', semester: 'winter' });
  assert.deepEqual(response.courses.map(item => item.id), [1]);
  assert.equal(response.unclassifiedCount, 2);
  assert.equal(response.truncated, false);
});

test('year-only and semester-only filters work independently', () => {
  assert.deepEqual(filterCourseList(result, { academicYear: '2026/2027' }).courses.map(item => item.id), [1, 2, 5]);
  assert.deepEqual(filterCourseList(result, { semester: 'winter' }).courses.map(item => item.id), [1, 3]);
  const response = filterCourseList(result, { academicYear: '2024/2025', semester: 'summer' });
  assert.deepEqual(response.courses, []);
  assert.equal(response.unclassifiedCount, 1); // Unknown year, not known non-matches.
});

test('upstream truncation is preserved and incomplete labels are not assigned to a semester', () => {
  const response = filterCourseList({ ...result, truncated: true }, { semester: 'summer' });
  assert.equal(response.truncated, true);
  assert.deepEqual(response.courses.map(item => item.id), [2]);
  assert.equal(response.unclassifiedCount, 2);
});

test('schema rejects invalid years/semesters while accepting independent optional filters', () => {
  const schema = z.object(courseFilters);
  for (const args of [{}, { semester: 'summer' }, { academicYear: '2026/2027' }]) assert.equal(schema.safeParse(args).success, true);
  for (const args of [{ academicYear: '26/27' }, { academicYear: '2026/2028' }, { academicYear: '2027/2026' }, { semester: 'Z' }]) {
    assert.equal(schema.safeParse(args).success, false);
  }
});
