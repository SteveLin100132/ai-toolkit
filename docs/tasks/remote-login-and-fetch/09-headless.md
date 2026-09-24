# 09 純文字模式：`login`、`logout`、`fetch` 的 token 解析

**依賴**：03、05、07
**類型**：程式

## 目標

CI 與 AI 工具能在沒有瀏覽器的環境使用同一套功能。

## 範圍

`cli/headless.js`：

- `login [--token-from gh|env]`：不跑 Device Flow；沒有 `--token-from` 時依 `resolveToken` 的順序找，找不到就以代碼 2 結束並說明。成功後寫入 `hosts.json`（`method` 為 `gh` 或 `env`，不存 token）。純文字模式沒有倉庫清單，倉庫由 `fetch <source>` 直接指定。
- `repos [--org <org>]`：列出可存取的倉庫（`owner/repo`，一行一個），給 AI 工具與腳本用。
- `logout`
- `fetch`：加入 token 解析與 host 檢查（與任務 07 相同邏輯）；保留 `--yes`。
- `--help` 補上新指令與 `--token-from`。
- `package.json` scripts 加 `login`、`logout`。

## 驗收條件

- [ ] `GITHUB_TOKEN=$(gh auth token) node cli/index.js login` 成功，`node cli/index.js repos --org <org>` 列出私有倉庫
- [ ] 沒 token 時 `login` 退出碼 2，訊息說明三種提供方式
- [ ] `node cli/index.js fetch <私有倉庫> --skills x --yes` 在只有 `hosts.json` 的情況下成功
- [ ] 在非 TTY（`| cat`）下所有新指令不會卡住
