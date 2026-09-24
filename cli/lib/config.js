import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseJsonc } from './jsonc.js';

// 這個套件自己的位置（npx 執行時在 npm 的快取目錄），只用來找 rulesync 與讀版本
export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

// 專案根目錄：從目前目錄往上找含 rulesync.jsonc 的目錄，找不到就用目前目錄。
// AI_TOOLKIT_ROOT 可以直接指定（測試或腳本用）。
export function findProjectRoot(start = process.cwd(), env = process.env) {
  if (env.AI_TOOLKIT_ROOT) return path.resolve(env.AI_TOOLKIT_ROOT);
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'rulesync.jsonc'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}
export const ROOT = findProjectRoot();
export const SOURCE_ROOT = path.join(ROOT, '.rulesync');
export const HOME = os.homedir();
export const BACKUP_ROOT = path.join(HOME, '.ai-toolkit-backups');
export const CONFIG_FILE = path.join(ROOT, 'rulesync.jsonc');

// rulesync 是本套件的 dependency，用模組解析找它的執行檔（npx 安裝時會被提升到上層 node_modules，
// 不能假設在 PKG_ROOT/node_modules/.bin）
export const RULESYNC_BIN = (() => {
  try {
    // rulesync 的 exports 沒有開放 ./package.json，所以先解析主模組，再往上找它的 package.json
    let dir = path.dirname(require.resolve('rulesync'));
    while (!fs.existsSync(path.join(dir, 'package.json'))) {
      const parent = path.dirname(dir);
      if (parent === dir) throw new Error('找不到 rulesync 的 package.json');
      dir = parent;
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.rulesync;
    if (!bin) throw new Error('rulesync 的 package.json 沒有 bin');
    return path.join(dir, bin);
  } catch {
    return path.join(PKG_ROOT, 'node_modules', '.bin', 'rulesync');
  }
})();

// 本 repo 支援的 target 與 feature。輸出路徑以 rulesync 17.0.0 dry run 實測。
// 專案模式相對於專案根目錄，全域模式相對於 HOME。globalOutputs 只列與專案模式不同的項目；
// null 表示該模式不支援（Codex CLI 的 commands 只支援全域）。值可以是陣列（rules 有主規則檔與規則目錄）。
// 沒有副檔名的是目錄，有副檔名的是檔案。產生時對既有檔案的影響（實測）：
// - rules：主規則檔（CLAUDE.md、AGENTS.md）整份覆寫；Codex 會把其他規則合併進 AGENTS.md
// - mcp：整段取代 mcpServers（.claude.json）或 [mcp_servers.*]（config.toml），其他設定保留
// - hooks：整段取代 hooks，其他設定保留
export const TARGETS = {
  claudecode: {
    label: 'Claude Code',
    outputs: {
      skills: '.claude/skills',
      subagents: '.claude/agents',
      commands: '.claude/commands',
      hooks: '.claude/settings.json',
      rules: ['CLAUDE.md', '.claude/rules'],
      mcp: '.mcp.json',
    },
    globalOutputs: { rules: ['.claude/CLAUDE.md', '.claude/rules'], mcp: '.claude.json' },
  },
  codexcli: {
    label: 'Codex CLI',
    outputs: {
      skills: '.agents/skills',
      subagents: '.codex/agents',
      commands: null,
      hooks: '.codex/hooks.json',
      rules: 'AGENTS.md',
      mcp: '.codex/config.toml',
    },
    globalOutputs: { commands: '.codex/prompts', rules: '.codex/AGENTS.md' },
  },
};

// unit：dir＝每個項目一個資料夾，file＝每個項目一個 .md，single＝整個功能只有一個檔案
export const FEATURES = {
  rules: { label: 'Rules', sourceDir: 'rules', unit: 'file' },
  skills: { label: 'Skills', sourceDir: 'skills', unit: 'dir' },
  subagents: { label: 'Subagents', sourceDir: 'subagents', unit: 'file' },
  commands: { label: 'Commands', sourceDir: 'commands', unit: 'file' },
  // legacyFile：rulesync 仍讀得到的舊檔名，正式檔名不存在時才會用
  hooks: { label: 'Hooks', sourceFile: 'hooks.jsonc', legacyFile: 'hooks.json', unit: 'single' },
  mcp: { label: 'MCP', sourceFile: 'mcp.jsonc', legacyFile: 'mcp.json', unit: 'single' },
};

// 從 Git 取得只開放這些功能。rules、hooks、mcp 的遠端內容會整份覆寫 .rulesync/ 既有的檔案，
// 還沒有像匯入一樣先暫存再合併的做法
export const FETCHABLE_FEATURES = ['skills', 'subagents', 'commands'];

// inventory 的 kind 對應到 feature
export const KIND_FEATURE = { rule: 'rules', skill: 'skills', subagent: 'subagents', command: 'commands' };

// 沒有 rulesync.jsonc 時不丟錯，回傳 exists: false，讓不需要設定的功能（登入、查文件）照常運作
export const MISSING_CONFIG = `找不到 rulesync.jsonc（專案根目錄：${ROOT}）。請在有 rulesync.jsonc 的專案目錄執行，或先用 npx rulesync init 建立`;
export function loadConfig() {
  const file = CONFIG_FILE;
  if (!fs.existsSync(file)) return { raw: {}, targets: [], features: [], file, exists: false };
  const raw = parseJsonc(fs.readFileSync(file, 'utf8'));
  const targets = (raw.targets ?? []).filter((t) => TARGETS[t]);
  const features = (raw.features ?? []).filter((f) => FEATURES[f]);
  return { raw, targets, features, file, exists: true };
}

// 讀本套件相依套件的版本（用模組解析，不假設 node_modules 位置）；name 為空時讀本套件自己的版本
export function readPackageVersion(name) {
  try {
    const p = name ? require.resolve(`${name}/package.json`) : path.join(PKG_ROOT, 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).version;
  } catch {
    return '未安裝';
  }
}

// 某個 target × feature 的輸出位置（相對路徑陣列），不支援時回傳空陣列
export function outputRels(target, feature, { global = false } = {}) {
  const t = TARGETS[target];
  if (!t) return [];
  const rel = global && t.globalOutputs && feature in t.globalOutputs ? t.globalOutputs[feature] : t.outputs[feature];
  if (!rel) return [];
  return Array.isArray(rel) ? rel : [rel];
}

export const scopeLabel = (global) => (global ? '全域' : '專案層級');

// 某個 target × feature 在這個層級不支援時，回傳給使用者看的原因（含該怎麼做）；支援時回傳 null
export function unsupportedReason(target, feature, { global = false } = {}) {
  if (outputRels(target, feature, { global }).length) return null;
  const name = `${TARGETS[target].label} 的 ${FEATURES[feature].label}`;
  if (!outputRels(target, feature, { global: !global }).length) return `${TARGETS[target].label} 不支援 ${FEATURES[feature].label}`;
  return `${name} 只支援${scopeLabel(!global)}，請用「${global ? '產生' : '安裝到全域'}」`;
}

// 功能選單的選項：所有選到的工具都不支援就停用；部分不支援就在說明標註
// 回傳 { value, label, hint?, disabled? }（disabled 是停用原因）
export function featureOption(feature, targets, { global = false, selected = false } = {}) {
  const reasons = targets.map((t) => unsupportedReason(t, feature, { global })).filter(Boolean);
  const option = { value: feature, label: FEATURES[feature].label };
  if (reasons.length && reasons.length === targets.length) return { ...option, disabled: reasons.join('；') };
  if (!reasons.length) return { ...option, selected };
  const supported = targets.filter((t) => !unsupportedReason(t, feature, { global })).map((t) => TARGETS[t].label);
  return { ...option, selected, hint: `這裡只處理 ${supported.join('、')}；${reasons.join('；')}` };
}

// 同上，絕對路徑
export function outputPaths(target, feature, { global = false } = {}) {
  return outputRels(target, feature, { global }).map((rel) => path.join(global ? HOME : ROOT, rel));
}

// 輸出位置是不是單一檔案（有副檔名）；否則是目錄
export const isFileOutput = (p) => path.extname(p) !== '';

// 一組 targets × features 會寫入的所有目錄與檔案（去重）
export function outputDirs(targets, features, opts) {
  const dirs = new Set();
  for (const t of targets) for (const f of features) for (const p of outputPaths(t, f, opts)) dirs.add(p);
  return [...dirs];
}

export function displayPath(p) {
  if (p.startsWith(ROOT)) return '.' + p.slice(ROOT.length);
  if (p.startsWith(HOME)) return '~' + p.slice(HOME.length);
  return p;
}
