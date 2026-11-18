import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseConfig } from '../dist/config.js';
import { initProject, projectProblems } from '../dist/init.js';
import { detectPackageManager, manifestManager, scriptCommand } from '../dist/package-managers.js';
import { interactiveInitOptions } from '../dist/interactive.js';
import { buildCompose } from '../dist/compose.js';

async function fixture(t, declared = true) {
  const root = await mkdtemp(join(tmpdir(), 'ship-yarn-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'yarn-app', private: true,
    ...(declared ? { packageManager: 'yarn@4.18.1' } : {}), scripts: { dev: 'node app.mjs', start: 'node app.mjs' } }));
  await writeFile(join(root, 'yarn.lock'), '__metadata:\n  version: 8\n');
  await writeFile(join(root, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
  return root;
}

test('Yarn pins and explicit selection preserve one lockfile authority before writes', async t => {
  assert.deepEqual(manifestManager({ packageManager: 'yarn@4.18.1+sha512.abcd' }), { name: 'yarn', version: '4.18.1' });
  for (const value of ['yarn@1.22.22', 'yarn@2.4.3', 'yarn@3.8.7', 'yarn@5.0.0', 'yarn@latest', 'yarn@4.18.1\n']) assert.throws(() => manifestManager({ packageManager: value }));
  const root = await fixture(t, false);
  await assert.rejects(initProject(root), /Pin the Yarn version/);
  assert.equal((await readdir(root)).includes('ship'), false);
  const cfg = await initProject(root, { packageManager: 'yarn', packageManagerVersion: '4.18.1' });
  assert.equal(cfg.packageManager, 'yarn');
  await writeFile(join(root, 'package-lock.json'), '{}');
  await assert.rejects(detectPackageManager(root, {}), /Conflicting/);
  assert.match((await projectProblems(cfg, root)).join(), /conflicts/);
  await rm(join(root, 'package-lock.json'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: 'yarn@4.0.0', scripts: { dev: 'node app.mjs', start: 'node app.mjs' } }));
  await assert.rejects(initProject(root), /conflicts/);
});

test('Yarn requires explicit node_modules and rejects incompatible credential and PnP workflows', async t => {
  for (const version of ['1.22.22', '3.8.7', '5.0.0']) assert.throws(() => parseConfig({ packageManager: 'yarn', packageManagerVersion: version }, '/app'), /Yarn 4/);
  assert.throws(() => parseConfig({ packageManager: 'yarn', packageManagerVersion: '4.18.1', build: { npmrc: true } }, '/app'), /npm\/pnpm only/);
  const root = await fixture(t);
  for (const rc of ['', 'nodeLinker: pnp\n', 'other:\n  nodeLinker: node-modules\n']) {
    await writeFile(join(root, '.yarnrc.yml'), rc);
    await assert.rejects(initProject(root), /top-level nodeLinker/);
    assert.equal((await readdir(root)).includes('ship'), false);
  }
  await writeFile(join(root, '.yarnrc.yml'), '\ufeffnodeLinker: "node-modules" # explicit\n');
  for (const file of ['.pnp.cjs', '.pnp.loader.mjs', '.yarnrc']) {
    await writeFile(join(root, file), '');
    await assert.rejects(initProject(root), /unsupported Classic/);
    await rm(join(root, file));
  }
  await initProject(root);
});

test('Yarn interactive and flagged initialization agree, including framework script arguments', async t => {
  const root = await fixture(t), questions = [];
  const options = await interactiveInitOptions(root, {}, async question => {
    questions.push(question);
    return question.key === 'confirm' ? 'yes' : '';
  }, () => {});
  assert.equal(questions.find(q => q.key === 'packageManager').defaultValue, 'yarn');
  assert.ok(questions.find(q => q.key === 'packageManager').choices.includes('yarn'));
  const cfg = await initProject(root, options);
  assert.equal(cfg.packageManagerVersion, '4.18.1');
  assert.deepEqual(scriptCommand(cfg, 'dev', ['--port', '5173', 'space value']), ['yarn', 'run', 'dev', '--port', '5173', 'space value']);
  assert.equal(buildCompose(cfg, root, 'development').services.app.command[0], 'yarn');
  const dockerfile = await readFile(join(root, 'ship/Dockerfile'), 'utf8');
  assert.match(dockerfile, /@yarnpkg\/cli-dist@\$SHIP_PACKAGE_MANAGER_VERSION/);
  assert.doesNotMatch(dockerfile, /"yarn@\$SHIP_PACKAGE_MANAGER_VERSION"/);
});
