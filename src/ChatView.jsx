import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api, Icon, rel, shortPath } from './ui.jsx';
import { useChat, chatActions } from './chatStore.js';
import Composer from './Composer.jsx';
import PermissionCard from './PermissionCard.jsx';

marked.setOptions({ gfm: true, breaks: false });
const Markdown = memo(({ text }) => <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(text || '')) }} />);

function ToolBlock({ b, live }) {
  const [open, setOpen] = useState(false);
  const i = b.input || {};
  let status = null;
  if (b.result != null) status = b.isError ? <span className="st bad">✗ error</span> : <span className="st ok">✓</span>;
  else if (live) status = <span className="st"><span className="spin">✻</span></span>;
  if (b.name === 'Edit' && i.old_string != null && b.result != null) {
    const add = String(i.new_string || '').split('\n').length, del = String(i.old_string || '').split('\n').length;
    status = <span className={'st ' + (b.isError ? 'bad' : 'ok')}>{b.isError ? '✗ ' : ''}+{add} −{del}</span>;
  }
  let body = null;
  if (open) {
    if (b.name === 'Edit' && i.old_string != null) body = <pre>{String(i.old_string).split('\n').map((l, k) => <div key={'d' + k} className="diff-del">- {l}</div>)}{String(i.new_string).split('\n').map((l, k) => <div key={'a' + k} className="diff-add">+ {l}</div>)}</pre>;
    else if (b.name === 'Write' && i.content != null) body = <pre>{i.content}</pre>;
    else if (b.name === 'Bash') body = <pre>$ {i.command}</pre>;
    else body = <pre>{JSON.stringify(i, null, 2)}</pre>;
  }
  return (
    <div className="tool">
      <div className="h" onClick={() => setOpen(!open)}><b>{b.name}</b><span className="s">{b.summary}</span>{status}</div>
      {body}
      {open && b.result != null && b.name !== 'Edit' && <pre>{b.result || '(no output)'}</pre>}
    </div>
  );
}

const Message = memo(function Message({ m, highlight, live }) {
  if (m.role === 'user') {
    return <div className={'u' + (highlight ? ' hl' : '')} data-idx={m.idx}><div className="bubble">{m.blocks[0]?.text}{m.images > 0 && <span className="att">📎 {m.images} image{m.images > 1 ? 's' : ''}</span>}</div></div>;
  }
  return (
    <div className={'a' + (highlight ? ' hl' : '')} data-idx={m.idx}>
      {m.blocks.map((b, k) => (b.type === 'text' ? <Markdown key={k} text={b.text} /> : <ToolBlock key={k} b={b} live={live} />))}
    </div>
  );
});

const PAGE = 60;
const ACTIVE_STATES = ['starting', 'running', 'waiting'];

export default function ChatView({ session, forkFrom, runKey, newCwd, data, jump, prefs, setPrefs, onScreen, onRenameDone, onCategoryClick, onMoreMenu, onChangeFolder, onForked, toast, renaming, setRenaming }) {
  const runId = session?.id || runKey;
  const historyId = session?.id || forkFrom?.id;
  const run = useChat(runId);
  const running = !!run && ACTIVE_STATES.includes(run.state);
  const [msgs, setMsgs] = useState([]);
  const [range, setRange] = useState({ start: 0, end: 0, total: 0 });
  const [loading, setLoading] = useState(!!session);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null);
  const scroller = useRef();
  const anchor = useRef(null);
  const loadingMore = useRef(false);
  const cat = session && data.categories.find(c => c.id === session.categoryId);
  const cwd = session?.cwd || newCwd;

  const [commands, setCommands] = useState([]);
  useEffect(() => { let dead = false; api.info.commands(cwd).then(c => { if (!dead) setCommands(c); }).catch(() => {}); return () => { dead = true; }; }, [cwd]);
  const onCommand = cmd => {
    if (cmd.type === 'screen') onScreen(cmd.screen, { session: session || forkFrom, cwd });
    else { api.copy(`cd ${JSON.stringify(cwd)} && claude${session ? ' --resume ' + session.id : ''}`); toast(`/${cmd.name} only works in the terminal. Copied a command to open this chat there.`); }
  };

  const load = useCallback(async (before, limit) => api.messages(historyId, before, limit), [historyId]);

  // initial load / jump
  useEffect(() => {
    if (!historyId) { setMsgs([]); setRange({ start: 0, end: 0, total: 0 }); setLoading(false); return; }
    let dead = false;
    setLoading(true); setError(null);
    const pinned = run && ACTIVE_STATES.includes(run.state) && run.baseTotal != null ? run.baseTotal : null;
    if (pinned === 0) { setMsgs([]); setRange({ start: 0, end: 0, total: 0 }); setLoading(false); anchor.current = { bottom: true }; return; }
    const before = jump?.idx != null ? jump.idx + 25 : pinned;
    load(before, PAGE).then(r => {
      if (dead) return;
      setMsgs(r.messages); setRange({ start: r.start, end: r.start + r.messages.length, total: r.total }); setLoading(false);
      anchor.current = jump?.idx != null ? { idx: jump.idx } : { bottom: true };
    }).catch(e => { if (!dead) { setError(e.message); setLoading(false); } });
    return () => { dead = true; };
  }, [historyId, jump?.key]);

  const reloadTail = useCallback(async () => {
    if (!historyId) return;
    const r = await load(null, Math.max(PAGE, range.end - range.start + 10));
    const el = scroller.current;
    const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    setMsgs(r.messages); setRange({ start: r.start, end: r.start + r.messages.length, total: r.total });
    if (atBottom) anchor.current = { bottom: true };
    return r;
  }, [historyId, range, load]);

  // file changed on disk (other window, or our own run finished)
  useEffect(() => {
    if (!session || loading || range.end < range.total) return;
    if (running) return;
    reloadTail().then(() => { if (run && run.live.length && !ACTIVE_STATES.includes(run.state)) chatActions.clearLive(run.key); });
  }, [session?.updated, running, loading]);

  // keep the newest content in view while streaming
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 220) el.scrollTop = el.scrollHeight;
  }, [run?.version]);

  useLayoutEffect(() => {
    const el = scroller.current, a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    if (a.bottom) el.scrollTop = el.scrollHeight;
    else if (a.idx != null) { const t = el.querySelector(`[data-idx="${a.idx}"]`); if (t) t.scrollIntoView({ block: 'center' }); }
    else if (a.prevHeight != null) el.scrollTop = el.scrollHeight - a.prevHeight + a.prevTop;
  });

  const onScroll = async () => {
    const el = scroller.current;
    if (loadingMore.current || !historyId) return;
    if (el.scrollTop < 300 && range.start > 0) {
      loadingMore.current = true;
      const r = await load(range.start, PAGE);
      anchor.current = { prevHeight: el.scrollHeight, prevTop: el.scrollTop };
      setMsgs(m => [...r.messages, ...m]); setRange(x => ({ ...x, start: r.start, total: r.total }));
      loadingMore.current = false;
    } else if (el.scrollHeight - el.scrollTop - el.clientHeight < 300 && range.end < range.total) {
      loadingMore.current = true;
      const r = await load(Math.min(range.end + PAGE, range.total), Math.min(PAGE, range.total - range.end));
      const fresh = r.messages.filter(m => m.idx >= range.end);
      setMsgs(m => [...m, ...fresh]); setRange(x => ({ ...x, end: x.end + fresh.length, total: r.total }));
      loadingMore.current = false;
    }
  };

  const doSend = async (text, images, fork) => {
    try {
      if (historyId && range.end < range.total) { await reloadTail(); }
      const forking = fork || (!session && !!forkFrom);
      const key = await chatActions.send({ key: runKey, sessionId: historyId, cwd, model: prefs.model, effort: prefs.effort, permissionMode: prefs.mode, fork: forking, baseTotal: historyId ? range.total : 0 }, text, images);
      anchor.current = { bottom: true };
      if (fork) onForked(key);
    } catch (e) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  };
  const onSend = (text, images) => {
    if (session && session.active && !run) { setConflict({ text, images }); return; }
    doSend(text, images);
  };
  const setMode = m => { setPrefs({ mode: m }); if (running || run) chatActions.setMode(run.key, m).catch(() => {}); };
  const setModel = m => { setPrefs({ model: m }); if (run && running) chatActions.setModel(run.key, m).catch(() => {}); };

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && running && !run?.perms.length && !document.querySelector('.scrim, .menu')) { e.preventDefault(); chatActions.interrupt(run.key); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, run?.perms.length]);

  const [draft, setDraft] = useState(session?.title || '');
  useEffect(() => setDraft(session?.title || ''), [session?.id, renaming]);
  const commitRename = async () => { setRenaming(false); if (draft.trim() !== session.title) await onRenameDone(session.id, draft); };

  const live = run?.live || [];
  const perms = run?.perms || [];
  const empty = !historyId && !live.length;

  return (
    <section className="main">
      <header className="wsbar">
        {session ? (renaming
          ? <input className="title-input" autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(session.title); setRenaming(false); } }} placeholder={session.autoTitle || 'Chat name'} />
          : <h1 title="Double-click to rename (F2)" onDoubleClick={() => setRenaming(true)}>{session.title}</h1>)
          : <h1>{forkFrom ? 'Fork of ' + forkFrom.title : 'New chat'}</h1>}
        {session && <button className="pill" onClick={e => onCategoryClick(e, session)} title="Move to another category">
          <span className="sw" style={{ background: cat?.color }} />{cat?.name || 'No category'} ▾
        </button>}
        {!session && forkFrom && <span className="pill" title="The original chat stays unchanged">New copy · starts when you send</span>}
        {!session && !forkFrom && <button className="pill mono" title="Change folder" onClick={onChangeFolder} disabled={live.length > 0}><Icon name="folder" size={12} />{shortPath(cwd, data.home)}</button>}
        {session?.branch && <span className="pill mono" title={'Git branch: ' + session.branch}><Icon name="branch" size={12} />{session.branch}</span>}
        {running && <span className="pill live"><span className="run" />{run.state === 'waiting' ? 'Needs your approval' : 'Working'}</span>}
        <span className="sp" />
        <button className="ibtn" onClick={() => api.openVSCode(cwd).catch(e => toast(e.message))}><Icon name="vscode" />Open in VS Code</button>
        {session && <button className="ibtn" title="More" onClick={e => onMoreMenu(e, session)}><Icon name="more" size={16} /></button>}
      </header>

      <div className="scroll" ref={scroller} onScroll={onScroll}>
        <div className="col">
          {empty && (
            <div className="newchat-hero">
              <div className="big">What should we work on?</div>
              <p>Claude will work in <code>{shortPath(cwd, data.home)}</code>. Skills, MCP servers and settings from that folder apply.</p>
            </div>
          )}
          {loading && <div className="notice"><span className="spin">✻</span> Loading conversation…</div>}
          {error && <div className="notice bad">{error}</div>}
          {!loading && range.start > 0 && <div className="load-more">Scroll up for {range.start} earlier messages</div>}
          {!loading && msgs.map(m => <Message key={m.idx} m={m} highlight={jump?.idx === m.idx} />)}
          {!loading && range.end < range.total && <div className="load-more">Scroll down for {range.total - range.end} newer messages</div>}
          {live.map(m => <Message key={m.idx} m={m} live={running} />)}
          {run?.draft && <div className="a"><Markdown text={run.draft} /></div>}
          {perms.map(p => <PermissionCard key={p.id} perm={p} onAnswer={a => chatActions.respond(p, a)} />)}
          {running && !perms.length && !run.draft && <div className="thinking"><span className="spin">✻</span>{run.state === 'starting' ? 'Starting Claude Code…' : 'Working…'} <span className="kbd">Esc</span> to stop</div>}
          {run?.error && !running && <div className="errbox">{run.error}</div>}
        </div>
      </div>

      <footer className="compwrap">
        {conflict && (
          <div className="conflict">
            <span><b>This chat is running in another window</b> (VS Code or a terminal). Writing to it from two places can mix up the history.</span>
            <div className="acts left">
              <button className="b pri" onClick={() => { const c = conflict; setConflict(null); doSend(c.text, c.images, true); }}>Fork a copy</button>
              <button className="b" onClick={() => { const c = conflict; setConflict(null); doSend(c.text, c.images); }}>Send anyway</button>
              <button className="b" onClick={() => setConflict(null)}>Cancel</button>
            </div>
          </div>
        )}
        <Composer running={running} onSend={onSend} onStop={() => run && chatActions.interrupt(run.key)}
          mode={prefs.mode} onMode={setMode} model={prefs.model} onModel={setModel} effort={prefs.effort} onEffort={e => setPrefs({ effort: e })}
          placeholder={running ? 'Add a message… Claude will read it next' : session ? 'Reply to Claude…' : 'Ask Claude to build, fix or explain something…'}
          toast={toast} autoFocus={!session || jump == null} commands={commands} onCommand={onCommand} />
        <div className="ctx">
          {session && <span>{range.total + live.length} message{range.total + live.length === 1 ? '' : 's'}</span>}
          {(run?.result?.total_cost_usd ?? session?.cost) != null && <span>${(run?.result?.total_cost_usd ?? session.cost).toFixed(2)} this chat</span>}
          {run?.init?.model && <span>{run.init.model}</span>}
          {session && <span>updated {rel(session.updated)}{rel(session.updated) === 'now' ? '' : ' ago'}</span>}
          <span className="path" title="Open folder" onClick={() => api.openFolder(cwd)}>{shortPath(cwd, data.home)}</span>
        </div>
      </footer>
    </section>
  );
}
