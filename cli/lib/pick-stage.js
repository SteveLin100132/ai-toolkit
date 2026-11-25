import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SOURCE_ROOT, FEATURES } from './config.js';

// 產生時逐項挑選 skill／subagent。
// rulesync generate 只能用 --features 選大類，會把 .rulesync/ 底下該類的全部轉出去。
// 做法：把 .rulesync/ 整份複製到暫存目錄，拿掉沒勾選的項目，再用 --input-roots 指向暫存目錄產生。
// 不帶 --delete 時，沒勾選的項目在輸出目錄裡原樣保留（rulesync 17.0.0 實測）。
// 但 rulesync.jsonc 設了 "delete": true 時，rulesync 會把沒勾選的輸出當成多餘檔案刪掉，所以那種情況不能挑。

export const PICKABLE_FEATURES = ['skills', 'subagents'];

// 某個項目在 .rulesync/ 裡的路徑：skill 是資料夾，subagent 是 .md
export function pickItemPath(feature, name, root = SOURCE_ROOT) {
  const dir = path.join(root, FEATURES[feature].sourceDir);
  return feature === 'skills' ? path.join(dir, name) : path.join(dir, `${name}.md`);
}

// picks：{ skills?: string[], subagents?: string[] }，沒列的功能＝全部。
// 回傳暫存目錄（本身就是 source tree，可直接給 --input-roots）
export function createPickStage(picks, sourceRoot = SOURCE_ROOT) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-toolkit-generate-'));
  const stage = path.join(dir, '.rulesync');
  fs.cpSync(sourceRoot, stage, { recursive: true });
  const removed = {};
  for (const [feature, keep] of Object.entries(picks)) {
    if (!PICKABLE_FEATURES.includes(feature) || !Array.isArray(keep)) continue;
    const featureDir = path.join(stage, FEATURES[feature].sourceDir);
    if (!fs.existsSync(featureDir)) continue;
    removed[feature] = [];
    for (const entry of fs.readdirSync(featureDir, { withFileTypes: true })) {
      const isItem = feature === 'skills' ? entry.isDirectory() : entry.isFile() && entry.name.endsWith('.md');
      if (!isItem || entry.name.startsWith('.')) continue;
      const name = feature === 'skills' ? entry.name : entry.name.replace(/\.md$/, '');
      if (keep.includes(name)) continue;
      fs.rmSync(path.join(featureDir, entry.name), { recursive: true, force: true });
      removed[feature].push(name);
    }
  }
  return { dir, stage, removed };
}

export function removePickStage(dir) {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}
