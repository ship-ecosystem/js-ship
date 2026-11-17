import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { run } from '../../dist/process.js';
import { readConfig } from '../../dist/config.js';
import { composePrefix } from '../../dist/project.js';
import { IMAGES } from '../../dist/images.js';
import { copyExternalExample } from '../fixtures/external-services.mjs';
import { assertNoSecrets } from './image-credentials.mjs';

test('external PostgreSQL/Redis/MongoDB URLs reach dev, workers and source-free releases without owning provider lifecycles or images', { timeout: 900_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ship-external-docker-'));
  const providers = await mkdtemp(join(tmpdir(), 'ship-external-providers-'));
  const name = `ship-external-${randomBytes(5).toString('hex')}`, network = `${name}-network`;
  const secret = () => randomBytes(24).toString('hex');
  const pg = secret(), redis = secret(), mongo = secret(), admin = secret(), marker = secret(), wrong = secret();
  const env = { ...process.env, APP_PORT: '0', SHIP_HOST_ONLY_VALUE: secret() };
  const cli = resolve('dist/cli.js');
  const ship = args => run([process.execPath, cli, ...args], root, { env, capture: true });
  const provider = args => run(['docker', 'compose', ...args], providers, { capture: true });
  let cfg, destination;
  t.after(async () => {
    if (cfg) { const { prefix } = await composePrefix(root, cfg, 'development'); await run([...prefix, 'down', '--volumes', '--timeout', '3'], root, { env, capture: true }).catch(() => {}); }
    if (destination) await run(['docker', 'compose', 'down', '--volumes', '--timeout', '3'], destination, { capture: true }).catch(() => {});
    await provider(['down', '--volumes', '--timeout', '3']).catch(() => {});
    for (const tag of ['local', 'external-docs']) await run(['docker', 'image', 'rm', `${name}-app:${tag}`], root, { capture: true }).catch(() => {});
    for (const path of [root, providers, destination].filter(Boolean)) await rm(path, { recursive: true, force: true });
  });
  await mkdir(join(providers, 'init'));
  await writeFile(join(providers, 'init/postgres.sql'), `CREATE USER shipapp WITH PASSWORD '${pg}';\nCREATE DATABASE ship OWNER shipapp;\n`, { mode: 0o644 });
  await cp(resolve('templates/mongodb/app-user.js'), join(providers, 'init/mongo.js'));
  await cp(resolve('templates/mongodb/health.js'), join(providers, 'mongo-health.js'));
  await writeFile(join(providers, 'redis.acl'), `user default off\nuser shipapp on >${redis} ~* +@connection +ping\n`, { mode: 0o644 });
  const health = test => ({ test, interval: '1s', timeout: '5s', retries: 60, start_period: '10s' });
  await writeFile(join(providers, 'compose.yaml'), JSON.stringify({ name: `${name}-providers`, services: {
    pg: { image: IMAGES.postgres, environment: { POSTGRES_USER: 'provideradmin', POSTGRES_PASSWORD: admin },
      volumes: ['pg_data:/var/lib/postgresql/data', './init/postgres.sql:/docker-entrypoint-initdb.d/10-app.sql:ro'],
      networks: { shared: { aliases: ['external-postgres'] } }, healthcheck: health(['CMD', 'pg_isready', '-h', '127.0.0.1', '-U', 'provideradmin']) },
    redis: { image: IMAGES.redis, command: ['redis-server', '--aclfile', '/usr/local/etc/redis/users.acl'], environment: { REDISCLI_AUTH: redis },
      volumes: ['./redis.acl:/usr/local/etc/redis/users.acl:ro'], networks: { shared: { aliases: ['external-redis'] } },
      healthcheck: health(['CMD', 'redis-cli', '--user', 'shipapp', 'ping']) },
    mongo: { image: IMAGES.mongo, environment: { MONGO_INITDB_ROOT_USERNAME: 'provideradmin', MONGO_INITDB_ROOT_PASSWORD: admin,
      MONGO_INITDB_DATABASE: 'ship', SHIP_MONGO_USER: 'shipapp', SHIP_MONGO_PASSWORD: mongo },
      volumes: ['mongo_data:/data/db', './init/mongo.js:/docker-entrypoint-initdb.d/10-app.js:ro', './mongo-health.js:/usr/local/share/provider-health.js:ro'], networks: { shared: { aliases: ['external-mongo'] } },
      healthcheck: health(['CMD', 'mongosh', '--nodb', '--quiet', '/usr/local/share/provider-health.js']) },
  }, volumes: { pg_data: {}, mongo_data: {} }, networks: { shared: { name: network } } }));
  await provider(['up', '-d', '--wait', '--wait-timeout', '120']);
  const providerIds = (await provider(['ps', '-q'])).trim().split(/\s+/).sort();
  assert.equal(providerIds.length, 3);
  await copyExternalExample(root);
  const config = JSON.parse(await readFile(join(root, 'ship.json'), 'utf8'));
  Object.assign(config, { name, externalNetwork: network, processes: { worker: ['node', 'worker.mjs'] } });
  await writeFile(join(root, 'ship.json'), JSON.stringify(config));
  await writeFile(join(root, 'worker.mjs'), "const timer=setInterval(()=>{},1000);process.on('SIGTERM',()=>{clearInterval(timer);process.exit(0)});");
  const urls = {
    DATABASE_URL: `postgresql://shipapp:${pg}@external-postgres:5432/ship`,
    REDIS_URL: `redis://shipapp:${redis}@external-redis:6379`,
    MONGODB_URI: `mongodb://shipapp:${mongo}@external-mongo:27017/ship?authSource=ship`,
  };
  const envFile = (stage, values = urls) => `APP_STAGE=${stage}\nAPP_RUNTIME_MARKER=${marker}\n` + Object.entries(values).map(([key, value]) => `${key}='${value}'`).join('\n') + '\n';
  const devEnv = envFile('development'), prodEnv = envFile('production');
  await writeFile(join(root, '.env'), devEnv, { mode: 0o600 });
  await writeFile(join(root, '.env.production'), prodEnv, { mode: 0o600 });
  await ship(['init', '--no-interaction']); cfg = await readConfig(root);
  await ship(['config:test']); await ship(['up']);
  const success = output => { for (const backend of ['postgres', 'redis', 'mongodb']) assert.match(output, new RegExp(`${backend}: OK`)); };
  success(await ship(['npm', 'run', 'check:connections']));
  await ship(['exec', 'app', 'node', '-e', "if(process.env.APP_STAGE!=='development'||process.env.SHIP_HOST_ONLY_VALUE||process.env.MONGODB_HOST||new URL(process.env.MONGODB_URI).searchParams.has('directConnection'))process.exit(1)"]);
  // A file edit is not a mutation of an already running container's environment.
  await writeFile(join(root, '.env'), envFile('development', { ...urls, MONGODB_URI: urls.MONGODB_URI.replace(mongo, wrong) }));
  success(await ship(['npm', 'run', 'check:connections']));
  await ship(['up']);
  await assert.rejects(ship(['npm', 'run', 'check:connections']), error => {
    const output = error.stdout + error.stderr;
    assert.match(output, /mongodb: FAILED/);
    for (const value of [pg, redis, mongo, wrong, marker, ...Object.values(urls)]) assert.ok(!output.includes(value), 'failed probe must not print credentials or URLs');
    return true;
  });
  await writeFile(join(root, '.env'), devEnv); await ship(['up']);
  success(await ship(['npm', 'run', 'check:connections']));
  await ship(['down']);
  assert.deepEqual((await provider(['ps', '-q'])).trim().split(/\s+/).sort(), providerIds, 'ship down does not remove external provider containers');
  await ship(['release', '--tag', 'external-docs']);
  destination = await mkdtemp(join(tmpdir(), 'ship-external-release-'));
  await cp(join(root, 'dist/ship/external-docs'), destination, { recursive: true });
  const manifest = JSON.parse(await readFile(join(destination, 'release.json'), 'utf8'));
  assert.equal(manifest.images.length, 1); assert.deepEqual(manifest.images[0].services.sort(), ['app', 'worker']);
  const archive = join(destination, manifest.images[0].file);
  await assertNoSecrets(archive, [pg, redis, mongo, admin, wrong, marker]);
  assert.equal(await readFile(join(destination, '.env'), 'utf8'), prodEnv);
  const releaseModel = JSON.parse((await readFile(join(destination, 'docker-compose.yml'), 'utf8')).replace(/^#[^\n]*\n/, ''));
  assert.deepEqual(Object.keys(releaseModel.services).sort(), ['app', 'worker']);
  assert.deepEqual(releaseModel.services.app.depends_on, {});
  for (const file of ['server.mjs', 'check-connections.mjs', 'worker.mjs']) await rm(join(root, file));
  await run(['docker', 'load', '-i', archive], destination, { capture: true });
  success(await run(['sh', 'deploy-commands.sh'], destination, { env, capture: true }));
  await run(['docker', 'compose', 'up', '-d', '--no-build', '--pull', 'never', '--wait'], destination, { env, capture: true });
  for (const service of ['app', 'worker']) {
    success(await run(['docker', 'compose', 'exec', '-T', service, 'npm', 'run', 'check:connections'], destination, { capture: true }));
    await run(['docker', 'compose', 'exec', '-T', service, 'node', '-e', "if(process.env.APP_STAGE!=='production'||process.env.SHIP_HOST_ONLY_VALUE)process.exit(1)"], destination, { capture: true });
  }
  await run(['docker', 'compose', 'down'], destination, { capture: true });
  assert.deepEqual((await provider(['ps', '-q'])).trim().split(/\s+/).sort(), providerIds);
});
