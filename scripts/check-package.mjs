import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run test:package so the npm executable is known on every platform.');
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
  const consumer = join(work, 'consumer'), app = join(work, 'app'), site = join(work, 'gatsby');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), '{"private":true,"type":"module"}');
  // No runtime dependencies: installation from the built tarball needs no registry.
  run([npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(work, packed.filename)], consumer);
  const installed = join(consumer, 'node_modules', ...pkg.name.split('/'));
  const cli = join(installed, 'dist/cli.js');
  assert.match(run([cli, '--help'], consumer), /JavaScript Ship/);
  assert.equal(run([cli, '--version'], consumer).trim(), pkg.version);
  await stat(join(consumer, 'node_modules/.bin', process.platform === 'win32' ? 'ship.cmd' : 'ship'));
  await assert.rejects(stat(join(installed, 'src')));
  await assert.rejects(stat(join(consumer, 'node_modules/typescript')));
  await assert.rejects(stat(join(consumer, 'node_modules/playwright')));
  await assert.rejects(stat(join(consumer, 'node_modules/playwright-core')));
  await cp(join(root, 'examples/node'), app, { recursive: true });
  run([cli, '--project-directory', app, 'init', '--database', 'mongodb', '--no-interaction'], consumer);
  await writeFile(join(app, '.env.production'), 'MONGODB_PASSWORD=package-check-app\nMONGODB_ROOT_PASSWORD=package-check-admin\n', { mode: 0o600 });
  run([cli, '--project-directory', app, 'config:test'], consumer);
  await mkdir(site);
  await writeFile(join(site, 'package.json'), JSON.stringify({ private: true, type: 'commonjs', packageManager: 'npm@12.2.2',
    dependencies: { gatsby: '5.16.1' }, scripts: { dev: 'gatsby develop', build: 'gatsby build' } }));
  await writeFile(join(site, 'package-lock.json'), '{}');
  run([cli, '--project-directory', site, 'init', '--no-interaction'], consumer);
  run([cli, '--project-directory', site, 'config:test'], consumer);
  const verify = join(consumer, 'verify.mjs');
  await writeFile(verify, `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { builtinAdapters, readConfig, buildCompose } from ${JSON.stringify(pkg.name)};
const config = await readConfig(process.argv[2]);
assert.equal(config.services.database, 'mongodb');
assert.equal(builtinAdapters.size, 15);
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
  run([verify, app, site], consumer);
  console.log(`Installed tarball verified: ${pkg.name}@${pkg.version} (${packed.entryCount} files).`);
} finally {
  await rm(work, { recursive: true, force: true });
}
