import { rulesync } from '../lib/run.js';
import { log, select, text, run, pager } from './steps.js';

export const meta = { id: 'docs', label: '查閱 rulesync 文件', hint: '讀取內建於 rulesync 的官方文件，或全文搜尋' };

// options：純文字模式可先給 { doc } 或 { search }
export function* flow({ preset = {} } = {}) {
  let mode = preset.doc ? 'doc' : preset.search ? 'search' : null;
  if (!mode) {
    mode = yield select('要做什麼？', [
      { value: 'doc', label: '瀏覽文件', hint: '從清單選一份文件閱讀' },
      { value: 'search', label: '全文搜尋', hint: '輸入關鍵字，列出最多 10 筆相關文件' },
    ]);
  }

  if (mode === 'search') {
    const q = preset.search ?? (yield text('搜尋關鍵字（英文，精確比對單字）', {
      validate: (v) => (v.trim() ? null : '關鍵字不能空白'),
    }));
    const { code, lines } = yield run(rulesync(['docs', '--search', q.trim()], { quiet: true }));
    if (code !== 0) {
      yield log(lines.join('\n') || '沒有符合的文件', 'warning');
      return false;
    }
    // 結果格式：<document> — <context>，讓使用者直接挑一份來讀
    const results = lines.map((l) => {
      const [doc, ...rest] = l.split(' — ');
      return { value: doc.trim(), label: doc.trim(), hint: rest.join(' — ').slice(0, 80) };
    });
    if (preset.search) {
      for (const r of results) yield log(`${r.label}  ${r.hint}`, 'info');
      return true;
    }
    const doc = yield select('要讀哪一份？', results);
    return yield* showDoc(doc);
  }

  let doc = preset.doc;
  if (!doc) {
    const list = yield run(rulesync(['docs'], { quiet: true }));
    if (list.code !== 0) return false;
    doc = yield select('要讀哪一份文件？', list.lines.map((l) => ({ value: l.trim(), label: l.trim() })));
  }
  return yield* showDoc(doc);
}

function* showDoc(doc) {
  const { code, lines } = yield run(rulesync(['docs', doc], { quiet: true }));
  if (code !== 0) {
    yield log(lines.join('\n') || `找不到文件 ${doc}`, 'error');
    return false;
  }
  yield pager(`rulesync docs ${doc}`, lines);
  return true;
}
