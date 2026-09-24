# 03 Token 儲存與解析順序（`cli/lib/github-auth.js`）

**依賴**：無
**類型**：程式

## 目標

提供一個統一的 `resolveToken()`，所有需要 GitHub token 的地方都從這裡拿；並提供 `saveLogin()`／`clearLogin()`。

## 範圍

- 檔案：`~/.config/ai-toolkit/hosts.json`（尊重 `XDG_CONFIG_HOME`），權限 `0600`，目錄 `0700`。
- 內容：
  ```json
  { "github.com": { "login": "<帳號>", "method": "device|gh|env", "token": "<只有 device 才存>", "remote": "owner/repo（上次在「從遠端取得」選的倉庫，登入時不寫）", "savedAt": "<ISO>" } }
  ```
- `resolveToken({ explicit })` 解析順序：`explicit`（`--token`）→ `GITHUB_TOKEN` → `GH_TOKEN` → `hosts.json` 的 `token` → `gh auth token`（`spawn`，逾時 5 秒，失敗就當沒有）。回傳 `{ token, method }`，找不到回傳 `null`。
- `maskToken(token)`：只顯示前綴與前 4 碼，例如 `gho_abcd****`。
- `gh` 偵測：`hasGh()` 用 `gh auth status --json`（exit 0 才算）。
- 不引入原生模組（Keychain 列為後續）。

## 驗收條件

- [ ] 沒有任何 token 時 `resolveToken()` 回 `null`，不丟例外
- [ ] 設定 `GITHUB_TOKEN` 時優先於 `hosts.json`
- [ ] `hosts.json` 建立後權限為 `0600`（`ls -l` 確認）
- [ ] `clearLogin()` 只刪該 host 的項目，不刪整個檔案
- [ ] 單元測試（`node --test`）涵蓋解析順序與遮罩

## 備註

- `hosts.json` 不存 `gh` 或環境變數的 token，只記錄 `method`，每次重新解析。
