import { imageInspection } from './helpers/images.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../dist/init.js';
import { buildCompose } from '../dist/compose.js';
import { productionProblems } from '../dist/production.js';
import { assembleRelease } from '../dist/release.js';
import { applicationEnvironment } from '../templates/app-entrypoint.mjs';
import { copyExternalExample } from './fixtures/external-services.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ship-external-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await copyExternalExample(root);
  return root;
}
test('external example owns no database resources; application URLs remain application-validated runtime inputs', async t => {
  const root = await fixture(t), cfg = await initProject(root);
  cfg.externalNetwork = 'docs-provider-network';
  for (const mode of ['development', 'production']) {
    const model = buildCompose(cfg, root, mode);
    assert.deepEqual(Object.keys(model.services), ['app']);
    assert.deepEqual(model.services.app.depends_on, {});
    assert.equal(model.networks.external.name, 'docs-provider-network');
    assert.equal(model.services.app.build.network, undefined);
    assert.equal(model.services.app.environment.DATABASE_URL, undefined);
    assert.equal(model.services.app.environment.REDIS_URL, undefined);
    assert.equal(model.services.app.environment.MONGODB_HOST, undefined);
    assert.equal(model.services.app.env_file[0].path, mode === 'development' ? '.env' : '.env.production');
    assert.ok(!Object.keys(model.volumes).some(name => /postgres|redis|mongo/.test(name)));
  }
  const prod = buildCompose(cfg, root, 'production');
  assert.deepEqual(await productionProblems(prod, root), []);
  assert.match((await productionProblems(prod, root, true))[0], /required/);
  await writeFile(join(root, '.env.production'), 'DATABASE_URL=not-a-valid-connection-string\n');
  assert.deepEqual(await productionProblems(prod, root, true), [], 'external URL validation belongs to the application/client');
});
test('provider URIs and TLS/discovery options pass through until a managed MongoDB host key requests URI construction', () => {
  const env = { DATABASE_URL: 'postgresql://app:p%40ss@pg.example.invalid/app?sslmode=verify-full',
    REDIS_URL: 'rediss://app:p%24ss@cache.example.invalid:6379',
    MONGODB_URI: 'mongodb+srv://app:p%40%24ss@cluster.example.invalid/app?retryWrites=true&w=majority',
    ANALYTICS_MONGODB_URI: 'mongodb://a.example.invalid,b.example.invalid/analytics?replicaSet=rs1&tls=true' };
  assert.deepEqual(applicationEnvironment(env), env);
  assert.throws(() => applicationEnvironment({ ...env, MONGODB_HOST: '' }), /incomplete/);
  const local = applicationEnvironment({ ...env, MONGODB_HOST: 'mongodb', MONGODB_DATABASE: 'ship', MONGODB_USER: 'app', MONGODB_PASSWORD: 'local', MONGODB_REPLICA_SET: 'rs0' });
  assert.notEqual(local.MONGODB_URI, env.MONGODB_URI);
  assert.equal(new URL(local.MONGODB_URI).searchParams.get('directConnection'), 'true');
  assert.equal(local.ANALYTICS_MONGODB_URI, env.ANALYTICS_MONGODB_URI);
});
test('static runtime gets no env file, but the release directory still contains the private env export', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '19.3.1', vite: '8.3.8' } }));
  await writeFile(join(root, 'ship.json'), JSON.stringify({ framework: 'react', deployment: 'static', build: { publicEnv: { VITE_API_URL: 'https://api.example.invalid' } } }));
  const cfg = await initProject(root);
  const dev = buildCompose(cfg, root, 'development'), prod = buildCompose(cfg, root, 'production');
  assert.equal(dev.services.app.env_file, undefined);
  assert.equal(dev.services.app.environment.VITE_API_URL, 'https://api.example.invalid');
  assert.equal(prod.services.app.env_file, undefined); assert.equal(prod.services.app.environment, undefined);
  assert.ok(dev.services.app.volumes.some(m => m.type === 'bind' && m.target === '/app'));
  await writeFile(join(root, '.env.production'), 'PRIVATE_RUNTIME_VALUE=only-in-export\n');
  const destination = await assembleRelease(root, cfg, 'static-docs', async args => {
    if (args[0] === 'docker' && args[1] === 'save') await writeFile(args[args.indexOf('-o') + 1], 'unit image stand-in');
    return imageInspection(args) ?? '';
  });
  assert.equal(await readFile(join(destination, '.env'), 'utf8'), 'PRIVATE_RUNTIME_VALUE=only-in-export\n');
  const compose = JSON.parse((await readFile(join(destination, 'docker-compose.yml'), 'utf8')).replace(/^#[^\n]*\n/, ''));
  assert.equal(compose.services.app.env_file, undefined);
});
