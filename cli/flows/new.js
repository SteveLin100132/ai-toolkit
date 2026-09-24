import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_ROOT, displayPath } from '../lib/config.js';
import { readHooks, readMcp, writeSingle, listRules, isRootRule } from '../lib/inventory.js';
import { CODEX_HOOK_EVENTS } from '../lib/validate.js';
import { log, title, select, text, confirm } from './steps.js';
import { confirmRewrite, reportWrite } from './shared.js';

export const meta = { id: 'new', label: '新增', hint: '建立 rule、skill、subagent、command 骨架，或加一筆 hook、MCP 伺服器' };

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function today() {
  return new Date().toISOString().slice(0, 10);
}

const skillTemplate = (name, description) => `---
name: ${name}
description: >-
  ${description}
# 共用欄位放在最上層。各工具專用的欄位放在對應的區塊，其他工具不會看到：
# claudecode:
#   user-invocable: true
#   allowed-tools: ["Read", "Grep"]
# codexcli:
#   short-description: 簡短說明
---

（在這裡撰寫 skill 內容。避免寫死特定工具專屬的東西：工具名稱、.claude/ 路徑、要求啟動 subagent 的指示。）
`;

const subagentTemplate = (name, description) => `---
name: ${name}
targets: ["*"]
description: >-
  ${description}
claudecode:
  model: inherit
# codexcli:
#   model: gpt-5
---

（在這裡撰寫 subagent 的指示。Codex 版會轉成 TOML 的 developer_instructions。）
`;

const ruleTemplate = (description, root) => `---
root: ${root}
targets: ["*"]
description: >-
  ${description}
${root ? '' : `# 只套用在符合的檔案（留空＝全部）：
# globs: ["src/**/*.ts"]
`}---

（在這裡撰寫規則。${root
    ? 'root 規則會產生 CLAUDE.md 與 AGENTS.md，會整份覆寫既有內容。'
    : 'Claude Code 會產生 .claude/rules/ 底下的檔案；Codex CLI 會合併進 AGENTS.md。'}）
`;

const commandTemplate = (description) => `---
targets: ["*"]
description: >-
  ${description}
# Claude Code 專用欄位：
# claudecode:
#   argument-hint: "[檔案路徑]"
#   allowed-tools: ["Read", "Grep"]
---

（在這裡撰寫 command 的提示詞。$ARGUMENTS 會換成使用者輸入的參數。
Codex CLI 的 command 只支援全域安裝，專案產生時只會輸出 Claude Code 版。）
`;

// 常用的 hook 事件。Codex CLI 不支援的會在說明標註
const HOOK_EVENT_OPTIONS = [
  { value: 'preToolUse', hint: '工具執行前，可以擋下' },
  { value: 'postToolUse', hint: '工具執行後，例如格式化剛改過的檔案' },
  { value: 'beforeSubmitPrompt', hint: '使用者送出提示詞前' },
  { value: 'stop', hint: 'AI 回覆結束時' },
  { value: 'subagentStop', hint: 'subagent 結束時' },
  { value: 'sessionStart', hint: '工作階段開始時' },
  { value: 'sessionEnd', hint: '工作階段結束時' },
  { value: 'preCompact', hint: '壓縮對話前' },
  { value: 'permissionRequest', hint: '要求權限時' },
  { value: 'notification', hint: '送出通知時' },
].map((o) => ({
  value: o.value,
  label: o.value,
  hint: CODEX_HOOK_EVENTS.includes(o.value) ? o.hint : `${o.hint}（Codex CLI 不支援）`,
}));

// 這些事件可以用 matcher 限定工具
const MATCHER_EVENTS = ['preToolUse', 'postToolUse', 'permissionRequest'];

const changelogTemplate = () => `# CHANGELOG

## [0.1.0] - ${today()}
### 新增
- 初始版本
`;

const itemPath = {
  rule: (name) => path.join(SOURCE_ROOT, 'rules', `${name}.md`),
  skill: (name) => path.join(SOURCE_ROOT, 'skills', name),
  subagent: (name) => path.join(SOURCE_ROOT, 'subagents', `${name}.md`),
  command: (name) => path.join(SOURCE_ROOT, 'commands', `${name}.md`),
};

export function* flow() {
  const kind = yield select('要新增什麼？', [
    { value: 'rule', label: 'Rule', hint: '.rulesync/rules/<name>.md（CLAUDE.md、AGENTS.md 的來源）' },
    { value: 'skill', label: 'Skill', hint: '.rulesync/skills/<name>/SKILL.md' },
    { value: 'subagent', label: 'Subagent', hint: '.rulesync/subagents/<name>.md' },
    { value: 'command', label: 'Command', hint: '.rulesync/commands/<name>.md（斜線指令）' },
    { value: 'hook', label: 'Hook', hint: '加一筆到 .rulesync/hooks.jsonc' },
    { value: 'mcp', label: 'MCP 伺服器', hint: '加一筆到 .rulesync/mcp.jsonc' },
  ]);
  if (kind === 'hook') return yield* hookFlow();
  if (kind === 'mcp') return yield* mcpFlow();

  const name = yield text(kind === 'command' ? '名稱（就是斜線指令，小寫英文、數字、連字號）' : '名稱（小寫英文、數字、連字號）', {
    validate: (v) => {
      if (!NAME_RE.test(v) || v.length > 64) return '只能使用小寫英文、數字與連字號，最多 64 個字元';
      if (fs.existsSync(itemPath[kind](v))) return '已經存在';
      return null;
    },
  });
  const description = yield text({
    rule: '描述（一句話說明這份規則管什麼）',
    command: '描述（一句話說明這個指令做什麼）',
  }[kind] ?? '描述（一句話說明用途與觸發時機）', {
    validate: (v) => (v.trim() ? null : '描述不能空白'),
  });

  // 只能有一個 root rule，已經有就不再問
  let root = false;
  if (kind === 'rule') {
    const existingRoot = listRules().find(isRootRule);
    if (existingRoot) yield log(`已有 root 規則 ${existingRoot.name}，這份會建成一般規則`, 'muted');
    else root = yield confirm('要當成 root 規則嗎？（產生 CLAUDE.md、AGENTS.md 的主規則，只能有一個）');
  }

  const files = {
    skill: () => [
      { file: path.join(itemPath.skill(name), 'SKILL.md'), content: skillTemplate(name, description) },
      { file: path.join(itemPath.skill(name), 'CHANGELOG.md'), content: changelogTemplate() },
    ],
    subagent: () => [{ file: itemPath.subagent(name), content: subagentTemplate(name, description) }],
    command: () => [{ file: itemPath.command(name), content: commandTemplate(description) }],
    rule: () => [{ file: itemPath.rule(name), content: ruleTemplate(description, root) }],
  }[kind]();

  yield title('會建立的檔案');
  for (const f of files) yield log(displayPath(f.file), 'info');
  const ok = yield confirm('確定建立嗎？');
  if (!ok) return false;
  for (const f of files) {
    fs.mkdirSync(path.dirname(f.file), { recursive: true });
    fs.writeFileSync(f.file, f.content);
    yield log(`已建立 ${displayPath(f.file)}`, 'success');
  }
  yield log('接下來：編輯內容 → 驗證 → 預覽產生 → 產生 → 提交', 'muted');
  return true;
}

// hooks 全部放在同一個 .rulesync/hooks.jsonc，新增一筆就是在對應事件的陣列後面加一個項目
function* hookFlow() {
  const current = readHooks();
  if (current.error) {
    yield log(`${displayPath(current.file)} 無法解析：${current.error}，請先手動修正`, 'error');
    return false;
  }

  const event = yield select('在哪個事件執行？', HOOK_EVENT_OPTIONS);
  let matcher = '';
  if (MATCHER_EVENTS.includes(event)) {
    matcher = (yield text('限定哪些工具（正規表示式，留空＝全部工具）', {
      initial: '',
      placeholder: 'Write|Edit',
    })).trim();
  }
  const command = (yield text('要執行的指令', {
    placeholder: 'npx prettier --write "$CLAUDE_PROJECT_DIR"',
    validate: (v) => (v.trim() ? null : '指令不能空白'),
  })).trim();

  const hook = { type: 'command', ...(matcher ? { matcher } : {}), command };
  const json = current.json ?? { version: 1, hooks: {} };
  json.hooks ??= {};
  json.hooks[event] = [...(json.hooks[event] ?? []), hook];

  yield title(current.exists ? `會修改 ${displayPath(current.file)}` : `會建立 ${displayPath(current.file)}`);
  yield log(`${event}${matcher ? `（${matcher}）` : ''}：${command}`, 'info');
  if (!CODEX_HOOK_EVENTS.includes(event)) yield log('Codex CLI 不支援這個事件，只會產生到 Claude Code', 'warning');
  yield* confirmRewrite(current);
  const ok = yield confirm('確定寫入嗎？', { danger: current.hasComments });
  if (!ok) return false;
  yield* reportWrite(current, writeSingle('hooks', json));
  yield log('接下來：驗證 → 預覽產生 → 產生 → 提交', 'muted');
  return true;
}

// MCP 伺服器都放在同一個 .rulesync/mcp.jsonc 的 mcpServers
function* mcpFlow() {
  const current = readMcp();
  if (current.error) {
    yield log(`${displayPath(current.file)} 無法解析：${current.error}，請先手動修正`, 'error');
    return false;
  }
  const servers = current.json?.mcpServers ?? {};

  const name = yield text('伺服器名稱（小寫英文、數字、連字號）', {
    validate: (v) => {
      if (!NAME_RE.test(v) || v.length > 64) return '只能使用小寫英文、數字與連字號，最多 64 個字元';
      if (servers[v]) return '已經存在';
      return null;
    },
  });
  const transport = yield select('連線方式？', [
    { value: 'stdio', label: '本機指令（stdio）', hint: '例如 npx -y @modelcontextprotocol/server-filesystem' },
    { value: 'http', label: '遠端網址（HTTP）', hint: '例如 https://mcp.example.com/mcp' },
  ]);

  let server;
  if (transport === 'stdio') {
    const line = (yield text('要執行的指令（含參數，用空白分隔）', {
      placeholder: 'npx -y @modelcontextprotocol/server-filesystem .',
      validate: (v) => (v.trim() ? null : '指令不能空白'),
    })).trim();
    const [command, ...args] = line.split(/\s+/);
    server = { type: 'stdio', command, ...(args.length ? { args } : {}) };
  } else {
    const url = (yield text('網址', {
      placeholder: 'https://mcp.example.com/mcp',
      validate: (v) => (/^https?:\/\//.test(v.trim()) ? null : '要以 http:// 或 https:// 開頭'),
    })).trim();
    server = { type: 'http', url };
  }

  const json = current.json ?? {};
  json.mcpServers = { ...servers, [name]: server };

  yield title(current.exists ? `會修改 ${displayPath(current.file)}` : `會建立 ${displayPath(current.file)}`);
  yield log(`${name}：${JSON.stringify(server)}`, 'info');
  yield log('需要金鑰的伺服器，請用環境變數（"env": { "API_KEY": "${API_KEY}" }），不要把金鑰寫進檔案', 'muted');
  yield* confirmRewrite(current);
  const ok = yield confirm('確定寫入嗎？', { danger: current.hasComments });
  if (!ok) return false;
  yield* reportWrite(current, writeSingle('mcp', json));
  yield log('接下來：驗證 → 預覽產生 → 產生 → 提交', 'muted');
  return true;
}

