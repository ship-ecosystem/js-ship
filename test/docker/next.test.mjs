import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { run } from '../../dist/process.js';
import { readConfig } from '../../dist/config.js';
import { composePrefix } from '../../dist/project.js';
import { lockFixture, publishedPort, waitForResponse } from './support.mjs';
import { exerciseNextExport } from '../fixtures/next-export.mjs';

test('Next.js standalone serves SSR and assets from a source-free release as a non-root user', { timeout: 900_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ship-next-test-'));
  const name = `ship-next-${randomBytes(5).toString('hex')}`;
  const cli = resolve('dist/cli.js');
  let cfg, destination;
  const ship = args => run([process.execPath, cli, ...args], root, { env: { ...process.env, APP_PORT: '0' } });
  t.after(async () => {
    if (cfg) { const { prefix } = await composePrefix(root, cfg, 'development'); await run([...prefix, 'down', '--volumes'], root).catch(() => {}); }
    if (destination) { await run(['docker', 'compose', 'down', '--volumes'], destination).catch(() => {}); await rm(destination, { recursive: true, force: true }); }
    for (const tag of ['local', 'standalone']) await run(['docker', 'image', 'rm', `${name}-app:${tag}`], root, { capture: true }).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'app')); await mkdir(join(root, 'public'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', packageManager: 'npm@12.2.2', scripts: { dev: 'next dev', build: 'next build' }, dependencies: { next: '16.4.6', react: '19.3.1', 'react-dom': '19.3.1' } }));
  await writeFile(join(root, 'next.config.mjs'), "export default { output: 'standalone', experimental: { cpus: 1 } };\n");
  await writeFile(join(root, 'app/layout.jsx'), 'export default function Layout({children}) { return <html><body>{children}</body></html>; }');
  await writeFile(join(root, 'app/page.jsx'), "export const dynamic = 'force-dynamic'; export default function Page() { return <h1>Ship Next fixture</h1>; }");
  await writeFile(join(root, 'public/fixture.txt'), 'standalone public asset');
  await lockFixture(root);
  await writeFile(join(root, 'ship.json'), JSON.stringify({ name, publishPorts: true }));
  await ship(['init', '--no-interaction']); cfg = await readConfig(root);
  await writeFile(join(root, '.env.production'), '');
  await ship(['up']);
  const { prefix } = await composePrefix(root, cfg, 'development');
  const devPort = await publishedPort(prefix, root, 3000);
  await waitForResponse(`http://127.0.0.1:${devPort}`, async response => response.status === 200 && (await response.text()).includes('Ship Next fixture'));
  await ship(['down']);
  await ship(['release', '--tag', 'standalone']);
  destination = await mkdtemp(join(tmpdir(), 'ship-next-portable-'));
  await cp(join(root, 'dist/ship/standalone'), destination, { recursive: true });
  await rm(join(root, 'app'), { recursive: true }); await rm(join(root, 'public'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(destination, 'release.json'), 'utf8'));
  for (const image of manifest.images) await run(['docker', 'load', '-i', join(destination, image.file)], destination);
  await run(['docker', 'compose', 'up', '-d', '--wait'], destination, { env: { ...process.env, APP_PORT: '0' } });
  const port = await publishedPort(['docker', 'compose'], destination, 3000);
  const base = `http://127.0.0.1:${port}`;
  await waitForResponse(base, async response => response.status === 200 && (await response.text()).includes('Ship Next fixture'));
  const html = await (await fetch(base)).text();
  const asset = /src="([^\"]*\/_next\/static\/[^\"]+\.js)"/.exec(html)?.[1];
  assert.ok(asset, 'Next page references a built script asset');
  assert.equal((await fetch(new URL(asset, base))).status, 200);
  assert.equal(await (await fetch(`${base}/fixture.txt`)).text(), 'standalone public asset');
  await run(['docker', 'compose', 'exec', '-T', 'app', 'node', '-e', 'if(process.getuid()===0)process.exit(1)'], destination);
});

for (const trailingSlash of [false, true]) test(`Next.js static export trailingSlash=${trailingSlash}: portable Nginx release, routes, assets and 404s`, { timeout: 900_000 }, async t => {
  await exerciseNextExport(t, trailingSlash);
});
