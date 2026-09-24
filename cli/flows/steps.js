// flow 用 yield 送出的請求。畫面（ui/）與純文字模式（headless.js）都用同一套。
export const log = (text, level = 'info') => ({ type: 'log', text, level });
export const title = (text) => log(text, 'title');
export const blank = () => log('', 'info');
export const select = (question, options) => ({ type: 'select', question, options });
export const multiselect = (question, options) => ({ type: 'multiselect', question, options });
// typed：要求輸入指定文字（例如 'yes'）才算確認，用在刪除與寫入全域目錄
export const confirm = (question, { danger = false, typed = null } = {}) => ({ type: 'confirm', question, danger, typed });
export const text = (question, { initial = '', validate = null, placeholder = '' } = {}) => ({ type: 'text', question, initial, validate, placeholder });
// quiet：不把輸出逐行印到畫面（例如文件內容，改用 pager 顯示）
export const run = (spec) => ({ type: 'run', ...spec });
// 可捲動的全文檢視（文件內容）
export const pager = (heading, lines) => ({ type: 'pager', heading, lines });
// 在 flow 裡執行非同步工作（例如呼叫 GitHub API）。畫面顯示 busy，回傳 fn 的結果；fn 丟出的錯誤會傳回 flow
export const call = (fn, label = '處理中') => ({ type: 'call', fn, label });
// Device Flow 的登入畫面：顯示 user code 與網址，同時執行 poll(signal) 等待授權；使用者按 Esc 就中止
export const deviceCode = ({ userCode, verificationUri, expiresIn, poll }) => ({ type: 'deviceCode', userCode, verificationUri, expiresIn, poll });

// 可以中止 flow 的例外（使用者按 Esc 或拒絕確認時由 flow 自己丟）
export class Cancelled extends Error {
  constructor(message = '已取消') {
    super(message);
    this.name = 'Cancelled';
  }
}
