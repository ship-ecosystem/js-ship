import { mkdir, writeFile } from 'node:fs/promises';
import { shipConfigSchema } from '../dist/schema.js';
const directory = new URL('../schema/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('ship.schema.json', directory), JSON.stringify(shipConfigSchema, null, 2) + '\n');
