import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SOURCE_ROOT, TARGETS, FEATURES, outputRels, isFileOutput } from './config.js';
import { listAll, isRootRule, readSingle } from './inventory.js';

// 「移除輸出」：把由 .rulesync/ 產生出來的專案輸出（Claude Code／Codex 檔案）刪掉，不重新產生。
// 跟「清理輸出」（generate --delete，刪多餘的再重新產生）相反，這是反安裝。
//
// 原則：只動「.rulesync/ 目前有的項目」對應的輸出。
// - skills／subagents／commands／rules 目錄：只刪名稱對得上的項目，使用者自己放進同一個目錄的不動
// - 整份由 rulesync 產生的檔案（CLAUDE.md、AGENTS.md、.codex/hooks.json）：有對應原始檔就整個刪
// - 跟其他設定混在一起的檔案：只拿掉 rulesync 寫的那一段
//     .claude/settings.json → hooks 欄位；.mcp.json → mcpServers 欄位；.codex/config.toml → [mcp_servers.*] 區段
//   拿掉後檔案空了就一併刪掉

// 混用檔案的處理方式，key 是相對專案根目錄的輸出路徑
const STRIP = {
  '.claude/settings.json': { type: 'json', key: 'hooks' },
  '.mcp.json': { type: 'json', key: 'mcpServers' },
  '.codex/config.toml': { type: 'toml', table: 'mcp_servers' },
};

const KINDS = { skills: 'skill', subagents: 'subagent', commands: 'command', rules: 'rule' };

// 目錄底下對得上 name 的輸出：skill 是資料夾；其他是 <name>.<任何副檔名>（Codex 的 subagent 是 .toml）
function matchInDir(dir, name, { asDir }) {
  const target = path.join(dir, name);
  if (asDir) return fs.existsSync(target) && fs.statSync(target).isDirectory() ? [target] : [];
  const parent = path.dirname(target);
  const base = path.basename(target);
  if (!fs.existsSync(parent)) return [];
  return fs.readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.replace(/\.[^.]+$/, '') === base)
    .map((e) => path.join(parent, e.name));
}

// 回傳 [{ target, feature, path, action: 'delete' | 'strip', detail }]，已去重、依路徑排序
export function planRemoval({ targets, features, root = ROOT, sourceRoot = SOURCE_ROOT } = {}) {
  const items = listAll(sourceRoot);
  const plan = new Map();
  const add = (target, feature, p, action, detail) => {
    if (!plan.has(p)) plan.set(p, { target, feature, path: p, action, detail });
  };

  for (const target of targets) {
    for (const feature of features) {
      const kind = KINDS[feature];
      const single = feature === 'hooks' || feature === 'mcp' ? readSingle(feature, sourceRoot) : null;
      for (const rel of outputRels(target, feature)) {
        const abs = path.join(root, rel);
        if (!isFileOutput(abs)) {
          // 目錄：逐項比對名稱
          if (!fs.existsSync(abs)) continue;
          const own = items.filter((i) => i.kind === kind && !(feature === 'rules' && isRootRule(i)));
          for (const item of own) {
            for (const hit of matchInDir(abs, item.name, { asDir: FEATURES[feature].unit === 'dir' })) {
              add(target, feature, hit, 'delete', `${FEATURES[feature].label} ${item.name}`);
            }
          }
          continue;
        }
        if (!fs.existsSync(abs)) continue;
        // 單一檔案：要有對應的原始檔才算是我們產生的
        if (single && !single.exists) continue;
        if (feature === 'rules' && !items.some((i) => i.kind === 'rule')) continue;
        const strip = STRIP[rel];
        if (strip) add(target, feature, abs, 'strip', strip.type === 'json' ? `${rel} 的 ${strip.key} 欄位` : `${rel} 的 [${strip.table}.*] 區段`);
        else add(target, feature, abs, 'delete', `${FEATURES[feature].label}（整份由 rulesync 產生）`);
      }
    }
  }
  return [...plan.values()].sort((a, b) => a.path.localeCompare(b.path));
}

// 拿掉 TOML 裡 [table.xxx] 與 [[table.xxx]] 區段（到下一個不是該 table 的標頭為止）
export function stripTomlTable(text, table) {
  const header = /^\s*\[\[?([^\]]+)\]?\]/;
  const out = [];
  let skipping = false;
  for (const line of text.split('\n')) {
    const m = header.exec(line);
    if (m) skipping = m[1].trim() === table || m[1].trim().startsWith(`${table}.`);
    if (!skipping) out.push(line);
  }
  const result = out.join('\n');
  return text.endsWith('\n') && !result.endsWith('\n') ? `${result}\n` : result;
}

function stripFile(abs, rel) {
  const strip = STRIP[rel];
  const text = fs.readFileSync(abs, 'utf8');
  if (strip.type === 'json') {
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return { ok: false, reason: `不是有效的 JSON（${e.message}）` };
    }
    if (!json || typeof json !== 'object' || !(strip.key in json)) return { ok: true, changed: false, emptied: false };
    delete json[strip.key];
    if (Object.keys(json).length === 0) {
      fs.rmSync(abs);
      return { ok: true, changed: true, emptied: true };
    }
    fs.writeFileSync(abs, JSON.stringify(json, null, 2) + '\n');
    return { ok: true, changed: true, emptied: false };
  }
  const next = stripTomlTable(text, strip.table);
  if (next === text) return { ok: true, changed: false, emptied: false };
  if (!next.trim()) {
    fs.rmSync(abs);
    return { ok: true, changed: true, emptied: true };
  }
  fs.writeFileSync(abs, next.replace(/\n{3,}/g, '\n\n'));
  return { ok: true, changed: true, emptied: false };
}

// 刪掉之後往上清空目錄（只到專案根目錄為止，根目錄本身不刪）
function pruneEmptyDirs(start, root) {
  let dir = path.dirname(start);
  const removed = [];
  while (dir.startsWith(root) && dir !== root) {
    let entries;
    try {
      entries = fs.readdirSync(dir).filter((n) => n !== '.DS_Store');
    } catch {
      break;
    }
    if (entries.length) break;
    fs.rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
    dir = path.dirname(dir);
  }
  return removed;
}

// 執行計畫。回傳 { removed, stripped, skipped: [{ path, reason }], emptiedDirs }
export function applyRemoval(plan, { root = ROOT } = {}) {
  const result = { removed: [], stripped: [], skipped: [], emptiedDirs: [] };
  for (const step of plan) {
    if (step.action === 'delete') {
      fs.rmSync(step.path, { recursive: true, force: true });
      result.removed.push(step.path);
      result.emptiedDirs.push(...pruneEmptyDirs(step.path, root));
      continue;
    }
    const rel = path.relative(root, step.path).split(path.sep).join('/');
    const r = stripFile(step.path, rel);
    if (!r.ok) result.skipped.push({ path: step.path, reason: r.reason });
    else if (r.emptied) {
      result.removed.push(step.path);
      result.emptiedDirs.push(...pruneEmptyDirs(step.path, root));
    } else if (r.changed) result.stripped.push(step.path);
  }
  return result;
}

export const targetLabel = (t) => TARGETS[t]?.label ?? t;
