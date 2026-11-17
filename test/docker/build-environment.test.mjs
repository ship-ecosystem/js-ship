import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initProject } from '../../dist/init.js';
import { composePrefix } from '../../dist/project.js';
import { assembleRelease } from '../../dist/release.js';
import { run } from '../../dist/process.js';
import { lockFixture } from './support.mjs';

async function assertNoSecrets(path, secrets) {
  // Docker Engine can save OCI gzip blobs as well as uncompressed layer tars.
  // Inspect decompressed contents so compressed layers cannot hide markers.
  await run(['python3', '-c', `import gzip, json, os, tarfile, sys
markers = [value.encode() for value in json.loads(os.environ['SHIP_TEST_MARKERS'])]
with tarfile.open(sys.argv[1], 'r:*') as archive:
    for member in archive:
        if not member.isfile():
            continue
        source = archive.extractfile(member)
        magic = source.read(4)
        source.seek(0)
        if magic == bytes.fromhex('28b52ffd'):
            raise RuntimeError('Unsupported zstd layer: extend the credential scanner before accepting this result')
        stream = gzip.GzipFile(fileobj=source) if magic[:2] == bytes.fromhex('1f8b') else source
        tail = b''
        while True:
            chunk = stream.read(65536)
            if not chunk:
                break
            data = tail + chunk
            assert not any(marker in data for marker in markers), 'Credential persisted in saved image member'
            tail = data[-512:]
`, path], resolve('.'), { env: { ...process.env, SHIP_TEST_MARKERS: JSON.stringify(secrets) } });
}
const hash = value => createHash('sha256').update(value).digest('hex');
for (const manager of ['npm', 'pnpm']) {
  test(`${manager}: build secrets, registry config, public cache changes and portable image isolation`, { timeout: 600_000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'ship-build-docker-'));
    const name = `ship-build-${randomBytes(5).toString('hex')}`;
    const token = randomBytes(24).toString('hex'), runtime = randomBytes(24).toString('hex');
    const npmrc = `@ship-fixture:registry=https://registry.example.invalid/\n//registry.example.invalid/:_authToken=${randomBytes(24).toString('hex')}\n`;
    const image = `${name}-app:secret-test`, builder = `${name}-builder:check`;
    let cfg, devPrefix;
    t.after(async () => {
      if (devPrefix) await run([...devPrefix, 'down', '--volumes', '--remove-orphans'], root).catch(() => {});
      for (const tag of [image, builder]) await run(['docker', 'image', 'rm', tag], root).catch(() => {});
      await rm(root, { recursive: true, force: true });
    });
    await cp(resolve('examples/node'), root, { recursive: true });
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    pkg.packageManager = manager === 'npm' ? 'npm@12.2.2' : 'pnpm@12.21.0';
    await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
    await rm(join(root, 'package-lock.json'));
    await lockFixture(root, manager);
    // The inline hook also runs in the dependency stage, before source is copied.
    const hook = `const f=require('node:fs'),c=require('node:crypto'); const p=process.env.NPM_CONFIG_USERCONFIG; if(!p || c.createHash('sha256').update(f.readFileSync(p)).digest('hex')!==${JSON.stringify(hash(npmrc))}) process.exit(19);`;
    pkg.scripts.postinstall = `node -e ${JSON.stringify(hook)}`;
    pkg.scripts.build = 'node build.mjs';
    await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
    await writeFile(join(root, 'build.mjs'), `import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
assert.equal(createHash('sha256').update(process.env.CMS_TOKEN).digest('hex'), ${JSON.stringify(hash(token))});
assert.equal(process.env.RUNTIME_SECRET, undefined);
assert.equal(process.env.NPM_CONFIG_USERCONFIG, undefined);
for (const file of ['.env.production','.ship-secrets/CMS_TOKEN','.ship-secrets/npmrc','nested/.npmrc','nested/.env.local']) assert.equal(existsSync(file), false, file);
writeFileSync('built.json', JSON.stringify({ public: process.env.PUBLIC_URL, secretDigest: createHash('sha256').update(process.env.CMS_TOKEN).digest('hex') }));
`);
    await mkdir(join(root, '.ship-secrets'));
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, '.ship-secrets/CMS_TOKEN'), token);
    await writeFile(join(root, '.ship-secrets/npmrc'), npmrc);
    await writeFile(join(root, 'nested/.npmrc'), npmrc);
    await writeFile(join(root, 'nested/.env.local'), `HIDDEN=${runtime}`);
    await writeFile(join(root, '.env.production'), `RUNTIME_SECRET=${runtime}\n`);
    const publicValue = 'https://example.com/$literal?x=${UNEXPANDED}';
    await writeFile(join(root, 'ship.json'), JSON.stringify({ name, build: { npmrc: true, secrets: ['CMS_TOKEN'], publicEnv: { PUBLIC_URL: publicValue } } }));
    cfg = await initProject(root);
    const destination = await assembleRelease(root, cfg, 'secret-test', run);
    const inspect = JSON.parse(await run(['docker', 'image', 'inspect', image], root, { capture: true }))[0];
    assert.ok(!inspect.Config.Env.some(value => /CMS_TOKEN|PUBLIC_URL|NPM_CONFIG_USERCONFIG|RUNTIME_SECRET/.test(value)));
    const built = async () => JSON.parse(await run(['docker', 'run', '--rm', image, 'node', '-e', "process.stdout.write(require('node:fs').readFileSync('built.json'))"], root, { capture: true }));
    assert.equal((await built()).public, publicValue);
    const releaseCompose = await readFile(join(destination, 'docker-compose.yml'), 'utf8');
    assert.doesNotMatch(releaseCompose, /ship_npmrc|ship_build_|\.ship-secrets|PUBLIC_URL/);
    assert.equal(await readFile(join(destination, '.env'), 'utf8'), `RUNTIME_SECRET=${runtime}\n`);
    const args = ['docker', 'build', '--target', 'builder', '-t', builder,
      '--build-arg', 'SHIP_PACKAGE_MANAGER_VERSION=' + cfg.packageManagerVersion,
      '--build-arg', 'SHIP_BUILD_SCRIPT=build', '--build-arg', `PUBLIC_URL=${publicValue}`,
      '--secret', `id=ship_npmrc,src=${join(root, '.ship-secrets/npmrc')}`,
      '--secret', `id=ship_build_CMS_TOKEN,src=${join(root, '.ship-secrets/CMS_TOKEN')}`,
      '-f', 'ship/Dockerfile', '.'];
    await run(args, root);
    const archive = join(root, 'builder.tar');
    await run(['docker', 'save', '-o', archive, builder], root);
    const secrets = [token, runtime, npmrc.split('_authToken=')[1].trim()];
    await assertNoSecrets(archive, secrets);
    await assertNoSecrets(join(destination, 'images/app.tar'), secrets);
    await rm(archive);
    // Public changes must invalidate the build output without changing template shape.
    cfg.build.publicEnv.PUBLIC_URL = 'https://changed.example/';
    const { prefix } = await composePrefix(root, cfg, 'production', 'secret-test');
    await run([...prefix, 'build', 'app'], root);
    assert.equal((await built()).public, 'https://changed.example/');
    ({ prefix: devPrefix } = await composePrefix(root, cfg, 'development'));
    await run([...devPrefix, 'build', 'app'], root);
    await run([...devPrefix, 'run', '--rm', '--no-deps', 'app', 'node', '-e', "if(process.env.NPM_CONFIG_USERCONFIG || process.env.CMS_TOKEN) process.exit(20)"], root);
    const registry = await run([...devPrefix, 'run', '--rm', '--no-deps', 'app', 'env', 'NPM_CONFIG_USERCONFIG=/run/secrets/ship_npmrc', manager, 'config', 'get', '@ship-fixture:registry'], root, { capture: true });
    assert.match(registry, /https:\/\/registry.example.invalid\//);
    await run([...devPrefix, 'up', '-d', '--wait', 'app'], root, { env: { ...process.env, APP_PORT: '0' } });
    const proxyRegistry = await run([process.execPath, resolve('dist/cli.js'), '--project-directory', root, manager, 'config', 'get', '@ship-fixture:registry'], root, { capture: true });
    assert.match(proxyRegistry, /https:\/\/registry.example.invalid\//);
    // A required secret disappearing must fail instead of silently building without it.
    await rm(join(root, '.ship-secrets/CMS_TOKEN'));
    await assert.rejects(assembleRelease(root, cfg, 'missing-secret', run), /Required secret file/);
    await run(['docker', 'image', 'rm', `${name}-app:local`], root).catch(() => {});
  });
}
