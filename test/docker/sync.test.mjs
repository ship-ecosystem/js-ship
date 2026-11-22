import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { run } from '../../dist/process.js';
import { syncIdentity } from '../../dist/sync.js';
import { waitForResponse } from './support.mjs';

test('Mutagen initial sync, frozen install, HTTP reload and teardown', { timeout: 360_000, skip: process.env.SHIP_TEST_MUTAGEN !== '1' }, async t => {
 const root = await mkdtemp(join(tmpdir(), 'ship-js-sync-'));
 const name = `ship-js-sync-${randomBytes(5).toString('hex')}`;
 const cli = resolve('dist/cli.js');
 const env = { ...process.env, SHIP_MUTAGEN: '1', APP_PORT: '0' };
 const ship = args => run([process.execPath, cli, ...args], root, { env });
 t.after(async () => {
  await ship(['down', '--volumes']).catch(() => {});
  await run(['docker', 'image', 'rm', `${name}-app:local`], root).catch(() => {});
  await rm(root, { recursive: true, force: true });
 });
 await cp(resolve('examples/node'), root, { recursive: true });
 await ship(['init', '--no-interaction', '--name', name]);
 await ship(['up']);
 const prefix = ['docker', 'compose', '--project-directory', root, '-f', join(root, 'ship/docker-compose.generated.yml')];
 const output = await run([...prefix, 'port', 'app', '3000'], root, { capture: true });
 const port = Number(output.trim().split(':').at(-1));
 await waitForResponse(`http://127.0.0.1:${port}`);
 const source = join(root, 'server.mjs');
 await writeFile(source, (await readFile(source, 'utf8')).replace('Hello from JavaScript Ship', 'Hello from sync'));
 await waitForResponse(`http://127.0.0.1:${port}`, async response => (await response.text()).includes('Hello from sync'));
 await ship(['down']);
 const sessions = await run(['mutagen', 'sync', 'list', '--label-selector', `io.ship.js.project=${syncIdentity(root)}`, '--template', '{{len .}}'], root, { capture: true });
 assert.equal(sessions.trim(), '0');
});
