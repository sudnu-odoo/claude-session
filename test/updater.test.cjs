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
