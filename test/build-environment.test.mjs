import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseConfig } from '../dist/config.js';
import { initProject } from '../dist/init.js';
import { renderTemplates, templateProblems } from '../dist/templates.js';
import { buildCompose } from '../dist/compose.js';
import { productionProblems } from '../dist/production.js';
import { releaseModel, buildProduction } from '../dist/release.js';
import { run } from '../dist/process.js';
import { buildContextProblems, buildSecretProblems } from '../dist/build-environment.js';

const config = build => parseConfig({ build }, '/project');
test('build configuration rejects unsafe names, ambiguous visibility and malformed secrets', () => {
  for (const build of [[], { unknown: true }, { publicEnv: { 'BAD\nRUN id': 'x' } }, { publicEnv: { PATH: 'x' } }, ...['HOST', 'HOSTNAME', 'PORT', 'NG_ALLOWED_HOSTS'].map(key => ({ publicEnv: { [key]: 'x' } })),
    { publicEnv: { NODE_OPTIONS: 'x' } }, { publicEnv: { VITE_X: 1 } }, { publicEnv: { VITE_X: '\0' } },
    { secrets: ['CMS_TOKEN', 'CMS_TOKEN'] }, { secrets: ['../token'] }, { secrets: ['NPM_CONFIG_USERCONFIG'] }, { secrets: ['VITE_TOKEN'] },
    { publicEnv: { CMS_TOKEN: 'public' }, secrets: ['CMS_TOKEN'] }, { npmrc: 'yes' }]) assert.throws(() => config(build));
});
test('public literals survive Compose escaping and build secrets have no production runtime grants', async () => {
  const cfg = config({ publicEnv: { VITE_URL: 'https://example.com/$literal?x=${NOPE}' }, secrets: ['CMS_TOKEN'], npmrc: true });
  const prod = buildCompose(cfg, '/project', 'production');
  const dev = buildCompose(cfg, '/project', 'development');
  assert.equal(prod.services.app.build.args.VITE_URL, 'https://example.com/$$literal?x=$${NOPE}');
  assert.equal(prod.services.app.environment.VITE_URL, undefined);
  assert.equal(prod.services.app.secrets, undefined);
  assert.equal(dev.services.app.environment.VITE_URL, prod.services.app.build.args.VITE_URL);
  assert.deepEqual(dev.services.app.secrets, [{ source: 'ship_npmrc', target: 'ship_npmrc' }]);
  assert.equal(dev.secrets.ship_build_CMS_TOKEN, undefined);
  const released = releaseModel(prod);
  assert.equal(released.secrets, undefined);
  assert.doesNotMatch(JSON.stringify(released), /ship_npmrc|ship_build_|\/project|VITE_URL/);
  const templates = await renderTemplates(cfg);
  const pnpmTemplates = await renderTemplates({ ...cfg, packageManager: 'pnpm', packageManagerVersion: '12.21.0' });
  assert.match(pnpmTemplates.Dockerfile, /ENV PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false/);
  assert.match(templates.Dockerfile, /RUN --mount=type=secret,id=ship_npmrc,required=true NPM_CONFIG_USERCONFIG=/);
  assert.match(templates.Dockerfile, /RUN --mount=type=secret,id=ship_build_CMS_TOKEN,env=CMS_TOKEN,required=true/);
  assert.doesNotMatch(templates.Dockerfile.split('FROM base AS production')[1], /ARG VITE_URL|ship_build_CMS_TOKEN|ship_npmrc/);
});
test('context protections and required secret checks fail before Docker; public value changes need no template refresh', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ship-build-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(resolve('examples/node'), root, { recursive: true });
  await writeFile(join(root, 'ship.json'), JSON.stringify({ build: { publicEnv: { PUBLIC_URL: 'one' }, secrets: ['CMS_TOKEN'], npmrc: true } }));
  const cfg = await initProject(root);
  assert.deepEqual(await buildContextProblems(root), []);
  assert.match(await readFile(join(root, '.gitignore'), 'utf8'), /\.ship-secrets\//);
  assert.equal((await buildSecretProblems(cfg, root)).length, 2);
  await assert.rejects(run([process.execPath, resolve('dist/cli.js'), '--project-directory', root, 'config:test'], root, { capture: true }), /Required secret file/);
  await assert.rejects(buildProduction(root, cfg, async () => { throw new Error('Docker must not run'); }), /Required secret file/);
  await mkdir(join(root, '.ship-secrets'));
  await writeFile(join(root, '.ship-secrets/npmrc'), 'registry=https://registry.npmjs.org/');
  assert.deepEqual(await buildSecretProblems(cfg, root, true), []);
  await writeFile(join(root, '.ship-secrets/CMS_TOKEN'), 'not-a-real-token');
  assert.deepEqual(await buildSecretProblems(cfg, root), []);
  const calls = [];
  await buildProduction(root, cfg, async argv => { calls.push(argv); return ''; }, 'local', { noCache: true });
  assert.ok(calls[0].includes('--no-cache'));
  assert.deepEqual(await templateProblems({ ...cfg, build: { ...cfg.build, publicEnv: { PUBLIC_URL: 'two' } } }, root), []);
  assert.equal((await templateProblems({ ...cfg, build: { ...cfg.build, publicEnv: { OTHER_URL: 'two' } } }, root)).length, 1);
  await writeFile(join(root, '.dockerignore'), `${await readFile(join(root, '.dockerignore'), 'utf8')}\n!.ship-secrets/npmrc\n`);
  assert.equal((await buildContextProblems(root)).length, 1);
  await initProject(root);
  assert.deepEqual(await buildContextProblems(root), []);
  await writeFile(join(root, 'ship/Dockerfile.dockerignore'), 'node_modules\n');
  assert.match((await buildContextProblems(root)).join(), /overrides the protected/);
});

test('escaped public expressions are literal and do not become production credential requirements', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ship-literal-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cfg = config({ publicEnv: { PUBLIC_VALUE: '${LITERAL:?do not interpolate}' } });
  const model = buildCompose(cfg, root, 'production');
  assert.deepEqual(await productionProblems(model, root), []);
  model.services.app.environment.REQUIRED = '$$${ACTUAL_SECRET:?required}';
  assert.match((await productionProblems(model, root)).join(), /required/);
  await writeFile(join(root, '.env.production'), 'ACTUAL_SECRET=production-value\n');
  assert.deepEqual(await productionProblems(model, root), []);
});
