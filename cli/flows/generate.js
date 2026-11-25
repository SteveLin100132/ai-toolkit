import { rulesync } from '../lib/run.js';
import { FEATURES, SOURCE_ROOT, displayPath } from '../lib/config.js';
import { readReview, clearReview, clearReviewItems } from '../lib/review.js';
import { listSkills, listSubagents } from '../lib/inventory.js';
import { PICKABLE_FEATURES, createPickStage, removePickStage } from '../lib/pick-stage.js';
import { log, title, blank, run, confirm, multiselect } from './steps.js';
import { validateStep, pickScope, showOutputs, skippedSummary } from './shared.js';

// 「從遠端取得」之後還沒檢視的 subagent／command：先 dry run、列出項目、要求確認，確認後清掉標記。
// 回傳 false 表示使用者拒絕。純文字模式帶 --yes 也一樣要先 dry run，但不會停下來
// picks：只挑了部分項目時，沒勾選的不列、也不清掉它們的標記（下次產生時還會再問）
function* reviewGuard(args, features, { yes, picks = {} }) {
  const review = readReview();
  if (!review) return true;
  const picked = (i) => !Array.isArray(picks[i.feature]) || picks[i.feature].includes(i.name);
  const pending = review.items.filter((i) => features.includes(i.feature) && picked(i));
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
  const rest = Object.keys(picks).length ? clearReviewItems(pending) : (clearReview(), 0);
  if (rest) yield log(`已從 ${displayPath(SOURCE_ROOT)}/.needs-review.json 移除剛檢視的項目，還有 ${rest} 個沒勾選的項目待檢視`, 'muted');
  else yield log(`已清除 ${displayPath(SOURCE_ROOT)}/.needs-review.json`, 'muted');
  return true;
}

const LISTERS = { skills: listSkills, subagents: listSubagents };

// 讓使用者逐項挑選 skill／subagent。回傳 { features, picks }：
// picks[feature] 是勾選的名稱，全選時不放（＝不限定）；一個都沒勾就把該功能拿掉。
// preset.items：純文字模式用 --skills／--subagents 指定，不問
function* pickItems({ features, config, preset, yes }) {
  const wanted = PICKABLE_FEATURES.filter((f) => features.includes(f));
  if (wanted.length === 0) return { features, picks: {} };
  const given = preset.items ?? {};
  const asking = !yes && !preset.items;
  if (!asking && !wanted.some((f) => Array.isArray(given[f]))) return { features, picks: {} };

  if (config.raw?.delete === true) {
    const why = 'rulesync.jsonc 設了 "delete": true，只產生部分項目會把沒勾選的輸出刪掉';
    // 純文字模式明確指定了項目，不能默默改成全部
    if (!asking) {
      yield log(`${why}，不能用 --skills／--subagents。請拿掉這兩個參數，或把 delete 改成 false`, 'error');
      return null;
    }
    yield log(`${why}，所以這次不提供逐項挑選，會全部產生`, 'warning');
    return { features, picks: {} };
  }

  const picks = {};
  let kept = [...features];
  for (const f of wanted) {
    const names = LISTERS[f]().map((i) => i.name);
    if (names.length === 0) continue;
    let chosen;
    if (asking) {
      chosen = yield multiselect(`要產生哪些 ${FEATURES[f].label}？`, names.map((n) => ({ value: n, label: n, selected: true })));
    } else {
      if (!Array.isArray(given[f])) continue;
      const unknown = given[f].filter((n) => !names.includes(n));
      if (unknown.length) {
        yield log(`${displayPath(SOURCE_ROOT)}/ 裡沒有這些 ${FEATURES[f].label}：${unknown.join('、')}`, 'error');
        return null;
      }
      chosen = given[f];
    }
    if (chosen.length === 0) {
      yield log(`${FEATURES[f].label} 一個都沒選，略過這個功能`, 'muted');
      kept = kept.filter((x) => x !== f);
    } else if (chosen.length < names.length) {
      picks[f] = chosen;
    }
  }
  if (kept.length === 0) {
    yield log('至少要選一個功能', 'error');
    return null;
  }
  return { features: kept, picks };
}

export const metaDry = { id: 'generate:dry', label: '預覽產生（dry run）', hint: '列出會寫出哪些檔案，不寫入' };
export const meta = { id: 'generate', label: '產生', hint: '先驗證，再寫入專案的 .claude/ 與 .agents/、.codex/' };

// reviewYes：純文字模式只有明確帶 --yes 才略過「尚未檢視的遠端項目」的確認（一般的 yes 在純文字模式一律是 true）
export function* flow({ dryRun = false, preset = {}, yes = false, reviewYes = yes } = {}) {
  const scope = yield* pickScope({ preset, yes });
  if (!scope) return false;
  const { targets, config } = scope;

  const picked = yield* pickItems({ features: scope.features, config, preset, yes });
  if (!picked) return false;
  const { features, picks } = picked;

  const result = yield* validateStep({ features, picks });
  if (result.errors > 0 && !dryRun) {
    yield log('有驗證錯誤，先修正再產生', 'error');
    return false;
  }
  yield blank();
  yield* showOutputs(targets, features);

  // 只挑了部分：產生暫存的 source tree，用 --input-roots 指過去
  let pickDir = null;
  try {
    const args = ['generate', '--targets', targets.join(','), '--features', features.join(',')];
    if (Object.keys(picks).length) {
      const { dir, stage } = createPickStage(picks);
      pickDir = dir;
      args.push('--input-roots', stage);
      for (const [f, names] of Object.entries(picks)) yield log(`只產生 ${FEATURES[f].label}：${names.join('、')}（其他的輸出不會動）`, 'info');
      yield blank();
    }
    return yield* runGenerate({ args, targets, features, picks, dryRun, yes, reviewYes });
  } finally {
    removePickStage(pickDir);
  }
}

function* runGenerate({ args, targets, features, picks, dryRun, yes, reviewYes }) {
  if (dryRun) args = [...args, '--dry-run'];

  if (!dryRun) {
    const reviewed = yield* reviewGuard(args, features, { yes: reviewYes, picks });
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
