import { run } from '../../dist/process.js';
import { resolve } from 'node:path';

export async function assertNoSecrets(path, secrets) {
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
