// Turns the "Add MCP server" form into a `claude mcp add-json` call. Pure, unit-tested.

const SCOPES = ['local', 'project', 'user'];
const TYPES = ['stdio', 'http', 'sse'];

/** Split a command-line string into args, honoring "double" and 'single' quotes and \ escapes. */
function splitArgs(str) {
  const out = [];
  let cur = '', quote = null, has = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < str.length) cur += str[++i];
      else cur += c;
    } else if (c === '"' || c === "'") { quote = c; has = true; }
    else if (c === '\\' && i + 1 < str.length) { cur += str[++i]; has = true; }
    else if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; }
    else { cur += c; has = true; }
  }
  if (quote) throw new Error('Unclosed quote in arguments');
  if (cur || has) out.push(cur);
  return out;
}

/** "KEY=value" per line → object. Blank lines and # comments are skipped. */
function parsePairs(text, sep, what) {
  const out = {};
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(sep);
    if (i <= 0) throw new Error(`${what}: “${line}” should look like NAME${sep === '=' ? '=' : ': '}value`);
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    if (sep === '=' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`${what}: “${k}” is not a valid variable name`);
    out[k] = v;
  }
  return out;
}

/**
 * form: { name, type: 'stdio'|'http'|'sse', command, args, url, env, headers, scope }
 * returns { name, scope, config } where config is the JSON Claude Code stores.
 */
function buildServerConfig(form) {
  const name = String(form.name || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error('Name: use letters, numbers, - or _ (up to 64 characters).');
  const type = TYPES.includes(form.type) ? form.type : 'stdio';
  const scope = SCOPES.includes(form.scope) ? form.scope : 'local';
  let config;
  if (type === 'stdio') {
    const command = String(form.command || '').trim();
    if (!command) throw new Error('Command: enter the program to run, e.g. npx.');
    const parts = splitArgs(command);
    const args = [...parts.slice(1), ...splitArgs(String(form.args || ''))];
    config = { type: 'stdio', command: parts[0], args };
    const env = parsePairs(form.env, '=', 'Environment');
    if (Object.keys(env).length) config.env = env;
  } else {
    const url = String(form.url || '').trim();
    let u;
    try { u = new URL(url); } catch { throw new Error('URL: enter a full address starting with https://'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('URL: only http:// and https:// addresses work.');
    config = { type, url };
    const headers = parsePairs(form.headers, ':', 'Headers');
    if (Object.keys(headers).length) config.headers = headers;
  }
  return { name, scope, config };
}

/** argv for `claude` (no shell involved, so nothing needs escaping). */
function addArgs({ name, scope, config }) { return ['mcp', 'add-json', name, JSON.stringify(config), '--scope', scope]; }
function removeArgs(name, scope) {
  if (!/^[A-Za-z0-9_.:@ -]{1,128}$/.test(String(name))) throw new Error('Invalid server name');
  return ['mcp', 'remove', name, ...(SCOPES.includes(scope) ? ['--scope', scope] : [])];
}
/** Servers the user can remove from here (not claude.ai connectors, plugins or managed ones). */
const removable = scope => SCOPES.includes(scope);

const quoteArg = a => (/^[^\s"'\\]+$/.test(a) ? a : '"' + a.replace(/["\\]/g, '\\$&') + '"');

/** Stored config → the Add/Edit form's fields (inverse of buildServerConfig). */
function configToForm(name, scope, config = {}) {
  const type = TYPES.includes(config.type) ? config.type : (config.url ? 'http' : 'stdio');
  const pairs = (o, sep) => Object.entries(o || {}).map(([k, v]) => k + sep + v).join('\n');
  return {
    name, scope: SCOPES.includes(scope) ? scope : 'local', type,
    command: config.command ? quoteArg(config.command) : '',
    args: (config.args || []).map(quoteArg).join(' '),
    url: config.url || '', env: pairs(config.env, '='), headers: pairs(config.headers, ': '),
  };
}

/** Where Claude Code keeps a server's JSON: user/local in <configDir>/.claude.json (or ~/.claude.json), project in <cwd>/.mcp.json. */
function readServer(name, scope, cwd, { home, configDir, fs = require('fs'), path = require('path') }) {
  const load = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  let servers;
  if (scope === 'project') servers = (load(path.join(cwd, '.mcp.json')) || {}).mcpServers;
  else {
    const j = load(configDir ? path.join(configDir, '.claude.json') : path.join(home, '.claude.json')) || {};
    servers = scope === 'user' ? j.mcpServers : ((j.projects || {})[cwd] || {}).mcpServers;
  }
  const config = servers && servers[name];
  if (!config) throw new Error(`Could not find the settings of “${name}” (${scope}).`);
  return config;
}

/** Prompt asking Claude to write/rewrite a server config as JSON. Secrets are masked before sending. */
function mcpPrompt(request, current) {
  const mask = o => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v ? '***KEEP***' : v]));
  const cur = current && { ...current, config: { ...current.config, env: mask(current.config.env), headers: mask(current.config.headers) } };
  return (cur ? `Here is a Claude Code MCP server definition:\n${JSON.stringify(cur, null, 2)}\n\nApply this change: ${request}\n` : `Write a Claude Code MCP server definition for: ${request}\n`) +
    `\nReply with ONLY a JSON object, no fence, no commentary: {"name": "...", "config": {"type": "stdio", "command": "...", "args": [...], "env": {...}} } ` +
    `or {"name": "...", "config": {"type": "http"|"sse", "url": "...", "headers": {...}}}. Keep "***KEEP***" values unchanged. Use well-known official packages; never invent secrets — use "<YOUR_KEY>" placeholders.`;
}
function parseMcpReply(text) {
  const t = String(text || '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  let o; try { o = JSON.parse(t.slice(a, b + 1)); } catch { throw new Error('Claude did not return a valid server definition. Try rephrasing.'); }
  if (!o || typeof o.config !== 'object') throw new Error('Claude did not return a valid server definition. Try rephrasing.');
  return { name: String(o.name || ''), config: o.config };
}
/** Put masked secrets back from the old config. */
function unmask(config, old) {
  const fix = (o, prev) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '***KEEP***' ? (prev || {})[k] ?? '' : v]));
  return { ...config, env: fix(config.env, old && old.env), headers: fix(config.headers, old && old.headers) };
}

module.exports = { configToForm, readServer, mcpPrompt, parseMcpReply, unmask, splitArgs, parsePairs, buildServerConfig, addArgs, removeArgs, removable, SCOPES };
