import { readFile } from 'node:fs/promises';
import { validateNpmRelease } from './npm-release-policy.mjs';
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !['--publish', '--candidate'].includes(args[0]))) throw new Error('Usage: npm run release:check [-- --candidate|--publish]');
const result = validateNpmRelease(
  JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')),
  JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8')),
  { candidate: args[0] === '--candidate', publish: args[0] === '--publish', ref: process.env.GITHUB_REF,
    repository: process.env.GITHUB_REPOSITORY, repositoryPrivate: process.env.SHIP_REPOSITORY_PRIVATE }
);
console.log(`${result.publish ? 'Publish preflight' : args[0] === '--candidate' ? 'Offline candidate preflight' : 'Offline preview'}: ${result.name}@${result.version}, npm dist-tag ${result.tag}.`);
if (!result.publish) console.log('No registry writes. This check does not verify npm ownership or OIDC configuration.');
