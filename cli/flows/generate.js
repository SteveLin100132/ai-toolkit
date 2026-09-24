import { rulesync } from '../lib/run.js';
import { FEATURES, SOURCE_ROOT, displayPath } from '../lib/config.js';
import { readReview, clearReview } from '../lib/review.js';
import { log, title, blank, run, confirm } from './steps.js';
import { validateStep, pickScope, showOutputs, skippedSummary } from './shared.js';

// 「從遠端取得」之後還沒檢視的 subagent／command：先 dry run、列出項目、要求確認，確認後清掉標記。
// 回傳 false 表示使用者拒絕。純文字模式帶 --yes 也一樣要先 dry run，但不會停下來
function* reviewGuard(args, features, { yes }) {
  const review = readReview();
  if (!review) return true;
  const pending = review.items.filter((i) => features.includes(i.feature));
  if (pending.length === 0) return true;
  yield title('尚未檢視的遠端項目');
  yield log('這些項目是從遠端取得的，一產生就會在您的機器上生效。請先檢視內容：', 'warning');
  for (const i of pending) yield log(`${FEATURES[i.feature].label}：${i.name}（來源 ${i.source}）`, 'warning');
  const dry = yield run(rulesync([...args, '--dry-run']));
  if (dry.code !== 0) return false;
  if (!yes) {
    const ok = yield confirm('已檢視上述項目，確定要產生嗎？', { danger: true });
    if (!ok) return false;
  }
  clearReview();
  yield log(`已清除 ${displayPath(SOURCE_ROOT)}/.needs-review.json`, 'muted');
  return true;
}

export const metaDry = { id: 'generate:dry', label: '預覽產生（dry run）', hint: '列出會寫出哪些檔案，不寫入' };
export const meta = { id: 'generate', label: '產生', hint: '先驗證，再寫入專案的 .claude/ 與 .agents/、.codex/' };

// reviewYes：純文字模式只有明確帶 --yes 才略過「尚未檢視的遠端項目」的確認（一般的 yes 在純文字模式一律是 true）
export function* flow({ dryRun = false, preset = {}, yes = false, reviewYes = yes } = {}) {
  const scope = yield* pickScope({ preset, yes });
  if (!scope) return false;
  const { targets, features } = scope;

  const result = yield* validateStep({ features });
  if (result.errors > 0 && !dryRun) {
    yield log('有驗證錯誤，先修正再產生', 'error');
    return false;
  }
  yield blank();
  yield* showOutputs(targets, features);

  const args = ['generate', '--targets', targets.join(','), '--features', features.join(',')];
  if (dryRun) args.push('--dry-run');

  if (!dryRun) {
    const reviewed = yield* reviewGuard(args, features, { yes: reviewYes });
    if (!reviewed) return false;
  }
  if (!dryRun && !yes) {
    const ok = yield confirm('要寫入上面列出的專案目錄嗎？');
    if (!ok) return false;
  }
  yield title(dryRun ? '執行 dry run' : '產生');
  const { code } = yield run(rulesync(args));
  if (code !== 0) {
    yield log(`rulesync 結束代碼 ${code}`, 'error');
    return false;
  }
  yield log(dryRun ? '以上是會寫出的檔案，尚未寫入' : '產生完成', 'success');
  yield* skippedSummary(targets, features);
  return true;
}
