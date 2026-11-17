import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { run } from '../../dist/process.js';
import { readConfig } from '../../dist/config.js';
import { composePrefix } from '../../dist/project.js';
import { publishedPort, waitForResponse } from './support.mjs';

async function until(check, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await delay(200); }
  throw new Error(`Timed out: ${label}`);
}

for (const { form, drain } of [{ form: 'argv', drain: 250 }, { form: 'shell', drain: 250 }, { form: 'shell', drain: 12_000 }]) test(`${form} (${drain}ms drain): worker crash restart, manual restart and graceful process-tree shutdown`, { timeout: 600_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ship-lifecycle-'));
  const name = `ship-life-${randomBytes(5).toString('hex')}`;
  const env = { ...process.env, APP_PORT: '0' };
  const cli = resolve('dist/cli.js');
  const ship = args => run([process.execPath, cli, ...args], root, { env });
  let cfg, prod;
  t.after(async () => {
    if (prod) await run([...prod.prefix, 'down', '--volumes', '--timeout', '3'], root, { env, capture: true }).catch(() => {});
    await run(['docker', 'image', 'rm', `${name}-app:local`], root, { capture: true }).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', packageManager: 'npm@12.2.2', scripts: { dev: 'node --watch server.mjs', start: 'node server.mjs' } }));
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, requires: true, packages: { '': {} } }));
  await writeFile(join(root, 'ship.json'), JSON.stringify({ name, publishPorts: true, processes: { worker: form === 'argv' ? ['node', 'worker.mjs'] : 'node worker.mjs' } }));
  await writeFile(join(root, 'server.mjs'), `import {createServer} from 'node:http'; const server=createServer((req,res)=>res.end('lifecycle ready')); server.listen(Number(process.env.PORT),'0.0.0.0'); let stopping=false; process.on('SIGTERM',()=>{if(stopping)return; stopping=true; console.log(JSON.stringify({event:'app-signal'})); server.close(()=>setTimeout(()=>{console.log(JSON.stringify({event:'app-stopped'}));process.exit(0);},${drain}));});`);
  await writeFile(join(root, 'worker.mjs'), `import {spawn} from 'node:child_process'; import {randomUUID} from 'node:crypto'; const instance=randomUUID(); const log=event=>console.log(JSON.stringify({event,instance,pid:process.pid})); const child=spawn(process.execPath,['child.mjs',instance],{stdio:'inherit'}); log('worker-started'); let stopping=false; process.on('SIGTERM',()=>{if(stopping)return;stopping=true;log('worker-signal');child.once('exit',()=>{log('worker-stopped');process.exit(0);});});`);
  await writeFile(join(root, 'child.mjs'), `const instance=process.argv[2]; const log=event=>console.log(JSON.stringify({event,instance,pid:process.pid})); const timer=setInterval(()=>{},1000); log('child-started'); let stopping=false; process.on('SIGTERM',()=>{if(stopping)return;stopping=true;log('child-signal');clearInterval(timer);setTimeout(()=>{log('child-stopped');process.exit(0);},${drain});});`);
  try {
    await ship(['init', '--no-interaction']); cfg = await readConfig(root);
    await writeFile(join(root, '.env.production'), '');
    await ship(['build']);
    for (const file of ['server.mjs', 'worker.mjs', 'child.mjs']) await rm(join(root, file));
    prod = await composePrefix(root, cfg, 'production');
    await run([...prod.prefix, 'up', '-d', '--no-build', '--wait'], root, { env });
    const base = `http://127.0.0.1:${await publishedPort(prod.prefix, root, 3000)}`;
    await waitForResponse(base);
    const appId = (await run([...prod.prefix, 'ps', '-q', 'app'], root, { env, capture: true })).trim();
    // Interactive execs must keep their controlling terminal for shells/job control.
    await run(['docker', 'exec', '-t', appId, 'node', '/usr/local/bin/ship-app-entrypoint.mjs', 'node', '-e',
      "if(!process.stdin.isTTY)process.exit(2); require('node:fs').closeSync(require('node:fs').openSync('/dev/tty','r')); console.log('controlling terminal retained');"], root, { capture: true }).catch(error => { console.error(error.stdout); throw error; });
    const id = (await run([...prod.prefix, 'ps', '-q', 'worker'], root, { env, capture: true })).trim();
    const state = async () => JSON.parse(await run(['docker', 'inspect', id], root, { capture: true }))[0];
    const events = async service => {
      const text = await run([...prod.prefix, 'logs', '--no-log-prefix', '--no-color', service], root, { env, capture: true });
      return text.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    };
    const ready = async excluded => {
      const records = await events('worker');
      return records.find(record => record.event === 'worker-started' && !excluded.includes(record.instance) && records.some(child => child.event === 'child-started' && child.instance === record.instance));
    };
    const first = await until(() => ready([]), 'worker and child readiness');
    await run([...prod.prefix, 'exec', '-T', 'worker', 'node', '-e', 'if(process.getuid()===0)process.exit(1)'], root, { env });
    // Crash only this fixture's main worker process; leave Docker's restart policy active.
    await run([...prod.prefix, 'exec', '-T', 'worker', 'node', '-e', `process.kill(${Number(first.pid)},'SIGKILL')`], root, { env });
    const second = await until(() => ready([first.instance]), 'automatic restart after a worker crash');
    assert.ok((await state()).RestartCount >= 1);
    await run([...prod.prefix, 'stop', ...(drain > 1000 ? [] : ['--timeout', '5']), 'worker'], root, { env });
    const stopped = await state();
    assert.equal(stopped.State.Running, false);
    assert.notEqual(stopped.State.ExitCode, 137, 'worker must drain rather than hit Docker SIGKILL');
    const drained = await events('worker');
    for (const event of ['worker-signal', 'child-signal', 'child-stopped', 'worker-stopped']) assert.ok(drained.some(row => row.event === event && row.instance === second.instance), `${form}: ${event} recorded before stop returned`);
    const restarts = stopped.RestartCount;
    await delay(1000);
    assert.equal((await state()).RestartCount, restarts, 'manual stop must remain stopped');
    assert.equal((await state()).State.Running, false);
    await run([...prod.prefix, 'up', '-d', '--no-build', '--wait', 'worker'], root, { env });
    const third = await until(() => ready([first.instance, second.instance]), 'explicit restart of a stopped worker');
    assert.ok(third.instance);
    await run([...prod.prefix, 'stop', ...(drain > 1000 ? [] : ['--timeout', '5']), 'worker', 'app'], root, { env });
    assert.ok((await events('worker')).some(row => row.event === 'child-stopped' && row.instance === third.instance));
    assert.ok((await events('app')).some(row => row.event === 'app-stopped'), 'npm-launched application finishes its shutdown handler');
  } catch (error) {
    if (prod) await run([...prod.prefix, 'logs', '--tail', '50'], root, { env }).catch(() => {});
    throw error;
  }
});
