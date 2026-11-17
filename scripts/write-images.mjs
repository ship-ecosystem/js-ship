import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('images/compose.yaml', root), 'utf8'));
const keys = ['node22', 'node24', 'node26', 'nginx', 'postgres', 'redis', 'mongo'];
if (JSON.stringify(Object.keys(catalog.services).sort()) !== JSON.stringify([...keys].sort())) throw new Error('Review the runtime policy before changing the image catalog keys.');
const images = {}, floors = {};
for (const key of keys) {
  const image = catalog.services[key].image;
  if (typeof image !== 'string' || !/^[a-z0-9][a-z0-9/._-]*:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}(?![\s\S])/.test(image)) throw new Error(`Invalid digest-pinned image: ${key}`);
  images[key] = image;
  if (key.startsWith('node')) {
    const version = /^node:(\d+\.\d+\.\d+)-bookworm-slim@/.exec(image)?.[1];
    if (!version || !version.startsWith(key.slice(4) + '.')) throw new Error(`Node image must stay in its reviewed major: ${key}`);
    floors[key.slice(4)] = version;
  }
}
async function writeChanged(path, text) {
  const url = new URL(path, root);
  if (await readFile(url, 'utf8').catch(() => '') !== text) await writeFile(url, text);
}
await writeChanged('src/images.ts', `// Generated from images/compose.yaml by npm run build. Edit the catalog instead.\nexport const IMAGES = ${JSON.stringify(images, null, 2)} as const;\nexport const NODE_MINIMUMS: Readonly<Record<string, string>> = ${JSON.stringify(floors, null, 2)};\n`);
const engines = { node: Object.values(floors).map(version => `^${version}`).join(' || ') };
for (const file of ['package.json', 'package-lock.json']) {
  const data = JSON.parse(await readFile(new URL(file, root), 'utf8'));
  if (file === 'package.json') data.engines = engines;
  else data.packages[''].engines = engines;
  await writeChanged(file, JSON.stringify(data, null, 2) + '\n');
}
