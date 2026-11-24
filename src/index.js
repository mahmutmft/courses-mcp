import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadLocalEnv, loadConfig } from './config.js';
import { Moodle } from './moodle.js';
import { createServer } from './server.js';

loadLocalEnv();
const moodle = new Moodle(loadConfig());
const server = createServer(moodle);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  await moodle.close();
  await server.close();
  process.exit(0);
});
await server.connect(new StdioServerTransport());
process.stdin.on('end', () => { void moodle.close(); });
