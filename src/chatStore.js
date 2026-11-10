// Live chat state in the renderer, fed by events from the main process.
import { useEffect, useReducer } from 'react';

const api = window.cc;
const runs = new Map();       // key -> run state
const alias = new Map();      // sessionId -> key
const listeners = new Set();
const notify = () => { for (const l of listeners) l(); };

function blank(key) {
  return { key, sessionId: null, state: 'idle', live: [], draft: '', perms: [], error: null, init: null, result: null, version: 0 };
}
export function getRun(keyOrSession) {
  if (!keyOrSession) return null;
  return runs.get(keyOrSession) || runs.get(alias.get(keyOrSession)) || null;
}
function ensure(key) { let r = runs.get(key); if (!r) { r = blank(key); runs.set(key, r); } return r; }
function bump(r) { r.version++; notify(); }

function resultText(c) {
  const t = typeof c === 'string' ? c : (c || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
  return t.length > 4000 ? t.slice(0, 4000) + '\n… (truncated)' : t;
}
function summary(input) {
  input = input || {};
  return String(input.description || input.command || input.file_path || input.pattern || input.query || input.url || input.skill || input.prompt || '').slice(0, 300);
}

function onEvent({ key, sessionId, msg }) {
  const r = ensure(key);
  if (sessionId) { r.sessionId = sessionId; alias.set(sessionId, key); }
  if (msg.type === 'stream_event') {
    const ev = msg.event;
    if (msg.parent_tool_use_id) return;
    if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { r.draft += ev.delta.text; bump(r); }
    return;
  }
  if (msg.parent_tool_use_id) return; // subagent internals
  if (msg.type === 'system' && msg.subtype === 'init') { r.init = msg; bump(r); return; }
  if (msg.type === 'assistant') {
    const blocks = [];
    for (const b of msg.message?.content || []) {
      if (b.type === 'text' && b.text.trim()) blocks.push({ type: 'text', text: b.text });
      else if (b.type === 'tool_use') blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input, summary: summary(b.input) });
    }
    r.draft = '';
    if (blocks.length) {
      const last = r.live[r.live.length - 1];
      if (last && last.role === 'assistant') last.blocks = [...last.blocks, ...blocks];
      else r.live.push({ role: 'assistant', idx: 'live-' + r.live.length, blocks });
    }
    bump(r); return;
  }
  if (msg.type === 'user') {
    const c = msg.message?.content;
    if (Array.isArray(c)) for (const b of c) if (b.type === 'tool_result') {
      for (const m of r.live) for (const tb of m.blocks) if (tb.id === b.tool_use_id) { tb.result = resultText(b.content); tb.isError = !!b.is_error; }
    }
    bump(r); return;
  }
  if (msg.type === 'result') { r.result = msg; r.draft = ''; if (msg.is_error && msg.result) r.error = msg.result; bump(r); return; }
  if (msg.type === 'app_error') { r.error = msg.message; bump(r); }
}

let wired = false;
function wire() {
  if (wired) return; wired = true;
  api.on('chat:event', onEvent);
  api.on('chat:status', st => {
    for (const r of runs.values()) { const s = st[r.key]; r.state = s ? s.state : (r.state === 'idle' ? 'idle' : 'ended'); }
    for (const s of Object.values(st)) { const r = ensure(s.key); r.state = s.state; if (s.sessionId) { r.sessionId = s.sessionId; alias.set(s.sessionId, s.key); } }
    notify();
  });
  api.on('chat:session', ({ key, sessionId }) => { const r = ensure(key); r.sessionId = sessionId; alias.set(sessionId, key); notify(); });
  api.on('chat:permission', p => { const r = ensure(p.key); r.perms = [...r.perms.filter(x => x.id !== p.id), p]; bump(r); });
  api.on('chat:permission-done', ({ id, key }) => { const r = ensure(key); r.perms = r.perms.filter(x => x.id !== id); bump(r); });
  api.chat.pending().then(list => { for (const p of list) { const r = ensure(p.key); if (!r.perms.some(x => x.id === p.id)) r.perms.push(p); } notify(); });
}

export const chatActions = {
  async send({ key, sessionId, cwd, model, effort, permissionMode, fork, baseTotal }, text, images) {
    const res = await api.chat.send({ key, sessionId, cwd, model, effort, permissionMode, fork }, text, images);
    const r = ensure(res.key);
    if (sessionId && !fork) alias.set(sessionId, res.key);
    r.error = null; r.state = 'running';
    if (!r.live.length || r.baseTotal == null) r.baseTotal = baseTotal ?? 0;
    r.live.push({ role: 'user', idx: 'live-' + r.live.length, blocks: [{ type: 'text', text }], images: images?.length || 0 });
    bump(r);
    return res.key;
  },
  respond(perm, answer) { return api.chat.respond(perm.id, answer); },
  interrupt(key) { return api.chat.interrupt(key); },
  setMode(key, mode) { return api.chat.setMode(key, mode); },
  setModel(key, model) { return api.chat.setModel(key, model); },
  clearLive(key) { const r = runs.get(key); if (r) { r.live = []; r.draft = ''; r.error = null; r.baseTotal = null; bump(r); } },
};

export function useChat(keyOrSession) {
  wire();
  const [, force] = useReducer(x => x + 1, 0);
  useEffect(() => { listeners.add(force); return () => listeners.delete(force); }, []);
  return getRun(keyOrSession);
}
export function useAllRuns() {
  wire();
  const [, force] = useReducer(x => x + 1, 0);
  useEffect(() => { listeners.add(force); return () => listeners.delete(force); }, []);
  return runs;
}
