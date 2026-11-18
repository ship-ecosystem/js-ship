import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Ajv from 'ajv';
import { shipConfigSchema } from '../dist/schema.js';
import { parseConfig, safeRelativePath } from '../dist/config.js';
import { builtinAdapters } from '../dist/adapters.js';
import { initProject } from '../dist/init.js';

// A command is a variable-length tuple: nonempty executable followed by string args.
const ajv = new Ajv({ strict: true, strictTuples: false, allErrors: true });
const validate = ajv.compile(shipConfigSchema);
const assertValid = value => assert.equal(validate(value), true, JSON.stringify(validate.errors));

test('shipped schema is current, compiles strictly and covers every normalized configuration field', async () => {
  assert.deepEqual(JSON.parse(await readFile(resolve('schema/ship.schema.json'), 'utf8')), shipConfigSchema);
  assert.deepEqual(Object.keys(shipConfigSchema.properties).filter(key => key !== '$schema').sort(), Object.keys(parseConfig({}, '/app')).sort());
  assert.deepEqual(shipConfigSchema.properties.framework.enum, [...builtinAdapters.keys()]);
  for (const framework of builtinAdapters.keys()) {
    for (const packageManager of ['npm', 'pnpm', 'yarn']) {
      const cfg = parseConfig({ framework, packageManager, packageManagerVersion: packageManager === 'yarn' ? '4.18.1' : '12.21.0',
        services: { database: 'mongodb', cache: 'redis' },
        additionalServices: [{ group: 'database', service: 'postgres', name: 'analytics' }],
        build: { publicEnv: { PUBLIC_URL: 'https://example.com/$literal' }, secrets: ['CMS_TOKEN'], npmrc: packageManager !== 'yarn' } }, '/app');
      assertValid(cfg);
    }
  }
  assertValid({});
  assertValid({ workspace: { app: 'apps/api', buildDependencies: ['packages/shared'] } });
  assertValid({ scripts: { build: null, start: null }, deployCommands: ['echo one\necho two', ['node', '-e', '']] });
});

test('schema and parser reject malformed authored configuration without coercion or default mutation', () => {
  const invalid = [
    { workspace: { app: '../outside' } }, { workspace: { app: 'apps/api', buildDependencies: null } },
    { unexpected: true }, { $schema: 4 }, { $schema: '  ' }, { name: 'UpperCase' }, { name: 'valid\n' }, { node: 'latest' }, { node: '24\n' }, { packageManagerVersion: '12.2.2\n' },
    { deployment: 'serverless' }, { port: '3000' }, { port: 0 }, { port: 65536 }, { port: 3.5 },
    { packageManager: 'yarn', packageManagerVersion: '1.22.22' }, { packageManager: 'yarn', packageManagerVersion: '4.18.1', build: { npmrc: true } },
    { packageManager: 'bun' }, { packageManagerVersion: '^12.2.2' }, { runtimeFiles: ['../outside'] },
    { outputDirectory: 'dist/../secret' }, { serverEntry: '/server.mjs' }, { basePath: '/docs' },
    { scripts: { build: 'npm run build' } }, { scripts: { unexpected: 'run' } }, { scripts: { dev: null } },
    { additionalServices: [{ group: 'database', service: 'mongodb' }] }, { serviceNames: { app: 'UpperCase' } },
    { processes: { app: 'echo hi' } }, { processes: { worker: [] } }, { processes: { worker: ['', 'arg'] } },
    { deployCommands: ['\t\n'] }, { deployCommands: [['node', '\0']] },
    { build: { secret: 'wrong' } }, { build: { publicEnv: { PATH: 'bad' } } }, { build: { publicEnv: { 'PUBLIC_URL\n': 'bad' } } },
    { build: { secrets: ['PUBLIC_TOKEN'] } }, { build: { secrets: ['CMS_TOKEN', 'CMS_TOKEN'] } },
    { build: { npmrc: 'yes' } }, { build: { publicEnv: null } },
    ...['build', 'name', 'framework', 'node', 'deployment', 'services', 'runtimeFiles', 'publishPorts', 'scripts', 'port', 'packageManager'].map(key => ({ [key]: null })),
  ];
  for (const value of invalid) {
    const before = JSON.stringify(value);
    assert.equal(validate(value), false, before);
    assert.throws(() => parseConfig(value, '/app'), undefined, before);
    assert.equal(JSON.stringify(value), before);
  }
  const empty = {};
  assertValid(empty);
  assert.deepEqual(empty, {});
  assert.equal(validate({ services: { database: 'redis' } }), false);
  assert.equal(validate({ additionalServices: [{ group: 'cache', service: 'mongodb', name: 'one' }] }), false);
});

test('path rules reject traversal while supporting generated framework output paths', () => {
  const validatePath = ajv.compile({ $schema: shipConfigSchema.$schema, ...shipConfigSchema.definitions.relativePath });
  for (const path of ['.next/standalone/server.js', '.output/server/index.mjs', 'dist/browser/index.html', 'server.mjs', '.hidden/file',
    '.', '..', './server.mjs', '../server.mjs', 'dist/../server.mjs', 'dist/./server.mjs', 'dist//file', '/tmp/file', 'file name', 'dist/', 'dist\n', 'dist\r\n']) {
    assert.equal(validatePath(path), safeRelativePath(path), path);
  }
  for (const path of ['.', '..', 'dist/../server.mjs', '/tmp/file', 'dist\n', 'dist\r\n']) assert.equal(validatePath(path), false);
});

test('init writes an offline editor schema, refreshes it and preserves an explicit schema reference', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ship-schema-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(resolve('examples/node'), root, { recursive: true });
  await initProject(root);
  let config = JSON.parse(await readFile(join(root, 'ship.json'), 'utf8'));
  assert.equal(config.$schema, './ship/ship.schema.json');
  assertValid(config);
  const local = JSON.parse(await readFile(resolve(root, config.$schema), 'utf8'));
  assert.deepEqual(local, shipConfigSchema);
  assert.equal(new Ajv({ strictTuples: false }).compile(local)(config), true);
  await writeFile(join(root, 'ship/ship.schema.json'), '{}\n');
  config.$schema = './my-team.schema.json';
  await writeFile(join(root, 'ship.json'), JSON.stringify(config));
  await initProject(root);
  config = JSON.parse(await readFile(join(root, 'ship.json'), 'utf8'));
  assert.equal(config.$schema, './my-team.schema.json');
  assert.deepEqual(JSON.parse(await readFile(join(root, 'ship/ship.schema.json'), 'utf8')), shipConfigSchema);
});
