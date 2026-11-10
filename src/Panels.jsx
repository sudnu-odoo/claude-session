import React, { useEffect, useState } from 'react';
import { api, Modal } from './ui.jsx';
import { MODES, EFFORTS } from './Composer.jsx';

const clean = e => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

import { resetText } from './format.mjs';
export { resetText };
const level = p => (p >= 90 ? ' hot' : p >= 70 ? ' warm' : '');
const planName = p => (p ? p[0].toUpperCase() + p.slice(1) + ' plan' : 'API key');

function Bar({ label, pct, resetsAt, calm }) {
  return (
    <div className="lim">
      <div className="row"><span>{label}</span><small>{pct}% used{resetsAt ? ' · ' + resetText(resetsAt) : ''}</small></div>
      <div className={'bar2' + (calm ? ' calm' : '') + level(pct)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}><i style={{ width: Math.min(100, pct) + '%' }} /></div>
    </div>
  );
}

function useLoad(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const run = async (...a) => { setState(s => ({ ...s, loading: true, error: null })); try { setState({ loading: false, data: await fn(...a), error: null }); } catch (e) { setState({ loading: false, data: null, error: clean(e) }); } };
  useEffect(() => { run(); }, deps);
  return [state, run];
}
const Loading = ({ what }) => <div className="notice" style={{ padding: 24 }}><span className="spin">✻</span> Reading {what}…</div>;
const Err = ({ msg }) => <div className="errbox">{msg}</div>;

export function UsagePanel({ data, account, onClose }) {
  const [{ loading, data: u, error }, reload] = useLoad(force => api.info.usage(!!force), []);
  const weekAgo = Date.now() - 7 * 864e5;
  const week = data.sessions.filter(s => new Date(s.updated) > weekAgo);
  const spent = week.reduce((a, s) => a + (s.cost || 0), 0);
  return (
    <Modal onClose={onClose}>
      <h2>Usage</h2>
      <div className="sub">{u ? planName(u.plan) : account?.subscriptionType || ''}{account?.email ? ' · ' + account.email : ''}</div>
      {loading && !u && <Loading what="your plan limits" />}
      {error && <Err msg={error} />}
      {u && !u.available && <div className="sub">Plan limits don't apply to this login (API key or cloud provider).</div>}
      {u?.session && <Bar label="Current session" pct={u.session.pct} resetsAt={u.session.resetsAt} />}
      {u?.weekly && <Bar label="Weekly · all models" pct={u.weekly.pct} resetsAt={u.weekly.resetsAt} />}
      {u?.weeklyModels.map(m => <Bar key={m.name} label={'Weekly · ' + m.name} pct={m.pct} resetsAt={m.resetsAt} calm />)}
      {u?.extra && <Bar label="Extra usage this month" pct={Math.round(u.extra.pct || 0)} calm />}
      <div className="grid2">
        <div className="stat"><b>${spent.toFixed(2)}</b><small>estimated cost of chats active this week</small></div>
        <div className="stat"><b>{week.length}</b><small>chats active this week</small></div>
      </div>
      {u?.tips?.length > 0 && <>
        <h3>What's using your limits this week</h3>
        <div className="tips">
          {u.tips.map((t, i) => <div key={i} className="tip"><span className="tp">{t.pct}%</span><span><b>{t.title}</b>{t.detail && <small> {t.detail}</small>}</span></div>)}
        </div>
        <div className="sub" style={{ marginTop: 6 }}>Shares overlap, so they don't add up to 100%. Based on this computer's chats only.</div>
      </>}
      <div className="acts">
        {u && <span className="sub" style={{ marginRight: 'auto', alignSelf: 'center' }}>Updated {new Date(u.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
        <button className="b" disabled={loading} onClick={() => reload(true)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        <button className="b pri" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

export function ModelPanel({ prefs, setPrefs, onClose }) {
  const [{ loading, data: models, error }] = useLoad(() => api.info.models(), []);
  return (
    <Modal onClose={onClose}>
      <h2>Model</h2>
      <div className="sub">Applies to the chat you're in and to new chats.</div>
      {loading && <Loading what="available models" />}
      {error && <Err msg={error} />}
      <div className="move-list">
        {(models || []).map(m => {
          const id = m.value === 'default' ? '' : m.value;
          return (
            <div key={m.value} className={'opt' + (prefs.model === id ? ' cur-opt' : '')} onClick={() => setPrefs({ model: id })}>
              <span style={{ flex: 1, minWidth: 0 }}><b>{m.displayName}</b><br /><span className="muted">{m.description}</span></span>
              {prefs.model === id && <span className="cur">✓</span>}
            </div>
          );
        })}
      </div>
      <h3>Effort</h3>
      <div className="seg" role="radiogroup" aria-label="Effort">
        {EFFORTS.map(e => <button key={e || 'd'} role="radio" aria-checked={prefs.effort === e} className={prefs.effort === e ? 'on' : ''} onClick={() => setPrefs({ effort: e })}>{e || 'Default'}</button>)}
      </div>
      <div className="sub" style={{ marginTop: 6 }}>Higher effort thinks longer and uses more of your limits. Effort changes take effect from the next chat you start or resume.</div>
      <div className="acts"><button className="b pri" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

export function PermissionsPanel({ prefs, onMode, onClose }) {
  return (
    <Modal onClose={onClose}>
      <h2>Permissions</h2>
      <div className="sub">How much Claude may do without asking. Shift+Tab in the message box cycles the first four.</div>
      <div className="move-list">
        {MODES.map(m => (
          <div key={m.id} className={'opt' + (prefs.mode === m.id ? ' cur-opt' : '')} onClick={() => onMode(m.id)}>
            <span style={{ flex: 1 }}><b>{m.label}</b><br /><span className="muted">{m.desc}</span></span>
            {prefs.mode === m.id && <span className="cur">✓</span>}
          </div>
        ))}
      </div>
      <div className="sub" style={{ marginTop: 10 }}>Allow and deny rules come from your Claude Code settings files and from “Always allow” in this app.</div>
      <div className="acts"><button className="b pri" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

const CTX_COLORS = ['#c96442', '#7c5cbf', '#2f80c4', '#3f8f6a', '#b8862d', '#b04d74', '#4f9a8a'];
export function ContextPanel({ session, cwd, onClose }) {
  const [{ loading, data: c, error }] = useLoad(() => (session ? api.info.context(session.id, cwd) : Promise.resolve(null)), [session?.id]);
  const used = c ? c.categories.filter(x => !/free space/i.test(x.name)) : [];
  return (
    <Modal onClose={onClose}>
      <h2>Context</h2>
      <div className="sub">{session ? 'How full this chat\'s context window is.' : 'Send a first message, then check again.'}</div>
      {loading && session && <Loading what="this chat's context" />}
      {error && <Err msg={error} />}
      {c && <>
        <Bar label={`${Math.round(c.totalTokens / 1000)}k of ${Math.round(c.maxTokens / 1000)}k tokens · ${c.model}`} pct={Math.round(c.percentage)} />
        <div className="stack" aria-hidden="true">
          {used.map((x, i) => <i key={x.name} style={{ width: (x.tokens / c.maxTokens * 100) + '%', background: CTX_COLORS[i % CTX_COLORS.length] }} />)}
        </div>
        <div className="legend">
          {used.map((x, i) => <div key={x.name}><span className="dot" style={{ background: CTX_COLORS[i % CTX_COLORS.length] }} />{x.name}<span className="v">{(x.tokens / 1000).toFixed(1)}k</span></div>)}
        </div>
        {c.memoryFiles.length > 0 && <><h3>Memory files</h3>{c.memoryFiles.map(m => <div key={m.path} className="kv"><code>{m.path}</code><span>{(m.tokens / 1000).toFixed(1)}k</span></div>)}</>}
        {c.percentage >= 60 && <div className="sub" style={{ marginTop: 10 }}>Getting full. Type <code>/compact</code> to summarize earlier messages and free space.</div>}
      </>}
      <div className="acts"><button className="b pri" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

const MCP_LABEL = { connected: 'Connected', pending: 'Connecting…', failed: 'Failed', 'needs-auth': 'Needs sign-in', disabled: 'Disabled' };
const SCOPE_LABEL = { local: 'this folder, only you', project: 'this folder, shared via .mcp.json', user: 'all your folders' };
const REMOVABLE = ['local', 'project', 'user'];

function AddMcpForm({ cwd, initial, editing, onDone, onCancel }) {
  const [f, setF] = useState(initial || { name: '', type: 'stdio', command: '', args: '', url: '', env: '', headers: '', scope: 'local' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [how, setHow] = useState('manual');
  const [ask, setAsk] = useState('');
  const [note, setNote] = useState(null);
  const set = p => { setF(x => ({ ...x, ...p })); setErr(null); };
  const save = async () => {
    setBusy(true); setErr(null);
    try { editing ? await api.info.mcpUpdate(editing.name, editing.scope, f, cwd) : await api.info.mcpAdd(f, cwd); onDone(f.name); } catch (e) { setErr(clean(e)); }
    setBusy(false);
  };
  const askClaude = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.info.mcpAsk(ask, editing || null, cwd);
      setF(x => ({ ...r, scope: x.scope })); setHow('manual');
      setNote('Claude filled in the form below. Check it (replace any <YOUR_KEY> placeholders), then save.');
    } catch (e) { setErr(clean(e)); }
    setBusy(false);
  };
  const remote = f.type !== 'stdio';
  return (
    <div className="mcpform">
      <div className="seg" role="radiogroup" aria-label="How" style={{ alignSelf: 'flex-start' }}>
        {[['prompt', editing ? 'Ask Claude to change it' : 'Describe it to Claude'], ['manual', editing ? 'Edit it myself' : 'Fill in myself']].map(([v, l]) =>
          <button key={v} role="radio" aria-checked={how === v} className={how === v ? 'on' : ''} onClick={() => setHow(v)}>{l}</button>)}
      </div>
      {how === 'prompt' ? <>
        <label>{editing ? 'What should change?' : 'Which server do you want?'}
          <textarea autoFocus rows={3} value={ask} onChange={e => setAsk(e.target.value)}
            placeholder={editing ? 'e.g. Point it at /home/me/projects instead and add --read-only' : 'e.g. The official GitHub MCP server, run with npx'} /></label>
        <div className="sub" style={{ margin: 0 }}>Claude fills in the form for you to review. Secret values (env, headers) are hidden from Claude and kept as they are.</div>
        <div><button className="b" onClick={askClaude} disabled={busy || !ask.trim()}>{busy ? 'Claude is working…' : 'Apply with Claude'}</button></div>
      </> : <>
      {note && <div className="sub" style={{ margin: 0 }}>{note}</div>}
      <label>Name<input value={f.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. odoo-docs" spellCheck={false} /></label>
      <div className="lbl">Type</div>
      <div className="seg" role="radiogroup" aria-label="Server type">
        {[['stdio', 'Local command'], ['http', 'Remote (HTTP)'], ['sse', 'Remote (SSE)']].map(([v, l]) =>
          <button key={v} role="radio" aria-checked={f.type === v} className={f.type === v ? 'on' : ''} onClick={() => set({ type: v })}>{l}</button>)}
      </div>
      {!remote ? <>
        <label>Command<input value={f.command} onChange={e => set({ command: e.target.value })} placeholder="npx -y @modelcontextprotocol/server-filesystem" spellCheck={false} className="mono" /></label>
        <label>Extra arguments <span className="opt">optional</span><input value={f.args} onChange={e => set({ args: e.target.value })} placeholder='/home/me/docs "folder with spaces"' spellCheck={false} className="mono" /></label>
        <label>Environment variables <span className="opt">optional, one per line</span><textarea rows={3} value={f.env} onChange={e => set({ env: e.target.value })} placeholder="API_KEY=…" spellCheck={false} className="mono" /></label>
      </> : <>
        <label>URL<input value={f.url} onChange={e => set({ url: e.target.value })} placeholder="https://mcp.example.com/mcp" spellCheck={false} className="mono" /></label>
        <label>Headers <span className="opt">optional, one per line</span><textarea rows={3} value={f.headers} onChange={e => set({ headers: e.target.value })} placeholder="Authorization: Bearer …" spellCheck={false} className="mono" /></label>
      </>}
      </>}
      <label>Available in
        <select value={f.scope} onChange={e => set({ scope: e.target.value })}>
          <option value="local">This folder only (just you)</option>
          <option value="project">This folder, shared with the team (.mcp.json)</option>
          <option value="user">All my folders</option>
        </select>
      </label>
      <div className="sub" style={{ marginTop: 2 }}>Folder: <code>{cwd}</code>. Saved with <code>claude mcp add-json</code>, so the terminal and VS Code see it too. New chats pick it up; running chats need a restart.</div>
      {err && <div className="errbox">{err}</div>}
      <div className="acts">
        <button className="b" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="b pri" onClick={save} disabled={busy || how === 'prompt' || !f.name.trim() || (remote ? !f.url.trim() : !f.command.trim())}>{editing ? 'Save changes' : 'Add server'}</button>
      </div>
    </div>
  );
}

export function McpPanel({ cwd, sessionId, onClose, toast }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // { server, form }
  const [{ loading, data: list, error }, reload] = useLoad(() => api.info.mcp(cwd, sessionId), [cwd]);
  const edit = async s => { try { setEditing({ server: s, form: await api.info.mcpGet(s.name, s.scope, cwd) }); } catch (e) { alert(clean(e)); } };
  const remove = async s => {
    if (!confirm(`Remove the MCP server “${s.name}” (${SCOPE_LABEL[s.scope] || s.scope})?`)) return;
    try { await api.info.mcpRemove(s.name, s.scope, cwd); toast?.(`Removed ${s.name}`); reload(); } catch (e) { alert(clean(e)); }
  };
  if (editing) return (
    <Modal onClose={() => setEditing(null)} className="modal wide">
      <h2>Edit {editing.server.name}</h2>
      <div className="sub">Saved by removing and re-adding the server with <code>claude mcp</code>. If saving fails, the old settings are restored.</div>
      <AddMcpForm cwd={cwd} initial={editing.form} editing={{ name: editing.server.name, scope: editing.server.scope }}
        onCancel={() => setEditing(null)} onDone={name => { setEditing(null); toast?.(`Saved ${name}. New chats use the new settings.`); reload(); }} />
    </Modal>
  );
  if (adding) return (
    <Modal onClose={() => setAdding(false)} className="modal wide">
      <h2>Add MCP server</h2>
      <div className="sub">Connect Claude to another tool or data source.</div>
      <AddMcpForm cwd={cwd} onCancel={() => setAdding(false)} onDone={name => { setAdding(false); toast?.(`Added ${name}`); reload(); }} />
    </Modal>
  );
  return (
    <Modal onClose={onClose}>
      <h2>MCP servers</h2>
      <div className="sub">Servers available to chats in this folder.</div>
      {loading && <Loading what="MCP servers" />}
      {error && <Err msg={error} />}
      <div className="move-list">
        {(list || []).map(s => (
          <div key={s.name} className="opt mcprow" style={{ cursor: 'default' }}>
            <span className={'mcpdot st-' + s.status} />
            <span style={{ flex: 1, minWidth: 0 }}><b>{s.name}</b>{s.scope && <span className="muted"> · {SCOPE_LABEL[s.scope] || s.scope}</span>}{s.error && <><br /><span className="muted">{s.error}</span></>}</span>
            <span className="cur">{MCP_LABEL[s.status] || s.status}</span>
            {REMOVABLE.includes(s.scope) && <button className="ibtn rm ed" title={'Edit ' + s.name} onClick={() => edit(s)}>Edit</button>}
            {REMOVABLE.includes(s.scope) && <button className="ibtn rm" title={'Remove ' + s.name} onClick={() => remove(s)}>Remove</button>}
          </div>
        ))}
        {list && !list.length && <div className="sub">No MCP servers configured.</div>}
      </div>
      {list?.some(s => s.status === 'needs-auth') && <div className="sub" style={{ marginTop: 8 }}>Servers that need sign-in are authorized in claude.ai connector settings or with <code>/mcp</code> in a terminal session.</div>}
      <div className="acts">
        <button className="b" style={{ marginRight: 'auto' }} onClick={() => setAdding(true)}>+ Add server</button>
        <button className="b" onClick={() => reload()}>Refresh</button><button className="b pri" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
