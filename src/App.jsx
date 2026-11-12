import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Icon, Logo, Menu, store } from './ui.jsx';
import Sidebar, { CATEGORY_COLORS } from './Sidebar.jsx';
import ChatView from './ChatView.jsx';
import SearchPalette from './SearchPalette.jsx';
import { MoveDialog, SettingsDialog, NewChatDialog } from './Dialogs.jsx';
import { UsagePanel, ModelPanel, PermissionsPanel, ContextPanel, McpPanel } from './Panels.jsx';
import { SkillsPanel } from './SkillsPanel.jsx';
import { useUpdates, UpdateDialog } from './Updates.jsx';
import { TerminalPanel } from './TerminalPanel.jsx';
import { chatActions } from './chatStore.js';
import { useAllRuns, getRun } from './chatStore.js';

export default function App() {
  const [data, setData] = useState({ ready: false, sessions: [], categories: [], settings: {}, home: '' });
  const [currentId, setCurrentId] = useState(() => store.get('currentId', null));
  const [jump, setJump] = useState(null);
  const [menu, setMenu] = useState(null);
  const [dialog, setDialog] = useState(null);
  const updates = useUpdates();
  const [termOpen, setTermOpen] = useState(false);
  const [termUsed, setTermUsed] = useState(false); // mount the panel only once it was opened
  const toggleTerm = () => { setTermUsed(true); setTermOpen(o => !o); };
  useEffect(() => {
    // Ctrl+J or Ctrl+` toggles the terminal, like VS Code. Capture phase so it works even while a shell has focus.
    const k = e => {
      if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      if (e.code === 'KeyJ' || e.code === 'Backquote' || e.key === '`') { e.preventDefault(); e.stopPropagation(); toggleTerm(); }
    };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true);
  }, []);
  const [toastMsg, setToastMsg] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [selected, setSelected] = useState([]);
  const [renamingCat, setRenamingCat] = useState(null);
  const [draft, setDraft] = useState(null); // { key, cwd } for a chat not yet saved
  const [prefs, setPrefsState] = useState(() => ({ mode: 'default', model: '', effort: '', ...store.get('chatPrefs', {}) }));
  const setPrefs = p => setPrefsState(x => { const n = { ...x, ...p }; store.set('chatPrefs', n); return n; });
  const runs = useAllRuns();
  const [account, setAccount] = useState(null);
  const [usage, setUsage] = useState(null);
  useEffect(() => {
    api.info.account().then(setAccount).catch(() => {});
    const tick = () => api.info.usage(false).then(setUsage).catch(() => {});
    tick(); const t = setInterval(tick, 5 * 60_000); return () => clearInterval(t);
  }, []);
  const onScreen = (screen, ctx) => {
    if (screen === 'resume') setDialog({ type: 'search' });
    else setDialog({ type: screen, ...ctx });
  };
  const setModeLive = m => { setPrefs({ mode: m }); const id = current?.id || draft?.key; const r = id && getRun(id); if (r) chatActions.setMode(r.key, m).catch(() => {}); };

  const toast = useCallback(m => { setToastMsg(m); clearTimeout(toast.t); toast.t = setTimeout(() => setToastMsg(null), 2600); }, []);

  useEffect(() => {
    api.snapshot().then(setData);
    return api.onChanged(setData);
  }, []);

  // merge live run state into the sidebar data
  const view = useMemo(() => {
    const st = data.runs || {};
    const bySession = {};
    for (const r of Object.values(st)) if (r.sessionId) bySession[r.sessionId] = r;
    return { ...data, sessions: data.sessions.map(s => { const r = bySession[s.id]; return r ? { ...s, active: true, running: r.state !== 'idle', waiting: r.waiting } : s; }) };
  }, [data]);

  const current = !draft && view.sessions.find(s => s.id === currentId);
  const open = (id, idx) => { setDraft(null); setCurrentId(id); store.set('currentId', id); setRenaming(false); setJump(idx != null ? { idx, key: Date.now() } : null); setDialog(null); };
  const newChat = cwd => setDialog({ type: 'new', cwd: typeof cwd === 'string' ? cwd : current?.cwd || data.settings.lastWorkspace || data.home });
  const startDraft = cwd => { setDialog(null); setDraft({ key: 'new-' + Math.random().toString(36).slice(2, 10), cwd }); setRenaming(false); };

  // once a new (or forked) chat is saved and idle, show it as a normal session
  useEffect(() => {
    if (!draft) return;
    const r = getRun(draft.key);
    if (r?.sessionId && !['starting', 'running', 'waiting'].includes(r.state) && data.sessions.some(s => s.id === r.sessionId)) open(r.sessionId);
  }, [draft, data, runs.size, getRun(draft?.key)?.state]);

  useEffect(() => api.on('app:open', id => {
    if (!id) return;
    if (String(id).startsWith('new-')) { const r = getRun(id); if (r) setDraft(d => d?.key === id ? d : { key: id, cwd: d?.cwd }); }
    else open(id);
  }), []);

  useEffect(() => {
    const onKey = e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setDialog({ type: 'search' }); }
      else if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newChat(); }
      else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); setSidebar(s => !s); }
      else if (e.key === 'F2' && current && !dialog) { e.preventDefault(); setRenaming(true); }
      else if (e.key === 'Escape' && !dialog && !menu) setSelected([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, dialog, menu]);

  const catName = id => data.categories.find(c => c.id === id)?.name;
  const moveSessions = async (ids, catId) => {
    setData(await api.moveSession(ids, catId)); setSelected([]);
    const n = ids.length > 1 ? `${ids.length} chats` : 'Chat';
    toast(catId ? `${n} moved to ${catName(catId)}` : `${n} back to automatic sorting`);
  };
  const moveSession = (id, catId) => moveSessions([id], catId);
  const safe = fn => async (...a) => { try { setData(await fn(...a)); } catch (e) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } };
  const createCategory = safe(name => api.createCategory(name, CATEGORY_COLORS[data.categories.length % CATEGORY_COLORS.length]));
  const renameCategory = safe((id, name) => api.updateCategory(id, { name }));
  const reorderCategories = safe(ids => api.reorderCategories(ids));
  const deleteCategory = safe(id => api.deleteCategory(id));
  const moveWorkspace = async (cwd, catId) => { setData(await api.moveWorkspace(cwd, catId)); toast(catId ? `Folder moved to ${catName(catId)}` : 'Folder back to automatic sorting'); };

  const sessionMenuItems = s => [
    { label: 'Open', onClick: () => open(s.id) },
    { label: 'Rename', k: 'F2', onClick: () => { open(s.id); setTimeout(() => setRenaming(true), 50); } },
    { label: s.pinned ? 'Unpin' : 'Pin', onClick: async () => setData(await api.pin(s.id, !s.pinned)) },
    { label: 'Move to…', onClick: () => setDialog({ type: 'move-session', s }) },
    { label: 'Fork into a new chat', onClick: () => { setDialog(null); setRenaming(false); setDraft({ key: 'new-' + Math.random().toString(36).slice(2, 10), cwd: s.cwd, forkFrom: s }); } },
    s.placed === 'session' && { label: 'Reset to automatic', onClick: () => moveSession(s.id, null) },
    'sep',
    { label: 'Open in VS Code', onClick: () => api.openVSCode(s.cwd).catch(e => toast(e.message)) },
    { label: 'Copy resume command', onClick: async () => toast('Copied: ' + await api.copyResume(s.id)) },
    { label: 'Export as Markdown…', onClick: async () => { const p = await api.exportMd(s.id); if (p) toast('Saved ' + p); } },
    'sep',
    { label: s.archived ? 'Unarchive' : 'Archive', onClick: async () => { setData(await api.archive(s.id, !s.archived)); toast(s.archived ? 'Unarchived' : 'Archived. It stays searchable with has:archived'); } },
    { label: 'Delete…', danger: true, onClick: async () => { const d = await api.remove(s.id); setData(d); if (!d.sessions.some(x => x.id === s.id) && currentId === s.id) setCurrentId(null); } },
  ];
  const bulkMenuItems = ids => {
    const list = data.sessions.filter(s => ids.includes(s.id));
    const allPinned = list.every(s => s.pinned), allArchived = list.every(s => s.archived);
    return [
      { header: `${ids.length} chats selected` },
      { header: 'Move to' },
      ...data.categories.map(c => ({ label: c.name, icon: <span className="dot" style={{ background: c.color }} />, onClick: () => moveSessions(ids, c.id) })),
      { label: 'Reset to automatic', onClick: () => moveSessions(ids, null) },
      'sep',
      { label: allPinned ? 'Unpin all' : 'Pin all', onClick: async () => setData(await api.pin(ids, !allPinned)) },
      { label: allArchived ? 'Unarchive all' : 'Archive all', onClick: async () => { setData(await api.archive(ids, !allArchived)); setSelected([]); } },
      { label: 'Clear selection', k: 'Esc', onClick: () => setSelected([]) },
    ];
  };
  const onChatMenu = (e, s, multi) => setMenu({ x: e.clientX, y: e.clientY, items: multi ? bulkMenuItems(multi) : sessionMenuItems(s) });
  const onWsMenu = (e, ws) => setMenu({
    x: e.clientX, y: e.clientY, items: [
      { header: ws.label.name },
      { label: 'Move folder to…', onClick: () => setDialog({ type: 'move-ws', ws }) },
      ws.placed && { label: 'Reset folder to automatic', onClick: () => moveWorkspace(ws.cwd, null) },
      'sep',
      { label: 'Open in VS Code', onClick: () => api.openVSCode(ws.cwd).catch(e => toast(e.message)) },
      { label: 'Open folder', onClick: () => api.openFolder(ws.cwd) },
    ],
  });
  const onCatMenu = (e, cat, count) => setMenu({
    x: e.clientX, y: e.clientY, items: [
      { header: cat.name },
      { label: 'Rename', onClick: () => setRenamingCat(cat.id) },
      { custom: close => (
        <div className="swatches">
          {CATEGORY_COLORS.map(c => <button key={c} title={c} className={c === cat.color ? 'on' : ''} style={{ background: c }}
            onClick={() => { close(); safe(() => api.updateCategory(cat.id, { color: c }))(); }} />)}
        </div>) },
      { label: cat.layout === 'workspace' ? 'Show as flat list' : 'Group by workspace', onClick: safe(() => api.updateCategory(cat.id, { layout: cat.layout === 'workspace' ? 'flat' : 'workspace' })) },
      'sep',
      { label: 'Delete category', danger: !count, disabled: count > 0, onClick: () => deleteCategory(cat.id) },
      count > 0 && { note: `Has ${count} chat${count > 1 ? 's' : ''}. Move them to another category first.` },
    ],
  });
  const onCategoryClick = (e, s) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({
      x: r.left, y: r.bottom + 4, items: [
        { header: 'Move chat to' },
        ...data.categories.map(c => ({ label: c.name + (c.id === s.categoryId ? '  ✓' : ''), icon: <span className="dot" style={{ background: c.color }} />, onClick: () => moveSession(s.id, c.id) })),
        s.placed === 'session' && 'sep',
        s.placed === 'session' && { label: 'Reset to automatic', onClick: () => moveSession(s.id, null) },
      ],
    });
  };
  const onMoreMenu = (e, s) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 230, y: r.bottom + 4, items: sessionMenuItems(s).slice(1) }); };

  const cat = current && data.categories.find(c => c.id === current.categoryId);
  const wsName = current ? current.workspace.name + (current.workspace.version ? ' ' + current.workspace.version : '') : '';

  return (
    <div className="win">
      <div className="titlebar" onDoubleClick={() => api.win.maximize()}>
        <Logo size={18} />
        <span className="name">Claude Sessions</span>
        {draft && <span className="crumbs">{draft.forkFrom ? 'Fork' : 'New chat'}</span>}
        {current && <span className="crumbs">{cat?.name} / {wsName}</span>}
        <div className="wctl">
          <button title="Toggle sidebar (Ctrl B)" onClick={() => setSidebar(s => !s)}><Icon name="sidebar" size={14} /></button>
          <button title="Minimize" onClick={() => api.win.minimize()}>—</button>
          <button title="Maximize" onClick={() => api.win.maximize()}>▢</button>
          <button className="x" title="Close" onClick={() => api.win.close()}>✕</button>
        </div>
      </div>
      <div className={'body' + (sidebar ? '' : ' collapsed')}>
        <Sidebar data={view} currentId={draft ? null : currentId} selected={selected} onSelect={setSelected} onOpen={open} onChatMenu={onChatMenu} onWsMenu={onWsMenu} onCatMenu={onCatMenu}
          onSearch={q => setDialog({ type: 'search', q })} onNew={newChat} onSettings={() => setDialog({ type: 'settings' })} update={updates.available} onUpdate={() => setDialog({ type: 'update' })} account={account} usage={usage} onUsage={() => setDialog({ type: 'usage' })} onAccountMenu={e => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.top - 6, up: true, items: [
            { header: account?.email || 'Account' },
            { label: 'Usage', k: '/usage', onClick: () => setDialog({ type: 'usage' }) },
            { label: 'Model', k: '/model', onClick: () => setDialog({ type: 'model' }) },
            { label: 'Permissions', k: '/permissions', onClick: () => setDialog({ type: 'permissions' }) },
            { label: 'MCP servers', k: '/mcp', onClick: () => setDialog({ type: 'mcp', cwd: current?.cwd, session: current }) },
            { label: 'Skills', k: '/skills', onClick: () => setDialog({ type: 'skills', cwd: current?.cwd }) },
            'sep', { label: updates.available ? `Update to ${updates.available.version}` : 'Check for updates', onClick: () => { if (!updates.available) updates.check(); setDialog({ type: 'update' }); } },
            { label: 'Settings', onClick: () => setDialog({ type: 'settings' }) },
          ] }); }}
          onMoveSessions={moveSessions} onMoveWorkspace={moveWorkspace} onReorderCategories={reorderCategories}
          onCreateCategory={createCategory} onRenameCategory={renameCategory} renamingCat={renamingCat} setRenamingCat={setRenamingCat} />
        <div className="main-col">
        {draft
          ? <ChatView key={draft.key} runKey={draft.key} newCwd={draft.cwd} forkFrom={draft.forkFrom} data={view} prefs={prefs} setPrefs={setPrefs} toast={toast} onScreen={onScreen} termOpen={termOpen} onTerminal={toggleTerm}
              onChangeFolder={() => setDialog({ type: 'new', cwd: draft.cwd })} onForked={() => {}} renaming={false} setRenaming={() => {}} />
          : current
          ? <ChatView key={current.id} session={current} data={view} jump={jump} toast={toast} renaming={renaming} setRenaming={setRenaming}
              prefs={prefs} setPrefs={setPrefs} onScreen={onScreen} termOpen={termOpen} onTerminal={toggleTerm} onForked={key => setDraft({ key, cwd: current.cwd, forkFrom: current })}
              onRenameDone={async (id, name) => { setData(await api.rename(id, name)); toast(name.trim() ? 'Renamed' : 'Name reset to automatic title'); }}
              onCategoryClick={onCategoryClick} onMoreMenu={onMoreMenu} />
          : <Welcome data={view} onSearch={() => setDialog({ type: 'search' })} onNew={newChat} />}
        {termUsed && <TerminalPanel cwd={draft?.cwd || current?.cwd || data.home} open={termOpen} onClose={() => setTermOpen(false)} />}
        </div>
      </div>

      {dialog?.type === 'search' && <SearchPalette initial={dialog.q || ''} data={data} onOpen={open} onClose={() => setDialog(null)} />}
      {dialog?.type === 'new' && <NewChatDialog data={view} initialCwd={dialog.cwd} onStart={startDraft} onClose={() => setDialog(null)} />}
      {dialog?.type === 'usage' && <UsagePanel data={view} account={account} onClose={() => { setDialog(null); api.info.usage(false).then(setUsage).catch(() => {}); }} />}
      {dialog?.type === 'model' && <ModelPanel prefs={prefs} setPrefs={setPrefs} onClose={() => setDialog(null)} />}
      {dialog?.type === 'permissions' && <PermissionsPanel prefs={prefs} onMode={setModeLive} onClose={() => setDialog(null)} />}
      {dialog?.type === 'context' && <ContextPanel session={dialog.session} cwd={dialog.cwd} onClose={() => setDialog(null)} />}
      {dialog?.type === 'mcp' && <McpPanel cwd={dialog.cwd || data.home} sessionId={dialog.session?.id} toast={toast} onClose={() => setDialog(null)} />}
      {dialog?.type === 'skills' && <SkillsPanel cwd={dialog.cwd} home={data.home} toast={toast} onClose={() => setDialog(null)} />}
      {dialog?.type === 'settings' && <SettingsDialog data={data} onData={setData} onClose={() => setDialog(null)} version={updates.info?.current} onUpdates={() => { if (!updates.available) updates.check(); setDialog({ type: 'update' }); }} />}
      {dialog?.type === 'update' && <UpdateDialog updates={updates} onClose={() => setDialog(null)} />}
      {dialog?.type === 'move-session' && <MoveDialog title={dialog.s.title} categories={data.categories} currentId={dialog.s.categoryId}
        canReset={dialog.s.placed === 'session'} onPick={id => { moveSession(dialog.s.id, id); setDialog(null); }}
        onReset={() => { moveSession(dialog.s.id, null); setDialog(null); }} onClose={() => setDialog(null)} />}
      {dialog?.type === 'move-ws' && <MoveDialog title={dialog.ws.label.name} subtitle={`Folder “${dialog.ws.label.name}” and all ${dialog.ws.list.length} chats in it, including future ones.`}
        categories={data.categories} currentId={dialog.ws.list[0]?.categoryId} canReset={dialog.ws.placed}
        onPick={id => { moveWorkspace(dialog.ws.cwd, id); setDialog(null); }} onReset={() => { moveWorkspace(dialog.ws.cwd, null); setDialog(null); }} onClose={() => setDialog(null)} />}
      {menu && <Menu {...menu} onClose={() => setMenu(null)} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}

function Welcome({ data, onSearch, onNew }) {
  const active = data.sessions.filter(s => s.active).length;
  const week = data.sessions.filter(s => Date.now() - new Date(s.updated) < 7 * 864e5).length;
  return (
    <section className="main welcome" style={{ gridTemplateRows: '1fr' }}>
      <div>
        <Logo size={44} />
        <div className="big">{data.ready ? 'Pick up where you left off' : 'Reading your sessions…'}</div>
        <p>Choose a chat in the sidebar, or press <span className="kbd">Ctrl K</span> to search every conversation.</p>
        <div className="stats">
          <div className="stat"><b>{data.sessions.length}</b><small>chats</small></div>
          <div className="stat"><b>{week}</b><small>active this week</small></div>
          <div className="stat"><b>{active}</b><small>running now</small></div>
        </div>
        <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'center' }}><button className="b pri" onClick={() => onNew()}>New chat</button><button className="b" onClick={onSearch}>Search chats</button></div>
      </div>
    </section>
  );
}
