const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeFixture, ids, WS } = require('./helpers/fixtures.cjs');

const fx = makeFixture();
process.env.CLAUDE_CONFIG_DIR = fx.root;          // must be set before the library loads
const { Library } = require('../electron/library.cjs');
const { Store } = require('../electron/store.cjs');

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-state-'));
const store = new Store(stateDir);
const lib = new Library(store);
before(() => lib.init());
after(() => { lib.close(); fx.cleanup(); fs.rmSync(stateDir, { recursive: true, force: true }); });
const view = id => lib.list().find(s => s.id === id);

test('indexes every session with automatic categories', () => {
  assert.equal(lib.list().length, 5);
  assert.equal(view(ids.analysis).categoryId, 'analysis');
  assert.equal(view(ids.odoo).categoryId, 'odoo');
  assert.equal(view(ids.tv).categoryId, 'other');
  assert.equal(view(ids.general).categoryId, 'general');
});

test('titles: custom Claude Code title, then app rename, then AI title', () => {
  assert.equal(view(ids.tv).title, 'TV starter app');
  store.d.names[ids.odoo] = 'My rename';
  assert.equal(view(ids.odoo).title, 'My rename');
  delete store.d.names[ids.odoo];
  assert.equal(view(ids.odoo).title, 'Invoice report crash fix');
});

test('a manual chat move beats a workspace move, which beats the rules', () => {
  store.d.workspaceCategory[WS.tv] = 'odoo';
  assert.equal(view(ids.tv).categoryId, 'odoo');
  assert.equal(view(ids.tv).placed, 'workspace');
  store.d.sessionCategory[ids.tv] = 'general';
  assert.equal(view(ids.tv).categoryId, 'general');
  assert.equal(view(ids.tv).placed, 'session');
  store.d.sessionCategory = {}; store.d.workspaceCategory = {};
  assert.equal(view(ids.tv).categoryId, 'other');
  assert.equal(view(ids.tv).placed, null);
});

test('a moved folder does not pull analysis chats out of Analysis', () => {
  store.d.workspaceCategory[WS.home] = 'other';
  assert.equal(view(ids.analysis).categoryId, 'analysis');
  assert.equal(view(ids.general).categoryId, 'other');
  store.d.workspaceCategory = {};
});

test('placements in a deleted category fall back to automatic', () => {
  store.d.sessionCategory[ids.odoo] = 'gone';
  assert.equal(view(ids.odoo).categoryId, 'odoo');
  store.d.sessionCategory = {};
});

test('full-text search finds words inside tool output, with snippets', () => {
  const r = lib.search('partner_shipping_id');
  assert.equal(r[0].session.id, ids.odoo);
  assert.ok(r[0].hits.length > 0);
  assert.match(r[0].hits[0].snippet, /partner_shipping_id/);
});

test('search is fuzzy and prefix-matching', () => {
  assert.equal(lib.search('tizn')[0]?.session.id, ids.tv);
  assert.equal(lib.search('subcontract')[0]?.session.id, ids.analysis);
});

test('search filters: in:, ws:, has:, after:', () => {
  assert.deepEqual(lib.search('in:analysis').map(r => r.session.id), [ids.analysis]);
  assert.deepEqual(lib.search('ws:samsung').map(r => r.session.id).sort(), [ids.tv, ids.long].sort());
  assert.deepEqual(lib.search('has:edit').map(r => r.session.id), [ids.odoo]);
  assert.ok(!lib.search('after:' + new Date(Date.now() - 864e5).toISOString().slice(0, 10)).some(r => r.session.id === ids.general));
  assert.deepEqual(lib.search('has:bash report').map(r => r.session.id), [ids.odoo]);
});

test('archived chats are hidden from search unless asked for', () => {
  store.d.archived[ids.tv] = true;
  assert.ok(!lib.search('tizen').some(r => r.session.id === ids.tv));
  assert.ok(lib.search('tizen has:archived').some(r => r.session.id === ids.tv));
  delete store.d.archived[ids.tv];
});

test('messages page from the newest end', async () => {
  const last = await lib.messages(ids.long, null, 60);
  assert.equal(last.total, 300);
  assert.equal(last.start, 240);
  assert.equal(last.messages.at(-1).blocks[0].text, 'Answer number 149');
  const older = await lib.messages(ids.long, last.start, 60);
  assert.equal(older.start, 180);
  assert.equal(older.messages[0].idx, 180);
});

test('a session written to just now is marked active', () => {
  assert.equal(view(ids.odoo).active, true);
  assert.equal(view(ids.general).active, false);
});

test('new and deleted files are picked up by the watcher', async () => {
  const sid = '66666666-6666-4666-8666-666666666666';
  const dir = path.dirname(fx.files.tv);
  const file = path.join(dir, sid + '.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'user', sessionId: sid, cwd: WS.tv, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Brand new chat about remotes' } }) + '\n');
  await waitFor(() => view(sid));
  assert.equal(view(sid).title, 'Brand new chat about remotes');
  fs.rmSync(file);
  await waitFor(() => !view(sid));
});

async function waitFor(fn, ms = 5000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (fn()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('condition not met in time');
}
