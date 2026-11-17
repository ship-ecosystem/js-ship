function bootstrapReplicaSet() {
  const admin = new Mongo('mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=1000&connectTimeoutMS=1000').getDB('admin');
  const auth = admin.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
  if (auth !== true && auth !== 1 && auth?.ok !== 1) return 1;
  const host = process.env.SHIP_MONGO_HOST + ':27017';
  let result;
  try { result = admin.runCommand({ replSetGetConfig: 1 }); }
  catch (error) {
    if (error.codeName !== 'NotYetInitialized' && error.code !== 94) return 1;
    result = { ok: 0, codeName: 'NotYetInitialized' };
  }
  if (!result.ok) {
    if (result.codeName !== 'NotYetInitialized') return 1; // never initiate the temporary standalone init server
    const initiated = admin.runCommand({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host }] } });
    return initiated.ok ? 0 : 1;
  }
  const config = result.config;
  if (config._id !== 'rs0' || config.members.length !== 1) return 1;
  if (config.members[0].host !== host) {
    config.members[0].host = host;
    config.version += 1;
    if (!admin.runCommand({ replSetReconfig: config, force: true }).ok) return 1;
  }
  return 0;
}
let exitCode = 1;
try { exitCode = bootstrapReplicaSet(); } catch { /* Do not print credential-bearing errors. */ }
quit(exitCode);
