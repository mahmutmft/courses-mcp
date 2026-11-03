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
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_course', 'list_courses', 'search_course']);
    assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
    const missing = await client.callTool({ name: 'list_courses', arguments: {} });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /Fill MOODLE_USERNAME/);
    const invalid = await client.callTool({ name: 'get_course', arguments: { courseId: -1 } });
    assert.equal(invalid.isError, true);
    assert.equal(stderr, '');
  } finally { await client.close(); }
});
