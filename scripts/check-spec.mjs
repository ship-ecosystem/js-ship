import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const upstream = resolve(process.argv[2] ?? '../com.ship.spec');
for (const name of ['ship.schema.json', 'ship-release.schema.json']) {
 const [local, canonical] = await Promise.all([readFile(new URL(`../schema/canonical/${name}`, import.meta.url)), readFile(resolve(upstream, 'schemas', name))]);
 if (!local.equals(canonical)) throw new Error(`Canonical schema drift: ${name}. Review the spec change and refresh the unmodified copy.`);
 console.log(`Canonical schema matches: ${name}`);
}
