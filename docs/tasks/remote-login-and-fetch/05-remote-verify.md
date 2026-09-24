# 05 遠端倉庫清單、網址解析與權限驗證（`cli/lib/remote.js`）

**依賴**：03
**類型**：程式

## 目標

登入之後由 CLI 列出使用者能存取的倉庫讓他挑，也接受手動輸入；並在執行 rulesync 之前先確認 token 讀得到那個倉庫。

## 範圍

### 解析

- `parseRemote(input)`：接受 `owner/repo`、`owner/repo@ref:path`、`https://github.com/owner/repo`、`https://github.com/owner/repo/tree/<ref>/<path>`、`github:owner/repo`。
  - host 不是 `github.com` 就丟出說明性錯誤：「rulesync 17.0.0 只支援 github.com 與 gitlab.com，GitHub Enterprise Server 尚未支援」。
  - 回傳 `{ owner, repo, ref, path, source }`，`source` 是要交給 rulesync 的字串。

### 倉庫清單

- `listOrgs({ token })`：`GET /user/orgs?per_page=100`，加上使用者本人（`/user` 的 `login`）當第一個選項。
- `listRepos({ token, owner, isUser })`：
  - org：`GET /orgs/{org}/repos?type=all&per_page=100&sort=updated`
  - 本人：`GET /user/repos?affiliation=owner,collaborator&per_page=100&sort=updated`
  - 處理 `Link` 標頭分頁，最多抓 5 頁（500 個），超過就提示改用手動輸入或搜尋
  - 回傳 `[{ fullName, private, defaultBranch, description, updatedAt }]`
- `hasRulesyncDir({ token, owner, repo, ref })`：`GET /repos/{owner}/{repo}/contents/.rulesync?ref=`，200 為真、404 為假。**不要**對整個清單逐一呼叫，只在使用者選定倉庫後檢查一次。
- `searchRepos({ token, query })`：`GET /search/repositories?q=<query>+in:name`，給倉庫太多時的搜尋用（搜尋 API 每分鐘 30 次，要提示）。

### 驗證

- `verifyAccess({ token, owner, repo })`：
  - `GET /user` → 401 表示 token 無效
  - `GET /repos/{owner}/{repo}` → 404 表示「倉庫不存在、沒有權限、或 OAuth App 尚未被組織核准」；403 且有 `x-ratelimit-remaining: 0` 表示 rate limit
  - 標頭 `Authorization: Bearer`、`X-GitHub-Api-Version: 2022-11-28`、`User-Agent: ai-toolkit`
  - 回傳 `{ login, private, defaultBranch }`
- 錯誤訊息一律中文、可直接顯示在 TUI。

## 驗收條件

- [ ] 對本機已登入的 `gh` token，`listOrgs` 含本人與所屬 org，`listRepos` 對某個 org 列出私有倉庫
- [ ] org 有開 OAuth App 存取限制但未核准時，`listRepos` 結果為空或缺私有倉庫，回傳值帶 `hint` 提示「請確認組織已核准 App」
- [ ] `verifyAccess` 對私有倉庫回傳正確的 `defaultBranch`；假 token 得到「token 無效」；不存在的倉庫得到 404 說明
- [ ] 非 github.com 的網址被拒絕並附說明
- [ ] 單元測試涵蓋五種輸入格式與分頁（mock `Link` 標頭）
