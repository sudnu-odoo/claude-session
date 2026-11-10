// Skills management: list, read, create, save and delete Claude Code skills (SKILL.md files).
// User skills live in ~/.claude/skills/<name>/SKILL.md, project skills in <cwd>/.claude/skills/<name>/SKILL.md.
// Plugin skills are listed read-only. Pure helpers are exported for unit tests.
const fs = require('fs');
const path = require('path');
const os = require('os');

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function claudeDir() { return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'); }

function skillsRoot(scope, cwd) {
  if (scope === 'user') return path.join(claudeDir(), 'skills');
  if (scope === 'project') {
    if (!cwd) throw new Error('Pick a folder first: project skills live in <folder>/.claude/skills.');
    return path.join(cwd, '.claude', 'skills');
  }
  throw new Error('Unknown scope: ' + scope);
}

function validName(name) {
  const n = String(name || '').trim();
  if (!NAME_RE.test(n)) throw new Error('Skill name must be lowercase letters, digits and dashes (max 64), e.g. "pdf-tools".');
  return n;
}

/** Parse the YAML-ish frontmatter of a SKILL.md: returns { meta, body }. Only flat `key: value` lines. */
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(String(text || ''));
  if (!m) return { meta: {}, body: String(text || '') };
  const meta = {};
  let lastKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) { lastKey = kv[1]; meta[lastKey] = unquote(kv[2].trim()); }
    else if (lastKey && /^\s+\S/.test(line) && typeof meta[lastKey] === 'string') meta[lastKey] = (meta[lastKey] + ' ' + line.trim()).trim();
  }
  return { meta, body: text.slice(m[0].length) };
}
function unquote(v) { return /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v; }

/** Build a SKILL.md from name/description/instructions. */
function buildSkillMd({ name, description, body }) {
  const n = validName(name);
  const d = String(description || '').replace(/\s+/g, ' ').trim();
  if (!d) throw new Error('A description is required: Claude uses it to decide when to load the skill.');
  return `---\nname: ${n}\ndescription: ${JSON.stringify(d)}\n---\n\n${String(body || '').trim()}\n`;
}

/** Extract a SKILL.md from model output (strips a ``` fence if the model wrapped it). */
function extractSkillMd(text) {
  let t = String(text || '').trim();
  const fence = /```(?:markdown|md)?\s*\n([\s\S]*?)\n```/.exec(t);
  if (fence && fence[1].includes('---')) t = fence[1].trim();
  const i = t.indexOf('---');
  if (i > 0) t = t.slice(i);
  if (!t.startsWith('---')) throw new Error('Claude did not return a valid SKILL.md. Try rephrasing the prompt.');
  return t + '\n';
}

function readSkill(dir, scope, extra = {}) {
  const file = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(file)) return null;
  const { meta } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  return { name: meta.name || path.basename(dir), description: meta.description || '', scope, path: file, dir, editable: scope !== 'plugin', ...extra };
}

function listDir(root, scope, extra) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    try { const s = readSkill(path.join(root, e.name), scope, extra); if (s) out.push(s); } catch { }
  }
  return out;
}

function pluginSkills() {
  const cache = path.join(claudeDir(), 'plugins', 'cache');
  const out = [];
  const walk = (d, depth) => {
    if (depth > 5 || !fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(d, e.name);
      if (e.name === 'skills') out.push(...listDir(p, 'plugin', { plugin: path.basename(path.dirname(p)) }));
      else if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(p, depth + 1);
    }
  };
  try { walk(cache, 0); } catch { }
  const seen = new Set();
  return out.filter(s => { const k = s.plugin + ':' + s.name; if (seen.has(k)) return false; seen.add(k); return true; });
}

function list(cwd) {
  const user = listDir(skillsRoot('user'), 'user');
  const project = cwd && path.resolve(cwd) !== os.homedir() ? listDir(skillsRoot('project', cwd), 'project') : [];
  const by = (a, b) => a.name.localeCompare(b.name);
  return [...project.sort(by), ...user.sort(by), ...pluginSkills().sort(by)];
}

/** Only files under a known skills root may be read or written. */
function assertInside(file, cwd) {
  const roots = [skillsRoot('user'), path.join(claudeDir(), 'plugins')];
  if (cwd) roots.push(skillsRoot('project', cwd));
  const r = path.resolve(file);
  if (!roots.some(root => r.startsWith(path.resolve(root) + path.sep))) throw new Error('Not a skill file: ' + file);
  return r;
}

function read(file, cwd) { return fs.readFileSync(assertInside(file, cwd), 'utf8'); }

function create({ name, scope, content }, cwd) {
  const n = validName(name);
  const dir = path.join(skillsRoot(scope, cwd), n);
  if (fs.existsSync(dir)) throw new Error(`A ${scope} skill named "${n}" already exists.`);
  if (!String(content || '').startsWith('---')) throw new Error('SKILL.md must start with a --- frontmatter block.');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  return readSkill(dir, scope);
}

function save(file, content, cwd) {
  const f = assertInside(file, cwd);
  if (f.includes(path.sep + 'plugins' + path.sep)) throw new Error('Plugin skills are read-only.');
  fs.writeFileSync(f, content);
  return true;
}

function remove(file, cwd) {
  const f = assertInside(file, cwd);
  if (f.includes(path.sep + 'plugins' + path.sep)) throw new Error('Plugin skills are managed by their plugin and cannot be deleted here.');
  if (path.basename(f) !== 'SKILL.md') throw new Error('Not a SKILL.md');
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
  return true;
}

function generatePrompt(request, name) {
  return `Write a Claude Code skill file (SKILL.md) for this request:\n\n${request}\n\n` +
    `Rules:\n- Output ONLY the file content, no commentary, no code fence.\n- Start with YAML frontmatter between --- lines containing \`name: ${name || '<short-kebab-case-name>'}\` and a one-line \`description:\` that says what the skill does AND when Claude should use it.\n` +
    `- After the frontmatter, write clear, concise Markdown instructions for Claude (headings, steps, examples where useful).`;
}

function revisePrompt(current, request) {
  return `Here is a Claude Code skill file (SKILL.md):\n\n<skill>\n${current}\n</skill>\n\nApply this change:\n\n${request}\n\n` +
    `Rules:\n- Output ONLY the complete updated file content, no commentary, no code fence.\n- Keep the YAML frontmatter between --- lines and keep the same \`name:\` unless the change asks otherwise.\n- Change only what the request asks; keep everything else as it is.`;
}

module.exports = { revisePrompt, NAME_RE, validName, parseFrontmatter, buildSkillMd, extractSkillMd, list, read, create, save, remove, generatePrompt, skillsRoot };
