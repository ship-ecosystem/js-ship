import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateNpmRelease } from '../scripts/npm-release-policy.mjs';

function fixture(version = '0.1.1') {
  return {
    pkg: { name: '@shipecosystem/js-ship', version, private: false,
      repository: { url: 'git+https://github.com/ship-ecosystem/js-ship.git' },
      publishConfig: { registry: 'https://registry.npmjs.org/', access: 'public', tag: 'latest' } },
    lock: { name: '@shipecosystem/js-ship', version, packages: { '': { name: '@shipecosystem/js-ship', version } } },
    options: { publish: true, ref: `refs/tags/v${version}`, repository: 'ship-ecosystem/js-ship', repositoryPrivate: 'false' }
  };
}
const check = f => validateNpmRelease(f.pkg, f.lock, f.options);

test('npm preview accepts a private checkout without registry identity', () => {
  const f = fixture(); f.pkg.private = true; f.options = {};
  assert.deepEqual(check(f), { name: '@shipecosystem/js-ship', version: '0.1.1', tag: 'latest', publish: false });
});
test('npm publishing requires a public repository, matching tag and explicit metadata', () => {
  assert.equal(check(fixture()).publish, true);
  const changes = [
    f => { f.pkg.private = true; }, f => { delete f.pkg.private; },
    f => { f.options.repositoryPrivate = 'true'; }, f => { delete f.options.repositoryPrivate; },
    f => { f.options.repository = 'other/js-ship'; }, f => { f.options.ref = 'refs/heads/main'; },
    f => { f.options.ref = 'refs/tags/v0.1.2'; },
    f => { f.pkg.publishConfig.tag = 'next'; },
    f => { f.pkg.publishConfig.registry = 'https://other.example/'; },
    f => { f.pkg.repository.url = 'git+https://github.com/other/js-ship.git'; },
    f => { f.lock.version = '0.0.1'; }, f => { f.lock.packages[''].version = '0.0.1'; },
    f => { f.pkg.name = 'js-ship'; }, f => { f.pkg.name = '@ship-ecosystem/js-ship'; }
  ];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(() => check(f), /npm release:/); }
});
test('npm policy accepts plain 0.x.y versions and rejects other versions', () => {
  for (const version of ['0.1.0-dev.0', '1.0.0', '0.1.0-alpha.0', '0.1.0-rc.1', '0.01.0', '0.1.0\n', '0.1.0+local']) {
    assert.throws(() => check(fixture(version)), /npm release:/);
    const preview = fixture(version); preview.options = {};
    assert.throws(() => check(preview), /npm release:/);
  }
  for (const version of ['0.1.0', '0.1.1', '0.2.0']) assert.equal(check(fixture(version)).publish, true);
});


test('offline candidate preflight enforces publishable metadata without requiring GitHub or registry access', () => {
  const f = fixture(); f.options = { candidate: true };
  assert.equal(check(f).publish, false);
  f.pkg.private = true;
  assert.throws(() => check(f), /private must be explicitly false/);
});
