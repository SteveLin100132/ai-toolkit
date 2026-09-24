# 10 安全防護：token 遮罩、hooks／subagents 取得後強制檢視

**依賴**：07、08
**類型**：程式

## 目標

避免 token 外洩，並避免遠端取得的可執行設定在未檢視的情況下生效。

## 範圍

1. **Token 遮罩**：所有顯示 token 的地方一律用 `maskToken`；`run` step 的 log 若印出環境變數也要遮罩；加一個測試掃描 `cli/` 所有 log 呼叫不會直接輸出 `token` 變數。
2. **hooks／subagents 取得後**：`fetch` 流程結束時若包含 hooks 或 subagents，
   - 列出取得的 hooks 指令內容摘要（每個 hook 的 `command`）與 subagent 名稱
   - 顯示警告「這些設定會在您的機器上執行指令／建立可用的 agent，請先檢視 `.rulesync/hooks.jsonc` 與 `.rulesync/subagents/`，再執行『預覽產生』」
   - 不自動接著「產生」；「產生」流程在偵測到 `.rulesync/hooks.jsonc` 或 subagents 有變動（與上次產生比對，可用簡單的 mtime 或 hash 存在 `.rulesync/.last-generate.json`）時，先顯示 dry run 並要求 `confirm`
3. **hosts.json**：確認 `.gitignore` 不會有機會把它加進 repo（它在家目錄，但仍在 README 註明勿複製到專案）。
4. **`--token` 參數**：headless 保留但在 `--help` 標註「會留在 shell history，建議用環境變數」。

## 驗收條件

- [ ] 用 `script`／`tee` 錄下一次完整 TUI 操作的輸出，`grep gho_` 只找到遮罩後的字串
- [ ] fetch 含 hooks 後，「產生」第一次會先 dry run 並要求確認
- [ ] 測試涵蓋遮罩函式與「有變動才要求確認」的判斷
