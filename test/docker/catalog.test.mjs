import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { builtinServices } from '../../dist/services.js';
import { initProject } from '../../dist/init.js';
import { buildProjectCompose, render } from '../../dist/compose.js';
import { run } from '../../dist/process.js';

// Existing dedicated suites cover PostgreSQL/Redis/MongoDB and app integration.
const providers = [...builtinServices.values()].filter(s => !['postgres', 'redis', 'mongodb', 'playwright', 'cypress'].includes(s.key));
for (const provider of providers) test(`portable service ${provider.key}: actual container readiness`, { timeout: 900_000 }, async t => {
 const root = await mkdtemp(join(tmpdir(), 'ship-js-catalog-'));
 const name = `ship-js-catalog-${randomBytes(5).toString('hex')}`;
 let prefix, owned = [];
 t.after(async () => {
  if (prefix) await run([...prefix, 'down', '--volumes', '--remove-orphans', '--timeout', '10'], root).catch(() => {});
  for (const image of owned) await run(['docker', 'image', 'rm', image], root).catch(() => {});
  await rm(root, { recursive: true, force: true });
 });
 await cp(resolve('examples/node'), root, { recursive: true });
 await writeFile(join(root, 'ship.json'), JSON.stringify({ name, services: { [provider.group]: provider.key, ...(provider.key === 'bull-board' ? { cache: 'redis' } : {}) } }));
 const cfg = await initProject(root);
 const model = await buildProjectCompose(cfg, root, 'development');
 delete model.services.app;
 for (const service of Object.values(model.services)) {
  if (service.build) owned.push(service.image);
  // Test-only escape hatch for shared developer disks above Elasticsearch's high watermark. Never changes generated production settings.
  if (provider.key === "elasticsearch" && process.env.SHIP_TEST_LOW_DISK_ELASTIC === "1") service.environment["cluster.routing.allocation.disk.threshold_enabled"] = "false";
  if (service.ports) service.ports = service.ports.map(value => `127.0.0.1::${String(value).split(':').at(-1)}`);
 }
 const path = join(root, 'compose.json');
 await writeFile(path, render(model));
 prefix = ['docker', 'compose', '--project-directory', root, '-f', path];
 try { await run([...prefix, 'up', '--build', '-d', '--wait', '--wait-timeout', '180'], root, { timeoutMs: 840_000 }); } catch (error) { const logs = await run([...prefix, 'logs', '--tail', '35'], root, { capture: true }).catch(() => ''); throw new Error(`${error.message}\n${logs}`); }
 const rows = await run([...prefix, 'ps', '--format', 'json'], root, { capture: true });
 assert.match(rows, /running/);
 if (provider.key === 'selenium') await run([...prefix, 'exec', '-T', provider.key, 'python3', '-c', `import json,urllib.request
base='http://127.0.0.1:4444'
def request(path, method='GET', value=None):
 data=None if value is None else json.dumps(value).encode()
 req=urllib.request.Request(base+path,data=data,method=method,headers={'Content-Type':'application/json'})
 return json.load(urllib.request.urlopen(req,timeout=30))['value']
session=request('/session','POST',{'capabilities':{'alwaysMatch':{'browserName':'chrome','goog:chromeOptions':{'args':['--headless=new','--no-sandbox','--disable-dev-shm-usage']}}}})['sessionId']
try:
 request('/session/'+session+'/url','POST',{'url':'data:text/html,<title>Ship WebDriver</title>'})
 assert request('/session/'+session+'/title')=='Ship WebDriver'
finally: request('/session/'+session,'DELETE')
`], root);

 if (provider.key === 'mysql') await run([...prefix, 'exec', '-T', provider.key, 'sh', '-c', 'exec mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "SELECT 1"'], root);
 if (provider.key === 'mariadb') await run([...prefix, 'exec', '-T', provider.key, 'sh', '-c', 'exec mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" -e "SELECT 1"'], root);
});
