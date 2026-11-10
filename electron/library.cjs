// The session library: indexes all sessions, keeps a full-text index, resolves categories.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const MiniSearch = require('minisearch');
const { parseSession, searchDocs, listSessionFiles } = require('./sessions.cjs');
const { autoCategory, workspaceLabel } = require('./categorize.cjs');

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const ACTIVE_MS = 20_000;

function newIndex() {
  return new MiniSearch({
    fields: ['text', 'title'],
    storeFields: ['sid', 'idx'],
    searchOptions: { boost: { title: 4 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' },
    tokenize: s => s.toLowerCase().split(/[\s,;:!?()\[\]{}<>"'`=|/\\]+/).filter(Boolean),
  });
}

class Library extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.sessions = new Map();   // id -> meta
    this.docText = new Map();    // docId -> text (for snippets)
    this.docsBySession = new Map();
    this.msgCache = new Map();   // id -> messages (small LRU)
    this.index = newIndex();
    this.ready = false;
  }

  async init() {
    const files = await listSessionFiles(PROJECTS_DIR);
    for (const f of files) await this.indexFile(f, true);
    this.ready = true;
    this.watch();
    this.emit('changed');
  }

  async indexFile(file, quiet) {
    let parsed;
    try { parsed = await parseSession(file); } catch { return; }
    const { meta, messages } = parsed;
    if (!messages.length && !meta.aiTitle) { this.removeSession(meta.id); return; }
    this.removeDocs(meta.id);
    this.sessions.set(meta.id, meta);
    const docs = searchDocs(meta, messages);
    const title = this.titleOf(meta);
    docs.push({ id: meta.id + ':t', sid: meta.id, idx: -1, text: '', title: title + ' ' + (meta.cwd || '') });
    for (const d of docs) this.docText.set(d.id, d.text || d.title);
    this.index.addAll(docs);
    this.docsBySession.set(meta.id, docs.map(d => d.id));
    if (this.msgCache.has(meta.id)) this.msgCache.set(meta.id, messages);
    if (!quiet) this.emit('changed', meta.id);
  }

  removeDocs(id) {
    const ids = this.docsBySession.get(id);
    if (!ids) return;
    for (const d of ids) { if (this.index.has(d)) this.index.discard(d); this.docText.delete(d); }
    this.docsBySession.delete(id);
  }
  removeSession(id) {
    this.removeDocs(id); this.sessions.delete(id); this.msgCache.delete(id);
  }

  watch() {
    const timers = new Map();
    try {
      this.watcher = fs.watch(PROJECTS_DIR, { recursive: true }, (_ev, rel) => {
        if (!rel || !rel.endsWith('.jsonl') || rel.split(path.sep).length !== 2) return;
        const file = path.join(PROJECTS_DIR, rel);
        clearTimeout(timers.get(file));
        timers.set(file, setTimeout(() => {
          timers.delete(file);
          if (fs.existsSync(file)) this.indexFile(file);
          else { this.removeSession(path.basename(file, '.jsonl')); this.emit('changed'); }
        }, 700));
      });
    } catch (e) { console.error('watch failed', e); }
    // re-emit periodically so "active" dots fade out
    this.tickTimer = setInterval(() => this.emit('tick'), 15_000);
  }

  close() { if (this.watcher) this.watcher.close(); clearInterval(this.tickTimer); }

  titleOf(meta) {
    return this.store.d.names[meta.id] || meta.customTitle || meta.aiTitle || (meta.firstPrompt || meta.lastPrompt || 'Untitled').slice(0, 90);
  }

  categoryOf(meta) {
    const d = this.store.d;
    const valid = id => d.categories.some(c => c.id === id);
    if (valid(d.sessionCategory[meta.id])) return { categoryId: d.sessionCategory[meta.id], placed: 'session' };
    const auto = autoCategory(meta, HOME);
    if (auto !== 'analysis' && meta.cwd && valid(d.workspaceCategory[meta.cwd])) return { categoryId: d.workspaceCategory[meta.cwd], placed: 'workspace' };
    return { categoryId: valid(auto) ? auto : (d.categories[0] && d.categories[0].id), placed: null };
  }

  view(meta) {
    const cat = this.categoryOf(meta);
    const ws = workspaceLabel(meta.cwd, HOME);
    return {
      id: meta.id, title: this.titleOf(meta), autoTitle: meta.customTitle || meta.aiTitle || '', renamed: !!this.store.d.names[meta.id],
      cwd: meta.cwd || HOME, workspace: ws, branch: meta.branch, created: meta.created, updated: meta.updated,
      cost: meta.cost, size: meta.size, userTurns: meta.userTurns, messageCount: meta.messageCount, skills: meta.skills, hasEdit: meta.hasEdit,
      firstPrompt: (meta.firstPrompt || '').slice(0, 200),
      categoryId: cat.categoryId, placed: cat.placed,
      pinned: !!this.store.d.pinned[meta.id], archived: !!this.store.d.archived[meta.id],
      active: Date.now() - meta.mtimeMs < ACTIVE_MS,
    };
  }

  list() {
    return [...this.sessions.values()].map(m => this.view(m)).sort((a, b) => b.updated.localeCompare(a.updated));
  }

  async messages(id, before, limit = 60) {
    const meta = this.sessions.get(id);
    if (!meta) throw new Error('Session not found');
    let msgs = this.msgCache.get(id);
    if (!msgs) {
      msgs = (await parseSession(meta.file)).messages;
      this.msgCache.set(id, msgs);
      if (this.msgCache.size > 6) this.msgCache.delete(this.msgCache.keys().next().value);
    }
    const end = before == null ? msgs.length : Math.max(0, Math.min(before, msgs.length));
    const start = Math.max(0, end - limit);
    return { total: msgs.length, start, messages: msgs.slice(start, end).map((m, i) => ({ ...m, idx: start + i })) };
  }

  /** Query with filters: in:<cat> ws:<text> after:<date> before:<date> has:edit|bash|skill|<tool> */
  search(raw) {
    const filters = { in: [], ws: [], has: [], after: null, before: null };
    const terms = [];
    for (const tok of String(raw || '').match(/\S+:"[^"]*"|"[^"]*"|\S+/g) || []) {
      const m = tok.match(/^(in|ws|has|after|before):(.+)$/i);
      if (m) { const k = m[1].toLowerCase(), v = m[2].replace(/^"|"$/g, '').toLowerCase(); Array.isArray(filters[k]) ? filters[k].push(v) : (filters[k] = v); }
      else terms.push(tok.replace(/^"|"$/g, ''));
    }
    const cats = this.store.d.categories;
    const pass = v => {
      if (!this.store.d.settings.showArchived && v.archived && !filters.has.includes('archived')) return false;
      if (filters.in.length && !filters.in.some(f => { const c = cats.find(c => c.id === v.categoryId); return c && (c.id.startsWith(f) || c.name.toLowerCase().includes(f)); })) return false;
      if (filters.ws.length && !filters.ws.some(f => (v.cwd + ' ' + v.workspace.name).toLowerCase().includes(f))) return false;
      if (filters.after && v.updated.slice(0, 10) < filters.after) return false;
      if (filters.before && v.updated.slice(0, 10) > filters.before) return false;
      for (const h of filters.has) {
        if (h === 'archived') continue;
        if (h === 'edit' && !v.hasEdit) return false;
        if (h === 'skill' && !v.skills.length) return false;
        if (!['edit', 'skill'].includes(h)) { const meta = this.sessions.get(v.id); if (!meta.tools.some(t => t.toLowerCase() === h) && !meta.skills.some(s => s.toLowerCase().includes(h))) return false; }
      }
      return true;
    };
    const q = terms.join(' ').trim();
    const views = new Map();
    const getView = id => { if (!views.has(id)) { const m = this.sessions.get(id); views.set(id, m ? this.view(m) : null); } return views.get(id); };

    if (!q) {
      return [...this.sessions.values()].map(m => getView(m.id)).filter(v => v && pass(v))
        .sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 60).map(v => ({ session: v, hits: [], score: 0 }));
    }
    const results = this.index.search(q);
    const bySession = new Map();
    for (const r of results) {
      const v = getView(r.sid); if (!v || !pass(v)) continue;
      let g = bySession.get(r.sid);
      if (!g) { g = { session: v, hits: [], score: 0 }; bySession.set(r.sid, g); }
      g.score += r.score;
      if (r.idx >= 0 && g.hits.length < 3) g.hits.push({ idx: r.idx, snippet: snippet(this.docText.get(r.id), r.terms) , terms: r.terms });
      if (r.idx < 0) g.score += 50;
    }
    return [...bySession.values()].sort((a, b) => b.score - a.score).slice(0, 50);
  }
}

function snippet(text, terms) {
  if (!text) return '';
  const lower = text.toLowerCase();
  let pos = -1;
  for (const t of terms) { pos = lower.indexOf(t.toLowerCase()); if (pos >= 0) break; }
  if (pos < 0) pos = 0;
  const start = Math.max(0, pos - 70);
  return (start > 0 ? '…' : '') + text.slice(start, start + 220).replace(/\s+/g, ' ') + (start + 220 < text.length ? '…' : '');
}

module.exports = { Library, HOME, CLAUDE_DIR, PROJECTS_DIR };
