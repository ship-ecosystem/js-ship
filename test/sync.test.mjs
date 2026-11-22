import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCompose } from '../dist/compose.js';
import { parseConfig } from '../dist/config.js';
import { mutagenEnabled, requireMutagen, startSync, stopSync, syncIdentity } from '../dist/sync.js';
test('Mutagen is opt-in, development-only, shares source with browser runners and isolates dependencies', () => {
 assert.equal(mutagenEnabled({ SHIP_MUTAGEN: 'TRUE' }), true);
 assert.equal(mutagenEnabled({ SHIP_MUTAGEN: '0' }), false);
 const old = process.env.SHIP_MUTAGEN; process.env.SHIP_MUTAGEN = '1';
 try {
  const cfg = parseConfig({ services: { testing: 'cypress' } }, '/project');
  const dev = buildCompose(cfg, '/project', 'development');
  assert.deepEqual(dev.services.app.volumes[0], { type: 'volume', source: 'ship_source', target: '/app' });
  assert.equal(dev.services.cypress.volumes[0].source, 'ship_source');
  assert.equal(dev.services.app.environment.SHIP_WAIT_FOR_SYNC, '1');
  const prod = buildCompose(cfg, '/project', 'production');
  assert.equal(prod.volumes.ship_source, undefined);
  assert.equal(prod.services.app.environment.SHIP_WAIT_FOR_SYNC, undefined);
 } finally { if (old === undefined) delete process.env.SHIP_MUTAGEN; else process.env.SHIP_MUTAGEN = old; }
});
test('sync flush finishes before dependency gate opens; stop only targets this project', async () => {
 const calls = [], container = 'a'.repeat(64);
 const runner = async args => { calls.push(args); return args.includes('ps') ? container : ''; };
 await startSync(['docker', 'compose'], '/project', 'web', runner);
 const flush = calls.findIndex(args => args.includes('flush'));
 const ready = calls.findIndex(args => args.includes('/tmp/ship-sync-ready'));
 assert.ok(flush < ready);
 assert.ok(calls.some(args => args.includes(`docker://node@${container}/app`)));
 assert.ok(calls.some(args => args.includes('.env.production')));
 await stopSync('/project', runner);
 assert.equal(calls.at(-1).at(-1), `io.ship.js.project=${syncIdentity('/project')}`);
 await assert.rejects(requireMutagen('/project', async () => { throw new Error('not found'); }), /Install Mutagen/);
});
