import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { run } from '../../dist/process.js';
import { readConfig } from '../../dist/config.js';
import { composePrefix } from '../../dist/project.js';
import { lockFixture, publishedPort, waitForResponse } from '../docker/support.mjs';

export async function exerciseNextExport(t, trailingSlash, verifyBrowser) {
  const root = await mkdtemp(join(tmpdir(), 'ship-next-export-'));
  const name = `ship-export-${randomBytes(5).toString('hex')}`;
  const cli = resolve('dist/cli.js');
  const env = { ...process.env, APP_PORT: '0' };
  const ship = args => run([process.execPath, cli, ...args], root, { env });
  let cfg, destination;
  t.after(async () => {
    if (cfg) { const { prefix } = await composePrefix(root, cfg, 'development'); await run([...prefix, 'down', '--volumes'], root, { env, capture: true }).catch(() => {}); }
    if (destination) await run(['docker', 'compose', 'down', '--volumes'], destination, { env, capture: true }).catch(() => {});
    for (const tag of ['local', 'export']) await run(['docker', 'image', 'rm', `${name}-app:${tag}`], root, { capture: true }).catch(() => {});
    if (destination) await rm(destination, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });
  const write = async (file, text) => { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), text); };
  await write('package.json', JSON.stringify({ name: 'ship-next-export-fixture', private: true, type: 'module', packageManager: 'npm@12.2.2',
    scripts: { dev: 'next dev', build: 'next build' }, dependencies: { next: '16.4.6', react: '19.3.1', 'react-dom': '19.3.1' } }));
  await write('next.config.mjs', `export default {output:'export',trailingSlash:${trailingSlash},experimental:{cpus:1}};`);
  await write('app/layout.jsx', "import Link from 'next/link'; import Counter from './counter.jsx'; import './style.css'; export default function Layout({children}){return <html><body><Counter /><nav><Link href='/'>Home</Link><Link href='/blog/first'>First article</Link><Link href='/blog/second'>Second article</Link></nav>{children}</body></html>;}");
  await write('app/page.jsx', "export default function Home(){return <h1>Ship static home</h1>;}");
  await write('app/counter.jsx', "'use client'; import {useState} from 'react'; export default function Counter(){const[count,setCount]=useState(0);return <button onClick={()=>setCount(count+1)}>Count {count}</button>;}");
  await write('app/style.css', 'body { color: rgb(18, 52, 86); }');
  await write('app/blog/[slug]/page.jsx', "export function generateStaticParams(){return [{slug:'first'},{slug:'second'}];} export const dynamicParams=false; export default async function Article({params}){const {slug}=await params;return <h1>{'Static article: '+slug}</h1>;}");
  await write('app/not-found.jsx', "export default function Missing(){return <h1>Ship static not found</h1>;}");
  await write('public/fixture.txt', 'Next export public asset');
  await lockFixture(root);
  await write('ship.json', JSON.stringify({ name, deployment: 'static', publishPorts: true }));
  await ship(['init', '--no-interaction']); cfg = await readConfig(root);
  assert.equal(cfg.framework, 'next'); assert.equal(cfg.deployment, 'static');
  await write('.env.production', 'PRIVATE_SERVER_SECRET=not-for-static-runtime\n');
  try {
    await ship(['up']);
    const { prefix } = await composePrefix(root, cfg, 'development');
    const devBase = `http://127.0.0.1:${await publishedPort(prefix, root, 3000)}`;
    await waitForResponse(devBase, async response => response.status === 200 && (await response.text()).includes('Ship static home'));
    await ship(['down']);
    await ship(['release', '--tag', 'export']);
    destination = await mkdtemp(join(tmpdir(), 'ship-export-portable-'));
    await cp(join(root, 'dist/ship/export'), destination, { recursive: true });
    for (const file of ['app', 'public', 'next.config.mjs']) await rm(join(root, file), { recursive: true });
    const model = JSON.parse((await readFile(join(destination, 'docker-compose.yml'), 'utf8')).replace(/^#[^\n]*\n/, ''));
    assert.equal(model.services.app.build, undefined);
    assert.equal(model.services.app.volumes, undefined);
    assert.equal(model.services.app.env_file, undefined);
    assert.equal(model.services.app.environment, undefined);
    const manifest = JSON.parse(await readFile(join(destination, 'release.json'), 'utf8'));
    assert.equal(manifest.images.length, 1);
    for (const item of manifest.images) {
      const archive = join(destination, item.file);
      assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), item.sha256);
      await run(['docker', 'load', '-i', archive], destination);
    }
    await run(['docker', 'compose', 'up', '-d', '--wait'], destination, { env });
    const base = `http://127.0.0.1:${await publishedPort(['docker', 'compose'], destination, 8080)}`;
    await waitForResponse(base);
    const html = await (await fetch(base)).text();
    assert.ok(html.includes('Ship static home'));
    for (const slug of ['first', 'second']) for (const suffix of ['', '/']) {
      const response = await fetch(`${base}/blog/${slug}${suffix}`);
      assert.equal(response.status, 200);
      assert.ok((await response.text()).includes(`Static article: ${slug}`));
    }
    const script = /src="([^\"]*\/_next\/static\/[^\"]+\.js)"/.exec(html)?.[1];
    const stylesheet = /href="([^\"]*\/_next\/static\/[^\"]+\.css)"/.exec(html)?.[1];
    for (const asset of [script, stylesheet]) { assert.ok(asset, 'export references its built assets'); assert.equal((await fetch(new URL(asset, base))).status, 200); }
    assert.equal(await (await fetch(`${base}/fixture.txt`)).text(), 'Next export public asset');
    const missing = await fetch(`${base}/missing-page`);
    assert.equal(missing.status, 404); assert.ok((await missing.text()).includes('Ship static not found'));
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
    await run(['docker', 'compose', 'exec', '-T', 'app', 'nginx', '-t'], destination);
    assert.notEqual((await run(['docker', 'compose', 'exec', '-T', 'app', 'id', '-u'], destination, { capture: true })).trim(), '0');
    await assert.rejects(run(['docker', 'compose', 'exec', '-T', 'app', 'node', '--version'], destination, { capture: true }));
    await verifyBrowser?.(base);
  } catch (error) {
    if (destination) await run(['docker', 'compose', 'logs', '--tail', '40'], destination).catch(() => {});
    throw error;
  }
}
