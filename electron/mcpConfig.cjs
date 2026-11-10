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

module.exports = { splitArgs, parsePairs, buildServerConfig, addArgs, removeArgs, removable, SCOPES };
