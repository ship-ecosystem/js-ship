import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { run } from '../../dist/process.js';
import { composePrefix } from '../../dist/project.js';
import { readConfig } from '../../dist/config.js';
import { lockFixture } from './support.mjs';

async function responds(url) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { return await fetch(url, { signal: AbortSignal.timeout(1000) }); }
    catch { await delay(250); }
  }
  throw new Error(`HTTP did not become ready: ${url}`);
}

test('VitePress static release serves subpaths, assets and genuine 404s without Node/source', { timeout: 600_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ship-js-static-docker-'));
  const cli = resolve('dist/cli.js');
  const name = `ship-static-test-${randomBytes(5).toString('hex')}`;
  let cfg, destination;
  const ship = async args => {
    try { return await run([process.execPath, cli, ...args], root, { env: { ...process.env, APP_PORT: '0' } }); }
    catch (error) {
      if (cfg) {
        const { prefix } = await composePrefix(root, cfg, 'development');
        await run([...prefix, 'logs', '--tail', '50'], root).catch(() => {});
      }
      throw error;
    }
  };
  t.after(async () => {
    if (cfg) {
      const { prefix } = await composePrefix(root, cfg, 'development');
      await run([...prefix, 'down', '--volumes', '--remove-orphans'], root).catch(() => {});
    }
    if (destination) {
      await run(['docker', 'compose', 'down', '--volumes', '--remove-orphans'], destination).catch(() => {});
      await rm(destination, { recursive: true, force: true });
    }
    for (const tag of ['local', 'static-smoke']) await run(['docker', 'image', 'rm', `${name}-app:${tag}`], root).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'docs/index.md'), '# Ship documentation fixture\n\n[Guide](./guide.md)\n');
  await writeFile(join(root, 'docs/guide.md'), '# Ship guide fixture\n\nA generated HTML page.\n');
  await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', packageManager: 'npm@12.2.2',
    devDependencies: { vitepress: '1.6.4' }, scripts: { 'docs:dev': 'vitepress dev docs', 'docs:build': 'vitepress build docs' } }));
  // Match the other fixtures: metadata created as container root is recreated
  // as the host test user before the non-root development install.
  await lockFixture(root);
  await ship(['init', '--no-interaction']);
  cfg = { ...await readConfig(root), name, basePath: '/handbook/', publishPorts: true };
  await writeFile(join(root, 'ship.json'), JSON.stringify(cfg));
  await ship(['init', '--force', '--no-interaction']);
  await writeFile(join(root, '.env.production'), 'PRIVATE_SERVER_SECRET=not-for-the-browser\n');
  await ship(['up']);
  const { prefix } = await composePrefix(root, cfg, 'development');
  const devPort = Number((await run([...prefix, 'port', 'app', '5173'], root, { capture: true })).trim().split(':').at(-1));
  const devBase = `http://127.0.0.1:${devPort}/handbook/`;
  assert.match(await (await responds(devBase)).text(), /@vite\/client/);
  const markdown = await fetch(new URL('index.md', devBase));
  assert.equal(markdown.status, 200);
  assert.match(await markdown.text(), /Ship documentation fixture/);
  await ship(['down']);
  await ship(['release', '--tag', 'static-smoke']);
  destination = await mkdtemp(join(tmpdir(), 'ship-js-static-portable-'));
  await cp(join(root, 'dist/ship/static-smoke'), destination, { recursive: true });
  await rm(join(root, 'docs'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(destination, 'release.json'), 'utf8'));
  for (const entry of manifest.images) await run(['docker', 'load', '-i', join(destination, entry.file)], destination);
  await run(['docker', 'compose', 'up', '-d', '--wait'], destination, { env: { ...process.env, APP_PORT: '0' } });
  const port = Number((await run(['docker', 'compose', 'port', 'app', '8080'], destination, { capture: true })).trim().split(':').at(-1));
  const base = `http://127.0.0.1:${port}/handbook/`;
  const html = await (await responds(base)).text();
  assert.match(html, /Ship documentation fixture/);
  const guide = await fetch(new URL('guide', base));
  assert.equal(guide.status, 200);
  assert.match(await guide.text(), /Ship guide fixture/);
  const asset = /src="([^"]+\.js)"/.exec(html)?.[1];
  assert.ok(asset, 'generated HTML must reference a script asset');
  assert.equal((await fetch(new URL(asset, base))).status, 200);
  assert.equal((await fetch(new URL('missing.js', base))).status, 404);
  assert.equal((await fetch(new URL('missing-page', base))).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 404);
  await run(['docker', 'compose', 'exec', '-T', 'app', 'nginx', '-t'], destination);
  await assert.rejects(run(['docker', 'compose', 'exec', '-T', 'app', 'node', '--version'], destination));
});
