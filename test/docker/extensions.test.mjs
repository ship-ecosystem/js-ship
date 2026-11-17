import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IMAGES } from '../../dist/images.js';
import { readConfig } from '../../dist/config.js';
import { composePrefix } from '../../dist/project.js';
import { run } from '../../dist/process.js';
import { publishedPort, waitForResponse } from './support.mjs';

test('custom adapter and build-owned service export a portable release without loading host extensions at deployment', { timeout: 600_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ship-extension-docker-'));
  const portable = await mkdtemp(join(tmpdir(), 'ship-extension-portable-'));
  const name = `ship-extension-${randomBytes(4).toString('hex')}`, env = { ...process.env, APP_PORT: '0' };
  const cli = resolve('dist/cli.js');
  const ship = (args, options = {}) => run([process.execPath, cli, ...args], root, { env, ...options });
  let dev;
  t.after(async () => {
    if (dev) await run([...dev.prefix, 'down', '--volumes', '--remove-orphans'], root, { capture: true }).catch(() => {});
    await run(['docker', 'compose', 'down', '--volumes', '--remove-orphans'], portable, { capture: true }).catch(() => {});
    for (const image of [`${name}-app:local`, `${name}-example-redis:local`, `${name}-app:extension-test`, `${name}-example-redis:extension-test`]) await run(['docker', 'image', 'rm', image], root, { capture: true }).catch(() => {});
    await rm(root, { recursive: true, force: true }); await rm(portable, { recursive: true, force: true });
  });
  await cp(resolve('examples/node'), root, { recursive: true });
  await writeFile(join(root, 'server.mjs'), `import{createServer}from'node:http';createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({cache:process.env.CUSTOM_REDIS_HOST,analytics:process.env.ANALYTICS_CUSTOM_REDIS_HOST,runtime:process.env.EXTENSION_RUNTIME}))}).listen(Number(process.env.PORT),'0.0.0.0');`);
  const definition = `export default {
apiVersion:1,name:'demo',version:'1.0.0',
adapters:[{key:'example-node',label:'Example Node',defaultDeployment:'node',
 defaults:()=>({scripts:{dev:'dev',build:null,start:'start'},port:3000,outputDirectory:null,staticRouting:'spa'}),
 validate:()=>[],packaging:c=>({kind:'node',port:c.port,outputDirectory:null,routing:'spa'}),
 developmentCommand:c=>[c.packageManager,'run',c.scripts.dev],productionCommand:c=>[c.packageManager,'run',c.scripts.start]}],
services:[{key:'example-redis',label:'Example Redis',group:'cache',volumes:['data'],
 compose:c=>({build:{context:c.projectRoot,dockerfile:'ship/extensions/demo/Dockerfile'},command:['redis-server','--appendonly','yes'],volumes:[c.volume('data')+':/data'],healthcheck:{test:['CMD','/usr/local/bin/demo-health.sh'],interval:'1s',timeout:'3s',retries:30}}),
 appEnvironment:c=>({[c.envPrefix+'CUSTOM_REDIS_HOST']:c.serviceName})}],
templates:{'Dockerfile':${JSON.stringify(`FROM ${IMAGES.redis}\nCOPY ship/extensions/demo/health.sh /usr/local/bin/demo-health.sh\n`)},'health.sh':'#!/bin/sh\\nexec redis-cli ping\\n'}};`;
  await writeFile(join(root, 'ship.extensions.mjs'), definition);
  await writeFile(join(root, 'ship.json'), JSON.stringify({ name, extensions: ['ship.extensions.mjs'], framework: 'example-node', publishPorts: true,
    services: { cache: 'example-redis' }, serviceNames: { 'example-redis': 'cache' }, additionalServices: [{ group: 'cache', service: 'example-redis', name: 'analytics' }] }));
  await writeFile(join(root, '.env.production'), 'EXTENSION_RUNTIME=production-only\n');
  await ship(['init', '--no-interaction']);
  await ship(['config:test']);
  const cfg = await readConfig(root);
  dev = await composePrefix(root, cfg, 'development');
  await run([...dev.prefix, 'config', '--quiet'], root);
  await ship(['up']);
  const devURL = `http://127.0.0.1:${await publishedPort(dev.prefix, root, 3000)}`;
  await waitForResponse(devURL);
  assert.equal((await (await fetch(devURL)).json()).cache, 'cache');
  await ship(['exec', 'cache', 'redis-cli', 'SET', 'extension-marker', 'primary']);
  assert.match(await ship(['exec', 'cache', 'redis-cli', 'GET', 'extension-marker'], { capture: true }), /primary/);
  await ship(['exec', 'example-redis-analytics', 'redis-cli', 'SET', 'extension-marker', 'analytics']);
  await ship(['down']);
  await ship(['release', '--tag', 'extension-test']);
  await cp(join(root, 'dist/ship/extension-test'), portable, { recursive: true });
  const receipt = JSON.parse(await readFile(join(portable, 'release.json'), 'utf8'));
  assert.equal(receipt.images.length, 2, 'named infrastructure instances share one exported image');
  assert.deepEqual(receipt.extensions.definitions, [{ name: 'demo', version: '1.0.0' }]);
  assert.match(receipt.extensions.fingerprint, /^[a-f0-9]{64}$/);
  await rm(join(root, 'server.mjs')); await rm(join(root, 'ship.extensions.mjs'));
  await run(['docker', 'compose', 'up', '-d', '--no-build', '--pull', 'never', '--wait'], portable, { env });
  const url = `http://127.0.0.1:${await publishedPort(['docker', 'compose'], portable, 3000)}`;
  await waitForResponse(url);
  assert.deepEqual(await (await fetch(url)).json(), { cache: 'cache', analytics: 'example-redis-analytics', runtime: 'production-only' });
  assert.doesNotMatch(await readFile(join(portable, 'docker-compose.yml'), 'utf8'), /build|context|ship.extensions/);
});
