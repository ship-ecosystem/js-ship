import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export function applicationEnvironment(input) {
  const env = { ...input };
  for (const key of Object.keys(env).filter(key => /^(?:[A-Z][A-Z0-9_]*_)?MONGODB_HOST$/.test(key))) {
    const prefix = key.slice(0, -'MONGODB_HOST'.length);
    const get = name => env[prefix + 'MONGODB_' + name];
    if (!get('HOST') || !get('DATABASE') || !get('USER') || !get('PASSWORD')) throw new Error(`${prefix}MongoDB connection variables are incomplete.`);
    const host = get('HOST'), port = get('PORT') ?? '27017';
    if (!/^[a-zA-Z0-9_.-]+$/.test(host) || !/^\d+$/.test(port)) throw new Error(`${prefix}MongoDB host/port is invalid.`);
    const query = new URLSearchParams({ authSource: get('DATABASE'), directConnection: 'true' });
    if (get('REPLICA_SET')) query.set('replicaSet', get('REPLICA_SET'));
    env[prefix + 'MONGODB_URI'] = `mongodb://${encode(get('USER'))}:${encode(get('PASSWORD'))}@${host}:${port}/${encode(get('DATABASE'))}?${query}`;
    delete env[prefix + 'MONGODB_ROOT_PASSWORD'];
  }
  return env;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (!command) throw new Error('Application command is required.');
    // A dedicated group keeps npm, shells and their foreground descendants under
    // the same shutdown boundary without signaling unrelated container execs.
    // Interactive execs retain their existing controlling terminal/job control.
    const group = process.platform !== 'win32' && !process.stdin.isTTY;
    const child = spawn(command, args, { env: applicationEnvironment(process.env), stdio: 'inherit', shell: false, detached: group });
    let stopping = false;
    const send = signal => {
      if (!child.pid) return;
      try { if (group) process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const alive = () => {
      if (!group || !child.pid) return false;
      try { process.kill(-child.pid, 0); return true; }
      catch (error) { if (error.code === 'ESRCH') return false; throw error; }
    };
    const forward = signal => { stopping = true; send(signal); };
    const onInt = () => forward('SIGINT'), onTerm = () => forward('SIGTERM');
    process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
    child.once('error', () => { console.error('ship: Could not start the application command.'); process.exitCode = 1; });
    child.once('close', async (code, signal) => {
      // Shells can exit before their children finish draining. Keep PID 1's
      // supervised child alive until the group exits, including after a crash.
      if (alive()) {
        if (!stopping) send('SIGTERM');
        const deadline = Date.now() + 60_000;
        while (alive() && Date.now() < deadline) await delay(25);
        if (alive()) send('SIGKILL');
      }
      process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
      process.exitCode = code !== null && code >= 0 ? code : (signal ? 128 + (constants.signals[signal] ?? 1) : 1);
    });
  } catch (error) { console.error(`ship: ${error.message}`); process.exitCode = 1; }
}
