// Automatic categorization rules + workspace naming.
const fs = require('fs');
const path = require('path');

const ANALYSIS_TEXT = /\bodev[\s-]+analy[sz]e|\banaly[sz]e\s+task\b|\btask\s+analysis\b|^\s*task\s+\d{6,}/i;
const ANALYSIS_SKILLS = ['odoo_task_analysis', 'odev-ai'];
const ODOO_PATH = /(^|[\/_-])(psbe|pshk|pslu|psae|psus|psin|odev|odoo|upgrade)([\/_.-]|$)/i;

const manifestCache = new Map();
function hasOdooManifest(dir) {
  if (!dir) return false;
  if (manifestCache.has(dir)) return manifestCache.get(dir);
  let found = false;
  try {
    const walk = (d, depth) => {
      if (found || depth > 2) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === '__manifest__.py') { found = true; return; }
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walk(path.join(d, e.name), depth + 1);
        if (found) return;
      }
    };
    walk(dir, 0);
  } catch { }
  manifestCache.set(dir, found);
  return found;
}

function autoCategory(meta, home) {
  const text = (meta.aiTitle || '') + ' ' + (meta.firstPrompt || '');
  if (ANALYSIS_TEXT.test(text) || meta.skills.some(s => ANALYSIS_SKILLS.some(a => s === a || s.endsWith(':' + a)))) return 'analysis';
  const cwd = meta.cwd;
  if (!cwd || cwd === home) return 'general';
  const rel = cwd.startsWith(home) ? cwd.slice(home.length) : cwd;
  if (ODOO_PATH.test(rel) || hasOdooManifest(cwd)) return 'odoo';
  return 'other';
}

/** Human workspace label: ".../psbe-custom/acme-textiles/19.0-acme-textiles-1234567-dev" -> {name:"acme-textiles", version:"19.0", task:"1234567"} */
function workspaceLabel(cwd, home) {
  if (!cwd) return { name: '~', version: null, task: null };
  if (cwd === home) return { name: '~', version: null, task: null };
  const base = path.basename(cwd);
  const m = base.match(/^(\d+\.\d+)-(.+?)(?:-(\d{6,}))?(?:-[a-z]+)?$/);
  if (m) {
    const parent = path.basename(path.dirname(cwd));
    const name = parent && parent !== 'psbe-custom' && !/^\d/.test(parent) ? parent : m[2];
    return { name, version: m[1], task: m[3] || null };
  }
  const wt = cwd.match(/worktrees\/(\d+\.\d+)$/);
  if (wt) return { name: 'odev worktree', version: wt[1], task: null };
  return { name: base, version: null, task: null };
}

module.exports = { autoCategory, workspaceLabel };
