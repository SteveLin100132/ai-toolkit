import path from 'node:path';
import { listRules, listSkills, listSubagents, listCommands, readHooks, readMcp, isRootRule } from './inventory.js';
import { FEATURES } from './config.js';

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Codex CLI 支援的 hook 事件比 Claude Code 少，只用在這些事件的 hook 才會兩邊都產生
export const CODEX_HOOK_EVENTS = [
  'sessionStart', 'sessionEnd', 'preToolUse', 'postToolUse', 'beforeSubmitPrompt', 'stop', 'stopCancelled',
  'permissionRequest', 'subagentStart', 'subagentStop', 'preCompact', 'postCompact',
];

// 驗證所有 rule、skill、subagent、command，以及 hooks.jsonc、mcp.json。回傳 { items, errors, warnings }。
// 錯誤：缺 SKILL.md／frontmatter、缺 name 或 description、name 與資料夾（檔名）不一致、name 格式不對、
//       超過一個 root rule、hooks.jsonc／mcp.json 無法解析
// 警告：skill 缺 CHANGELOG.md、command 缺 description、rule 沒有 frontmatter、沒有 root rule、
//       不必要的檔案、hook 事件 Codex 不支援
// rule 與 command 以檔名當名稱，frontmatter 不需要 name
// 單一原始檔用了舊檔名，或新舊檔名同時存在
function legacyWarnings(feature, r) {
  const { sourceFile, legacyFile } = FEATURES[feature];
  if (r.bothExist) return [`${legacyFile} 與 ${sourceFile} 同時存在，rulesync 只會讀 ${sourceFile}，請合併後刪除 ${legacyFile}`];
  if (r.legacy) return [`使用舊檔名 ${legacyFile}，建議改名為 ${sourceFile}（用 CLI 新增或匯入時會自動改名）`];
  return [];
}

export function validateAll({ features = ['rules', 'skills', 'subagents', 'commands', 'hooks', 'mcp'] } = {}) {
  const items = [];
  if (features.includes('rules')) items.push(...listRules());
  if (features.includes('skills')) items.push(...listSkills());
  if (features.includes('subagents')) items.push(...listSubagents());
  if (features.includes('commands')) items.push(...listCommands());

  const results = items.map((item) => {
    const errors = [];
    const warnings = [];
    const fm = item.frontmatter;
    if (item.kind === 'rule') {
      if (!fm) warnings.push('沒有 frontmatter，會套用預設值（不是 root、所有工具）');
    } else if (item.kind === 'command') {
      if (!NAME_RE.test(item.name) || item.name.length > 64) errors.push(`檔名「${item.name}」只能使用小寫英文、數字與連字號，最多 64 個字元`);
      if (!fm) errors.push('沒有 frontmatter（第一行必須是 ---）');
      else if (typeof fm.fields.description !== 'string' || !fm.fields.description) warnings.push('frontmatter 缺少 description');
    } else if (!fm) {
      errors.push(item.kind === 'skill' ? '找不到 SKILL.md 或沒有 frontmatter（第一行必須是 ---）' : '沒有 frontmatter（第一行必須是 ---）');
    } else {
      const name = typeof fm.fields.name === 'string' ? fm.fields.name : '';
      const desc = typeof fm.fields.description === 'string' ? fm.fields.description : '';
      if (!name) errors.push('frontmatter 缺少 name');
      else {
        if (name !== item.name) errors.push(`name「${name}」與${item.kind === 'skill' ? '資料夾名稱' : '檔名'}「${item.name}」不一致`);
        if (!NAME_RE.test(name) || name.length > 64) errors.push(`name「${name}」只能使用小寫英文、數字與連字號，最多 64 個字元`);
      }
      if (!desc) errors.push('frontmatter 缺少 description');
    }
    if (item.kind === 'skill' && !item.hasChangelog) warnings.push('缺少 CHANGELOG.md');
    for (const f of item.junk) warnings.push(`不必要的檔案：${path.relative(item.dir, f)}`);
    return { ...item, errors, warnings };
  });

  // 只能有一個 root rule（產生 CLAUDE.md、AGENTS.md 的主規則）
  const rules = results.filter((r) => r.kind === 'rule');
  const roots = rules.filter(isRootRule);
  if (roots.length > 1) for (const r of roots) r.errors.push(`有 ${roots.length} 個 root: true 的規則，只能有一個`);
  if (rules.length && roots.length === 0) rules[0].warnings.push('沒有 root: true 的規則，不會產生 CLAUDE.md、AGENTS.md');

  if (features.includes('mcp')) {
    const mcp = readMcp();
    if (mcp.exists) {
      const errors = [];
      if (mcp.error) errors.push(`無法解析：${mcp.error}`);
      else if (!mcp.json?.mcpServers || typeof mcp.json.mcpServers !== 'object') errors.push('缺少 mcpServers 物件');
      results.push({ kind: 'mcp', name: path.basename(mcp.file), file: mcp.file, version: null, errors, warnings: legacyWarnings('mcp', mcp) });
    }
  }

  if (features.includes('hooks')) {
    const hooks = readHooks();
    if (hooks.exists) {
      const errors = [];
      const warnings = legacyWarnings('hooks', hooks);
      if (hooks.error) errors.push(`無法解析：${hooks.error}`);
      else if (!hooks.json?.hooks || typeof hooks.json.hooks !== 'object') errors.push('缺少 hooks 物件');
      else {
        const events = Object.keys(hooks.json.hooks);
        const codexMissing = events.filter((e) => !CODEX_HOOK_EVENTS.includes(e));
        if (codexMissing.length) warnings.push(`Codex CLI 不支援這些事件，只會產生到 Claude Code：${codexMissing.join('、')}`);
      }
      results.push({ kind: 'hooks', name: path.basename(hooks.file), file: hooks.file, version: null, errors, warnings });
    }
  }

  return {
    items: results,
    errors: results.reduce((n, r) => n + r.errors.length, 0),
    warnings: results.reduce((n, r) => n + r.warnings.length, 0),
  };
}
