import fs from 'node:fs';
import path from 'node:path';
import { TARGETS, FEATURES, ROOT, HOME, SOURCE_ROOT, outputRels, isFileOutput, featureOption, scopeLabel, displayPath } from '../lib/config.js';
import { rulesync } from '../lib/run.js';
import { createStage, stageCommand, removeStage, planImport, applyImport, hasChanges } from '../lib/import-stage.js';
import { readMcp, readHooks } from '../lib/inventory.js';
import { log, title, blank, select, multiselect, confirm, text, run } from './steps.js';
import { validateStep, confirmRewrite } from './shared.js';

export const meta = { id: 'import', label: '匯入', hint: '把 Claude Code 或 Codex 既有的設定轉成 rulesync 格式，先暫存再合併' };

// 列出來源裡某個功能有什麼：目錄列出項目名稱，檔案只看存不存在
function describeSource(sourceRoot, target, feature, global) {
  return outputRels(target, feature, { global }).map((rel) => {
    const p = path.join(sourceRoot, rel);
    if (!fs.existsSync(p)) return { path: p, exists: false, names: [], entries: [] };
    if (isFileOutput(p)) return { path: p, exists: true, names: null, entries: [] };
    const entries = fs.readdirSync(p, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => ({ name: e.name.replace(/\.(md|toml)$/, ''), path: path.join(p, e.name) }));
    return { path: p, exists: entries.length > 0, names: entries.map((e) => e.name), entries };
  });
}

// 可以逐項挑選的功能。rules、hooks、mcp 會合成或合併成單一檔案，維持整批
const PICKABLE = ['skills', 'subagents', 'commands'];

// 在執行 rulesync import 之前逐項挑選，沒勾的不放進暫存區。
// 這樣沒勾的項目就算 frontmatter 有問題，也不會讓整批匯入失敗（rulesync 遇到一個錯就全部中止）。
// 回傳 { features, exclude }：exclude 是沒勾的項目在來源的路徑；一個都沒勾的功能會拿掉
export function* pickSourceItems(sources) {
  const exclude = [];
  const dropped = [];
  for (const [feature, list] of sources) {
    if (!PICKABLE.includes(feature)) continue;
    const entries = list.flatMap((s) => s.entries);
    if (entries.length < 2) continue;
    const names = [...new Set(entries.map((e) => e.name))];
    const chosen = yield multiselect(`要匯入哪些 ${FEATURES[feature].label}？`, names.map((n) => ({ value: n, label: n, selected: true })));
    if (chosen.length === 0) {
      yield log(`${FEATURES[feature].label} 一個都沒選，略過這個功能`, 'muted');
      dropped.push(feature);
      continue;
    }
    for (const e of entries) if (!chosen.includes(e.name)) exclude.push(e.path);
  }
  return { dropped, exclude };
}

// 匯入的來源只有一個工具，不支援就停用；停用原因的「請用…」是給產生用的，這裡改成請切換層級
function importOption(feature, target, global) {
  const option = featureOption(feature, [target], { global, selected: feature === 'skills' });
  if (!option.disabled) return option;
  const other = outputRels(target, feature, { global: !global }).length > 0;
  const reason = other
    ? `${TARGETS[target].label} 的 ${FEATURES[feature].label} 只有${scopeLabel(!global)}，請改選「${scopeLabel(!global)}」`
    : `${TARGETS[target].label} 沒有 ${FEATURES[feature].label}`;
  return { ...option, disabled: reason };
}

export function* flow() {
  const target = yield select(
    '從哪個工具匯入？',
    Object.entries(TARGETS).map(([value, t]) => ({ value, label: t.label })),
  );
  // 先問層級，功能清單才能把這個層級不支援的功能停用（例如 Codex CLI 的 Commands 只有全域）
  const scope = yield select('來源是哪一層？', [
    { value: 'project', label: '專案層級', hint: '某個專案底下的 .claude/、.agents/、.codex/、CLAUDE.md、AGENTS.md、.mcp.json' },
    { value: 'global', label: '使用者層級（全域）', hint: '~/.claude/、~/.claude.json、~/.agents/、~/.codex/' },
  ]);
  const global = scope === 'global';
  let features = yield multiselect(
    `要匯入哪些功能？（${scopeLabel(global)}）`,
    Object.keys(FEATURES).map((f) => importOption(f, target, global)),
  );
  if (features.length === 0) {
    yield log('至少要選一個功能', 'error');
    return false;
  }

  let sourceRoot = global ? HOME : ROOT;
  if (!global) {
    sourceRoot = yield text('來源專案的根目錄（留空＝本 repo）', {
      initial: '',
      placeholder: ROOT,
      validate: (v) => (v === '' || fs.existsSync(v) ? null : '找不到這個目錄'),
    });
    sourceRoot = sourceRoot ? path.resolve(sourceRoot) : ROOT;
  }

  // 本 repo 的 mcp、hooks 原始檔壞掉時，合併會把它蓋掉，先擋下來
  for (const [feature, current] of [['mcp', readMcp()], ['hooks', readHooks()]]) {
    if (features.includes(feature) && current.error) {
      yield log(`${displayPath(current.file)} 無法解析：${current.error}，請先手動修正`, 'error');
      return false;
    }
  }

  yield title('來源內容');
  let found = 0;
  const sources = features.map((f) => [f, describeSource(sourceRoot, target, f, global)]);
  for (const [f, list] of sources) {
    for (const s of list) {
      const detail = !s.exists ? '（不存在）' : s.names ? s.names.join('、') : '存在';
      yield log(`${FEATURES[f].label}：${displayPath(s.path)} ${detail}`, s.exists ? 'info' : 'muted');
      if (s.exists) found += 1;
    }
  }
  if (found === 0) {
    yield log('來源沒有可匯入的內容', 'error');
    return false;
  }
  yield blank();

  const { dropped, exclude } = yield* pickSourceItems(sources);
  features = features.filter((f) => !dropped.includes(f));
  if (features.length === 0) {
    yield log('至少要選一個功能', 'error');
    return false;
  }
  if (exclude.length) {
    yield log(`沒勾的 ${exclude.length} 個項目不會放進暫存區，也不會匯入`, 'muted');
    yield blank();
  }

  const stage = createStage(sourceRoot, scope, { exclude });
  try {
    yield title('匯入到暫存區');
    const cmd = stageCommand(stage, { target, features, scope });
    const { code } = yield run(rulesync(cmd.args, { cwd: cmd.cwd, env: cmd.env }));
    if (code !== 0) {
      yield log(`rulesync 結束代碼 ${code}，沒有寫入任何東西`, 'error');
      return false;
    }
    yield blank();

    const plan = planImport(stage, { target });
    if (plan.items.length === 0 && !plan.mcp && !plan.hooks) {
      yield log('rulesync 沒有匯入任何內容', 'error');
      return false;
    }

    yield title(`會寫入 ${displayPath(SOURCE_ROOT)}/`);
    for (const item of plan.items) {
      yield log(`${item.overwrite ? '覆蓋' : '新增'} ${item.kind} ${item.name}`, item.overwrite ? 'warning' : 'info');
    }
    if (plan.mcp) {
      const m = plan.mcp;
      if (m.added.length) yield log(`MCP 新增：${m.added.join('、')}`, 'info');
      if (m.replaced.length) yield log(`MCP 覆蓋（設定不同）：${m.replaced.join('、')}`, 'warning');
      if (m.unchanged.length) yield log(`MCP 相同，略過：${m.unchanged.join('、')}`, 'muted');
      yield log('既有的其他 MCP 伺服器保留', 'muted');
      if (hasChanges('mcp', m)) yield* confirmRewrite(m.current);
    }
    if (plan.hooks) {
      const h = plan.hooks;
      yield log(`Hooks 新增 ${h.added} 個${h.duplicates ? `，${h.duplicates} 個已存在略過` : ''}；既有的 hooks 保留`, h.added ? 'info' : 'muted');
      if (hasChanges('hooks', h)) yield* confirmRewrite(h.current);
    }
    if (plan.codexFolded.length) {
      yield log(`Codex 的 AGENTS.md 已經合併了一般規則。本 repo 已有 ${plan.codexFolded.join('、')}，匯入後再產生，內容會重複，請手動整理`, 'warning');
    }

    let rootAction = 'demote';
    if (plan.rootConflict) {
      const { staged, existing } = plan.rootConflict;
      yield blank();
      yield log(`匯入的主規則 ${staged.name} 跟既有的主規則 ${existing.name} 都是 root，只能留一份`, 'warning');
      rootAction = yield select('匯入的主規則要怎麼處理？', [
        { value: 'demote', label: '匯入成一般規則', hint: `${staged.name} 改成 root: false，${existing.name} 仍是主規則` },
        { value: 'replace', label: '取代既有的主規則', hint: `刪除 .rulesync/rules/${existing.name}.md` },
        { value: 'skip', label: '不匯入主規則', hint: '其他項目照常匯入' },
      ]);
    }

    const overwrites = plan.items.filter((i) => i.overwrite).length + (plan.mcp?.replaced.length ?? 0) + (rootAction === 'replace' ? 1 : 0);
    const ok = yield confirm(overwrites ? '確定要匯入並覆蓋上面標示的項目嗎？' : '確定要匯入嗎？', { danger: overwrites > 0 });
    if (!ok) return false;

    yield blank();
    yield title('匯入結果');
    for (const d of applyImport(plan, { rootAction })) {
      yield log(`${d.action} ${displayPath(d.path)}`, d.action === '刪除' ? 'warning' : 'success');
    }
  } finally {
    removeStage(stage);
  }

  yield blank();
  yield* validateStep({ features });
  yield blank();
  yield log('接下來：刪除不必要的檔案、補 CHANGELOG.md、檢查內文有沒有工具專屬的寫法，然後執行「預覽產生」', 'muted');
  return true;
}
