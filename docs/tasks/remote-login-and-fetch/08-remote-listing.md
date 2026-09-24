# 08 「從遠端取得」：選倉庫、列出 feature 清單與 tag、多選

**依賴**：05、07
**類型**：程式

## 目標

登入後使用者從清單挑倉庫，再從清單勾選要取得的 feature 項目，不用記名字或網址。

## 範圍

### `cli/lib/remote.js`

- `listRemoteFeatures({ token, owner, repo, ref, path })`：
  - `GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1`（`ref` 可用分支名），檢查 `truncated`
  - 依 `.rulesync/` 底下的路徑分類：
    - skills：`skills/<name>/SKILL.md`
    - subagents：`subagents/<name>.md`
    - commands：`commands/**/*.md`
    - hooks：`hooks.jsonc` 或 `hooks.json`（有就是一項）
  - 回傳 `{ skills: [...], subagents: [...], commands: [...], hooks: boolean }`
- `listSkillTags({ token, owner, repo, skill })`：`GET /repos/{owner}/{repo}/git/matching-refs/tags/<skill>/`，回傳版本清單（新到舊）。

### `cli/flows/fetch.js`：新增「從遠端取得」入口

1. 未登入 → 提示並詢問是否現在登入（呼叫任務 06 的 flow）
2. **選倉庫**：
   - `hosts.json` 有 `remote` 時，第一個選項是「上次使用：`<owner/repo>`」
   - `select` 組織（本人在最前）→ `select` 倉庫（顯示 `owner/repo`、私有標記、更新時間）；清單超過 50 個時先 `text` 輸入關鍵字過濾（本機過濾，不打搜尋 API）
   - 永遠提供「手動輸入」選項（走 `parseRemote`）
   - 選定後 `hasRulesyncDir` 檢查，沒有 `.rulesync/` 就警告「這個倉庫沒有 `.rulesync/` 目錄」，可以改選或指定子目錄
   - 將選定的倉庫寫回 `hosts.json` 的 `remote`
3. `select` ref：預設分支（預設）／輸入分支或 tag
4. `multiselect` feature 類別（skills、subagents、hooks、commands，預設全選有內容的）
5. skills：`multiselect` 項目；可選「指定版本」→ 列 tag
6. subagents、commands：第一版整批取得（rulesync 沒有對應的限定參數），畫面列出會取得哪些項目供確認
7. hooks：整份取得，摘要用警告色標示「hooks 會在您的機器上執行指令，取得後請先檢視」
8. 交給既有的組參數與執行邏輯（token 注入見任務 07）

## 驗收條件

- [ ] 登入後能從 org → 倉庫清單選到本 repo（推上 GitHub 後），不需輸入網址
- [ ] 選到沒有 `.rulesync/` 的倉庫時得到警告並可改選
- [ ] 第二次進入時第一個選項是上次使用的倉庫
- [ ] feature 清單與 `.rulesync/` 實際內容一致；沒有某類 feature 時該類別不顯示或標示「遠端沒有」
- [ ] 含 `/` 的 tag（`speak-human-tw/v1.0.0`）能列出，且用它當 `--ref` 的 fetch 實測通過（這是 README 標記未驗證的項目，通過後同步更新 README）
- [ ] `truncated: true` 時顯示警告並退回手動輸入

## 備註

- OAuth App 的 token 看得到使用者所有倉庫，這裡的清單只是方便挑選，不是權限限制。要真正限制到特定倉庫得改用 GitHub App（見需求文件 3.2）。
- 若日後要讓 subagents／commands 也能挑選，選項是 fetch 後由 CLI 刪除未勾選的檔案，或直接用 contents API 下載勾選的檔案寫入 `.rulesync/`；先不做。
