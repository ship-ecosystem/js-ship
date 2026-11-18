import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initProject, projectProblems } from '../dist/init.js';
import { parseConfig } from '../dist/config.js';
import { buildCompose, buildProjectCompose } from '../dist/compose.js';
import { workspacePackages, resolveWorkspace } from '../dist/workspaces.js';
import { templateProblems } from '../dist/templates.js';
import { releaseModel } from '../dist/release.js';

async function fixture(t, manager = 'npm') {
  const root = await mkdtemp(join(tmpdir(), 'ship-workspaces-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, packageManager: ({ npm: 'npm@12.2.2', pnpm: 'pnpm@12.21.0', yarn: 'yarn@4.18.1' })[manager],
    ...(manager !== 'pnpm' ? { workspaces: ['apps/*', 'packages/**', '!packages/excluded/**'] } : {}) }));
  await writeFile(join(root, ({ npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock' })[manager]), '{}');
  if (manager === 'yarn') await writeFile(join(root, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
  if (manager === 'pnpm') await writeFile(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n  - 'packages/**'\n  - '!packages/excluded/**'\nverifyDepsBeforeRun: false\n");
  for (const path of ['apps/api', 'apps/other', 'packages/shared', 'packages/excluded/hidden']) {
    await mkdir(join(root, path), { recursive: true });
    await cp(resolve('examples/node/package.json'), join(root, path, 'package.json'));
  }
  await writeFile(join(root, 'packages/shared/package.json'), '{"name":"@fixture/shared","scripts":{"build":"node build.mjs"}}');
  await writeFile(join(root, 'ship.json'), JSON.stringify({ workspace: { app: 'apps/api', buildDependencies: ['packages/shared'] } }));
  return root;
}
for (const manager of ['npm', 'pnpm', 'yarn']) {
  test(`${manager}: root lockfile and selected app drive detection, ordered builds and isolated dependency volumes`, async t => {
    const root = await fixture(t, manager);
    const cfg = await initProject(root);
    assert.equal(cfg.workspace.app, 'apps/api');
    assert.equal(cfg.packageManager, manager);
    assert.equal(cfg.scripts.start, 'start');
    assert.deepEqual(await workspacePackages(root, manager), ['apps/api', 'apps/other', 'packages/shared']);
    assert.deepEqual(await projectProblems(cfg, root), []);
    assert.throws(() => buildCompose(cfg, root, 'development'), /buildProjectCompose/);
    const dev = await buildProjectCompose(cfg, root, 'development');
    assert.equal(dev.services.app.working_dir, '/app/apps/api');
    assert.equal(dev.services.app.volumes.filter(volume => volume.type === 'volume').length, 4);
    const other = await buildProjectCompose({ ...cfg, serviceNames: { app: 'web' } }, root, 'development');
    assert.deepEqual(dev.volumes, other.volumes);
    const prod = await buildProjectCompose(cfg, root, 'production');
    assert.equal(prod.services.app.volumes, undefined);
    assert.equal(prod.services.app.working_dir, '/app/apps/api');
    assert.doesNotMatch(JSON.stringify(releaseModel(prod)), /node_modules|\/tmp\/ship-workspaces/);
    const dockerfile = await readFile(join(root, 'ship/Dockerfile'), 'utf8');
    assert.match(dockerfile, /FROM base AS dependencies\nCOPY \. \./);
    assert.match(dockerfile, /WORKDIR \/app\/apps\/api/);
    assert.match(dockerfile, /cd '\/app\/packages\/shared'/);
    assert.match(dockerfile, manager === 'yarn' ? /RUN cd \/app && 'yarn' 'workspaces' 'focus' '--all' '--production'/ : /RUN cd \/app && '(npm|pnpm)' 'prune'/);
    assert.match(await readFile(join(root, 'ship/dev-entrypoint.sh'), 'utf8'), /cd '\/app\/apps\/api'/);
    assert.match(await readFile(join(root, '.dockerignore'), 'utf8'), /\*\*\/node_modules/);
    assert.deepEqual(await templateProblems(cfg, root), []);
    await mkdir(join(root, 'apps/new'), { recursive: true });
    await cp(resolve('examples/node/package.json'), join(root, 'apps/new/package.json'));
    assert.match((await templateProblems(cfg, root)).join(), /different packaging settings/);
    await initProject(root, { force: true });
    await writeFile(join(root, 'apps/api/package-lock.json'), '{}');
    await assert.rejects(resolveWorkspace(cfg, root), /conflicts with the root lockfile/);
  });
}
test('workspace selection and build dependencies reject unsafe and ambiguous inputs', () => {
  for (const workspace of [true, {}, { app: '../outside' }, { app: 'apps/api', extra: true },
    { app: 'apps/api', buildDependencies: null }, { app: 'apps/api', buildDependencies: ['apps/api'] },
    { app: 'apps/api', buildDependencies: ['packages/shared', 'packages/shared'] }]) assert.throws(() => parseConfig({ workspace }, '/app'));
});
test('selected packages must be declared, dependency builds must exist and isolated SSR layouts fail explicitly', async t => {
  const root = await fixture(t);
  await assert.rejects(initProject(root, { workspace: 'packages/excluded/hidden' }), /not included/);
  await assert.rejects(initProject(root, { workspace: 'apps/missing' }), /ENOENT/);
  const raw = JSON.parse(await readFile(join(root, 'ship.json'), 'utf8'));
  raw.workspace.buildDependencies = ['apps/other'];
  await writeFile(join(root, 'ship.json'), JSON.stringify(raw));
  await assert.rejects(initProject(root), /needs a build script/);
  raw.workspace.buildDependencies = [];
  raw.framework = 'next'; raw.deployment = 'node';
  await writeFile(join(root, 'ship.json'), JSON.stringify(raw));
  await writeFile(join(root, 'apps/api/package.json'), JSON.stringify({ dependencies: { next: '16.4.6' }, scripts: { dev: 'next dev', build: 'next build' } }));
  await assert.rejects(initProject(root), /separate workspace packaging strategy/);
});
test('workspace directory symlinks cannot escape the repository', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'ship-workspace-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await cp(resolve('examples/node/package.json'), join(outside, 'package.json'));
  await symlink(outside, join(root, 'apps/escape'));
  await assert.rejects(initProject(root, { workspace: 'apps/escape' }), /must stay inside/);
});

test('changing selected apps redetects framework defaults and checksum-qualified package pins stay compatible', async t => {
  const root = await fixture(t);
  const cfg = await initProject(root);
  const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  rootManifest.packageManager = 'npm@12.2.2+sha512.abcd';
  await writeFile(join(root, 'package.json'), JSON.stringify(rootManifest));
  await writeFile(join(root, 'apps/other/package.json'), JSON.stringify({ packageManager: 'npm@12.2.2+sha512.abcd',
    dependencies: { react: '19.3.1' }, devDependencies: { vite: '8.3.8' }, scripts: { dev: 'vite', build: 'vite build' } }));
  const selected = await initProject(root, { workspace: 'apps/other', force: true });
  assert.equal(selected.framework, 'react');
  assert.equal(selected.port, 5173);
  assert.equal(selected.deployment, 'static');
  assert.equal(selected.scripts.start, null);
  assert.equal(cfg.workspace.app, 'apps/api');
});

test('pnpm package-list parsing rejects unsupported YAML/globs before publishing templates', async t => {
  const root = await fixture(t, 'pnpm');
  for (const yaml of ["packages: &packages\n  - apps/*\n", "packages:\n  - 'apps/{api,other}'\n", "packages:\n  - '../outside/*'\n", "packages:\n  - apps/*\npackages:\n  - packages/*\n"]) {
    await writeFile(join(root, 'pnpm-workspace.yaml'), yaml);
    await assert.rejects(initProject(root));
  }
});
