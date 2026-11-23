import { imageInspection } from './helpers/images.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, cp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseConfig } from '../dist/config.js';
import { buildCompose } from '../dist/compose.js';
import { serviceContext } from '../dist/services.js';
import { initProject, projectProblems } from '../dist/init.js';
import { composePrefix } from '../dist/project.js';
import { productionProblems, parseEnv } from '../dist/production.js';
import { assembleRelease, releaseModel, deployScript, validateTag } from '../dist/release.js';
import { run } from '../dist/process.js';
import { statusRecords, waitForStack } from '../dist/runtime.js';
import { createServer } from 'node:http';

const fixture = resolve('examples/node');
const cli = resolve('dist/cli.js');
const restricted = process.env.SHIP_RESTRICTED_TEST === '1';
const config = (data = {}) => parseConfig(data, '/projects/example');
async function project(t) {
  const root = await mkdtemp(join(tmpdir(), 'ship-js-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fixture, root, { recursive: true });
  return root;
}

test('configuration collects independent problems and rejects unknown fields', () => {
  assert.throws(() => config({ potato: true, port: 0, node: 'latest', publishPorts: 'yes' }), error => {
    assert.equal(error.problems.length, 4); return true;
  });
});
test('malformed commands, duplicates, and unsupported package managers fail', () => {
  for (const data of [{ processes: { worker: [] } }, { deployCommands: [123] }, { packageManager: 'yarn' }, { packageManager: 'pnpm' },
    { additionalServices: [{ group: 'database', service: 'postgres', name: 'a' }, { group: 'database', service: 'postgres', name: 'a' }] }]) {
    assert.throws(() => config(data));
  }
});
test('service contexts require production secrets and preserve instance prefixes', () => {
  const dev = serviceContext('development', 'postgres', 'analytics', 'warehouse');
  const prod = serviceContext('production', 'postgres', 'analytics', 'warehouse');
  assert.equal(dev.credential('DB_PASSWORD', 'shipsecret'), '${ANALYTICS_DB_PASSWORD:-shipsecret}');
  assert.equal(prod.credential('DB_PASSWORD', 'shipsecret'), '${ANALYTICS_DB_PASSWORD:?ANALYTICS_DB_PASSWORD is required in .env.production}');
  assert.equal(prod.resourceName, 'postgres-analytics');
});
test('renaming a database changes injected hosts without moving its volume', () => {
  const model = buildCompose(config({ services: { database: 'postgres' }, serviceNames: { postgres: 'database' },
    additionalServices: [{ group: 'database', service: 'postgres', name: 'analytics' }] }), '/project', 'development');
  assert.equal(model.services.app.environment.DB_HOST, 'database');
  assert.equal(model.services.app.environment.ANALYTICS_DB_HOST, 'postgres-analytics');
  assert.equal(model.services.app.environment.ANALYTICS_DB_USERNAME, '${ANALYTICS_DB_USERNAME:-${ANALYTICS_DB_USER:-ship}}');
  assert.equal(model.services.app.environment.ANALYTICS_DB_USER, model.services.app.environment.ANALYTICS_DB_USERNAME);
  assert.deepEqual(model.services.database.volumes, ['postgres_data:/var/lib/postgresql']);
  assert.equal(model.services.database.ports, undefined);
  assert.match(model.services.app.ports[0], /^127\.0\.0\.1:/);
});
test('unknown services, absent renames and final name collisions fail before Docker', () => {
  for (const data of [{ services: { database: 'unknown' } }, { serviceNames: { postgres: 'db' } },
    { services: { database: 'postgres' }, serviceNames: { postgres: 'app' } }, { processes: { jobs: ['node', 'worker.js'] }, serviceNames: { app: 'jobs' } }]) {
    assert.throws(() => buildCompose(config(data), '/project', 'development'));
  }
});
test('production workers share one image and preserve literal command dollar signs', () => {
  const cfg = config({ externalNetwork: 'proxy', processes: { worker: 'echo "$TOKEN"' } });
  const prod = buildCompose(cfg, '/project', 'production', 'v1');
  assert.equal(prod.services.app.ports, undefined);
  assert.equal(prod.services.app.volumes, undefined);
  assert.equal(prod.services.worker.build, undefined);
  assert.equal(prod.services.worker.image, prod.services.app.image);
  assert.deepEqual(prod.services.worker.command, ['sh', '-c', 'echo "$$TOKEN"']);
  assert.deepEqual(prod.services.worker.networks, ['ship', 'external']);
  assert.equal(prod.services.worker.stop_grace_period, '60s');
  assert.equal(buildCompose(cfg, '/project', 'development').services.worker, undefined);
});
test('init validates before writing and preserves user edits and existing choices', async t => {
  const root = await project(t);
  await writeFile(join(root, 'package.json'), '{"scripts":{}}');
  await assert.rejects(initProject(root), /script/);
  assert.equal((await readdir(root)).includes('ship'), false);
  await cp(join(fixture, 'package.json'), join(root, 'package.json'));
  await initProject(root, { database: 'postgres', cache: 'redis' });
  await writeFile(join(root, 'ship/Dockerfile'), '# custom image\n');
  await writeFile(join(root, '.gitignore'), 'custom-rule\n');
  const cfg = await initProject(root);
  assert.equal(cfg.services.database, 'postgres');
  assert.equal(await readFile(join(root, 'ship/Dockerfile'), 'utf8'), '# custom image\n');
  assert.match(await readFile(join(root, '.gitignore'), 'utf8'), /custom-rule/);
  assert.match(await readFile(join(root, '.dockerignore'), 'utf8'), /\.env\.\*/);
  await initProject(root, { force: true, database: 'none' });
  assert.match(await readFile(join(root, 'ship/Dockerfile'), 'utf8'), /FROM \$\{NODE_IMAGE\}/);
});
test('foreign lockfiles and workspaces are rejected explicitly', async t => {
  const root = await project(t);
  await writeFile(join(root, 'pnpm-lock.yaml'), '');
  await assert.rejects(initProject(root), /conflict/i);
  await rm(join(root, 'pnpm-lock.yaml'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'node x', start: 'node x' }, workspaces: ['packages/*'] }));
  assert.match((await projectProblems(config(), root)).join(), /Workspace/);
});
test('development overrides are applied to every dev command and excluded from production', async t => {
  const root = await project(t);
  await initProject(root);
  await writeFile(join(root, 'compose.override.yaml'), 'services: {}');
  assert.ok((await composePrefix(root, config(), 'development')).prefix.includes(join(root, 'compose.override.yaml')));
  assert.ok(!(await composePrefix(root, config(), 'production')).prefix.includes(join(root, 'compose.override.yaml')));
});

test('explicit up refreshes app without changing infrastructure or production definitions', async t => {
  const root = await project(t);
  const cfg = await initProject(root, { database: 'postgres' });
  const first = (await composePrefix(root, cfg, 'development', 'local', { refreshApp: true })).model;
  const next = (await composePrefix(root, cfg, 'development', 'local', { refreshApp: true })).model;
  assert.notEqual(first.services.app.labels['io.ship.dev-start'], next.services.app.labels['io.ship.dev-start']);
  assert.deepEqual(first.services.postgres, next.services.postgres);
  assert.equal((await composePrefix(root, cfg, 'production', 'local', { refreshApp: true })).model.services.app.labels, undefined);
});
test('production validation rejects missing/default secrets without revealing values', async t => {
  const root = await project(t);
  const model = buildCompose(config({ services: { database: 'postgres' } }), root, 'production');
  assert.match((await productionProblems(model, root)).join(), /required/);
  await writeFile(join(root, '.env.production'), 'DB_PASSWORD=shipsecret\n');
  assert.match((await productionProblems(model, root)).join(), /development credential/);
  await writeFile(join(root, '.env.production'), "DB_PASSWORD='correct horse battery staple'\n");
  assert.deepEqual(await productionProblems(model, root), []);
});
test('environment parsing handles quoted comments, export, BOM and CRLF', () => {
  assert.deepEqual({ ...parseEnv('\uFEFFexport A="hello # world"\r\nB=ok # comment\nC=\'literal$\'\n') }, { A: 'hello # world', B: 'ok', C: 'literal$' });
  assert.throws(() => parseEnv('A="unclosed'), /Unclosed/);
});
test('process runner preserves raw arguments and nonzero exit codes', { skip: restricted && 'session prohibits child-process execution' }, async () => {
  const args = ['--force', 'space value', '$(touch nope)', '$TOKEN', '"quote"'];
  assert.deepEqual(JSON.parse(await run([process.execPath, '-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--', ...args], process.cwd(), { capture: true })), args);
  await assert.rejects(run([process.execPath, '-e', 'process.exit(7)'], process.cwd(), { capture: true }), error => error.exitCode === 7);
});
test('captured process failures retain diagnostics from both output streams', { skip: restricted && 'session prohibits child-process execution' }, async () => {
  await assert.rejects(run([process.execPath, '-e', 'console.log("build diagnostic"); console.error("failure summary"); process.exitCode=9;'], process.cwd(), { capture: true }), error => {
    assert.equal(error.exitCode, 9);
    assert.match(error.stdout, /build diagnostic/);
    assert.match(error.stderr, /failure summary/);
    return true;
  });
});
test('CLI help/version work outside a project and bad init flags make no changes', { skip: restricted && 'session prohibits child-process execution' }, async t => {
  const root = await project(t);
  assert.match(await run([process.execPath, cli, '--help'], root, { capture: true }), /JavaScript Ship/);
  assert.match(await run([process.execPath, cli, '--version'], root, { capture: true }), /0\.1\.0/);
  await assert.rejects(run([process.execPath, cli, 'init', '--bogus'], root, { capture: true }));
  assert.equal((await readdir(root)).includes('ship'), false);
});
test('release models contain no build contexts or host source mounts', () => {
  const model = releaseModel(buildCompose(config(), '/private/source', 'production'));
  assert.equal(model.services.app.build, undefined);
  assert.equal(JSON.stringify(model).includes('/private/source'), false);
  assert.deepEqual(model.services.app.env_file, [{ path: '.env', required: true }]);
});
test('deploy commands run once after infrastructure and are shell-quoted safely', () => {
  const cfg = config({ services: { database: 'postgres' }, deployCommands: [['node', 'migrate.js', "a'b $HOME"]] });
  const script = deployScript(cfg, buildCompose(cfg, '/project', 'production'));
  assert.ok(script.indexOf('up -d --wait') < script.indexOf('run --rm --no-deps'));
  assert.ok(script.includes("'a'\\''b $HOME'"));
  assert.equal((script.match(/run --rm/g) ?? []).length, 1);
});
test('unsafe release tags are rejected', () => {
  for (const tag of ['../escape', '/tmp/x', '.hidden', '-option', 'space tag', 'v1\n', 'v1\r\n']) assert.throws(() => validateTag(tag));
  validateTag('v1.0.0-rc.1');
});
test('release exports each image once, hashes archives and preserves existing releases', async t => {
  const root = await project(t);
  const cfg = await initProject(root, { database: 'postgres', cache: 'redis' });
  cfg.processes.worker = ['node', 'worker.js'];
  await writeFile(join(root, '.env.production'), 'DB_PASSWORD=unique-production-password\n');
  const calls = [];
  const runner = async args => {
    calls.push(args);
    if (args[1] === 'save') await writeFile(args[3], `archive:${args[4]}`);
    return imageInspection(args) ?? '';
  };
  const destination = await assembleRelease(root, cfg, 'v1', runner);
  const manifest = JSON.parse(await readFile(join(destination, 'release.json'), 'utf8'));
  assert.equal(manifest.images.length, 2);
  assert.equal(manifest.pulledImages.length, 1);
  const app = manifest.images.find(item => item.services.includes('app'));
  assert.deepEqual(app.services, ['app', 'worker']);
  for (const entry of manifest.images) assert.equal(entry.sha256, createHash('sha256').update(await readFile(join(destination, entry.file))).digest('hex'));
  assert.equal(calls.filter(args => args.includes('build')).length, 1);
  const pull = calls.find(args => args.includes('pull') && !args.includes('build'));
  assert.equal(pull.at(-1), 'redis');
  assert.ok(!JSON.stringify(await readFile(join(destination, 'docker-compose.yml'), 'utf8')).includes(root));
  if (process.platform !== 'win32') assert.equal((await stat(join(destination, '.env'))).mode & 0o777, 0o600);
  const previousCalls = calls.length;
  await assert.rejects(assembleRelease(root, cfg, 'v1', runner), /already exists/);
  assert.equal(calls.length, previousCalls);
});
test('a failed image export leaves no partial published release', async t => {
  const root = await project(t);
  const cfg = await initProject(root);
  await writeFile(join(root, '.env.production'), '');
  await assert.rejects(assembleRelease(root, cfg, 'broken', async args => {
    if (args[1] === 'save') throw new Error('export failed');
    return imageInspection(args) ?? '';
  }), /export failed/);
  assert.deepEqual(await readdir(join(root, 'dist/ship')), []);
});
test('Compose status handles JSON arrays and newline-delimited records', () => {
  assert.deepEqual(statusRecords('[{"Service":"app"}]'), [{ Service: 'app' }]);
  assert.equal(statusRecords('{"Service":"app"}\n{"Service":"postgres"}').length, 2);
  assert.throws(() => statusRecords('not JSON'), /invalid/);
});
test('readiness fails fast on crashed containers', async () => {
  await assert.rejects(waitForStack([], '/tmp', 'app', 3000, async () => '[{"Service":"app","State":"exited"}]'), /app is exited/);
});
test('readiness requires an actual HTTP response and accepts a framework 404', { skip: restricted && 'session prohibits listening sockets' }, async t => {
  const server = createServer((_req, res) => { res.writeHead(404); res.end('ready'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  assert.equal(await waitForStack([], '/tmp', 'app', 3000, async () => JSON.stringify([{ Service: 'app', State: 'running', Publishers: [{ TargetPort: 3000, PublishedPort: port }] }])), port);
});
test('process deadlines terminate a blocked command with a recognizable timeout status', { skip: restricted }, async () => {
 await assert.rejects(run([process.execPath, '-e', 'setInterval(()=>{},1000)'], '/tmp', { capture: true, timeoutMs: 100 }), error => error.exitCode === 124 && /timed out/.test(error.message));
});
