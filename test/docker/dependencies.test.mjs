import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { run } from '../../dist/process.js';
import { readConfig } from '../../dist/config.js';
import { composePrefix } from '../../dist/project.js';
import { lockFixture, publishedPort, waitForResponse } from './support.mjs';

for (const manager of ['npm', 'pnpm']) test(`${manager}: proxy updates, source reload and dependency refresh after a branch change`, { timeout: 600_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ship-dependency-test-'));
  const name = `ship-dependency-${randomBytes(5).toString('hex')}`;
  const cli = resolve('dist/cli.js');
  let cfg;
  const ship = args => run([process.execPath, cli, ...args], root, { env: { ...process.env, APP_PORT: '0' } });
  t.after(async () => {
    if (cfg) { const { prefix } = await composePrefix(root, cfg, 'development'); await run([...prefix, 'down', '--volumes'], root).catch(() => {}); }
    await run(['docker', 'image', 'rm', `${name}-app:local`], root, { capture: true }).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  await cp(resolve('examples/node'), root, { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  manifest.packageManager = `${manager}@${manager === 'npm' ? '12.2.2' : '12.21.0'}`;
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
  if (manager === 'pnpm') { await rm(join(root, 'package-lock.json')); await lockFixture(root, manager); }
  const lock = manager === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml';
  const originalManifest = await readFile(join(root, 'package.json'));
  const originalLock = await readFile(join(root, lock));
  const originalSource = await readFile(join(root, 'server.mjs'), 'utf8');
  await writeFile(join(root, 'ship.json'), JSON.stringify({ name }));
  await ship(['init', '--no-interaction']); cfg = await readConfig(root);
  await ship(['up']);
  const { prefix } = await composePrefix(root, cfg, 'development');
  let port = await publishedPort(prefix, root, 3000);
  await writeFile(join(root, 'server.mjs'), originalSource.replace('Hello from JavaScript Ship', 'Reloaded fixture'));
  await waitForResponse(`http://127.0.0.1:${port}`, async response => (await response.json()).message === 'Reloaded fixture');
  await ship([manager, manager === 'npm' ? 'install' : 'add', '--save-exact', 'is-number@7.0.0']);
  assert.equal(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).dependencies['is-number'], '7.0.0');
  await ship(['exec', 'app', 'node', '-e', "import('is-number').then(m=>{if(!m.default(42))process.exit(1)})"]);
  // Simulate a checkout whose manifest, lockfile and source no longer contain the dependency.
  await writeFile(join(root, 'package.json'), originalManifest);
  await writeFile(join(root, lock), originalLock);
  await writeFile(join(root, 'server.mjs'), originalSource);
  await ship(['up']);
  port = await publishedPort(prefix, root, 3000);
  await waitForResponse(`http://127.0.0.1:${port}`, async response => (await response.json()).message === 'Hello from JavaScript Ship');
  await ship(['exec', 'app', 'node', '-e', "import('node:fs').then(fs=>{if(fs.existsSync('/app/node_modules/is-number')){console.error('stale dependency after checkout');process.exit(1)}})"]);
});
