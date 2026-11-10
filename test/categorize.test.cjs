const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { autoCategory, workspaceLabel } = require('../electron/categorize.cjs');

const HOME = '/home/tester';
const m = (cwd, extra = {}) => ({ cwd, aiTitle: '', firstPrompt: '', skills: [], ...extra });

test('task analyses go to Analysis wherever they ran', () => {
  assert.equal(autoCategory(m(HOME, { aiTitle: 'Odev analyze task 7654321' }), HOME), 'analysis');
  assert.equal(autoCategory(m(HOME + '/odev/playground', { skills: ['odoo_task_analysis'] }), HOME), 'analysis');
  assert.equal(autoCategory(m(HOME, { aiTitle: 'Task 6646794 analysis review' }), HOME), 'analysis');
  assert.equal(autoCategory(m(HOME, { skills: ['plugin:odev-ai'] }), HOME), 'analysis');
});

test('Odoo workspaces are recognized from their path', () => {
  for (const p of ['/Documents/Projects/psbe-custom/acme/19.0-acme-1-x', '/Documents/Projects/pshk-acme', '/odev/worktrees/19.0', '/upgrade', '/Documents/Projects/odoo-perf-lab'])
    assert.equal(autoCategory(m(HOME + p), HOME), 'odoo', p);
});

test('the username in the home path does not make everything Odoo', () => {
  const home = '/home/odoo-dev';
  assert.equal(autoCategory(m(home + '/Documents/Projects/Samsung-TV'), home), 'other');
});

test('chats started in the home folder are General', () => {
  assert.equal(autoCategory(m(HOME, { firstPrompt: 'Install tldr' }), HOME), 'general');
  assert.equal(autoCategory(m(null), HOME), 'general');
});

test('workspace labels pull the client name, version and task id', () => {
  assert.deepEqual(workspaceLabel(HOME + '/P/psbe-custom/acme-textiles/19.0-acme-textiles-1234567-dev', HOME), { name: 'acme-textiles', version: '19.0', task: '1234567' });
  assert.deepEqual(workspaceLabel(HOME + '/odev/worktrees/20.0', HOME), { name: 'odev worktree', version: '20.0', task: null });
  assert.deepEqual(workspaceLabel(HOME + '/Documents/Projects/atoll', HOME), { name: 'atoll', version: null, task: null });
  assert.equal(workspaceLabel(HOME, HOME).name, '~');
});
