import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig, readConfig } from '../dist/config.js';
import { initProject, projectProblems } from '../dist/init.js';
import { buildCompose } from '../dist/compose.js';
import { loadProject } from '../dist/project.js';
import { adapterFor, detectFramework } from '../dist/adapters.js';
import { renderTemplates } from '../dist/templates.js';
import { manifestManager, scriptCommand, DEFAULT_NPM_VERSION } from '../dist/package-managers.js';
import { assembleRelease } from '../dist/release.js';

async function fixture(t, manifest, manager = 'npm') {
  const root = await mkdtemp(join(tmpdir(), 'ship-js-adapter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
  // These boundary fixtures validate planning, not dependency installation.
  await writeFile(join(root, manager === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml'), manager === 'npm' ? '{"lockfileVersion":3,"packages":{}}' : "lockfileVersion: '9.0'\n");
  return root;
}

test('specific framework detection takes precedence over transitive/base framework dependencies', () => {
  for (const [expected, packages] of [
    ['next', ['react', 'next', 'express']], ['nuxt', ['vue', 'nuxt']], ['sveltekit', ['svelte', '@sveltejs/kit']],
    ['astro', ['react', 'astro']], ['tanstack-start', ['react', '@tanstack/react-start']], ['gatsby', ['react', 'gatsby']],
    ['vitepress', ['vue', 'vitepress']], ['nestjs', ['express', 'fastify', '@nestjs/core']],
  ]) assert.equal(detectFramework({ dependencies: Object.fromEntries(packages.map(key => [key, '1.0.0'])) }), expected);
  assert.equal(detectFramework({}), 'generic');
});

for (const manager of ['npm', 'pnpm']) {
  for (const framework of ['react', 'vue', 'svelte', 'vitepress']) {
    test(`${framework}/${manager}: init chooses static packaging, frozen installs and HMR arguments`, async t => {
      const docs = framework === 'vitepress';
      const manifest = { dependencies: { [framework]: '1.0.0' }, devDependencies: { vite: '7.0.0' },
        ...(manager === 'pnpm' ? { packageManager: 'pnpm@12.21.0' } : {}),
        scripts: docs ? { 'docs:dev': 'vitepress dev docs', 'docs:build': 'vitepress build docs' } : { dev: 'vite', build: 'tsc -b && vite build' } };
      const root = await fixture(t, manifest, manager);
      const cfg = await initProject(root);
      assert.equal(cfg.framework, framework);
      assert.equal(cfg.packageManager, manager);
      assert.equal(cfg.scripts.start, null);
      assert.equal(cfg.outputDirectory, docs ? 'docs/.vitepress/dist' : 'dist');
      const dev = buildCompose(cfg, root, 'development');
      assert.deepEqual(dev.services.app.command.slice(-7), ['--host', '0.0.0.0', '--port', '5173', '--strictPort', '--base', '/']);
      const command = dev.services.app.command;
      assert.equal(command[0], manager);
      assert.equal(command.includes('--'), manager === 'npm');
      assert.equal(command.at(-1), '/');
      const dockerfile = await readFile(join(root, 'ship/Dockerfile'), 'utf8');
      assert.ok(!/@[A-Z_]+@/.test(dockerfile));
      assert.match(dockerfile, /nginx-unprivileged/);
      assert.match(dockerfile, /USER 101:101/);
      assert.match(dockerfile, /npm install --global --engine-strict/);
      assert.match(dockerfile, new RegExp(`COPY package.json ${manager === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml'}`));
      const runtimeStage = dockerfile.split(' AS production\n')[1].split('FROM base AS development')[0];
      assert.ok(!runtimeStage.includes('node_modules'));
      assert.ok(!runtimeStage.includes('COPY --from=builder --chown=node:node /app /app'));
      const nginx = await readFile(join(root, 'ship/nginx.conf'), 'utf8');
      assert.ok(nginx.includes(docs ? '$uri/ =404' : '$uri/ /index.html'));
      assert.match(nginx, /try_files \$uri =404/);
      const prod = buildCompose({ ...cfg, publishPorts: true }, root, 'production');
      assert.equal(prod.services.app.ports[0], '${APP_PORT:-5173}:8080');
      assert.equal(prod.services.app.env_file, undefined);
      assert.equal(prod.services.app.environment, undefined);
      assert.equal((await loadProject(root)).framework, framework);
    });
  }
  for (const [framework, dependency] of [['expressjs', 'express'], ['fastify', 'fastify'], ['nestjs', '@nestjs/core']]) {
    test(`${framework}/${manager}: Node packaging uses the correct production script and prunes build dependencies`, async t => {
      const manifest = { dependencies: { [dependency]: '1.0.0' }, ...(manager === 'pnpm' ? { packageManager: 'pnpm@12.21.0' } : {}),
        scripts: { dev: 'node --watch app.mjs', start: 'node app.mjs', build: 'tsc', 'start:dev': 'nest start --watch', 'start:prod': 'node dist/main.js' } };
      const root = await fixture(t, manifest, manager);
      const cfg = await initProject(root);
      assert.equal(cfg.framework, framework);
      const prod = buildCompose(cfg, root, 'production');
      assert.deepEqual(prod.services.app.command, [manager, 'run', framework === 'nestjs' ? 'start:prod' : 'start']);
      assert.equal(prod.services.app.build.args.SHIP_PACKAGE_MANAGER_VERSION, manager === 'npm' ? DEFAULT_NPM_VERSION : '12.21.0');
      const dockerfile = await readFile(join(root, 'ship/Dockerfile'), 'utf8');
      assert.match(dockerfile, manager === 'npm' ? /'npm' 'prune' '--omit=dev'/ : /'pnpm' 'prune' '--prod'/);
      assert.match(dockerfile, /USER node/);
      assert.ok(!dockerfile.includes('nginx'));
      assert.deepEqual(await projectProblems(cfg, root), []);
    });
  }
}

test('VitePress subpath aligns build flags, output layout and nginx routing', async t => {
  const root = await fixture(t, { dependencies: { vitepress: '1.6.4' }, scripts: { 'docs:dev': 'vitepress dev docs --port 5173', 'docs:build': 'vitepress build docs' } });
  const cfg = await initProject(root);
  const files = await renderTemplates({ ...cfg, basePath: '/handbook/v1/', outputDirectory: 'custom/site' });
  assert.ok(files.Dockerfile.includes("'--base' '/handbook/v1/'"));
  assert.ok(files.Dockerfile.includes('/app/custom/site/ /usr/share/nginx/html/handbook/v1/'));
  assert.ok(files['nginx.conf'].includes('location = /handbook/v1 { return 308 /handbook/v1/; }'));
  assert.ok(files['nginx.conf'].includes('location /handbook/v1/ { try_files $uri $uri.html $uri/ =404; }'));
  assert.ok(!files['nginx.conf'].includes('$uri/ /index.html'));
});

test('frontend containers do not receive database credentials', async t => {
  const root = await fixture(t, { dependencies: { react: '19.0.0', vite: '7.0.0' }, scripts: { dev: 'vite', build: 'vite build' } });
  const cfg = await initProject(root, { database: 'postgres' });
  for (const env of ['development', 'production']) {
    const model = buildCompose(cfg, root, env);
    assert.equal(model.services.app.environment?.DB_PASSWORD, undefined);
    assert.equal(model.services.app.env_file, undefined);
    assert.ok(model.services.postgres.environment.POSTGRES_PASSWORD);
  }
  assert.throws(() => buildCompose({ ...cfg, processes: { worker: ['node', 'worker.js'] } }, root, 'production'), /Static images/);
});

test('template changes require an explicit refresh and preserve custom edits on failure', async t => {
  const root = await fixture(t, { scripts: { dev: 'node app.mjs', start: 'node app.mjs' } });
  const cfg = await initProject(root);
  await writeFile(join(root, 'ship/Dockerfile'), '# custom\n');
  await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.21.0', scripts: { dev: 'node app.mjs', start: 'node app.mjs' } }));
  await rm(join(root, 'package-lock.json'));
  await writeFile(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  await assert.rejects(initProject(root, { packageManager: 'pnpm', packageManagerVersion: '12.21.0' }), /ship init --force/);
  assert.equal(await readFile(join(root, 'ship/Dockerfile'), 'utf8'), '# custom\n');
  assert.equal((await readConfig(root)).packageManager, cfg.packageManager);
  await initProject(root, { packageManager: 'pnpm', packageManagerVersion: '12.21.0', force: true });
  assert.match(await readFile(join(root, 'ship/dev-entrypoint.sh'), 'utf8'), /'pnpm' 'install'.*'--force'/);
  assert.equal((await loadProject(root)).packageManager, 'pnpm');
});

test('manual packaging changes are caught before build/exec instead of using stale templates', async t => {
  const root = await fixture(t, { dependencies: { vue: '3.5.0', vite: '7.0.0' }, scripts: { dev: 'vite', build: 'vite build' } });
  const cfg = await initProject(root);
  await writeFile(join(root, 'ship.json'), JSON.stringify({ ...cfg, outputDirectory: 'output' }));
  await assert.rejects(loadProject(root), /different packaging/);
  await initProject(root, { force: true });
  assert.match(await readFile(join(root, 'ship/Dockerfile'), 'utf8'), /\/app\/output\//);
});

test('Next.js detection selects its output adapter; explicit generic selection remains available', async t => {
  const root = await fixture(t, { dependencies: { react: '19.0.0', next: '16.0.0' }, scripts: { dev: 'next dev', start: 'next start', build: 'next build' } });
  assert.equal((await initProject(root)).framework, 'next');
  assert.equal((await initProject(root, { framework: 'generic', force: true })).framework, 'generic');
});

test('package manager declarations must match config and lockfiles', async t => {
  assert.deepEqual(manifestManager({ packageManager: 'pnpm@12.21.0+sha512.abcd' }), { name: 'pnpm', version: '12.21.0' });
  for (const value of ['pnpm@latest', 'npm@^12', 'npm@01.2.3', 'bun@1.0.0', 'yarn@4.0.0', 12]) assert.throws(() => manifestManager({ packageManager: value }));
  const root = await fixture(t, { packageManager: 'pnpm@12.21.0', scripts: { dev: 'node app.mjs', start: 'node app.mjs' } }, 'pnpm');
  await assert.rejects(initProject(root, { packageManagerVersion: '10.0.0' }), /conflicts/);
  assert.ok(!(await readdir(root)).includes('ship'));
  const cfg = await initProject(root);
  assert.deepEqual(scriptCommand(cfg, 'dev', ['--host', '0.0.0.0']), ['pnpm', 'run', 'dev', '--host', '0.0.0.0']);
});

test('a pnpm lockfile without a version pin requires an explicit version', async t => {
  const root = await fixture(t, { scripts: { dev: 'node app.mjs', start: 'node app.mjs' } }, 'pnpm');
  await assert.rejects(initProject(root), /Pin the pnpm version/);
  assert.equal((await initProject(root, { packageManager: 'pnpm', packageManagerVersion: '12.21.0' })).packageManager, 'pnpm');
});

test('npm manifest pins are respected and workspace files fail before publishing', async t => {
  const root = await fixture(t, { packageManager: 'npm@11.20.0', scripts: { dev: 'node app.mjs', start: 'node app.mjs' } });
  assert.equal((await initProject(root)).packageManagerVersion, '11.20.0');
  const other = await fixture(t, { packageManager: 'pnpm@12.21.0', scripts: { dev: 'node app.mjs', start: 'node app.mjs' } }, 'pnpm');
  await writeFile(join(other, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  await assert.rejects(initProject(other), /Workspace projects/);
  assert.ok(!(await readdir(other)).includes('ship'));
});

test('legacy templates need refresh; custom nginx edits survive ordinary init', async t => {
  const root = await fixture(t, { dependencies: { vue: '3.5.0', vite: '7.0.0' }, scripts: { dev: 'vite', build: 'vite build' } });
  await initProject(root);
  await writeFile(join(root, 'ship/nginx.conf'), '# user routing\n');
  await initProject(root);
  assert.equal(await readFile(join(root, 'ship/nginx.conf'), 'utf8'), '# user routing\n');
  await rm(join(root, 'ship/.ship-template.json'));
  await assert.rejects(loadProject(root), /predate packaging metadata/);
  await assert.rejects(initProject(root), /ship init --force/);
  await initProject(root, { force: true });
  assert.match(await readFile(join(root, 'ship/nginx.conf'), 'utf8'), /listen 8080/);
});

test('static configuration rejects path traversal, server commands and incompatible scripts', () => {
  for (const data of [{ outputDirectory: '../private' }, { outputDirectory: 'dist; rm -rf /' }, { basePath: '//evil/' }, { basePath: '/docs' }, { basePath: '/../' }]) assert.throws(() => parseConfig(data, '/tmp/app'));
  const adapter = adapterFor({ framework: 'react' });
  for (const build of ['vite build --ssr', 'vite build && echo done']) {
    const manifest = { dependencies: { react: '19.0.0', vite: '7.0.0' }, scripts: { dev: 'vite', build } };
    const cfg = parseConfig({ framework: 'react', ...adapter.defaults(manifest) }, '/tmp/app');
    assert.match(adapter.validate(cfg, manifest).join(), /static Vite build/);
  }
});

test('script validation does not mistake Object prototype properties for project scripts', () => {
  const cfg = parseConfig({ scripts: { dev: 'constructor', start: 'start' } }, '/tmp/app');
  assert.match(adapterFor(cfg).validate(cfg, { scripts: { start: 'node app.mjs' } }).join(), /constructor.*missing/);
  const site=parseConfig({framework:'react',scripts:{dev:'constructor',build:'build'}},'/tmp/app');
  assert.match(adapterFor(site).validate(site,{scripts:{build:'vite build'},dependencies:{react:'19.0.0',vite:'7.0.0'}}).join(),/constructor.*missing/);
});

test('static releases export a build-free nginx image with no runtime secrets or source dependency', async t => {
  const root = await fixture(t, { dependencies: { svelte: '5.0.0', vite: '7.0.0' }, scripts: { dev: 'vite', build: 'vite build' } });
  const cfg = await initProject(root);
  await writeFile(join(root, '.env.production'), 'PRIVATE_SERVER_SECRET=example-value\n');
  const destination = await assembleRelease(root, cfg, 'static-v1', async args => {
    if (args[1] === 'save') await writeFile(args[3], 'static-archive-fixture');
    return '';
  });
  const compose = await readFile(join(destination, 'docker-compose.yml'), 'utf8');
  assert.ok(!compose.includes('PRIVATE_SERVER_SECRET'));
  assert.ok(!compose.includes('env_file'));
  assert.ok(!compose.includes(root));
  const manifest = JSON.parse(await readFile(join(destination, 'release.json'), 'utf8'));
  assert.equal(manifest.images.length, 1);
});
