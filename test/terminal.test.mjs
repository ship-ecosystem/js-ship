import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { run } from '../dist/process.js';
const ptyProbe = String.raw`
import os,pty,select,signal,sys,time,json,fcntl,termios,struct
pid,fd=pty.fork()
if pid==0:
 fcntl.ioctl(1,termios.TIOCSWINSZ,struct.pack("HHHH",40,120,0,0))
 os.chdir(sys.argv[2]); env=dict(os.environ); env['TERM']='xterm-256color'; env['CI']='false'; env.pop('NO_COLOR',None)
 os.execve(sys.argv[1],[sys.argv[1],sys.argv[3],'init'],env)
buffer=b''; cursor=0
try:
 def wait_for(text):
  global buffer,cursor
  deadline=time.time()+15
  while time.time()<deadline:
   if text in buffer[cursor:]: cursor=len(buffer); return
   if select.select([fd],[],[],0.1)[0]:
    try: buffer+=os.read(fd,65536)
    except OSError: break
  raise RuntimeError('prompt missing: '+text.decode()+' '+repr(buffer[-1000:]))
 wait_for(b'Application name'); os.write(fd,b'\r'); wait_for(b'Framework'); os.write(fd,b'\x15'); wait_for(b'Application name'); os.write(fd,b'\x03')
 deadline=time.time()+10; status=None
 while time.time()<deadline:
  if select.select([fd],[],[],0.1)[0]:
   try: buffer+=os.read(fd,65536)
   except OSError: pass
  ended,status=os.waitpid(pid,os.WNOHANG)
  if ended: break
 else: raise RuntimeError('cancel did not exit')
 print(json.dumps({'exit':os.waitstatus_to_exitcode(status),'alternate':b'\x1b[?1049h' in buffer,'restored':b'\x1b[?1049l' in buffer}))
finally:
 try: os.kill(pid,signal.SIGKILL)
 except ProcessLookupError: pass
 os.close(fd)
`;
test('rich terminal supports back/cancel and restores the alternate screen without project writes', { skip: process.platform !== 'linux' || process.env.SHIP_RESTRICTED_TEST === '1' }, async t => {
 const root = await mkdtemp(join(tmpdir(), 'ship-terminal-')); t.after(() => rm(root, { recursive: true, force: true }));
 await cp(resolve('examples/node'), root, { recursive: true });
 const before = await readdir(root);
 const result = JSON.parse(await run(['python', '-c', ptyProbe, process.execPath, root, resolve('dist/cli.js')], root, { capture: true }));
 assert.deepEqual(result, { exit: 130, alternate: true, restored: true });
 assert.deepEqual(await readdir(root), before);
});
