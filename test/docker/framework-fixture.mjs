import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { run } from '../../dist/process.js';
import { readConfig } from '../../dist/config.js';
import { composePrefix } from '../../dist/project.js';
import { lockFixture, publishedPort, waitForResponse } from './support.mjs';

// Builds real pinned framework packages. Production starts with --no-build after
// removing the fixture sources; it cannot silently use the development bind mount.
export async function exerciseFramework(t, fixture) {
  const root = await mkdtemp(join(tmpdir(), 'ship-framework-'));
  const name = `ship-fw-${fixture.framework}-${randomBytes(4).toString('hex')}`;
  const env = { ...process.env, APP_PORT: '0' };
  const cli = resolve('dist/cli.js');
  let cfg, dev, prod;
  const ship = (args, options = {}) => run([process.execPath, cli, ...args], root, { env, ...options });
  t.after(async () => {
    for (const context of [prod, dev].filter(Boolean)) await run([...context.prefix, 'down', '--volumes', '--remove-orphans'], root, { env, capture: true }).catch(() => {});
    await run(['docker', 'image', 'rm', `${name}-app:local`], root, { capture: true }).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  for (const [file, content] of Object.entries(fixture.files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content);
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', packageManager: `npm@${fixture.npmVersion ?? '12.2.2'}`, ...fixture.manifest }));
  await lockFixture(root, 'npm', fixture.npmVersion);
  await writeFile(join(root, 'ship.json'), JSON.stringify({ name, publishPorts: true, deployment: fixture.mode ?? 'node', basePath: fixture.base ?? '/' }));
  try {
    await ship(['init', '--no-interaction']); cfg = await readConfig(root);
    assert.equal(cfg.framework, fixture.framework, 'detect the specific framework');
    await writeFile(join(root, '.env.production'), `SHIP_FIXTURE_RUNTIME=production-only\n${fixture.productionEnv ?? ''}`);
    dev = await composePrefix(root, cfg, 'development');
    await ship(['up']);
    const devBase = `http://127.0.0.1:${await publishedPort(dev.prefix, root, cfg.port)}${fixture.base ?? '/'}`;
    if (fixture.client) {
      assert.match(await (await fetch(devBase)).text(), /@vite\/client/);
      for (const module of [fixture.client, ...(fixture.modules ?? [])]) {
        assert.equal((await fetch(new URL(module, devBase))).status, 200, `dev source module compiles: ${module}`);
      }
    } else if (fixture.devCheck) {
      await fixture.devCheck(devBase);
    } else {
      await waitForResponse(devBase, async r => r.status === 200 && (await r.text()).includes(fixture.marker));
    }
    await ship(['down']);
    await ship(['build']);
    for (const file of fixture.sources) await rm(join(root, file), { recursive: true, force: true });
    prod = await composePrefix(root, cfg, 'production');
    assert.equal(prod.model.services.app.volumes, undefined, 'production has no source mounts');
    await run([...prod.prefix, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '90'], root, { env });
    const port = cfg.deployment === 'static' ? 8080 : cfg.port;
    const base = `http://127.0.0.1:${await publishedPort(prod.prefix, root, port)}${fixture.base ?? '/'}`;
    await waitForResponse(base);
    const html = await (await fetch(base)).text();
    if (fixture.client) {
      const asset = /src="([^"]+\.js)"/.exec(html)?.[1];
      assert.ok(asset, 'built page references a script');
      const response = await fetch(new URL(asset, base));
      assert.equal(response.status, 200);
      assert.ok((await response.text()).includes(fixture.marker), 'compiled bundle contains the framework component');
      assert.equal((await fetch(new URL('nested/client-route', base))).status, 200, 'SPA fallback');
    } else assert.ok(html.includes(fixture.marker), 'server or prerendered HTML contains the fixture');
    if (fixture.scripts) {
      const asset = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1];
      assert.ok(asset, 'rendered HTML references a built script');
      assert.equal((await fetch(new URL(asset, base))).status, 200);
    }
    if (fixture.asset) assert.equal(await (await fetch(new URL('fixture.txt', base))).text(), 'framework public asset');
    if (cfg.deployment === 'static') {
      assert.equal((await fetch(new URL('missing.js', base))).status, 404);
      if (!fixture.client) assert.equal((await fetch(new URL('missing-page', base))).status, fixture.spa ? 200 : 404);
      await assert.rejects(run([...prod.prefix, 'exec', '-T', 'app', 'node', '--version'], root, { capture: true }));
    } else {
      await run([...prod.prefix, 'exec', '-T', 'app', 'node', '-e', 'if(process.getuid()===0)process.exit(1)'], root);
      if (fixture.probe) {
        const response = await fetch(new URL('api/probe?value=request-time', base));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { value: 'request-time', runtime: 'production-only' });
      }
      if (fixture.pruned) await run([...prod.prefix, 'exec', '-T', 'app', 'node', '-e', `if(require('node:fs').existsSync('/app/node_modules/${fixture.pruned}'))process.exit(1)`], root);
    }
    await fixture.afterProduction?.({ root, ship, base });
  } catch (error) {
    for (const context of [prod, dev].filter(Boolean)) await run([...context.prefix, 'logs', '--tail', '60'], root, { env }).catch(() => {});
    throw error;
  }
}
