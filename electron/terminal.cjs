// Integrated terminals: one pseudo-terminal (your login shell) per tab, streamed to the window.
const fs = require('fs');
const os = require('os');

class Terminals {
  constructor(send) { this.send = send; this.byId = new Map(); this.seq = 0; }

  create({ cwd, cols = 80, rows = 24 } = {}) {
    const pty = require('node-pty'); // native: loaded only when a terminal is opened
    const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    const shell = process.env.SHELL || '/bin/bash';
    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'claude-sessions' };
    delete env.ELECTRON_RUN_AS_NODE;
    const p = pty.spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd: dir, env });
    const id = 't' + (++this.seq);
    this.byId.set(id, p);
    p.onData(data => this.send('term:data', { id, data }));
    p.onExit(({ exitCode }) => { this.byId.delete(id); this.send('term:exit', { id, exitCode }); });
    return { id, cwd: dir, shell };
  }
  write(id, data) { const p = this.byId.get(id); if (p) p.write(data); }
  resize(id, cols, rows) { const p = this.byId.get(id); if (p && cols > 0 && rows > 0) try { p.resize(cols, rows); } catch { } }
  kill(id) { const p = this.byId.get(id); if (p) { this.byId.delete(id); try { p.kill(); } catch { } } }
  killAll() { for (const id of [...this.byId.keys()]) this.kill(id); }
}

module.exports = { Terminals };
