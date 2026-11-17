const name = process.env.MONGO_INITDB_DATABASE;
if (!name || ['admin', 'config', 'local'].includes(name)) throw new Error('Choose an application MongoDB database, not admin/config/local.');
if (!process.env.SHIP_MONGO_USER || !process.env.SHIP_MONGO_PASSWORD) throw new Error('MongoDB application credentials are required.');
db.getSiblingDB(name).createUser({ user: process.env.SHIP_MONGO_USER, pwd: process.env.SHIP_MONGO_PASSWORD, roles: [{ role: 'readWrite', db: name }] });
