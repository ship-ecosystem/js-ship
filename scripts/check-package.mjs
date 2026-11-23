import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run test:package so the npm executable is known on every platform.');
const args = process.argv.slice(2);
if (args.length > 1) throw new Error('Usage: npm run test:package [-- OUTPUT_DIRECTORY]');
const outputDirectory = args[0] ? resolve(args[0]) : undefined;
const work = await mkdtemp(join(tmpdir(), 'ship-package-'));
function run(args, cwd) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Package check command failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
try {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const packed = JSON.parse(run([npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', work], root))[0];
  const allowedRoots = new Set(['dist', 'templates', 'schema', 'docs', 'package.json', 'README.md', 'LICENSE.md', 'SECURITY.md', 'CHANGELOG.md']);
  for (const entry of packed.files) {
    assert.ok(allowedRoots.has(entry.path.split('/')[0]), `Unexpected package file: ${entry.path}`);
    assert.doesNotMatch(entry.path, /(?:^|\/)(?:\.env(?:\.|$)|\.npmrc$|\.ship-secrets(?:\/|$))/);
  }
  assert.ok(packed.files.some(entry => entry.path === 'CHANGELOG.md'));
  const consumer = join(work, 'consumer'), app = join(work, 'app'), site = join(work, 'gatsby'), workspace = join(work, 'workspace');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), '{"private":true,"type":"module"}');
  // The pinned prompt dependencies were cached by npm ci; verify tarball installation offline.
  run([npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(work, packed.filename)], consumer);
  const installed = join(consumer, 'node_modules', ...pkg.name.split('/'));
  const cli = join(installed, 'dist/cli.js');
  assert.match(run([cli, '--help'], consumer), /JavaScript Ship/);
  assert.equal(run([cli, '--version'], consumer).trim(), pkg.version);
  await stat(join(consumer, 'node_modules/.bin', process.platform === 'win32' ? 'ship.cmd' : 'ship'));
  await assert.rejects(stat(join(installed, 'src')));
  await assert.rejects(stat(join(consumer, 'node_modules/typescript')));
  await assert.rejects(stat(join(consumer, 'node_modules/ajv')));
  await assert.rejects(stat(join(consumer, 'node_modules/playwright')));
  await assert.rejects(stat(join(consumer, 'node_modules/playwright-core')));
  await cp(join(root, 'examples/node'), app, { recursive: true });
  run([cli, '--project-directory', app, 'init', '--database', 'mongodb', '--no-interaction'], consumer);
  await writeFile(join(app, '.env.production'), 'MONGODB_PASSWORD=package-check-app\nMONGODB_ROOT_PASSWORD=package-check-admin\n', { mode: 0o600 });
  run([cli, '--project-directory', app, 'config:test'], consumer);
  const doctor = spawnSync(process.execPath, [cli, '--project-directory', app, 'doctor', '--json'], { cwd: consumer, encoding: 'utf8', env: process.env });
  assert.ok([0, 1].includes(doctor.status)); assert.equal(doctor.stderr, '');
  const diagnostics = JSON.parse(doctor.stdout);
  assert.equal(diagnostics.ok, doctor.status === 0); assert.ok(Array.isArray(diagnostics.checks));
  assert.ok(diagnostics.checks.some(check => check.name === 'project' && check.status === 'ok'));
  assert.ok(!diagnostics.checks.some(check => check.name === 'project' && check.status === 'error'));
  await assert.rejects(stat(join(app, 'ship/docker-compose.generated.yml')));

  await mkdir(site);
  await writeFile(join(site, 'package.json'), JSON.stringify({ private: true, type: 'commonjs', packageManager: 'npm@12.2.2',
    dependencies: { gatsby: '5.16.1' }, scripts: { dev: 'gatsby develop', build: 'gatsby build' } }));
  await writeFile(join(site, 'package-lock.json'), '{}');
  run([cli, '--project-directory', site, 'init', '--no-interaction'], consumer);
  run([cli, '--project-directory', site, 'config:test'], consumer);
  await mkdir(join(workspace, 'apps/api'), { recursive: true });
  await writeFile(join(workspace, 'package.json'), JSON.stringify({ private: true, workspaces: ['apps/*'], packageManager: 'npm@12.2.2' }));
  await writeFile(join(workspace, 'package-lock.json'), '{}');
  await cp(join(root, 'examples/node/package.json'), join(workspace, 'apps/api/package.json'));
  run([cli, '--project-directory', workspace, 'init', '--workspace', 'apps/api', '--no-interaction'], consumer);
  run([cli, '--project-directory', workspace, 'config:test'], consumer);
  const yarn = join(work, 'yarn');
  await cp(join(root, 'examples/node'), yarn, { recursive: true });
  await rm(join(yarn, 'package-lock.json'));
  const yarnManifest = JSON.parse(await readFile(join(yarn, 'package.json'), 'utf8'));
  await writeFile(join(yarn, 'package.json'), JSON.stringify({ ...yarnManifest, packageManager: 'yarn@4.18.1' }));
  await writeFile(join(yarn, 'yarn.lock'), '__metadata:\n  version: 8\n');
  await writeFile(join(yarn, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
  run([cli, '--project-directory', yarn, 'init', '--no-interaction'], consumer);
  run([cli, '--project-directory', yarn, 'config:test'], consumer);
  assert.equal(JSON.parse(await readFile(join(yarn, 'ship.json'), 'utf8')).packageManager, 'yarn');
  const custom = join(consumer, 'custom');
  await cp(join(root, 'examples/node'), custom, { recursive: true });
  await writeFile(join(custom, 'ship.extensions.mjs'), `import { builtinAdapters } from ${JSON.stringify(pkg.name)};
export default { apiVersion: 1, name: 'installed', version: '1.0.0',
  adapters: [{ ...builtinAdapters.get('generic'), key: 'installed-node', label: 'Installed Node' }],
  templates: { 'notes.txt': 'installed extension template' } };`);
  await writeFile(join(custom, 'ship.json'), JSON.stringify({ extensions: ['ship.extensions.mjs'], framework: 'installed-node' }));
  run([cli, '--project-directory', custom, 'init', '--no-interaction'], consumer);
  run([cli, '--project-directory', custom, 'config:test'], consumer);
  assert.equal(await readFile(join(custom, 'ship/extensions/installed/notes.txt'), 'utf8'), 'installed extension template');
  await writeFile(join(consumer, 'extension.mts'), `import { builtinAdapters, createRegistry, type ShipExtension } from ${JSON.stringify(pkg.name)};
const extension = { apiVersion: 1, name: 'typed', version: '1.0.0', adapters: [
  { ...builtinAdapters.get('generic')!, key: 'typed-node', label: 'Typed Node' }
], services: [{ key: 'typed-service', label: 'Typed service', group: 'cache', volumes: ['data'],
  compose: context => ({ image: 'redis:7', volumes: [context.volume('data') + ':/data'] }),
  appEnvironment: context => ({ TYPED_HOST: context.serviceName }) }] } satisfies ShipExtension;
const registry = createRegistry([extension]);
// @ts-expect-error Registries expose read-only maps.
registry.adapters.set('oops', extension.adapters[0]);
// @ts-expect-error Unsupported extension API versions are rejected by the type contract.
const incompatible: ShipExtension = { apiVersion: 2, name: 'bad', version: '1.0.0' };
`);
  await writeFile(join(consumer, 'tsconfig.extension.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true,
    target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', types: [] }, files: ['extension.mts'] }));
  run([join(root, 'node_modules/typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.extension.json')], consumer);
  const verify = join(consumer, 'verify.mjs');
  await writeFile(verify, `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { builtinAdapters, readConfig, buildCompose, buildProjectCompose, shipConfigSchema, loadExtensions, createConfigSchema } from ${JSON.stringify(pkg.name)};
const bundledSchema = JSON.parse(await readFile(createRequire(import.meta.url).resolve(${JSON.stringify(pkg.name + '/schema.json')}), 'utf8'));
const canonical = JSON.parse(await readFile(${JSON.stringify(join(root, "schema/canonical/ship.schema.json"))}, 'utf8'));
assert.deepEqual(bundledSchema, canonical);
const authored = JSON.parse(await readFile(join(process.argv[2], 'ship.json'), 'utf8'));
assert.equal(authored.$schema, './ship/ship.schema.json');
assert.deepEqual(JSON.parse(await readFile(join(process.argv[2], authored.$schema), 'utf8')), shipConfigSchema);
const extensionConfig = await readConfig(process.argv[5]);
const registry = await loadExtensions(process.argv[5], extensionConfig.extensions);
assert.ok(registry.adapters.has('installed-node'));
assert.equal(builtinAdapters.has('installed-node'), false);
assert.equal(createConfigSchema(registry).properties.framework.enum.includes('installed-node'), true);
const config = await readConfig(process.argv[2]);
assert.equal(config.services.database, 'mongodb');
assert.equal(builtinAdapters.size, 15);
const workspaceConfig = await readConfig(process.argv[4]);
const workspaceModel = await buildProjectCompose(workspaceConfig, process.argv[4], 'development');
assert.equal(workspaceModel.services.app.working_dir, '/app/apps/api');
assert.equal(workspaceModel.services.app.volumes.length, 3);
const model = buildCompose(config, process.argv[2], 'production');
assert.ok(model.services.mongodb.build);
assert.equal(model.services.app.environment.MONGODB_ROOT_PASSWORD, '');
process.chdir(process.argv[3]);
const adapter = createRequire(import.meta.url)(join(process.argv[3], 'ship/gatsby-adapter.cjs'))();
await adapter.adapt({ routesManifest: [{ type: 'static', path: '/' }], functionsManifest: [], pathPrefix: '',
  headerRoutes: [{ path: '/*', headers: [{ key: 'cache-control', value: 'public, max-age=0, must-revalidate' }] }] });
assert.equal(JSON.parse(await readFile('ship/.gatsby-static.json', 'utf8')).static, true);
assert.match(await readFile('ship/nginx.conf', 'utf8'), /X-Content-Type-Options/);
`);
  run([verify, app, site, workspace, custom], consumer);
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
    await cp(join(work, packed.filename), join(outputDirectory, 'js-ship.tgz'), { force: false, errorOnExist: true });
  }
  console.log(`Installed tarball verified: ${pkg.name}@${pkg.version} (${packed.entryCount} files).`);
} finally {
  await rm(work, { recursive: true, force: true });
}
