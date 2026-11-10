import React, { useEffect, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api, Modal, shortPath } from './ui.jsx';

const clean = e => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const SCOPE = { user: 'All my folders', project: 'This folder', plugin: 'Plugin' };
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function splitMd(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text || '');
  return m ? { front: m[1], body: text.slice(m[0].length) } : { front: '', body: text || '' };
}
function buildMd(name, description, body) {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description.replace(/\s+/g, ' ').trim())}\n---\n\n${body.trim()}\n`;
}

function MdView({ text }) {
  const { front, body } = splitMd(text);
  return <>
    {front && <pre className="skfront">{front}</pre>}
    <div className="skmd" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(body)) }} />
  </>;
}

function SkillView({ skill, cwd, home, onBack, onDeleted, toast }) {
  const [text, setText] = useState(null);
  const [mode, setMode] = useState('preview');
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState(null);
  const [how, setHow] = useState('prompt');
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const revise = async () => {
    setBusy(true); setErr(null);
    try { setDraft(await api.skills.revise(draft, ask)); setHow('manual'); toast?.('Claude updated the draft. Review it, then Save.'); } catch (e) { setErr(clean(e)); }
    setBusy(false);
  };
  useEffect(() => { api.skills.read(skill.path, cwd).then(setText, e => setErr(clean(e))); }, [skill.path]);
  const save = async () => {
    try { await api.skills.save(skill.path, draft, cwd); setText(draft); setMode('preview'); toast?.('Saved ' + skill.name); } catch (e) { setErr(clean(e)); }
  };
  const del = async () => {
    if (!confirm(`Delete the skill “${skill.name}”? Its whole folder (${shortPath(skill.dir, home)}) is removed.`)) return;
    try { await api.skills.remove(skill.path, cwd); toast?.('Deleted ' + skill.name); onDeleted(); } catch (e) { setErr(clean(e)); }
  };
  return (
    <Modal onClose={onBack} className="modal wide">
      <h2>{skill.name}</h2>
      <div className="sub">{SCOPE[skill.scope]}{skill.plugin ? ' · ' + skill.plugin : ''} · <code>{shortPath(skill.path, home)}</code></div>
      <div className="seg" role="tablist">
        {[['preview', 'Preview'], ['source', 'Source'], ...(skill.editable ? [['edit', 'Edit']] : [])].map(([v, l]) =>
          <button key={v} role="tab" aria-selected={mode === v} className={mode === v ? 'on' : ''} onClick={() => { if (v === 'edit') setDraft(text || ''); setMode(v); }}>{l}</button>)}
      </div>
      {err && <div className="errbox">{err}</div>}
      <div className="skbody">
        {text == null && !err && <div className="notice"><span className="spin">✻</span> Reading…</div>}
        {text != null && mode === 'preview' && <MdView text={text} />}
        {text != null && mode === 'source' && <pre className="sksrc">{text}</pre>}
        {mode === 'edit' && <div className="mcpform">
          <div className="seg" role="radiogroup" aria-label="How to edit" style={{ alignSelf: 'flex-start' }}>
            {[['prompt', 'Ask Claude to change it'], ['manual', 'Edit it myself']].map(([v, l]) =>
              <button key={v} role="radio" aria-checked={how === v} className={how === v ? 'on' : ''} onClick={() => setHow(v)}>{l}</button>)}
          </div>
          {how === 'prompt' && <>
            <label>What should change?
              <textarea autoFocus rows={3} value={ask} onChange={e => setAsk(e.target.value)} placeholder="e.g. Add a step to run the tests before committing, and make the description mention changelogs." /></label>
            <div><button className="b" onClick={revise} disabled={busy || !ask.trim()}>{busy ? 'Claude is editing…' : 'Apply with Claude'}</button></div>
          </>}
          <label>SKILL.md {draft !== text && <span className="opt">· unsaved changes</span>}
            <textarea className="skedit" value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false} readOnly={busy} /></label>
        </div>}
      </div>
      <div className="acts">
        {skill.editable && <button className="b danger" style={{ marginRight: 'auto' }} onClick={del}>Delete skill</button>}
        <button className="b" onClick={() => api.copy(text || '')}>Copy</button>
        {mode === 'edit'
          ? <><button className="b" onClick={() => setMode('preview')}>Cancel</button><button className="b pri" onClick={save} disabled={busy || draft === text}>Save</button></>
          : <button className="b pri" onClick={onBack}>Back</button>}
      </div>
    </Modal>
  );
}

function NewSkill({ cwd, home, onCancel, onDone }) {
  const [how, setHow] = useState('prompt');
  const [scope, setScope] = useState('user');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [body, setBody] = useState('');
  const [prompt, setPrompt] = useState('');
  const [generated, setGenerated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const projectOk = cwd && cwd !== home;

  const generate = async () => {
    setBusy(true); setErr(null);
    try {
      const md = await api.skills.generate(prompt, name.trim() || undefined);
      setGenerated(md);
      const n = /^name:\s*["']?([a-z0-9-]+)/m.exec(md); if (n && !name) setName(n[1]);
    } catch (e) { setErr(clean(e)); }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const content = how === 'prompt' ? generated : buildMd(name.trim(), desc, body);
      await api.skills.create({ name: name.trim(), scope, content }, cwd);
      onDone(name.trim());
    } catch (e) { setErr(clean(e)); setBusy(false); }
  };
  const nameBad = name && !NAME_RE.test(name.trim());
  const canSave = !busy && NAME_RE.test(name.trim()) && (how === 'prompt' ? !!generated : desc.trim() && body.trim());

  return (
    <Modal onClose={onCancel} className="modal wide">
      <h2>New skill</h2>
      <div className="sub">A skill is a SKILL.md file of instructions Claude loads when its description matches the task.</div>
      <div className="seg" role="radiogroup" aria-label="How">
        {[['prompt', 'Describe it to Claude'], ['manual', 'Write it myself']].map(([v, l]) =>
          <button key={v} role="radio" aria-checked={how === v} className={how === v ? 'on' : ''} onClick={() => { setHow(v); setErr(null); }}>{l}</button>)}
      </div>
      <div className="mcpform">
        <label>Name <span className="opt">{how === 'prompt' ? 'optional, Claude picks one if empty' : 'lowercase-with-dashes'}</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. release-notes" spellCheck={false} className="mono" /></label>
        {nameBad && <div className="sub" style={{ color: 'var(--bad)', margin: 0 }}>Use lowercase letters, digits and dashes only.</div>}
        {how === 'prompt' ? <>
          <label>What should the skill do?
            <textarea autoFocus rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. Write release notes from the git log since the last tag, grouped by feature/fix, in our changelog style." /></label>
          <div><button className="b" onClick={generate} disabled={busy || !prompt.trim()}>{busy && !generated ? 'Generating…' : generated ? 'Regenerate' : 'Generate SKILL.md'}</button></div>
          {generated != null && <label>Generated SKILL.md <span className="opt">review and edit before saving</span>
            <textarea className="skedit mono" value={generated} onChange={e => setGenerated(e.target.value)} spellCheck={false} /></label>}
        </> : <>
          <label>Description <span className="opt">what it does and when Claude should use it</span>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Draft release notes from git history. Use when asked for release notes or a changelog." /></label>
          <label>Instructions <span className="opt">Markdown</span>
            <textarea className="skedit mono" value={body} onChange={e => setBody(e.target.value)} placeholder={'# Release notes\n\n1. Run `git log` since the last tag\n2. …'} spellCheck={false} /></label>
        </>}
        <label>Available in
          <select value={scope} onChange={e => setScope(e.target.value)}>
            <option value="user">All my folders (~/.claude/skills)</option>
            <option value="project" disabled={!projectOk}>This folder only (.claude/skills){projectOk ? '' : ' — open a chat first'}</option>
          </select>
        </label>
        {scope === 'project' && <div className="sub" style={{ margin: 0 }}>Folder: <code>{cwd}</code></div>}
      </div>
      {err && <div className="errbox">{err}</div>}
      <div className="acts">
        <button className="b" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="b pri" onClick={save} disabled={!canSave}>Save skill</button>
      </div>
    </Modal>
  );
}

export function SkillsPanel({ cwd, home, onClose, toast }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [view, setView] = useState(null); // skill object | 'new'
  const load = () => api.skills.list(cwd).then(l => { setList(l); setErr(null); }, e => setErr(clean(e)));
  useEffect(() => { load(); }, [cwd]);

  if (view === 'new') return <NewSkill cwd={cwd} home={home} onCancel={() => setView(null)} onDone={n => { toast?.('Added ' + n); setView(null); load(); }} />;
  if (view) return <SkillView skill={view} cwd={cwd} home={home} toast={toast} onBack={() => setView(null)} onDeleted={() => { setView(null); load(); }} />;

  const ql = q.toLowerCase();
  const count = k => (list || []).filter(s => k === 'all' || (k === 'plugin') === (s.scope === 'plugin')).length;
  const shown = (list || []).filter(s => kind === 'all' || (kind === 'plugin') === (s.scope === 'plugin')).filter(s => !ql ||s.name.toLowerCase().includes(ql) || s.description.toLowerCase().includes(ql));
  const groups = ['project', 'user', 'plugin'].map(sc => [sc, shown.filter(s => s.scope === sc)]).filter(([, l]) => l.length);
  return (
    <Modal onClose={onClose} className="modal wide">
      <h2>Skills</h2>
      <div className="sub">Instructions Claude loads on demand. Changes apply to new chats.</div>
      <div className="sktools">
        <div className="seg" role="radiogroup" aria-label="Show">
          {[['all', 'All'], ['skills', 'My skills'], ['plugin', 'Plugins']].map(([v, l]) =>
            <button key={v} role="radio" aria-checked={kind === v} className={kind === v ? 'on' : ''} onClick={() => setKind(v)}>{l}{list && <span className="muted"> {count(v)}</span>}</button>)}
        </div>
        <input className="skq" placeholder="Filter skills…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {list == null && !err && <div className="notice" style={{ padding: 24 }}><span className="spin">✻</span> Reading skills…</div>}
      {err && <div className="errbox">{err}</div>}
      {groups.map(([sc, l]) => <div key={sc}>
        <h3>{SCOPE[sc]} <span className="muted">· {l.length}</span></h3>
        <div className="move-list">
          {l.map(s => (
            <div key={s.path} className="opt mcprow" onClick={() => setView(s)}>
              <span style={{ flex: 1, minWidth: 0 }}><b>{s.plugin ? s.plugin + ':' : ''}{s.name}</b><br /><span className="muted skdesc">{s.description}</span></span>
              {s.editable && <button className="ibtn rm" title={'Delete ' + s.name} onClick={async e => {
                e.stopPropagation();
                if (!confirm(`Delete the skill “${s.name}”?`)) return;
                try { await api.skills.remove(s.path, cwd); toast?.('Deleted ' + s.name); load(); } catch (x) { alert(clean(x)); }
              }}>Delete</button>}
            </div>
          ))}
        </div>
      </div>)}
      {list && !list.length && <div className="sub">No skills yet.</div>}
      <div className="acts">
        <button className="b" style={{ marginRight: 'auto' }} onClick={() => setView('new')}>+ New skill</button>
        <button className="b" onClick={load}>Refresh</button><button className="b pri" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
