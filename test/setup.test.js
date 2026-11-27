import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSetup, runStep, SetupError, verifyToolInventory } from '../scripts/setup.js';

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'courses-setup-'));
  const root = join(parent, "project with spaces & ' quotes Ж");
  await mkdir(root);
  await writeFile(join(root, '.env.example'), 'MOODLE_USERNAME=\nMOODLE_PASSWORD=\n');
  t.after(() => rm(parent, { recursive: true, force: true }));
  const calls = [], logs = [];
  return { root, calls, logs, options: { root, npmPath: fileURLToPath(import.meta.url),
    run: async (...args) => { calls.push(args); }, verify: async () => { calls.push('verify'); },
    log: text => logs.push(text) } };
}

test('guided setup uses argument arrays, creates blank env and outputs escaped stdio config', async t => {
  const { root, options, calls, logs } = await fixture(t);
  const result = await runSetup(options);
  assert.equal(result.envCreated, true);
  assert.equal(await readFile(join(root, '.env'), 'utf8'), 'MOODLE_USERNAME=\nMOODLE_PASSWORD=\n');
  assert.deepEqual(calls[0], [process.execPath, [options.npmPath, 'ci', '--prefer-offline', '--no-audit', '--no-fund'], root]);
  assert.deepEqual(calls[1], [process.execPath, [join(root, 'node_modules/playwright/cli.js'), 'install', 'chromium'], root]);
  assert.equal(calls[2], 'verify');
  const config = JSON.parse(logs.find(line => line.startsWith('{')));
  assert.equal(config.mcpServers['finki-courses'].args[0], join(root, 'src/index.js'));
  assert.equal(config.mcpServers['finki-courses'].command, process.execPath);
});

test('reruns preserve credentials and local files byte for byte without printing them', async t => {
  const { root, options, logs } = await fixture(t);
  const secret = 'PRIVATE_SETUP_SENTINEL';
  await writeFile(join(root, '.env'), `MOODLE_PASSWORD=${secret}\n`);
  await writeFile(join(root, 'preference.json'), secret);
  for (let i = 0; i < 2; i++) assert.equal((await runSetup(options)).envCreated, false);
  assert.equal(await readFile(join(root, '.env'), 'utf8'), `MOODLE_PASSWORD=${secret}\n`);
  assert.equal(await readFile(join(root, 'preference.json'), 'utf8'), secret);
  assert.ok(!logs.join('\n').includes(secret));
});

test('unsupported Node or missing npm fail before installation or configuration writes', async t => {
  const { root, options, calls } = await fixture(t);
  for (const nodeVersion of ['22.0.0', 'invalid']) {
    await assert.rejects(runSetup({ ...options, nodeVersion }), /Node.js 24/);
  }
  await assert.rejects(runSetup({ ...options, npmPath: join(root, 'missing-npm') }), /npm was not found/);
  assert.deepEqual(calls, []);
  await assert.rejects(access(join(root, '.env')));
});

test('dependency, browser and verification failures stop safely and can be retried', async t => {
  for (const stage of [0, 1, 2]) {
    const { root, options, logs } = await fixture(t);
    let count = 0;
    const fail = async () => { if (count++ === stage) throw new Error('PRIVATE_NETWORK_TOKEN'); };
    await assert.rejects(runSetup({ ...options, run: fail, verify: fail }), error => {
      assert.doesNotMatch(error.message, /PRIVATE_NETWORK_TOKEN/);
      return /rerun|Rerun/.test(error.message);
    });
    assert.equal(count, stage + 1);
    await assert.rejects(access(join(root, '.env')));
    assert.doesNotMatch(logs.join('\n'), /PRIVATE_NETWORK_TOKEN/);
    assert.equal((await runSetup(options)).envCreated, true);
  }
});

test('exclusive env creation preserves a file introduced while installation is running', async t => {
  const { root, options } = await fixture(t);
  await runSetup({ ...options, verify: async () => writeFile(join(root, '.env'), 'DO_NOT_OVERWRITE') });
  assert.equal(await readFile(join(root, '.env'), 'utf8'), 'DO_NOT_OVERWRITE');
});

test('real subprocess failures and interruptions suppress diagnostic secrets', async () => {
  await assert.rejects(runStep(process.execPath, ['-e', 'console.error("PRIVATE_SUBPROCESS"); process.exit(1)'], tmpdir()),
    error => !error.message.includes('PRIVATE_SUBPROCESS'));
  await assert.rejects(runStep(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")'], tmpdir()), /failed or was interrupted/);
});

test('real subprocess preserves shell characters as data in paths and arguments', async t => {
  const { root } = await fixture(t);
  const value = "literal & $() ' Ж";
  await runStep(process.execPath, ['-e', 'if (process.argv[1] !== "literal & $() \' Ж") process.exit(1)', value], root);
});

test('missing template gives a safe configuration failure and leaves env absent', async t => {
  const { root, options } = await fixture(t);
  await rm(join(root, '.env.example'));
  await assert.rejects(runSetup(options), /Could not create .env/);
  await assert.rejects(access(join(root, '.env')));
});


test('real subprocess timeout is distinct from exit failure and spawn failure', async () => {
  await assert.rejects(runStep(process.execPath, ['-e', 'console.error("PRIVATE_TIMEOUT"); setInterval(() => {}, 1000)'], tmpdir(), { timeoutMs: 150 }),
    error => error.code === 'SETUP_STEP_TIMEOUT' && !error.message.includes('PRIVATE_TIMEOUT'));
  await assert.rejects(runStep(process.execPath, ['-e', 'process.exit(2)'], tmpdir()), { code: 'SETUP_STEP_FAILED' });
  await assert.rejects(runStep(join(tmpdir(), 'missing-setup-command'), [], tmpdir()), { code: 'SETUP_STEP_START_FAILED' });
  for (const timeoutMs of [0, -1, 300001, NaN, 1.5]) {
    await assert.rejects(runStep(process.execPath, [], tmpdir(), { timeoutMs }), { code: 'SETUP_INVALID_TIMEOUT' });
  }
});

test('installation timeout identifies its stage without leaking child diagnostics or writing env', async t => {
  for (const stage of [0, 1]) {
    const { root, options, logs } = await fixture(t);
    let count = 0;
    await assert.rejects(runSetup({ ...options, run: async () => {
      if (count++ === stage) throw new SetupError('PRIVATE_TIMEOUT_TOKEN', 'SETUP_STEP_TIMEOUT');
    } }), error => error.code === (stage === 0 ? 'SETUP_DEPENDENCY_TIMEOUT' : 'SETUP_BROWSER_TIMEOUT') &&
      /timed out after five minutes/.test(error.message) && !error.message.includes('PRIVATE_TIMEOUT_TOKEN'));
    assert.equal(count, stage + 1);
    assert.doesNotMatch(logs.join('\n'), /PRIVATE_TIMEOUT_TOKEN/);
    await assert.rejects(access(join(root, '.env')));
  }
});

test('inventory verifies every schema, annotation and server identity with safe metadata failures', async t => {
  const { root } = await fixture(t);
  const baseline = JSON.parse(await readFile(new URL('./fixtures/tool-contracts.json', import.meta.url), 'utf8'));
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  await mkdir(join(root, 'test/fixtures'), { recursive: true });
  await writeFile(join(root, 'test/fixtures/tool-contracts.json'), JSON.stringify(baseline));
  await writeFile(join(root, 'package.json'), JSON.stringify(metadata));
  const identity = { name: 'finki-courses', version: metadata.version };
  assert.deepEqual(await verifyToolInventory(root, identity, [...baseline.tools].reverse()), { toolCount: baseline.tools.length });
  const changedSchema = structuredClone(baseline.tools);
  changedSchema[0].inputSchema = { type: 'object' };
  const changedAnnotation = structuredClone(baseline.tools);
  changedAnnotation[0].annotations = {};
  for (const [server, tools] of [
    [identity, baseline.tools.slice(1)], [identity, [...baseline.tools, baseline.tools[0]]],
    [identity, changedSchema], [identity, changedAnnotation],
    [{ ...identity, version: 'wrong' }, baseline.tools], [{ ...identity, name: 'wrong' }, baseline.tools],
    [undefined, baseline.tools], [identity, undefined],
  ]) await assert.rejects(verifyToolInventory(root, server, tools), { code: 'SETUP_INVENTORY_FAILED' });
  await writeFile(join(root, 'package.json'), 'PRIVATE_INVALID_JSON');
  await assert.rejects(verifyToolInventory(root, identity, baseline.tools), error =>
    error.code === 'SETUP_INVENTORY_FAILED' && !error.message.includes('PRIVATE_INVALID_JSON') && !error.message.includes(root));
});
