const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeFixture, ids, WS } = require('./helpers/fixtures.cjs');
const { parseSession, searchDocs } = require('../electron/sessions.cjs');

const fx = makeFixture();
after(() => fx.cleanup());

test('reads cwd, branch, title, cost and the first real prompt', async () => {
  const { meta } = await parseSession(fx.files.odoo);
  assert.equal(meta.id, ids.odoo);
  assert.equal(meta.cwd, WS.odoo);
  assert.equal(meta.branch, '19.0-acme-invoice');
  assert.equal(meta.aiTitle, 'Invoice report crash fix');
  assert.equal(meta.cost, 1.25);
  assert.equal(meta.firstPrompt, 'Fix the invoice report crash');
  assert.equal(meta.hasEdit, true);
  assert.deepEqual(meta.tools.sort(), ['Bash', 'Edit']);
});

test('skips meta messages, system reminders and subagent sidechains', async () => {
  const { messages } = await parseSession(fx.files.odoo);
  const all = JSON.stringify(messages);
  assert.ok(!all.includes('ignore me'));
  assert.ok(!all.includes('subagent noise'));
  assert.equal(messages[0].role, 'user');
});

test('attaches tool results and error flags to their tool calls', async () => {
  const { messages } = await parseSession(fx.files.odoo);
  const tools = messages.flatMap(m => m.blocks).filter(b => b.type === 'tool_use');
  const bash = tools.find(t => t.name === 'Bash');
  assert.match(bash.result, /KeyError/);
  assert.equal(bash.isError, true);
  assert.equal(bash.summary, 'Run module update');
  assert.equal(tools.find(t => t.name === 'Edit').isError, false);
});

test('merges consecutive assistant entries into one message', async () => {
  const { messages } = await parseSession(fx.files.odoo);
  assert.deepEqual(messages.map(m => m.role), ['user', 'assistant']);
});

test('turns slash-command invocations into readable text and records the skill', async () => {
  const { meta, messages } = await parseSession(fx.files.analysis);
  assert.equal(messages[0].blocks[0].text, '/odoo_task_analysis 7654321');
  assert.ok(meta.skills.includes('odoo_task_analysis'));
});

test('custom titles from Claude Code renames are picked up', async () => {
  const { meta } = await parseSession(fx.files.tv);
  assert.equal(meta.customTitle, 'TV starter app');
});

test('search documents include tool commands and output', async () => {
  const { meta, messages } = await parseSession(fx.files.odoo);
  const text = searchDocs(meta, messages).map(d => d.text).join('\n');
  assert.match(text, /odoo-bin -u acme_report/);
  assert.match(text, /partner_shipping_id/);
});
