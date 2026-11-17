import { test } from 'node:test';
import { exerciseFramework } from './framework-fixture.mjs';

const fixtures = {
  react: {
    dependencies: { react: '19.3.1', 'react-dom': '19.3.1' },
    devDependencies: { vite: '8.3.8', '@vitejs/plugin-react': '6.3.0' },
    plugin: "import plugin from '@vitejs/plugin-react';",
    files: { 'src/main.jsx': "import React from 'react'; import {createRoot} from 'react-dom/client'; createRoot(document.getElementById('app')).render(<h1>Ship-react-component</h1>);" },
    entry: 'src/main.jsx',
  },
  vue: {
    dependencies: { vue: '3.5.45' }, devDependencies: { vite: '8.3.8', '@vitejs/plugin-vue': '6.0.11' },
    plugin: "import plugin from '@vitejs/plugin-vue';",
    files: { 'src/main.js': "import {createApp} from 'vue'; import App from './App.vue'; createApp(App).mount('#app');", 'src/App.vue': '<template><h1>Ship-vue-component</h1></template>' },
    entry: 'src/main.js', modules: ['src/App.vue'],
  },
  svelte: {
    dependencies: { svelte: '5.57.3' }, devDependencies: { vite: '8.3.8', '@sveltejs/vite-plugin-svelte': '7.3.1' },
    plugin: "import {svelte as plugin} from '@sveltejs/vite-plugin-svelte';",
    files: { 'src/main.js': "import {mount} from 'svelte'; import App from './App.svelte'; mount(App,{target:document.getElementById('app')});", 'src/App.svelte': '<h1>Ship-svelte-component</h1>' },
    entry: 'src/main.js', modules: ['src/App.svelte'],
  },
};
for (const [framework, fixture] of Object.entries(fixtures)) test(`${framework}: real Vite component build, subpath assets and SPA routing`, { timeout: 600_000 }, async t => {
  await exerciseFramework(t, { framework, mode: 'static', base: '/app/', marker: `Ship-${framework}-component`, client: fixture.entry, modules: fixture.modules, asset: true,
    manifest: { scripts: { dev: 'vite', build: 'vite build' }, dependencies: fixture.dependencies, devDependencies: fixture.devDependencies },
    files: { ...fixture.files, 'index.html': `<!doctype html><html><body><div id="app"></div><script type="module" src="/${fixture.entry}"></script></body></html>`,
      'vite.config.js': `${fixture.plugin}\nexport default {plugins:[plugin()]};`, 'public/fixture.txt': 'framework public asset' },
    sources: ['src', 'public', 'index.html', 'vite.config.js'],
  });
});
