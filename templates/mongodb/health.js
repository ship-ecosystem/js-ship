function healthStatus() {
  const uri = 'mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=1000&connectTimeoutMS=1000';
  const connection = new Mongo(uri);
  const admin = connection.getDB('admin');
  const rootAuth = admin.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
  if (rootAuth !== true && rootAuth !== 1 && rootAuth?.ok !== 1) return 1;
  const options = admin.runCommand({ getCmdLineOpts: 1 });
  if (options.parsed?.security?.authorization !== 'enabled') return 1; // temporary initialization is not readiness
  const app = new Mongo(uri).getDB(process.env.MONGO_INITDB_DATABASE);
  const appAuth = app.auth(process.env.SHIP_MONGO_USER, process.env.SHIP_MONGO_PASSWORD);
  if (appAuth !== true && appAuth !== 1 && appAuth?.ok !== 1) return 1;
  if (!app.runCommand({ ping: 1 }).ok) return 1;
  if (process.env.SHIP_MONGO_MODE === 'replica-set' && !app.adminCommand({ hello: 1 }).isWritablePrimary) return 1;
  return 0;
}
let exitCode = 1;
try { exitCode = healthStatus(); } catch { /* Health output must not contain credentials. */ }
quit(exitCode);
