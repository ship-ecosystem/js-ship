import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function exists(path) { try { await stat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
const safe = value => typeof value === 'string' && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value) && !value.split('/').some(p => p === '.' || p === '..');
function validate(spec) {
  for (const value of [spec.directory, spec.entrypoint, ...(spec.runtimeFiles ?? [])].filter(v => v != null)) if (!safe(value)) throw new Error('Invalid output packaging path.');
  if (spec.directory && ['ship', 'node_modules', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', '.yarn', '.yarnrc.yml'].includes(spec.directory.split('/')[0])) throw new Error('Output directory collides with Ship/dependency metadata.');
}
export async function cleanOutput(spec, root) {
  validate(spec);
  if (spec.runtime === 'project' && spec.kind === 'node') return;
  await rm(join(root, spec.framework === 'next' ? '.next' : spec.directory), { recursive: true, force: true });
  if (spec.framework === 'next') await rm(join(root, spec.directory), { recursive: true, force: true });
  if (spec.framework === 'gatsby') await rm(join(root, 'ship/.gatsby-static.json'), { force: true });
}
export async function prepareOutput(spec, root, destination) {
  validate(spec);
  const required = async path => { if (!(await exists(join(root, path)))) throw new Error(`Missing ${path}; configure the ${spec.framework} ${spec.kind} deployment adapter/output and rebuild.`); };
  if (spec.kind === 'static') {
    if (spec.framework === 'astro' && await exists(join(root, spec.directory, 'server/entry.mjs'))) throw new Error('Astro emitted a server; choose node deployment for on-demand rendering/server islands.');
    if (spec.framework === 'sveltekit' && await exists(join(root, spec.directory, 'handler.js'))) throw new Error('SvelteKit emitted a Node server; configure adapter-static.');
    if (spec.framework === 'gatsby') {
      await required('ship/.gatsby-static.json');
      const report = JSON.parse(await readFile(join(root, 'ship/.gatsby-static.json'), 'utf8'));
      if (report.static !== true || report.pathPrefix) throw new Error('Configure the generated Gatsby static adapter, with no pathPrefix. SSR/DSG/functions are unsupported.');
    }
    if (spec.framework === 'angular') {
      const index = join(root, spec.directory, 'index.html'), csr = join(root, spec.directory, 'index.csr.html');
      if (!(await exists(index)) && await exists(csr)) await cp(csr, index);
      if (!(await exists(csr)) && await exists(index)) await cp(index, csr);
    }
    await required(`${spec.directory}/index.html`);
    return;
  }
  if (spec.runtime === 'project') return;
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const copy = async (source, target = source) => {
    await required(source); await mkdir(dirname(join(destination, target)), { recursive: true });
    await cp(join(root, source), join(destination, target), { recursive: true, verbatimSymlinks: true });
  };
  if (spec.runtime === 'next') {
    await required(`${spec.directory}/server.js`);
    await copy(spec.directory, '.');
    await copy('.next/static', '.next/static');
    if (await exists(join(root, 'public'))) await copy('public');
  } else {
    await required(spec.entrypoint);
    await copy(spec.directory);
    if (spec.runtimeDependencies) {
      await copy('package.json');
      if (await exists(join(root, 'node_modules'))) await copy('node_modules');
    }
  }
  for (const file of spec.runtimeFiles ?? []) await copy(file);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = process.cwd();
    const spec = JSON.parse(await readFile(new URL('./output.json', import.meta.url), 'utf8'));
    if (process.argv[2] === '--clean') await cleanOutput(spec, root);
    else await prepareOutput(spec, root, '/opt/ship-runtime');
  } catch (error) { console.error(`ship: ${error.message}`); process.exitCode = 1; }
}
