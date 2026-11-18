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

for (const manager of ['npm', 'pnpm', 'yarn']) {
  test(`${manager}: workspace builds retain shared production dependencies and boot a source-free release`, { timeout: 600_000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'ship-ws-docker-'));
    const portable = await mkdtemp(join(tmpdir(), 'ship-ws-portable-'));
    const name = `ship-ws-${randomBytes(5).toString('hex')}`;
    const env = { ...process.env, APP_PORT: '0' }, runtime = randomBytes(8).toString('hex');
    const cli = resolve('dist/cli.js');
    const ship = (args, options = {}) => run([process.execPath, cli, ...args], root, { env, ...options });
    let dev;
    t.after(async () => {
      if (dev) await run([...dev.prefix, 'down', '--volumes', '--remove-orphans'], root, { capture: true }).catch(() => {});
      await run(['docker', 'compose', 'down', '--volumes', '--remove-orphans'], portable, { capture: true }).catch(() => {});
      for (const tag of ['local', 'workspace-test']) await run(['docker', 'image', 'rm', `${name}-app:${tag}`], root, { capture: true }).catch(() => {});
      await rm(root, { recursive: true, force: true });
      await rm(portable, { recursive: true, force: true });
    });
    const files = {
      'package.json': JSON.stringify({ name: 'workspace-root', private: true, packageManager: ({ npm: 'npm@12.2.2', pnpm: 'pnpm@12.21.0', yarn: 'yarn@4.18.1' })[manager],
        ...(manager !== 'pnpm' ? { workspaces: ['apps/*', 'packages/*'] } : {}), devDependencies: { typescript: '5.9.3' } }),
      ...(manager === 'yarn' ? { '.yarnrc.yml': 'nodeLinker: node-modules\n' } : {}),
      ...(manager === 'pnpm' ? { 'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'packages/*'\n" } : {}),
      'apps/api/package.json': JSON.stringify({ name: '@fixture/api', version: '1.0.0', type: 'module',
        dependencies: { '@fixture/shared': manager === 'npm' ? '1.0.0' : 'workspace:*' },
        scripts: { dev: 'node --watch server.mjs', build: 'node build.mjs', start: 'node dist/server.mjs' } }),
      'apps/api/server.mjs': `import { createServer } from 'node:http'; import { value } from '@fixture/shared';
createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({shared:value,runtime:process.env.RUNTIME_ONLY,cwd:process.cwd()}))}).listen(Number(process.env.PORT), '0.0.0.0');`,
      'apps/api/build.mjs': `import assert from 'node:assert/strict'; import { value } from '@fixture/shared'; import { createRequire } from 'node:module'; import { mkdir,copyFile } from 'node:fs/promises';
assert.equal(value,42); createRequire(import.meta.url).resolve('typescript'); await mkdir('dist',{recursive:true}); await copyFile('server.mjs','dist/server.mjs');`,
      'packages/shared/package.json': JSON.stringify({ name: '@fixture/shared', version: '1.0.0', type: 'module', exports: './dist/index.js',
        dependencies: { 'is-number': '7.0.0' }, ...(manager === 'yarn' ? { devDependencies: { typescript: '5.9.3' } } : {}), scripts: { build: 'tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --outDir dist src/index.ts --skipLibCheck' } }),
      'packages/shared/src/index.ts': "import isNumber from 'is-number'; export const value = isNumber('41') ? 42 : 0;",
      'ship.json': JSON.stringify({ name, publishPorts: true, workspace: { app: 'apps/api', buildDependencies: ['packages/shared'] } }),
      '.env.production': `RUNTIME_ONLY=${runtime}\n`,
    };
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
    await lockFixture(root, manager);
    await ship(['init', '--no-interaction']);
    const cfg = await readConfig(root);
    dev = await composePrefix(root, cfg, 'development');
    try { await ship(['up']); } catch (error) { await run([...dev.prefix, 'logs', '--tail', '60'], root).catch(() => {}); throw error; }
    const devURL = `http://127.0.0.1:${await publishedPort(dev.prefix, root, 3000)}`;
    await waitForResponse(devURL);
    assert.equal((await (await fetch(devURL)).json()).shared, 42);
    const version = await ship([manager, '--version'], { capture: true });
    assert.match(version, manager === 'npm' ? /12\.2\.2/ : manager === 'pnpm' ? /12\.21\.0/ : /4\.18\.1/);
    for (const path of ['node_modules', 'apps/api/node_modules', 'packages/shared/node_modules']) assert.deepEqual(await readdir(join(root, path)), [], 'container installs must not populate host node_modules');
    await ship(['down']);
    await ship(['release', '--tag', 'workspace-test']);
    const image = `${name}-app:workspace-test`;
    const inspect = JSON.parse(await run(['docker', 'image', 'inspect', image], root, { capture: true }))[0];
    assert.equal(inspect.Config.WorkingDir, '/app/apps/api');
    assert.equal(inspect.Config.User, 'node');
    const devTools = await run(['docker', 'run', '--rm', image, 'sh', '-c', 'find /app -path "*/node_modules/typescript/package.json" -print'], root, { capture: true });
    assert.equal(devTools.trim(), '', 'development dependencies must be absent, including virtual-store copies');
    await cp(join(root, 'dist/ship/workspace-test'), portable, { recursive: true });
    await rm(join(root, 'apps'), { recursive: true });
    await rm(join(root, 'packages'), { recursive: true });
    await rm(join(root, 'package.json'));
    await run(['docker', 'compose', 'up', '-d', '--no-build', '--pull', 'never', '--wait'], portable, { env });
    const port = await publishedPort(['docker', 'compose'], portable, 3000);
    const url = `http://127.0.0.1:${port}`;
    await waitForResponse(url);
    assert.deepEqual(await (await fetch(url)).json(), { shared: 42, runtime, cwd: '/app/apps/api' });
    assert.doesNotMatch(await readFile(join(portable, 'docker-compose.yml'), 'utf8'), /build|context|node_modules/);
  });
}

for (const manager of ['npm', 'yarn']) test(`${manager}: React/Vite workspace builds shared packages and exports only static app output`, { timeout: 600_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ship-ws-vite-'));
  const name = `ship-ws-vite-${randomBytes(4).toString('hex')}`;
  const env = { ...process.env, APP_PORT: '0' }, cli = resolve('dist/cli.js');
  const ship = args => run([process.execPath, cli, ...args], root, { env });
  let dev, prod;
  t.after(async () => {
    for (const stack of [prod, dev].filter(Boolean)) await run([...stack.prefix, 'down', '--volumes', '--remove-orphans'], root, { capture: true }).catch(() => {});
    await run(['docker', 'image', 'rm', `${name}-app:local`], root, { capture: true }).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  const files = {
    'package.json': JSON.stringify({ name: 'vite-workspace', private: true, workspaces: ['apps/*', 'packages/*'], packageManager: manager === 'yarn' ? 'yarn@4.18.1' : 'npm@12.2.2' }),
    'apps/web/package.json': JSON.stringify({ name: '@fixture/web', private: true, type: 'module',
      dependencies: { react: '19.3.1', 'react-dom': '19.3.1', '@fixture/ui': manager === 'yarn' ? 'workspace:*' : '1.0.0' }, devDependencies: { vite: '8.3.8' },
      scripts: { dev: 'vite', build: 'vite build' } }),
    'apps/web/index.html': '<!doctype html><div id="app"></div><script type="module" src="/main.js"></script>',
    'apps/web/main.js': "import React from 'react';import{createRoot}from'react-dom/client';import{label}from'@fixture/ui';createRoot(document.getElementById('app')).render(React.createElement('h1',null,label));",
    'packages/ui/package.json': JSON.stringify({ name: '@fixture/ui', version: '1.0.0', type: 'module', exports: './dist/label.js', scripts: { build: 'node build.mjs' } }),
    'packages/ui/build.mjs': "import{mkdir,writeFile}from'node:fs/promises';await mkdir('dist',{recursive:true});await writeFile('dist/label.js',`export const label = 'workspace-shared-ui';`);",
    'ship.json': JSON.stringify({ name, publishPorts: true, basePath: '/docs/', workspace: { app: 'apps/web', buildDependencies: ['packages/ui'] } }),
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content);
  }
  if (manager === 'yarn') await writeFile(join(root, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
  await lockFixture(root, manager);
  await ship(['init', '--no-interaction']);
  const cfg = await readConfig(root);
  assert.equal(cfg.framework, 'react');
  dev = await composePrefix(root, cfg, 'development');
  await ship(['up']);
  const devURL = `http://127.0.0.1:${await publishedPort(dev.prefix, root, 5173)}/docs/`;
  assert.match(await (await fetch(devURL)).text(), /@vite\/client/);
  assert.equal((await fetch(new URL('main.js', devURL))).status, 200);
  await ship(['down']);
  await ship(['build']);
  await rm(join(root, 'apps/web/main.js'));
  await rm(join(root, 'packages/ui/dist'), { recursive: true });
  prod = await composePrefix(root, cfg, 'production');
  await run([...prod.prefix, 'up', '-d', '--no-build', '--pull', 'never', '--wait'], root, { env });
  const url = `http://127.0.0.1:${await publishedPort(prod.prefix, root, 8080)}/docs/`;
  await waitForResponse(url);
  const html = await (await fetch(url)).text();
  const asset = /src="([^"]+\.js)"/.exec(html)?.[1];
  assert.ok(asset);
  assert.match(await (await fetch(new URL(asset, url))).text(), /workspace-shared-ui/);
  const noNode = await run(['docker', 'run', '--rm', `${name}-app:local`, 'sh', '-c', 'test ! -d /app && ! command -v node'], root, { capture: true });
  assert.equal(noNode, '');
});
