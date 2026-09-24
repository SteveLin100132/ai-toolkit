# 11 README 更新與端到端驗收

**依賴**：全部
**類型**：文件與驗收

## 範圍

### README.md

- 主選單表格加入「登入遠端」「從遠端取得」「登出遠端」
- 「從 Git 取得」注意事項改寫：私有倉庫改為「先登入遠端」，環境變數變成備援
- 新增「登入遠端」一節：三種登入方式、token 存在 `~/.config/ai-toolkit/hosts.json`、`repo` scope 的權限說明、如何撤銷
- 「輸出路徑」表格補 hooks、commands（來自任務 02）
- 「在其他專案中使用」一節：把「還沒實測」的警告依任務 08 的結果更新
- 目錄結構補 `lib/github-auth.js`、`lib/remote.js`、`flows/login.js`、`docs/`

### docs/remote-login-and-fetch.md

- 第 5 節「待決定事項」改成「已決定」，填入實際選擇
- 狀態改為「已實作」

### 端到端驗收（在一台乾淨的機器或新的使用者帳號）

1. `nvm use && npm install && npm start`
2. 登入遠端（Device Flow）→ 從遠端取得（四類 feature）→ 驗證 → 預覽產生 → 產生
3. 確認 `.claude/`、`.agents/`、`.codex/` 的輸出正確，Claude Code 與 Codex 都能看到 skill
4. 登出 → 再取得 → 得到「請先登入」
5. CI 情境：`GITHUB_TOKEN` + 純文字指令跑完 login、fetch、generate

## 驗收條件

- [ ] 上述 5 步全部通過並記錄在本檔案（日期、機器、rulesync 版本）
- [ ] README 內所有指令都實際跑過一次

## 進度（2026-09-23）

- README 已更新：主選單、取得注意事項、「登入遠端」一節、純文字指令、目錄結構。
- 已在本機驗證：`npm test` 19 項通過；純文字 `login --token-from gh`、`repos`、`logout`；公開倉庫 `fetch anthropics/skills --skills skill-creator`（在 scratch 複本中）；`.needs-review.json` 讓 `generate` 先 dry run 並在沒有 `--yes` 時中止。
- 尚未驗證：瀏覽器 Device Flow（需要任務 01 的 client_id）、TUI 的倉庫清單與 tag 選擇（需要本 repo 推上 GitHub）、乾淨機器的端到端流程。
