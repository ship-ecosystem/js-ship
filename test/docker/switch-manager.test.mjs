import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { run } from '../../dist/process.js';

test('switch npm to pnpm to Yarn in the running container and rebuild each authoritative lockfile', { timeout: 600_000 }, async t => {
 const root = await mkdtemp(join(tmpdir(), 'ship-js-manager-live-'));
 const name = `ship-js-manager-${randomBytes(5).toString('hex')}`, cli = resolve('dist/cli.js');
 const ship = args => run([process.execPath, cli, ...args], root, { env: { ...process.env, APP_PORT: '0' } });
 t.after(async () => { await ship(['down', '--volumes']).catch(() => {}); await run(['docker', 'image', 'rm', `${name}-app:local`], root).catch(() => {}); await rm(root, { recursive: true, force: true }); });
 await cp(resolve('examples/node'), root, { recursive: true });
 await ship(['init', '--no-interaction', '--name', name]);
 await ship(['up']);
 for (const [manager, version] of [['pnpm', '12.21.0'], ['yarn', '4.18.1']]) {
  await ship(['package-manager', `${manager}@${version}`, '--yes']);
  assert.equal(JSON.parse(await readFile(join(root, 'package.json'))).packageManager, `${manager}@${version}`);
  await ship(['up']);
  const result = await run([process.execPath, cli, manager, '--version'], root, { capture: true });
  assert.equal(result.trim(), version);
 }
});
