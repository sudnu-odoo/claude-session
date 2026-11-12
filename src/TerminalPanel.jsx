import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api, store, Icon } from './ui.jsx';

// VS Code's default terminal colors (Dark Modern / Light Modern).
const VS_DARK = { background: '#181818', foreground: '#cccccc', cursor: '#cccccc', selectionBackground: '#264f78',
  black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#e5e5e5' };
const VS_LIGHT = { background: '#f8f8f8', foreground: '#3b3b3b', cursor: '#3b3b3b', selectionBackground: '#add6ff',
  black: '#000000', red: '#cd3131', green: '#107c10', yellow: '#949800', blue: '#0451a5', magenta: '#bc05bc', cyan: '#0598bc', white: '#555555',
  brightBlack: '#666666', brightRed: '#cd3131', brightGreen: '#14ce14', brightYellow: '#b5ba00', brightBlue: '#0451a5', brightMagenta: '#bc05bc', brightCyan: '#0598bc', brightWhite: '#a5a5a5' };
// The app's theme setting drives Electron's nativeTheme, which the page sees as prefers-color-scheme.
const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = () => darkMq.matches;
const themeNow = () => (isDark() ? VS_DARK : VS_LIGHT);
const baseName = p => (p || '').split('/').filter(Boolean).pop() || '~';
const shellName = t => baseName(t.shell);

/** One xterm bound to one pty. Stays mounted while hidden so its scrollback survives tab switches. */
function TermView({ tab, active, onExit }) {
  const ref = useRef(null);
  const termRef = useRef(null);
  useEffect(() => {
    const term = new Terminal({ fontFamily: "'JetBrains Mono', 'Droid Sans Mono', monospace", fontSize: 13, lineHeight: 1.2, cursorBlink: true, scrollback: 5000, theme: themeNow(), allowProposedApi: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    termRef.current = { term, fit };
    const offData = api.on('term:data', d => { if (d.id === tab.id) term.write(d.data); });
    const offExit = api.on('term:exit', d => { if (d.id === tab.id) { term.write(`\r\n\x1b[2m[process exited with code ${d.exitCode}]\x1b[0m\r\n`); onExit(tab.id); } });
    const sub = term.onData(data => api.term.write(tab.id, data));
    const doFit = () => { try { fit.fit(); api.term.resize(tab.id, term.cols, term.rows); } catch { } };
    const ro = new ResizeObserver(doFit); ro.observe(ref.current);
    const onTheme = () => { term.options.theme = themeNow(); };
    darkMq.addEventListener('change', onTheme);
    doFit();
    return () => { offData(); offExit(); sub.dispose(); ro.disconnect(); darkMq.removeEventListener('change', onTheme); term.dispose(); };
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
      <div className="term-head">
        <span className="term-label">Terminal</span>
        <span className="sp" />
        <button className="term-act" title={'New terminal in ' + (cwd || '~')} onClick={() => add()}><Icon name="plus" size={16} /></button>
        <button className="term-act" title="Kill the active terminal" disabled={!cur} onClick={() => cur && close(cur)}><Icon name="trash" size={15} /></button>
        <button className="term-act" title="Hide panel (Ctrl `)" onClick={onClose}>✕</button>
      </div>
      {err && <div className="errbox" style={{ margin: 8 }}>{err}</div>}
      <div className="term-main">
        <div className="term-body">
          {tabs.map(t => <TermView key={t.id} tab={t} active={open && cur === t.id} onExit={id => setTabs(x => x.map(y => (y.id === id ? { ...y, alive: false } : y)))} />)}
        </div>
        {tabs.length > 1 && <div className="term-list" role="tablist">
          {tabs.map(t => (
            <div key={t.id} role="tab" aria-selected={cur === t.id} className={'term-item' + (cur === t.id ? ' on' : '') + (t.alive ? '' : ' dead')} onClick={() => setCur(t.id)} title={t.cwd}>
              <Icon name="terminal" size={14} /><span className="nm">{shellName(t)}</span>
              <button className="x" title="Kill terminal" onClick={e => { e.stopPropagation(); close(t.id); }}><Icon name="trash" size={13} /></button>
            </div>
          ))}
        </div>}
      </div>
    </div>
  );
}
