import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { exerciseNextExport } from '../fixtures/next-export.mjs';

for (const trailingSlash of [false, true]) test(`Next.js static export trailingSlash=${trailingSlash}: hydration and client navigation without a Node runtime`, { timeout: 900_000 }, async t => {
  await exerciseNextExport(t, trailingSlash, async base => {
    const browser = await chromium.launch({ headless: true, ...(process.env.SHIP_BROWSER_EXECUTABLE ? { executablePath: process.env.SHIP_BROWSER_EXECUTABLE } : {}) });
    let context, page;
    try {
      context = await browser.newContext();
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      page = await context.newPage();
      const errors = [], failedAssets = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        const url = new URL(response.url());
        if (response.status() >= 400 && (url.pathname.includes('/_next/') || url.pathname.endsWith('.txt'))) failedAssets.push(`${response.status()} ${url.pathname}`);
      });
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Ship static home', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Count 0', exact: true }).click();
      await page.getByRole('button', { name: 'Count 1', exact: true }).waitFor();
      const token = randomBytes(16).toString('hex');
      await page.evaluate(value => { window.__shipStaticDocument = value; }, token);
      for (const [link, heading, route] of [
        ['First article', 'Static article: first', '/blog/first'],
        ['Second article', 'Static article: second', '/blog/second'],
        ['Home', 'Ship static home', '/'],
      ]) {
        await page.getByRole('link', { name: link, exact: true }).click();
        await page.getByRole('heading', { name: heading, exact: true }).waitFor();
        const expected = route === '/' ? '/' : route + (trailingSlash ? '/' : '');
        assert.equal(new URL(page.url()).pathname, expected);
        assert.equal(await page.getByRole('button').textContent(), 'Count 1', 'shared layout stays hydrated');
        assert.equal(await page.evaluate(() => window.__shipStaticDocument), token, 'Link navigation must not reload the document');
      }
      await page.waitForLoadState('networkidle');
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).color), 'rgb(18, 52, 86)');
      assert.deepEqual(errors, []);
      assert.deepEqual(failedAssets, []);
      const missing = await page.goto(`${base}/not-an-exported-route`);
      assert.equal(missing.status(), 404);
      await page.getByRole('heading', { name: 'Ship static not found', exact: true }).waitFor();
      await context.tracing.stop();
    } catch (error) {
      if (context) {
        const artifacts = resolve('test-results/next-export', `${trailingSlash}-${randomBytes(4).toString('hex')}`);
        await mkdir(artifacts, { recursive: true });
        await page?.screenshot({ path: join(artifacts, 'page.png'), fullPage: true }).catch(() => {});
        await context.tracing.stop({ path: join(artifacts, 'trace.zip') }).catch(() => {});
        console.error(`Next export browser evidence: ${artifacts}`);
      }
      throw error;
    } finally { await browser.close(); }
  });
});
