// npm package releases are separate from the application's Docker release command.
export function validateNpmRelease(pkg, lock, changelog, options = {}) {
  const fail = message => { throw new Error(`npm release: ${message}`); };
  const version = pkg.version;
  if (pkg.name !== 'js-ship') fail('package name must remain js-ship.');
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-(dev|alpha|beta|rc)\.(0|[1-9]\d*)(?![\s\S])/.test(version)) {
    fail('use an explicit dev, alpha, beta or rc prerelease version. Stable publishing is not enabled.');
  }
  if (lock.name !== pkg.name || lock.version !== version || lock.packages?.['']?.name !== pkg.name || lock.packages?.['']?.version !== version) {
    fail('package.json and both lockfile version records must agree.');
  }
  if (pkg.repository?.url !== 'git+https://github.com/ship-ecosystem/js-ship.git') fail('repository metadata must match ship-ecosystem/js-ship.');
  if (pkg.publishConfig?.registry !== 'https://registry.npmjs.org/' || pkg.publishConfig?.access !== 'public' || pkg.publishConfig?.tag !== 'next') {
    fail('publishConfig must use the public npm registry and next dist-tag.');
  }
  if (options.publish) {
    if (pkg.private !== false) fail('private must be explicitly false for publication.');
    if (version.includes('-dev.')) fail('development snapshots cannot be published.');
    if (options.ref !== `refs/tags/v${version}`) fail('dispatch the publish workflow on the exact v<package-version> tag.');
    if (options.repository !== 'ship-ecosystem/js-ship' || options.repositoryPrivate !== 'false') fail('publication requires the public ship-ecosystem/js-ship repository.');
    if (!changelog.split(/\r?\n/).includes(`## ${version}`)) fail('add a changelog section for the exact release version.');
  } else if (!changelog.split(/\r?\n/).includes('## Unreleased')) fail('preview requires an Unreleased changelog section.');
  return { name: pkg.name, version, tag: 'next', publish: options.publish === true };
}
