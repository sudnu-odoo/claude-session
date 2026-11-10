// Slash-command menu logic (pure, unit-tested).
// Built-in commands that open an app screen instead of being sent to Claude.
export const SCREENS = {
  usage: 'usage', cost: 'usage', stats: 'usage', 'extra-usage': 'usage',
  model: 'model', effort: 'model', fast: 'model',
  permissions: 'permissions', 'allowed-tools': 'permissions',
  context: 'context', mcp: 'mcp',
  resume: 'resume', continue: 'resume',
  config: 'settings', settings: 'settings', theme: 'settings',
};
export const TERMINAL_ONLY = new Set(['doctor', 'login', 'logout', 'hooks', 'agents', 'ide', 'terminal-setup', 'statusline', 'vim', 'exit', 'quit', 'bug', 'feedback', 'install-github-app', 'upgrade', 'release-notes', 'privacy-settings', 'keybindings', 'memory', 'add-dir', 'plugin', 'plugins', 'export', 'rewind', 'tasks', 'help', 'output-style', 'sandbox', 'status', 'remote-control', 'mobile', 'desktop', 'chrome', 'teleport', 'statusline']);

export function rankCommands(cmds, q) {
  q = q.toLowerCase();
  const scored = [];
  for (const c of cmds) {
    const n = c.name.toLowerCase();
    let sc = -1;
    if (!q) sc = 1;
    else if (n === q || c.aliases.includes(q)) sc = 100;
    else if (n.startsWith(q)) sc = 80;
    else if (n.split(/[:_-]/).some(p => p.startsWith(q))) sc = 60;
    else if (n.includes(q)) sc = 40;
    else if (c.description.toLowerCase().includes(q)) sc = 10;
    if (sc >= 0) scored.push({ c, sc });
  }
  return scored.sort((a, b) => b.sc - a.sc || a.c.name.localeCompare(b.c.name)).map(x => x.c);
}
export function groupOf(c) {
  if (c.builtin && SCREENS[c.name]) return 'App screens';
  if (c.builtin && (c.terminal || TERMINAL_ONLY.has(c.name))) return 'Terminal only';
  if (c.builtin) return 'Built-in';
  return c.name.includes(':') ? 'Plugins' : 'Your skills & commands';
}
export const GROUP_ORDER = ['App screens', 'Your skills & commands', 'Plugins', 'Built-in', 'Terminal only'];
