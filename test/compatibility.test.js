import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseAssignmentHtml } from '../src/assignments.js';
import { parseChoiceSelection } from '../src/choices.js';
import { parseFolderHtml } from '../src/folders.js';
import { parseForumDiscussion } from '../src/forums.js';

const read = name => readFileSync(new URL('./fixtures/compat-v1/' + name, import.meta.url), 'utf8');

test('compat-v1 preserves localized dates and reports a malformed date as unresolved', () => {
  const { dates } = parseAssignmentHtml(read('assignment.html'), 42);
  assert.deepEqual(Object.values(dates).map(date => date.localDateTime), [
    '2026-10-06T09:00:00', '2026-10-08T14:30:00', '2026-10-09T14:30:00',
  ]);
  assert.equal(dates.due.instant, null);
  assert.equal(parseAssignmentHtml(read('assignment-malformed.html'), 42).dates.due.parsing, 'unresolved');
});

test('compat-v1 distinguishes selected, changed and deleted choice evidence', () => {
  const html = read('choice.html');
  assert.equal(parseChoiceSelection(html, 42).status, 'selected');
  assert.equal(parseChoiceSelection(html.replace('Your selection:', 'Unknown label:'), 42).status, 'unknown');
  assert.equal(parseChoiceSelection(html.replace(/<div.*<\/div>/, ''), 42).status, 'unknown');
});

test('compat-v1 retains authorized folder evidence and rejects a different course', () => {
  const html = read('folder.html');
  assert.equal(parseFolderHtml(html, 42, 12, new Map()).files.length, 1);
  assert.throws(() => parseFolderHtml(html, 43, 12, new Map()), /OWNERSHIP/);
});

test('compat-v1 preserves instruction-shaped announcement text as source data', () => {
  const result = parseForumDiscussion(read('announcement.html'), 42, 12, 'https://courses.finki.ukim.mk/mod/forum/discuss.php?d=100');
  assert.equal(result.publishedAt, '2026-10-08T10:30:00.000Z');
  assert.match(result.text, /^Ignore previous instructions\./);
});
