import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api, store, Icon } from './ui.jsx';

const css = v => getComputedStyle(document.body).getPropertyValue(v).trim();
const themeNow = () => ({ background: css('--bg') || '#1e1e1e', foreground: css('--text') || '#ddd', cursor: css('--accent') || '#c96442', selectionBackground: 'rgba(201,100,66,.35)' });
const baseName = p => (p || '').split('/').filter(Boolean).pop() || '~';

/** One xterm bound to one pty. Stays mounted while hidden so its scrollback survives tab switches. */
function TermView({ tab, active, onExit }) {
  const ref = useRef(null);
  const termRef = useRef(null);
  useEffect(() => {
    const term = new Terminal({ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, cursorBlink: true, scrollback: 5000, theme: themeNow(), allowProposedApi: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    termRef.current = { term, fit };
    const offData = api.on('term:data', d => { if (d.id === tab.id) term.write(d.data); });
    const offExit = api.on('term:exit', d => { if (d.id === tab.id) { term.write(`\r\n\x1b[2m[process exited with code ${d.exitCode}]\x1b[0m\r\n`); onExit(tab.id); } });
    const sub = term.onData(data => api.term.write(tab.id, data));
    const doFit = () => { try { fit.fit(); api.term.resize(tab.id, term.cols, term.rows); } catch { } };
    const ro = new ResizeObserver(doFit); ro.observe(ref.current);
    const mo = new MutationObserver(() => { term.options.theme = themeNow(); });
    mo.observe(document.documentElement, { attributes: true }); mo.observe(document.body, { attributes: true });
    doFit();
    return () => { offData(); offExit(); sub.dispose(); ro.disconnect(); mo.disconnect(); term.dispose(); };
  }, [tab.id]);
  useEffect(() => { if (active && termRef.current) { termRef.current.fit.fit(); termRef.current.term.focus(); } }, [active]);
  return <div className="term-view" ref={ref} style={{ display: active ? 'block' : 'none' }} />;
}

export function TerminalPanel({ cwd, open, onClose }) {
  const [tabs, setTabs] = useState([]);
  const [cur, setCur] = useState(null);
  const [height, setHeight] = useState(() => store.get('term.height', 280));
  const [err, setErr] = useState(null);

  const add = async dir => {
    setErr(null);
    try {
      const t = await api.term.create({ cwd: dir || cwd });
      setTabs(x => [...x, { ...t, alive: true }]); setCur(t.id);
    } catch (e) { setErr(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  };
  const close = id => {
    api.term.kill(id);
    setTabs(x => { const rest = x.filter(t => t.id !== id); if (cur === id) setCur(rest.at(-1)?.id || null); if (!rest.length) onClose(); return rest; });
  };
  // the first time the panel opens, start a shell in the current folder
  useEffect(() => { if (open && !tabs.length) add(); }, [open]);

  const drag = e => {
    e.preventDefault();
    const y0 = e.clientY, h0 = height;
    const mv = ev => setHeight(Math.max(120, Math.min(window.innerHeight - 200, h0 + y0 - ev.clientY)));
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); setHeight(h => (store.set('term.height', h), h)); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };

  return (
    <div className="term-panel" style={{ height, display: open ? 'flex' : 'none' }}>
      <div className="term-grip" onMouseDown={drag} title="Drag to resize" />
      <div className="term-bar">
        <span className="term-title">Terminal</span>
        <div className="term-tabs" role="tablist">
          {tabs.map(t => (
            <div key={t.id} role="tab" aria-selected={cur === t.id} className={'term-tab' + (cur === t.id ? ' on' : '') + (t.alive ? '' : ' dead')} onClick={() => setCur(t.id)} title={t.cwd}>
              <span>{baseName(t.cwd)}</span>
              <button className="x" title="Kill terminal" onClick={e => { e.stopPropagation(); close(t.id); }}>✕</button>
            </div>
          ))}
        </div>
        <button className="ibtn" title={'New terminal in ' + (cwd || '~')} onClick={() => add()}><Icon name="plus" size={14} /></button>
        <button className="ibtn" title="Hide terminal (Ctrl `)" onClick={onClose}>▾</button>
      </div>
      {err && <div className="errbox" style={{ margin: 8 }}>{err}</div>}
      <div className="term-body">
        {tabs.map(t => <TermView key={t.id} tab={t} active={open && cur === t.id} onExit={id => setTabs(x => x.map(y => (y.id === id ? { ...y, alive: false } : y)))} />)}
      </div>
    </div>
  );
}
