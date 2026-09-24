import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SOURCE_ROOT, KIND_FEATURE, FEATURES } from './config.js';
import { listAll, listRules, readMcp, readHooks, isRootRule, writeSingle } from './inventory.js';

// rulesync 17.0.0 的 import 會把結果分散寫到 cwd、--output-root 與 HOME 底下的 .rulesync/（依功能而定，實測），
// 而且會整份覆寫 mcp、hooks。所以先匯入到暫存區，再由 CLI 比對、合併進本 repo 的 .rulesync/。
// 暫存區放指向來源的 symlink，並把 cwd、--output-root、HOME 都指向暫存區，讓所有輸出落在同一個地方。

// 各層級要連結的來源（沒有的會略過）
const SOURCE_LINKS = {
  project: ['.claude', '.codex', '.agents', 'CLAUDE.md', 'AGENTS.md', '.mcp.json'],
  global: ['.claude', '.codex', '.agents', '.claude.json'],
};

export function createStage(sourceRoot, scope) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-toolkit-import-'));
  for (const name of SOURCE_LINKS[scope]) {
    const src = path.join(sourceRoot, name);
    if (fs.existsSync(src)) fs.symlinkSync(src, path.join(dir, name));
  }
  return dir;
}

// 在暫存區執行 rulesync import 的參數
export function stageCommand(stage, { target, features, scope }) {
  const args = ['import', '--targets', target, '--features', features.join(',')];
  if (scope === 'global') return { args: [...args, '--global'], cwd: stage, env: { HOME: stage } };
  return { args: [...args, '--output-root', stage], cwd: stage, env: {} };
}

export function removeStage(stage) {
  fs.rmSync(stage, { recursive: true, force: true });
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 把暫存區的 hooks 合併進既有的：同一事件底下完全相同的 hook 略過，其他附加在後面。
// 各工具專用區塊（"claudecode": { "hooks": ... }）用同樣方式合併。
function mergeHooks(existing, staged) {
  const result = structuredClone(existing ?? { version: 1, hooks: {} });
  let added = 0;
  let duplicates = 0;
  const mergeRecord = (into, from) => {
    for (const [event, defs] of Object.entries(from ?? {})) {
      into[event] ??= [];
      for (const def of defs) {
        if (into[event].some((d) => sameJson(d, def))) duplicates += 1;
        else {
          into[event].push(def);
          added += 1;
        }
      }
    }
  };
  result.hooks ??= {};
  mergeRecord(result.hooks, staged.hooks);
  for (const [key, value] of Object.entries(staged)) {
    if (key === 'hooks' || !value?.hooks) continue;
    result[key] ??= {};
    result[key].hooks ??= {};
    mergeRecord(result[key].hooks, value.hooks);
  }
  return { json: result, added, duplicates };
}

// 比對暫存區與本 repo 的 .rulesync/，算出匯入計畫（不寫入）
export function planImport(stage, { target }) {
  const stagedRoot = path.join(stage, '.rulesync');
  const existing = listAll();
  const existingByKey = new Map(existing.map((i) => [`${i.kind}/${i.name}`, i]));

  const items = listAll(stagedRoot).map((item) => {
    const feature = KIND_FEATURE[item.kind];
    const rel = FEATURES[feature].unit === 'dir' ? item.name : `${item.name}.md`;
    return {
      ...item,
      feature,
      src: FEATURES[feature].unit === 'dir' ? item.dir : item.file,
      dest: path.join(SOURCE_ROOT, FEATURES[feature].sourceDir, rel),
      overwrite: existingByKey.has(`${item.kind}/${item.name}`),
    };
  });

  // 匯入的主規則與本 repo 既有的主規則不同名時，會變成兩份 root
  const stagedRootRule = items.find(isRootRule) ?? null;
  const existingRootRule = listRules().find(isRootRule) ?? null;
  const rootConflict = stagedRootRule && existingRootRule && existingRootRule.name !== stagedRootRule.name
    ? { staged: stagedRootRule, existing: existingRootRule }
    : null;
  // Codex CLI 的 AGENTS.md 已經合併了所有一般規則，匯入後再產生會重複
  const codexFolded = target === 'codexcli' && stagedRootRule
    ? listRules().filter((r) => !isRootRule(r)).map((r) => r.name)
    : [];

  let mcp = null;
  const stagedMcp = readMcp(stagedRoot);
  if (stagedMcp.exists && stagedMcp.json) {
    const current = readMcp();
    const currentServers = current.json?.mcpServers ?? {};
    const incoming = stagedMcp.json.mcpServers ?? {};
    mcp = {
      current,
      json: { ...(current.json ?? {}), mcpServers: { ...currentServers, ...incoming } },
      added: Object.keys(incoming).filter((n) => !(n in currentServers)),
      replaced: Object.keys(incoming).filter((n) => n in currentServers && !sameJson(currentServers[n], incoming[n])),
      unchanged: Object.keys(incoming).filter((n) => n in currentServers && sameJson(currentServers[n], incoming[n])),
    };
  }

  let hooks = null;
  const stagedHooks = readHooks(stagedRoot);
  if (stagedHooks.exists && stagedHooks.json) {
    const current = readHooks();
    hooks = { current, ...mergeHooks(current.json, stagedHooks.json) };
  }

  return { items, rootConflict, codexFolded, mcp, hooks };
}

// mcp、hooks 合併後有沒有變化（沒有就不重寫檔案，免得弄丟註解）
export function hasChanges(feature, p) {
  if (!p.current.exists) return true;
  return feature === 'mcp' ? p.added.length + p.replaced.length > 0 : p.added > 0;
}

// 依計畫寫入。rootAction：'demote'（匯入成一般規則）、'replace'（刪除既有主規則）、'skip'（不匯入主規則）
// 回傳寫入的紀錄 [{ action, path }]
export function applyImport(plan, { rootAction = 'demote' } = {}) {
  const done = [];
  for (const item of plan.items) {
    const isConflictingRoot = plan.rootConflict && item === plan.rootConflict.staged;
    if (isConflictingRoot && rootAction === 'skip') continue;
    fs.mkdirSync(path.dirname(item.dest), { recursive: true });
    // skill 資料夾用合併的方式複製，保留本機多出來的檔案（例如 CHANGELOG.md）
    fs.cpSync(item.src, item.dest, { recursive: true, force: true });
    if (isConflictingRoot && rootAction === 'demote') {
      const text = fs.readFileSync(item.dest, 'utf8');
      fs.writeFileSync(item.dest, text.replace(/^root:\s*true\s*$/m, 'root: false'));
    }
    done.push({ action: item.overwrite ? '覆蓋' : '新增', path: item.dest });
  }
  if (plan.rootConflict && rootAction === 'replace') {
    fs.rmSync(plan.rootConflict.existing.file);
    done.push({ action: '刪除', path: plan.rootConflict.existing.file });
  }
  for (const feature of ['mcp', 'hooks']) {
    const p = plan[feature];
    if (!p || !hasChanges(feature, p)) continue;
    const { file, removedLegacy } = writeSingle(feature, p.json);
    done.push({ action: p.current.exists ? '合併' : '新增', path: file });
    if (removedLegacy) done.push({ action: '移除舊檔名', path: removedLegacy });
  }
  return done;
}
