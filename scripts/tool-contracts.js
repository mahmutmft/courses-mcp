import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export function toolContracts(tools) {
  return { contractVersion: 1, tools: tools.map(({ name, inputSchema, annotations }) =>
    ({ name, inputSchema, annotations })).sort((a, b) => a.name.localeCompare(b.name)) };
}

async function updateContracts() {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../src/index.js', import.meta.url))],
    env: { ...process.env, MOODLE_USERNAME: '', MOODLE_PASSWORD: '', MOODLE_BASE_URL: 'https://courses.finki.ukim.mk' }, stderr: 'pipe' });
  transport.stderr?.resume();
  const client = new Client({ name: 'contract-inventory', version: '1.0.0' });
  let timer;
  try {
    const contract = await Promise.race([
      (async () => { await client.connect(transport); return toolContracts((await client.listTools()).tools); })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Contract discovery timed out.')), 20000); }),
    ]);
    await writeFile(new URL('../test/fixtures/tool-contracts.json', import.meta.url), JSON.stringify(contract, null, 2) + '\n');
    console.log(`Recorded ${contract.tools.length} tool schemas and annotations. Review the fixture diff before committing.`);
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updateContracts().catch(() => { console.error('Contract inventory failed. No private diagnostics were printed.'); process.exitCode = 1; });
}
