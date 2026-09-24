import { TARGETS, FEATURES, MISSING_CONFIG, loadConfig, outputRels, unsupportedReason, featureOption, scopeLabel, displayPath } from '../lib/config.js';
import { validateAll } from '../lib/validate.js';
import { log, title, blank, multiselect } from './steps.js';

// 印出驗證結果，回傳 { errors, warnings }
export function* validateStep({ features } = {}) {
  const result = validateAll({ features });
  yield title('驗證 .rulesync/ 原始檔');
  if (result.items.length === 0) yield log('沒有任何可檢查的項目', 'muted');
  for (const item of result.items) {
    yield log(`${item.name}（${item.kind}${item.version ? `，v${item.version}` : ''}）`, item.errors.length ? 'error' : 'success');
    for (const e of item.errors) yield log(`  ${e}`, 'error');
    for (const w of item.warnings) yield log(`  ${w}`, 'warning');
  }
  yield log(`共檢查 ${result.items.length} 個項目：${result.errors} 個錯誤、${result.warnings} 個警告`, result.errors ? 'error' : 'success');
  return result;
}

// 讓使用者選 targets 與 features，預設照 rulesync.jsonc。
// global：要處理的層級。選到的工具都不支援的功能會停用並說明原因，而不是從清單拿掉
export function* pickScope({ askTargets = true, askFeatures = true, preset = {}, global = false } = {}) {
  const config = loadConfig();
  if (!config.exists) {
    yield log(MISSING_CONFIG, 'error');
    return null;
  }
  let targets = preset.targets ?? config.targets;
  let features = preset.features ?? config.features;
  if (askTargets && !preset.targets) {
    targets = yield multiselect(
      '要處理哪些工具？',
      Object.entries(TARGETS).map(([value, t]) => ({ value, label: t.label, selected: config.targets.includes(value) })),
    );
  }
  if (askFeatures && !preset.features) {
    features = yield multiselect(
      `要處理哪些功能？（${scopeLabel(global)}）`,
      Object.keys(FEATURES).map((f) => featureOption(f, targets, { global, selected: config.features.includes(f) })),
    );
  } else {
    // 沒有問（例如純文字模式）：拿掉所有工具都不支援的功能，並說明原因
    const kept = [];
    for (const f of features) {
      const { disabled } = featureOption(f, targets, { global });
      if (disabled) yield log(`略過 ${FEATURES[f].label}：${disabled}`, 'warning');
      else kept.push(f);
    }
    features = kept;
  }
  if (targets.length === 0 || features.length === 0) {
    yield log('至少要選一個工具與一個功能', 'error');
    return null;
  }
  return { targets, features, config };
}

export function* showOutputs(targets, features, { global = false } = {}) {
  yield title(global ? '輸出位置（全域）' : '輸出位置（專案）');
  for (const t of targets) for (const f of features) {
    const rels = outputRels(t, f, { global });
    const where = rels.length ? rels.map((r) => (global ? '~/' : './') + r).join('、') : `不會產生：${unsupportedReason(t, f, { global })}`;
    yield log(`${TARGETS[t].label.padEnd(12)} ${FEATURES[f].label.padEnd(10)} ${where}`, rels.length ? 'muted' : 'warning');
  }
  if (features.includes('rules')) yield log('Rules 會整份覆寫主規則檔（CLAUDE.md、AGENTS.md）', 'warning');
  if (features.includes('mcp')) yield log('MCP 會整段取代設定檔裡的 MCP 伺服器清單，其他設定保留', 'warning');
  if (features.includes('hooks')) yield log('Hooks 會整段取代設定檔裡的 hooks，其他設定保留', 'warning');
  yield blank();
}

// 做完之後提醒哪些工具 × 功能沒有產生（使用者找不到檔案時最可能回頭看這裡）
export function* skippedSummary(targets, features, { global = false } = {}) {
  for (const t of targets) for (const f of features) {
    const reason = unsupportedReason(t, f, { global });
    if (reason) yield log(`沒有產生 ${TARGETS[t].label} 的 ${FEATURES[f].label}：${reason}`, 'warning');
  }
}

// 單一原始檔會整份重寫：提醒註解會消失、舊檔名會改名
export function* confirmRewrite(current) {
  if (current.hasComments) yield log('檔案會用 JSON 重寫，您自己加的註解會消失', 'warning');
  if (current.legacy && current.exists) yield log(`會改用正式檔名，${displayPath(current.file)} 會改名`, 'info');
}

export function* reportWrite(current, { file, removedLegacy }) {
  yield log(`已${current.exists ? '更新' : '建立'} ${displayPath(file)}`, 'success');
  if (removedLegacy) yield log(`已移除舊檔名 ${displayPath(removedLegacy)}`, 'muted');
}

export { displayPath };
