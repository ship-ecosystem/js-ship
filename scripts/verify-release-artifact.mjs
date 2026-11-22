// Deliberately standalone: the consuming runner needs only this artifact, Node and Docker.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(process.argv[2] ?? '.');
const env = { ...process.env, APP_PORT: '0' };
function run(args, capture = false) {
  const result = spawnSync(args[0], args.slice(1), { cwd: root, env, encoding: 'utf8', stdio: capture ? ['ignore','pipe','pipe'] : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Release verification command failed: ${args.slice(0, 3).join(' ')}\n${result.stderr ?? ''}\n${result.stdout ?? ''}`);
  return result.stdout;
}
const proof = JSON.parse(await readFile(join(root, 'transfer-proof.json'), 'utf8'));
assert.match(proof.project, /^ship-transfer-[a-f0-9]{10}$/);
const model = JSON.parse((await readFile(join(root, 'docker-compose.yml'), 'utf8')).replace(/^#[^\n]*\n/, ''));
assert.equal(model.name, `${proof.project}-production`);
assert.deepEqual(Object.keys(model.services), ['app']);
assert.equal(model.services.app.build, undefined);
assert.equal(model.services.app.volumes, undefined);
const manifest = JSON.parse(await readFile(join(root, 'release.json'), 'utf8'));
assert.equal(manifest.tag, 'transfer');
assert.equal(manifest.images.length, 1);
const entry = manifest.images[0];
assert.equal(entry.ref, `${proof.project}-app:transfer`);
assert.equal(model.services.app.image, entry.ref);
assert.equal(entry.file, 'images/app.tar');
assert.deepEqual(entry.services, ['app']);
assert.match(entry.sha256, /^[a-f0-9]{64}$/);
const hash = createHash('sha256');
for await (const bytes of createReadStream(join(root, entry.file))) hash.update(bytes);
assert.equal(hash.digest('hex'), entry.sha256, 'image archive checksum');
const previous = spawnSync('docker', ['image', 'inspect', entry.ref], { encoding: 'utf8' });
if (previous.error) throw previous.error;
assert.notEqual(previous.status, 0, 'destination must not already contain the fixture image');
const prefix = ['docker', 'compose', '--project-directory', root, '-f', join(root, 'docker-compose.yml')];
let loaded = false, started = false;
try {
  run(['docker', 'load', '-i', join(root, entry.file)]); loaded = true;
  started = true;
  run([...prefix, 'up', '-d', '--no-build', '--pull', 'never', '--wait']);
  const port = Number(run([...prefix, 'port', 'app', '3000'], true).trim().split(/\r?\n/)[0].split(':').at(-1));
  let response;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1500) }); if (response.status === 200) break; await response.body?.cancel(); }
    catch { /* allow the application to start after Compose has started the container */ }
    await delay(250);
  }
  assert.equal(response?.status, 200);
  assert.deepEqual(await response.json(), { message: 'Ship transfer verified', environment: 'production', probe: proof.probe });
  run([...prefix, 'exec', '-T', 'app', 'node', '-e', 'if(process.getuid()===0)process.exit(1)']);
  console.log('Transferred release verified without a build, registry pull, SDK installation or source checkout.');
} finally {
  if (started) { try { run([...prefix, 'down', '--volumes', '--timeout', '5']); } catch {} }
  if (loaded) { try { run(['docker', 'image', 'rm', entry.ref]); } catch {} }
}
