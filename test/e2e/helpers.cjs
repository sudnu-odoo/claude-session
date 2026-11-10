// Launches the real Electron app against an isolated profile (and optionally fake sessions).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { _electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
let built = false;
function buildOnce() {
  if (built || process.env.CC_SKIP_BUILD) return;
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' });
  built = true;
}

/** opts.configDir: fake ~/.claude (offline tests). Omit for live tests (real login). */
async function launch({ configDir } = {}) {
  buildOnce();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-profile-'));
  const env = { ...process.env, CC_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  const app = await _electron.launch({ args: [ROOT, ...(process.env.CI ? ['--no-sandbox'] : [])], cwd: ROOT, env });
  const page = await app.firstWindow();
  await page.waitForSelector('.tree');
  return {
    app, page, userData,
    state: () => JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8')),
    async close() { await app.close().catch(() => {}); fs.rmSync(userData, { recursive: true, force: true }); },
  };
}

/** Expand every category and workspace so all chat rows are visible. */
async function expandAll(page) {
  for (const sel of ['.cat.closed', '.ws:has(.chev.closed)']) {
    for (let i = 0; i < 40; i++) { const el = page.locator(sel).first(); if (!(await el.count())) break; await el.click(); }
  }
}
const chatRow = (page, title) => page.locator('.chat', { hasText: title }).first();

module.exports = { launch, expandAll, chatRow, ROOT };
