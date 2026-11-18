import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { run } from '../../dist/process.js';
import { readConfig } from '../../dist/config.js';
import { composePrefix } from '../../dist/project.js';
import { lockFixture, publishedPort, waitForResponse } from './support.mjs';

for (const framework of ['next', 'nuxt']) test(`${framework}: isolated workspace SSR, shared runtime dependency, worker and source-free portable release`, { timeout: 900_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ship-ws-ssr-'));
  const portable = await mkdtemp(join(tmpdir(), 'ship-ws-ssr-release-'));
  const name = `ship-ws-${framework}-${randomBytes(4).toString('hex')}`;
  const runtime = randomBytes(10).toString('hex'), npmVersion = framework === 'nuxt' ? '11.20.0' : '12.2.2';
  const env = { ...process.env, APP_PORT: '0' }, cli = resolve('dist/cli.js');
  let dev, deployed = false;
  const ship = args => run([process.execPath, cli, ...args], root, { env });
  t.after(async () => {
    if (dev) await run([...dev.prefix, 'down', '--volumes', '--remove-orphans'], root, { capture: true }).catch(() => {});
    if (deployed) await run(['docker', 'compose', 'down', '--volumes', '--remove-orphans'], portable, { capture: true }).catch(() => {});
    for (const tag of ['local', 'workspace']) await run(['docker', 'image', 'rm', `${name}-app:${tag}`], root, { capture: true }).catch(() => {});
    await rm(root, { recursive: true, force: true }); await rm(portable, { recursive: true, force: true });
  });
  const sharedSource = framework === 'next'
    ? "const fs=require('node:fs'),isNumber=require('is-number');exports.readValue=()=>isNumber('42')?JSON.parse(fs.readFileSync(process.cwd()+'/../../packages/shared/dist/value.json','utf8')).value:0;"
    : "import isNumber from 'is-number';export const readValue=()=>isNumber('42')?42:0;";
  const files = {
    'package.json': JSON.stringify({ name: 'workspace-ssr', private: true, packageManager: `npm@${npmVersion}`, workspaces: ['apps/*', 'packages/*'] }),
    'packages/shared/package.json': JSON.stringify({ name: '@fixture/shared', version: '1.0.0', exports: framework === 'next' ? './dist/index.cjs' : './dist/index.mjs', dependencies: { 'is-number': '7.0.0' }, scripts: { build: 'node build.mjs' } }),
    'packages/shared/src/index.cjs': sharedSource,
    'packages/shared/build.mjs': `import{mkdir,copyFile,writeFile}from'node:fs/promises';await mkdir('dist',{recursive:true});await copyFile('src/index.cjs','dist/index.${framework === 'next' ? 'cjs' : 'mjs'}');await writeFile('dist/value.json',JSON.stringify({value:42}));`,
    'packages/unused/package.json': '{"name":"@fixture/unused","version":"1.0.0"}',
    'packages/unused/source.txt': 'unrelated workspace source must not be packaged',
    'apps/web/package.json': JSON.stringify({ name: '@fixture/web', private: true, type: 'module', scripts: { dev: `${framework} dev`, build: `${framework} build` },
      dependencies: { '@fixture/shared': '1.0.0', ...(framework === 'next' ? { next: '16.4.6', react: '19.3.1', 'react-dom': '19.3.1' } : { nuxt: '4.6.4' }) } }),
    'apps/web/public/fixture.txt': 'workspace public asset',
    'apps/web/worker.mjs': `import{writeFileSync}from'node:fs';if(process.cwd()!=='/app/apps/web'||process.env.RUNTIME_ONLY!==${JSON.stringify(runtime)})process.exit(19);writeFileSync('/tmp/worker-ready',process.env.RUNTIME_ONLY);setInterval(()=>{},1000);`,
    'apps/web/probe.mjs': `if(process.cwd()!=='/app/apps/web'||process.env.RUNTIME_ONLY!==${JSON.stringify(runtime)})process.exit(23);console.log('workspace deploy probe OK');`,
    'ship.json': JSON.stringify({ name, publishPorts: true, workspace: { app: 'apps/web', buildDependencies: ['packages/shared'] }, runtimeFiles: ['worker.mjs', 'probe.mjs'], processes: { worker: ['node', 'worker.mjs'] }, deployCommands: [['node', 'probe.mjs']] }),
    '.env.production': `RUNTIME_ONLY=${runtime}\n`,
    ...(framework === 'next' ? {
      'apps/web/next.config.mjs': "import{fileURLToPath}from'node:url';const root=fileURLToPath(new URL('../..',import.meta.url));export default{output:'standalone',outputFileTracingRoot:root,turbopack:{root},outputFileTracingIncludes:{'/*':['../../packages/shared/dist/value.json']},experimental:{cpus:1}};",
      'apps/web/app/layout.jsx': 'export default function Layout({children}){return <html><body>{children}</body></html>}',
      'apps/web/app/page.jsx': "import{readValue}from'@fixture/shared';export const dynamic='force-dynamic';export default function Page(){return <h1>workspace-next-{readValue()}</h1>}",
      'apps/web/app/api/probe/route.js': "import{readValue}from'@fixture/shared';export const dynamic='force-dynamic';export function GET(){return Response.json({shared:readValue(),runtime:process.env.RUNTIME_ONLY,cwd:process.cwd()})}",
    } : {
      'apps/web/nuxt.config.ts': 'export default defineNuxtConfig({devtools:{enabled:false}});',
      'apps/web/app/app.vue': "<script setup>const {data}=await useFetch('/api/probe')</script><template><h1>workspace-nuxt-{{data.shared}}</h1></template>",
      'apps/web/server/api/probe.get.js': "import{readValue}from'@fixture/shared';export default defineEventHandler(()=>({shared:readValue(),runtime:process.env.RUNTIME_ONLY,cwd:process.cwd()}));",
    }),
  };
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), contents);
  }
  try {
    await lockFixture(root, 'npm', npmVersion);
    await ship(['init', '--no-interaction']);
    const cfg = await readConfig(root); dev = await composePrefix(root, cfg, 'development');
    await ship(['up']);
    const devURL = `http://127.0.0.1:${await publishedPort(dev.prefix, root, 3000)}`;
    await waitForResponse(`${devURL}/api/probe`);
    assert.equal((await (await fetch(`${devURL}/api/probe`)).json()).shared, 42);
    for (const path of ['node_modules', 'apps/web/node_modules', 'packages/shared/node_modules', 'packages/unused/node_modules']) assert.deepEqual(await readdir(join(root, path)), []);
    await ship(['down']); await ship(['release', '--tag', 'workspace']);
    const image = `${name}-app:workspace`;
    const inspect = JSON.parse(await run(['docker', 'image', 'inspect', image], root, { capture: true }))[0];
    assert.equal(inspect.Config.WorkingDir, '/app/apps/web'); assert.equal(inspect.Config.User, 'node');
    await run(['docker', 'run', '--rm', image, 'sh', '-c', 'test ! -d /app/packages/unused && test ! -d /app/packages/shared/src && test ! -d /app/apps/web/app && test ! -f /app/apps/web/nuxt.config.ts'], root);
    if (framework === 'nuxt') await run(['docker', 'run', '--rm', image, 'sh', '-c', 'test ! -d /app/node_modules && test ! -d /app/packages/shared'], root);
    await cp(join(root, 'dist/ship/workspace'), portable, { recursive: true });
    for (const path of ['apps', 'packages', 'package.json', 'package-lock.json']) await rm(join(root, path), { recursive: true });
    const release = JSON.parse(await readFile(join(portable, 'release.json'), 'utf8'));
    assert.equal(release.images.length, 1); assert.deepEqual(release.images[0].services, ['app', 'worker']);
    for (const archive of release.images) await run(['docker', 'load', '-i', join(portable, archive.file)], portable);
    assert.match(await run(['sh', 'deploy-commands.sh'], portable, { env, capture: true }), /workspace deploy probe OK/);
    deployed = true;
    await run(['docker', 'compose', 'up', '-d', '--no-build', '--pull', 'never', '--wait'], portable, { env });
    const base = `http://127.0.0.1:${await publishedPort(['docker', 'compose'], portable, 3000)}`;
    await waitForResponse(`${base}/api/probe`);
    assert.deepEqual(await (await fetch(`${base}/api/probe`)).json(), { shared: 42, runtime, cwd: '/app/apps/web' });
    const html = await (await fetch(base)).text();
    assert.match(html, framework === 'next' ? /workspace-next-.*42/ : /workspace-nuxt-42/);
    const asset = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1];
    assert.ok(asset); assert.equal((await fetch(new URL(asset, base))).status, 200);
    assert.equal(await (await fetch(`${base}/fixture.txt`)).text(), 'workspace public asset');
    assert.equal((await run(['docker', 'compose', 'exec', '-T', 'worker', 'cat', '/tmp/worker-ready'], portable, { capture: true })).trim(), runtime);
    const compose = JSON.parse(await readFile(join(portable, 'docker-compose.yml'), 'utf8').then(text => text.slice(text.indexOf('{'))));
    for (const service of Object.values(compose.services)) { assert.equal(service.build, undefined); assert.equal(service.volumes, undefined); }
  } catch (error) {
    if (dev) await run([...dev.prefix, 'logs', '--tail', '50'], root).catch(() => {});
    if (deployed) await run(['docker', 'compose', 'logs', '--tail', '50'], portable).catch(() => {});
    throw error;
  }
});
