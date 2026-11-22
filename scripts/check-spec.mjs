import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const upstream = resolve(process.argv[2] ?? '../com.ship.spec');
for (const name of ['ship.schema.json', 'ship-release.schema.json']) {
 const [local, canonical] = await Promise.all([readFile(new URL(`../schema/canonical/${name}`, import.meta.url)), readFile(resolve(upstream, 'schemas', name))]);
 if (!local.equals(canonical)) throw new Error(`Canonical schema drift: ${name}. Review the spec change and refresh the unmodified copy.`);
 console.log(`Canonical schema matches: ${name}`);
}

const [localChecker, upstreamChecker] = await Promise.all([readFile(new URL('./spec/check-release.mjs', import.meta.url), 'utf8'), readFile(resolve(upstream, 'tools/check-release.mjs'), 'utf8')]);
const adapted = upstreamChecker.replace('#!/usr/bin/env node\n', '#!/usr/bin/env node\n// Adapted from ship-ecosystem/spec be4cc80; only the schema location differs.\n').replace("join(root, 'schemas', 'ship-release.schema.json')", "join(root, '..', 'schema', 'canonical', 'ship-release.schema.json')");
if (localChecker !== adapted) throw new Error('Shared release checker drift; review and refresh the adapted copy.');
console.log('Shared release checker matches.');
