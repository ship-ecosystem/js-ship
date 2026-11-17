import { run } from '../../dist/process.js';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function lockFixture(root, manager = 'npm', npmVersion = '12.2.2') {
  if (!/^\d+\.\d+\.\d+$/.test(npmVersion)) throw new Error('Fixture npm version must be an exact release.');
  const setup = manager === 'pnpm'
    ? 'if command -v corepack >/dev/null 2>&1; then corepack disable; fi; npm install --global pnpm@12.21.0 --no-audit --no-fund && pnpm install --lockfile-only --store-dir /tmp/ship-pnpm-store --modules-dir /tmp/ship-pnpm-modules --virtual-store-dir /tmp/ship-pnpm-virtual'
    : `npm install --global npm@${npmVersion} --no-audit --no-fund && npm install --package-lock-only --ignore-scripts --no-audit --no-fund`;
  await run(['docker', 'run', '--rm', '--mount', `type=bind,source=${root},target=/app`, '--workdir', '/app', 'node:24-bookworm-slim', 'sh', '-c', setup], root);
  // Root inside the temporary container may have atomically replaced these files.
  // Recreate them as the host test user before exercising non-root dependency proxies.
  for (const file of ['package.json', manager === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml']) {
    const path = join(root, file), bytes = await readFile(path);
    await rm(path); await writeFile(path, bytes);
  }
}

export async function waitForResponse(url, predicate = response => response.status === 200) {
  let last;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (await predicate(response)) return;
      last = `HTTP ${response.status}`;
    } catch (error) { last = error.message; }
    await delay(250);
  }
  throw new Error(`HTTP condition failed for ${url}: ${last}`);
}

export async function publishedPort(prefix, root, target) {
  const output = await run([...prefix, 'port', 'app', String(target)], root, { capture: true });
  return Number(output.trim().split(/\r?\n/)[0].split(':').at(-1));
}
