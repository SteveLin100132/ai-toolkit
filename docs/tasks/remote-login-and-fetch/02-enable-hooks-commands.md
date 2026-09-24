# 02 `rulesync.jsonc` 加開 hooks、commands 並實測輸出行為

**依賴**：無
**類型**：設定與實測

## 目標

讓「產生」能處理四類 feature（skills、subagents、hooks、commands），並確認 hooks 與 commands 的輸出不會破壞同事既有的設定。

## 範圍

1. `rulesync.jsonc` 的 `features` 加入 `"hooks"`、`"commands"`，更新註解。
2. 在 `.rulesync/` 放最小範例：`hooks.jsonc`（一個無害的 `sessionStart` hook）、`commands/example.md`。
3. `npm run generate:dry` 記錄實際輸出路徑，補進 README「輸出路徑」表格。
4. 實測 hooks 對 `.claude/settings.json` 的行為：先在 `.claude/settings.json` 手動放一個 hook 與一個非 hooks 的設定，執行產生，確認是合併、覆蓋 `hooks` 區塊、還是整檔改寫。把結果寫進本任務與 README。
5. 決定 Codex 端 commands 是否用 `--simulate-commands`，若要用，確認 `cli/flows/generate.js` 能傳這個參數。
6. `npm run gitignore` 更新忽略規則，確認新產生的檔案都被忽略。
7. `cli/lib/config.js` 的 `FEATURES`、`cli/lib/inventory.js` 的 `listAll()`、`cli/lib/validate.js` 補上 hooks 與 commands 的清單與驗證（commands 的 frontmatter、hooks.jsonc 可解析）。

## 驗收條件

- [ ] `npm run validate`、`npm run generate:dry`、`npm run generate` 對四類 feature 都正常
- [ ] README「輸出路徑」表格含 hooks 與 commands 的專案／全域路徑
- [ ] hooks 對 `settings.json` 的合併／覆蓋行為已寫成文字
- [ ] `git status` 沒有未忽略的產生檔

## 實作結果（2026-09-23）

- `rulesync.jsonc` 在本任務建立前就已開啟 rules、skills、subagents、commands、hooks、mcp；`cli/lib/config.js` 也已記錄各功能的輸出路徑與對既有檔案的影響（hooks：整段取代 `hooks`，其他設定保留）。
- 「從遠端取得」只開放 skills、subagents、commands（`FETCHABLE_FEATURES`）。hooks、rules、mcp 的遠端內容會整份覆寫本機 `.rulesync/` 的單一檔案，還沒有像匯入一樣先暫存再合併的做法，所以不開放；遠端清單會顯示它們存在，並提示手動處理。
