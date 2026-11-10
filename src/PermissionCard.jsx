import React, { memo, useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const md = t => ({ __html: DOMPurify.sanitize(marked.parse(t || '')) });

function Preview({ toolName, input }) {
  const i = input || {};
  if (toolName === 'Bash') return <pre>{i.command}</pre>;
  if (toolName === 'Edit' && i.old_string != null) return (
    <pre className="diffpre">{i.file_path}{'\n'}{String(i.old_string).split('\n').map((l, k) => <div key={'d' + k} className="diff-del">- {l}</div>)}{String(i.new_string).split('\n').map((l, k) => <div key={'a' + k} className="diff-add">+ {l}</div>)}</pre>
  );
  if (toolName === 'Write') return <pre>{i.file_path}{'\n\n'}{String(i.content || '').slice(0, 3000)}</pre>;
  if (toolName === 'WebFetch') return <pre>{i.url}</pre>;
  return <pre>{JSON.stringify(i, null, 2).slice(0, 3000)}</pre>;
}

const VERB = { Bash: 'run this command', Edit: 'edit this file', Write: 'write this file', MultiEdit: 'edit this file', NotebookEdit: 'edit this notebook', WebFetch: 'fetch this page', WebSearch: 'search the web' };

function Questions({ perm, onAnswer }) {
  const qs = perm.input.questions || [];
  const [pick, setPick] = useState({});
  const [other, setOther] = useState({});
  const toggle = (q, label) => setPick(p => {
    const cur = p[q.question] || [];
    return { ...p, [q.question]: q.multiSelect ? (cur.includes(label) ? cur.filter(x => x !== label) : [...cur, label]) : [label] };
  });
  const answers = {};
  for (const q of qs) {
    const parts = [...(pick[q.question] || [])];
    if (other[q.question]?.trim()) parts.push(other[q.question].trim());
    if (parts.length) answers[q.question] = parts.join(', ');
  }
  const done = qs.every(q => answers[q.question]);
  return (
    <div className="perm ask">
      {qs.map((q, n) => (
        <div key={n} className="qblock">
          <div className="qhead"><span className="qtag">{q.header}</span>{q.question}</div>
          <div className="qopts">
            {q.options.map(o => {
              const on = (pick[q.question] || []).includes(o.label);
              return <button key={o.label} className={'qopt' + (on ? ' on' : '')} onClick={() => toggle(q, o.label)}>
                <b>{o.label}</b><span>{o.description}</span>
              </button>;
            })}
          </div>
          <input className="qother" placeholder="Other… type your own answer" value={other[q.question] || ''} onChange={e => setOther(x => ({ ...x, [q.question]: e.target.value }))} />
        </div>
      ))}
      <div className="acts">
        <button className="b pri" disabled={!done} onClick={() => onAnswer({ decision: 'allow', answers })}>Submit answers</button>
        <button className="b" onClick={() => onAnswer({ decision: 'deny', message: 'The user chose not to answer and will reply in chat instead.' })}>Skip</button>
      </div>
    </div>
  );
}

function PermissionCard({ perm, onAnswer }) {
  const first = useRef();
  useEffect(() => { first.current?.focus(); }, [perm.id]);
  if (perm.toolName === 'AskUserQuestion' && perm.input?.questions) return <Questions perm={perm} onAnswer={onAnswer} />;
  if (perm.toolName === 'ExitPlanMode') return (
    <div className="perm plan" onKeyDown={e => e.key === 'Escape' && onAnswer({ decision: 'deny', message: 'Keep planning. The user wants to refine the plan.' })}>
      <div className="q">Claude's plan is ready</div>
      <div className="planbody a" dangerouslySetInnerHTML={md(perm.input?.plan)} />
      <div className="acts left">
        <button ref={first} className="b pri" onClick={() => onAnswer({ decision: 'allow' })}>Approve plan<span className="k">Enter</span></button>
        <button className="b" onClick={() => onAnswer({ decision: 'deny', message: 'Keep planning. The user wants to refine the plan.' })}>Keep planning<span className="k">Esc</span></button>
      </div>
    </div>
  );
  return (
    <div className="perm" tabIndex={-1} onKeyDown={e => { if (e.key === 'Escape') onAnswer({ decision: 'deny' }); }}>
      <div className="q">Allow Claude to {VERB[perm.toolName] || 'use ' + perm.toolName}?</div>
      {perm.decisionReason && <div className="why">{perm.decisionReason}</div>}
      <Preview toolName={perm.toolName} input={perm.input} />
      <div className="acts left">
        <button ref={first} className="b pri" onClick={() => onAnswer({ decision: 'allow' })}>Allow<span className="k">Enter</span></button>
        {perm.canAlways && <button className="b" onClick={() => onAnswer({ decision: 'always' })}>Always allow</button>}
        <button className="b" onClick={() => onAnswer({ decision: 'deny' })}>Deny<span className="k">Esc</span></button>
      </div>
    </div>
  );
}
export default memo(PermissionCard);
