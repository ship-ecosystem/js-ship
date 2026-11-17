import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { exerciseFramework } from './framework-fixture.mjs';
import { waitForResponse } from './support.mjs';

test('Gatsby: static adapter builds HTML/assets, serves without Node/sources and rejects SSR', { timeout: 900_000 }, async t => {
  const files = {
    'gatsby-config.mjs': "import shipStatic from './ship/gatsby-adapter.cjs'; process.env.GATSBY_CPU_COUNT='2'; export default {adapter:shipStatic(),trailingSlash:'always'};",
    'src/pages/index.jsx': "import React from 'react'; export default function Page(){return <h1>Ship-Gatsby-static</h1>;}",
    'static/fixture.txt': 'framework public asset',
  };
  await exerciseFramework(t, {
    framework: 'gatsby', mode: 'static', marker: 'Ship-Gatsby-static', asset: true, scripts: true,
    manifest: { type: 'commonjs', scripts: { dev: 'gatsby develop', build: 'gatsby build' },
      dependencies: { gatsby: '5.16.1', react: '18.3.1', 'react-dom': '18.3.1' },
      allowScripts: { 'sharp@0.32.6': true } },
    files, sources: ['src', 'static', '.cache', 'gatsby-config.mjs'],
    async devCheck(base) {
      await waitForResponse(new URL('page-data/index/page-data.json', base), async response => {
        if (response.status !== 200) return false;
        return (await response.json()).componentChunkName.includes('src-pages-index');
      });
    },
    async afterProduction({root, ship, base}) {
      const headers = (await fetch(base)).headers;
      assert.equal(headers.get('x-content-type-options'), 'nosniff');
      assert.equal(headers.get('x-frame-options'), 'DENY');
      assert.equal(headers.get('referrer-policy'), 'same-origin');
      assert.equal(headers.get('x-xss-protection'), '1; mode=block');
      assert.equal(headers.get('cache-control'), 'public, max-age=0, must-revalidate');
      // Restore the fixture and introduce a real SSR page. The static adapter
      // must reject Gatsby's function manifest rather than ship incomplete HTML.
      for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text);
      }
      await writeFile(join(root, 'src/pages/private.jsx'), "import React from 'react'; export async function getServerData(){return {props:{message:'SSR-only'}};} export default function Private({serverData}){return <p>{serverData.message}</p>;}");
      await assert.rejects(ship(['build'], { capture: true }), error => {
        assert.match(`${error.stdout}\n${error.stderr}`, /Ship Gatsby static packaging does not support SSR/);
        return true;
      });
    },
  });
});
