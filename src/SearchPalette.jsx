import React, { useEffect, useRef, useState } from 'react';
import { api, Highlight, Icon, Modal, rel } from './ui.jsx';

const FILTERS = [
  { tok: 'in:analysis', hint: 'category' }, { tok: 'in:odoo' }, { tok: 'ws:', hint: 'workspace' },
  { tok: 'after:', hint: 'date' }, { tok: 'has:edit' }, { tok: 'has:skill' }, { tok: 'has:archived' },
];

export default function SearchPalette({ initial = '', data, onOpen, onClose }) {
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState([]);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef();
  const list = useRef();

  useEffect(() => {
    let dead = false;
    setBusy(true);
    const t = setTimeout(() => api.search(q).then(r => { if (!dead) { setResults(r); setSel(0); setBusy(false); } }), q ? 90 : 0);
    return () => { dead = true; clearTimeout(t); };
  }, [q]);
  useEffect(() => { list.current?.querySelector('.hit.on')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const addFilter = tok => {
    const v = (q.trim() ? q.trim() + ' ' : '') + tok;
    setQ(tok.endsWith(':') ? v : v + ' ');
    input.current.focus();
  };
  if (sel > results.length) setSel(0);
  const open = (r, idx) => onOpen(r.session.id, idx ?? r.hits[0]?.idx);

  const onKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter' && results[sel]) { e.preventDefault(); open(results[sel]); }
  };

  // group by category, keeping score order of first appearance
  const cats = data.categories;
  const groups = [];
  results.forEach((r, i) => {
    let g = groups.find(g => g.id === r.session.categoryId);
    if (!g) { g = { id: r.session.categoryId, cat: cats.find(c => c.id === r.session.categoryId), items: [] }; groups.push(g); }
    g.items.push({ r, i });
  });
  const terms = results[0]?.hits[0]?.terms || q.split(/\s+/).filter(t => t && !t.includes(':'));

  return (
    <Modal onClose={onClose} className="palette">
      <div className="in">
        <Icon name="search" size={16} />
        <input ref={input} autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search everything you and Claude wrote…" spellCheck={false} />
        {busy && <span className="spin">✻</span>}
        <span className="kbd">Esc</span>
      </div>
      <div className="filters">
        <span className="lbl">Filters</span>
        {FILTERS.map(f => <button key={f.tok} className="f" onClick={() => addFilter(f.tok)} title={f.hint}>{f.tok}{f.hint && f.tok.endsWith(':') ? '…' : ''}</button>)}
      </div>
      <div className="res" ref={list}>
        {!busy && !results.length && <div className="notice" style={{ padding: 24 }}>No chats match “{q}”.</div>}
        {!q.trim() && results.length > 0 && <div className="g">Recent</div>}
        {groups.map(g => (
          <div key={g.id || 'none'}>
            {q.trim() && <div className="g"><span className="dot" style={{ background: g.cat?.color }} />{g.cat?.name || 'Other'} · {g.items.length} chat{g.items.length > 1 ? 's' : ''}</div>}
            {g.items.map(({ r, i }) => (
              <div key={r.session.id} className={'hit' + (i === sel ? ' on' : '')} onMouseEnter={() => setSel(i)} onClick={() => open(r)}>
                <div className="tt">
                  {r.session.active && <span className="run" />}
                  <span className="ti"><Highlight text={r.session.title} terms={terms} /></span>
                  <small>{r.session.workspace.name}{r.session.workspace.version ? ' ' + r.session.workspace.version : ''} · {rel(r.session.updated)}</small>
                </div>
                {r.hits.length === 0 && <div className="sn">{r.session.firstPrompt}</div>}
                {r.hits.map((h, k) => (
                  <div key={k} className="sn sub" title="Open at this message" onClick={e => { e.stopPropagation(); open(r, h.idx); }}>
                    <Highlight text={h.snippet} terms={h.terms} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="foothint"><span>↑↓ move</span><span>Enter open at best match</span><span>Click a snippet to jump to that message</span></div>
    </Modal>
  );
}
