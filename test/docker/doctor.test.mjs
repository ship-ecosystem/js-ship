import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { initProject } from '../../dist/init.js';
import { diagnoseProject } from '../../dist/doctor.js';
import { run } from '../../dist/process.js';
import { IMAGES } from '../../dist/images.js';

test('doctor: effective overrides, project scope, endpoint precedence and private failures stay read-only', { timeout: 120_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ship-doctor-live-'));
  const dockerConfig = await mkdtemp(join(tmpdir(), 'ship-doctor-context-config-'));
  const name = `ship-doctor-${randomBytes(5).toString('hex')}`, container = `${name}-helper`;
  const marker = randomBytes(20).toString('hex');
  const env = { ...process.env };
  for (const key of ['COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES', 'COMPOSE_FILE']) delete env[key];
  t.after(async () => {
    await run(['docker', 'rm', '-f', container], root, { capture: true }).catch(() => {});
    await rm(root, { recursive: true, force: true }); await rm(dockerConfig, { recursive: true, force: true });
  });
  await cp(resolve('examples/node'), root, { recursive: true });
  await initProject(root);
  const override = `name: \${DIAGNOSTIC_PROJECT}\nservices:\n  helper:\n    image: ${IMAGES.node24}\n    environment:\n      PRIVATE_VALUE: ${marker}\n  optional:\n    image: ${IMAGES.node24}\n    profiles: [debug]\n`;
  await writeFile(join(root, '.env'), `DIAGNOSTIC_PROJECT=${name}\nPRIVATE_VALUE=${marker}\n`);
  await writeFile(join(root, 'docker-compose.override.yml'), override);
  await writeFile(join(root, 'compose.override.yaml'), 'invalid: [this ignored file must not be parsed');
  await run(['docker', 'run', '-d', '--pull', 'never', '--name', container, '--label', `com.docker.compose.project=${name}`, '--label', 'com.docker.compose.service=helper', IMAGES.node24, 'node', '-e', 'setInterval(()=>{},1000)'], root, { capture: true });
  const before = await readdir(join(root, 'ship'));
  const calls = [];
  const runner = async (args, cwd, options) => { calls.push(args); return run(args, cwd, { ...options, env }); };
  const report = await diagnoseProject(root, runner);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.checks.find(c => c.name === 'helper').status, 'ok');
  assert.equal(report.checks.find(c => c.name === 'app').status, 'warning');
  assert.ok(!report.checks.some(c => c.name === 'optional'));
  assert.ok(report.checks.some(c => c.name === 'compose-project'));
  assert.ok(report.checks.some(c => c.name === 'compose-overrides'));
  assert.ok(calls.find(args => args[1] === 'ps').includes(`label=com.docker.compose.project=${name}`));
  assert.ok(!JSON.stringify(report).includes(marker));
  assert.deepEqual(await readdir(join(root, 'ship')), before);
  assert.equal(await readFile(join(root, 'docker-compose.override.yml'), 'utf8'), override);

  // Real context metadata precedence, isolated from the user's Docker config.
  // Only context inspect uses this environment; no command connects remotely.
  await run(['docker', '--config', dockerConfig, 'context', 'create', 'fixture-context', '--docker', 'host=ssh://private-user@fixture.invalid'], root, { capture: true });
  let endpoint;
  const contextRunner = async (args, cwd, options) => {
    if (args[1] === 'context') {
      endpoint = await run(['docker', '--config', dockerConfig, ...args.slice(1)], cwd, { ...options, env: { ...env, DOCKER_CONTEXT: 'fixture-context', DOCKER_HOST: 'tcp://ignored.invalid:2375' } });
      return endpoint;
    }
    return runner(args, cwd, options);
  };
  const network = await diagnoseProject(root, contextRunner, { ...env, DOCKER_CONTEXT: 'fixture-context', DOCKER_HOST: 'tcp://ignored.invalid:2375' });
  assert.equal(JSON.parse(endpoint), 'ssh://private-user@fixture.invalid');
  assert.equal(network.checks.find(c => c.name === 'docker-endpoint').status, 'warning');
  assert.doesNotMatch(JSON.stringify(network), /private-user|fixture\.invalid|ignored\.invalid/);

  await writeFile(join(root, 'docker-compose.override.yml'), `services:\n  app: [${marker}\n`);
  calls.length = 0;
  const broken = await diagnoseProject(root, runner);
  assert.equal(broken.ok, false);
  assert.ok(broken.checks.some(c => c.name === 'development-compose' && c.status === 'error'));
  assert.ok(!JSON.stringify(broken).includes(marker));
  assert.ok(!calls.some(args => args[1] === 'ps'));
  assert.deepEqual(await readdir(join(root, 'ship')), before);
});
