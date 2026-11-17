import pg from 'pg';
import { createClient } from 'redis';
import { MongoClient } from 'mongodb';

// This is application code, not a Ship-managed service or production health policy.
async function bounded(operation) {
  let timer;
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Connection check timed out')), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}
const probes = {
  DATABASE_URL: ['postgres', async url => {
    const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 5000, max: 1 });
    pool.on('error', () => {});
    try { await pool.query('SELECT 1'); } finally { await pool.end(); }
  }],
  REDIS_URL: ['redis', async url => {
    const client = createClient({ url, socket: { connectTimeout: 5000, reconnectStrategy: false }, disableOfflineQueue: true });
    client.on('error', () => {}); // Report a fixed message below, never the credential-bearing URI.
    try { await bounded(async () => { await client.connect(); await client.ping(); }); }
    finally { if (client.isOpen) client.destroy(); }
  }],
  MONGODB_URI: ['mongodb', async url => {
    const client = new MongoClient(url, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 5000, timeoutMS: 10_000 });
    try { await client.db().command({ ping: 1 }); } finally { await client.close(); }
  }],
};
let checked = 0;
for (const [variable, [name, check]] of Object.entries(probes)) {
  const uri = process.env[variable];
  if (!uri) continue;
  checked++;
  try { await check(uri); console.log(`${name}: OK`); }
  catch {
    console.error(`${name}: FAILED (check DNS, TLS, credentials and network access)`);
    process.exitCode = 1;
  }
}
if (!checked) {
  console.error('No connection URLs configured. Set DATABASE_URL, REDIS_URL or MONGODB_URI.');
  process.exitCode = 1;
}
