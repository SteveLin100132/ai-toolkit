# 01 註冊 GitHub OAuth App 並取得組織核准

**依賴**：無
**類型**：設定作業，不寫程式

## 目標

取得 Device Flow 需要的 `client_id`，並確保 App 能讀取公司 org 的私有倉庫。

## 步驟

1. 決定 App 註冊在誰名下（建議：公司 org 底下，`Organization settings → Developer settings → OAuth Apps`）。
2. 建立 OAuth App：
   - Application name：`ai-toolkit`
   - Homepage URL：本 repo 的 GitHub 網址
   - Authorization callback URL：Device Flow 用不到，但欄位必填，填 Homepage URL 即可
   - **勾選「Enable Device Flow」**（沒勾會回 `device_flow_disabled`）
3. 記下 `client_id`。`client_secret` 不需要，不要下載也不要放進 repo。
4. 組織核准：若 org 有開「Third-party application access policy」，請 org owner 到 `Organization settings → Third-party access` 核准這個 App。沒核准的話，登入成功但讀私有倉庫會回 404。
5. 用 `curl` 手動驗證一次 Device Flow（不需要寫程式）：
   ```bash
   curl -X POST https://github.com/login/device/code -H "Accept: application/json" -d "client_id=<CLIENT_ID>&scope=repo"
   ```
   到 https://github.com/login/device 輸入 user code，再用 `device_code` 換 token，最後 `GET /repos/<org>/ai-toolkit` 確認拿得到。

## 驗收條件

- [ ] `client_id` 已記錄在本任務檔案或團隊密碼庫的「非機密」區（它是公開資訊）
- [ ] 用 curl 走完 Device Flow 並成功讀取私有倉庫
- [ ] org owner 已核准 App（或確認 org 沒有開存取限制）

## 備註

- 第一版用 OAuth App + `repo` scope。`repo` 沒有唯讀版本，token 會有寫入權限，README 要說明。
- 日後改 GitHub App（`Contents: Read`、8 小時 token）時，Device Flow 的程式碼可以沿用，差別在 refresh token。

## 實際結果（2026-09-24）

- 最後建立的是 **GitHub App**（不是 OAuth App），client_id `Ov23lizQsDU1Eq1SeXGs`，已寫死在 `cli/lib/github-auth.js` 的 `CLIENT_ID`。
- 設定：Where can this be installed = Any account；Repository permissions → Contents: Read-only；勾 Enable Device Flow；未勾 Expire user access tokens（token 不過期）。
- 已用真實 client_id 呼叫 `POST /login/device/code` 成功（拿到登入碼），Device Flow 已啟用。
- 與 OAuth App 的差異：不用組織「核准」，改為在帳號或組織**安裝** App 並勾選倉庫；「從遠端取得」的清單只會列已安裝的範圍。
- 待補：App 的 slug（安裝頁網址 `https://github.com/apps/<slug>/installations/new`）填進 `APP_SLUG`，CLI 才能直接印出安裝連結。
