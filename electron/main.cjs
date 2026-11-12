const { app, BrowserWindow, ipcMain, nativeTheme, shell, clipboard, dialog, Menu, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Store } = require('./store.cjs');
const { Library, HOME } = require('./library.cjs');
const { ChatManager, sdk, CLAUDE_BIN } = require('./chat.cjs');
const mcpConfig = require('./mcpConfig.cjs');
const skills = require('./skills.cjs');
const { Updater } = require('./updater.cjs');
const { Terminals } = require('./terminal.cjs');
const { sdk: loadSdk, CLAUDE_BIN: CLAUDE } = require('./chat.cjs');
const { execFile } = require('child_process');
const { Control } = require('./control.cjs');

app.setName('Claude Sessions');
// Tests and screenshots run against an isolated profile so they never touch the real app state.
if (process.env.CC_USER_DATA) { app.setPath('userData', process.env.CC_USER_DATA); app.setPath('sessionData', process.env.CC_USER_DATA); }
// The app was called "Claude Code" during development: carry its saved state over once
// (app state + the UI's saved preferences; caches and lock files are left behind).
if (!process.env.CC_USER_DATA) {
  const now = app.getPath('userData'), before = path.join(path.dirname(now), 'Claude Code');
  try {
    if (!fs.existsSync(path.join(now, 'state.json')) && fs.existsSync(path.join(before, 'state.json'))) {
      fs.mkdirSync(now, { recursive: true });
      fs.copyFileSync(path.join(before, 'state.json'), path.join(now, 'state.json'));
      const ls = path.join(before, 'Local Storage');
      if (fs.existsSync(ls)) fs.cpSync(ls, path.join(now, 'Local Storage'), { recursive: true, force: true, filter: src => !/LOCK$/.test(src) });
    }
  } catch (e) { console.error('migrate', e.message); }
}

let win, store, lib, chat, control, updater;
const terms = new Terminals((ch, d) => send(ch, d));

/** One-shot, tool-less Claude call that returns a SKILL.md (no session file is written). */
async function askClaudeText(prompt) {
  if (!CLAUDE) throw new Error('Claude Code is not installed (no `claude` command found).');
  const { query } = await loadSdk();
  const q = query({ prompt, options: { cwd: HOME, tools: [], maxTurns: 1, persistSession: false, settingSources: [], pathToClaudeCodeExecutable: CLAUDE } });
  let text = '';
  for await (const m of q) {
    if (m.type === 'result') { if (m.is_error || m.subtype !== 'success') throw new Error(m.result || 'Claude could not answer'); text = m.result; }
  }
  return text;
}
async function askForSkill(prompt) { return skills.extractSkillMd(await askClaudeText(prompt)); }
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    title: 'Claude Sessions', frame: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#262624' : '#faf9f5',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  if (process.env.VITE_DEV) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('maximize', () => send('window:state', { maximized: true }));
  win.on('unmaximize', () => send('window:state', { maximized: false }));
}
function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

function applyTheme() { nativeTheme.themeSource = store.d.settings.theme || 'system'; }

function snapshot() {
  return { ready: lib.ready, sessions: lib.list(), categories: store.d.categories, settings: store.d.settings, home: HOME, runs: chat ? chat.status() : {} };
}

function toMarkdown(view, messages) {
  const out = [`# ${view.title}`, '', `- Folder: \`${view.cwd}\``, `- Session: \`${view.id}\``, `- Updated: ${view.updated}`, ''];
  for (const m of messages) {
    out.push(m.role === 'user' ? '## You' : '## Claude', '');
    for (const b of m.blocks) {
      if (b.type === 'text') out.push(b.text, '');
      else out.push(`> **${b.name}** ${b.summary || ''}`.trim(), '');
    }
  }
  return out.join('\n');
}

const handlers = {
  'lib:snapshot': () => snapshot(),
  'lib:messages': (_e, id, before, limit) => lib.messages(id, before, limit),
  'lib:search': (_e, q) => lib.search(q),

  'session:move': (_e, ids, categoryId) => {
    for (const id of [].concat(ids)) { if (categoryId) store.d.sessionCategory[id] = categoryId; else delete store.d.sessionCategory[id]; }
    store.save(); return snapshot();
  },
  'workspace:move': (_e, cwd, categoryId) => { if (categoryId) store.d.workspaceCategory[cwd] = categoryId; else delete store.d.workspaceCategory[cwd]; store.save(); return snapshot(); },
  'session:rename': (_e, id, name) => {
    name = String(name || '').trim();
    if (name) store.d.names[id] = name.slice(0, 200); else delete store.d.names[id];
    store.save();
    const m0 = lib.sessions.get(id);
    if (name && m0) sdk().then(s => s.renameSession(id, name.slice(0, 200), { dir: m0.cwd })).catch(e => console.error('renameSession', e.message));
    const meta = lib.sessions.get(id); if (meta) lib.indexFile(meta.file, true);
    return snapshot();
  },
  'session:pin': (_e, ids, on) => { for (const id of [].concat(ids)) { if (on) store.d.pinned[id] = true; else delete store.d.pinned[id]; } store.save(); return snapshot(); },
  'session:archive': (_e, ids, on) => { for (const id of [].concat(ids)) { if (on) store.d.archived[id] = true; else delete store.d.archived[id]; } store.save(); return snapshot(); },
  'session:delete': async (_e, id) => {
    const meta = lib.sessions.get(id); if (!meta) return snapshot();
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Cancel', 'Move to Trash'], defaultId: 0, cancelId: 0, message: `Delete "${lib.titleOf(meta)}"?`, detail: 'The session file is moved to your system Trash. It disappears from Claude Code too (claude --resume, VS Code). You can restore it from the Trash.' });
    if (r.response !== 1) return snapshot();
    await shell.trashItem(meta.file);
    const sub = meta.file.replace(/\.jsonl$/, ''); if (fs.existsSync(sub)) await shell.trashItem(sub).catch(() => {});
    lib.removeSession(id);
    for (const k of ['names', 'pinned', 'archived', 'sessionCategory']) delete store.d[k][id];
    store.save();
    return snapshot();
  },
  'session:export': async (_e, id) => {
    const meta = lib.sessions.get(id); if (!meta) return false;
    const view = lib.view(meta);
    const safe = view.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || id;
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), safe + '.md'), filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (r.canceled || !r.filePath) return false;
    const { messages } = await lib.messages(id, null, 1e9);
    fs.writeFileSync(r.filePath, toMarkdown(view, messages));
    return r.filePath;
  },
  'session:copyResume': (_e, id) => {
    const meta = lib.sessions.get(id); if (!meta) return '';
    const cmd = `cd ${JSON.stringify(meta.cwd || HOME)} && claude --resume ${id}`;
    clipboard.writeText(cmd); return cmd;
  },
  'open:vscode': (_e, cwd) => {
    if (!cwd || !fs.existsSync(cwd)) throw new Error('Folder not found: ' + cwd);
    const child = spawn('code', [cwd], { detached: true, stdio: 'ignore' });
    child.on('error', () => shell.openPath(cwd)); child.unref(); return true;
  },
  'open:folder': (_e, cwd) => shell.openPath(cwd),

  'category:create': (_e, name, color) => {
    let id = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category';
    while (store.d.categories.some(c => c.id === id)) id += '-2';
    store.d.categories.push({ id, name: String(name).slice(0, 60), color: color || '#b5651d', icon: 'folder', layout: 'workspace' });
    store.save(); return snapshot();
  },
  'category:update': (_e, id, patch) => {
    const c = store.d.categories.find(c => c.id === id);
    if (c) for (const k of ['name', 'color', 'layout']) if (patch[k] != null) c[k] = patch[k];
    store.save(); return snapshot();
  },
  'category:delete': (_e, id) => {
    const c = store.d.categories.find(c => c.id === id);
    if (!c) return snapshot();
    const count = lib.list().filter(s => s.categoryId === id).length;
    if (count) throw new Error(`“${c.name}” still has ${count} chat${count > 1 ? 's' : ''}. Move them out first.`);
    if (store.d.categories.length <= 1) throw new Error('Keep at least one category.');
    store.d.categories = store.d.categories.filter(x => x.id !== id);
    for (const map of [store.d.sessionCategory, store.d.workspaceCategory]) for (const [k, v] of Object.entries(map)) if (v === id) delete map[k];
    store.save(); return snapshot();
  },
  'category:reorder': (_e, ids) => { store.d.categories.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)); store.save(); return snapshot(); },

  'chat:send': (_e, opts, text, images) => {
    if (opts.cwd && !fs.existsSync(opts.cwd)) throw new Error('Folder not found: ' + opts.cwd);
    if (opts.sessionId && !opts.cwd) { const m = lib.sessions.get(opts.sessionId); opts.cwd = (m && m.cwd) || HOME; }
    if (!opts.sessionId && opts.cwd) { store.d.settings.lastWorkspace = opts.cwd; store.save(); }
    return chat.send(opts, text, images);
  },
  'chat:respond': (_e, id, answer) => chat.respond(id, answer),
  'chat:interrupt': (_e, key) => chat.interrupt(key),
  'chat:setMode': (_e, key, mode) => chat.setMode(key, mode),
  'chat:setModel': (_e, key, model) => chat.setModel(key, model),
  'chat:status': () => chat.status(),
  'chat:pending': () => [...chat.pending.entries()].map(([id, p]) => ({ id, key: p.run.key, sessionId: p.run.sessionId, ...p.view })),
  'dialog:pickFolder': async (_e, start) => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a folder for the new chat', defaultPath: start || HOME, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  },
  'path:exists': (_e, p) => !!p && fs.existsSync(p) && fs.statSync(p).isDirectory(),
  'cc:account': () => control.account(),
  'cc:usage': (_e, force) => control.usage(force),
  'cc:commands': (_e, cwd) => control.commands(cwd),
  'cc:models': () => control.models(),
  'cc:mcp': (_e, cwd, sessionId) => control.mcp(cwd, sessionId),
  'mcp:add': async (_e, form, cwd) => {
    const cfg = mcpConfig.buildServerConfig(form);
    const dir = cwd && fs.existsSync(cwd) ? cwd : HOME;
    await runClaude(mcpConfig.addArgs(cfg), dir);
    control.drop('cwd:' + dir);
    return cfg;
  },
  'mcp:get': (_e, name, scope, cwd) => {
    const dir = cwd && fs.existsSync(cwd) ? cwd : HOME;
    const config = mcpConfig.readServer(name, scope, dir, { home: HOME, configDir: process.env.CLAUDE_CONFIG_DIR });
    return mcpConfig.configToForm(name, scope, config);
  },
  'mcp:update': async (_e, oldName, oldScope, form, cwd) => {
    const dir = cwd && fs.existsSync(cwd) ? cwd : HOME;
    const old = mcpConfig.readServer(oldName, oldScope, dir, { home: HOME, configDir: process.env.CLAUDE_CONFIG_DIR });
    const cfg = mcpConfig.buildServerConfig(form);
    await runClaude(mcpConfig.removeArgs(oldName, oldScope), dir);
    try { await runClaude(mcpConfig.addArgs(cfg), dir); }
    catch (e) { await runClaude(mcpConfig.addArgs({ name: oldName, scope: oldScope, config: old }), dir).catch(() => {}); throw e; }
    control.drop('cwd:' + dir);
    return cfg;
  },
  'mcp:ask': async (_e, request, current, cwd) => {
    // current: { name, scope } of the server being edited, or null for a new one.
    const dir = cwd && fs.existsSync(cwd) ? cwd : HOME;
    let old = null;
    if (current) old = { name: current.name, config: mcpConfig.readServer(current.name, current.scope, dir, { home: HOME, configDir: process.env.CLAUDE_CONFIG_DIR }) };
    const r = mcpConfig.parseMcpReply(await askClaudeText(mcpConfig.mcpPrompt(request, old)));
    const config = mcpConfig.unmask(r.config, old && old.config);
    return mcpConfig.configToForm(r.name || (old && old.name) || '', current ? current.scope : 'local', config);
  },
  'mcp:remove': async (_e, name, scope, cwd) => {
    const dir = cwd && fs.existsSync(cwd) ? cwd : HOME;
    await runClaude(mcpConfig.removeArgs(name, scope), dir);
    control.drop('cwd:' + dir);
    return true;
  },
  'skills:list': (_e, cwd) => skills.list(cwd),
  'skills:read': (_e, file, cwd) => skills.read(file, cwd),
  'skills:create': (_e, form, cwd) => { const r = skills.create(form, cwd); control.drop('cwd:' + (cwd || HOME)); return r; },
  'skills:save': (_e, file, content, cwd) => skills.save(file, content, cwd),
  'skills:delete': (_e, file, cwd) => { const r = skills.remove(file, cwd); control.drop('cwd:' + (cwd || HOME)); return r; },
  'skills:generate': (_e, request, name) => askForSkill(skills.generatePrompt(request, name)),
  'skills:revise': (_e, current, request) => askForSkill(skills.revisePrompt(current, request)),
  'term:create': (_e, opts) => terms.create(opts),
  'term:write': (_e, id, data) => terms.write(id, data),
  'term:resize': (_e, id, cols, rows) => terms.resize(id, cols, rows),
  'term:kill': (_e, id) => terms.kill(id),
  'update:check': () => updater.check(),
  'update:download': (_e, update) => updater.download(update),
  'update:install': async () => { await updater.install(); setTimeout(() => { app.relaunch(); app.exit(0); }, 300); return true; },
  'update:page': (_e, url) => { if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url); return true; },
  'cc:context': (_e, sessionId, cwd) => control.context(sessionId, cwd),
  'clipboard:write': (_e, t) => { clipboard.writeText(String(t)); return true; },
  'settings:set': (_e, patch) => { Object.assign(store.d.settings, patch); store.save(); applyTheme(); return snapshot(); },

  'window:minimize': () => win.minimize(),
  'window:maximize': () => (win.isMaximized() ? win.unmaximize() : win.maximize()),
  'window:close': () => win.close(),
};

app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'));
  applyTheme();
  lib = new Library(store);
  updater = new Updater({ pkg: require('../package.json'), isPackaged: app.isPackaged, send: d => send('update:progress', d) });
  for (const [ch, fn] of Object.entries(handlers)) ipcMain.handle(ch, fn);
  let pending = null;
  const push = () => { clearTimeout(pending); pending = setTimeout(() => send('lib:changed', snapshot()), 250); };
  lib.on('changed', push);
  lib.on('tick', push);
  chat = new ChatManager();
  control = new Control(chat);
  chat.on('event', e => send('chat:event', e));
  chat.on('status', () => { send('chat:status', chat.status()); push(); });
  chat.on('session', e => send('chat:session', e));
  chat.on('permission', p => {
    const pend = chat.pending.get(p.id); if (pend) pend.view = p;
    send('chat:permission', p);
    if (!win.isFocused()) notify('Claude needs your approval', `${p.toolName}${p.input && p.input.command ? ': ' + String(p.input.command).slice(0, 80) : ''}`, p.sessionId || p.key);
  });
  chat.on('permission-done', e => send('chat:permission-done', e));
  chat.on('done', d => {
    send('chat:done', d);
    if (!win.isFocused()) { const m = d.sessionId && lib.sessions.get(d.sessionId); notify(d.isError ? 'Claude stopped with an error' : 'Claude finished', m ? lib.titleOf(m) : 'Your chat is ready', d.sessionId || d.key); }
  });
  createWindow();
  lib.init().catch(e => console.error(e));
  // Dev aid: CC_SHOT=/path/prefix captures the window (optionally after running CC_SHOT_JS) and quits.
  if (process.env.CC_SHOT) {
    win.webContents.on('render-process-gone', (_e, d) => console.log('RENDERER GONE', JSON.stringify(d)));
    win.webContents.on('console-message', (e) => { const m = e.message || ''; if (/E2E|Error|error/.test(m)) console.log('CONSOLE', m.slice(0, 300)); });
    ipcMain.handle('dev:shot', async (_e, name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(process.env.CC_SHOT + '-' + name + '.png', img.toPNG()); return true; });
    win.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 2500));
      if (process.env.CC_BLUR) win.blur();
      if (process.env.CC_SHOT_JS) { await win.webContents.executeJavaScript(process.env.CC_SHOT_JS).catch(e => console.error(e)); await new Promise(r => setTimeout(r, 1500)); }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.CC_SHOT + '.png', img.toPNG());
      app.quit();
    });
  }
});
/** Runs the claude CLI directly (no shell), returning stdout or throwing its message. */
function runClaude(args, cwd) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    execFile(CLAUDE_BIN || 'claude', args, { cwd, env, timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim().split('\n').slice(-3).join(' ')));
      else resolve(stdout);
    });
  });
}

function notify(title, body, openId) {
  if (process.env.CC_SHOT) console.log('NOTIFY', title, '|', body);
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(__dirname, '..', 'assets', 'icon.png') });
  n.on('click', () => { win.show(); win.focus(); send('app:open', openId); });
  n.show();
}
app.on('window-all-closed', () => { terms.killAll(); if (chat) chat.closeAll(); if (control) control.closeAll(); app.quit(); });
