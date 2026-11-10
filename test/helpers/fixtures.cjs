// Builds a throwaway ~/.claude-like folder with hand-made session files.
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const WS = {
  odoo: path.join(HOME, 'Documents/Projects/psbe-custom/acme/19.0-acme-1234567-dev'),
  tv: path.join(HOME, 'Documents/Projects/Samsung-TV'),
  home: HOME,
};
const ids = {
  analysis: '11111111-1111-4111-8111-111111111111',
  odoo: '22222222-2222-4222-8222-222222222222',
  tv: '33333333-3333-4333-8333-333333333333',
  general: '44444444-4444-4444-8444-444444444444',
  long: '55555555-5555-4555-8555-555555555555',
};

let n = 0;
const ts = (minAgo = 0) => new Date(Date.now() - minAgo * 60_000 + (n++)).toISOString();
const user = (sid, cwd, content, extra = {}) => ({ type: 'user', sessionId: sid, cwd, uuid: 'u' + n, timestamp: ts(), message: { role: 'user', content }, ...extra });
const asst = (sid, cwd, content, extra = {}) => ({ type: 'assistant', sessionId: sid, cwd, uuid: 'a' + n, timestamp: ts(), message: { role: 'assistant', content }, ...extra });
const dirName = cwd => cwd.replace(/[/_.]/g, '-');

function write(root, cwd, sid, lines) {
  const dir = path.join(root, 'projects', dirName(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, sid + '.jsonl');
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-fixture-'));
  const files = {};
  files.analysis = write(root, WS.home, ids.analysis, [
    { type: 'queue-operation', operation: 'enqueue', sessionId: ids.analysis },
    user(ids.analysis, WS.home, '<command-name>/odoo_task_analysis</command-name><command-args>7654321</command-args>'),
    asst(ids.analysis, WS.home, [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'odoo_task_analysis' } }]),
    asst(ids.analysis, WS.home, [{ type: 'text', text: 'The subcontracting overview needs a new smart button.' }]),
    { type: 'ai-title', aiTitle: 'Odev analyze task 7654321', sessionId: ids.analysis },
  ]);
  files.odoo = write(root, WS.odoo, ids.odoo, [
    user(ids.odoo, WS.odoo, 'Fix the invoice report crash', { gitBranch: '19.0-acme-invoice' }),
    user(ids.odoo, WS.odoo, [{ type: 'text', text: '<system-reminder>ignore me</system-reminder>' }], { isMeta: true }),
    asst(ids.odoo, WS.odoo, [{ type: 'text', text: 'Let me run the tests.' }, { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'odoo-bin -u acme_report', description: 'Run module update' } }]),
    user(ids.odoo, WS.odoo, [{ type: 'tool_result', tool_use_id: 'b1', content: "Traceback: KeyError: 'partner_shipping_id'", is_error: true }]),
    asst(ids.odoo, WS.odoo, [{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: 'report/invoice.xml', old_string: 'partner_id', new_string: 'partner_shipping_id' } }]),
    user(ids.odoo, WS.odoo, [{ type: 'tool_result', tool_use_id: 'e1', content: 'ok' }]),
    asst(ids.odoo, WS.odoo, [{ type: 'text', text: 'Fixed the template.' }], { isSidechain: false }),
    asst(ids.odoo, WS.odoo, [{ type: 'text', text: 'subagent noise' }], { isSidechain: true }),
    { type: 'ai-title', aiTitle: 'Invoice report crash fix', sessionId: ids.odoo },
    { type: 'cost-state', totalCostUSD: 1.25, sessionId: ids.odoo },
  ]);
  files.tv = write(root, WS.tv, ids.tv, [
    user(ids.tv, WS.tv, 'Build a tizen web app for the TV'),
    asst(ids.tv, WS.tv, [{ type: 'text', text: 'Created the project.' }]),
    { type: 'custom-title', customTitle: 'TV starter app', sessionId: ids.tv },
  ]);
  files.general = write(root, WS.home, ids.general, [
    user(ids.general, WS.home, 'Install tldr please'),
    asst(ids.general, WS.home, [{ type: 'text', text: 'Run: sudo apt install tldr' }]),
  ]);
  const long = [];
  for (let i = 0; i < 150; i++) { long.push(user(ids.long, WS.tv, 'Question number ' + i)); long.push(asst(ids.long, WS.tv, [{ type: 'text', text: 'Answer number ' + i }])); }
  files.long = write(root, WS.tv, ids.long, long);
  // make the general chat look old
  const old = new Date(Date.now() - 30 * 864e5);
  fs.utimesSync(files.general, old, old);
  return { root, files, ids, WS, HOME, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

module.exports = { makeFixture, ids, WS, HOME };
