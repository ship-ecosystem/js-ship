import { readFile } from 'node:fs/promises';
import { validateNpmRelease } from './npm-release-policy.mjs';
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--publish')) throw new Error('Usage: npm run release:check [-- --publish]');
const result = validateNpmRelease(
  JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')),
  JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8')),
  await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8'),
  { publish: args[0] === '--publish', ref: process.env.GITHUB_REF,
    repository: process.env.GITHUB_REPOSITORY, repositoryPrivate: process.env.SHIP_REPOSITORY_PRIVATE }
);
console.log(`${result.publish ? 'Publish preflight' : 'Offline preview'}: ${result.name}@${result.version}, npm dist-tag ${result.tag}.`);
if (!result.publish) console.log('No registry writes. This preview does not verify npm ownership or OIDC configuration.');
