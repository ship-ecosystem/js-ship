import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
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
