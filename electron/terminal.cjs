// Integrated terminals: one pseudo-terminal (your login shell) per tab, streamed to the window.
const fs = require('fs');
const os = require('os');

// Nerd Fonts first, so prompt icons (Starship, Powerlevel10k, git glyphs) render instead of boxes.
const DEFAULT_FONT = "'JetBrainsMono Nerd Font', 'JetBrainsMono Nerd Font Mono', 'MesloLGS NF', 'FiraCode Nerd Font', 'FiraMono Nerd Font', 'Hack Nerd Font', 'Symbols Nerd Font Mono', 'Symbols Nerd Font', 'JetBrains Mono', monospace";

/** The terminal font/size the user set in VS Code (settings.json is JSONC, so read the keys with a regex), else defaults. */
function terminalFont(home = os.homedir(), read = f => fs.readFileSync(f, 'utf8')) {
  const out = { fontFamily: DEFAULT_FONT, fontSize: 13, source: 'default' };
  for (const dir of ['Code', 'Code - Insiders', 'VSCodium']) {
    let text;
    try { text = read(`${home}/.config/${dir}/User/settings.json`); } catch { continue; }
    const fam = /"terminal\.integrated\.fontFamily"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
    const size = /"terminal\.integrated\.fontSize"\s*:\s*(\d+(?:\.\d+)?)/.exec(text);
    if (fam && fam[1].trim()) { const mine = fam[1].replace(/\\"/g, '"').split(',').map(x => x.trim()).filter(x => x && !/^(monospace|sans-serif|serif)$/i.test(x));
      out.fontFamily = [...mine, DEFAULT_FONT].join(', '); out.source = dir; }
    if (size) out.fontSize = Math.min(32, Math.max(8, Number(size[1])));
    if (fam || size) break;
  }
  return out;
}

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

module.exports = { Terminals, terminalFont, DEFAULT_FONT };
