import { cp, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { run } from '../dist/process.js';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'local';
if (!['local', 'create', 'verify'].includes(mode) || (mode !== 'local' && !process.argv[3])) throw new Error('Usage: check-release-transfer.mjs local | create OUTPUT_DIRECTORY | verify RELEASE_DIRECTORY');
async function create(output) {
  // Refuse an existing destination rather than replace any user files.
  await mkdir(output);
  const root = await mkdtemp(join(tmpdir(), 'ship-transfer-source-'));
  const name = `ship-transfer-${randomBytes(5).toString('hex')}`;
  const probe = randomBytes(16).toString('hex');
  const cli = join(repository, 'dist/cli.js');
  try {
    await cp(join(repository, 'examples/node'), root, { recursive: true });
    await writeFile(join(root, 'ship.json'), JSON.stringify({ name, publishPorts: true }));
    await writeFile(join(root, 'server.mjs'), "import {createServer} from 'node:http'; const server=createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({message:'Ship transfer verified',environment:process.env.NODE_ENV,probe:process.env.SHIP_TRANSFER_PROBE}));});server.listen(Number(process.env.PORT),'0.0.0.0');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));\n");
    await writeFile(join(root, '.env.production'), `SHIP_TRANSFER_PROBE=${probe}\n`, { mode: 0o600 });
    await run([process.execPath, cli, 'init', '--no-interaction'], root);
    await run([process.execPath, cli, 'release', '--tag', 'transfer'], root);
    await cp(join(root, 'dist/ship/transfer'), output, { recursive: true });
    await writeFile(join(output, 'transfer-proof.json'), JSON.stringify({ project: name, probe }));
    await copyFile(join(repository, 'scripts/verify-release-artifact.mjs'), join(output, 'verify-release-artifact.mjs'));
    console.log(`Fixture release prepared at ${output}; its .env contains only a generated test probe.`);
  } catch (error) { await rm(output, { recursive: true, force: true }); throw error; }
  finally {
    await run(['docker', 'image', 'rm', `${name}-app:transfer`], repository, { capture: true }).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}
if (mode === 'create') await create(resolve(process.argv[3]));
else if (mode === 'verify') await run([process.execPath, join(repository, 'scripts/verify-release-artifact.mjs'), resolve(process.argv[3])], repository);
else {
  const parent = await mkdtemp(join(tmpdir(), 'ship-transfer-local-'));
  try {
    const output = join(parent, 'release');
    await create(output);
    await run([process.execPath, join(output, 'verify-release-artifact.mjs')], output);
  } finally { await rm(parent, { recursive: true, force: true }); }
}
