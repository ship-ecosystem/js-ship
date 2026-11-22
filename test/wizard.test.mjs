import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runWizard, BACK } from '../dist/wizard.js';
import { interactiveInitOptions } from '../dist/interactive.js';
import { initProject } from '../dist/init.js';
import { cp, mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

test('back navigation preserves earlier answers and recomputes conditional branches', async () => {
 const seen = []; let branches = 0, reviews = 0;
 const result = await runWizard(async ask => {
  const name = await ask({ key: 'name', label: 'name', defaultValue: 'app' });
  const branch = await ask({ key: 'branch', label: 'branch', defaultValue: 'node', choices: ['node', 'static'] });
  const extra = branch === 'node' ? await ask({ key: 'worker', label: 'worker', defaultValue: 'yes' }) : null;
  await ask({ key: 'review', label: 'review', defaultValue: 'yes' });
  return { name, branch, extra };
 }, async q => {
  seen.push(q.key);
  if (q.key === 'branch') return ++branches === 1 ? 'node' : 'static';
  if (q.key === 'review' && reviews++ === 0) return BACK;
  if (q.key === 'worker' && reviews > 0) return BACK;
  return q.defaultValue;
 });
 assert.deepEqual(result, { name: 'app', branch: 'static', extra: null });
 assert.equal(seen.filter(v => v === 'name').length, 1);
});
test('wizard configures service groups, named instances, processes and networks without writing until confirmed', async t => {
 const root = await mkdtemp(join(tmpdir(), 'ship-wizard-')); t.after(() => rm(root, { recursive: true, force: true }));
 await cp(resolve('examples/node'), root, { recursive: true });
 const before = await readdir(root);
 const opts = await interactiveInitOptions(root, {}, async q => ({ serviceGroups: 'database,cache,mail', database: 'mysql', cache: 'redis', mail: 'mailpit', addInstance0: 'yes', instanceGroup0: 'database', instanceService0: 'postgres', instanceName0: 'analytics', externalNetwork: 'proxy,metrics', addProcess0: 'yes', processName0: 'events', processCommand0: 'node events.mjs', processPort0: '4000', processRole0: 'websocket', processHealth0: '/ready', processUrl0: 'EVENTS_URL', confirm: 'yes' })[q.key] ?? q.defaultValue, () => {});
 assert.deepEqual(await readdir(root), before);
 const config = await initProject(root, opts);
 assert.deepEqual(config.services, { database: 'mysql', cache: 'redis', mail: 'mailpit' });
 assert.equal(config.additionalServices[0].name, 'analytics');
 assert.equal(config.processes.events.http.port, 4000);
 assert.deepEqual(config.externalNetwork, ['proxy', 'metrics']);
 const stored = JSON.parse(await readFile(join(root, 'ship.json')));
 assert.ok(stored.externalNetwork);
 const env = await readFile(join(root, '.env'), 'utf8');
 assert.match(env, /DB_ROOT_PASSWORD=/);
 const production = await readFile(join(root, '.env.production.example'), 'utf8');
 assert.match(production, /DB_ROOT_PASSWORD="CHANGE_ME"/);
 await writeFile(join(root, '.env'), env + '\nCUSTOM_SETTING="keep-me"\n');
 await initProject(root);
 assert.match(await readFile(join(root, '.env'), 'utf8'), /CUSTOM_SETTING="keep-me"/);
});
