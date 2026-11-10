const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ChatManager } = require('../electron/chat.cjs');

function ask(m, toolName, input, suggestions) {
  const run = { key: 'k', sessionId: 's', state: 'running', waitingIds: new Set() };
  m.runs.set('k', run);
  let id;
  m.once('permission', p => { id = p.id; });
  const result = m.askPermission(run, toolName, input, { suggestions, signal: new AbortController().signal });
  return { run, result, id: () => id };
}

test('Allow passes the original input through', async () => {
  const m = new ChatManager();
  const a = ask(m, 'Bash', { command: 'ls' });
  assert.equal(a.run.state, 'waiting');
  m.respond(a.id(), { decision: 'allow' });
  assert.deepEqual(await a.result, { behavior: 'allow', updatedInput: { command: 'ls' } });
  assert.equal(a.run.state, 'running');
});

test('Always allow returns the suggested permission rules', async () => {
  const m = new ChatManager();
  const rules = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'ls' }], behavior: 'allow', destination: 'localSettings' }];
  const a = ask(m, 'Bash', { command: 'ls' }, rules);
  m.respond(a.id(), { decision: 'always' });
  assert.deepEqual((await a.result).updatedPermissions, rules);
});

test('Deny returns a message for Claude', async () => {
  const m = new ChatManager();
  const a = ask(m, 'Write', { file_path: '/x' });
  m.respond(a.id(), { decision: 'deny' });
  const r = await a.result;
  assert.equal(r.behavior, 'deny');
  assert.match(r.message, /declined/);
});

test('question answers are added to the tool input', async () => {
  const m = new ChatManager();
  const input = { questions: [{ question: 'Color?', header: 'C', options: [] }] };
  const a = ask(m, 'AskUserQuestion', input);
  m.respond(a.id(), { decision: 'allow', answers: { 'Color?': 'Blue' } });
  assert.deepEqual((await a.result).updatedInput, { ...input, answers: { 'Color?': 'Blue' } });
});

test('answering an unknown or already-answered request does nothing', async () => {
  const m = new ChatManager();
  const a = ask(m, 'Bash', { command: 'ls' });
  assert.equal(m.respond('nope', { decision: 'allow' }), false);
  m.respond(a.id(), { decision: 'allow' });
  assert.equal(m.respond(a.id(), { decision: 'deny' }), false);
});

test('a fork never reuses the original chat\'s live run', async () => {
  const m = new ChatManager();
  const original = { key: 'orig', sessionId: 'S1', state: 'idle', waitingIds: new Set(), inbox: { push() { throw new Error('sent to the original chat'); } } };
  m.runs.set('orig', original);
  let started;
  m.start = async opts => { started = opts; const r = { key: opts.key, state: 'starting', waitingIds: new Set(), inbox: { push() {} } }; m.runs.set(opts.key, r); return r; };
  await m.send({ key: 'new-fork', sessionId: 'S1', fork: true }, 'hello');
  assert.equal(started.fork, true);
  assert.equal(started.key, 'new-fork');
  // a normal follow-up still goes to the original run
  await assert.rejects(m.send({ sessionId: 'S1' }, 'again'), /sent to the original chat/);
});
