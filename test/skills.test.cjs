const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'cfg');
const sk = require('../electron/skills.cjs');

test('parseFrontmatter reads flat keys, quotes and continuation lines', () => {
  const { meta, body } = sk.parseFrontmatter('---\nname: a-b\ndescription: "Does x"\nlong: one\n  two\n---\n# Hi\n');
  assert.equal(meta.name, 'a-b'); assert.equal(meta.description, 'Does x'); assert.equal(meta.long, 'one two'); assert.equal(body, '# Hi\n');
  assert.deepEqual(sk.parseFrontmatter('no front').meta, {});
});

test('buildSkillMd validates name and description', () => {
  const md = sk.buildSkillMd({ name: 'pdf-tools', description: 'Work with\nPDFs', body: 'Steps' });
  assert.match(md, /^---\nname: pdf-tools\ndescription: "Work with PDFs"\n---\n\nSteps\n$/);
  assert.throws(() => sk.buildSkillMd({ name: 'Bad Name', description: 'x' }), /lowercase/);
  assert.throws(() => sk.buildSkillMd({ name: 'ok', description: ' ' }), /description/);
});

test('extractSkillMd strips fences and chatter', () => {
  assert.equal(sk.extractSkillMd('Here:\n```markdown\n---\nname: x\n---\nbody\n```'), '---\nname: x\n---\nbody\n');
  assert.equal(sk.extractSkillMd('---\nname: y\n---\n'), '---\nname: y\n---\n');
  assert.throws(() => sk.extractSkillMd('sorry'), /valid SKILL/);
});

test('create, list, read, save and delete user and project skills', () => {
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj);
  const md = sk.buildSkillMd({ name: 'demo', description: 'Demo skill', body: 'Do it' });
  const s = sk.create({ name: 'demo', scope: 'user', content: md });
  assert.equal(s.description, 'Demo skill');
  assert.throws(() => sk.create({ name: 'demo', scope: 'user', content: md }), /already exists/);
  sk.create({ name: 'local', scope: 'project', content: md.replace('demo', 'local') }, proj);
  const l = sk.list(proj);
  assert.deepEqual(l.map(x => [x.scope, x.name]), [['project', 'local'], ['user', 'demo']]);
  assert.equal(sk.read(s.path), md);
  sk.save(s.path, md + 'more\n');
  assert.match(sk.read(s.path), /more/);
  assert.throws(() => sk.read('/etc/passwd'), /Not a skill file/);
  assert.throws(() => sk.remove(path.join(tmp, 'cfg', 'skills', '..', '..', 'x', 'SKILL.md')), /Not a skill file/);
  sk.remove(s.path);
  assert.equal(fs.existsSync(path.dirname(s.path)), false);
  assert.deepEqual(sk.list(proj).map(x => x.name), ['local']);
});

test('plugin skills are listed read-only', () => {
  const d = path.join(tmp, 'cfg', 'plugins', 'cache', 'mkt', 'myplug', '1.0', 'skills', 'ps');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), '---\nname: ps\ndescription: p\n---\n');
  const p = sk.list().find(x => x.scope === 'plugin');
  assert.equal(p.name, 'ps'); assert.equal(p.editable, false);
  assert.throws(() => sk.remove(p.path), /Plugin skills/);
});

test('revisePrompt embeds the current file and the request', () => {
  const p = sk.revisePrompt('---\nname: a\n---\nbody', 'add tests step');
  assert.match(p, /<skill>\n---\nname: a\n---\nbody\n<\/skill>/);
  assert.match(p, /add tests step/);
});
