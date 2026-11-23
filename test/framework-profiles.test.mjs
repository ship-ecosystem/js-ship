import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { initProject } from '../dist/init.js';
import { loadProject } from '../dist/project.js';
import { buildCompose } from '../dist/compose.js';
import { builtinAdapters } from '../dist/adapters.js';
import { cleanOutput, prepareOutput } from '../templates/prepare-output.mjs';

async function temp(t) { const root = await mkdtemp(join(tmpdir(), 'ship-profile-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
async function put(root, path, data = 'fixture') { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), data); }
const deps = { next: 'next', nuxt: 'nuxt', sveltekit: '@sveltejs/kit', astro: 'astro', angular: '@angular/core', 'tanstack-start': '@tanstack/react-start', gatsby: 'gatsby' };
async function project(t, framework, mode, manager = 'npm', extra = {}) {
  const root = await temp(t);
  const manifest = { packageManager: `${manager}@${({ npm: '12.2.2', pnpm: '12.21.0', yarn: '4.18.1' })[manager]}`, dependencies: { [deps[framework]]: '1.0.0',
    ...(['sveltekit','tanstack-start'].includes(framework)?{vite:'7.0.0'}:{}),
    ...(framework === 'sveltekit' ? { [`@sveltejs/adapter-${mode === 'node' ? 'node' : 'static'}`]: '1.0.0' } : {}),
    ...(framework === 'astro' && mode === 'node' ? { '@astrojs/node': '1.0.0' } : {}), ...(framework === 'tanstack-start' ? { nitro: '1.0.0' } : {}) },
    scripts: { dev: framework === 'angular' ? 'ng serve' : framework === 'gatsby' ? 'gatsby develop' : ['sveltekit','tanstack-start'].includes(framework)?'vite':`${framework} dev`,
      build: framework === 'angular' ? 'ng build' : framework === 'gatsby' ? 'gatsby build' : ['sveltekit','tanstack-start'].includes(framework)?'vite build':`${framework} build`, generate: 'nuxt generate' } };
  await put(root, 'package.json', JSON.stringify(manifest));
  await put(root, ({ npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock' })[manager], manager === 'npm' ? '{}' : "lockfileVersion: '9.0'\n");
  if (manager === 'yarn') await put(root, '.yarnrc.yml', 'nodeLinker: node-modules\n');
  if (framework === 'angular') await put(root, 'angular.json', JSON.stringify({ projects: { frontend: { projectType: 'application', architect: { build: {
    builder: '@angular/build:application', options: { outputPath: 'dist/frontend', ...(mode === 'node' ? { ssr: { entry: 'src/server.ts' } } : {}) }, configurations: { production: {} } } } } } }));
  if (Object.keys(extra).length) await put(root, 'ship.json', JSON.stringify(extra));
  const cfg = await initProject(root, { deployment: mode });
  return { root, cfg, manifest };
}

test('all fourteen requested frameworks are built-ins alongside generic', () => {
  assert.equal(builtinAdapters.size, 15);
  for (const key of ['react','vue','angular','svelte','nestjs','fastify','expressjs','next','nuxt','sveltekit','astro','vitepress','tanstack-start','gatsby']) assert.ok(builtinAdapters.has(key));
});

for (const manager of ['npm', 'pnpm', 'yarn']) for (const framework of Object.keys(deps)) for (const mode of framework === 'gatsby' ? ['static'] : framework === 'tanstack-start' ? ['node'] : ['node','static']) {
  test(`${framework}/${mode}/${manager}: init, output packaging and development commands`, async t => {
    const { root, cfg } = await project(t, framework, mode, manager);
    assert.equal(cfg.framework, framework);
    assert.equal(cfg.deployment, mode);
    const model = buildCompose(cfg, root, 'production');
    assert.equal(model.services.app.volumes, undefined);
    const adapter = builtinAdapters.get(framework);
    const plan = adapter.packaging(cfg);
    const dockerfile = await readFile(join(root, 'ship/Dockerfile'), 'utf8');
    assert.ok(!/@[A-Z_]+@/.test(dockerfile));
    assert.match(dockerfile, /node ship\/prepare-output.mjs --clean/);
    assert.equal(model.services.app.command[0], mode === 'node' ? 'node' : 'nginx');
    if (mode === 'node') {
      assert.ok(dockerfile.includes('COPY --from=builder --chown=node:node /opt/ship-runtime /app'));
      assert.equal(model.services.app.command[1], plan.entrypoint);
      assert.ok(dockerfile.indexOf(manager === 'yarn' ? "'focus'" : "'prune'") < dockerfile.lastIndexOf('RUN node ship/prepare-output.mjs'));
    } else {
      assert.ok(dockerfile.includes('nginx=1.30.8-r1'));
      assert.equal(model.services.app.environment, undefined);
    }
    if (framework === 'next' && mode === 'node') assert.equal(model.services.app.environment.HOSTNAME, '0.0.0.0');
    if (['nuxt','tanstack-start'].includes(framework) && mode === 'node') assert.ok(dockerfile.includes('ENV NITRO_PRESET=node-server'));
    if (framework === 'angular' && mode === 'static') assert.match(await readFile(join(root, 'ship/nginx.conf'), 'utf8'), /index\.csr\.html/);
    assert.equal((await loadProject(root)).framework, framework);
    const dev = buildCompose(cfg, root, 'development').services.app.command;
    assert.equal(dev[0], manager);
    assert.ok(dev.includes('0.0.0.0'));
  });
}

test('Next output copies standalone server, traced dependencies, static assets and optional public files', async t => {
  const root = await temp(t), destination = join(await temp(t), 'runtime');
  await put(root, '.next/standalone/server.js'); await put(root, '.next/standalone/node_modules/dep/index.js');
  await put(root, '.next/static/chunk.js'); await put(root, 'public/logo.svg'); await put(root, '.env.production', 'SECRET=do-not-copy');
  const spec = { framework: 'next', kind: 'node', runtime: 'next', directory: '.next/standalone', entrypoint: 'server.js' };
  await prepareOutput(spec, root, destination);
  for (const file of ['server.js','node_modules/dep/index.js','.next/static/chunk.js','public/logo.svg']) assert.ok((await stat(join(destination,file))).isFile());
  await assert.rejects(stat(join(destination,'.env.production')));
  await rm(join(root,'public'),{ recursive:true }); await prepareOutput(spec,root,destination); // public/ is optional
  await rm(join(root,'.next/standalone/server.js'));
  await assert.rejects(prepareOutput(spec,root,destination), /Missing .*server.js/);
});

test('Astro static subpaths agree between development, build and Nginx routing', async t => {
  const { root, cfg } = await project(t, 'astro', 'static', 'npm', { basePath: '/guide/' });
  const command = buildCompose(cfg, root, 'development').services.app.command;
  assert.ok(command.includes('--base'), 'development must receive the configured subpath');
  assert.equal(command[command.indexOf('--base') + 1], '/guide/');
  assert.deepEqual(builtinAdapters.get('astro').buildArguments(cfg), ['--base', '/guide/']);
  assert.match(await readFile(join(root, 'ship/nginx.conf'), 'utf8'), /location \/guide\//);
});

test('Angular development authorizes loopback SSR hosts without overriding production host policy', async t => {
  for (const mode of ['node', 'static']) {
    const { root, cfg } = await project(t, 'angular', mode);
    assert.equal(buildCompose(cfg, root, 'development').services.app.environment.NG_ALLOWED_HOSTS, '${NG_ALLOWED_HOSTS:-localhost,127.0.0.1}');
    assert.equal(buildCompose(cfg, root, 'production').services.app.environment?.NG_ALLOWED_HOSTS, undefined);
  }
});

test('older process entrypoints require an explicit template refresh before startup', async t => {
  const { root } = await project(t, 'next', 'node');
  const path = join(root, 'ship/.ship-template.json');
  const metadata = JSON.parse(await readFile(path, 'utf8'));
  metadata.format = 3;
  await writeFile(path, JSON.stringify(metadata));
  await assert.rejects(loadProject(root), /ship init --force/);
  await initProject(root, { force: true });
  assert.equal((await loadProject(root)).framework, 'next');
});

test('older Next static routing requires refresh without invalidating standalone templates', async t => {
  const { root } = await project(t, 'next', 'static');
  const path = join(root, 'ship/.ship-template.json');
  const metadata = JSON.parse(await readFile(path, 'utf8'));
  delete metadata.nextStaticRouting;
  await writeFile(path, JSON.stringify(metadata));
  await assert.rejects(loadProject(root), /ship init --force/);
  await initProject(root, { force: true });
  assert.equal((await loadProject(root)).deployment, 'static');
  const standalone = await project(t, 'next', 'node');
  assert.equal((await loadProject(standalone.root)).deployment, 'node');
});

test('bundle packaging preserves production dependency symlinks and explicit worker files', async t => {
  const root = await temp(t), destination = join(await temp(t),'runtime');
  await put(root, 'build/index.js'); await put(root,'package.json','{"type":"module"}');
  await put(root,'node_modules/.pnpm/dep/index.js');
  await symlink('.pnpm/dep',join(root,'node_modules/dep'),'dir');
  await put(root,'workers/job.js'); await put(root,'src/private-source.js');
  await prepareOutput({ framework:'sveltekit',kind:'node',runtime:'bundle',directory:'build',entrypoint:'build/index.js',runtimeDependencies:true,runtimeFiles:['workers/job.js'] }, root,destination);
  assert.ok((await stat(join(destination,'node_modules/dep/index.js'))).isFile());
  assert.ok((await stat(join(destination,'workers/job.js'))).isFile());
  await assert.rejects(stat(join(destination,'src/private-source.js')));
});

test('Nitro outputs are self-contained and do not copy unrelated top-level dependencies', async t => {
  const root = await temp(t), destination = join(await temp(t),'runtime');
  await put(root,'.output/server/index.mjs'); await put(root,'.output/public/asset.js'); await put(root,'node_modules/unrelated/index.js');
  await prepareOutput({ framework:'nuxt',kind:'node',runtime:'bundle',directory:'.output',entrypoint:'.output/server/index.mjs' }, root,destination);
  assert.ok((await stat(join(destination,'.output/public/asset.js'))).isFile());
  await assert.rejects(stat(join(destination,'node_modules')));
});

test('fresh output checks prevent stale files from satisfying a different Next deployment mode', async t => {
  const root=await temp(t); await put(root,'out/index.html'); await put(root,'.next/standalone/server.js');
  const spec={ framework:'next',kind:'static',runtime:'project',directory:'out' };
  await cleanOutput(spec,root);
  await assert.rejects(prepareOutput(spec,root,join(root,'runtime')), /Missing out\/index.html/);
  await assert.rejects(stat(join(root,'.next')));
});

test('static Astro/SvelteKit packaging refuses server output instead of dropping server features', async t => {
  const root=await temp(t);
  await put(root,'dist/index.html'); await put(root,'dist/server/entry.mjs');
  await assert.rejects(prepareOutput({framework:'astro',kind:'static',directory:'dist'},root,''),/emitted a server/);
  await put(root,'build/index.html'); await put(root,'build/handler.js');
  await assert.rejects(prepareOutput({framework:'sveltekit',kind:'static',directory:'build'},root,''),/emitted a Node server/);
});

test('Angular preserves prerendered root HTML while supplying the CSR fallback', async t => {
  const root=await temp(t); await put(root,'dist/frontend/browser/index.html','prerendered'); await put(root,'dist/frontend/browser/index.csr.html','client host');
  const spec={ framework:'angular',kind:'static',directory:'dist/frontend/browser' };
  await prepareOutput(spec,root,'');
  assert.equal(await readFile(join(root,spec.directory,'index.html'),'utf8'),'prerendered');
  await rm(join(root,spec.directory,'index.html')); await prepareOutput(spec,root,'');
  assert.equal(await readFile(join(root,spec.directory,'index.html'),'utf8'),'client host');
});

test('Angular requires an explicit application when the workspace has several', async t => {
  const {root}=await project(t,'angular','static');
  const workspace=JSON.parse(await readFile(join(root,'angular.json'),'utf8')); workspace.projects.admin=workspace.projects.frontend;
  await writeFile(join(root,'angular.json'),JSON.stringify(workspace));
  await writeFile(join(root,'ship.json'),'{}');
  await assert.rejects(initProject(root), /Select an Angular application/);
  assert.equal((await initProject(root,{angularProject:'admin',force:true})).angularProject,'admin');
});

test('Angular object outputPath and deployment switches stay aligned with production settings', async t => {
  const {root}=await project(t,'angular','node');
  const workspace=JSON.parse(await readFile(join(root,'angular.json'),'utf8'));
  workspace.projects.frontend.architect.build.configurations.production.outputPath={base:'out/site',browser:'client',server:'node'};
  await writeFile(join(root,'angular.json'),JSON.stringify(workspace));
  await assert.rejects(loadProject(root),/output paths differ/);
  const node=await initProject(root,{force:true});
  assert.equal(node.serverEntry,'out/site/node/server.mjs');
  const site=await initProject(root,{deployment:'static',force:true});
  assert.equal(site.outputDirectory,'out/site/client');assert.equal(site.serverEntry,null);
  assert.ok((await readFile(join(root,'ship/Dockerfile'),'utf8')).includes('/app/out/site/client/'));
});

test('unsupported deployment modes and missing runtime adapters fail during configuration', async t => {
  await assert.rejects(project(t,'gatsby','node'),/static output only/);
  await assert.rejects(project(t,'tanstack-start','static'),/Node output/);
  const {root,manifest}=await project(t,'astro','node');
  delete manifest.dependencies['@astrojs/node'];
  await writeFile(join(root,'package.json'),JSON.stringify(manifest));
  await assert.rejects(loadProject(root),/standalone mode/);
});

test('output cleanup rejects dependency metadata directories instead of deleting them', async t => {
  const root=await temp(t);await put(root,'node_modules/keep.js');
  await assert.rejects(cleanOutput({kind:'static',framework:'astro',directory:'node_modules'},root),/collides/);
  assert.ok((await stat(join(root,'node_modules/keep.js'))).isFile());
  for (const path of ['yarn.lock', '.yarnrc.yml', '.yarn/patches/keep.patch']) {
    await put(root, path, 'preserve');
    await assert.rejects(cleanOutput({kind:'static',framework:'astro',directory:path},root),/collides/);
    assert.equal(await readFile(join(root,path), 'utf8'), 'preserve');
  }
});

test('Gatsby build proof is produced only for static routes and is mandatory for packaging', async t => {
  const root=await temp(t); await put(root,'ship/placeholder'); await put(root,'public/index.html');
  const spec={ framework:'gatsby',kind:'static',directory:'public' };
  await assert.rejects(prepareOutput(spec,root,''), /gatsby-static/);
  const context={module:{exports:{}},require:createRequire(import.meta.url),process:{cwd:()=>root}};
  runInNewContext(await readFile(new URL('../templates/gatsby-adapter.cjs',import.meta.url),'utf8'),context);
  const adapter=context.module.exports();
  await assert.rejects(adapter.adapt({routesManifest:[{type:'function'}],functionsManifest:[{}],pathPrefix:''}), /SSR, DSG/);
  await assert.rejects(adapter.adapt({routesManifest:[{type:'static',path:'/app/*'}],functionsManifest:[],pathPrefix:''}), /wildcard/);
  await adapter.adapt({routesManifest:[{type:'static'}],functionsManifest:[],pathPrefix:''});
  await prepareOutput(spec,root,'');
  await cleanOutput(spec,root); await assert.rejects(stat(join(root,'ship/.gatsby-static.json')));
});

test('Gatsby rejects an ESM root package before its CommonJS CLI subprocess fails', async t => {
  const { root, manifest } = await project(t, 'gatsby', 'static');
  manifest.type = 'module';
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
  await assert.rejects(loadProject(root), /CommonJS root package/);
  manifest.type = 'commonjs';
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
  assert.equal((await loadProject(root)).framework, 'gatsby');
});

test('Gatsby accepts built-in header rules, rejects custom rules and refreshes older templates', async t => {
  const { root } = await project(t, 'gatsby', 'static');
  const context = { module: { exports: {} }, require: createRequire(import.meta.url), process: { cwd: () => root } };
  runInNewContext(await readFile(new URL('../templates/gatsby-adapter.cjs', import.meta.url), 'utf8'), context);
  const adapter = context.module.exports();
  const input = { routesManifest: [{ type: 'static', path: '/' }, { type: 'static', path: '/app-hash.js' }], functionsManifest: [], pathPrefix: '', headerRoutes: [
    { path: '/*', headers: [{ key: 'cache-control', value: 'public, max-age=0, must-revalidate' }, { key: 'x-frame-options', value: 'DENY' }] },
    { path: '/static/*', headers: [{ key: 'cache-control', value: 'public, max-age=31536000, immutable' }] },
    { path: '/app-hash.js', headers: [{ key: 'cache-control', value: 'public, max-age=31536000, immutable' }] },
  ] };
  await adapter.adapt(input);
  for (const rule of [
    { path: '/*', headers: [{ key: 'x-custom', value: 'private-rule' }] },
    { path: '/*', headers: [{ key: 'x-frame-options', value: 'SAMEORIGIN' }] },
    { path: '/custom/*', headers: [{ key: 'cache-control', value: 'public, max-age=0, must-revalidate' }] },
  ]) await assert.rejects(adapter.adapt({ ...input, headerRoutes: [rule] }), /custom redirects\/headers/);
  const nginx = await readFile(join(root, 'ship/nginx.conf'), 'utf8');
  assert.match(nginx, /add_header X-Content-Type-Options "nosniff" always/);
  assert.match(nginx, /add_header Cache-Control "public, max-age=0, must-revalidate" always/);
  const metadata = JSON.parse(await readFile(join(root, 'ship/.ship-template.json'), 'utf8'));
  delete metadata.gatsbyStaticHeaders;
  await writeFile(join(root, 'ship/.ship-template.json'), JSON.stringify(metadata));
  await assert.rejects(loadProject(root), /ship init --force/);
  await initProject(root, { force: true });
  assert.equal((await loadProject(root)).framework, 'gatsby');
});
