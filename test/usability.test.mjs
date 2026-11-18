import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, cp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initProject, planInitProject } from '../dist/init.js';
import { interactiveInitOptions, shouldPromptInit } from '../dist/interactive.js';
import { diagnoseProject, formatDoctor } from '../dist/doctor.js';
import { run } from '../dist/process.js';
import { ProcessError } from '../dist/errors.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ship-usability-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(resolve('examples/node'), root, { recursive: true });
  return root;
}
const answer = overrides => async q => overrides[q.key] ?? q.defaultValue;

test('init planning and cancelled/closed questions leave project files untouched', async t => {
  const root = await fixture(t), before = await readdir(root);
  await planInitProject(root);
  assert.deepEqual(await readdir(root), before);
  await assert.rejects(interactiveInitOptions(root, {}, answer({ confirm: 'no' }), () => {}), /cancelled/);
  await assert.rejects(interactiveInitOptions(root, {}, async () => { throw new Error('input closed'); }, () => {}), /input closed/);
  assert.deepEqual(await readdir(root), before);
});
test('interactive choices equal flag-based initialization; explicit flags are never re-prompted', async t => {
  const root = await fixture(t);
  const seen = [], notices = [];
  const options = await interactiveInitOptions(root, { database: 'mongodb', mongodbMode: 'standalone' }, async q => {
    seen.push(q.key); return q.key === 'confirm' ? 'yes' : q.defaultValue;
  }, text => notices.push(text));
  assert.ok(!seen.includes('database') && !seen.includes('mongodbMode'));
  const planned = (await planInitProject(root, options)).config;
  const written = await initProject(root, options);
  assert.deepEqual(written, planned);
  assert.equal(written.services.database, 'mongodb'); assert.equal(written.mongodbMode, 'standalone');
  assert.ok(notices.some(text => text.includes('npm@')));
});
test('invalid interactive choices retry; existing selections and template edits are preserved', async t => {
  const root = await fixture(t);
  await initProject(root, { database: 'mongodb', cache: 'redis', mongodbMode: 'standalone' });
  const dockerfile = join(root, 'ship/Dockerfile'), edited = (await readFile(dockerfile, 'utf8')) + '\n# keep this edit\n';
  await writeFile(dockerfile, edited);
  let attempts = 0; const notices = [];
  const opts = await interactiveInitOptions(root, {}, async q => {
    if (q.key === 'framework' && attempts++ === 0) return 'unknown';
    return q.key === 'confirm' ? 'yes' : q.defaultValue;
  }, text => notices.push(text));
  assert.equal(attempts, 2); assert.ok(notices.some(text => text.startsWith('Choose one of:')));
  const cfg = await initProject(root, opts);
  assert.equal(cfg.services.database, 'mongodb'); assert.equal(cfg.mongodbMode, 'standalone');
  assert.equal(await readFile(dockerfile, 'utf8'), edited);
});
test('TTY/CI/noninteractive detection does not prompt in automation', () => {
  assert.equal(shouldPromptInit(true, true, false, undefined), true);
  for (const args of [[false,true,false,undefined],[true,false,false,undefined],[true,true,true,undefined],[true,true,false,'true']]) assert.equal(shouldPromptInit(...args), false);
  assert.equal(shouldPromptInit(true, true, false, 'false'), true);
});

function dockerRunner({ rows = [], daemon = true, cli = true, compose = true, composeVersion = '5.6.1' } = {}) {
  const calls = [];
  const runner = async (args, _cwd, options) => {
    calls.push(args);
    if (!cli || (args[1] === 'version' && !daemon) || (args[1] === 'compose' && !compose)) throw new Error('private-runtime-value');
    if (args[1] === '--version') return 'Docker version test';
    if (args[1] === 'context') return args[2] === 'show' ? 'default' : JSON.stringify('unix:///var/run/docker.sock');
    if (args[1] === 'compose' && args.includes('config')) return options.input.slice(options.input.indexOf('{'));
    if (args[1] === 'compose') return composeVersion;
    if (args[1] === 'version') return '29.9.2';
    if (args[1] === 'ps') return rows.map((_, i) => String(i + 1).padStart(12, 'a')).join('\n');
    if (args[1] === 'inspect') return rows.map(row => JSON.stringify(row)).join('\n');
    throw new Error('Unexpected diagnostic command');
  };
  return { runner, calls };
}
test('doctor diagnoses an uninitialized project independently of Docker installation', async t => {
  const root = await fixture(t), mock = dockerRunner({ cli: false });
  const report = await diagnoseProject(root, mock.runner);
  assert.equal(report.ok, false);
  assert.ok(report.checks.some(c => c.name === 'project' && c.hint.includes('ship init')));
  assert.ok(report.checks.some(c => c.name === 'docker-cli' && c.hint.includes('PATH')));
  assert.ok(!JSON.stringify(report).includes('private-runtime-value'));
  assert.deepEqual(mock.calls, [['docker','--version']]);
  const missing = await diagnoseProject(join(root, 'missing'), async (_args, cwd) => { assert.equal(cwd, process.cwd()); throw new Error('unavailable'); });
  assert.equal(missing.ok, false);
  assert.ok(missing.checks.some(c => c.message.includes('directory')));
  await writeFile(join(root, 'ship.json'), '{"private":"private-runtime-value",broken');
  const invalid = await diagnoseProject(root, dockerRunner({ cli: false }).runner);
  assert.equal(invalid.ok, false); assert.doesNotMatch(JSON.stringify(invalid), /private-runtime-value/);
  assert.ok(!(await readdir(root)).includes('ship'));
});
test('doctor separates Compose and daemon failures and never echoes raw stderr', async t => {
  const root = await fixture(t); await initProject(root);
  const report = await diagnoseProject(root, dockerRunner({ daemon: false, compose: false }).runner);
  assert.deepEqual(report.checks.filter(c => c.status === 'error').map(c => c.name), ['compose', 'docker-daemon']);
  assert.doesNotMatch(formatDoctor(report), /private-runtime-value/);
  await assert.rejects(diagnoseProject(root, async () => { throw new ProcessError('private-runtime-value', 130); }), error => error.exitCode === 130 && !error.message.includes('private-runtime-value'));
});
test('doctor works with missing templates and never regenerates Compose or templates', async t => {
  const root = await fixture(t); await initProject(root, { database: 'mongodb' });
  await rm(join(root, 'ship/mongodb/health.js'));
  const before = await readdir(join(root, 'ship'));
  const report = await diagnoseProject(root, dockerRunner().runner);
  assert.equal(report.ok, false);
  assert.ok(report.checks.some(c => c.message.includes('mongodb/health.js is missing')));
  assert.deepEqual(await readdir(join(root, 'ship')), before);
  assert.ok(report.checks.some(c => c.name === 'stack' && c.status === 'warning'));
});
test('doctor scopes container inspection and distinguishes unhealthy, restarting, stopped and orphan services', async t => {
  const root = await fixture(t); const cfg = await initProject(root, { database: 'mongodb', cache: 'redis' });
  const mock = dockerRunner({ rows: [
    { service: 'app', state: 'restarting', exitCode: 1, restarts: 3 },
    { service: 'mongodb', state: 'running', health: 'unhealthy' },
    { service: 'redis', state: 'exited', exitCode: 0 },
    { service: 'old-db', state: 'running' },
    { service: 'app', state: 'exited', exitCode: 99, oneoff: 'True' },
  ] });
  const report = await diagnoseProject(root, mock.runner);
  assert.equal(report.ok, false);
  assert.equal(report.checks.filter(c => c.name === 'app').length, 1);
  assert.ok(report.checks.find(c => c.name === 'mongodb').hint.includes('Preserve data/config volumes'));
  assert.equal(report.checks.find(c => c.name === 'redis').status, 'warning');
  assert.equal(report.checks.find(c => c.name === 'old-db').status, 'warning');
  assert.ok(mock.calls.some(args => args.includes(`label=com.docker.compose.project=${cfg.name}`)));
  const inspect = mock.calls.find(args => args[1] === 'inspect');
  assert.doesNotMatch(inspect[3], /Config\.Env|Health\.Log|\.Command/);
  assert.ok(!mock.calls.some(args => args.includes('up') || args.includes('logs')));
  cfg.serviceNames = { mongodb: 'app' };
  await writeFile(join(root, 'ship.json'), JSON.stringify(cfg));
  const collision = await diagnoseProject(root, dockerRunner().runner);
  assert.ok(collision.checks.some(c => c.name === 'project' && c.status === 'error'));
  assert.ok(!collision.checks.some(c => c.name === 'project' && c.status === 'ok'));
});
test('doctor reports a missing app and health startup; invalid metadata remains private', async t => {
  const root = await fixture(t); await initProject(root, { database: 'postgres' });
  const report = await diagnoseProject(root, dockerRunner({ rows: [{ service: 'postgres', state: 'running', health: 'starting' }] }).runner);
  assert.equal(report.ok, true);
  assert.equal(report.checks.find(c => c.name === 'app').status, 'warning');
  const paused = await diagnoseProject(root, dockerRunner({ rows: [{ service: 'app', state: 'paused' }] }).runner);
  assert.ok(paused.checks.find(c => c.name === 'app').hint.includes('Unpause'));
  const valid = dockerRunner().runner;
  const malformed = await diagnoseProject(root, async args => args[1] === 'ps' ? '--private-runtime-value' : valid(args));
  assert.equal(malformed.ok, false); assert.doesNotMatch(JSON.stringify(malformed), /private-runtime-value/);
});
test('doctor CLI validates flags early and produces JSON before init without Docker on PATH', { skip: process.env.SHIP_RESTRICTED_TEST === '1' }, async t => {
  const root = await fixture(t);
  await assert.rejects(run([process.execPath, resolve('dist/cli.js'), '--project-directory', root, 'doctor', '--bad'], root, { capture: true }), /Unknown option/);
  await assert.rejects(run([process.execPath, resolve('dist/cli.js'), '--project-directory', root, 'doctor', '--json'], root, { capture: true, env: { ...process.env, PATH: '' } }), error => {
    const report = JSON.parse(error.stdout); assert.equal(report.ok, false);
    assert.ok(report.checks.some(c => c.name === 'docker-cli' && c.status === 'error'));
    assert.equal(error.stderr, ''); return true;
  });
});

test('workspace selection precedes framework detection and preserves ordered shared builds', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'apps/web'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['apps/*', 'packages/*'], packageManager: 'npm@12.2.2' }));
  await mkdir(join(root, 'apps/api'), { recursive: true });
  await cp(resolve('examples/node/package.json'), join(root, 'apps/api/package.json'));
  await mkdir(join(root, 'packages/shared'), { recursive: true });
  await writeFile(join(root, 'packages/shared/package.json'), JSON.stringify({ scripts: { build: 'node build.mjs' } }));
  await writeFile(join(root, 'ship.json'), JSON.stringify({ framework: 'generic', workspace: { app: 'apps/api', buildDependencies: ['packages/shared'] } }));
  await writeFile(join(root, 'apps/web/package.json'), JSON.stringify({ dependencies: { react: '19.3.1', vite: '8.3.8' }, scripts: { dev: 'vite', build: 'vite build' } }));
  const seen = [];
  const opts = await interactiveInitOptions(root, {}, async q => { seen.push(q.key); return q.key === 'workspace' ? 'apps/web' : q.key === 'confirm' ? 'yes' : q.defaultValue; }, () => {});
  assert.equal(seen[0], 'workspace'); assert.equal(opts.framework, 'react'); assert.equal(opts.deployment, 'static');
  const cfg = await initProject(root, opts); assert.equal(cfg.workspace.app, 'apps/web');
  assert.deepEqual(cfg.workspace.buildDependencies, ['packages/shared']);
});
test('an unpinned pnpm project can supply an exact version interactively, with invalid pins retried', async t => {
  const root = await fixture(t);
  await rm(join(root, 'package-lock.json')); await writeFile(join(root, 'pnpm-lock.yaml'), '{}');
  let pins = 0;
  const opts = await interactiveInitOptions(root, {}, async q => q.key === 'packageManagerVersion' ? (++pins === 1 ? 'latest' : '12.21.0') : q.key === 'confirm' ? 'yes' : q.defaultValue, () => {});
  assert.equal(pins, 2); assert.equal(opts.packageManager, 'pnpm');
  assert.equal((await initProject(root, opts)).packageManagerVersion, '12.21.0');
});

test('interactive Angular selection supports multiple applications before validation', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@angular/core': '1.0.0' }, scripts: { dev: 'ng serve', build: 'ng build' } }));
  const project = { projectType: 'application', architect: { build: { builder: '@angular/build:application', options: { outputPath: 'dist/frontend' }, configurations: { production: {} } } } };
  await writeFile(join(root, 'angular.json'), JSON.stringify({ projects: { frontend: project, admin: project } }));
  const opts = await interactiveInitOptions(root, {}, answer({ angularProject: 'admin', confirm: 'yes' }), () => {});
  assert.equal(opts.angularProject, 'admin');
  assert.equal((await initProject(root, opts)).angularProject, 'admin');
});

test('doctor detects Compose versions too old for generated optional env files', async t => {
  const root = await fixture(t); await initProject(root);
  for (const version of ['1.29.2', '2.23.3', 'unknown']) {
    const mock = dockerRunner({ composeVersion: version });
    const report = await diagnoseProject(root, mock.runner);
    assert.equal(report.ok, false);
    assert.ok(report.checks.some(c => c.name === 'compose' && c.message.includes('2.24.0')));
    assert.ok(!mock.calls.some(args => args[1] === 'ps'));
  }
  assert.equal((await diagnoseProject(root, dockerRunner({ composeVersion: 'v2.24.0' }).runner)).ok, true);
});
