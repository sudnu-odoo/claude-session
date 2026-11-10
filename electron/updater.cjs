// In-app updates from GitHub Releases: check for a newer version, download the .deb,
// install it with pkexec (system password prompt) and restart. Pure helpers are unit-tested.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

/** "owner/repo" from package.json's repository field. */
function repoOf(pkg) {
  const url = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository && pkg.repository.url) || '';
  const m = /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?\/?$/.exec(url);
  if (!m) throw new Error('No GitHub repository in package.json');
  return m[1];
}

/** -1 / 0 / 1, comparing "1.2.3" style versions (a leading "v" and pre-release suffixes are ignored). */
function compareVersions(a, b) {
  const p = v => String(v).replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The .deb for this machine among a release's assets. */
function pickAsset(assets, arch = process.arch) {
  const debArch = { x64: 'amd64', arm64: 'arm64' }[arch] || arch;
  const debs = (assets || []).filter(a => /\.deb$/.test(a.name));
  return debs.find(a => a.name.includes('_' + debArch + '.deb')) || debs[0] || null;
}

/** GitHub release JSON → what the app shows. null when there's nothing newer. */
function toUpdate(release, current) {
  if (!release || release.draft || release.prerelease) return null;
  const version = String(release.tag_name || '').replace(/^v/, '');
  if (!version || compareVersions(version, current) <= 0) return null;
  const asset = pickAsset(release.assets);
  return {
    version, current, notes: release.body || '', name: release.name || 'v' + version,
    date: release.published_at, page: release.html_url,
    asset: asset && { name: asset.name, url: asset.browser_download_url, size: asset.size },
  };
}

class Updater {
  constructor({ pkg, isPackaged, send }) {
    this.repo = repoOf(pkg);
    this.current = pkg.version;
    this.isPackaged = isPackaged;
    this.send = send;
    this.file = null;
  }

  async check() {
    // CC_UPDATE_API lets the offline tests serve a fake release instead of GitHub.
    const api = process.env.CC_UPDATE_API || `https://api.github.com/repos/${this.repo}/releases/latest`;
    const res = await fetch(api, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'claude-sessions-updater' },
    });
    if (res.status === 404) return { current: this.current, update: null };
    if (!res.ok) throw new Error(`GitHub answered ${res.status} while checking for updates`);
    const update = toUpdate(await res.json(), this.current);
    // Installing needs the packaged app (a dev checkout isn't installed via apt).
    return { current: this.current, update, canInstall: this.isPackaged && process.platform === 'linux' && !!(update && update.asset) };
  }

  async download(update) {
    if (!update || !update.asset) throw new Error('This release has no .deb to install');
    const dir = path.join(os.homedir(), '.cache', 'claude-sessions', 'updates');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, path.basename(update.asset.name));
    const res = await fetch(update.asset.url, { headers: { 'User-Agent': 'claude-sessions-updater' } });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || update.asset.size || 0;
    const out = fs.createWriteStream(file + '.part');
    let got = 0, last = 0;
    try {
      for await (const chunk of res.body) {
        got += chunk.length;
        if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
        if (Date.now() - last > 150) { last = Date.now(); this.send({ phase: 'download', got, total }); }
      }
    } finally { await new Promise(r => out.end(r)); }
    if (total && got !== total) { fs.rmSync(file + '.part', { force: true }); throw new Error('Download was incomplete, try again'); }
    fs.renameSync(file + '.part', file);
    this.send({ phase: 'download', got, total: total || got });
    this.file = file;
    return file;
  }

  /** Install with the system password prompt. Resolves when apt has finished. */
  install() {
    if (!this.file) throw new Error('Download the update first');
    this.send({ phase: 'install' });
    return new Promise((resolve, reject) => {
      const p = spawn('pkexec', ['apt-get', 'install', '-y', '--allow-downgrades', this.file], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      p.stderr.on('data', d => { err += d; });
      p.on('error', e => reject(new Error('Could not start the installer: ' + e.message)));
      p.on('close', code => {
        if (code === 0) return resolve(true);
        if (code === 126 || code === 127) return reject(new Error('Installation was cancelled (password prompt closed).'));
        reject(new Error('Installation failed:\n' + err.trim().split('\n').slice(-6).join('\n')));
      });
    });
  }
}

module.exports = { Updater, repoOf, compareVersions, pickAsset, toUpdate };
