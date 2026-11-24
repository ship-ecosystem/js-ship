// npm package releases are separate from the application's Docker release command.
export function validateNpmRelease(pkg, lock, options = {}) {
  const fail = message => { throw new Error(`npm release: ${message}`); };
  const version = pkg.version;
  if (pkg.name !== 'js-ship') fail('package name must remain js-ship.');
  if (typeof version !== 'string' || !/^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?![\s\S])/.test(version)) {
    fail('use a 0.x.y version without a suffix.');
  }
  if (lock.name !== pkg.name || lock.version !== version || lock.packages?.['']?.name !== pkg.name || lock.packages?.['']?.version !== version) {
    fail('package.json and both lockfile version records must agree.');
  }
  if (pkg.repository?.url !== 'git+https://github.com/ship-ecosystem/js-ship.git') fail('repository metadata must match ship-ecosystem/js-ship.');
  if (pkg.publishConfig?.registry !== 'https://registry.npmjs.org/' || pkg.publishConfig?.access !== 'public' || pkg.publishConfig?.tag !== 'latest') {
    fail('publishConfig must use the public npm registry and default latest dist-tag.');
  }
  if ((options.publish || options.candidate) && pkg.private !== false) {
    fail('private must be explicitly false for publication.');
  }
  if (options.publish) {
    if (options.ref !== `refs/tags/v${version}`) fail('dispatch the publish workflow on the exact v<package-version> tag.');
    if (options.repository !== 'ship-ecosystem/js-ship' || options.repositoryPrivate !== 'false') fail('publication requires the public ship-ecosystem/js-ship repository.');
  }
  return { name: pkg.name, version, tag: 'latest', publish: options.publish === true };
}
