import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_assignment', 'get_choice_selection', 'get_course', 'get_lab_preference', 'get_lab_schedule', 'list_courses', 'read_resource', 'search_course', 'set_lab_preference']);
    for (const weekStart of ['2026-02-30', '2026-11-03', 'current']) {
      const invalidWeek = await client.callTool({ name: 'get_lab_schedule', arguments: { courseId: 42, weekStart } });
      assert.equal(invalidWeek.isError, true);
      assert.doesNotMatch(invalidWeek.content[0].text, /Fill MOODLE_USERNAME/);
    }
    assert.ok(tools.filter(tool => tool.name !== 'set_lab_preference').every(tool => tool.annotations.readOnlyHint));
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
