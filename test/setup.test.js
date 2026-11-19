import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSetup, runStep } from '../scripts/setup.js';

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
