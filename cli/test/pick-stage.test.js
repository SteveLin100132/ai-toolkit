import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPickStage, removePickStage } from '../lib/pick-stage.js';
import { markReview, readReview, clearReviewItems } from '../lib/review.js';

function makeSource() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tk-pick-')), '.rulesync');
  for (const s of ['alpha', 'beta']) {
    fs.mkdirSync(path.join(root, 'skills', s), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', s, 'SKILL.md'), s);
  }
  fs.mkdirSync(path.join(root, 'subagents'), { recursive: true });
  for (const a of ['one', 'two']) fs.writeFileSync(path.join(root, 'subagents', `${a}.md`), a);
  fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'rules', 'overview.md'), 'rule');
  fs.writeFileSync(path.join(root, 'hooks.jsonc'), '{}');
  return root;
}

test('暫存區只留下勾選的 skill／subagent，其他功能整份保留，原始檔不動', () => {
  const source = makeSource();
  const { dir, stage, removed } = createPickStage({ skills: ['alpha'], subagents: ['two'] }, source);
  assert.deepEqual(fs.readdirSync(path.join(stage, 'skills')), ['alpha']);
  assert.deepEqual(fs.readdirSync(path.join(stage, 'subagents')), ['two.md']);
  assert.ok(fs.existsSync(path.join(stage, 'rules', 'overview.md')));
  assert.ok(fs.existsSync(path.join(stage, 'hooks.jsonc')));
  assert.deepEqual(removed, { skills: ['beta'], subagents: ['one'] });
  // 原始 .rulesync/ 沒被動到
  assert.deepEqual(fs.readdirSync(path.join(source, 'skills')).sort(), ['alpha', 'beta']);
  removePickStage(dir);
  assert.equal(fs.existsSync(dir), false);
});

test('沒列在 picks 的功能＝全部保留', () => {
  const source = makeSource();
  const { dir, stage } = createPickStage({ skills: ['beta'] }, source);
  assert.deepEqual(fs.readdirSync(path.join(stage, 'subagents')).sort(), ['one.md', 'two.md']);
  removePickStage(dir);
});

test('只清掉已檢視的項目，其他的留著；全部清完就刪掉標記', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tk-review-')), '.needs-review.json');
  markReview({ source: 'o/r', items: [{ feature: 'subagents', name: 'one' }, { feature: 'subagents', name: 'two' }] }, file);
  assert.equal(clearReviewItems([{ feature: 'subagents', name: 'one' }], file), 1);
  assert.deepEqual(readReview(file).items.map((i) => i.name), ['two']);
  assert.equal(clearReviewItems([{ feature: 'subagents', name: 'two' }], file), 0);
  assert.equal(fs.existsSync(file), false);
});
