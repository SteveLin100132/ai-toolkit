import { loadConfig, MISSING_CONFIG } from '../lib/config.js';
import { rulesync } from '../lib/run.js';
import { log, title, run, confirm } from './steps.js';
import { pickScope, showOutputs } from './shared.js';

export const doctorMeta = { id: 'doctor', label: '診斷', hint: 'rulesync doctor，唯讀' };
export function* doctorFlow() {
  const { code } = yield run(rulesync(['doctor']));
  return code === 0;
}

export const gitignoreMeta = { id: 'gitignore', label: '更新 .gitignore', hint: '依 rulesync.jsonc 的 targets 與 features 加入產生檔的忽略規則' };
export function* gitignoreFlow() {
  const config = loadConfig();
  if (!config.exists) {
    yield log(MISSING_CONFIG, 'error');
    return false;
  }
  yield log('只加入設定檔列出的工具與功能。不限定範圍的 rulesync gitignore 會連 CLAUDE.md、AGENTS.md 都忽略', 'muted');
  const { code } = yield run(rulesync(['gitignore', '--targets', config.targets.join(','), '--features', config.features.join(',')]));
  return code === 0;
}

export const cleanMeta = { id: 'clean', label: '清理輸出', hint: '刪除專案輸出目錄中不是由 .rulesync/ 產生的檔案（--delete）' };
export function* cleanFlow({ yes = false, preset = {} } = {}) {
  const scope = yield* pickScope({ preset });
  if (!scope) return false;
  const { targets, features } = scope;
  yield* showOutputs(targets, features);
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
  yield log('清理完成', 'success');
  return true;
}
