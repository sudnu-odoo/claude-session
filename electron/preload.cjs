const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('cc', {
  snapshot: invoke('lib:snapshot'),
  messages: invoke('lib:messages'),
  search: invoke('lib:search'),
  moveSession: invoke('session:move'),
  moveWorkspace: invoke('workspace:move'),
  rename: invoke('session:rename'),
  pin: invoke('session:pin'),
  archive: invoke('session:archive'),
  remove: invoke('session:delete'),
  exportMd: invoke('session:export'),
  copyResume: invoke('session:copyResume'),
  openVSCode: invoke('open:vscode'),
  openFolder: invoke('open:folder'),
  createCategory: invoke('category:create'),
  updateCategory: invoke('category:update'),
  deleteCategory: invoke('category:delete'),
  reorderCategories: invoke('category:reorder'),
  setSettings: invoke('settings:set'),
  chat: {
    send: invoke('chat:send'),
    respond: invoke('chat:respond'),
    interrupt: invoke('chat:interrupt'),
    setMode: invoke('chat:setMode'),
    setModel: invoke('chat:setModel'),
    status: invoke('chat:status'),
    pending: invoke('chat:pending'),
  },
  info: {
    account: invoke('cc:account'), usage: invoke('cc:usage'), commands: invoke('cc:commands'),
    models: invoke('cc:models'), mcp: invoke('cc:mcp'), context: invoke('cc:context'),
    mcpAdd: invoke('mcp:add'), mcpRemove: invoke('mcp:remove'),
    mcpGet: invoke('mcp:get'), mcpUpdate: invoke('mcp:update'), mcpAsk: invoke('mcp:ask'),
  },
  skills: {
    list: invoke('skills:list'), read: invoke('skills:read'), create: invoke('skills:create'),
    save: invoke('skills:save'), remove: invoke('skills:delete'), generate: invoke('skills:generate'), revise: invoke('skills:revise'),
  },
  term: { font: invoke('term:font'), create: invoke('term:create'), write: invoke('term:write'), resize: invoke('term:resize'), kill: invoke('term:kill') },
  update: { check: invoke('update:check'), download: invoke('update:download'), install: invoke('update:install'), page: invoke('update:page') },
  copy: invoke('clipboard:write'),
  pickFolder: invoke('dialog:pickFolder'),
  devShot: invoke('dev:shot'),
  pathExists: invoke('path:exists'),
  on: (ch, fn) => {
    const allowed = ['chat:event', 'chat:status', 'chat:session', 'chat:permission', 'chat:permission-done', 'chat:done', 'app:open', 'update:progress', 'term:data', 'term:exit'];
    if (!allowed.includes(ch)) throw new Error('bad channel');
    const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h);
  },
  win: { minimize: invoke('window:minimize'), maximize: invoke('window:maximize'), close: invoke('window:close') },
  onChanged: (fn) => { const h = (_e, d) => fn(d); ipcRenderer.on('lib:changed', h); return () => ipcRenderer.removeListener('lib:changed', h); },
  onWindowState: (fn) => { const h = (_e, d) => fn(d); ipcRenderer.on('window:state', h); return () => ipcRenderer.removeListener('window:state', h); },
});
