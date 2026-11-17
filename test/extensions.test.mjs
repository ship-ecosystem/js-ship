import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Ajv from 'ajv';
import { createRegistry, loadExtensions } from '../dist/extensions.js';
import { builtinAdapters } from '../dist/adapters.js';
import { builtinServices } from '../dist/services.js';
import { parseConfig } from '../dist/config.js';
import { loadProject } from '../dist/project.js';
import { initProject } from '../dist/init.js';
import { buildCompose, buildProjectCompose } from '../dist/compose.js';
import { templateProblems } from '../dist/templates.js';
import { createConfigSchema } from '../dist/schema.js';
import { run } from '../dist/process.js';

const generic = builtinAdapters.get('generic');
const custom = () => ({ apiVersion: 1, name: 'example', version: '1.0.0', adapters: [{ ...generic, key: 'example-node', label: 'Example Node' }],
  services: [{ key: 'example-cache', label: 'Example cache', group: 'queue', volumes: ['data'],
    compose: c => ({ image: 'redis:7-bookworm', volumes: [`${c.volume('data')}:/data`] }),
    appEnvironment: c => ({ [`${c.envPrefix}QUEUE_HOST`]: c.serviceName, [`${c.envPrefix}QUEUE_PASSWORD`]: c.credential('QUEUE_PASSWORD', 'development-only') }) }],
  templates: { 'helper.sh': '#!/bin/sh\necho example\n' } });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ship-extensions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(resolve('examples/node'), root, { recursive: true });
  return root;
}

test('registries are isolated read-only snapshots and named service volumes retain identity', async () => {
  const extension = custom(), registry = createRegistry([extension]);
  extension.adapters[0].label = 'mutated'; extension.services[0].volumes.push('later');
  assert.equal(registry.adapters.get('example-node').label, 'Example Node');
  assert.deepEqual(registry.services.get('example-cache').volumes, ['data']);
  assert.equal(registry.adapters.set, undefined); assert.equal(builtinAdapters.set, undefined);
  assert.equal(builtinServices.set, undefined); assert.equal(createRegistry().adapters.has('example-node'), false);
  const cfg = parseConfig({ framework: 'example-node', publishPorts: true, services: { queue: 'example-cache' },
    additionalServices: [{ group: 'queue', service: 'example-cache', name: 'analytics' }], serviceNames: { 'example-cache': 'jobs' } }, '/app');
  const model = buildCompose(cfg, '/app', 'production', 'v1', [], registry);
  assert.deepEqual(model.services.jobs.volumes, ['example-cache_data:/data']);
  assert.ok(model.volumes['example-cache_data']); assert.ok(model.volumes['example-cache-analytics_data']);
  assert.equal(model.services.app.environment.QUEUE_HOST, 'jobs');
  assert.equal(model.services.app.environment.ANALYTICS_QUEUE_HOST, 'example-cache-analytics');
  assert.match(model.services.app.environment.QUEUE_PASSWORD, /QUEUE_PASSWORD:\?/);
  assert.equal(model.services.app.depends_on.jobs.condition, 'service_started');
  for (const healthcheck of [{ disable: true }, { test: ['NONE'] }]) {
    const disabled = createRegistry([{ ...custom(), services: [{ ...custom().services[0], compose: () => ({ image: 'redis:7', healthcheck }) }] }]);
    assert.equal(buildCompose(cfg, '/app', 'production', 'v1', [], disabled).services.app.depends_on.jobs.condition, 'service_started');
  }
  assert.equal(registry.templates['extensions/example/helper.sh'], '#!/bin/sh\necho example\n');
  const other = custom(); other.adapters[0].packaging = c => ({ kind: 'node', port: 4321, outputDirectory: null, routing: 'spa' });
  const results = await Promise.all([registry, createRegistry([other])].map(async r => buildCompose(cfg, '/app', 'production', 'v1', [], r)));
  assert.match(results[0].services.app.ports[0], /:3000$/);
  assert.match(results[1].services.app.ports[0], /:4321$/);
  assert.equal(createRegistry().services.has('example-cache'), false);
});

test('API version, names, collisions and unsafe template/volume declarations fail atomically', () => {
  for (const extension of [null, {}, { ...custom(), apiVersion: 2 }, { ...custom(), version: '1.0.0\n' },
    { ...custom(), unknown: true }, { ...custom(), name: '../bad' }, { ...custom(), adapters: [{}] },
    { ...custom(), adapters: [{ ...generic, key: 'generic' }] }, { ...custom(), services: [builtinServices.get('redis')] },
    { ...custom(), templates: { '../Dockerfile': 'bad' } }, { ...custom(), services: [{ ...custom().services[0], volumes: ['../bad'] }] }]) assert.throws(() => createRegistry([extension]));
  assert.throws(() => createRegistry([custom(), custom()]), /unique/);
  assert.throws(() => createRegistry([custom(), { ...custom(), name: 'other' }]), /duplicate adapters/);
  assert.equal(builtinAdapters.size, 15); assert.equal(builtinServices.size, 3);
});

test('malformed callback results cannot become Docker commands or packaging paths', () => {
  const cfg = parseConfig({ framework: 'example-node' }, '/app');
  for (const patch of [
    { defaults: () => ({}) }, { validate: async () => [] }, { developmentCommand: () => [] },
    { productionCommand: () => ['node', '\0'] }, { buildArguments: () => 'bad' },
    { packaging: () => ({ kind: 'static', port: 80, outputDirectory: 'dist', routing: 'html' }) },
    { packaging: () => ({ kind: 'static', port: 8080, outputDirectory: '../out', routing: 'html' }) },
    { packaging: () => ({ kind: 'node', port: 3000, outputDirectory: 'dist', entrypoint: 'other/main.js', routing: 'html', runtime: 'bundle' }) },
  ]) {
    const registry = createRegistry([{ ...custom(), adapters: [{ ...custom().adapters[0], ...patch }] }]);
    const adapter = registry.adapters.get('example-node');
    const method = Object.keys(patch)[0];
    assert.throws(() => method === 'defaults' ? adapter.defaults({}) : method === 'validate' ? adapter.validate(cfg, {}) : adapter[method](cfg));
  }
  for (const patch of [{ compose: () => ({}) }, { appEnvironment: () => ({ TOKEN: 3 }) }]) {
    const registry = createRegistry([{ ...custom(), services: [{ ...custom().services[0], ...patch }] }]);
    const config = parseConfig({ services: { queue: 'example-cache' } }, '/app');
    assert.throws(() => buildCompose(config, '/app', 'production', 'v1', [], registry));
  }
});

test('explicit ESM/CJS loaders, custom schemas and template fingerprints work without global mutation', async t => {
  const root = await fixture(t);
  const extensionFile = `export default {apiVersion:1,name:'local',version:'1.0.0',services:[{
key:'local-cache',label:'Local cache',group:'queue',volumes:['data'],compose:c=>({image:'redis:7-bookworm',volumes:[c.volume('data')+':/data']}),appEnvironment:c=>({QUEUE_HOST:c.serviceName})}],templates:{'notes.txt':'local template'}};`;
  await writeFile(join(root, 'ship.extensions.mjs'), extensionFile);
  await writeFile(join(root, 'extra.cjs'), "module.exports=[{apiVersion:1,name:'second',version:'1.0.0',templates:{'notes.txt':'cjs template'}}];");
  await writeFile(join(root, 'ship.json'), JSON.stringify({ extensions: ['./ship.extensions.mjs', 'extra.cjs'], services: { queue: 'local-cache' } }));
  const cfg = await initProject(root);
  assert.deepEqual(cfg.extensions, ['ship.extensions.mjs', 'extra.cjs']);
  assert.equal(await readFile(join(root, 'ship/extensions/local/notes.txt'), 'utf8'), 'local template');
  const registry = await loadExtensions(root, cfg.extensions);
  const schema = JSON.parse(await readFile(join(root, 'ship/ship.schema.json'), 'utf8'));
  assert.deepEqual(schema, createConfigSchema(registry));
  const validate = new Ajv({ strictTuples: false }).compile(schema);
  assert.equal(validate(cfg), true, JSON.stringify(validate.errors));
  assert.equal(validate({ services: { queue: 'not-registered' } }), false);
  assert.throws(() => buildCompose(cfg, root, 'development'), /load|Load/);
  assert.equal((await buildProjectCompose(cfg, root, 'production')).services.app.environment.QUEUE_HOST, 'local-cache');
  assert.deepEqual(await templateProblems(cfg, root), []);
  await rm(join(root, 'ship/extensions/local/notes.txt'));
  await assert.rejects(loadProject(root), /extensions\/local\/notes.txt is missing/);
  await initProject(root);
  const otherRegistry = createRegistry([{ apiVersion: 1, name: 'local', version: '2.0.0' }]);
  assert.match((await templateProblems(cfg, root, otherRegistry)).join(), /different packaging settings|different packaging/);
  await writeFile(join(root, 'ship.extensions.mjs'), extensionFile + '\n// changed\n');
  await assert.rejects(loadExtensions(root, cfg.extensions), /restart this process/);
});

test('invalid or escaping modules fail before files are generated; help does not execute modules', async t => {
  const root = await fixture(t);
  for (const extensions of [['../outside.mjs'], ['https://example.com/plugin.mjs'], ['file:///tmp/plugin.mjs'], ['plugin.ts'], ['plugin.mjs', './plugin.mjs']]) assert.throws(() => parseConfig({ extensions }, root));
  await writeFile(join(root, 'bad.mjs'), "throw new Error('extension-import-failed');");
  await writeFile(join(root, 'ship.json'), JSON.stringify({ extensions: ['bad.mjs'] }));
  await assert.rejects(initProject(root), /Cannot load extension bad.mjs/);
  assert.equal((await readdir(root)).includes('ship'), false);
  assert.match(await run([process.execPath, resolve('dist/cli.js'), '--project-directory', root, '--help'], root, { capture: true }), /JavaScript Ship/);
  if (process.platform !== 'win32') {
    const outside = await mkdtemp(join(tmpdir(), 'ship-extension-outside-'));
    t.after(() => rm(outside, { recursive: true, force: true }));
    await writeFile(join(outside, 'plugin.mjs'), 'export default {};');
    await symlink(join(outside, 'plugin.mjs'), join(root, 'escaped.mjs'));
    await assert.rejects(loadExtensions(root, ['escaped.mjs']), /outside the project/);
  }
});

test('class callbacks retain their receiver, while undeclared volumes and inconsistent owned builds fail', () => {
  class ClassAdapter {
    key = 'class-node'; label = 'Class node'; #port = 3456;
    defaults() { return { ...generic.defaults({}), port: this.#port }; }
    validate() { return []; }
    packaging() { return { kind: 'node', port: this.#port, outputDirectory: null, routing: 'spa' }; }
    developmentCommand() { return ['node', String(this.#port)]; }
    productionCommand() { return ['node', String(this.#port)]; }
  }
  const registry = createRegistry([{ apiVersion: 1, name: 'class-example', version: '1.0.0', adapters: [new ClassAdapter()] }]);
  assert.equal(registry.adapters.get('class-node').defaults({}).port, 3456);
  assert.equal(registry.adapters.get('class-node').packaging(parseConfig({ framework: 'class-node' }, '/app')).port, 3456);
  const cfg = parseConfig({ services: { queue: 'example-cache' }, additionalServices: [{ group: 'queue', service: 'example-cache', name: 'other' }] }, '/app');
  const undeclared = createRegistry([{ ...custom(), services: [{ ...custom().services[0], compose: () => ({ image: 'redis:7', volumes: ['missing:/data'] }) }] }]);
  assert.throws(() => buildCompose(cfg, '/app', 'production', 'v1', [], undeclared), /undeclared named volume/);
  const differentBuilds = createRegistry([{ ...custom(), services: [{ ...custom().services[0], compose: c => ({ build: { context: c.projectRoot, args: { INSTANCE: c.resourceName } } }) }] }]);
  assert.throws(() => buildCompose(cfg, '/app', 'production', 'v1', [], differentBuilds), /identical build/);
});

test('custom static defaults select Nginx packaging without injecting Vite build flags', async t => {
  const root = await fixture(t);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  manifest.scripts.build = 'node build.mjs';
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
  const registry = createRegistry([{ apiVersion: 1, name: 'static-example', version: '1.0.0', adapters: [{
    key: 'custom-static', label: 'Custom static', defaultDeployment: 'static',
    defaults: () => ({ scripts: { dev: 'dev', build: 'build', start: null }, port: 3100, outputDirectory: 'public', staticRouting: 'html' }),
    validate: () => [], packaging: c => ({ kind: 'static', port: 8080, outputDirectory: c.outputDirectory, routing: 'html' }),
    developmentCommand: () => ['node', 'server.mjs'], productionCommand: () => ['nginx', '-g', 'daemon off;'],
  }] }]);
  const config = await initProject(root, { framework: 'custom-static' }, registry);
  assert.equal(config.deployment, 'static');
  const dockerfile = await readFile(join(root, 'ship/Dockerfile'), 'utf8');
  assert.doesNotMatch(dockerfile, /run "\$SHIP_BUILD_SCRIPT"[^\n]*--base/);
  assert.match(dockerfile, /\/app\/public\/ \/usr\/share\/nginx\/html/);
  const model = await buildProjectCompose(config, root, 'production', 'local', registry);
  assert.equal(model.services.app.environment, undefined);
  assert.equal(model.services.app.env_file, undefined);
});
