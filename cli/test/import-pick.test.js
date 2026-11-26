import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStage, removeStage } from '../lib/import-stage.js';
import { pickSourceItems } from '../flows/import.js';

function makeSource() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-import-src-'));
  for (const s of ['alpha', 'beta']) {
    fs.mkdirSync(path.join(root, '.claude', 'skills', s), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'skills', s, 'SKILL.md'), s);
  }
  fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
  for (const a of ['one', 'two']) fs.writeFileSync(path.join(root, '.claude', 'agents', `${a}.md`), a);
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{}');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'rules');
  return root;
}

test('暫存區：沒排除的整個 symlink，有排除的建真目錄、只連結其他項目，來源不動', () => {
  const src = makeSource();
  const stage = createStage(src, 'project', {
    exclude: [path.join(src, '.claude', 'skills', 'beta'), path.join(src, '.claude', 'agents', 'one.md')],
  });
  assert.equal(fs.lstatSync(path.join(stage, '.claude')).isSymbolicLink(), false);
  assert.deepEqual(fs.readdirSync(path.join(stage, '.claude', 'skills')), ['alpha']);
  assert.deepEqual(fs.readdirSync(path.join(stage, '.claude', 'agents')), ['two.md']);
  assert.equal(fs.lstatSync(path.join(stage, '.claude', 'skills', 'alpha')).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(stage, '.claude', 'settings.json')).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(stage, 'CLAUDE.md')).isSymbolicLink(), true);
  removeStage(stage);
  assert.deepEqual(fs.readdirSync(path.join(src, '.claude', 'skills')).sort(), ['alpha', 'beta']);
  assert.deepEqual(fs.readdirSync(path.join(src, '.claude', 'agents')).sort(), ['one.md', 'two.md']);
});

test('沒有排除時跟以前一樣整個目錄 symlink', () => {
  const src = makeSource();
  const stage = createStage(src, 'project');
  assert.equal(fs.lstatSync(path.join(stage, '.claude')).isSymbolicLink(), true);
  removeStage(stage);
});

// 依序回答 flow 的 multiselect，回傳 flow 的結果與問過的題目
function drive(gen, answers) {
  const asked = [];
  let r = gen.next();
  while (!r.done) {
    const req = r.value;
    if (req.type === 'multiselect') {
      asked.push(req.question);
      r = gen.next(answers.shift());
    } else r = gen.next();
  }
  return { result: r.value, asked };
}

test('pickSourceItems：沒勾的回傳路徑、全不勾的功能拿掉、只有一個項目或不能挑的功能不問', () => {
  const sources = [
    ['skills', [{ entries: [{ name: 'alpha', path: '/s/alpha' }, { name: 'beta', path: '/s/beta' }] }]],
    ['subagents', [{ entries: [{ name: 'one', path: '/a/one.md' }, { name: 'two', path: '/a/two.md' }] }]],
    ['commands', [{ entries: [{ name: 'only', path: '/c/only.md' }] }]],
    ['rules', [{ entries: [{ name: 'x', path: '/r/x.md' }, { name: 'y', path: '/r/y.md' }] }]],
  ];
  const { result, asked } = drive(pickSourceItems(sources), [['alpha'], []]);
  assert.equal(asked.length, 2);
  assert.deepEqual(result, { dropped: ['subagents'], exclude: ['/s/beta'] });
});
