const { test } = require('node:test');
const assert = require('node:assert/strict');
const { repoOf, compareVersions, pickAsset, toUpdate } = require('../electron/updater.cjs');

test('repoOf reads owner/repo from package.json', () => {
  assert.equal(repoOf({ repository: { url: 'https://github.com/a/b.git' } }), 'a/b');
  assert.equal(repoOf({ repository: 'git@github.com:a/b-c.git' }), 'a/b-c');
  assert.equal(repoOf(require('../package.json')).split('/')[0], 'sudnu-odoo');
  assert.throws(() => repoOf({}), /No GitHub/);
});

test('compareVersions', () => {
  assert.equal(compareVersions('0.2.1', '0.2.0'), 1);
  assert.equal(compareVersions('v0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0'), 0);
  assert.equal(compareVersions('0.2.0', '0.3.0'), -1);
});

test('pickAsset prefers the .deb for this architecture', () => {
  const a = [{ name: 'x.AppImage' }, { name: 'c_0.2.0_arm64.deb' }, { name: 'c_0.2.0_amd64.deb' }];
  assert.equal(pickAsset(a, 'x64').name, 'c_0.2.0_amd64.deb');
  assert.equal(pickAsset(a, 'arm64').name, 'c_0.2.0_arm64.deb');
  assert.equal(pickAsset([{ name: 'n.zip' }]), null);
});

test('toUpdate only reports newer, published releases', () => {
  const rel = { tag_name: 'v0.3.0', body: '## New\n- x', html_url: 'https://github.com/a/b/releases/v0.3.0', assets: [{ name: 'c_0.3.0_amd64.deb', browser_download_url: 'https://dl/c.deb', size: 5 }] };
  const u = toUpdate(rel, '0.2.0');
  assert.equal(u.version, '0.3.0'); assert.equal(u.notes, '## New\n- x'); assert.equal(u.asset.url, 'https://dl/c.deb');
  assert.equal(toUpdate(rel, '0.3.0'), null);
  assert.equal(toUpdate({ ...rel, draft: true }, '0.1.0'), null);
  assert.equal(toUpdate({ ...rel, prerelease: true }, '0.1.0'), null);
});

const { terminalFont, DEFAULT_FONT } = require('../electron/terminal.cjs');
test('terminalFont uses VS Code terminal settings, else Nerd Font defaults', () => {
  const files = { '/h/.config/Code/User/settings.json': '{\n // comment\n "terminal.integrated.fontFamily": "\'JetBrainsMono Nerd Font\', monospace",\n "terminal.integrated.fontSize": 14,\n}' };
  const read = f => { if (!(f in files)) throw new Error('nope'); return files[f]; };
  const f = terminalFont('/h', read);
  assert.ok(f.fontFamily.startsWith("'JetBrainsMono Nerd Font', 'JetBrainsMono Nerd Font'"));
  assert.equal(f.fontFamily.match(/monospace/g).length, 1); // generic family only once, at the very end
  assert.equal(f.fontSize, 14); assert.equal(f.source, 'Code');
  const d = terminalFont('/nobody', read);
  assert.equal(d.fontFamily, DEFAULT_FONT); assert.equal(d.source, 'default');
  assert.match(DEFAULT_FONT, /^'JetBrainsMono Nerd Font'/);
});
