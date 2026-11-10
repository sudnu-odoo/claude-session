import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankCommands, groupOf, SCREENS } from '../src/commands.mjs';

const c = (name, extra = {}) => ({ name, description: '', aliases: [], builtin: false, terminal: false, ...extra });
const cmds = [c('usage', { builtin: true, aliases: ['cost', 'stats'] }), c('context', { builtin: true }), c('config', { builtin: true }), c('compact', { builtin: true }),
  c('doctor', { builtin: true }), c('odev', { description: 'Odoo CLI rules' }), c('mattpocock-skills:grill-me', { description: 'Interview me' }), c('odoo_task_analysis')];

test('exact name and aliases rank first', () => {
  assert.equal(rankCommands(cmds, 'usage')[0].name, 'usage');
  assert.equal(rankCommands(cmds, 'cost')[0].name, 'usage');
});

test('prefix beats substring beats description', () => {
  const names = rankCommands(cmds, 'co').map(x => x.name);
  assert.deepEqual(names.slice(0, 3), ['compact', 'config', 'context']);
  assert.equal(rankCommands(cmds, 'grill')[0].name, 'mattpocock-skills:grill-me');
  assert.equal(rankCommands(cmds, 'interview')[0].name, 'mattpocock-skills:grill-me');
});

test('empty query lists everything', () => {
  assert.equal(rankCommands(cmds, '').length, cmds.length);
});

test('commands are grouped by where they come from', () => {
  assert.equal(groupOf(cmds[0]), 'App screens');
  assert.equal(groupOf(cmds[3]), 'Built-in');
  assert.equal(groupOf(cmds[4]), 'Terminal only');
  assert.equal(groupOf(cmds[5]), 'Your skills & commands');
  assert.equal(groupOf(cmds[6]), 'Plugins');
  assert.equal(groupOf(c('custom', { builtin: true, terminal: true })), 'Terminal only');
});

test('every screen command maps to a known panel', () => {
  for (const v of Object.values(SCREENS)) assert.ok(['usage', 'model', 'permissions', 'context', 'mcp', 'skills', 'resume', 'settings'].includes(v), v);
});
