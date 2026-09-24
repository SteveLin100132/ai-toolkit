import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_ROOT, FEATURES, KIND_FEATURE, outputPaths, outputDirs, isFileOutput, displayPath } from '../lib/config.js';
import { rulesync } from '../lib/run.js';
import { listAll, readHooks, readMcp, isRootRule } from '../lib/inventory.js';
import { backupDirs, listBackups, restoreBackup } from '../lib/backup.js';
import { log, title, blank, select, confirm, run } from './steps.js';
import { validateStep, pickScope, showOutputs, skippedSummary } from './shared.js';

export const meta = { id: 'install-global', label: '安裝到全域', hint: '寫入 ~/.claude、~/.claude.json、~/.agents、~/.codex，會先備份並要求確認' };

export function* flow({ mode = null, yes = false, preset = {} } = {}) {
  if (!mode) {
    mode = yield select('要做什麼？', [
      { value: 'install', label: '安裝', hint: '驗證 → 列出同名項目 → dry run → 備份 → 確認 → 寫入' },
      { value: 'dry', label: '只做 dry run', hint: '不備份、不寫入' },
      { value: 'restore', label: '還原備份', hint: '從 ~/.ai-toolkit-backups/ 還原' },
    ]);
  }
  if (mode === 'restore') return yield* restoreFlow();

  const scope = yield* pickScope({ preset, global: true, yes });
  if (!scope) return false;
  const { targets, features } = scope;

  const result = yield* validateStep({ features });
  if (result.errors > 0) {
    yield log('有驗證錯誤，先修正再安裝', 'error');
    return false;
  }
  yield blank();

  // 同名項目會被覆蓋
  yield title('已存在的同名項目（會被覆蓋）');
  const items = listAll().filter((i) => features.includes(KIND_FEATURE[i.kind]));
  let overwrites = 0;
  for (const item of items) {
    const feature = KIND_FEATURE[item.kind];
    for (const t of targets) {
      for (const dir of outputPaths(t, feature, { global: true }).filter((p) => !isFileOutput(p))) {
        const candidates = FEATURES[feature].unit === 'dir'
          ? [path.join(dir, item.name)]
          : [path.join(dir, `${item.name}.md`), path.join(dir, `${item.name}.toml`)];
        for (const c of candidates) if (fs.existsSync(c)) {
          yield log(displayPath(c), 'warning');
          overwrites += 1;
        }
      }
    }
  }

  // 單一檔案的輸出：rules 整份覆寫主規則檔，mcp、hooks 整段取代對應的區塊
  const wholeFile = {
    rules: {
      active: () => items.some(isRootRule),
      existing: () => ['整份內容'],
    },
    mcp: {
      active: () => readMcp().count > 0,
      existing: (file, text) => (file.endsWith('.toml')
        ? [...text.matchAll(/^\[mcp_servers\.([^\].]+)\]/gm)].map((m) => m[1])
        : Object.keys(JSON.parse(text).mcpServers ?? {})),
    },
    hooks: {
      active: () => readHooks().count > 0,
      existing: (file, text) => Object.keys(JSON.parse(text).hooks ?? {}),
    },
  };
  for (const [feature, check] of Object.entries(wholeFile)) {
    if (!features.includes(feature) || !check.active()) continue;
    for (const t of targets) {
      for (const file of outputPaths(t, feature, { global: true }).filter(isFileOutput)) {
        if (!fs.existsSync(file)) continue;
        try {
          const existing = check.existing(file, fs.readFileSync(file, 'utf8'));
          if (existing.length) {
            yield log(`${displayPath(file)} 的 ${FEATURES[feature].label}（${existing.join('、')}）會被取代`, 'warning');
            overwrites += 1;
          }
        } catch {
          yield log(`${displayPath(file)} 無法解析，請先確認內容`, 'warning');
          overwrites += 1;
        }
      }
    }
  }
  if (overwrites === 0) yield log('（無）', 'muted');
  yield blank();
  yield* showOutputs(targets, features, { global: true });

  const base = ['generate', '--global', '--input-roots', SOURCE_ROOT, '--targets', targets.join(','), '--features', features.join(',')];
  yield title('dry run');
  const dry = yield run(rulesync([...base, '--dry-run']));
  if (dry.code !== 0) {
    yield log(`rulesync 結束代碼 ${dry.code}`, 'error');
    return false;
  }
  if (mode === 'dry') {
    yield log('只做 dry run，沒有寫入任何檔案', 'success');
    yield* skippedSummary(targets, features, { global: true });
    return true;
  }

  yield blank();
  yield title('備份');
  const dirs = outputDirs(targets, features, { global: true });
  const backup = backupDirs(dirs);
  for (const c of backup.copied) yield log(`${displayPath(c.from)} → ${displayPath(c.to)}`, 'info');
  for (const s of backup.skipped) yield log(`${displayPath(s)} 不存在，略過`, 'muted');
  yield blank();

  if (!yes) {
    const ok = yield confirm('要把 dry run 列出的檔案寫入您的使用者目錄嗎？', { danger: overwrites > 0 });
    if (!ok) {
      yield log(`已取消。備份保留在 ${displayPath(backup.backupDir)}`, 'muted');
      return false;
    }
  }
  yield title('寫入');
  const real = yield run(rulesync(base));
  if (real.code !== 0) {
    yield log(`rulesync 結束代碼 ${real.code}，備份在 ${displayPath(backup.backupDir)}`, 'error');
    return false;
  }
  yield log(`完成。備份在 ${displayPath(backup.backupDir)}，可用「還原備份」復原`, 'success');
  yield* skippedSummary(targets, features, { global: true });
  return true;
}

function* restoreFlow() {
  const backups = listBackups();
  if (backups.length === 0) {
    yield log('沒有任何備份', 'muted');
    return false;
  }
  const chosen = yield select(
    '要還原哪一份備份？',
    backups.map((b) => ({ value: b.name, label: b.name, hint: b.contents.join('、') })),
  );
  const backup = backups.find((b) => b.name === chosen);
  yield title('會還原的目錄與檔案');
  for (const rel of backup.contents) yield log(`~/${rel}`, 'warning');
  yield log('同名檔案會被備份的版本覆蓋；備份裡沒有的檔案不會被刪除', 'muted');
  const ok = yield confirm('確定要還原嗎？請輸入 yes', { danger: true, typed: 'yes' });
  if (!ok) return false;
  const restored = restoreBackup(backup);
  for (const r of restored) yield log(`${displayPath(r.from)} → ${displayPath(r.to)}`, 'success');
  return true;
}
