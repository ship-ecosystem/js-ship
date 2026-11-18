import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { diagnoseProject, formatDoctor } from '../dist/doctor.js';
import { initProject } from '../dist/init.js';
import { ProcessError } from '../dist/errors.js';
import { run } from '../dist/process.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ship-doctor-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(resolve('examples/node'), root, { recursive: true });
  const cfg = await initProject(root);
  return { root, cfg };
}
function mock({ endpoint = 'unix:///private-socket', rows = [], effective, failMerge = false, contextFailure = false } = {}) {
  const calls = [];
  const runner = async (args, _cwd, options) => {
    calls.push({ args, options });
    if (args[1] === '--version') return 'Docker test';
    if (args[1] === 'context') { if (contextFailure) throw new Error('private-context-error'); return args[2] === 'show' ? 'default' : JSON.stringify(endpoint); }
    if (args[1] === 'version') return '29.9.2';
    if (args[1] === 'compose' && args.includes('config')) {
      if (failMerge) throw new ProcessError('private-compose-error', 1, 'private-runtime-value', 'private-override-value');
      return JSON.stringify(effective ?? JSON.parse(options.input.slice(options.input.indexOf('{'))));
    }
    if (args[1] === 'compose') return '2.24.0';
    if (args[1] === 'ps') return rows.map((_, i) => String(i + 1).padStart(12, 'a')).join('\n');
    if (args[1] === 'inspect') return rows.map(row => JSON.stringify(row)).join('\n');
    throw new Error('Unexpected probe');
  };
  return { calls, runner };
}

test('doctor validates the effective override and scopes status to its project identity without writing files', async t => {
  const { root } = await fixture(t);
  await writeFile(join(root, '.env'), 'PRIVATE=private-runtime-value\n');
  await writeFile(join(root, 'docker-compose.override.yml'), 'name: effective-project\nservices: {}\n');
  await writeFile(join(root, 'compose.override.yaml'), 'services: {}\n');
  const before = await readdir(join(root, 'ship'));
  const m = mock({ effective: { name: 'effective-project', services: { app: { environment: { PRIVATE: 'private-runtime-value' } }, helper: {} } }, rows: [
    { service: 'app', state: 'running' }, { service: 'helper', state: 'running' }, { service: 'old', state: 'running' },
  ] });
  const report = await diagnoseProject(root, m.runner);
  assert.equal(report.ok, true);
  assert.equal(report.checks.find(c => c.name === 'helper').status, 'ok');
  assert.equal(report.checks.find(c => c.name === 'old').status, 'warning');
  assert.ok(report.checks.some(c => c.name === 'compose-project'));
  assert.ok(report.checks.some(c => c.name === 'compose-overrides'));
  assert.ok(m.calls.find(c => c.args[1] === 'ps').args.includes('label=com.docker.compose.project=effective-project'));
  const merge = m.calls.find(c => c.args.includes('config'));
  assert.equal(merge.args[merge.args.indexOf('-f') + 1], '-');
  assert.ok(merge.args.includes(join(root, 'docker-compose.override.yml')));
  assert.ok(!merge.args.includes(join(root, 'compose.override.yaml')));
  assert.ok(merge.args.includes(join(root, '.env')));
  assert.ok(merge.options.input.includes('"services"'));
  assert.deepEqual(await readdir(join(root, 'ship')), before);
  assert.equal(await readFile(join(root, '.env'), 'utf8'), 'PRIVATE=private-runtime-value\n');
  assert.doesNotMatch(JSON.stringify(report) + formatDoctor(report), /private-runtime-value|effective-project|private-socket/);
});

test('doctor recognizes profiled services without falsely reporting absent optional containers', async t => {
  const { root } = await fixture(t);
  const m = mock({ effective: { name: 'fixture', services: { app: {}, debug: { profiles: ['private-profile'] } } }, rows: [{ service: 'app', state: 'running' }] });
  const report = await diagnoseProject(root, m.runner);
  assert.ok(report.checks.some(c => c.name === 'compose-profiles'));
  assert.ok(!report.checks.some(c => c.name === 'debug'));
  assert.doesNotMatch(JSON.stringify(report), /private-profile/);
});

test('doctor omits raw merge failures, skips ambiguous scope and propagates cancellation', async t => {
  const { root } = await fixture(t);
  const m = mock({ failMerge: true });
  const report = await diagnoseProject(root, m.runner);
  assert.equal(report.ok, false);
  assert.ok(report.checks.some(c => c.name === 'development-compose' && c.status === 'error'));
  assert.ok(!m.calls.some(c => c.args[1] === 'ps'));
  assert.doesNotMatch(JSON.stringify(report), /private-/);
  const normal = mock().runner;
  await assert.rejects(diagnoseProject(root, async (...args) => {
    if (args[0].includes('config')) throw new ProcessError('private-runtime-value', 143);
    return normal(...args);
  }), e => e.exitCode === 143 && !e.message.includes('private-runtime-value'));
  for (const effective of [{ name: 'valid', services: { helper: {} } }, { name: 'bad\n', services: {} }, { name: 'valid', services: [] }, { name: 'valid', services: { app: null } }]) {
    const invalid = mock({ effective });
    assert.equal((await diagnoseProject(root, invalid.runner)).ok, false);
    if (!effective.services?.helper) assert.ok(!invalid.calls.some(c => c.args[1] === 'ps'));
  }
});

for (const endpoint of ['ssh://private-user:private-token@private-host', 'tcp://private-host:2376', 'http://127.0.0.1:2375', 'https://[::1]:2376']) test(`doctor explains network endpoint constraints (${endpoint.split(':')[0]}) without addresses`, async t => {
  const { root } = await fixture(t);
  const report = await diagnoseProject(root, mock({ endpoint }).runner);
  assert.equal(report.ok, true);
  const check = report.checks.find(c => c.name === 'docker-endpoint');
  assert.equal(check.status, 'warning'); assert.match(check.hint, /daemon host/); assert.match(check.hint, /loopback/);
  assert.doesNotMatch(JSON.stringify(report), /private-user|private-token|private-host|127\.0\.0\.1|\[::1\]/);
});

test('doctor treats socket metadata as limited evidence and endpoint failures as redacted warnings', async t => {
  const { root } = await fixture(t);
  for (const endpoint of ['unix:///private-socket', 'npipe:////./pipe/private-pipe']) assert.equal((await diagnoseProject(root, mock({ endpoint }).runner)).checks.find(c => c.name === 'docker-endpoint').status, 'ok');
  for (const options of [{ contextFailure: true }, { endpoint: null }, { endpoint: 'not-a-url' }]) {
    const report = await diagnoseProject(root, mock(options).runner);
    assert.equal(report.checks.find(c => c.name === 'docker-endpoint').status, 'warning');
    assert.doesNotMatch(JSON.stringify(report), /private-context-error|not-a-url/);
  }
});

test('doctor endpoint selection honors DOCKER_CONTEXT over DOCKER_HOST and passes a consistent environment', async t => {
  const { root } = await fixture(t);
  const environment = { DOCKER_CONTEXT: 'private-context', DOCKER_HOST: 'tcp://private-host:2375' };
  const m = mock();
  const report = await diagnoseProject(root, m.runner, environment);
  const inspect = m.calls.find(c => c.args[1] === 'context' && c.args[2] === 'inspect');
  assert.ok(inspect.args.includes('private-context'));
  assert.ok(!m.calls.some(c => c.args[1] === 'context' && c.args[2] === 'show'));
  assert.ok(m.calls.every(c => c.options.env === environment));
  assert.equal(report.checks.find(c => c.name === 'docker-endpoint').status, 'ok');
  assert.doesNotMatch(JSON.stringify(report), /private-context|private-host/);
  const host = mock();
  const hostReport = await diagnoseProject(root, host.runner, { DOCKER_HOST: 'tcp://private-host:2375' });
  assert.ok(!host.calls.some(c => c.args[1] === 'context'));
  assert.equal(hostReport.checks.find(c => c.name === 'docker-endpoint').status, 'warning');
});

test('process input preserves literal multiline data and handles a child closing stdin early', { skip: process.env.SHIP_RESTRICTED_TEST === '1' }, async () => {
  const input = 'literal $TOKEN $(no-command) `no-command`\nUnicode: λ\n';
  assert.equal(await run([process.execPath, '-e', "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(s));"], process.cwd(), { capture: true, input }), input);
  assert.equal(await run([process.execPath, '-e', 'process.exit(0)'], process.cwd(), { capture: true, input: 'x'.repeat(4_000_000) }), '');
});
