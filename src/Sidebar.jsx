import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, rel, store } from './ui.jsx';

const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const sortChats = (a, b) => (b.pinned - a.pinned) || b.updated.localeCompare(a.updated);
const FLAT_LIMIT = 8, WS_LIMIT = 10;
export const CATEGORY_COLORS = ['#3f8f6a', '#7c5cbf', '#2f80c4', '#c96442', '#b8862d', '#b04d74', '#4f9a8a', '#a09a8c'];

function InlineInput({ initial = '', placeholder, onDone }) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const finish = val => { if (done.current) return; done.current = true; onDone(val); };
  return (
    <input className="cat-input" autoFocus value={v} placeholder={placeholder} onChange={e => setV(e.target.value)}
      onClick={e => e.stopPropagation()} onBlur={() => finish(v.trim())}
      onKeyDown={e => { if (e.key === 'Enter') finish(v.trim()); if (e.key === 'Escape') finish(null); }} />
  );
}

export default function Sidebar({
  data, currentId, selected, onSelect, onOpen, onChatMenu, onWsMenu, onCatMenu, onSearch, onNew, onSettings,
  onMoveSessions, onMoveWorkspace, onReorderCategories, onCreateCategory, onRenameCategory, renamingCat, setRenamingCat,
  account, usage, onAccountMenu, onUsage,
}) {
  const [closed, setClosed] = useState(() => store.get('closedCats', {}));
  const [openWs, setOpenWs] = useState(() => store.get('openWs', {}));
  const [expanded, setExpanded] = useState({});
  const [drop, setDrop] = useState(null);          // { cat, mode: 'into' | 'before' | 'after' }
  const [adding, setAdding] = useState(false);
  const anchor = useRef(null);

  const toggleCat = id => { const n = { ...closed, [id]: !closed[id] }; setClosed(n); store.set('closedCats', n); };
  const toggleWs = (cwd, isOpen) => { const n = { ...openWs, [cwd]: !isOpen }; setOpenWs(n); store.set('openWs', n); };

  const groups = useMemo(() => {
    const showArchived = data.settings.showArchived;
    const visible = data.sessions.filter(s => showArchived || !s.archived || s.id === currentId);
    return data.categories.map(cat => {
      const chats = visible.filter(s => s.categoryId === cat.id).sort(sortChats);
      const unpinned = chats.filter(s => !s.pinned);
      let workspaces = null;
      if (cat.layout === 'workspace') {
        const by = new Map();
        for (const s of unpinned) { if (!by.has(s.cwd)) by.set(s.cwd, []); by.get(s.cwd).push(s); }
        workspaces = [...by.entries()].map(([cwd, list]) => ({
          cwd, list, label: list[0].workspace, latest: list.reduce((m, s) => (s.updated > m ? s.updated : m), ''),
          placed: list.some(s => s.placed === 'workspace'), active: list.some(s => s.active), hasCurrent: list.some(s => s.id === currentId),
        })).sort((a, b) => b.latest.localeCompare(a.latest));
      }
      return { cat, chats, unpinned, workspaces };
    });
  }, [data, currentId]);
  const pinned = useMemo(() => data.sessions.filter(s => s.pinned && (data.settings.showArchived || !s.archived)).sort(sortChats), [data]);
  const [sec, setSec] = useState(() => store.get('sidebarSections', { pinned: true, cats: true }));
  const toggleSec = k => { const n = { ...sec, [k]: !sec[k] }; setSec(n); store.set('sidebarSections', n); };

  // Order of chats exactly as rendered (for Shift-click ranges).
  const rendered = [];
  const sel = new Set(selected);

  const clickChat = (e, s) => {
    if (e.ctrlKey || e.metaKey) {
      const n = new Set(sel);
      n.has(s.id) ? n.delete(s.id) : n.add(s.id);
      anchor.current = s.id; onSelect([...n]); return;
    }
    if (e.shiftKey) {
      const from = rendered.indexOf(anchor.current ?? currentId), to = rendered.indexOf(s.id);
      if (from >= 0 && to >= 0) { const [a, b] = from < to ? [from, to] : [to, from]; onSelect(rendered.slice(a, b + 1)); return; }
    }
    anchor.current = s.id; onSelect([]); onOpen(s.id);
  };

  const hasType = (e, t) => [...e.dataTransfer.types].includes(t);
  const catDrop = cat => ({
    onDragOver: e => {
      if (hasType(e, 'cc/category')) {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setDrop({ cat: cat.id, mode: e.clientY < r.top + Math.min(r.height / 2, 18) ? 'before' : 'after' });
      } else if (hasType(e, 'cc/sessions') || hasType(e, 'cc/workspace')) { e.preventDefault(); setDrop({ cat: cat.id, mode: 'into' }); }
    },
    onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) setDrop(null); },
    onDrop: e => {
      e.preventDefault();
      const d = drop; setDrop(null);
      const movedCat = e.dataTransfer.getData('cc/category');
      if (movedCat) {
        if (movedCat === cat.id) return;
        const ids = data.categories.map(c => c.id).filter(id => id !== movedCat);
        let i = ids.indexOf(cat.id); if (d?.mode === 'after') i++;
        ids.splice(i, 0, movedCat); onReorderCategories(ids); return;
      }
      const sids = e.dataTransfer.getData('cc/sessions'), cwd = e.dataTransfer.getData('cc/workspace');
      if (sids) onMoveSessions(JSON.parse(sids), cat.id); else if (cwd) onMoveWorkspace(cwd, cat.id);
    },
  });

  const chatRow = (s, depth) => {
    rendered.push(s.id);
    const isSel = sel.has(s.id);
    return (
      <div key={s.id} className={'chat d' + depth + (s.id === currentId && !sel.size ? ' on' : '') + (isSel ? ' sel' : '') + (s.archived ? ' archived' : '')}
        title={`${s.title}\n${s.cwd}`} onClick={e => clickChat(e, s)}
        onContextMenu={e => { e.preventDefault(); if (sel.size && !isSel) onSelect([]); onChatMenu(e, s, isSel && sel.size > 1 ? [...sel] : null); }}
        draggable onDragStart={e => {
          const ids = isSel && sel.size ? [...sel] : [s.id];
          e.dataTransfer.setData('cc/sessions', JSON.stringify(ids)); e.dataTransfer.effectAllowed = 'move';
          if (ids.length > 1) { const g = document.createElement('div'); g.className = 'drag-ghost'; g.textContent = `${ids.length} chats`; document.body.appendChild(g); e.dataTransfer.setDragImage(g, 10, 10); setTimeout(() => g.remove()); }
        }}>
        {s.waiting ? <span className="run wait" title="Waiting for your approval" /> : s.active ? <span className="run" title={s.running ? 'Claude is working' : 'Active right now'} /> : <span className="bullet" />}
        <span className="t">{s.title}</span>
        {s.placed === 'session' && <span title="Placed here by you"><Icon name="moved" size={12} style={{ color: 'var(--faint)' }} /></span>}
        <span className="when">{rel(s.updated)}</span>
        <button className="row-more" title="More" onClick={e => { e.stopPropagation(); onChatMenu(e, s, null); }}><Icon name="more" size={14} /></button>
      </div>
    );
  };
  const limited = (key, list, limit, render) => {
    const all = expanded[key];
    const shown = all ? list : list.slice(0, limit);
    return <>
      {shown.map(render)}
      {list.length > limit && <div className="more-row" onClick={() => setExpanded({ ...expanded, [key]: !all })}>{all ? 'Show less' : `Show ${list.length - limit} more`}</div>}
    </>;
  };

  return (
    <aside className="side">
      <div className="nav">
        <button className="nav-it" onClick={() => onNew()}><Icon name="plus" size={17} /><span>New chat</span><span className="kbd">Ctrl N</span></button>
        <button className="nav-it" onClick={() => onSearch('')}><Icon name="search" size={17} /><span>Search</span><span className="kbd">Ctrl K</span></button>
        <button className="nav-it" onClick={onUsage}><Icon name="gauge" size={17} /><span>Usage</span>{usage?.weekly && <span className="kbd plain">{usage.weekly.pct}% week</span>}</button>
      </div>
      {sel.size > 0 && (
        <div className="selbar">
          <b>{sel.size} selected</b>
          <span className="hint">Drag onto a category or right-click</span>
          <button className="ibtn" onClick={() => onSelect([])} title="Clear selection (Esc)">✕</button>
        </div>
      )}
      <nav className="tree" onDragEnd={() => setDrop(null)}>
        {!data.ready && <div className="empty-tree">Reading your sessions…</div>}
        {pinned.length > 0 && <>
          <button className="sec-h" onClick={() => toggleSec('pinned')}>Pinned <span className={'sec-chev' + (sec.pinned ? '' : ' closed')}><Icon name="chev" size={13} /></span></button>
          {sec.pinned && pinned.map(s => chatRow(s, 0))}
        </>}
        <div className="sec-h">
          <button onClick={() => toggleSec('cats')}>Categories <span className={'sec-chev' + (sec.cats ? '' : ' closed')}><Icon name="chev" size={13} /></span></button>
          <button className="sec-add" title="New category" onClick={() => setAdding(true)}><Icon name="plus" size={14} /></button>
        </div>
        {adding && <div className="cat add-row"><Icon name="project" size={17} /><InlineInput placeholder="Category name" onDone={v => { setAdding(false); if (v) onCreateCategory(v); }} /></div>}
        {sec.cats && groups.map(({ cat, chats, unpinned, workspaces }) => (
          <div key={cat.id} {...catDrop(cat)}
            className={'catblock' + (drop?.cat === cat.id ? ' drop-' + drop.mode : '')}>
            <div className={'cat' + (closed[cat.id] ? ' closed' : '')} draggable={renamingCat !== cat.id}
              onDragStart={e => { e.dataTransfer.setData('cc/category', cat.id); e.dataTransfer.effectAllowed = 'move'; }}
              onClick={() => renamingCat !== cat.id && toggleCat(cat.id)} onDoubleClick={() => setRenamingCat(cat.id)}
              onContextMenu={e => { e.preventDefault(); onCatMenu(e, cat, chats.length); }} title="Drag to reorder · double-click to rename · right-click for more">
              <Icon name="project" size={17} color={cat.color} stroke={1.9} />
              {renamingCat === cat.id
                ? <InlineInput initial={cat.name} onDone={v => { setRenamingCat(null); if (v && v !== cat.name) onRenameCategory(cat.id, v); }} />
                : <span className="cname">{cat.name}</span>}
              <span className="n">{chats.length}</span>
              <span className="caret"><Icon name="chev" size={14} /></span>
              <button className="cat-more" title="Category options" onClick={e => { e.stopPropagation(); onCatMenu(e, cat, chats.length); }}><Icon name="more" size={14} /></button>
            </div>
            {!closed[cat.id] && unpinned.length === 0 && <div className="cat-empty">{chats.length ? 'Only pinned chats' : 'Drop chats here'}</div>}
            {!closed[cat.id] && (workspaces
              ? workspaces.map(ws => {
                const isOpen = openWs[ws.cwd] ?? (ws.hasCurrent || ws.active);
                return (
                  <div key={ws.cwd}>
                    <div className="ws" title={ws.cwd} onClick={() => toggleWs(ws.cwd, isOpen)} onContextMenu={e => { e.preventDefault(); onWsMenu(e, ws); }}
                      draggable onDragStart={e => { e.dataTransfer.setData('cc/workspace', ws.cwd); e.dataTransfer.effectAllowed = 'move'; }}>
                      <Icon name="folder" size={14} />
                      <span className="label">{ws.label.name}</span>
                      {ws.label.version && <span className="ver">{ws.label.version}</span>}
                      {ws.placed && <span title="Folder placed here by you"><Icon name="moved" size={12} style={{ color: 'var(--faint)' }} /></span>}
                      {!isOpen && ws.active && <span className="run" />}
                      <span className="n">{ws.list.length}</span>
                      <span className={'chev' + (isOpen ? '' : ' closed')}><Icon name="chev" size={13} /></span>
                      <button className="add" title="New chat in this folder" onClick={e => { e.stopPropagation(); onNew(ws.cwd); }}>+</button>
                    </div>
                    {isOpen && limited(ws.cwd, ws.list, WS_LIMIT, s => chatRow(s, 2))}
                  </div>
                );
              })
              : limited(cat.id, unpinned, FLAT_LIMIT, s => chatRow(s, 1)))}
          </div>
        ))}
        {data.ready && sec.cats && !adding && <button className="add-cat" onClick={() => setAdding(true)}><Icon name="plus" size={15} />New category</button>}
      </nav>
      <div className="side-foot">
        <button className="acct" onClick={onAccountMenu} title="Account, usage and settings">
          <div className="avatar">{((account?.email || 'You')[0]).toUpperCase()}</div>
          <div className="who"><span className="nm">{account?.email ? cap(account.email.split('@')[0]) : 'You'}</span>{account?.organization && <span className="org"> · {account.organization}</span>} <span className="dd"><Icon name="chev" size={12} /></span></div>
        </button>
        <button className="ibtn" title="Settings" onClick={onSettings}><Icon name="gear" size={16} /></button>
      </div>
    </aside>
  );
}
