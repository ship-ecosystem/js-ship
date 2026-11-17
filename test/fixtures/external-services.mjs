import { cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export async function copyExternalExample(root) {
  // Never copy developer-installed dependencies or locally configured credentials.
  for (const file of ['package.json', 'package-lock.json', 'ship.json', 'server.mjs', 'check-connections.mjs', '.env.example']) {
    await cp(resolve('examples/external-services', file), join(root, file));
  }
}
