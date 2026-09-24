import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_ROOT, FEATURES } from './config.js';

// rulesync fetch 只有 --skills 能限定項目，subagents 與 commands 一定整個類別抓下來。
// 要做到逐項挑選：fetch 前先把「沒勾選、但本機已有」的檔案內容留在記憶體，
// fetch 後把沒勾選的項目還原（本機原本有）或刪除（本機原本沒有）。
// 只處理一個項目一個 .md 的功能（subagents、commands）；commands 可以有子目錄（name 含 /）。

export function itemFile(feature, name, root = SOURCE_ROOT) {
  return path.join(root, FEATURES[feature].sourceDir, `${name}.md`);
}

// 回傳 { feature, entries: [{ name, file, content }] }，content 為 null 表示本機原本沒有
export function snapshotUnselected(feature, allNames, selected, root = SOURCE_ROOT) {
  const keep = new Set(selected);
  const entries = allNames
    .filter((n) => !keep.has(n))
    .map((name) => {
      const file = itemFile(feature, name, root);
      let content = null;
      try {
        content = fs.readFileSync(file);
      } catch {
        content = null;
      }
      return { name, file, content };
    });
  return { feature, entries };
}

// 還原或刪除沒勾選的項目。回傳 { restored: [names], removed: [names] }
export function restoreUnselected({ feature, entries }, root = SOURCE_ROOT) {
  const restored = [];
  const removed = [];
  const featureDir = path.join(root, FEATURES[feature].sourceDir);
  for (const { name, file, content } of entries) {
    if (content !== null) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      restored.push(name);
      continue;
    }
    if (!fs.existsSync(file)) continue;
    fs.rmSync(file);
    removed.push(name);
    // 子目錄清空就一起刪，但不刪功能目錄本身
    let dir = path.dirname(file);
    while (dir !== featureDir && dir.startsWith(featureDir)) {
      if (fs.readdirSync(dir).length > 0) break;
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    }
  }
  return { restored, removed };
}
