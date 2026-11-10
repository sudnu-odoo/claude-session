// Regenerates docs/screenshots/*.png from neutral sample sessions (no real projects or accounts).
//   node scripts/screenshots.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, expandAll } = require('../test/e2e/helpers.cjs');

const HOME = os.homedir();
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
let n = 0;
const ts = minAgo => new Date(Date.now() - minAgo * 60_000 + n++).toISOString();

function session(root, cwd, id, minAgo, title, turns) {
  const dir = path.join(root, 'projects', cwd.replace(/[/_.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  for (const [role, content] of turns) lines.push({ type: role, sessionId: id, cwd, uuid: 'x' + n, timestamp: ts(minAgo), gitBranch: 'main', message: { role, content } });
  lines.push({ type: 'ai-title', aiTitle: title, sessionId: id });
  const file = path.join(dir, id + '.jsonl');
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  const t = new Date(Date.now() - minAgo * 60_000); fs.utimesSync(file, t, t);
}
const uid = i => `0000000${i}-0000-4000-8000-000000000000`.slice(-36);
const U = t => ['user', t];
const A = (...blocks) => ['assistant', blocks];
const T = t => ({ type: 'text', text: t });
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const R = (id, out) => ['user', [{ type: 'tool_result', tool_use_id: id, content: out }]];

function makeSamples() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-samples-'));
  const shop = path.join(HOME, 'Projects/acme-shop'), odoo = path.join(HOME, 'Projects/odoo-addons/inventory-tweaks'), blog = path.join(HOME, 'Projects/personal-blog');
  session(root, shop, uid(1), 3, 'Checkout page loads slowly', [
    U('The checkout page takes 4 seconds to load. Can you find out why?'),
    A(T("I'll profile the checkout route first."), tool('t1', 'Bash', { command: 'npm run profile -- /checkout', description: 'Profile the checkout route' })),
    R('t1', 'GET /checkout 4012ms\n  db.query(cart_items) x 48   3890ms'),
    A(tool('t2', 'Read', { file_path: 'src/routes/checkout.ts' })), R('t2', '...'),
    A(T('The cart loads each item with its own database query: 48 queries for 48 items. I\'ll fetch them in one query instead.'),
      tool('t3', 'Edit', { file_path: 'src/routes/checkout.ts', old_string: 'for (const id of ids) items.push(await db.item(id));', new_string: 'const items = await db.items(ids);' })),
    R('t3', 'ok'),
    A(tool('t4', 'Bash', { command: 'npm run profile -- /checkout', description: 'Profile again' })), R('t4', 'GET /checkout 212ms'),
    A(T('Checkout now loads in **212 ms** instead of 4 seconds.\n\n- **Cause:** one query per cart item (48 queries).\n- **Fix:** `db.items(ids)` loads them all at once in `src/routes/checkout.ts`.\n\nThe cart tests still pass. Want me to add an index on `cart_items.cart_id` too?')),
  ]);
  session(root, shop, uid(2), 60 * 5, 'Add CSV export to reports', [U('Add a CSV export button to the sales report'), A(T('Done. The button is in the report toolbar.'))]);
  session(root, shop, uid(3), 60 * 30, 'Fix flaky login test', [U('The login test fails sometimes on CI'), A(T('It waited a fixed 500 ms. It now waits for the dashboard to appear.'))]);
  session(root, odoo, uid(4), 60 * 2, 'Stock move report by warehouse', [U('Group the stock move report by warehouse'), A(T('Added a warehouse group-by to the report view.'))]);
  session(root, odoo, uid(5), 60 * 26, 'Barcode on delivery slip', [U('Print the barcode on the delivery slip'), A(T('The delivery slip now prints the picking barcode under the address.'))]);
  session(root, HOME, uid(6), 60 * 4, 'Task analysis: recurring invoices', [U('/task_analysis recurring invoices for subscriptions'), A(T('Here is the analysis and an estimate of 6 hours.'))]);
  session(root, HOME, uid(7), 60 * 50, 'Install a PDF tool', [U('How do I install a command line PDF tool?'), A(T('Run `sudo apt install poppler-utils`.'))]);
  session(root, blog, uid(8), 60 * 70, 'Dark mode for the blog', [U('Add dark mode to my blog'), A(T('The theme now follows the system setting.'))]);
  return root;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const root = makeSamples();
  const a = await launch({ configDir: root });
  const { page } = a;
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  const shot = async name => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('saved', name); };
  const setTheme = async t => { await page.emulateMedia({ colorScheme: null }); await page.evaluate(t => window.cc.setSettings({ theme: t }), t); await page.waitForTimeout(500); };

  await setTheme('light');
  await page.waitForSelector('.chat');
  await expandAll(page);
  await page.locator('.chat', { hasText: 'Checkout page loads slowly' }).click();
  await page.waitForSelector('.a');
  await page.locator('.tool', { hasText: 'Edit' }).locator('.h').click();
  await shot('main');

  await setTheme('dark');
  await shot('main-dark');
  await page.keyboard.press('Control+k');
  await page.fill('.palette input', 'query');
  await page.waitForSelector('.hit mark');
  await shot('search');
  await page.keyboard.press('Escape');

  await page.fill('.composer textarea', '/');
  await page.waitForSelector('.slash .it', { timeout: 30000 }).then(() => shot('commands')).catch(() => console.log('skipped commands (claude not available)'));
  await page.fill('.composer textarea', '');

  await a.close();
  fs.rmSync(root, { recursive: true, force: true });
})();
