import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateNpmRelease } from '../scripts/npm-release-policy.mjs';

function fixture(version = '0.1.0-alpha.0') {
  return {
    pkg: { name: 'js-ship', version, private: false,
      repository: { url: 'git+https://github.com/ship-ecosystem/js-ship.git' },
      publishConfig: { registry: 'https://registry.npmjs.org/', access: 'public', tag: 'next' } },
    lock: { name: 'js-ship', version, packages: { '': { name: 'js-ship', version } } },
    changelog: `# Changelog\n\n## Unreleased\n\n## ${version}\n`,
    options: { publish: true, ref: `refs/tags/v${version}`, repository: 'ship-ecosystem/js-ship', repositoryPrivate: 'false' }
  };
}
const check = f => validateNpmRelease(f.pkg, f.lock, f.changelog, f.options);

test('npm preview accepts a private development snapshot without registry identity', () => {
  const f = fixture('0.1.0-dev.0'); f.pkg.private = true; f.options = {};
  assert.deepEqual(check(f), { name: 'js-ship', version: '0.1.0-dev.0', tag: 'next', publish: false });
});
test('npm publishing requires a public repository, matching tag, explicit metadata and release notes', () => {
  assert.equal(check(fixture()).publish, true);
  const changes = [
    f => { f.pkg.private = true; }, f => { delete f.pkg.private; },
    f => { f.options.repositoryPrivate = 'true'; }, f => { delete f.options.repositoryPrivate; },
    f => { f.options.repository = 'other/js-ship'; }, f => { f.options.ref = 'refs/heads/main'; },
    f => { f.options.ref = 'refs/tags/v0.1.0-alpha.1'; },
    f => { f.changelog = '## Unreleased\n'; },
    f => { f.pkg.publishConfig.tag = 'latest'; },
    f => { f.pkg.publishConfig.registry = 'https://other.example/'; },
    f => { f.pkg.repository.url = 'git+https://github.com/other/js-ship.git'; },
    f => { f.lock.version = '0.0.1'; }, f => { f.lock.packages[''].version = '0.0.1'; },
    f => { f.pkg.name = '@ship/js-ship'; }
  ];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(() => check(f), /npm release:/); }
});
test('npm policy rejects dev publication, stable versions and malformed prereleases', () => {
  for (const version of ['0.1.0-dev.0', '0.1.0', '0.1.0-alpha', '0.1.0-alpha.01', '01.1.0-beta.0', '0.1.0-alpha.0\n', '0.1.0-alpha.0+local']) {
    assert.throws(() => check(fixture(version)), /npm release:/);
    if (version !== '0.1.0-dev.0') { const preview = fixture(version); preview.options = {}; assert.throws(() => check(preview), /npm release:/); }
  }
  for (const version of ['0.1.0-alpha.0', '0.1.0-beta.1', '0.1.0-rc.2']) assert.equal(check(fixture(version)).publish, true);
});


test('offline candidate preflight enforces publishable metadata without requiring GitHub or registry access', () => {
  const f = fixture(); f.options = { candidate: true };
  assert.equal(check(f).publish, false);
  for (const change of [
    f => { f.pkg.private = true; },
    f => { f.changelog = '## Unreleased\n'; },
    f => { f.changelog = `## ${f.pkg.version}\n`; },
  ]) {
    const candidate = fixture(); candidate.options = { candidate: true }; change(candidate);
    assert.throws(() => check(candidate), /npm release:/);
  }
  const dev = fixture('0.1.0-dev.0'); dev.options = { candidate: true };
  assert.throws(() => check(dev), /development snapshots/);
});
