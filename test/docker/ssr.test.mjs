import { test } from 'node:test';
import { exerciseFramework } from './framework-fixture.mjs';

for (const framework of ['astro', 'sveltekit', 'nuxt']) for (const mode of ['node', 'static']) test(`${framework} ${mode}: real build, HTTP and public assets without host sources`, { timeout: 900_000 }, async t => {
  const marker = `Ship-${framework}-${mode}`;
  let manifest, files, sources;
  if (framework === 'astro') {
    manifest = { scripts: { dev: 'astro dev', build: 'astro build' }, dependencies: { astro: '7.4.12', ...(mode === 'node' ? { '@astrojs/node': '11.1.13' } : {}) } };
    files = { 'astro.config.mjs': mode === 'node'
      ? "import {defineConfig} from 'astro/config'; import node from '@astrojs/node'; export default defineConfig({output:'server',adapter:node({mode:'standalone'})});"
      : "import {defineConfig} from 'astro/config'; export default defineConfig({});",
      'src/pages/index.astro': `<!doctype html><html><body><h1>${marker}</h1></body></html>`,
      'public/fixture.txt': 'framework public asset',
      ...(mode === 'node' ? { 'src/pages/api/probe.js': "export function GET({url}) {return Response.json({value:url.searchParams.get('value'),runtime:process.env.SHIP_FIXTURE_RUNTIME});}" } : {}) };
    sources = ['src', 'public', 'astro.config.mjs'];
  } else if (framework === 'sveltekit') {
    manifest = { scripts: { dev: 'vite dev', build: 'vite build' },
      devDependencies: { '@sveltejs/kit': '3.2.0', svelte: '5.57.3', vite: '8.3.8', '@sveltejs/vite-plugin-svelte': '7.3.1',
        [mode === 'node' ? '@sveltejs/adapter-node' : '@sveltejs/adapter-static']: mode === 'node' ? '6.0.2' : '4.0.1' } };
    files = { 'vite.config.js': `import {sveltekit} from '@sveltejs/kit/vite'; import adapter from '@sveltejs/adapter-${mode === 'node' ? 'node' : 'static'}'; export default {plugins:[sveltekit({adapter:adapter()})]};`,
      'src/app.html': '<!doctype html><html lang="en"><head><meta charset="utf-8">%sveltekit.head%</head><body><div style="display:contents">%sveltekit.body%</div></body></html>',
      'src/routes/+page.svelte': `<h1>${marker}</h1>`,
      'static/fixture.txt': 'framework public asset',
      ...(mode === 'static' ? { 'src/routes/+layout.js': 'export const prerender=true;' }
        : { 'src/routes/api/probe/+server.js': "export function GET({url}) {return Response.json({value:url.searchParams.get('value'),runtime:process.env.SHIP_FIXTURE_RUNTIME});}" }) };
    sources = ['src', 'static', 'vite.config.js'];
  } else {
    manifest = { scripts: { dev: 'nuxt dev', build: 'nuxt build', generate: 'nuxt generate' }, dependencies: { nuxt: '4.6.4' } };
    files = { 'nuxt.config.ts': 'export default defineNuxtConfig({devtools:{enabled:false}});',
      'app/app.vue': `<template><h1>${marker}</h1></template>`, 'public/fixture.txt': 'framework public asset',
      ...(mode === 'node' ? { 'server/api/probe.get.js': "export default defineEventHandler(event=>({value:getQuery(event).value,runtime:process.env.SHIP_FIXTURE_RUNTIME}));" } : {}) };
    sources = ['app', 'public', 'server', 'nuxt.config.ts'];
  }
  await exerciseFramework(t, { framework, mode, marker, manifest, files, sources, asset: true, probe: mode === 'node',
    // npm 12.2.2 rejects Nuxt's bundled watcher registry tarball (EALLOWREMOTE).
    // Exercise a supported explicit pin without relaxing npm's install policy.
    ...(framework === 'nuxt' ? { npmVersion: '11.20.0' } : {}),
    ...(framework === 'astro' && mode === 'static' ? { base: '/guide/' } : {}) });
});
