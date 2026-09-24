# 04 GitHub Device Flow（`cli/lib/github-auth.js`）

**依賴**：01（需要 `client_id`）、03
**類型**：程式

## 目標

`deviceLogin({ onCode, signal })`：申請 device code、開瀏覽器、輪詢直到拿到 token。

## 範圍

- 常數：`CLIENT_ID`（來自任務 01）、`SCOPE = 'repo'`。
- 步驟：
  1. `POST https://github.com/login/device/code`，`Accept: application/json`，body `client_id`、`scope`
  2. 呼叫 `onCode({ userCode, verificationUri, expiresIn })` 讓畫面顯示
  3. 嘗試開瀏覽器：macOS `open`、Linux `xdg-open`、Windows `start`；失敗不算錯誤
  4. 每 `interval` 秒 `POST https://github.com/login/oauth/access_token`，`grant_type=urn:ietf:params:oauth:grant-type:device_code`
  5. 回應處理：`authorization_pending` 繼續；`slow_down` interval +5；`expired_token`、`access_denied`、`device_flow_disabled`、`incorrect_client_credentials` 各自轉成中文錯誤訊息並結束
- 支援 `AbortSignal`（使用者按 Esc）。
- 用 Node 22 內建 `fetch`，不加相依。
- 拿到 token 後呼叫 `GET https://api.github.com/user` 取得 `login`。

## 驗收條件

- [ ] 用真實 `client_id` 走完一次，拿到 `gho_` 開頭的 token 與帳號名稱
- [ ] 按 Esc 取消後不再輪詢（用 log 確認）
- [ ] `device_flow_disabled` 的錯誤訊息會提示「App 設定要勾選 Enable Device Flow」
- [ ] 單元測試用 mock fetch 涵蓋 `slow_down` 與 `expired_token`

## 備註

- 每個 App 每小時最多 50 次 device code 申請，程式不得自動重試申請。
