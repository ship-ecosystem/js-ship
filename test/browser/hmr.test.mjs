import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { run } from '../../dist/process.js';
import { readConfig } from '../../dist/config.js';
import { composePrefix } from '../../dist/project.js';
import { lockFixture, publishedPort } from '../docker/support.mjs';

const fixtures = {
  react: {
    dependencies: { react: '19.3.1', 'react-dom': '19.3.1' },
    devDependencies: { vite: '8.3.8', '@vitejs/plugin-react': '6.3.0' },
    plugin: "import plugin from '@vitejs/plugin-react';",
    heading: 'src/Heading.jsx',
    files: {
      'src/main.jsx': "import React from 'react'; import {createRoot} from 'react-dom/client'; import App from './App.jsx'; import './style.css'; createRoot(document.getElementById('app')).render(<App />);",
      'src/App.jsx': "import React,{useState} from 'react'; import Heading from './Heading.jsx'; export default function App(){const [count,setCount]=useState(0);return <><Heading /><button onClick={()=>setCount(count+1)}>Count {count}</button></>;}",
      'src/Heading.jsx': "import React from 'react'; export default function Heading(){return <h1>Before edit</h1>;}",
    }, entry: 'src/main.jsx',
  },
  vue: {
    dependencies: { vue: '3.5.45' }, devDependencies: { vite: '8.3.8', '@vitejs/plugin-vue': '6.0.11' },
    plugin: "import plugin from '@vitejs/plugin-vue';", heading: 'src/Heading.vue',
    files: {
      'src/main.js': "import {createApp} from 'vue'; import App from './App.vue'; import './style.css'; createApp(App).mount('#app');",
      'src/App.vue': '<script setup>import {ref} from "vue"; import Heading from "./Heading.vue"; const count=ref(0);</script><template><Heading /><button @click="count++">Count {{count}}</button></template>',
      'src/Heading.vue': '<template><h1>Before edit</h1></template>',
    }, entry: 'src/main.js',
  },
  svelte: {
    dependencies: { svelte: '5.57.3' }, devDependencies: { vite: '8.3.8', '@sveltejs/vite-plugin-svelte': '7.3.1' },
    plugin: "import {svelte as plugin} from '@sveltejs/vite-plugin-svelte';", heading: 'src/Heading.svelte',
    files: {
      'src/main.js': "import {mount} from 'svelte'; import App from './App.svelte'; import './style.css'; mount(App,{target:document.getElementById('app')});",
      'src/App.svelte': '<script>import Heading from "./Heading.svelte"; let count=$state(0);</script><Heading /><button onclick={()=>count++}>Count {count}</button>',
      'src/Heading.svelte': '<h1>Before edit</h1>',
    }, entry: 'src/main.js',
  },
};
async function connected(frames) {
  for (let attempt = 0; attempt < 100; attempt++) { if (frames.some(frame => frame.message.type === 'connected')) return; await delay(50); }
  throw new Error('Vite HMR WebSocket did not connect through the published URL');
}

for (const [framework, basePath] of [['react','/'],['react','/lab/'],['vue','/lab/'],['svelte','/lab/']]) {
  test(`${framework} ${basePath}: browser component/CSS HMR preserves parent state through the published port`, { timeout: 600_000 }, async t => {
    const fixture = fixtures[framework];
    const root = await mkdtemp(join(tmpdir(), 'ship-hmr-'));
    const name = `ship-hmr-${framework}-${randomBytes(4).toString('hex')}`;
    const artifacts = resolve('test-results/hmr', name);
    const cli = resolve('dist/cli.js');
    const env = { ...process.env, APP_PORT: '0' };
    const ship = args => run([process.execPath, cli, ...args], root, { env });
    let dev, browser, context, page;
    t.after(async () => {
      await browser?.close();
      if (dev) await run([...dev.prefix, 'down', '--volumes'], root, { env, capture: true }).catch(() => {});
      await run(['docker', 'image', 'rm', `${name}-app:local`], root, { capture: true }).catch(() => {});
      await rm(root, { recursive: true, force: true });
    });
    try {
      for (const [file, text] of Object.entries({ ...fixture.files,
        'index.html': `<!doctype html><html><body><div id="app"></div><script type="module" src="/${fixture.entry}"></script></body></html>`,
        'vite.config.js': `${fixture.plugin} export default {plugins:[plugin()]};`,
        'src/style.css': 'body { --ship-hmr-probe: before; }',
      })) { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), text); }
      await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', packageManager: 'npm@12.2.2',
        scripts: { dev: 'vite', build: 'vite build' }, dependencies: fixture.dependencies, devDependencies: fixture.devDependencies }));
      await lockFixture(root);
      await writeFile(join(root, 'ship.json'), JSON.stringify({ name, basePath }));
      await ship(['init', '--no-interaction']);
      const cfg = await readConfig(root);
      dev = await composePrefix(root, cfg, 'development');
      await ship(['up']);
      const port = await publishedPort(dev.prefix, root, cfg.port);
      const base = `http://127.0.0.1:${port}${basePath}`;
      browser = await chromium.launch({ headless: true, ...(process.env.SHIP_BROWSER_EXECUTABLE ? { executablePath: process.env.SHIP_BROWSER_EXECUTABLE } : {}) });
      console.log(`${framework}: Chromium ${browser.version()}, ${base}`);
      context = await browser.newContext();
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      page = await context.newPage();
      const errors = [], frames = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => socket.on('framereceived', event => {
        try { frames.push({ url: socket.url(), message: JSON.parse(String(event.payload)) }); } catch { /* non-JSON control frame */ }
      }));
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Before edit', exact: true }).waitFor();
      await connected(frames);
      await page.getByRole('button', { name: 'Count 0', exact: true }).click();
      await page.getByRole('button', { name: 'Count 1', exact: true }).waitFor();
      const token = randomBytes(16).toString('hex');
      await page.evaluate(value => { window.__shipDocumentToken = value; }, token);
      await writeFile(join(root, fixture.heading), fixture.files[fixture.heading].replace('Before edit', 'After edit'));
      await page.getByRole('heading', { name: 'After edit', exact: true }).waitFor();
      assert.equal(await page.getByRole('button').textContent(), 'Count 1');
      assert.equal(await page.evaluate(() => window.__shipDocumentToken), token, 'component edit must not reload the document');
      await writeFile(join(root, 'src/style.css'), 'body { --ship-hmr-probe: after; }');
      await page.waitForFunction(() => getComputedStyle(document.body).getPropertyValue('--ship-hmr-probe').trim() === 'after');
      assert.equal(await page.evaluate(() => window.__shipDocumentToken), token, 'CSS edit must not reload the document');
      assert.equal(await page.getByRole('button').textContent(), 'Count 1');
      assert.ok(frames.some(frame => frame.message.type === 'update' && Number(new URL(frame.url).port) === port), 'HMR updates arrive on the actual published port');
      assert.deepEqual(errors, []);
      await context.tracing.stop();
    } catch (error) {
      if (context) {
        await mkdir(artifacts, { recursive: true });
        await page?.screenshot({ path: join(artifacts, 'page.png'), fullPage: true }).catch(() => {});
        await context.tracing.stop({ path: join(artifacts, 'trace.zip') }).catch(() => {});
        console.error(`Browser failure artifacts: ${artifacts}`);
      }
      if (dev) await run([...dev.prefix, 'logs', '--tail', '40'], root, { env }).catch(() => {});
      throw error;
    }
  });
}
