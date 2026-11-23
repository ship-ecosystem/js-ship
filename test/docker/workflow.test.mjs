import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { run } from '../../dist/process.js';
import { composePrefix } from '../../dist/project.js';
import { parseConfig } from '../../dist/config.js';
import { waitForResponse } from './support.mjs';

test('generic Node development, database shell and source-free production release', { timeout: 600_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ship-js-docker-'));
  const cli = resolve('dist/cli.js');
  const ship = args => run([process.execPath, cli, ...args], root, { env: { ...process.env, APP_PORT: '0' } });
  const name = `ship-js-test-${randomBytes(5).toString('hex')}`;
  let cfg;
  let destination;
  t.after(async () => {
    if (cfg) {
      const { prefix } = await composePrefix(root, cfg, 'development');
      await run([...prefix, 'down', '--volumes', '--remove-orphans'], root).catch(() => {});
      if (destination) await run(['docker', 'compose', 'down', '--volumes', '--remove-orphans'], destination).catch(() => {});
    }
    for (const image of [`${name}-app:local`, `${name}-app:smoke`]) await run(['docker', 'image', 'rm', image], root).catch(() => {});
    if (destination) await rm(destination, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });
  await cp(resolve('examples/node'), root, { recursive: true });
  await ship(['init', '--no-interaction', '--database', 'postgres', '--cache', 'redis']);
  const data = JSON.parse(await readFile(join(root, 'ship.json'), 'utf8'));
  data.name = name;
  data.publishPorts = true;
  // Exercise once-per-deploy command packaging without imposing an ORM.
  data.deployCommands = [['node', '-e', "console.log('deployment command ran')"]];
  await writeFile(join(root, 'ship.json'), JSON.stringify(data));
  cfg = parseConfig(data, root);
  await writeFile(join(root, '.env.production'), `DB_PASSWORD=${randomBytes(24).toString('hex')}\n`);
  await ship(['config:test']);
  await ship(['up']);
  await ship(['exec', 'postgres', 'psql', '-U', 'ship', '-d', 'ship', '-c', 'select 1']);
  await ship(['npm', '--version']);
  await ship(['down']);
  await ship(['release', '--tag', 'smoke']);
  destination = await mkdtemp(join(tmpdir(), 'ship-js-portable-'));
  await cp(join(root, 'dist/ship/smoke'), destination, { recursive: true });
  const manifest = JSON.parse(await readFile(join(destination, 'release.json'), 'utf8'));
  assert.equal(manifest.images.length, 2);
  assert.equal(manifest.pulledImages.length, 1);
  const { check } = await import("../../scripts/spec/check-release.mjs");
  assert.deepEqual(check(destination), []);
  // Hide the original source checkout: the artifact must be sufficient by itself.
  await rm(join(root, 'server.mjs'));
  for (const entry of manifest.images) await run(['docker', 'load', '-i', join(destination, entry.file)], destination);
  await run(['sh', 'deploy-commands.sh'], destination);
  await run(['docker', 'compose', 'up', '-d', '--wait'], destination, { env: { ...process.env, APP_PORT: '0' } });
  const published = await run(['docker', 'compose', 'port', 'app', '3000'], destination, { capture: true });
  const port = Number(published.trim().split(':').at(-1));
  await waitForResponse(`http://127.0.0.1:${port}`);
  const response = await fetch(`http://127.0.0.1:${port}`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).environment, 'production');
});
