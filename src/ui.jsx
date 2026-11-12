import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const api = window.cc;

export function rel(iso) {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 60) return 'now';
  if (d < 3600) return Math.floor(d / 60) + 'm';
  if (d < 86400) return Math.floor(d / 3600) + 'h';
  if (d < 86400 * 7) return Math.floor(d / 86400) + 'd';
  if (d < 86400 * 60) return Math.floor(d / 86400 / 7) + 'w';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export const shortPath = (p, home) => (p && home && p.startsWith(home) ? '~' + p.slice(home.length) : p || '');

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
};

import logoUrl from '../assets/icon.svg';
export function Logo({ size = 18 }) {
  return <img src={logoUrl} width={size} height={size} alt="" draggable={false} style={{ display: 'block' }} />;
}

const P = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  folder: <path d="M3 7h7l2 2h9v10H3z" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  chat: <path d="M4 5h16v11H8l-4 4z" />,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  vscode: <path d="m17 3 4 2v14l-4 2L7 12l10-9zM7 12 3 9v6z" />,
  more: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  branch: <><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7v10M18 10c0 4-6 3-12 7" /></>,
  attach: <path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7L10 17.4a1.7 1.7 0 0 1-2.4-2.4l8-8" />,
  up: <path d="M12 19V5M5 12l7-7 7 7" />,
  moved: <path d="M12 2v6M8 6l4-4 4 4M5 12h14M12 22v-6" />,
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  chev: <path d="m6 9 6 6 6-6" />,
  hand: <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 14a1.5 1.5 0 0 1 2.4-1.8L8 15" />,
  code: <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />,
  plan: <><path d="M9 4h6M9 4a2 2 0 0 0-2 2v0h10v0a2 2 0 0 0-2-2" /><rect x="5" y="6" width="14" height="15" rx="2" /><path d="M9 12h6M9 16h4" /></>,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
  warn: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>,
  gauge: <><path d="M4 16a8 8 0 1 1 16 0" /><path d="M12 16l4-5" /></>,
  project: <><rect x="4" y="9" width="16" height="11" rx="2" /><path d="M6 6h12M8 3h8" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
};
export function Icon({ name, size = 15, color, stroke = 2, style }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">{P[name]}</svg>;
}

/** Context menu. items: [{label, onClick, k, danger} | 'sep' | {header}] */
export function Menu({ x, y, items, onClose, up }) {
  const ref = useRef();
  const [pos, setPos] = useState({ left: x, top: y, visibility: 'hidden' });
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    const top = up ? Math.max(8, y - r.height) : Math.min(y, innerHeight - r.height - 8);
    setPos({ left: Math.min(x, innerWidth - r.width - 8), top, maxHeight: innerHeight - 16, overflow: 'auto' });
  }, [x, y]);
  useEffect(() => {
    const close = e => { if (!ref.current?.contains(e.target)) onClose(); };
    const esc = e => e.key === 'Escape' && onClose();
    // attach on the next tick so the click that opened the menu doesn't close it;
    // clear the timer too, or a menu closed within that tick leaves a stray listener behind
    const timer = setTimeout(() => document.addEventListener('mousedown', close));
    document.addEventListener('keydown', esc);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  return (
    <div className="menu" ref={ref} style={pos} role="menu">
      {items.filter(Boolean).map((it, i) => it === 'sep' ? <hr key={i} /> : it.header ? <div key={i} className="mh">{it.header}</div>
        : it.custom ? <React.Fragment key={i}>{it.custom(onClose)}</React.Fragment>
        : it.note ? <div key={i} className="note">{it.note}</div> : (
        <div key={i} role="menuitem" aria-disabled={!!it.disabled} title={it.title} className={'mi' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '')}
          onClick={() => { if (it.disabled) return; onClose(); it.onClick(); }}>
          {it.icon}{it.label}{it.k && <span className="k">{it.k}</span>}
        </div>
      ))}
    </div>
  );
}

export function Modal({ children, onClose, className = 'modal' }) {
  useEffect(() => {
    const esc = e => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return <div className="scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}><div className={'pop ' + className}>{children}</div></div>;
}

export function Highlight({ text, terms }) {
  if (!terms?.length || !text) return text || null;
  const re = new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
  return text.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}
