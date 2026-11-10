import React, { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api, Modal, store } from './ui.jsx';

const clean = e => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const SIX_HOURS = 6 * 3600_000;
const mb = n => (n / 1048576).toFixed(1) + ' MB';

/** Checks GitHub Releases on startup and every 6 hours. `skipped` versions don't show the badge. */
export function useUpdates() {
  const [info, setInfo] = useState(null); // { current, update, canInstall }
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [skipped, setSkippedState] = useState(() => store.get('update.skipped', ''));
  const check = async () => {
    setChecking(true); setError(null);
    try { const r = await api.update.check(); setInfo(r); return r; } catch (e) { setError(clean(e)); return null; } finally { setChecking(false); }
  };
  useEffect(() => {
    const first = setTimeout(check, 5000);
    const every = setInterval(check, SIX_HOURS);
    return () => { clearTimeout(first); clearInterval(every); };
  }, []);
  const skip = v => { store.set('update.skipped', v); setSkippedState(v); };
  const available = info?.update && info.update.version !== skipped ? info.update : null;
  return { info, available, checking, error, check, skip };
}

export function UpdateBadge({ onClick }) {
  return <button className="upd-pill" onClick={onClick} title="A new version is ready to install"><span className="dot" />Update available</button>;
}

export function UpdateDialog({ updates, onClose }) {
  const { info } = updates;
  const u = info?.update;
  const [phase, setPhase] = useState('idle'); // idle | download | install | done
  const [prog, setProg] = useState({ got: 0, total: 0 });
  const [err, setErr] = useState(null);
  const busy = phase === 'download' || phase === 'install';
  const busyRef = useRef(false); busyRef.current = busy;
  useEffect(() => api.on('update:progress', d => { if (d.phase === 'download') setProg(d); }), []);

  const run = async () => {
    setErr(null);
    try {
      setPhase('download'); await api.update.download(u);
      setPhase('install'); await api.update.install();
      setPhase('done'); // the app restarts by itself
    } catch (e) { setErr(clean(e)); setPhase('idle'); }
  };
  const close = () => { if (!busyRef.current) onClose(); };

  if (!u) return (
    <Modal onClose={close}>
      <h2>Updates</h2>
      <div className="sub">You have version {info?.current}.</div>
      {updates.checking ? <div className="notice"><span className="spin">✻</span> Checking…</div>
        : updates.error ? <div className="errbox">{updates.error}</div>
        : <div className="sub">You're on the latest version.</div>}
      <div className="acts"><button className="b" onClick={updates.check} disabled={updates.checking}>Check again</button><button className="b pri" onClick={close}>Close</button></div>
    </Modal>
  );

  const pct = prog.total ? Math.round(prog.got / prog.total * 100) : 0;
  return (
    <Modal onClose={close} className="modal wide">
      <h2>Version {u.version} is available</h2>
      <div className="sub">You have {u.current}.{u.date ? ' Released ' + new Date(u.date).toLocaleDateString() + '.' : ''}</div>
      <h3>What's new</h3>
      <div className="skmd upd-notes" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(u.notes || '_No release notes._')) }} />
      {phase === 'download' && <div className="lim"><div className="row"><span>Downloading{u.asset ? ' ' + u.asset.name : ''}</span><small>{prog.total ? `${mb(prog.got)} of ${mb(prog.total)}` : ''}</small></div>
        <div className="bar2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: pct + '%' }} /></div></div>}
      {phase === 'install' && <div className="notice"><span className="spin">✻</span> Installing… enter your password in the system prompt.</div>}
      {phase === 'done' && <div className="notice">Installed. Restarting…</div>}
      {err && <div className="errbox">{err}</div>}
      {!info.canInstall && <div className="sub" style={{ marginTop: 10 }}>This copy can't update itself (it isn't the installed .deb). Download the new version from the release page instead.</div>}
      <div className="acts">
        <button className="b" style={{ marginRight: 'auto' }} onClick={() => api.update.page(u.page)} disabled={busy}>Release page</button>
        <button className="b" onClick={() => { updates.skip(u.version); onClose(); }} disabled={busy}>Skip this version</button>
        <button className="b" onClick={close} disabled={busy}>Later</button>
        {info.canInstall && <button className="b pri" onClick={run} disabled={busy || phase === 'done'}>{busy ? 'Updating…' : 'Update and restart'}</button>}
      </div>
    </Modal>
  );
}
