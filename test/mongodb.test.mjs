import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { parseConfig } from '../dist/config.js';
import { buildCompose } from '../dist/compose.js';
import { initProject } from '../dist/init.js';
import { assembleRelease } from '../dist/release.js';
import { productionProblems } from '../dist/production.js';
import { applicationEnvironment } from '../templates/app-entrypoint.mjs';

test('MongoDB uses authenticated health, persistent key/data volumes and no published ports', () => {
  for(const mode of ['standalone','replica-set']) {
    const cfg=parseConfig({services:{database:'mongodb'},mongodbMode:mode,serviceNames:{mongodb:'documents'},additionalServices:[{group:'database',service:'mongodb',name:'analytics'}]},'/tmp/project');
    const model=buildCompose(cfg,'/tmp/project','production','v1');
    assert.equal(model.services.documents.ports,undefined);
    assert.equal(model.services.documents.environment.SHIP_MONGO_HOST,'documents');
    assert.equal(model.services.documents.environment.SHIP_MONGO_MODE,mode);
    assert.equal(model.services.app.environment.MONGODB_ROOT_PASSWORD,'');
    assert.equal(model.services.app.environment.MONGODB_HOST,'documents');
    assert.equal(model.services.app.environment.ANALYTICS_MONGODB_HOST,'mongodb-analytics');
    assert.deepEqual(model.services.documents.volumes,['mongodb_data:/data/db','mongodb_config:/data/configdb']);
    assert.ok(model.volumes['mongodb-analytics_config']);
    assert.equal(model.services.documents.image,model.services['mongodb-analytics'].image);
    assert.ok(model.services.documents.healthcheck.test.includes('/usr/local/share/ship-mongo-health.js'));
  }
});

test('runtime MongoDB URIs encode credentials and preserve named instance/auth/replica settings', () => {
  const password="p:@/?#[]!$&'()+=%";
  const env=applicationEnvironment({MONGODB_HOST:'documents',MONGODB_PORT:'27017',MONGODB_USER:'user@name',MONGODB_PASSWORD:password,MONGODB_DATABASE:'my-app',MONGODB_REPLICA_SET:'rs0',MONGODB_ROOT_PASSWORD:'must-not-leak',
    ANALYTICS_MONGODB_HOST:'analytics',ANALYTICS_MONGODB_USER:'reader',ANALYTICS_MONGODB_PASSWORD:'another:value',ANALYTICS_MONGODB_DATABASE:'analytics',ANALYTICS_MONGODB_ROOT_PASSWORD:'also-private'});
  const uri=new URL(env.MONGODB_URI);
  assert.equal(decodeURIComponent(uri.username),'user@name'); assert.equal(decodeURIComponent(uri.password),password);
  assert.equal(uri.searchParams.get('authSource'),'my-app'); assert.equal(uri.searchParams.get('replicaSet'),'rs0');
  assert.equal(env.MONGODB_ROOT_PASSWORD,undefined); assert.equal(env.ANALYTICS_MONGODB_ROOT_PASSWORD,undefined);
  assert.equal(new URL(env.ANALYTICS_MONGODB_URI).searchParams.has('replicaSet'),false);
  assert.deepEqual(applicationEnvironment({MONGODB_URI:'mongodb+srv://external.example/db'}),{MONGODB_URI:'mongodb+srv://external.example/db'});
  assert.throws(()=>applicationEnvironment({MONGODB_HOST:'documents'}),/incomplete/);
});

test('MongoDB release builds each unique owned image once and exports named instances together', async t => {
  const root=await mkdtemp(join(tmpdir(),'ship-mongo-release-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await cp(resolve('examples/node'),root,{recursive:true});
  await writeFile(join(root,'ship.json'),JSON.stringify({services:{database:'mongodb'},additionalServices:[{group:'database',service:'mongodb',name:'analytics'}]}));
  const cfg=await initProject(root);
  const model=buildCompose(cfg,root,'production','v1');
  await writeFile(join(root,'.env.production'),'MONGODB_PASSWORD=shipsecret\nMONGODB_ROOT_PASSWORD=shiprootsecret\n');
  assert.equal((await productionProblems(model,root)).length,4);
  await writeFile(join(root,'.env.production'),'MONGODB_PASSWORD=app-unique\nMONGODB_ROOT_PASSWORD=root-unique\nANALYTICS_MONGODB_PASSWORD=analytics-unique\nANALYTICS_MONGODB_ROOT_PASSWORD=analytics-root-unique\n');
  const calls=[];
  const output=await assembleRelease(root,cfg,'v1',async args=>{calls.push(args);if(args[1]==='save')await writeFile(args[3],'archive');return '';});
  const build=calls.find(args=>args.includes('build'));
  assert.deepEqual(build.slice(build.indexOf('--pull')+1),['mongodb','app']);
  assert.ok(!calls.some(args=>args.includes('pull')));
  const manifest=JSON.parse(await readFile(join(output,'release.json'),'utf8'));
  assert.equal(manifest.images.length,2);
  assert.deepEqual(manifest.images.find(image=>image.services.includes('mongodb')).services,['mongodb','mongodb-analytics']);
  const compose=await readFile(join(output,'docker-compose.yml'),'utf8');
  assert.ok(!compose.includes('"build"'));
  assert.ok(!compose.includes(root));
});

async function bootstrap(runCommand, auth=true) {
  const calls=[];let code;
  const admin={auth:()=>auth,runCommand(command){calls.push(command);return runCommand(command);}};
  runInNewContext(await readFile(new URL('../templates/mongodb/bootstrap.js',import.meta.url),'utf8'),{
    Mongo:function(){return{getDB:()=>admin}},process:{env:{SHIP_MONGO_HOST:'renamed-db'}},quit:value=>{code=value;}
  });
  return {code,calls};
}
test('replica initialization handles mongosh exceptions and does not initialize the temporary standalone server',async()=>{
  const fresh=await bootstrap(command=>{if(command.replSetGetConfig)throw{code:94,codeName:'NotYetInitialized'};return{ok:1};});
  assert.equal(fresh.code,0);assert.equal(fresh.calls[1].replSetInitiate.members[0].host,'renamed-db:27017');
  const temporary=await bootstrap(()=>{throw{codeName:'NoReplicationEnabled'};});
  assert.equal(temporary.code,1);assert.equal(temporary.calls.length,1);
  const rejected=await bootstrap(()=>({ok:1}),{ok:0});assert.equal(rejected.code,1);assert.equal(rejected.calls.length,0);
});

test('initial MongoDB application users receive only readWrite on their own database',async()=>{
  const source=await readFile(new URL('../templates/mongodb/app-user.js',import.meta.url),'utf8');let created;
  const context={process:{env:{MONGO_INITDB_DATABASE:'app',SHIP_MONGO_USER:'application',SHIP_MONGO_PASSWORD:'private-app-password'}},db:{getSiblingDB:()=>({createUser:user=>{created=user;}})}};
  runInNewContext(source,context);
  assert.equal(created.roles.length,1);assert.equal(created.roles[0].role,'readWrite');assert.equal(created.roles[0].db,'app');
  context.process.env.MONGO_INITDB_DATABASE='admin';
  assert.throws(()=>runInNewContext(source,{...context}),/application MongoDB database/);
});
test('replica renaming reconfigures only a known single-member set and refuses multi-member configurations',async()=>{
  const renamed=await bootstrap(command=>command.replSetGetConfig?{ok:1,config:{_id:'rs0',version:3,members:[{_id:0,host:'old-db:27017'}]}}:{ok:1});
  assert.equal(renamed.code,0);assert.equal(renamed.calls[1].force,true);assert.equal(renamed.calls[1].replSetReconfig.version,4);
  const multiple=await bootstrap(()=>({ok:1,config:{_id:'rs0',version:3,members:[{host:'one:27017'},{host:'two:27017'}]}}));
  assert.equal(multiple.code,1);assert.equal(multiple.calls.length,1);
});
test('MongoDB readiness requires final authentication, application credentials and an elected primary',async()=>{
  const code=await readFile(new URL('../templates/mongodb/health.js',import.meta.url),'utf8');
  for(const [auth,primary,expected]of[[false,true,1],[true,false,1],[true,true,0]]){
    let exit;
    const admin={auth:()=>true,runCommand:()=>({parsed:{security:{authorization:auth?'enabled':undefined}}})};
    const app={auth:()=>true,runCommand:()=>({ok:1}),adminCommand:()=>({isWritablePrimary:primary})};
    runInNewContext(code,{Mongo:function(){return{getDB:name=>name==='admin'?admin:app}},process:{env:{SHIP_MONGO_MODE:'replica-set',MONGO_INITDB_DATABASE:'ship'}},quit:value=>{exit=value;}});
    assert.equal(exit,expected);
  }
});
