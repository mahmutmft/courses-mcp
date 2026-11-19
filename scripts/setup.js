import { spawn } from 'node:child_process';
import { copyFile, constants } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export class SetupError extends Error {}

// No shell interpolation and no child diagnostics: these may contain local secrets.
export function runStep(command, args, cwd) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'ignore', windowsHide: true, timeout: 300000 });
    child.once('error', () => reject(new SetupError('Setup command could not start.')));
    child.once('exit', (code, signal) => code === 0 && !signal ? accept() : reject(new SetupError('Setup command failed or was interrupted.')));
  });
}

export async function verifyLocalServer(root, nodePath) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, timeout: 15000 });
  await browser.close();
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({ command: nodePath, args: [resolve(root, 'src/index.js')],
    env: { ...process.env, MOODLE_USERNAME: '', MOODLE_PASSWORD: '', MOODLE_BASE_URL: 'https://courses.finki.ukim.mk' },
    stderr: 'pipe' });
  const client = new Client({ name: 'courses-setup', version: '1.0.0' });
  let timer;
  try {
    await Promise.race([
      (async () => {
        await client.connect(transport);
        transport.stderr?.resume();
        const { tools } = await client.listTools();
        if (!tools.some(tool => tool.name === 'list_courses')) throw new SetupError('Tool discovery failed.');
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new SetupError('Tool discovery timed out.')), 20000); }),
    ]);
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

export async function runSetup({ root = projectRoot, nodePath = process.execPath, nodeVersion = process.versions.node,
  npmPath = process.env.npm_execpath, run = runStep, verify = verifyLocalServer, log = console.log } = {}) {
  const started = performance.now();
  if (Number(nodeVersion.split('.')[0]) < 24 || !/^\d+\./.test(nodeVersion)) {
    throw new SetupError('Install Node.js 24 or newer, reopen your terminal, then run npm run setup.');
  }
  if (!npmPath || !existsSync(npmPath)) {
    throw new SetupError('npm was not found. Install Node.js with npm and run npm run setup from the repository.');
  }
  log('1/4 Installing locked dependencies (may take a few minutes)...');
  try { await run(nodePath, [npmPath, 'ci', '--prefer-offline', '--no-audit', '--no-fund'], root); }
  catch { throw new SetupError('Dependency installation failed or timed out. Check connectivity, registry/proxy settings and running MCP processes; then rerun npm run setup. Existing local credentials are preserved.'); }
  log('2/4 Installing Chromium (first download may take a few minutes)...');
  try { await run(nodePath, [resolve(root, 'node_modules/playwright/cli.js'), 'install', 'chromium'], root); }
  catch { throw new SetupError('Browser installation failed or timed out. Check connectivity and disk space, then rerun npm run setup. Manual recovery: npm run browser:install.'); }
  log('3/4 Checking browser launch and MCP tool discovery (no faculty login)...');
  try { await verify(root, nodePath); }
  catch { throw new SetupError('Local browser/MCP check failed. Check Node 24+, browser installation and OS requirements in docs/SETUP_CHECKLIST.md. Rerun npm run setup after fixing the problem.'); }
  log('4/4 Preparing local configuration...');
  let envCreated = false;
  try {
    await copyFile(resolve(root, '.env.example'), resolve(root, '.env'), constants.COPYFILE_EXCL);
    envCreated = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw new SetupError('Could not create .env. Check folder permissions; existing configuration was not overwritten.');
  }
  const configuration = { mcpServers: { 'finki-courses': { command: nodePath, args: [resolve(root, 'src/index.js')] } } };
  log(envCreated ? 'Created blank .env. Enter your faculty username and password there locally.' : 'Kept existing .env. Check your credentials locally if needed.');
  log('Copy the following into a compatible MCP client. For clients with another configuration format, use the command and args fields. No client settings were changed.');
  log(JSON.stringify(configuration, null, 2));
  log('Restart the client and confirm list_courses appears. This checked local startup only, not faculty login or your client connection.');
  log('Optional live login check after filling .env: npm run doctor. Never share .env or this local configuration publicly.');
  log(`Setup finished in ${Math.round((performance.now() - started) / 1000)} seconds.`);
  return { envCreated, configuration };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSetup().catch(error => {
    console.error(error instanceof SetupError ? error.message : 'Setup failed. See docs/SETUP_CHECKLIST.md for recovery. No diagnostic secrets were printed.');
    process.exitCode = 1;
  });
}
