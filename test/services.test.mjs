import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builtinServices } from '../dist/services.js';
import { parseConfig } from '../dist/config.js';
import { buildCompose } from '../dist/compose.js';

for (const [key, definition] of builtinServices) test(`${key}: named resources, production lifecycle and HTTP networks`, () => {
 const config = parseConfig({ services: { [definition.group]: key, ...(key === 'bull-board' ? { cache: 'redis' } : {}) }, externalNetwork: ['proxy', 'private-proxy'] }, '/project');
 const dev = buildCompose(config, '/project', 'development');
 const prod = buildCompose(config, '/project', 'production');
 assert.ok(dev.services[key]);
 if (definition.developmentOnly) { assert.equal(prod.services[key], undefined); assert.equal(prod.services.app.environment.PW_TEST_CONNECT_WS_ENDPOINT, undefined); }
 else {
  assert.ok(prod.services[key]);
  if (definition.http) assert.deepEqual(prod.services[key].networks, ['ship', 'external', 'external_2']);
  assert.equal(prod.services[key].ports, undefined);
 }
 if (definition.onDemand) { assert.deepEqual(dev.services[key].profiles, ['ship-testing']); assert.equal(dev.services.app.depends_on[key], undefined); }
 if (definition.volumes?.length && !['rabbitmq'].includes(key)) {
  const named = parseConfig({ additionalServices: [{ group: definition.group, service: key, name: 'analytics' }], serviceNames: { [`${key}-analytics`]: 'renamed' } }, '/project');
  const model = buildCompose(named, '/project', 'production');
  if (definition.developmentOnly) return;
  assert.ok(model.services.renamed);
  assert.ok(!JSON.stringify(model).includes('ship_placeholder'));
  for (const mount of model.services.renamed.volumes ?? []) {
   const volume = typeof mount === 'string' ? mount.split(':')[0] : mount.source;
   assert.ok(Object.hasOwn(model.volumes, volume), `${key}: undeclared ${volume}`);
   assert.ok(volume.includes('analytics'));
   assert.ok(!volume.includes('renamed'));
  }
 }
});
test('Bull Board requires a Redis-compatible backend and follows service renames', () => {
 assert.throws(() => buildCompose(parseConfig({ services: { 'queue-dashboard': 'bull-board' } }, '/project'), '/project', 'development'), /Redis or Valkey/);
 const model = buildCompose(parseConfig({ services: { cache: 'valkey', 'queue-dashboard': 'bull-board' }, serviceNames: { valkey: 'cache' } }, '/project'), '/project', 'production');
 assert.deepEqual(model.services['bull-board'].command, ['--redis', 'redis://cache:6379']);
});
test('browser endpoints follow renamed app hosts and ports without frontend database credentials', () => {
 const config = parseConfig({ framework: 'react', services: { database: 'mysql', testing: 'playwright' }, serviceNames: { app: 'web' }, port: 5173 }, '/project');
 const dev = buildCompose(config, '/project', 'development');
 assert.equal(dev.services.web.environment.PLAYWRIGHT_BASE_URL, 'http://web:5173');
 assert.equal(dev.services.web.environment.DB_PASSWORD, undefined);
});
import { productionWarnings } from '../dist/production.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('SQL Server production edition warnings are instance scoped without exposing product keys', async t => {
 const root = await mkdtemp(join(tmpdir(), 'ship-sql-edition-')); t.after(() => rm(root, { recursive: true, force: true }));
 const config = parseConfig({ services: { database: 'sqlserver' }, additionalServices: [{ group: 'database', service: 'sqlserver', name: 'analytics' }] }, root);
 await writeFile(join(root, '.env.production'), 'MSSQL_PID=Developer\nANALYTICS_MSSQL_PID=private-product-key\n');
 const warnings = await productionWarnings(config, root);
 assert.equal(warnings.length, 1); assert.match(warnings[0], /MSSQL_PID/); assert.doesNotMatch(warnings.join(), /private-product-key/);
});
