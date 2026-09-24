import * as validate from './validate.js';
import * as generate from './generate.js';
import * as importFlow from './import.js';
import * as fetchFlow from './fetch.js';
import * as docs from './docs.js';
import * as installGlobal from './install-global.js';
import * as newFlow from './new.js';
import * as release from './release.js';
import * as misc from './misc.js';
import * as login from './login.js';

// 主選單依類型分群。hint 是主選單顯示的短說明（各 flow 的 meta.hint 較長，給 README 與 --help 用）
export const groups = [
  {
    title: '原始檔（.rulesync/）',
    items: [
      { ...validate.meta, hint: '檢查 frontmatter、名稱、hooks／MCP 設定檔', start: () => validate.flow() },
      { ...newFlow.meta, hint: '建立 rule／skill／subagent／command 骨架，或加一筆 hook、MCP', start: () => newFlow.flow() },
      { ...importFlow.meta, hint: '把 Claude Code 或 Codex 既有的設定轉成 rulesync 格式', start: () => importFlow.flow() },
    ],
  },
  {
    title: '產生輸出',
    items: [
      { ...generate.metaDry, hint: 'dry run，列出會寫出哪些檔案', start: (o) => generate.flow({ ...o, dryRun: true }) },
      { ...generate.meta, hint: '寫入專案的 .claude/、.agents/、.codex/', start: (o) => generate.flow(o) },
      { ...installGlobal.meta, hint: '寫入 ~/.claude、~/.agents、~/.codex，可還原備份', start: (o) => installGlobal.flow(o) },
      { ...misc.cleanMeta, hint: '刪除不是由 .rulesync/ 產生的檔案（--delete）', start: (o) => misc.cleanFlow(o) },
      { ...misc.gitignoreMeta, hint: '依 targets 與 features 加入忽略規則', start: (o) => misc.gitignoreFlow(o) },
    ],
  },
  {
    title: '遠端倉庫',
    items: [
      // hint 由主選單依登入狀態即時產生
      { ...login.meta, hint: null, start: (o) => login.flow(o) },
      { ...fetchFlow.remoteMeta, hint: '登入後從清單挑倉庫與項目', start: (o) => fetchFlow.flow({ ...o, remote: true }) },
      { ...fetchFlow.meta, hint: '手動輸入 GitHub 倉庫', start: (o) => fetchFlow.flow(o) },
      { ...release.meta, hint: '為 skill 打 <skill>/vX.Y.Z tag', start: () => release.flow() },
    ],
  },
  {
    title: '其他',
    items: [
      { ...misc.doctorMeta, hint: 'rulesync doctor，唯讀', start: () => misc.doctorFlow() },
      { ...docs.meta, hint: '', start: (o) => docs.flow(o) },
      { ...login.logoutMeta, hint: '刪除本機的 GitHub 登入', start: (o) => login.logoutFlow(o) },
    ],
  },
];

// 攤平的清單（純文字模式與 byId 用），順序與主選單一致
export const menu = groups.flatMap((g) => g.items);

export const byId = Object.fromEntries(menu.map((m) => [m.id, m]));
