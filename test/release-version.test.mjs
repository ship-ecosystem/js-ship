import { imageInspection } from './helpers/images.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { run } from '../dist/process.js';

test('a staged npm version drives CLI, help and application-release provenance without source edits', { skip: process.env.SHIP_RESTRICTED_TEST === '1' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ship-candidate-version-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sdk = join(root, 'sdk'), app = join(root, 'app'), version = '0.1.2';
  await mkdir(sdk);
  await cp(resolve('dist'), join(sdk, 'dist'), { recursive: true });
  await cp(resolve('templates'), join(sdk, 'templates'), { recursive: true });
  const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  // Only an isolated private staging directory changes version. No publish occurs.
  await writeFile(join(sdk, 'package.json'), JSON.stringify({ ...pkg, version, private: true }));
  const cli = join(sdk, 'dist/cli.js');
  assert.equal((await run([process.execPath, cli, '--version'], root, { capture: true })).trim(), version);
  assert.ok((await run([process.execPath, cli, '--help'], root, { capture: true })).includes(version));
  await cp(resolve('examples/node'), app, { recursive: true });
  const { initProject } = await import(pathToFileURL(join(sdk, 'dist/init.js')).href);
  const { assembleRelease } = await import(pathToFileURL(join(sdk, 'dist/release.js')).href);
  const cfg = await initProject(app);
  await writeFile(join(app, '.env.production'), '');
  const destination = await assembleRelease(app, cfg, 'candidate', async args => {
    if (args[1] === 'save') await writeFile(args[3], 'mocked-image-export');
    return imageInspection(args) ?? '';
  });
  assert.deepEqual(JSON.parse(await readFile(join(destination, 'release.json'), 'utf8')).builder, { package: pkg.name, version });
});
