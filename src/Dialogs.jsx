import React, { useState } from 'react';
import { api, Icon, Modal } from './ui.jsx';

export function MoveDialog({ title, subtitle, categories, currentId, canReset, onPick, onReset, onClose }) {
  return (
    <Modal onClose={onClose}>
      <h2>Move to…</h2>
      <div className="sub">{subtitle || title}</div>
      <div className="move-list">
        {categories.map(c => (
          <div key={c.id} className="opt" onClick={() => onPick(c.id)}>
            <Icon name={c.icon || 'folder'} size={14} color={c.color} stroke={2.2} />{c.name}
            {c.id === currentId && <span className="cur">current</span>}
          </div>
        ))}
      </div>
      <div className="acts">
        {canReset && <button className="b" onClick={onReset}>Reset to automatic</button>}
        <button className="b" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

export function NewChatDialog({ data, initialCwd, onStart, onClose }) {
  const [cwd, setCwd] = useState(initialCwd || data.home);
  const [err, setErr] = useState(null);
  const recent = [];
  const seen = new Set();
  for (const s of [...data.sessions].sort((a, b) => b.updated.localeCompare(a.updated))) {
    if (seen.has(s.cwd)) continue; seen.add(s.cwd);
    recent.push({ cwd: s.cwd, ws: s.workspace, cat: data.categories.find(c => c.id === s.categoryId), updated: s.updated });
    if (recent.length >= 8) break;
  }
  const start = async (p = cwd) => {
    p = p.trim().replace(/^~(?=\/|$)/, data.home);
    if (!(await api.pathExists(p))) { setErr('That folder does not exist.'); return; }
    onStart(p);
  };
  const short = p => (p.startsWith(data.home) ? '~' + p.slice(data.home.length) : p);
  return (
    <Modal onClose={onClose}>
      <h2>New chat</h2>
      <div className="sub">Pick the folder Claude will work in. Its CLAUDE.md, skills and settings apply.</div>
      <div className="pathrow">
        <Icon name="folder" size={15} />
        <input value={short(cwd)} spellCheck={false} onChange={e => { setCwd(e.target.value.replace(/^~(?=\/|$)/, data.home)); setErr(null); }} onKeyDown={e => e.key === 'Enter' && start()} />
        <button className="b" onClick={async () => { const p = await api.pickFolder(cwd); if (p) { setCwd(p); setErr(null); } }}>Browse…</button>
      </div>
      {err && <div className="formerr">{err}</div>}
      <h3>Recent folders</h3>
      <div className="move-list">
        {recent.map(r => (
          <div key={r.cwd} className={'opt' + (r.cwd === cwd ? ' cur-opt' : '')} onClick={() => { setCwd(r.cwd); setErr(null); }} onDoubleClick={() => start(r.cwd)} title={r.cwd}>
            <span className="dot" style={{ background: r.cat?.color }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.ws.name}{r.ws.version ? ' ' + r.ws.version : ''} <span className="muted">{short(r.cwd)}</span></span>
            <span className="cur">{r.cat?.name}</span>
          </div>
        ))}
      </div>
      <div className="acts"><button className="b" onClick={onClose}>Cancel</button><button className="b pri" onClick={() => start()}>Start chat</button></div>
    </Modal>
  );
}

export function SettingsDialog({ data, onData, onClose, version, onUpdates }) {
  const theme = data.settings.theme || 'system';
  const set = async patch => onData(await api.setSettings(patch));
  return (
    <Modal onClose={onClose}>
      <h2>Settings</h2>
      <h3>Appearance</h3>
      <div className="seg" role="radiogroup" aria-label="Theme">
        {['system', 'light', 'dark'].map(t => (
          <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? 'on' : ''} onClick={() => set({ theme: t })}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <h3>Sidebar</h3>
      <div className="sub" style={{ marginBottom: 4 }}>Manage categories right in the sidebar: “+ New category”, drag headers to reorder, right-click to rename, recolor or delete.</div>
      <label className="check"><input type="checkbox" checked={!!data.settings.showArchived} onChange={e => set({ showArchived: e.target.checked })} />Show archived chats</label>

      <h3>Updates</h3>
      <div className="row-between"><span className="sub" style={{ margin: 0 }}>Claude Sessions {version || ''} · checks GitHub for new versions every 6 hours.</span>
        <button className="b" onClick={onUpdates}>Check for updates</button></div>
      <div className="acts"><button className="b pri" onClick={onClose}>Done</button></div>
    </Modal>
  );
}
