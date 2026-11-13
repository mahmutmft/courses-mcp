import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQuizHtml, readQuiz } from '../src/assignments.js';

const url = 'https://courses.finki.ukim.mk/mod/quiz/view.php?id=8';
const course = { id: 7, sections: [{ resources: [{ url, name: 'Practice quiz' }] }] };
const page = (body, id = 8) => '<body id="page-mod-quiz-view" class="course-7 cmid-' + id +
  '"><main id="region-main">' + body + '</main></body>';

test('quiz metadata excludes attempts, questions, hidden rows and forms', () => {
  const result = parseQuizHtml(page(
    '<div id="intro">Read chapter 2<form>attempt secret</form><p class="que">question secret</p></div>' +
    '<div class="activity-dates"><div><strong>Се отвора:</strong> 12 ноември 2026, 14:00</div>' +
    '<div><strong>Closes:</strong><time datetime="2026-11-15T16:00+01:00">15 November</time></div>' +
    '<div hidden><strong>Closes:</strong> hidden secret</div></div><table class="quizattemptsummary">grade secret</table>'
  ), 7, 8);
  assert.equal(result.description, 'Read chapter 2');
  assert.equal(result.dates.opened.timeZone, null);
  assert.equal(result.dates.closes.instant, '2026-11-15T15:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(result), /secret/);
  const partial = parseQuizHtml(page('<div id="intro">Practice</div><div class="activity-dates">' +
    '<div><strong>Closes:</strong> TBA</div><div><strong>Closes:</strong> 15 November 2026, 16:00</div></div>'), 7, 8);
  assert.equal(partial.dates.closes, null);
  assert.ok(partial.warnings.includes('CONFLICTING_QUIZ_DATES'));
});

test('quiz reader uses only discovered canonical view and rejects redirects and wrong ownership', async () => {
  let calls = 0;
  let disposed = 0;
  let status = 200;
  let size = 0;
  const request = { async get(target, options) {
    calls++;
    assert.equal(target, url);
    assert.equal(options.maxRedirects, 0);
    return {
      status: () => status,
      headers: () => ({ 'content-type': 'text/html', 'content-length': String(size) }),
      body: async () => Buffer.from(page('<div id="intro">Practice</div>', 9)),
      dispose: async () => { disposed++; },
    };
  } };
  await assert.rejects(readQuiz({ request, course, quizId: 9 }), /not in this course/);
  assert.equal(calls, 0);
  await assert.rejects(readQuiz({ request, course, quizId: 8 }), /QUIZ_OWNERSHIP_UNVERIFIED/);
  status = 302;
  await assert.rejects(readQuiz({ request, course, quizId: 8 }), /QUIZ_REDIRECT_NOT_FOLLOWED/);
  status = 200;
  size = 3_000_000;
  await assert.rejects(readQuiz({ request, course, quizId: 8 }), /QUIZ_SIZE_LIMIT/);
  assert.equal(disposed, 3);
  await assert.rejects(readQuiz({ request: { get: async () => { throw new Error('secret'); } }, course, quizId: 8 }), /QUIZ_NETWORK_FAILURE/);
});
