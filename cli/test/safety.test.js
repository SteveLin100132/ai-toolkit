import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatCommand, rulesync } from '../lib/run.js';
import { RULESYNC_BIN } from '../lib/config.js';
import { markReview, readReview, clearReview } from '../lib/review.js';

test('formatCommand 顯示的指令字串不含 env 裡的 token', () => {
  const spec = rulesync(['fetch', 'acme/toolkit', '--features', 'skills'], { env: { GITHUB_TOKEN: 'gho_supersecret' } });
  const shown = formatCommand(spec.cmd, spec.args);
  assert.equal(shown, 'npx rulesync fetch acme/toolkit --features skills');
  assert.ok(!shown.includes('gho_supersecret'));
  // 用目前的 node 執行 rulesync 的入口檔，不依賴 .bin shim
  assert.equal(spec.cmd, process.execPath);
  assert.equal(spec.args[0], RULESYNC_BIN);
  assert.match(RULESYNC_BIN, /rulesync[\\/]dist[\\/]cli[\\/]index\.js$/);
  assert.equal(spec.env.GITHUB_TOKEN, 'gho_supersecret');
});

test('cli/ 裡沒有直接把 token 變數印到畫面的 log', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'test') walk(p);
      } else if (e.name.endsWith('.js')) {
        const src = fs.readFileSync(p, 'utf8');
        // 允許 maskToken(token) 與 Authorization 標頭；不允許 ${token}、${auth.token} 出現在其他字串裡
        for (const line of src.split('\n')) {
          if (/Authorization/.test(line)) continue;
          for (const m of line.matchAll(/\$\{(auth\.)?token\}/g)) offenders.push(`${path.relative(root, p)}：${m[0]}`);
        }
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});

test('needs-review 標記：只記 subagents／commands 等，合併不重複，清除', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tk-review-')), '.needs-review.json');
  assert.equal(readReview(file), null);
  const r1 = markReview({ source: 'acme/toolkit', items: [{ feature: 'skills', name: 's' }, { feature: 'subagents', name: 'reviewer' }] }, file);
  assert.deepEqual(r1.items.map((i) => i.name), ['reviewer']);
  const r2 = markReview({ source: 'acme/toolkit@v2', items: [{ feature: 'subagents', name: 'reviewer' }, { feature: 'commands', name: 'deploy' }] }, file);
  assert.deepEqual(r2.items.map((i) => `${i.feature}:${i.name}`), ['subagents:reviewer', 'commands:deploy']);
  // 只有 skill 不需要檢視：不寫入、回傳 null，既有標記不變
  assert.equal(markReview({ source: 'x', items: [{ feature: 'skills', name: 'only' }] }, file), null);
  assert.equal(readReview(file).items.length, 2);
  assert.equal(markReview({ source: 'x', items: [] }, file), null);
  assert.equal(clearReview(file), true);
  assert.equal(readReview(file), null);
});
