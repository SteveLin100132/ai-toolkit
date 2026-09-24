# 07 「從 Git 取得」注入 token

**依賴**：03、05
**類型**：程式

## 目標

既有的 `cli/flows/fetch.js` 在來源是 github.com 時自動帶上 token，不用使用者設定環境變數。

## 範圍

- 進入流程時先 `parseRemote(source)`，非 github.com 直接給出說明並結束。
- `resolveToken()`：
  - 有 token → `verifyAccess` 一次，摘要顯示「使用 `<login>` 的登入（來源：瀏覽器登入／gh／環境變數）」
  - 沒 token → 若倉庫是私有（`/repos` 回 404 且未登入）提示「請先執行『登入遠端』」，並詢問要不要現在登入（呼叫任務 06 的 flow）
- 執行時 `run(rulesync(args, { env: { GITHUB_TOKEN: token } }))`；**不要**用 `--token`。
- `formatCommand()` 顯示的指令字串不含 token（本來就不會，加測試鎖住）。
- 摘要中的「私有倉庫請先在環境變數設定…」提示改成顯示目前的 token 來源。
- 預設來源：`hosts.json` 有 `remote` 時當成 `text` 的 `initial`（從清單挑選倉庫的完整流程在任務 08）。

## 驗收條件

- [ ] 未設定任何環境變數、僅靠「登入遠端」存的 token，能 fetch 私有倉庫
- [ ] 用 `gh` 登入的情況也能 fetch
- [ ] 完全沒 token 時對私有倉庫的提示是「請先登入遠端」而不是 rulesync 的原始英文錯誤
- [ ] 單元測試：`formatCommand` 輸出不含 token；`env` 有 `GITHUB_TOKEN`
