import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { run } from '../../dist/process.js';

test('Playwright browser server reaches renamed app and Cypress runs on demand', { timeout: 600_000 }, async t => {
 const root = await mkdtemp(join(tmpdir(), 'ship-js-browser-services-'));
 const name = `ship-js-browser-${randomBytes(5).toString('hex')}`, cli = resolve('dist/cli.js');
 const ship = args => run([process.execPath, cli, ...args], root, { env: { ...process.env, APP_PORT: '0' } });
 let browser;
 t.after(async () => {
  await browser?.close().catch(() => {});
  await ship(['down', '--volumes']).catch(() => {});
  await run(['docker', 'image', 'rm', `${name}-app:local`], root).catch(() => {});
  await rm(root, { recursive: true, force: true });
 });
 await cp(resolve('examples/node'), root, { recursive: true });
 await writeFile(join(root, 'ship.json'), JSON.stringify({ name, serviceNames: { app: 'web' }, services: { testing: 'playwright' }, additionalServices: [{ group: 'testing', service: 'cypress', name: 'runner' }] }));
 await ship(['init', '--no-interaction']);
 await writeFile(join(root, 'docker-compose.override.yml'), JSON.stringify({ services: { playwright: { ports: ['127.0.0.1::3000'] } } }));
 await ship(['up']);
 const prefix = ['docker', 'compose', '--project-directory', root, '-f', join(root, 'ship/docker-compose.generated.yml'), '-f', join(root, 'docker-compose.override.yml')];
 const endpoint = await run([...prefix, 'port', 'playwright', '3000'], root, { capture: true });
 const port = Number(endpoint.trim().split(':').at(-1));
 browser = await chromium.connect(`ws://127.0.0.1:${port}/`);
 const page = await browser.newPage();
 assert.equal((await page.goto('http://web:3000/')).status(), 200);
 assert.match(await page.textContent('body'), /Hello from JavaScript Ship/);
 await browser.close(); browser = undefined;
 // Primary Cypress exercises the actual ship test command. Keep Playwright as
 // an additional service only after removing its port override.
 await ship(['down']);
 await rm(join(root, 'docker-compose.override.yml'));
 const config = JSON.parse(await readFile(join(root, 'ship.json')));
 config.services.testing = 'cypress'; config.additionalServices = [];
 await writeFile(join(root, 'ship.json'), JSON.stringify(config));
 await mkdir(join(root, 'cypress/e2e'), { recursive: true });
 await writeFile(join(root, 'cypress.config.mjs'), 'import {defineConfig} from "cypress"; export default defineConfig({e2e:{supportFile:false,specPattern:"cypress/e2e/*.cy.js"},video:false});\n');
 await writeFile(join(root, 'cypress/e2e/app.cy.js'), 'describe("Ship app",()=>{it("reaches renamed app",()=>{cy.request("/").its("body.message").should("equal","Hello from JavaScript Ship")})});\n');
 await ship(['init', '--no-interaction']);
 await ship(['up']);
 await ship(['test', '--', '--browser', 'electron']);
});
