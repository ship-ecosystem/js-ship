import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { initProject } from '../dist/init.js';
import { buildProjectCompose } from '../dist/compose.js';
import { releaseModel } from '../dist/release.js';
import { templateProblems } from '../dist/templates.js';
import { cleanOutput, prepareOutput } from '../templates/prepare-output.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ship-ws-output-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function put(root, file, data = 'fixture') {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), data);
}
for (const framework of ['next', 'nuxt']) for (const manager of ['npm', 'pnpm', 'yarn']) {
  test(`${framework}/${manager}: workspace runtime keeps the selected app directory and isolated output`, async t => {
    const root = await fixture(t);
    const version = { npm: '12.2.2', pnpm: '12.21.0', yarn: '4.18.1' }[manager];
    await put(root, 'package.json', JSON.stringify({ private: true, packageManager: `${manager}@${version}`,
      ...(manager !== 'pnpm' ? { workspaces: ['apps/*'] } : {}) }));
    await put(root, { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock' }[manager], '{}');
    if (manager === 'pnpm') await put(root, 'pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");
    if (manager === 'yarn') await put(root, '.yarnrc.yml', 'nodeLinker: node-modules\n');
    await put(root, 'apps/web/package.json', JSON.stringify({ dependencies: { [framework]: '1.0.0' }, scripts: { dev: `${framework} dev`, build: `${framework} build` } }));
    await put(root, 'ship.json', JSON.stringify({ workspace: { app: 'apps/web' }, runtimeFiles: ['worker.mjs'], processes: { worker: ['node', 'worker.mjs'] } }));
    const cfg = await initProject(root);
    const prod = await buildProjectCompose(cfg, root, 'production');
    for (const name of ['app', 'worker']) assert.equal(prod.services[name].working_dir, '/app/apps/web');
    assert.deepEqual(prod.services.app.command, ['node', framework === 'next' ? 'server.js' : '.output/server/index.mjs']);
    const runtime = releaseModel(prod);
    assert.equal(runtime.services.app.build, undefined);
    assert.equal(runtime.services.app.volumes, undefined);
    const spec = JSON.parse(await readFile(join(root, 'ship/output.json'), 'utf8'));
    assert.equal(spec.workspaceApp, 'apps/web');
    const dockerfile = await readFile(join(root, 'ship/Dockerfile'), 'utf8');
    assert.match(dockerfile, /COPY --from=builder --chown=node:node \/opt\/ship-runtime \/app/);
    assert.match(dockerfile, /RUN node \/app\/ship\/prepare-output.mjs/);
    assert.deepEqual(await templateProblems(cfg, root), []);
    const marker = JSON.parse(await readFile(join(root, 'ship/.ship-template.json'), 'utf8'));
    delete marker.isolatedWorkspace;
    await put(root, 'ship/.ship-template.json', JSON.stringify(marker));
    assert.match((await templateProblems(cfg, root)).join(), /different packaging settings/);
  });
}

test('Next workspace copies the traced root, shared dependencies, app assets and explicit runtime files', async t => {
  const root = await fixture(t), app = join(root, 'apps/web'), output = join(root, 'runtime');
  const trace = '.next/standalone';
  await put(app, `${trace}/apps/web/server.js`);
  await put(app, `${trace}/node_modules/runtime-dep/index.js`);
  await put(app, `${trace}/packages/shared/data.json`, '{"value":42}');
  await put(app, '.next/static/chunk.js'); await put(app, 'public/asset.txt');
  await put(app, 'worker.mjs'); await put(root, 'unrelated/source.mjs');
  const spec = { framework: 'next', kind: 'node', runtime: 'next', directory: trace, workspaceApp: 'apps/web', runtimeFiles: ['worker.mjs'] };
  await prepareOutput(spec, app, output);
  for (const file of ['apps/web/server.js', 'node_modules/runtime-dep/index.js', 'packages/shared/data.json', 'apps/web/.next/static/chunk.js', 'apps/web/public/asset.txt', 'apps/web/worker.mjs']) assert.ok((await stat(join(output, file))).isFile());
  await assert.rejects(stat(join(output, 'unrelated')));
  await assert.rejects(stat(join(output, 'server.js')));
  await cleanOutput(spec, app);
  await put(app, `${trace}/server.js`);
  await assert.rejects(prepareOutput(spec, app, output), /outputFileTracingRoot/);
});

test('Nuxt workspace copies only its generated bundle and application-relative runtime files', async t => {
  const root = await fixture(t), app = join(root, 'apps/web'), output = join(root, 'runtime');
  await put(app, '.output/server/index.mjs'); await put(app, '.output/public/asset.txt');
  await put(app, 'worker.mjs'); await put(app, 'node_modules/development-only/index.js');
  await prepareOutput({ framework: 'nuxt', kind: 'node', runtime: 'bundle', directory: '.output', entrypoint: '.output/server/index.mjs', workspaceApp: 'apps/web', runtimeFiles: ['worker.mjs'] }, app, output);
  for (const file of ['apps/web/.output/server/index.mjs', 'apps/web/.output/public/asset.txt', 'apps/web/worker.mjs']) assert.ok((await stat(join(output, file))).isFile());
  await assert.rejects(stat(join(output, 'apps/web/node_modules')));
  await assert.rejects(stat(join(output, '.output')));
  await assert.rejects(prepareOutput({ kind: 'node', runtime: 'bundle', directory: '.output', workspaceApp: '../outside' }, app, output), /Invalid output/);
});

test('isolated workspace output accepts internal relative links and rejects dangling or external links', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t), app = join(root, 'apps/web'), output = join(root, 'runtime');
  await put(app, '.output/server/index.mjs'); await put(app, '.output/server/actual.mjs');
  const link = join(app, '.output/server/link.mjs');
  const spec = { framework: 'nuxt', kind: 'node', runtime: 'bundle', directory: '.output', entrypoint: '.output/server/index.mjs', workspaceApp: 'apps/web' };
  await symlink('actual.mjs', link);
  await prepareOutput(spec, app, output);
  assert.equal(await readFile(join(output, 'apps/web/.output/server/link.mjs'), 'utf8'), 'fixture');
  await rm(link); await symlink('missing.mjs', link);
  await assert.rejects(prepareOutput(spec, app, output), /dangling symlink/);
  await put(root, 'outside.mjs'); await rm(link); await symlink(join(root, 'outside.mjs'), link);
  await assert.rejects(prepareOutput(spec, app, output), /absolute symlink/);
  await rm(link); await symlink('../../../../../outside.mjs', link);
  await assert.rejects(prepareOutput(spec, app, output), /escapes its output/);
});
