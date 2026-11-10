// Persistent app state (categories, manual placements, names, pins, archive, settings).
const fs = require('fs');
const path = require('path');

const DEFAULT_CATEGORIES = [
  { id: 'analysis', name: 'Analysis', color: '#3f8f6a', icon: 'chart', layout: 'flat', builtin: true },
  { id: 'odoo', name: 'Odoo Development', color: '#7c5cbf', icon: 'folder', layout: 'workspace', builtin: true },
  { id: 'other', name: 'Other Projects', color: '#2f80c4', icon: 'folder', layout: 'workspace', builtin: true },
  { id: 'general', name: 'General', color: '#a09a8c', icon: 'chat', layout: 'flat', builtin: true },
];

const DEFAULTS = {
  version: 1,
  categories: DEFAULT_CATEGORIES,
  sessionCategory: {},   // sessionId -> categoryId (manual)
  workspaceCategory: {}, // cwd -> categoryId (manual)
  names: {},             // sessionId -> custom title
  pinned: {},            // sessionId -> true
  archived: {},          // sessionId -> true
  settings: { theme: 'system', showArchived: false, lastWorkspace: null },
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'state.json');
    try { this.data = { ...structuredClone(DEFAULTS), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; }
    catch { this.data = structuredClone(DEFAULTS); }
    this.data.settings = { ...DEFAULTS.settings, ...this.data.settings };
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
  }
  get d() { return this.data; }
}

module.exports = { Store, DEFAULT_CATEGORIES };
