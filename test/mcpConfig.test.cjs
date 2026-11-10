const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitArgs, parsePairs, buildServerConfig, addArgs, removeArgs, removable } = require('../electron/mcpConfig.cjs');

test('splitArgs handles spaces, quotes and escapes', () => {
  assert.deepEqual(splitArgs('npx -y @scope/server'), ['npx', '-y', '@scope/server']);
  assert.deepEqual(splitArgs('run "two words" \'single q\' a\\ b'), ['run', 'two words', 'single q', 'a b']);
  assert.deepEqual(splitArgs('  '), []);
  assert.deepEqual(splitArgs('--empty ""'), ['--empty', '']);
  assert.deepEqual(splitArgs('"say \\"hi\\""'), ['say "hi"']);
  assert.throws(() => splitArgs('"open'), /Unclosed quote/);
});

test('parsePairs reads env lines and headers, skipping blanks and comments', () => {
  assert.deepEqual(parsePairs('API_KEY=abc\n\n# note\nURL=http://x?a=b', '=', 'Environment'), { API_KEY: 'abc', URL: 'http://x?a=b' });
  assert.deepEqual(parsePairs('Authorization: Bearer t\nX-Org: 1', ':', 'Headers'), { Authorization: 'Bearer t', 'X-Org': '1' });
  assert.throws(() => parsePairs('NOVALUE', '=', 'Environment'), /should look like/);
  assert.throws(() => parsePairs('1BAD=x', '=', 'Environment'), /not a valid variable name/);
});

test('stdio server: command line may include args, plus extra args and env', () => {
  const r = buildServerConfig({ name: 'odoo-docs', type: 'stdio', command: 'npx -y odoo-mcp', args: '--db "my db"', env: 'ODOO_URL=http://localhost:8069', scope: 'user' });
  assert.deepEqual(r, { name: 'odoo-docs', scope: 'user', config: { type: 'stdio', command: 'npx', args: ['-y', 'odoo-mcp', '--db', 'my db'], env: { ODOO_URL: 'http://localhost:8069' } } });
});

test('remote servers need a valid http(s) URL; headers are optional', () => {
  assert.deepEqual(buildServerConfig({ name: 'sentry', type: 'http', url: 'https://mcp.sentry.dev/mcp' }).config, { type: 'http', url: 'https://mcp.sentry.dev/mcp' });
  const sse = buildServerConfig({ name: 's', type: 'sse', url: 'https://x.dev/sse', headers: 'Authorization: Bearer abc' });
  assert.deepEqual(sse.config.headers, { Authorization: 'Bearer abc' });
  assert.throws(() => buildServerConfig({ name: 's', type: 'http', url: 'mcp.sentry.dev' }), /full address/);
  assert.throws(() => buildServerConfig({ name: 's', type: 'http', url: 'ftp://x.dev' }), /only http/);
});

test('validation: name rules, command required, safe defaults', () => {
  assert.throws(() => buildServerConfig({ name: 'bad name', type: 'stdio', command: 'x' }), /Name/);
  assert.throws(() => buildServerConfig({ name: '', type: 'stdio', command: 'x' }), /Name/);
  assert.throws(() => buildServerConfig({ name: 'ok', type: 'stdio', command: '  ' }), /Command/);
  const r = buildServerConfig({ name: 'ok', type: 'weird', command: 'x', scope: 'everywhere' });
  assert.equal(r.config.type, 'stdio');
  assert.equal(r.scope, 'local');
  assert.equal(r.config.env, undefined);
});

test('builds argv for claude mcp add-json / remove without a shell', () => {
  const cfg = buildServerConfig({ name: 'a', type: 'stdio', command: 'echo "$(rm -rf ~)"', scope: 'project' });
  const argv = addArgs(cfg);
  assert.deepEqual(argv.slice(0, 3), ['mcp', 'add-json', 'a']);
  assert.deepEqual(JSON.parse(argv[3]).args, ['$(rm -rf ~)']); // passed as data, never run by a shell
  assert.deepEqual(argv.slice(4), ['--scope', 'project']);
  assert.deepEqual(removeArgs('a', 'user'), ['mcp', 'remove', 'a', '--scope', 'user']);
  assert.deepEqual(removeArgs('a'), ['mcp', 'remove', 'a']);
  assert.throws(() => removeArgs('a; rm -rf /'), /Invalid/);
});

test('only servers from Claude Code config scopes can be removed here', () => {
  assert.ok(removable('user') && removable('local') && removable('project'));
  assert.ok(!removable('claudeai') && !removable('plugin') && !removable(undefined));
});
