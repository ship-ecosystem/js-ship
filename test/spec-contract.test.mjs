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
 assert.equal(buildCompose(config, '/project', 'development').services.realtime, undefined);
});
test('process and network validation refuses malformed definitions', () => {
 for (const raw of [{ externalNetwork: [] }, { externalNetwork: ['proxy', 'proxy'] }, { processes: { worker: { command: [] } } }, { processes: { ws: { command: 'node ws', http: { port: 0, role: 'websocket' } } } }, { processes: { ws: { command: 'node ws', http: { port: 4000, role: 'websocket', urlSetting: 'https://secret' } } } }]) assert.throws(() => parseConfig(raw, '/project'));
});
