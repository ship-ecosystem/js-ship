import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { parseConfig } from '../dist/config.js';
import { buildCompose } from '../dist/compose.js';

const canonical = JSON.parse(await readFile(new URL('../schema/canonical/ship.schema.json', import.meta.url)));
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(canonical);
test('canonical config accepts JS options, HTTP processes, multiple networks and empty arguments', () => {
 const raw = { name: 'api', framework: 'generic', deployment: 'node', packageManager: 'npm', scripts: { dev: 'dev', start: 'start' }, externalNetwork: ['proxy', 'observability'], processes: { realtime: { command: ['node', 'socket.mjs', ''], healthcheck: 'node check.mjs', http: { port: 4000, role: 'websocket', health: '/health', urlSetting: 'SOCKET_URL' } } } };
 assert.equal(validate(raw), true, JSON.stringify(validate.errors));
 const config = parseConfig(raw, '/project');
 const compose = buildCompose(config, '/project', 'production');
 assert.deepEqual(compose.services.realtime.networks, ['ship', 'external', 'external_2']);
 assert.deepEqual(compose.networks.external_2, { external: true, name: 'observability' });
 assert.deepEqual(compose.services.realtime.healthcheck.test, ['CMD-SHELL', 'node check.mjs']);
 assert.deepEqual(compose.services.realtime.expose, ['4000']);
 assert.equal(compose.services.realtime.environment.PORT, '4000');
 assert.equal(buildCompose(config, '/project', 'development').services.realtime, undefined);
});
test('process and network validation refuses malformed definitions', () => {
 for (const raw of [{ externalNetwork: [] }, { externalNetwork: ['proxy', 'proxy'] }, { processes: { worker: { command: [] } } }, { processes: { ws: { command: 'node ws', http: { port: 0, role: 'websocket' } } } }, { processes: { ws: { command: 'node ws', http: { port: 4000, role: 'websocket', urlSetting: 'https://secret' } } } }]) assert.throws(() => parseConfig(raw, '/project'));
});

import { cp, mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { initProject } from '../dist/init.js';
import { assembleRelease } from '../dist/release.js';
import { check } from '../scripts/spec/check-release.mjs';
import { imageInspection } from './helpers/images.mjs';
const releaseSchema = JSON.parse(await readFile(new URL('../schema/canonical/ship-release.schema.json', import.meta.url)));
const validateRelease = new Ajv2020({ strict: false, allErrors: true }).compile(releaseSchema);
async function releaseFixture(t, config = {}) {
 const root = await mkdtemp(join(tmpdir(), 'ship-contract-'));
 t.after(() => rm(root, { recursive: true, force: true }));
 await cp(resolve('examples/node'), root, { recursive: true });
 await writeFile(join(root, 'ship.json'), JSON.stringify(config));
 return { root, config: await initProject(root) };
}
const runner = async args => {
 if (args[1] === 'save') await writeFile(args[3], 'archive');
 return imageInspection(args) ?? '';
};
test('release folders follow the canonical schema, pin registry images and omit secrets on request', async t => {
 const { root, config } = await releaseFixture(t, { services: { database: 'postgres' }, externalNetwork: ['z-proxy', 'a-proxy'], deployCommands: [['node', 'migrate.mjs']], processes: { realtime: { command: ['node', 'socket.mjs'], http: { port: 4000, role: 'websocket', health: '/ready', urlSetting: 'SOCKET_URL' } } } });
 await writeFile(join(root, '.env.production'), 'DB_PASSWORD=unique-credential\nSOCKET_URL=https://example.com\n');
 const output = await assembleRelease(root, config, 'contract', runner, undefined, { noEnv: true });
 const release = JSON.parse(await readFile(join(output, 'release.json')));
 assert.equal(validateRelease(release), true, JSON.stringify(validateRelease.errors));
 assert.deepEqual(check(output), []);
 assert.equal(release.app, `${config.name}-production`);
 assert.equal(release.env.file, null);
 assert.deepEqual(release.env.keys, ['DB_PASSWORD', 'SOCKET_URL']);
 assert.deepEqual(release.env.required, ['DB_PASSWORD']);
 assert.deepEqual(release.requires.networks, ['a-proxy', 'z-proxy']);
 assert.equal(release.images.length, 1);
 assert.equal(release.pulledImages.length, 1);
 assert.match(release.pulledImages[0].ref, /@sha256:[a-f0-9]{64}$/);
 assert.equal(release.services.postgres.image, release.pulledImages[0].ref);
 assert.equal(release.services.realtime.role, 'process');
 assert.equal(release.services.realtime.healthcheck, true);
 assert.deepEqual(release.deploy.needs, ['postgres']);
 assert.equal(release.http.find(h => h.service === 'realtime').urlSetting, 'SOCKET_URL');
 assert.doesNotMatch(JSON.stringify(release), /unique-credential|https:\/\/example/);
 assert.match(await readFile(join(output, 'deploy-commands.sh'), 'utf8'), /run --rm --no-deps -T/);
 if (process.platform !== 'win32') assert.equal((await stat(join(output, 'deploy-commands.sh'))).mode & 0o777, 0o755);
 await assert.rejects(stat(join(output, '.env')), { code: 'ENOENT' });
});
test('mixed platforms and missing registry digests cannot publish a release', async t => {
 const { root, config } = await releaseFixture(t, { services: { database: 'mongodb', cache: 'redis' } });
 await writeFile(join(root, '.env.production'), 'MONGODB_PASSWORD=unique-app\nMONGODB_ROOT_PASSWORD=unique-admin\n');
 for (const [tag, mutate, expected] of [
  ['mixed', (i, ref) => { if (ref.includes('-app:')) i.Architecture = 'arm64'; }, /mixed platforms/],
  ['missing-digest', i => { i.RepoDigests = []; }, /repository digest/],
 ]) {
  await assert.rejects(assembleRelease(root, config, tag, async args => {
   const inspection = imageInspection(args);
   if (inspection) { const items = JSON.parse(inspection); mutate(items[0], args[3]); return JSON.stringify(items); }
   return runner(args);
  }), expected);
  await assert.rejects(stat(join(root, 'dist/ship', tag)), { code: 'ENOENT' });
 }
});
test('explicit force replaces a release only after the replacement is complete', async t => {
 const { root, config } = await releaseFixture(t);
 const first = await assembleRelease(root, config, 'replace', runner);
 const previous = await readFile(join(first, 'release.json'));
 await assert.rejects(assembleRelease(root, config, 'replace', async args => { if (args[1] === 'save') throw new Error('export failed'); return runner(args); }, undefined, { force: true }), /export failed/);
 assert.deepEqual(await readFile(join(first, 'release.json')), previous);
 await assembleRelease(root, config, 'replace', runner, undefined, { force: true });
 assert.deepEqual(check(first), []);
});
import { createRegistry } from '../dist/extensions.js';
import { genericAdapter } from '../dist/adapters.js';
test('adapter capabilities describe real release endpoints, required setting names and console prefixes', async t => {
 const root = await mkdtemp(join(tmpdir(), 'ship-adapter-contract-')); t.after(() => rm(root, { recursive: true, force: true }));
 await cp(resolve('examples/node'), root, { recursive: true });
 const registry = createRegistry([{ apiVersion: 1, name: 'health-adapter', version: '1.0.0', adapters: [{ ...genericAdapter, key: 'health-app', label: 'Health app', describeRelease: () => ({ health: '/ready', urlSetting: 'APP_URL', requiredEnv: ['APP_TOKEN'], console: { migrate: ['node', 'migrate.mjs'] } }) }] }]);
 const config = await initProject(root, { framework: 'health-app' }, registry);
 await assert.rejects(assembleRelease(root, config, 'missing', runner, registry), /APP_TOKEN is required/);
 await writeFile(join(root, '.env.production'), 'APP_TOKEN=private-app-value\n');
 const output = await assembleRelease(root, config, 'health', runner, registry);
 const release = JSON.parse(await readFile(join(output, 'release.json')));
 assert.deepEqual(check(output), []);
 assert.equal(release.http[0].health, '/ready');
 assert.deepEqual(release.env.required, ['APP_TOKEN']);
 assert.deepEqual(release.console.commands.migrate, ['node', 'migrate.mjs']);
 assert.doesNotMatch(JSON.stringify(release), /private-app-value/);
});
