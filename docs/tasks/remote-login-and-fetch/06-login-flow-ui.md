# 06 TUI「登入遠端」「登出遠端」與 DeviceCodePrompt

**依賴**：04、05
**類型**：程式（flow + UI）

## 目標

主選單新增兩個項目。「登入遠端」只做 **帳號** 登入，不綁倉庫；倉庫在「從遠端取得」時再挑（任務 08）。

## 範圍

### `cli/flows/login.js`

1. 已登入時先顯示現況（帳號、登入方式、上次使用的倉庫）並提供「重新登入」「取消」
2. `select`：登入方式，動態組成：
   - 用瀏覽器登入 GitHub（Device Flow）— 永遠顯示
   - 使用本機 `gh` 的登入 — `hasGh()` 為真才顯示
   - 使用環境變數 `GITHUB_TOKEN`／`GH_TOKEN` — 有設定才顯示
3. Device Flow：`yield deviceCode(...)`（新的 step 類型，見下）
4. `GET /user` 取得帳號，`listOrgs` 顯示「已以 `<login>` 登入，可存取的組織：a、b、c」
5. `saveLogin`（不寫 `remote`，`remote` 由任務 08 在選定倉庫後寫入）
6. 結束時提示「接下來可以用『從遠端取得』挑選倉庫」

`logoutFlow`：顯示目前登入資訊 → `confirm` → `clearLogin()` → 提示可到 GitHub `Settings → Applications` 撤銷授權。

### `cli/flows/steps.js`

新增 `deviceCode(payload)` step：`{ type: 'deviceCode', userCode, verificationUri, expiresIn }`，畫面回傳登入結果或取消。

### `cli/ui/components.js`

新增 `DeviceCodePrompt`：大字顯示 user code、網址、倒數秒數、「按 Esc 取消」；用 `ink-spinner` 顯示等待。

### `cli/driver.js`、`cli/ui/app.js`

處理新的 step 類型；headless 模式收到 `deviceCode` 直接回錯「純文字模式不支援瀏覽器登入」。

### `cli/flows/index.js`

在「從 Git 取得」前面加「登入遠端」，選單最後加「登出遠端」；更新 README 的主選單表格。

## 驗收條件

- [ ] `npm start` 走完登入，`hosts.json` 有帳號與登入方式、沒有 `remote`
- [ ] 登入結束畫面列出所屬 org
- [ ] 沒裝 `gh` 時選項不出現（可用 `PATH=` 測）
- [ ] Device Flow 途中按 Esc 回到主選單
- [ ] 登出後再進「登入遠端」顯示未登入
- [ ] 畫面上任何地方都看不到完整 token
