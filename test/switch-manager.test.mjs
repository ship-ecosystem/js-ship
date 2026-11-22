import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { initProject } from '../dist/init.js';
import { switchPackageManager } from '../dist/switch-manager.js';
async function project(t) {
 const root = await mkdtemp(join(tmpdir(), 'ship-switch-')); t.after(() => rm(root, { recursive: true, force: true }));
 await cp(resolve('examples/node'), root, { recursive: true }); await initProject(root); return root;
}
test('switch requires consent, runs tools in the container and records a matching new lockfile', async t => {
 const root = await project(t), calls = [];
 const runner = async args => {
  calls.push(args);
  if (args.includes('pnpm') && args.includes('--no-frozen-lockfile')) await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  return '';
 };
 await assert.rejects(switchPackageManager(root, 'pnpm@12.21.0', runner), /cancelled/);
 assert.equal(calls.length, 0);
 await switchPackageManager(root, 'pnpm@12.21.0', runner, { yes: true });
 assert.equal(JSON.parse(await readFile(join(root, 'package.json'))).packageManager, 'pnpm@12.21.0');
 assert.equal(JSON.parse(await readFile(join(root, 'ship.json'))).packageManager, 'pnpm');
 await assert.rejects(stat(join(root, 'package-lock.json')), { code: 'ENOENT' });
 assert.ok(calls.every(args => args[0] === 'docker' && args[1] === 'compose'));
});
test('failed install restores manifests and lockfiles; custom templates are protected', async t => {
 const root = await project(t), manifest = await readFile(join(root, 'package.json')), lock = await readFile(join(root, 'package-lock.json'));
 await assert.rejects(switchPackageManager(root, 'pnpm@12.21.0', async args => { if (args.includes('--no-frozen-lockfile')) throw new Error('install failed'); return ''; }, { yes: true }), /install failed/);
 assert.deepEqual(await readFile(join(root, 'package.json')), manifest);
 assert.deepEqual(await readFile(join(root, 'package-lock.json')), lock);
 await writeFile(join(root, 'ship/Dockerfile'), '# custom\n');
 let ran = false;
 await assert.rejects(switchPackageManager(root, 'pnpm@12.21.0', async () => { ran = true; return ''; }, { yes: true }), /custom edits/);
 assert.equal(ran, false);
});
