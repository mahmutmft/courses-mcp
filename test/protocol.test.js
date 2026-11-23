import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { toolContracts } from '../scripts/tool-contracts.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import packageInfo from '../package.json' with { type: 'json' };

test('stdio initializes, lists read-only tools, and validates inputs without signing in', async () => {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../src/index.js', import.meta.url))],
    env: { ...process.env, MOODLE_USERNAME: '', MOODLE_PASSWORD: '', MOODLE_BASE_URL: 'https://courses.finki.ukim.mk' },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'smoke-test', version: '1.0.0' });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += chunk; });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.version, packageInfo.version);
    for (const arguments_ of [
      { courseIds: [42], range: { from: '2026-11-01', through: '2026-12-02' } },
      { courseIds: [42], range: { from: '2026-11-01', through: '2026-11-07' }, evidence: [{ courseId: 43, resourceId: 7, forumId: 8 }] },
    ]) {
      const invalid = await client.callTool({ name: 'get_lab_calendar', arguments: arguments_ });
      assert.equal(invalid.isError, true);
      assert.doesNotMatch(invalid.content[0].text, /Fill MOODLE_USERNAME/);
    }
    for (const evidence of [
      [{ courseId: 43, resourceId: 7, forumId: 8 }],
      [{ courseId: 42, resourceId: 7, forumId: 8 }, { courseId: 42, resourceId: 9, forumId: 10 }],
    ]) {
      const invalid = await client.callTool({ name: 'get_weekly_labs', arguments: { courseIds: [42], weekStart: '2026-11-16', evidence } });
      assert.equal(invalid.isError, true);
      assert.doesNotMatch(invalid.content[0].text, /Fill MOODLE_USERNAME/);
    }
    for (const [name, arguments_] of [
      ['start_course_refresh', { courseIds: [] }],
      ['advance_course_refresh', { action: 'delete_all' }],
    ]) {
      const invalid = await client.callTool({ name, arguments: arguments_ });
      assert.equal(invalid.isError, true);
      assert.doesNotMatch(invalid.content[0].text, /Fill MOODLE_USERNAME/);
    }
    for (const filter of [{ academicYear: '2026/2028' }, { semester: 'current' }, { academicYear: '26/27' }]) {
      const invalid = await client.callTool({ name: 'search_courses', arguments: { courseIds: [42], query: 'lab', ...filter } });
      assert.equal(invalid.isError, true);
      assert.doesNotMatch(invalid.content[0].text, /Fill MOODLE_USERNAME/);
    }
    for (const startPage of [0, -1, 1.5, '31']) {
      const invalid = await client.callTool({ name: 'read_resource', arguments: { courseId: 42, resourceId: 13, startPage } });
      assert.equal(invalid.isError, true);
      assert.doesNotMatch(invalid.content[0].text, /Fill MOODLE_USERNAME/);
    }
    for (const fromDate of ['2026-12-27', '2027-01-04', '2026-02-30']) {
      const invalid = await client.callTool({ name: 'get_weekly_labs', arguments: {
        courseIds: [42], weekStart: '2026-12-28', fromDate,
      } });
      assert.equal(invalid.isError, true);
      assert.match(invalid.content[0].text, /fromDate/);
      assert.doesNotMatch(invalid.content[0].text, /Fill MOODLE_USERNAME/);
    }
    const { tools } = await client.listTools();
    const baseline = JSON.parse(readFileSync(new URL('./fixtures/tool-contracts.json', import.meta.url), 'utf8'));
    assert.deepEqual(toolContracts(tools), baseline, 'Review schema/annotation changes and update the contract inventory explicitly.');
    const documentation = readFileSync(new URL('../docs/MCP-CONTRACTS.md', import.meta.url), 'utf8');
    const documented = [...documentation.matchAll(/^\| ([a-z_]+) \|/gm)].map(match => match[1]).sort();
    assert.deepEqual(documented, tools.map(tool => tool.name).sort());
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['advance_course_refresh', 'clear_course_cache', 'get_announcements', 'get_assignment', 'get_choice_selection', 'get_course', 'get_course_cache', 'get_course_refresh', 'get_coursework_deadlines', 'get_folder', 'get_lab_calendar', 'get_lab_preference', 'get_lab_schedule', 'get_lab_term_preference', 'get_lab_timetable', 'get_quiz', 'get_weekly_labs', 'list_courses', 'read_folder_file', 'read_resource', 'search_course', 'search_courses', 'set_lab_preference', 'set_lab_term_preference', 'start_course_refresh']);
    for (const arguments_ of [
      { courseIds: Array.from({ length: 11 }, (_, i) => i + 1), range: { from: '2026-11-01', through: '2026-11-02' } },
      { courseIds: [42], range: { from: '2026-11-01', through: '2026-12-02' } },
    ]) {
      const rejected = await client.callTool({ name: 'get_coursework_deadlines', arguments: arguments_ });
      assert.equal(rejected.isError, true);
      assert.doesNotMatch(rejected.content[0].text, /Fill MOODLE_USERNAME/);
    }
    for (const weekStart of ['2026-02-30', '2026-11-03', 'current']) {
      const invalidWeek = await client.callTool({ name: 'get_lab_schedule', arguments: { courseId: 42, weekStart } });
      assert.equal(invalidWeek.isError, true);
      assert.doesNotMatch(invalidWeek.content[0].text, /Fill MOODLE_USERNAME/);
    }
    assert.ok(tools.filter(tool => !['advance_course_refresh', 'start_course_refresh', 'clear_course_cache', 'set_lab_preference', 'set_lab_term_preference'].includes(tool.name)).every(tool => tool.annotations.readOnlyHint));
    const clearer = tools.find(tool => tool.name === 'clear_course_cache');
    for (const name of ['start_course_refresh', 'advance_course_refresh']) {
      const tool = tools.find(tool => tool.name === name);
      assert.equal(tool.annotations.readOnlyHint, false);
      assert.equal(tool.annotations.idempotentHint, false);
    }
    assert.equal(clearer.annotations.readOnlyHint, false);
    assert.equal(clearer.annotations.destructiveHint, true);
    for (const name of ['get_course_cache', 'clear_course_cache']) {
      const invalid = await client.callTool({ name, arguments: { courseId: -1 } });
      assert.equal(invalid.isError, true);
      assert.doesNotMatch(invalid.content[0].text, /Fill MOODLE_USERNAME/);
    }
    const termSetter = tools.find(tool => tool.name === 'set_lab_term_preference');
    assert.equal(termSetter.annotations.readOnlyHint, false);
    assert.equal(termSetter.annotations.openWorldHint, false);
    for (const term of [{}, { group: 'B', extra: 'private' }, { startTime: '25:00' }, { endTime: '10:00' }]) {
      const invalidTerm = await client.callTool({ name: 'set_lab_term_preference', arguments: { courseId: 42, term } });
      assert.equal(invalidTerm.isError, true);
      assert.doesNotMatch(invalidTerm.content[0].text, /Fill MOODLE_USERNAME/);
    }
    const setter = tools.find(tool => tool.name === 'set_lab_preference');
    assert.equal(setter.annotations.readOnlyHint, false);
    assert.equal(setter.annotations.openWorldHint, false);
    const invalidPreference = await client.callTool({ name: 'set_lab_preference', arguments: { courseId: 42, attendance: 'auto' } });
    assert.equal(invalidPreference.isError, true);
    assert.doesNotMatch(invalidPreference.content[0].text, /Fill MOODLE_USERNAME/);
    const listTool = tools.find(tool => tool.name === 'list_courses');
    assert.ok(listTool.inputSchema.properties.academicYear);
    assert.ok(listTool.inputSchema.properties.semester);
    for (const args of [
      { academicYear: '2026/2028' }, { academicYear: '2026-2027' },
      { academicYear: 'current' }, { academicYear: 2026 }, { semester: 'autumn' },
    ]) {
      const invalidFilter = await client.callTool({ name: 'list_courses', arguments: args });
      assert.equal(invalidFilter.isError, true);
      assert.doesNotMatch(invalidFilter.content[0].text, /Fill MOODLE_USERNAME/);
    }
    const validFilters = await client.callTool({ name: 'list_courses', arguments: { academicYear: '2026/2027', semester: 'winter' } });
    assert.match(validFilters.content[0].text, /Fill MOODLE_USERNAME/);
    const missing = await client.callTool({ name: 'list_courses', arguments: {} });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /Fill MOODLE_USERNAME/);
    const invalid = await client.callTool({ name: 'get_course', arguments: { courseId: -1 } });
    assert.equal(invalid.isError, true);
    const invalidResource = await client.callTool({ name: 'read_resource', arguments: { courseId: 42, resourceId: -1 } });
    assert.equal(invalidResource.isError, true);
    const badFolder = await client.callTool({ name: 'get_folder', arguments: { courseId: 42, folderId: -1 } });
    assert.equal(badFolder.isError, true);
    const badFile = await client.callTool({ name: 'read_folder_file', arguments: { courseId: 42, folderId: 12, fileId: 'https://outside.example/file.pdf' } });
    assert.equal(badFile.isError, true);
    assert.doesNotMatch(badFile.content[0].text, /Fill MOODLE_USERNAME/);
    const badTimetable = await client.callTool({ name: 'get_lab_timetable', arguments: { courseId: 42, resourceId: -1 } });
    assert.equal(badTimetable.isError, true);
    assert.doesNotMatch(badTimetable.content[0].text, /Fill MOODLE_USERNAME/);
    const badForum = await client.callTool({ name: 'get_announcements', arguments: { courseId: 42, forumId: -1 } });
    assert.equal(badForum.isError, true);
    assert.doesNotMatch(badForum.content[0].text, /Fill MOODLE_USERNAME/);
    const badAssignment = await client.callTool({ name: 'get_assignment', arguments: { courseId: 42, assignmentId: -1 } });
    assert.equal(badAssignment.isError, true);
    assert.doesNotMatch(badAssignment.content[0].text, /Fill MOODLE_USERNAME/);
    const badChoice = await client.callTool({ name: 'get_choice_selection', arguments: { courseId: 42, choiceId: -1 } });
    assert.equal(badChoice.isError, true);
    assert.doesNotMatch(badChoice.content[0].text, /Fill MOODLE_USERNAME/);
    assert.doesNotMatch(invalidResource.content[0].text, /Fill MOODLE_USERNAME/);
    assert.equal(stderr, '');
  } finally { await client.close(); }
});
