import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { itemFile, snapshotUnselected, restoreUnselected } from '../lib/prune.js';

test('沒勾選的 subagent／command：本機原有的還原、原本沒有的刪除、勾選的不動', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-prune-'));
  const write = (feature, name, text) => {
    const f = itemFile(feature, name, root);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  };
  // fetch 前：本機有 local-only（沒勾選）與 keep（勾選）
  write('subagents', 'local-only', 'mine');
  write('subagents', 'keep', 'old keep');
  const snap = snapshotUnselected('subagents', ['keep', 'local-only', 'remote-new'], ['keep'], root);
  assert.deepEqual(snap.entries.map((e) => [e.name, e.content?.toString() ?? null]), [['local-only', 'mine'], ['remote-new', null]]);

  // 模擬 rulesync fetch 整批覆蓋
  write('subagents', 'keep', 'new keep');
  write('subagents', 'local-only', 'remote version');
  write('subagents', 'remote-new', 'remote');

  const r = restoreUnselected(snap, root);
  assert.deepEqual(r, { restored: ['local-only'], removed: ['remote-new'] });
  assert.equal(fs.readFileSync(itemFile('subagents', 'keep', root), 'utf8'), 'new keep');
  assert.equal(fs.readFileSync(itemFile('subagents', 'local-only', root), 'utf8'), 'mine');
  assert.equal(fs.existsSync(itemFile('subagents', 'remote-new', root)), false);
});

test('commands 的子目錄：刪掉項目後清空的子目錄一起刪，功能目錄保留', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-prune-'));
  const snap = snapshotUnselected('commands', ['git/commit', 'deploy'], ['deploy'], root);
  const f = itemFile('commands', 'git/commit', root);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'x');
  fs.writeFileSync(itemFile('commands', 'deploy', root), 'y');
  const r = restoreUnselected(snap, root);
  assert.deepEqual(r.removed, ['git/commit']);
  assert.equal(fs.existsSync(path.join(root, 'commands', 'git')), false);
  assert.equal(fs.existsSync(path.join(root, 'commands', 'deploy.md')), true);
  // 再跑一次不會出錯（檔案已不存在）
  assert.deepEqual(restoreUnselected(snap, root), { restored: [], removed: [] });
});
