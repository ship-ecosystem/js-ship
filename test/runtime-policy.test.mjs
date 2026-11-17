import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { IMAGES, NODE_MINIMUMS } from '../dist/images.js';
import { nodeRuntimeProblem } from '../dist/runtime-version.js';
import { parseConfig } from '../dist/config.js';
import { buildCompose } from '../dist/compose.js';
import { renderTemplates, templateSettings } from '../dist/templates.js';

test('runtime floor rejects old, unsupported and prerelease Node versions; accepts patched minors', () => {
  for (const [major, minimum] of Object.entries(NODE_MINIMUMS)) {
    const parts = minimum.split('.').map(Number);
    assert.equal(nodeRuntimeProblem(minimum, NODE_MINIMUMS), null);
    assert.equal(nodeRuntimeProblem(`v${minimum}`, NODE_MINIMUMS), null);
    assert.ok(nodeRuntimeProblem(`${major}.${parts[1]}.${parts[2] - 1}`, NODE_MINIMUMS));
    assert.ok(nodeRuntimeProblem(`${major}.0.0`, NODE_MINIMUMS));
    assert.equal(nodeRuntimeProblem(`${major}.${parts[1] + 1}.0`, NODE_MINIMUMS), null);
  }
  for (const version of ['20.19.0', '23.0.0', '27.0.0', '24', '24.22.3-rc.1', '24.22.3\n', 'garbage']) assert.ok(nodeRuntimeProblem(version, NODE_MINIMUMS));
});
test('catalog drives package engines, Docker selections and generated guard policy', async () => {
  const catalog = JSON.parse(await readFile('images/compose.yaml', 'utf8'));
  for (const [key, image] of Object.entries(IMAGES)) {
    assert.match(image, /@sha256:[a-f0-9]{64}$/);
    assert.equal(image, catalog.services[key].image);
  }
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.engines.node, Object.values(NODE_MINIMUMS).map(value => `^${value}`).join(' || '));
  for (const major of Object.keys(NODE_MINIMUMS)) {
    const config = parseConfig({ node: major, services: { database: 'postgres', cache: 'redis' } }, '/app');
    const model = buildCompose(config, '/app', 'production');
    assert.equal(model.services.app.build.args.NODE_IMAGE, IMAGES[`node${major}`]);
    assert.equal(model.services.postgres.image, IMAGES.postgres);
    assert.equal(model.services.redis.image, IMAGES.redis);
  }
  const cfg = parseConfig({ services: { database: 'mongodb' } }, '/app');
  const files = await renderTemplates(cfg);
  assert.match(files.Dockerfile, /RUN node \/usr\/local\/lib\/ship\/check-runtime.mjs/);
  assert.equal(files['runtime-version.mjs'], await readFile('dist/runtime-version.js', 'utf8'));
  assert.ok(files['check-runtime.mjs'].includes(JSON.stringify(NODE_MINIMUMS)));
  assert.ok(files['mongodb/Dockerfile'].startsWith(`FROM ${IMAGES.mongo}\n`));
  assert.equal(templateSettings(cfg).images, JSON.stringify(IMAGES));
  const web = await renderTemplates(parseConfig({ framework: 'react' }, '/app'));
  assert.ok(web.Dockerfile.includes(`FROM ${IMAGES.nginx} AS production`));
});
