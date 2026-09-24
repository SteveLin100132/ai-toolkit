import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_ROOT, FEATURES } from './config.js';
import { readFrontmatter } from './frontmatter.js';
import { parseJsonc } from './jsonc.js';

const JUNK = [/^\.DS_Store$/, /^\.thumbnail$/, /~$/, /\.swp$/, /\.tmp$/, /^\._/];

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(p));
    else files.push(p);
  }
  return files;
}

// 讀 CHANGELOG.md 最上面的版本號，例如 "## [1.2.0] - 2026-09-23" → "1.2.0"
export function latestChangelogVersion(file) {
  if (!fs.existsSync(file)) return null;
  const m = /^##\s*\[?v?(\d+\.\d+\.\d+)\]?/m.exec(fs.readFileSync(file, 'utf8'));
  return m ? m[1] : null;
}

// 以下的 root 預設是本 repo 的 .rulesync/，匯入時會傳暫存區的 .rulesync/
export function listSkills(root = SOURCE_ROOT) {
  const dir = path.join(root, FEATURES.skills.sourceDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => {
      const skillDir = path.join(dir, e.name);
      const files = walk(skillDir);
      const changelog = path.join(skillDir, 'CHANGELOG.md');
      const skillMd = path.join(skillDir, 'SKILL.md');
      return {
        kind: 'skill',
        name: e.name,
        dir: skillDir,
        file: skillMd,
        files,
        size: files.reduce((n, f) => n + fs.statSync(f).size, 0),
        junk: files.filter((f) => JUNK.some((re) => re.test(path.basename(f)))),
        hasChangelog: fs.existsSync(changelog),
        version: latestChangelogVersion(changelog),
        frontmatter: fs.existsSync(skillMd) ? readFrontmatter(fs.readFileSync(skillMd, 'utf8')) : null,
      };
    });
}

// subagent 與 command 都是一個項目一個 .md
function listMarkdownItems(feature, kind, root) {
  const dir = path.join(root, FEATURES[feature].sourceDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.'))
    .map((e) => {
      const file = path.join(dir, e.name);
      return {
        kind,
        name: e.name.replace(/\.md$/, ''),
        dir,
        file,
        files: [file],
        size: fs.statSync(file).size,
        junk: [],
        hasChangelog: null, // 單一檔案，不要求 CHANGELOG
        version: null,
        frontmatter: readFrontmatter(fs.readFileSync(file, 'utf8')),
      };
    });
}

export function listSubagents(root = SOURCE_ROOT) {
  return listMarkdownItems('subagents', 'subagent', root);
}

export function listCommands(root = SOURCE_ROOT) {
  return listMarkdownItems('commands', 'command', root);
}

export function listRules(root = SOURCE_ROOT) {
  return listMarkdownItems('rules', 'rule', root);
}

export function listAll(root = SOURCE_ROOT) {
  return [...listRules(root), ...listSkills(root), ...listSubagents(root), ...listCommands(root)];
}

export const isRootRule = (item) => item.kind === 'rule' && item.frontmatter?.fields.root === 'true';

export const HOOKS_FILE = path.join(SOURCE_ROOT, FEATURES.hooks.sourceFile);
export const MCP_FILE = path.join(SOURCE_ROOT, FEATURES.mcp.sourceFile);

// 單一原始檔開頭的說明，CLI 重寫檔案時會放回去
export const SINGLE_HEADERS = {
  hooks: `// rulesync hooks 原始檔。事件名稱用 camelCase（例如 preToolUse），產生時會轉成各工具的格式。
// 產生時會整段取代 .claude/settings.json 與 .codex/hooks.json 裡的 hooks，其他設定保留。
// 各工具專用的 hook 放在 "claudecode": { "hooks": { ... } } 或 "codexcli": { "hooks": { ... } }。
`,
  mcp: `// rulesync MCP 原始檔。產生時會整段取代 .mcp.json 與 .codex/config.toml 裡的 MCP 伺服器，其他設定保留。
// 金鑰請用環境變數（"env": { "API_KEY": "\${API_KEY}" }），不要寫進檔案。
`,
};

// 讀單一 JSON(C) 原始檔（hooks、mcp）。正式檔名不存在時改讀舊檔名，跟 rulesync 的順序一樣。
// 回傳 { exists, file, legacy, bothExist, json, error, hasComments }
export function readSingle(feature, root = SOURCE_ROOT) {
  const main = path.join(root, FEATURES[feature].sourceFile);
  const legacy = path.join(root, FEATURES[feature].legacyFile);
  const bothExist = fs.existsSync(main) && fs.existsSync(legacy);
  const file = fs.existsSync(main) ? main : fs.existsSync(legacy) ? legacy : main;
  const base = { file, legacy: file === legacy, bothExist };
  if (!fs.existsSync(file)) return { ...base, exists: false, json: null, error: null, hasComments: false };
  const text = fs.readFileSync(file, 'utf8');
  // 使用者自己加的註解（CLI 重寫時會消失），不算 CLI 放的說明
  const hasComments = /^\s*(\/\/|\/\*)/m.test(text.replace(SINGLE_HEADERS[feature], ''));
  try {
    return { ...base, exists: true, json: parseJsonc(text), error: null, hasComments };
  } catch (e) {
    return { ...base, exists: true, json: null, error: e.message, hasComments };
  }
}

// 寫回單一原始檔。一律寫到正式檔名；原本用的是舊檔名就刪掉舊檔，避免兩個檔案並存。
// 回傳 { file, removedLegacy }
export function writeSingle(feature, json, header = SINGLE_HEADERS[feature]) {
  const current = readSingle(feature);
  const file = path.join(SOURCE_ROOT, FEATURES[feature].sourceFile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, header + JSON.stringify(json, null, 2) + '\n');
  let removedLegacy = null;
  if (current.legacy && current.exists) {
    fs.rmSync(current.file);
    removedLegacy = current.file;
  }
  return { file, removedLegacy };
}

// 讀 .rulesync/hooks.jsonc。多回傳 count（hook 數量）
export function readHooks(root) {
  const r = readSingle('hooks', root);
  const hooks = r.json?.hooks && typeof r.json.hooks === 'object' ? r.json.hooks : {};
  const count = Object.values(hooks).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
  return { ...r, count };
}

// 讀 .rulesync/mcp.jsonc。多回傳 servers（名稱清單）與 count
export function readMcp(root) {
  const r = readSingle('mcp', root);
  const servers = r.json?.mcpServers && typeof r.json.mcpServers === 'object' ? Object.keys(r.json.mcpServers) : [];
  return { ...r, servers, count: servers.length };
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
