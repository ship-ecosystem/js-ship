import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IMAGES, NODE_MINIMUMS } from '../../dist/images.js';
import { initProject } from '../../dist/init.js';
import { run } from '../../dist/process.js';

test('catalog Node images meet the policy and an old overridden base fails before installing dependencies', { timeout: 600_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ship-runtime-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(resolve('examples/node'), root, { recursive: true });
  await initProject(root);
  for (const [major, minimum] of Object.entries(NODE_MINIMUMS)) {
    const image = IMAGES[`node${major}`];
    const version = await run(['docker', 'run', '--rm', '--entrypoint', 'node', image, '--version'], root, { capture: true });
    assert.equal(version.trim(), `v${minimum}`);
    await run(['docker', 'run', '--rm', '--mount', `type=bind,source=${join(root, 'ship')},target=/run/ship,readonly`,
      '--entrypoint', 'node', image, '/run/ship/check-runtime.mjs'], root);
  }
  await assert.rejects(run(['docker', 'build', '--target', 'base', '--build-arg', 'NODE_IMAGE=node:22.23.3-bookworm-slim',
    '-f', 'ship/Dockerfile', '.'], root, { capture: true }), error => {
    assert.match(error.stderr + error.stdout, /Node 22\.23\.3 does not meet Ship's runtime policy/);
    assert.doesNotMatch(error.stderr + error.stdout, /npm install --global.*DONE/);
    return true;
  });
});
