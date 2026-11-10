// Live chat runs via the Claude Agent SDK. One run per chat; each run keeps a streaming-input
// query open so follow-up messages, interrupts and mode/model changes go to the same process.
const { EventEmitter } = require('events');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let sdkPromise;
const sdk = () => (sdkPromise ||= import('@anthropic-ai/claude-agent-sdk'));

function findClaude() {
  const candidates = [process.env.CLAUDE_BIN, path.join(os.homedir(), '.local/bin/claude'), '/usr/local/bin/claude', '/usr/bin/claude'];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  try { return execFileSync('bash', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim() || undefined; } catch { return undefined; }
}
const CLAUDE_BIN = findClaude();

/** Async queue usable as the SDK's streaming prompt. */
class Inbox {
  constructor() { this.items = []; this.waiters = []; this.closed = false; }
  push(v) { const w = this.waiters.shift(); if (w) w({ value: v, done: false }); else this.items.push(v); }
  close() { this.closed = true; for (const w of this.waiters.splice(0)) w({ value: undefined, done: true }); }
  [Symbol.asyncIterator]() {
    return { next: () => this.items.length ? Promise.resolve({ value: this.items.shift(), done: false })
      : this.closed ? Promise.resolve({ value: undefined, done: true }) : new Promise(r => this.waiters.push(r)) };
  }
}

const IDLE_CLOSE_MS = 15 * 60_000;

class ChatManager extends EventEmitter {
  constructor() { super(); this.runs = new Map(); this.pending = new Map(); }

  status() {
    const out = {};
    for (const [key, r] of this.runs) out[key] = { key, sessionId: r.sessionId, state: r.state, waiting: r.waitingIds.size > 0, cwd: r.cwd };
    return out;
  }
  runFor(sessionId) { for (const r of this.runs.values()) if (r.sessionId === sessionId || r.key === sessionId) return r; return null; }

  /** Send a message. Creates the run if needed. opts: {key, sessionId, cwd, model, effort, permissionMode, fork} */
  async send(opts, text, images = []) {
    // a fork must never reuse the original chat's live run; it gets its own run under its own key
    let run = opts.fork ? this.runs.get(opts.key) : opts.sessionId ? this.runFor(opts.sessionId) : this.runs.get(opts.key);
    if (run && run.state === 'ended') { this.runs.delete(run.key); run = null; }
    if (!run) run = await this.start(opts);
    const content = [];
    for (const img of images) content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
    content.push({ type: 'text', text });
    run.inbox.push({ type: 'user', message: { role: 'user', content: images.length ? content : text }, parent_tool_use_id: null });
    this.setState(run, 'running');
    this.touch(run);
    return { key: run.key };
  }

  async start(opts) {
    if (!CLAUDE_BIN) throw new Error('Claude Code is not installed (no `claude` command found). Install it from https://code.claude.com/docs, then restart this app.');
    const { query } = await sdk();
    const key = opts.sessionId && !opts.fork ? opts.sessionId : opts.key || ('new-' + Math.random().toString(36).slice(2, 10));
    const run = { key, sessionId: opts.fork ? null : opts.sessionId || null, cwd: opts.cwd, inbox: new Inbox(), state: 'starting', waitingIds: new Set(), abort: new AbortController() };
    this.runs.set(key, run);
    const options = {
      cwd: opts.cwd,
      abortController: run.abort,
      includePartialMessages: true,
      settingSources: ['user', 'project', 'local'],
      permissionMode: opts.permissionMode || 'default',
      canUseTool: (toolName, input, o) => this.askPermission(run, toolName, input, o),
    };
    if (opts.permissionMode === 'bypassPermissions') options.allowDangerouslySkipPermissions = true;
    if (CLAUDE_BIN) options.pathToClaudeCodeExecutable = CLAUDE_BIN;
    if (opts.sessionId) options.resume = opts.sessionId;
    if (opts.fork) options.forkSession = true;
    if (opts.model) options.model = opts.model;
    if (opts.effort) options.effort = opts.effort;
    run.q = query({ prompt: run.inbox, options });
    this.pump(run);
    return run;
  }

  async pump(run) {
    try {
      for await (const msg of run.q) {
        if (msg.session_id && !run.sessionId) { run.sessionId = msg.session_id; this.emit('session', { key: run.key, sessionId: run.sessionId }); }
        if (msg.type === 'system' && msg.subtype === 'init') { run.init = { model: msg.model, permissionMode: msg.permissionMode, slashCommands: msg.slash_commands, skills: msg.skills, mcp: msg.mcp_servers, tools: msg.tools, version: msg.claude_code_version }; }
        if (msg.type === 'result') { run.lastResult = msg; this.setState(run, 'idle'); this.emit('done', { key: run.key, sessionId: run.sessionId, isError: msg.is_error, result: msg }); }
        this.emit('event', { key: run.key, sessionId: run.sessionId, msg });
        this.touch(run);
      }
    } catch (e) {
      if (!run.abort.signal.aborted) this.emit('event', { key: run.key, sessionId: run.sessionId, msg: { type: 'app_error', message: String(e && e.message || e) } });
    }
    for (const id of run.waitingIds) { const p = this.pending.get(id); if (p) { p.resolve({ behavior: 'deny', message: 'Chat closed' }); this.pending.delete(id); } }
    run.waitingIds.clear();
    this.setState(run, 'ended');
    this.runs.delete(run.key);
    this.emit('status');
  }

  askPermission(run, toolName, input, o) {
    const id = Math.random().toString(36).slice(2);
    return new Promise(resolve => {
      this.pending.set(id, { resolve, run, input, suggestions: o.suggestions });
      run.waitingIds.add(id);
      this.setState(run, 'waiting');
      o.signal?.addEventListener('abort', () => { if (this.pending.has(id)) this.respond(id, { decision: 'deny', message: 'Cancelled' }); });
      this.emit('permission', { id, key: run.key, sessionId: run.sessionId, toolName, input, decisionReason: o.decisionReason, blockedPath: o.blockedPath, canAlways: !!(o.suggestions && o.suggestions.length), toolUseID: o.toolUseID });
    });
  }

  /** decision: allow | always | deny; answers: for AskUserQuestion; message: deny reason */
  respond(id, { decision, message, answers, updatedInput }) {
    const p = this.pending.get(id); if (!p) return false;
    this.pending.delete(id); p.run.waitingIds.delete(id);
    if (decision === 'deny') p.resolve({ behavior: 'deny', message: message || 'The user declined this action.' });
    else {
      const res = { behavior: 'allow', updatedInput: updatedInput || (answers ? { ...p.input, answers } : p.input) };
      if (decision === 'always' && p.suggestions) res.updatedPermissions = p.suggestions;
      p.resolve(res);
    }
    this.setState(p.run, p.run.waitingIds.size ? 'waiting' : 'running');
    this.emit('permission-done', { id, key: p.run.key });
    return true;
  }

  async interrupt(key) { const r = this.runs.get(key) || this.runFor(key); if (r && r.q) { try { await r.q.interrupt(); } catch { } } }
  async setMode(key, mode) { const r = this.runs.get(key) || this.runFor(key); if (r && r.q) await r.q.setPermissionMode(mode); }
  async setModel(key, model) { const r = this.runs.get(key) || this.runFor(key); if (r && r.q) await r.q.setModel(model || undefined); }
  close(key) { const r = this.runs.get(key) || this.runFor(key); if (r) { r.inbox.close(); try { r.q.close(); } catch { } } }
  closeAll() { for (const k of [...this.runs.keys()]) this.close(k); }

  setState(run, state) { if (run.state !== state) { run.state = state; this.emit('status'); } }
  touch(run) {
    clearTimeout(run.idleTimer);
    run.idleTimer = setTimeout(() => { if (run.state === 'idle') this.close(run.key); }, IDLE_CLOSE_MS);
    run.idleTimer.unref?.(); // never keep the process alive just for this
  }
}

module.exports = { ChatManager, sdk, CLAUDE_BIN };
