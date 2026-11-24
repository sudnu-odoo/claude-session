// Live integration tests: real Claude Code login, Haiku, a temporary folder.
// Run with `npm run test:e2e:live` (costs a few cents). Skipped otherwise.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch } = require('./helpers.cjs');

const LIVE = !!process.env.CC_LIVE;
const opts = { skip: !LIVE && 'set CC_LIVE=1 to run (uses your Claude login, costs a few cents)' };
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
let a, page, dir;

before(async () => {
  if (!LIVE) return;
  fs.mkdirSync(path.join(os.homedir(), '.cache'), { recursive: true });
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), '.cache', 'cc-live-')));
  a = await launch();
  page = a.page;
  await page.evaluate(() => localStorage.setItem('chatPrefs', JSON.stringify({ mode: 'default', model: 'haiku', effort: '' })));
  await page.reload(); await page.waitForSelector('.tree');
});
after(async () => {
  if (!LIVE) return;
  await a?.close();
  fs.rmSync(path.join(CLAUDE_DIR, 'projects', dir.replace(/[/_.]/g, '-')), { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});
afterEach(async t => {
  if (!page) return;
  if (t.passed === false) await page.screenshot({ path: path.join(os.tmpdir(), 'cc-live-' + t.name.replace(/\W+/g, '-').slice(0, 40) + '.png') }).catch(() => {});
  for (let i = 0; i < 3 && await page.locator('.scrim, .menu').count(); i++) await page.keyboard.press('Escape');
});

async function send(text) {
  await page.fill('.composer textarea', text);
  await page.locator('.composer .sendsq').click();
}
/** Wait for the reply to finish, clicking Allow on any approval card (unless a hook already decided). */
async function finish(timeout = 150_000) {
  const t = Date.now();
  let allowed = 0;
  await page.waitForSelector('.sendsq.stop', { timeout: 20_000 }).catch(() => {});
  while (Date.now() - t < timeout) {
    const perm = page.locator('.perm .b.pri').first();
    if (await perm.count()) { await perm.click({ force: true, timeout: 5000 }).catch(() => {}); allowed++; await page.waitForTimeout(500); continue; }
    if (!(await page.locator('.sendsq.stop').count())) return allowed;
    await page.waitForTimeout(300);
  }
  throw new Error('reply did not finish in time');
}

// Records every DOM change in the chat while a reply finishes: how many user prompts (.u) were on
// screen at most, whether any went away again, and whether the "Loading conversation" notice flashed.
const watchFlicker = () => page.evaluate(() => {
  const st = window.__flicker = { maxU: 0, dropped: false, loading: false };
  const snap = () => {
    const n = document.querySelectorAll('.main .u').length;
    const sig = n + ':' + document.querySelectorAll('.main .a').length + ':' + (document.querySelector('.thinking') ? 'T' : '') + (document.querySelector('.composer .stop, .composer [title*=Stop]') ? 'S' : '');
    if (sig !== st.last) { (st.seq ||= []).push(Math.round(performance.now()) % 100000 + ' ' + sig); st.last = sig; }
    if (n < st.maxU) st.dropped = true; // something that was on screen went away
    st.maxU = Math.max(st.maxU, n);
    if (/Loading conversation/.test(document.querySelector('.main')?.textContent || '')) st.loading = true;
  };
  st.obs = new MutationObserver(snap); st.obs.observe(document.body, { childList: true, subtree: true, characterData: true });
});
const flickerStats = async () => {
  const st = await page.evaluate(() => { const st = window.__flicker; st.obs.disconnect(); return { maxU: st.maxU, dropped: st.dropped, loading: st.loading, seq: st.seq }; });
  if (process.env.CC_FLICKER_DEBUG) console.log('timeline (ms prompts:replies:Thinking/Stop):', st.seq);
  delete st.seq; return st;
};

test('new chat: folder picker, streaming reply, approval, saved session', opts, async () => {
  await page.locator('.nav-it', { hasText: 'New chat' }).click();
  await page.fill('.pathrow input', dir);
  await page.locator('.modal .b.pri', { hasText: 'Start chat' }).click();
  await send('Create a file note.txt containing the word alpha, using the Write tool. Then reply with one short sentence.');
  await watchFlicker();
  await finish();
  assert.equal(fs.readFileSync(path.join(dir, 'note.txt'), 'utf8').trim(), 'alpha');
  // the finished chat becomes a normal saved session in the sidebar
  await page.waitForSelector('.wsbar .pill:not(.mono)', { timeout: 30_000 }); // category pill appears for saved sessions
  await page.waitForTimeout(1500); // let the swap from streamed to saved messages settle
  assert.ok(await page.locator('.a').count() >= 1);
  // no blink when the new chat turns into a saved one: the prompt never vanished or showed twice
  assert.deepEqual(await flickerStats(), { maxU: 1, dropped: false, loading: false });
});

test('resuming the same chat keeps its memory', opts, async () => {
  await send('What word did you write into note.txt? Answer with just the word.');
  await watchFlicker();
  await finish();
  await page.waitForTimeout(2500); // the saved file is re-read when the reply ends
  assert.deepEqual(await flickerStats(), { maxU: 2, dropped: false, loading: false }, 'reply swap without duplicates or blinking');
  assert.match((await page.locator('.a').last().textContent()).toLowerCase(), /alpha/);
});

test('Fork from the menu starts a separate copy and leaves the original alone', opts, async () => {
  const original = await page.locator('.wsbar h1').textContent();
  await page.locator('.wsbar .ibtn[title="More"]').click();
  await page.locator('.menu .mi', { hasText: 'Fork into a new chat' }).click();
  await page.waitForSelector('.wsbar h1:has-text("Fork of")');
  await page.waitForFunction(() => document.querySelectorAll('.u').length >= 2, null, { timeout: 15_000 }); // fork view shows the original history
  await send('Reply with just the word: forked');
  await finish();
  await page.waitForFunction(o => !document.querySelector('.wsbar h1')?.textContent.startsWith('Fork of') && document.querySelector('.wsbar h1')?.textContent !== o, original, { timeout: 30_000 }).catch(() => {});
  const files = fs.readdirSync(path.join(CLAUDE_DIR, 'projects', dir.replace(/[/_.]/g, '-'))).filter(f => f.endsWith('.jsonl'));
  assert.equal(files.length, 2, 'two session files: original and fork');
});

test('the / menu opens app screens: /context shows real numbers', opts, async () => {
  await page.fill('.composer textarea', '/conte');
  await page.waitForSelector('.slash .it.on');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.legend', { timeout: 60_000 });
  assert.match(await page.locator('.modal .lim .row').first().textContent(), /tokens/);
});

test('the Usage screen shows plan limits', opts, async () => {
  await page.locator('.nav-it', { hasText: 'Usage' }).click();
  await page.waitForSelector('.modal .lim, .modal .errbox', { timeout: 60_000 });
  assert.equal(await page.locator('.modal .errbox').count(), 0, await page.locator('.modal .errbox').textContent().catch(() => ''));
  assert.match(await page.locator('.modal .lim').first().textContent(), /% used/);
});
