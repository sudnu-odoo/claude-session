// Offline integration tests: real app + fake sessions. No network, no cost.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { makeFixture, ids } = require('../helpers/fixtures.cjs');
const { launch, expandAll, chatRow } = require('./helpers.cjs');

// Fake GitHub "latest release" so the update check never touches the network.
const http = require('http');
const fakeRelease = { tag_name: 'v99.0.0', name: 'v99.0.0', body: '## What changed\n- Fake feature from the e2e test', html_url: 'https://github.com/x/y/releases/v99.0.0', published_at: '2026-11-10T00:00:00Z',
  assets: [{ name: 'claude-sessions_99.0.0_amd64.deb', browser_download_url: 'http://127.0.0.1:1/none.deb', size: 10 }] };
const relServer = http.createServer((_q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(fakeRelease)); }).listen(0, '127.0.0.1');
relServer.unref();
let fx, a, page;
before(async () => { await new Promise(r => relServer.listening ? r() : relServer.once('listening', r)); process.env.SHELL = '/bin/bash'; process.env.CC_UPDATE_API = `http://127.0.0.1:${relServer.address().port}/latest`; fx = makeFixture(); a = await launch({ configDir: fx.root }); page = a.page; await page.waitForSelector('.cat'); await expandAll(page); });
after(async () => { await a?.close(); fx?.cleanup(); });
// keep tests independent: close menus/dialogs left open; save a screenshot when one fails
afterEach(async t => {
  if (!page) return;
  if (t.passed === false || process.env.CC_E2E_SHOTS) await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'cc-e2e-' + t.name.replace(/\W+/g, '-').slice(0, 50) + '.png') }).catch(() => {});
  for (let i = 0; i < 3 && await page.locator('.scrim, .menu').count(); i++) await page.keyboard.press('Escape');
});

const count = async name => Number(await page.locator('.cat', { hasText: name }).locator('.n').textContent());

test('sidebar shows the four categories with automatic sorting', async () => {
  assert.equal(await count('Analysis'), 1);
  assert.equal(await count('Odoo Development'), 1);
  assert.equal(await count('Other Projects'), 2);
  assert.equal(await count('General'), 1);
  assert.ok(await page.locator('.ws', { hasText: 'acme' }).locator('.ver', { hasText: '19.0' }).count());
});

test('opening a chat shows messages and expandable tool calls', async () => {
  await chatRow(page, 'Invoice report crash fix').click();
  await page.waitForSelector('.a');
  assert.equal(await page.locator('.wsbar h1').textContent(), 'Invoice report crash fix');
  const bash = page.locator('.tool', { hasText: 'Bash' });
  assert.match(await bash.locator('.st').textContent(), /error/);
  await bash.locator('.h').click();
  assert.match(await bash.textContent(), /KeyError: 'partner_shipping_id'/);
  assert.match(await page.locator('.pill.mono').first().textContent(), /19\.0-acme-invoice/);
});

test('long chats load the latest messages first and older ones on scroll', async () => {
  await chatRow(page, 'Question number 0').click();
  await page.waitForSelector('.load-more');
  const earlier = Number((await page.locator('.load-more').first().textContent()).match(/(\d+) earlier/)[1]);
  assert.ok(earlier >= 200 && earlier <= 240, 'earlier=' + earlier);
  assert.ok(await page.locator('.col .u, .col .a').count() >= 60);
  await page.locator('.scroll').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  await page.waitForFunction(() => document.querySelectorAll('.col .u, .col .a').length >= 120);
  await page.locator('.chat.on').click(); // plain click clears any selection
});

test('Ctrl+K finds text inside tool output and jumps to the message', async () => {
  await page.keyboard.press('Control+k');
  await page.fill('.palette input', 'partner_shipping_id');
  await page.waitForSelector('.hit .sn mark');
  await page.locator('.hit .sn.sub').first().click();
  await page.waitForSelector('.wsbar h1:text("Invoice report crash fix")');
  assert.equal(await page.locator('.scrim').count(), 0);
});

test('search filters narrow results', async () => {
  await page.keyboard.press('Control+k');
  await page.fill('.palette input', 'in:analysis');
  await page.waitForFunction(() => document.querySelectorAll('.hit').length === 1);
  assert.match(await page.locator('.hit').textContent(), /7654321/);
  await page.keyboard.press('Escape');
});

test('right-click → Move to puts a chat in another category and remembers it', async () => {
  await chatRow(page, 'Install tldr').click({ button: 'right' });
  await page.locator('.menu .mi', { hasText: 'Move to…' }).click();
  await page.locator('.modal .opt', { hasText: 'Other Projects' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.cat')].find(c => c.textContent.includes('General'))?.querySelector('.n')?.textContent === '0');
  assert.equal(a.state().sessionCategory[ids.general], 'other');
});

test('Ctrl+click selects several chats and moves them together', async () => {
  await expandAll(page);
  await chatRow(page, 'TV starter app').click({ modifiers: ['Control'] });
  await chatRow(page, 'Question number 0').click({ modifiers: ['Control'] });
  assert.match(await page.locator('.selbar').textContent(), /2 selected/);
  await chatRow(page, 'TV starter app').click({ button: 'right' });
  await page.locator('.menu .mi', { hasText: 'General' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.cat')].find(c => c.textContent.includes('General'))?.querySelector('.n')?.textContent === '2');
  const st = a.state();
  assert.equal(st.sessionCategory[ids.tv], 'general');
  assert.equal(st.sessionCategory[ids.long], 'general');
});

test('categories: create, rename, delete guard and delete', async () => {
  await page.locator('.add-cat').click();
  await page.fill('.cat-input', 'Clients');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.cat:has-text("Clients")');
  await page.locator('.cat', { hasText: 'Clients' }).dblclick();
  await page.fill('.cat-input', 'Client work');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.cat:has-text("Client work")');
  // a category with chats cannot be deleted
  await page.locator('.cat', { hasText: 'Odoo Development' }).click({ button: 'right' });
  assert.equal(await page.locator('.menu .mi.disabled', { hasText: 'Delete category' }).count(), 1);
  await page.keyboard.press('Escape');
  // an empty one can
  await page.locator('.cat', { hasText: 'Client work' }).click({ button: 'right' });
  await page.locator('.menu .mi', { hasText: 'Delete category' }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.cat')].some(c => c.textContent.includes('Client work')));
  assert.ok(!a.state().categories.some(c => c.name === 'Client work'));
});

test('dragging a category header reorders categories', async () => {
  await page.locator('.cat', { hasText: 'General' }).dragTo(page.locator('.cat', { hasText: 'Analysis' }), { targetPosition: { x: 20, y: 3 } });
  await page.waitForFunction(() => document.querySelector('.cat .cname')?.textContent === 'General');
  assert.equal(a.state().categories[0].id, 'general');
});

test('F2 renames the open chat', async () => {
  await expandAll(page);
  await chatRow(page, 'Invoice report crash fix').click();
  await page.keyboard.press('F2');
  await page.fill('.title-input', 'Acme invoice fix');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.wsbar h1:text("Acme invoice fix")');
  assert.equal(a.state().names[ids.odoo], 'Acme invoice fix');
  assert.match(fs.readFileSync(fx.files.odoo, 'utf8'), /"customTitle":"Acme invoice fix"/);
});

test('archive hides a chat; pin moves it to Pinned', async () => {
  await chatRow(page, 'Acme invoice fix').click({ button: 'right' });
  await page.locator('.menu .mi', { hasText: 'Pin' }).first().click();
  await page.waitForSelector('.sec-h:has-text("Pinned")');
  await chatRow(page, 'Odev analyze task').click({ button: 'right' });
  await page.locator('.menu .mi', { hasText: 'Archive' }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.chat')].some(c => c.textContent.includes('Odev analyze task')));
  assert.equal(a.state().archived[ids.analysis], true);
});

test('new chat dialog validates the folder', async () => {
  await page.locator('.nav-it', { hasText: 'New chat' }).click();
  await page.fill('.pathrow input', '/definitely/not/here');
  await page.locator('.modal .b.pri', { hasText: 'Start chat' }).click();
  await page.waitForSelector('.formerr');
  await page.locator(`.modal .opt[title="${require('os').homedir()}"]`).click();
  assert.equal(await page.locator('.formerr').count(), 0);
  await page.locator('.modal .b.pri', { hasText: 'Start chat' }).click();
  await page.waitForSelector('.newchat-hero');
});

test('theme setting switches between light and dark', async () => {
  await page.emulateMedia({ colorScheme: null }); // let the app's own theme setting decide
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.evaluate(() => window.cc.setSettings({ theme: 'light' }));
  await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(250, 249, 245)');
  await page.evaluate(() => window.cc.setSettings({ theme: 'dark' }));
  await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(38, 38, 36)');
  assert.equal(a.state().settings.theme, 'dark');
  assert.notEqual(await bg(), '');
});

test('skills panel: create by hand, filter, view, edit and delete', async () => {
  await page.locator('button.acct').click();
  await page.getByRole('menuitem', { name: /^Skills/ }).click();
  await page.getByRole('button', { name: '+ New skill' }).click();
  await page.getByRole('radio', { name: 'Write it myself' }).click();
  await page.getByPlaceholder('e.g. release-notes').fill('e2e-skill');
  await page.getByPlaceholder(/Draft release notes/).fill('A skill made by the e2e test');
  await page.locator('textarea.skedit').fill('# E2E\n\n- step one');
  await page.getByRole('button', { name: 'Save skill' }).click();
  const row = page.locator('.mcprow', { hasText: 'e2e-skill' });
  await row.waitFor();
  await page.getByRole('radio', { name: /Plugins/ }).click();
  assert.equal(await row.count(), 0);
  await page.getByRole('radio', { name: /^All/ }).click();
  await row.click();
  await page.waitForSelector('.skmd h1');
  await page.getByRole('tab', { name: 'Edit' }).click();
  await page.getByRole('radio', { name: 'Edit it myself' }).click();
  await page.locator('textarea.skedit').fill('---\nname: e2e-skill\ndescription: changed\n---\n\n# Changed\n');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.locator('.skmd h1', { hasText: 'Changed' }).waitFor();
  assert.match(fs.readFileSync(require('path').join(fx.root, 'skills', 'e2e-skill', 'SKILL.md'), 'utf8'), /description: changed/);
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Delete skill' }).click();
  await page.getByRole('button', { name: '+ New skill' }).waitFor();
  assert.equal(await row.count(), 0);
  assert.equal(fs.existsSync(require('path').join(fx.root, 'skills', 'e2e-skill')), false);
});

test('update check shows the badge and the release notes', async () => {
  const pill = page.locator('.upd-pill');
  await pill.waitFor({ timeout: 15000 });
  await pill.click();
  await page.getByText('Version 99.0.0 is available').waitFor();
  await page.locator('.upd-notes', { hasText: 'Fake feature from the e2e test' }).waitFor();
  // a dev checkout can't install itself: no install button, a pointer to the release page instead
  assert.equal(await page.getByRole('button', { name: 'Update and restart' }).count(), 0);
  await page.getByRole('button', { name: 'Skip this version' }).click();
  assert.equal(await pill.count(), 0);
});

test('terminal: Ctrl+J opens a shell that runs commands, tabs and hide work', async () => {
  await page.keyboard.press('Control+j');
  const panel = page.locator('.term-panel');
  await panel.locator('.xterm-rows').waitFor();
  // wait for the shell's prompt before typing, so no keystrokes are lost during startup
  await page.waitForFunction(() => document.querySelector('.term-panel .xterm-rows')?.textContent.trim().length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.keyboard.type('echo term-$((40+2))\n');
  await panel.locator('.xterm-rows', { hasText: 'term-42' }).waitFor({ timeout: 15000 });
  // Each step waits for its result: shells start asynchronously, and CI runners are fast.
  await panel.getByTitle(/^New terminal/).click();
  await panel.locator('.term-item').nth(1).waitFor(); // the shell list appears once there are two
  assert.equal(await panel.locator('.term-item').count(), 2);
  await panel.locator('.term-item.on').getByTitle('Kill terminal').click();
  await panel.locator('.term-item').first().waitFor({ state: 'detached' }); // back to one shell: list hidden, like VS Code
  await page.waitForFunction(() => document.querySelectorAll('.term-panel .term-view').length === 1);
  await page.keyboard.press('Control+j'); // hides it even while the shell has focus
  await panel.waitFor({ state: 'hidden' });
  await page.keyboard.press('Control+Backquote'); // Ctrl+` works too
  await panel.waitFor();
  await page.keyboard.press('Control+Backquote');
  await panel.waitFor({ state: 'hidden' });
});
