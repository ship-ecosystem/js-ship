import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { run } from '../../dist/process.js';
import { composePrefix } from '../../dist/project.js';
import { readConfig } from '../../dist/config.js';

test('authenticated MongoDB transactions, URI encoding, rename persistence and portable release', { timeout: 900_000 }, async t => {
  const root=await mkdtemp(join(tmpdir(),'ship-mongodb-docker-'));
  const name=`ship-mongodb-test-${randomBytes(5).toString('hex')}`;
  const cli=resolve('dist/cli.js');
  const ship=args=>run([process.execPath,cli,...args],root,{env:{...process.env,APP_PORT:'0'}});
  let cfg,destination;
  t.after(async()=>{
    if(cfg){const{prefix}=await composePrefix(root,cfg,'development');await run([...prefix,'down','--volumes','--remove-orphans'],root).catch(()=>{});}
    if(destination){await run(['docker','compose','down','--volumes','--remove-orphans'],destination).catch(()=>{});await rm(destination,{recursive:true,force:true});}
    for(const image of ['app','mongodb'])for(const tag of ['local','mongo-smoke'])await run(['docker','image','rm',`${name}-${image}:${tag}`],root).catch(()=>{});
    await rm(root,{recursive:true,force:true});
  });
  await cp(resolve('examples/node'),root,{recursive:true});
  await writeFile(join(root,'ship.json'),JSON.stringify({name,services:{database:'mongodb'},additionalServices:[{group:'database',service:'mongodb',name:'analytics'}],publishPorts:true}));
  await writeFile(join(root,'.env'),"MONGODB_PASSWORD='dev:p@ss$word'\nMONGODB_ROOT_PASSWORD=development-admin-unique\n",{mode:0o600});
  await ship(['init','--no-interaction']);cfg=await readConfig(root);
  const secret=()=>randomBytes(24).toString('hex');
  await writeFile(join(root,'.env.production'),`MONGODB_PASSWORD=${secret()}\nMONGODB_ROOT_PASSWORD=${secret()}\nANALYTICS_MONGODB_PASSWORD=${secret()}\nANALYTICS_MONGODB_ROOT_PASSWORD=${secret()}\n`,{mode:0o600});
  await ship(['up']);
  await ship(['exec','app','node','-e',"const uri=new URL(process.env.MONGODB_URI);if(decodeURIComponent(uri.password)!==process.env.MONGODB_PASSWORD||Object.hasOwn(process.env,'MONGODB_ROOT_PASSWORD')||!process.env.ANALYTICS_MONGODB_URI)process.exit(1)"]);
  const transaction=`const conn=new Mongo('mongodb://127.0.0.1:27017/?directConnection=true');
    const app=conn.getDB(process.env.MONGO_INITDB_DATABASE);app.auth(process.env.SHIP_MONGO_USER,process.env.SHIP_MONGO_PASSWORD);
    app.createCollection('records');const session=conn.startSession();session.startTransaction();
    session.getDatabase(process.env.MONGO_INITDB_DATABASE).records.insertOne({_id:'transaction'});session.commitTransaction();session.endSession();
    if(app.records.countDocuments({_id:'transaction'})!==1)throw new Error('transaction failed');
    const stream=app.records.watch([], {maxAwaitTimeMS:1000});stream.tryNext();
    app.records.insertOne({_id:'stream-event'});let event;
    for(let attempt=0;attempt<10&&!event;attempt++)event=stream.tryNext();
    stream.close();if(event?.operationType!=='insert'||event.documentKey._id!=='stream-event')throw new Error('change stream failed');
    let denied=false;try{denied=conn.getDB('admin').runCommand({usersInfo:1}).ok!==1}catch(error){denied=error.code===13}
    if(!denied)throw new Error('app user has admin access');`;
  await ship(['exec','mongodb','mongosh','--nodb','--quiet','--eval',transaction]);
  await ship(['down']);
  cfg.serviceNames={mongodb:'documents'};
  await writeFile(join(root,'ship.json'),JSON.stringify(cfg));
  await ship(['up']); // Same data/key volumes, updated single-member replica host.
  const persisted="const app=new Mongo('mongodb://127.0.0.1:27017/?directConnection=true').getDB(process.env.MONGO_INITDB_DATABASE);app.auth(process.env.SHIP_MONGO_USER,process.env.SHIP_MONGO_PASSWORD);if(app.records.countDocuments({_id:'transaction'})!==1)throw new Error('data lost after rename');";
  await ship(['exec','documents','mongosh','--nodb','--quiet','--eval',persisted]);
  await ship(['down']);
  await ship(['release','--tag','mongo-smoke']);
  destination=await mkdtemp(join(tmpdir(),'ship-mongodb-portable-'));
  await cp(join(root,'dist/ship/mongo-smoke'),destination,{recursive:true});
  await rm(join(root,'server.mjs'));
  const manifest=JSON.parse(await readFile(join(destination,'release.json'),'utf8'));
  assert.equal(manifest.images.length,2);
  assert.equal(manifest.images.find(image=>image.services.includes('documents')).services.length,2);
  for(const image of manifest.images)await run(['docker','load','-i',join(destination,image.file)],destination);
  await run(['docker','compose','up','-d','--wait','--wait-timeout','180'],destination,{env:{...process.env,APP_PORT:'0'}});
  await run(['docker','compose','exec','-T','documents','mongosh','--nodb','--quiet','--eval',transaction],destination);
});

test('MongoDB standalone authenticates, persists writes and omits replica-set client settings', { timeout: 300_000 }, async t => {
  const root=await mkdtemp(join(tmpdir(),'ship-mongo-standalone-'));
  const name=`ship-standalone-${randomBytes(5).toString('hex')}`;
  const cli=resolve('dist/cli.js');let cfg;
  const ship=args=>run([process.execPath,cli,...args],root,{env:{...process.env,APP_PORT:'0'}});
  t.after(async()=>{
    if(cfg){const{prefix}=await composePrefix(root,cfg,'development');await run([...prefix,'down','--volumes'],root).catch(()=>{});}
    for(const image of ['app','mongodb'])await run(['docker','image','rm',`${name}-${image}:local`],root,{capture:true}).catch(()=>{});
    await rm(root,{recursive:true,force:true});
  });
  await cp(resolve('examples/node'),root,{recursive:true});
  await writeFile(join(root,'ship.json'),JSON.stringify({name}));
  await ship(['init','--database','mongodb','--mongodb-mode','standalone','--no-interaction']);cfg=await readConfig(root);
  await ship(['up']);
  await ship(['exec','app','node','-e',"if(new URL(process.env.MONGODB_URI).searchParams.has('replicaSet'))process.exit(1)"]);
  const setup="const c=new Mongo('mongodb://127.0.0.1:27017/?directConnection=true');const app=c.getDB(process.env.MONGO_INITDB_DATABASE);app.auth(process.env.SHIP_MONGO_USER,process.env.SHIP_MONGO_PASSWORD);if(app.adminCommand({hello:1}).setName)throw new Error('unexpected replica set');app.records.insertOne({_id:'standalone'});";
  await ship(['exec','mongodb','mongosh','--nodb','--quiet','--eval',setup]);
  await ship(['down']);await ship(['up']);
  const verify="const app=new Mongo('mongodb://127.0.0.1:27017/?directConnection=true').getDB(process.env.MONGO_INITDB_DATABASE);app.auth(process.env.SHIP_MONGO_USER,process.env.SHIP_MONGO_PASSWORD);if(app.records.countDocuments({_id:'standalone'})!==1)throw new Error('standalone data lost');";
  await ship(['exec','mongodb','mongosh','--nodb','--quiet','--eval',verify]);
});

test('MongoDB blocks unhealthy startup and recovers from crashes, manual stops and credential mismatch without losing volumes', { timeout: 600_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ship-mongo-recovery-'));
  const name = `ship-mongo-recovery-${randomBytes(5).toString('hex')}`;
  const env = { ...process.env, APP_PORT: '0' };
  const cli = resolve('dist/cli.js');
  const ship = args => run([process.execPath, cli, ...args], root, { env, capture: true });
  const password = randomBytes(24).toString('hex'), rootPassword = randomBytes(24).toString('hex');
  const wrongPassword = randomBytes(24).toString('hex');
  const originalEnv = `MONGODB_PASSWORD=${password}\nMONGODB_ROOT_PASSWORD=${rootPassword}\n`;
  let cfg;
  const compose = async args => run([...(await composePrefix(root, cfg, 'development')).prefix, ...args], root, { env, capture: true });
  const inspect = async id => JSON.parse(await run(['docker', 'inspect', id], root, { capture: true }))[0];
  const idFor = service => compose(['ps', '--all', '-q', service]).then(text => text.trim());
  const until = async (check, label, timeout = 90_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await check()) return; await delay(500); }
    throw new Error(`Timed out waiting for ${label}`);
  };
  t.after(async () => {
    if (cfg) await compose(['down', '--volumes', '--timeout', '3']).catch(() => {});
    for (const image of ['app', 'mongodb']) await run(['docker', 'image', 'rm', `${name}-${image}:local`], root, { capture: true }).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  await cp(resolve('examples/node'), root, { recursive: true });
  await writeFile(join(root, 'ship.json'), JSON.stringify({ name, services: { database: 'mongodb' } }));
  await writeFile(join(root, '.env'), originalEnv, { mode: 0o600 });
  await ship(['init', '--no-interaction']); cfg = await readConfig(root);
  // Initialize persistent users fully before injecting a readiness failure.
  await ship(['up']);
  await ship(['down']);
  const override = join(root, 'compose.override.yaml');
  await writeFile(override, JSON.stringify({ services: { mongodb: { healthcheck: {
    test: ['CMD', 'false'], interval: '1s', timeout: '5s', retries: 2, start_period: '0s'
  } } } }));
  const rejectsReadiness = async () => assert.rejects(ship(['up']), error => {
    const output = error.stdout + error.stderr;
    assert.match(output, /unhealthy|dependency failed/i);
    assert.doesNotMatch(output, /Ready: http/);
    for (const secret of [password, rootPassword, wrongPassword]) assert.ok(!output.includes(secret), 'startup diagnostics omit credentials');
    return true;
  });
  await rejectsReadiness();
  assert.equal((await inspect(await idFor('app'))).State.Running, false, 'unhealthy dependency must block application startup');
  await rm(override);
  await ship(['up']);
  const mongoId = await idFor('mongodb'), appId = await idFor('app');
  const volumeIdentity = state => state.Mounts.filter(m => ['/data/db', '/data/configdb'].includes(m.Destination)).map(m => [m.Destination, m.Name]).sort();
  const volumes = volumeIdentity(await inspect(mongoId));
  const keyDigest = async () => compose(['exec', '-T', 'mongodb', 'sha256sum', '/data/configdb/ship-key']);
  const key = await keyDigest();
  const appDb = `const c=new Mongo('mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=1000');const app=c.getDB(process.env.MONGO_INITDB_DATABASE);if(!app.auth(process.env.SHIP_MONGO_USER,process.env.SHIP_MONGO_PASSWORD))throw new Error('app auth failed');`;
  const mongo = code => compose(['exec', '-T', 'mongodb', 'mongosh', '--nodb', '--quiet', '--eval', code]);
  await mongo(appDb + `app.records.insertOne({_id:'before-crash'},{writeConcern:{w:'majority',j:true}});`);
  const pid = (await mongo(`const a=new Mongo('mongodb://127.0.0.1:27017/?directConnection=true').getDB('admin');a.auth(process.env.MONGO_INITDB_ROOT_USERNAME,process.env.MONGO_INITDB_ROOT_PASSWORD);print(a.serverStatus().pid.toString());`)).trim();
  assert.match(pid, /^\d+$/);
  const before = await inspect(mongoId);
  // Docker activates restart policies after a successful ten-second startup.
  await delay(Math.max(0, 11_000 - (Date.now() - Date.parse(before.State.StartedAt))));
  // Kill mongod inside the fixture, rather than using Docker's manual-stop API.
  await compose(['exec', '-T', 'mongodb', 'sh', '-c', 'kill -KILL "$1"', 'ship-test-crash', pid]).catch(error => {
    if (error.exitCode !== 137) throw error; // Docker may close exec as the init exits.
  });
  await until(async () => {
    const state = await inspect(mongoId);
    return state.RestartCount > before.RestartCount && state.State.Health?.Status === 'healthy';
  }, 'automatic MongoDB restart and authenticated primary');
  assert.equal((await inspect(appId)).State.Running, true, 'database crash does not restart the application');
  const persisted = appDb + `if(app.records.countDocuments({_id:'before-crash'})!==1)throw new Error('record lost');`;
  await mongo(persisted + `const session=c.startSession();session.startTransaction();session.getDatabase(process.env.MONGO_INITDB_DATABASE).records.insertOne({_id:'after-crash'});session.commitTransaction();session.endSession();`);
  assert.deepEqual(volumeIdentity(await inspect(mongoId)), volumes);
  assert.equal(await keyDigest(), key);
  await compose(['stop', '--timeout', '10', 'mongodb']);
  const stopped = await inspect(mongoId);
  await delay(1500);
  const stillStopped = await inspect(mongoId);
  assert.equal(stillStopped.State.Running, false);
  assert.equal(stillStopped.RestartCount, stopped.RestartCount, 'manual stop remains stopped');
  await ship(['up']);
  await mongo(persisted);
  // Changing env cannot rotate the root user already persisted in the database.
  await writeFile(join(root, '.env'), originalEnv.replace(rootPassword, wrongPassword), { mode: 0o600 });
  await writeFile(override, JSON.stringify({ services: { mongodb: { healthcheck: {
    interval: '1s', timeout: '5s', retries: 2, start_period: '0s'
  } } } }));
  await rejectsReadiness();
  const mismatchId = await idFor('mongodb');
  await until(async () => {
    try { await mongo(persisted); return true; } catch { return false; }
  }, 'existing application credentials to remain usable');
  const unhealthy = await inspect(mismatchId);
  assert.equal(unhealthy.State.Health.Status, 'unhealthy');
  for (const entry of unhealthy.State.Health.Log) for (const secret of [password, rootPassword, wrongPassword]) {
    assert.ok(!entry.Output.includes(secret), 'health output omits credentials');
  }
  await writeFile(join(root, '.env'), originalEnv, { mode: 0o600 });
  await rm(override);
  await ship(['up']);
  await mongo(persisted + `if(app.records.countDocuments({_id:'after-crash'})!==1)throw new Error('post-crash transaction lost');`);
  assert.deepEqual(volumeIdentity(await inspect(await idFor('mongodb'))), volumes);
  assert.equal(await keyDigest(), key);
});
