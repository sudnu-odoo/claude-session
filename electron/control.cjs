// Read-only Claude Code data for the app's panels (usage, commands, models, MCP, context).
// Uses idle SDK queries that never send a message: no cost, no session file.
const os = require('os');
const fs = require('fs');
const { sdk, CLAUDE_BIN } = require('./chat.cjs');

const IDLE_MS = 5 * 60_000;
const never = { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) }; } };

class Control {
  constructor(chat) { this.chat = chat; this.byKey = new Map(); this.cache = new Map(); }

  async open(key, extra = {}) {
    let c = this.byKey.get(key);
    if (!c) {
      if (!CLAUDE_BIN) throw new Error('Claude Code is not installed (no `claude` command found).');
      const { query } = await sdk();
      const options = { cwd: extra.cwd || os.homedir(), settingSources: ['user', 'project', 'local'], persistSession: false, ...extra };
      if (CLAUDE_BIN) options.pathToClaudeCodeExecutable = CLAUDE_BIN;
      c = { q: query({ prompt: never, options }) };
      this.byKey.set(key, c);
      if (this.byKey.size > 4) this.drop(this.byKey.keys().next().value);
    }
    clearTimeout(c.timer);
    c.timer = setTimeout(() => this.drop(key), IDLE_MS);
    return c.q;
  }
  drop(key) { const c = this.byKey.get(key); if (c) { clearTimeout(c.timer); try { c.q.close(); } catch { } this.byKey.delete(key); } }
  closeAll() { for (const k of [...this.byKey.keys()]) this.drop(k); }

  async cached(name, ttl, fn) {
    const hit = this.cache.get(name);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = await fn();
    this.cache.set(name, { at: Date.now(), value });
    return value;
  }

  /** A live chat's own query, if one is running for this session/key. */
  liveQuery(id) { const r = id && this.chat.runFor(id); return r && r.q && r.state !== 'ended' ? r.q : null; }

  account() { return this.cached('account', 10 * 60_000, async () => (await this.open('home')).accountInfo()); }

  usage(force) {
    if (force) this.cache.delete('usage');
    return this.cached('usage', 60_000, async () => {
      const q = await this.open('home');
      const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: false });
      return normalizeUsage(u);
    });
  }

  commands(cwd) {
    if (!cwd || !fs.existsSync(cwd)) cwd = os.homedir();
    return this.cached('cmds:' + cwd, 5 * 60_000, async () => {
      const q = await this.open('cwd:' + cwd, { cwd });
      const [list, init] = await Promise.all([q.supportedCommands(), q.initializationResult().catch(() => null)]);
      const terminal = new Set((init && (init.terminal_slash_commands || init.terminalSlashCommands)) || []);
      return list.map(c => ({ name: c.name, description: c.description || '', hint: c.argumentHint || '', aliases: c.aliases || [], builtin: !!c.builtin, terminal: terminal.has(c.name) }));
    });
  }

  models() { return this.cached('models', 30 * 60_000, async () => (await this.open('home')).supportedModels()); }

  async mcp(cwd, sessionId) {
    const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    const q = this.liveQuery(sessionId) || await this.open('cwd:' + dir, { cwd: dir });
    return q.mcpServerStatus();
  }

  async context(sessionId, cwd) {
    let q = this.liveQuery(sessionId);
    if (!q) {
      if (!sessionId || sessionId.startsWith('new-')) return null;
      if (!cwd || !fs.existsSync(cwd)) throw new Error('The chat folder no longer exists: ' + cwd);
      q = await this.open('ctx:' + sessionId, { cwd, resume: sessionId });
    }
    const c = await q.getContextUsage({ detail: 'full' });
    return {
      model: c.model, totalTokens: c.totalTokens, maxTokens: c.maxTokens, percentage: c.percentage,
      categories: (c.categories || []).map(x => ({ name: x.name, tokens: x.tokens, color: x.color })),
      memoryFiles: (c.memoryFiles || []).map(m => ({ path: m.path, tokens: m.tokens })),
      mcpTools: (c.mcpTools || []).length,
    };
  }
}

function win(w) { return w && w.utilization != null ? { pct: Math.round(w.utilization), resetsAt: w.resets_at || null } : null; }
function normalizeUsage(u) {
  const rl = u.rate_limits || {};
  const weeklyModels = [];
  if (rl.seven_day_opus) weeklyModels.push({ name: 'Opus', ...win(rl.seven_day_opus) });
  if (rl.seven_day_sonnet) weeklyModels.push({ name: 'Sonnet', ...win(rl.seven_day_sonnet) });
  for (const m of rl.model_scoped || []) if (m.utilization != null && !weeklyModels.some(x => x.name === m.display_name)) weeklyModels.push({ name: m.display_name, pct: Math.round(m.utilization), resetsAt: m.resets_at });
  const week = u.behaviors && (u.behaviors.week || u.behaviors.day);
  return {
    plan: u.subscription_type,
    available: !!u.rate_limits_available,
    session: win(rl.five_hour),
    weekly: win(rl.seven_day),
    weeklyModels: weeklyModels.filter(m => m.pct != null),
    extra: rl.extra_usage && rl.extra_usage.is_enabled ? { used: rl.extra_usage.used_credits, limit: rl.extra_usage.monthly_limit, pct: rl.extra_usage.utilization, currency: rl.extra_usage.currency } : null,
    tips: week && Array.isArray(week.recommendations) ? week.recommendations.slice(0, 5).map(r => ({ title: r.title, detail: r.detail || '', pct: r.pct })) : [],
    weekRequests: week && week.request_count, weekSessions: week && week.session_count,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { Control, normalizeUsage };
