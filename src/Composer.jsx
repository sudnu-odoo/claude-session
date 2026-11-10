import React, { useEffect, useRef, useState } from 'react';
import { Icon, Menu } from './ui.jsx';

export const MODES = [
  { id: 'default', label: 'Ask permissions', short: 'Ask permissions', desc: 'Claude asks before editing files or running commands' },
  { id: 'acceptEdits', label: 'Edit automatically', short: 'Edit automatically', desc: 'File edits run without asking; commands still ask' },
  { id: 'plan', label: 'Plan mode', short: 'Plan mode', desc: 'Claude explores and proposes a plan, no changes' },
  { id: 'auto', label: 'Auto', short: 'Auto mode', desc: 'A safety classifier approves or asks for each action' },
  { id: 'bypassPermissions', label: 'Bypass permissions', short: 'Bypass permissions', desc: 'Everything runs without asking. Use with care' },
];
const MODE_ICON = { default: 'hand', acceptEdits: 'code', plan: 'plan', auto: 'spark', bypassPermissions: 'warn' };
export const MODELS = [
  { id: '', label: 'Default' }, { id: 'opus', label: 'Opus 5.5' }, { id: 'sonnet', label: 'Sonnet 5.5' }, { id: 'haiku', label: 'Haiku 5.5' }, { id: 'fable', label: 'Fable 5.1' },
];
export const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

import { SCREENS, rankCommands, groupOf, GROUP_ORDER } from './commands.mjs';
export { SCREENS, groupOf };

const MAX_IMG = 5 * 1024 * 1024;
function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return reject(new Error('Only PNG, JPEG, GIF or WebP images'));
    if (file.size > MAX_IMG) return reject(new Error('Image is larger than 5 MB'));
    const fr = new FileReader();
    fr.onload = () => { const url = fr.result; const img = new Image(); img.onload = () => resolve({ name: file.name || 'image.png', mediaType: file.type, data: String(url).split(',')[1], url, w: img.naturalWidth, h: img.naturalHeight }); img.onerror = () => resolve({ name: file.name || 'image.png', mediaType: file.type, data: String(url).split(',')[1], url }); img.src = url; };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

export default function Composer({ running, waiting, onSend, onStop, mode, onMode, model, onModel, effort, onEffort, placeholder, toast, autoFocus, footer, commands = [], onCommand }) {
  const [text, setText] = useState('');
  const [sel, setSel] = useState(0);
  const [slashOff, setSlashOff] = useState(false);
  const slashQ = !slashOff && /^\/[^\s]*$/.test(text) ? text.slice(1) : null;
  let items = [];
  if (slashQ !== null) {
    const ranked = rankCommands(commands, slashQ).slice(0, 80);
    items = slashQ ? ranked : GROUP_ORDER.flatMap(g => ranked.filter(c => groupOf(c) === g));
  }
  useEffect(() => setSel(0), [slashQ]);
  const pick = c => {
    const g = groupOf(c);
    if (g === 'App screens') { setText(''); onCommand?.({ type: 'screen', screen: SCREENS[c.name], name: c.name }); return; }
    if (g === 'Terminal only') { setText(''); onCommand?.({ type: 'terminal', name: c.name }); return; }
    setText('/' + c.name + ' '); setSlashOff(true); ta.current?.focus();
  };
  const [images, setImages] = useState([]);
  const [menu, setMenu] = useState(null);
  const ta = useRef();
  const fileInput = useRef();

  useEffect(() => { if (autoFocus) ta.current?.focus(); }, [autoFocus]);
  useEffect(() => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 240) + 'px'; }, [text]);

  const addFiles = async files => {
    for (const f of files) { try { const img = await readImage(f); setImages(x => [...x, img].slice(0, 5)); } catch (e) { toast(e.message); } }
  };
  const submit = () => {
    const t = text.trim();
    if (!t && !images.length) return;
    onSend(t || 'See the attached image.', images.map(({ mediaType, data }) => ({ mediaType, data })));
    setText(''); setImages([]);
  };
  const modeInfo = MODES.find(m => m.id === mode) || MODES[0];
  const modelLabel = (MODELS.find(m => m.id === model) || { label: model }).label;
  const anchor = e => { const r = e.currentTarget.getBoundingClientRect(); return { x: r.left, y: r.top - 8, up: true }; };

  return (
    <div className="composer" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles([...e.dataTransfer.files]); }}>
      {items.length > 0 && <SlashMenu items={items} sel={sel} setSel={setSel} pick={pick} grouped={!slashQ} />}
      {images.length > 0 && (
        <div className="filechips">
          {images.map((im, i) => (
            <div key={i} className="filechip" title={im.name}><img src={im.url} alt="" /><span>{im.name}</span>{im.w && <small>{im.w}×{im.h}</small>}
              <button aria-label={'Remove ' + im.name} onClick={() => setImages(x => x.filter((_, k) => k !== i))}>✕</button></div>
          ))}
        </div>
      )}
      <textarea ref={ta} rows={1} value={text} placeholder={placeholder}
        onChange={e => { setText(e.target.value); if (!e.target.value.startsWith('/')) setSlashOff(false); if (!e.target.value) setSlashOff(false); }}
        onPaste={e => { const files = [...e.clipboardData.files].filter(f => f.type.startsWith('image/')); if (files.length) { e.preventDefault(); addFiles(files); } }}
        onKeyDown={e => {
          if (items.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel(i => (i + 1) % items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => (i - 1 + items.length) % items.length); return; }
            if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) { e.preventDefault(); pick(items[Math.min(sel, items.length - 1)]); return; }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSlashOff(true); return; }
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
          else if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); const i = MODES.findIndex(m => m.id === mode); onMode(MODES[(i + 1) % 4].id); }
        }} />
      <div className="bar">
        <button className="cbtn" title="Attach image" aria-label="Attach image" onClick={() => fileInput.current.click()}><Icon name="plus" size={18} /></button>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={e => { addFiles([...e.target.files]); e.target.value = ''; }} />
        <button className="cbtn slashbtn" title="Commands and skills" aria-label="Commands and skills" onClick={() => { setText('/'); setSlashOff(false); ta.current?.focus(); }}><span>/</span></button>
        <button className="mchip" title="Model and effort" onClick={e => setMenu({ ...anchor(e), items: [
          { header: 'Model' },
          ...MODELS.map(m => ({ label: m.label + (m.id === model ? '  ✓' : ''), onClick: () => onModel(m.id) })),
          'sep', { header: 'Effort' },
          ...EFFORTS.map(x => ({ label: (x ? x[0].toUpperCase() + x.slice(1) : 'Default') + (x === effort ? '  ✓' : ''), onClick: () => onEffort(x) })),
        ] })}>{modelLabel}{effort && <span className="eff">{effort[0].toUpperCase() + effort.slice(1)}</span>}</button>
        <span className="sp" />
        <button className={'modebtn mode-' + modeInfo.id} title={modeInfo.desc + ' · Shift+Tab to switch'} onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 240, y: r.top - 8, up: true, items: [
          { header: 'Permission mode' },
          ...MODES.map(m => ({ label: m.label + (m.id === mode ? '  ✓' : ''), onClick: () => onMode(m.id) })),
          { note: 'Shift+Tab cycles modes while typing' },
        ] }); }}><Icon name={MODE_ICON[modeInfo.id]} size={15} />{modeInfo.short}</button>
        {running
          ? <button className="sendsq stop" onClick={onStop} title="Stop (Esc)" aria-label="Stop"><span className="sq" /></button>
          : <button className="sendsq" onClick={submit} disabled={!text.trim() && !images.length} aria-label="Send"><Icon name="up" size={17} stroke={2.4} /></button>}
      </div>
      {menu && <Menu x={menu.x} y={menu.y} up items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function SlashMenu({ items, sel, setSel, pick, grouped }) {
  const ref = useRef();
  useEffect(() => { ref.current?.querySelector('.it.on')?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  let last = null;
  return (
    <div className="pop slash" ref={ref} role="listbox" onMouseDown={e => e.preventDefault()}>
      {items.map((c, i) => {
        const g = groupOf(c);
        const head = grouped && g !== last ? <div className="sec" key={'h' + g}>{g}</div> : null;
        last = g;
        return <React.Fragment key={c.name}>{head}
          <div role="option" aria-selected={i === sel} className={'it' + (i === sel ? ' on' : '')} onMouseEnter={() => setSel(i)} onClick={() => pick(c)}>
            <b>/{c.name}</b><span>{c.description}</span>
            {g === 'App screens' && <em>screen</em>}{g === 'Terminal only' && <em>terminal</em>}{g === 'Plugins' && <em>{c.name.split(':')[0]}</em>}
          </div></React.Fragment>;
      })}
    </div>
  );
}
