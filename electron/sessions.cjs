// Reads Claude Code session files (~/.claude/projects/*/*.jsonl).
// Produces per-session metadata, display messages, and search documents.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const readline = require('readline');

const INTERESTING = ['"type":"user"', '"type":"assistant"', '"type":"ai-title"', '"type":"custom-title"', '"type":"summary"', '"type":"cost-state"', '"type":"last-prompt"'];

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(b => b && b.type === 'text').map(b => b.text).join('\n');
  return '';
}

function isHumanPrompt(e) {
  if (e.type !== 'user' || e.isMeta || e.isSidechain) return false;
  const c = e.message && e.message.content;
  if (Array.isArray(c) && c.some(b => b && b.type === 'tool_result')) return false;
  const t = textOf(c).trim();
  if (!t) return false;
  if (t.startsWith('<command-name>')) return true;
  if (t.startsWith('<') || t.startsWith('[Image') || t.startsWith('Caveat:') || t.startsWith('[Request interrupted')) return false;
  return true;
}

function cleanUserText(t) {
  const cmd = t.match(/<command-name>([^<]+)<\/command-name>/);
  if (cmd) {
    const args = (t.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || '';
    return (cmd[1].trim() + ' ' + args.trim()).trim();
  }
  return t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<ide_[a-z_]+>[\s\S]*?<\/ide_[a-z_]+>/g, '').trim();
}

function toolSummary(name, input) {
  input = input || {};
  return String(input.description || input.command || input.file_path || input.pattern || input.query || input.url || input.skill || input.prompt || input.subject || '').slice(0, 300);
}

function resultText(b) {
  let t = typeof b.content === 'string' ? b.content : textOf(b.content);
  if (t.length > 4000) t = t.slice(0, 4000) + '\n… (truncated)';
  return t;
}

function trimInput(input) {
  if (!input || typeof input !== 'object') return input;
  const o = {};
  for (const [k, v] of Object.entries(input)) o[k] = typeof v === 'string' && v.length > 6000 ? v.slice(0, 6000) + '… (truncated)' : v;
  return o;
}

/**
 * Parse a whole session file. Returns { meta, messages }.
 * messages: [{ role, ts, uuid, blocks:[{type:'text',text}|{type:'tool_use',id,name,input,result,isError}] }]
 */
async function parseSession(file) {
  const st = await fsp.stat(file);
  const id = path.basename(file, '.jsonl');
  const meta = {
    id, file, cwd: null, branch: null, aiTitle: '', customTitle: '', firstPrompt: '', lastPrompt: '',
    cost: null, created: null, updated: new Date(st.mtimeMs).toISOString(), mtimeMs: st.mtimeMs, size: st.size,
    userTurns: 0, skills: [], tools: [], hasEdit: false,
  };
  const messages = [];
  const toolIndex = new Map();
  const skills = new Set(), tools = new Set();

  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const head = line.slice(0, 400);
    if (!meta.cwd) { const m = head.match(/"cwd":"((?:[^"\\]|\\.)*)"/); if (m) meta.cwd = JSON.parse('"' + m[1] + '"'); }
    if (!INTERESTING.some(s => head.includes(s)) && !line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.timestamp) { if (!meta.created) meta.created = e.timestamp; }
    if (!meta.cwd && e.cwd) meta.cwd = e.cwd;
    if (!meta.branch && e.gitBranch && e.gitBranch !== 'HEAD') meta.branch = e.gitBranch;
    switch (e.type) {
      case 'ai-title': if (e.aiTitle) meta.aiTitle = e.aiTitle; continue;
      case 'custom-title': if (e.customTitle) meta.customTitle = e.customTitle; continue;
      case 'summary': if (e.summary && !meta.aiTitle) meta.aiTitle = e.summary; continue;
      case 'cost-state': if (typeof e.totalCostUSD === 'number') meta.cost = e.totalCostUSD; continue;
      case 'last-prompt': if (e.lastPrompt) meta.lastPrompt = e.lastPrompt; continue;
    }
    if (e.isSidechain) continue;
    const c = e.message && e.message.content;
    if (e.type === 'user') {
      if (Array.isArray(c)) for (const b of c) {
        if (b && b.type === 'tool_result' && toolIndex.has(b.tool_use_id)) {
          const tb = toolIndex.get(b.tool_use_id); tb.result = resultText(b); tb.isError = !!b.is_error;
        }
      }
      if (!isHumanPrompt(e)) continue;
      const text = cleanUserText(textOf(c));
      if (!text) continue;
      const slash = text.match(/^\/([\w:.-]+)/); if (slash) skills.add(slash[1]);
      meta.userTurns++;
      if (!meta.firstPrompt) meta.firstPrompt = text.slice(0, 500);
      const images = Array.isArray(c) ? c.filter(b => b.type === 'image').length : 0;
      messages.push({ role: 'user', ts: e.timestamp, uuid: e.uuid, blocks: [{ type: 'text', text }], images });
    } else if (e.type === 'assistant' && Array.isArray(c)) {
      const blocks = [];
      for (const b of c) {
        if (b.type === 'text' && b.text && b.text.trim()) blocks.push({ type: 'text', text: b.text });
        else if (b.type === 'tool_use') {
          const tb = { type: 'tool_use', id: b.id, name: b.name, input: trimInput(b.input), summary: toolSummary(b.name, b.input) };
          toolIndex.set(b.id, tb); blocks.push(tb); tools.add(b.name);
          if (b.name === 'Skill' && b.input && b.input.skill) skills.add(b.input.skill);
          if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(b.name)) meta.hasEdit = true;
        }
      }
      if (!blocks.length) continue;
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant') last.blocks.push(...blocks);
      else messages.push({ role: 'assistant', ts: e.timestamp, uuid: e.uuid, blocks });
    }
  }
  meta.skills = [...skills]; meta.tools = [...tools];
  meta.messageCount = messages.length;
  return { meta, messages };
}

/** Search documents for one parsed session: one per message (text capped). */
function searchDocs(meta, messages) {
  const docs = [];
  messages.forEach((m, i) => {
    let text = m.blocks.map(b => {
      if (b.type === 'text') return b.text;
      const i = b.input || {};
      const extra = [i.command, i.old_string, i.new_string, i.content, i.pattern].filter(v => typeof v === 'string').join('\n').slice(0, 1200);
      const res = typeof b.result === 'string' ? b.result.slice(0, 1200) : '';
      return `${b.name} ${b.summary || ''}\n${extra}\n${res}`;
    }).join('\n');
    if (text.length > 12000) text = text.slice(0, 12000);
    if (text.trim()) docs.push({ id: meta.id + ':' + i, sid: meta.id, idx: i, role: m.role, text });
  });
  return docs;
}

async function listSessionFiles(projectsDir) {
  const out = [];
  let dirs = [];
  try { dirs = await fsp.readdir(projectsDir, { withFileTypes: true }); } catch { return out; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const pdir = path.join(projectsDir, d.name);
    let files = [];
    try { files = await fsp.readdir(pdir); } catch { continue; }
    for (const f of files) if (f.endsWith('.jsonl')) out.push(path.join(pdir, f));
  }
  return out;
}

module.exports = { parseSession, searchDocs, listSessionFiles };
