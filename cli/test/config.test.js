import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findProjectRoot, RULESYNC_BIN, PKG_ROOT } from '../lib/config.js';

test('findProjectRoot：往上找 rulesync.jsonc，找不到就用起點，環境變數可覆蓋', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-root-'));
  const project = path.join(base, 'project');
  const deep = path.join(project, 'a', 'b');
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(project, 'rulesync.jsonc'), '{}');
  assert.equal(findProjectRoot(deep, {}), project);
  assert.equal(findProjectRoot(project, {}), project);
  const nowhere = path.join(base, 'nowhere');
  fs.mkdirSync(nowhere);
  assert.equal(findProjectRoot(nowhere, {}), nowhere);
  assert.equal(findProjectRoot(deep, { AI_TOOLKIT_ROOT: nowhere }), nowhere);
});

test('RULESYNC_BIN 用模組解析找到 rulesync 的入口檔，不綁死在專案的 node_modules', () => {
  assert.ok(fs.existsSync(RULESYNC_BIN), RULESYNC_BIN);
  assert.ok(fs.existsSync(path.join(PKG_ROOT, 'package.json')));
});
