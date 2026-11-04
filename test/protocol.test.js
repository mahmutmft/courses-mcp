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
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_choice_selection', 'get_course', 'list_courses', 'read_resource', 'search_course']);
    assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
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
    const badChoice = await client.callTool({ name: 'get_choice_selection', arguments: { courseId: 42, choiceId: -1 } });
    assert.equal(badChoice.isError, true);
    assert.doesNotMatch(badChoice.content[0].text, /Fill MOODLE_USERNAME/);
    assert.doesNotMatch(invalidResource.content[0].text, /Fill MOODLE_USERNAME/);
    assert.equal(stderr, '');
  } finally { await client.close(); }
});
