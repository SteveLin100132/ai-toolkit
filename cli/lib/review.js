import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_ROOT } from './config.js';

// 從遠端取得 subagent 或 command 之後，這些設定一產生就會在使用者機器上生效
// （subagent 變成可用的 agent、command 變成可用的斜線指令），所以在人工檢視前不讓「產生」直接寫入。
// 取得時寫這個標記，「產生」看到標記會先 dry run 並要求確認，確認後才清掉。
export const REVIEW_FILE = path.join(SOURCE_ROOT, '.needs-review.json');

// 需要先檢視的 feature（skills 只是文件，不需要）
export const REVIEW_FEATURES = ['subagents', 'commands', 'hooks', 'rules', 'mcp'];

export function readReview(file = REVIEW_FILE) {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    return json && typeof json === 'object' && Array.isArray(json.items) ? json : null;
  } catch {
    return null;
  }
}

// items：[{ kind, name }]；source：來源倉庫。已有標記時合併，不重複
export function markReview({ source, items }, file = REVIEW_FILE) {
  const needed = items.filter((i) => REVIEW_FEATURES.includes(i.feature));
  if (needed.length === 0) return null;
  const current = readReview(file) ?? { items: [] };
  const seen = new Set(current.items.map((i) => `${i.feature}:${i.name}`));
  for (const i of needed) {
    const key = `${i.feature}:${i.name}`;
    if (!seen.has(key)) {
      current.items.push({ feature: i.feature, name: i.name, source });
      seen.add(key);
    }
  }
  current.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n');
  return current;
}

export function clearReview(file = REVIEW_FILE) {
  try {
    fs.rmSync(file);
    return true;
  } catch {
    return false;
  }
}
