# Tasks：登入遠端並從私有倉庫取得 feature

實作於 2026-09-23，測試：`npm test`。依據 [docs/remote-login-and-fetch.md](../../remote-login-and-fetch.md) 拆出的實作任務。每個任務一個檔案，內含目標、依賴、範圍、驗收條件。狀態請直接改下表。

| # | 任務 | 依賴 | 狀態 |
|---|---|---|---|
| [01](01-register-oauth-app.md) | 註冊 GitHub OAuth App 並取得組織核准 | 無 | 已完成（改用 GitHub App，client_id 已寫死；slug 待補） |
| [02](02-enable-hooks-commands.md) | `rulesync.jsonc` 加開 hooks、commands 並實測輸出行為 | 無 | 已完成（repo 原本就已開 hooks、commands；hooks 不開放遠端取得，見備註） |
| [03](03-token-store.md) | Token 儲存與解析順序（`lib/github-auth.js`） | 無 | 已完成 |
| [04](04-device-flow.md) | GitHub Device Flow（`lib/github-auth.js`） | 01、03 | 已完成（待 01 的 client_id 才能真機測） |
| [05](05-remote-verify.md) | 倉庫清單、網址解析與權限驗證（`lib/remote.js`） | 03 | 已完成 |
| [06](06-login-flow-ui.md) | TUI「登入遠端」（僅帳號）「登出遠端」與 DeviceCodePrompt | 04、05 | 已完成（Device Flow 畫面待 01 後真機測） |
| [07](07-fetch-token-injection.md) | 「從 Git 取得」注入 token | 03、05 | 已完成 |
| [08](08-remote-listing.md) | 「從遠端取得」：選倉庫、feature 清單與 tag 多選 | 05、07 | 已完成（含 / 的 tag 待本 repo 推上 GitHub 後實測） |
| [09](09-headless.md) | 純文字模式：`login`、`logout`、`fetch` 的 token 解析 | 03、05、07 | 已完成 |
| [10](10-safety-guards.md) | 安全防護：token 遮罩、hooks／subagents 取得後強制檢視 | 07、08 | 已完成 |
| [11](11-docs-and-acceptance.md) | README 更新與端到端驗收 | 全部 | README 已更新；乾淨機器的端到端驗收待 01 完成後進行 |

建議順序：01 與 02 可以先做（不需要寫程式或只改設定）；03 → 05 → 07 是最小可用路徑（有 token 就能抓私有倉庫）；04 → 06 加上瀏覽器登入；08 → 10 → 11 收尾。

設計決定（2026-09-23，2026-09-24 改為 GitHub App）：「登入遠端」只登入帳號，倉庫在「從遠端取得」時從清單挑選，`hosts.json` 的 `remote` 只是上次使用的倉庫。

共同原則：
- 文件、介面文字、註解一律繁體中文（台灣用語）；程式碼、指令、欄位名稱維持英文。
- 不修改 rulesync 的行為，只在本 repo 的 `cli/` 包裝。
- 每個任務完成時，用 `npm start` 走過一次 TUI 並用純文字模式跑過對應指令。
- Token 永遠不進指令參數、不印在畫面、不寫進 git。
