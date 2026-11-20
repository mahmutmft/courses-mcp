import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeToolResult, maxToolResultBytes } from '../src/tool-results.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('successful envelopes retain complete JSON with an exact UTF-8 byte boundary', () => {
  const overhead = Buffer.byteLength(JSON.stringify({ text: '' }));
  const value = { text: 'x'.repeat(maxToolResultBytes - overhead) };
  assert.deepEqual(JSON.parse(encodeToolResult(value).content[0].text), value);
  value.text += 'x';
  assert.throws(() => encodeToolResult(value), /TOOL_OUTPUT_LIMIT/);
  assert.throws(() => encodeToolResult({ text: 'ж'.repeat(maxToolResultBytes / 2) }), /TOOL_OUTPUT_LIMIT/);
  assert.throws(() => encodeToolResult(undefined));
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => encodeToolResult(cyclic));
});

test('actual stdio returns bounded safe errors and remains usable after oversized or failed calls', async () => {
  const script = `
    const { Moodle } = await import(${JSON.stringify(new URL('../src/moodle.js', import.meta.url).href)});
    const { UserError } = await import(${JSON.stringify(new URL('../src/config.js', import.meta.url).href)});
    Moodle.prototype.getCourse = async id => {
      if (id === 1) return { text: 'x'.repeat(${maxToolResultBytes + 1}) };
      if (id === 3) throw new Error('PRIVATE_RUNTIME_SENTINEL');
      if (id === 4) throw new UserError('[CACHE_TEST] Safe fixture failure.');
      if (id === 5) return { value: BigInt(1) };
      return { id, name: 'Synthetic course', sourceUrl: 'https://example.test/course', checkedAt: '2026-11-20T00:00:00Z' };
    };
    await import(${JSON.stringify(new URL('../src/index.js', import.meta.url).href)});
  `;
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--input-type=module', '-e', script],
    env: { ...process.env, MOODLE_USERNAME: '', MOODLE_PASSWORD: '', MOODLE_BASE_URL: 'https://courses.finki.ukim.mk' }, stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'result-contract-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    for (const courseId of [1, 3, 4, 5]) {
      const result = await client.callTool({ name: 'get_course', arguments: { courseId } });
      assert.equal(result.isError, true);
      assert.ok(Buffer.byteLength(result.content[0].text) < 500);
      assert.doesNotMatch(result.content[0].text, /PRIVATE_RUNTIME_SENTINEL/);
      if (courseId === 1) assert.match(result.content[0].text, /TOOL_OUTPUT_LIMIT/);
      if (courseId === 4) assert.equal(result.content[0].text, '[CACHE_TEST] Safe fixture failure.');
      const next = await client.callTool({ name: 'get_course', arguments: { courseId: 2 } });
      assert.notEqual(next.isError, true);
      const value = JSON.parse(next.content[0].text);
      assert.equal(value.id, 2);
      assert.equal(value.sourceUrl, 'https://example.test/course');
    }
    assert.equal(stderr, '');
  } finally { await client.close(); }
});
