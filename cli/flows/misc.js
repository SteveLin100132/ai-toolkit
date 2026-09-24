import { rulesync } from '../lib/run.js';
import { displayPath, FEATURES } from '../lib/config.js';
import { planRemoval, applyRemoval, targetLabel } from '../lib/remove.js';
import { log, title, blank, run, confirm } from './steps.js';
import { pickScope, showOutputs, ensureConfig } from './shared.js';

export const doctorMeta = { id: 'doctor', label: '診斷', hint: 'rulesync doctor，唯讀' };
export function* doctorFlow() {
  const { code } = yield run(rulesync(['doctor']));
  return code === 0;
}

export const gitignoreMeta = { id: 'gitignore', label: '更新 .gitignore', hint: '依 rulesync.jsonc 的 targets 與 features 加入產生檔的忽略規則' };
export function* gitignoreFlow({ yes = false } = {}) {
  const config = yield* ensureConfig({ yes });
  if (!config) return false;
  yield log('只加入設定檔列出的工具與功能。不限定範圍的 rulesync gitignore 會連 CLAUDE.md、AGENTS.md 都忽略', 'muted');
  const { code } = yield run(rulesync(['gitignore', '--targets', config.targets.join(','), '--features', config.features.join(',')]));
  return code === 0;
}

export const cleanMeta = { id: 'clean', label: '清理輸出', hint: '刪除輸出目錄中不是由 .rulesync/ 產生的檔案，然後重新產生（--delete）；不是反安裝' };
export function* cleanFlow({ yes = false, preset = {} } = {}) {
  const scope = yield* pickScope({ preset, yes });
  if (!scope) return false;
  const { targets, features } = scope;
  yield* showOutputs(targets, features);
  yield log('這是「同步」：刪掉輸出目錄裡多出來的檔案後會重新產生，.rulesync/ 有的項目會留著。要整批移除產生的檔案請用「移除輸出」', 'info');
  yield log('只清理專案目錄，不會動到 ~/ 底下的全域目錄', 'muted');

  const base = ['generate', '--targets', targets.join(','), '--features', features.join(','), '--delete'];
  yield title('dry run（會刪除的項目）');
  const dry = yield run(rulesync([...base, '--dry-run']));
  if (dry.code !== 0) return false;
  const deletions = dry.lines.filter((l) => /delete/i.test(l));
  if (deletions.length === 0) {
    yield log('沒有需要刪除的檔案', 'success');
    return true;
  }
  if (!yes) {
    const ok = yield confirm(`會刪除 ${deletions.length} 個項目並重新產生，請輸入 yes 確認`, { danger: true, typed: 'yes' });
    if (!ok) return false;
  }
  const real = yield run(rulesync(base));
  if (real.code !== 0) return false;
  yield log('清理完成（已重新產生）', 'success');
  return true;
}

export const removeMeta = { id: 'remove', label: '移除輸出', hint: '刪除由 .rulesync/ 產生的專案輸出（Claude Code／Codex 檔案），不重新產生' };
export function* removeFlow({ yes = false, preset = {} } = {}) {
  const scope = yield* pickScope({ preset, yes });
  if (!scope) return false;
  const { targets, features } = scope;
  yield* showOutputs(targets, features);
  yield log('只移除對得上 .rulesync/ 目前項目的輸出；同一個目錄裡您自己放的檔案不動。只處理專案目錄，不會動到 ~/ 底下的全域目錄', 'muted');
  yield log('.claude/settings.json、.mcp.json、.codex/config.toml 只拿掉 rulesync 寫的那一段（hooks／mcpServers／[mcp_servers.*]），其他設定保留', 'muted');

  const plan = planRemoval({ targets, features });
  yield title('會移除的項目');
  if (plan.length === 0) {
    yield log('沒有找到由 .rulesync/ 產生的輸出（可能還沒「產生」，或已經移除）', 'success');
    return true;
  }
  for (const step of plan) {
    yield log(`${step.action === 'delete' ? '刪除' : '拿掉'} ${displayPath(step.path)}  ← ${targetLabel(step.target)} ${step.detail}`, step.action === 'delete' ? 'warning' : 'info');
  }
  if (features.includes('rules')) yield log('CLAUDE.md／AGENTS.md 是整份由 rulesync 產生的，會整個刪除；若您手動改過內容會一起消失', 'warning');
  yield blank();
  if (!yes) {
    const ok = yield confirm(`會移除 ${plan.length} 個項目，不會重新產生，請輸入 yes 確認`, { danger: true, typed: 'yes' });
    if (!ok) return false;
  }
  const r = applyRemoval(plan);
  for (const p of r.removed) yield log(`已刪除 ${displayPath(p)}`, 'success');
  for (const p of r.stripped) yield log(`已更新 ${displayPath(p)}（拿掉 rulesync 寫的區段）`, 'success');
  for (const p of r.emptiedDirs) yield log(`已刪除空目錄 ${displayPath(p)}`, 'muted');
  for (const s of r.skipped) yield log(`略過 ${displayPath(s.path)}：${s.reason}`, 'error');
  yield log(`移除完成。要重新安裝請執行「產生」（${features.map((f) => FEATURES[f].label).join('、')}）`, 'success');
  return r.skipped.length === 0;
}
