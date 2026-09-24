# 需求：在 TUI 中「登入遠端」並從私有倉庫取得 feature

> 狀態：已實作（2026-09-23），2026-09-24 改為 GitHub App 並已用真實 client_id 驗證 Device Flow 第一步（申請登入碼）可用。任務清單見 docs/tasks/remote-login-and-fetch/。
> 依據 rulesync 17.0.0 原始碼（`node_modules/rulesync/dist/cli/index.js`）與 GitHub 官方文件（2026-09 版）整理。

## 1. 需求描述

把本 repo 的 CLI 做成團隊的 AI toolkit registry 用戶端。使用者在 TUI 主選單選擇「登入遠端」，CLI 開啟瀏覽器完成 GitHub 登入；登入後在「從遠端取得」從清單挑選倉庫（或手動輸入網址），再從該倉庫的 `.rulesync/` 底下挑選 feature 取得（`fetch`）或安裝（`install`）到本機，再用既有的「產生」流程轉成 Claude Code 與 Codex CLI 格式。

本文件所說的 **feature** 統稱 rulesync 的各類功能，本 repo 目前要管理的是 **skills、subagents、hooks、commands** 四類。rulesync 17.0.0 的 `fetch --features` 完整支援清單是：rules、commands、subagents、skills、ignore、mcp、hooks、permissions、checks。

目標使用情境：

1. 同事第一次使用：`npm start` → 登入遠端 → 選功能與 skill → 取得 → 產生。整段不用手動建立 token、不用設定環境變數。
2. 之後再用：token 已存在本機，直接「從遠端取得」，不用再登入。
3. CI 或 AI 工具：純文字模式沿用現有的 `GITHUB_TOKEN`／`GH_TOKEN`，不走瀏覽器登入。

## 2. 現況（本 repo 與 rulesync 17.0.0）

### 2.1 本 repo 已有的部分

- `cli/flows/fetch.js`：已包裝 `rulesync fetch`，會問來源、功能、ref、子目錄、限定 skill、同名處理、是否清理。
- `cli/lib/run.js` 的 `runCommand()` 支援傳入 `env`，可以把 token 用環境變數注入子程序，**不需要**把 token 放進指令參數（畫面上顯示的指令字串也不會洩漏 token）。
- 私有倉庫目前只靠使用者自己設定 `GITHUB_TOKEN`／`GH_TOKEN`（README 有寫，CLI 不會要求輸入）。
- TUI 的 `TextPrompt` 沒有遮罩輸入（密碼模式），所以目前不適合直接請使用者貼 token。

### 2.2 rulesync 17.0.0 的限制

| 項目 | 結果 | 影響 |
|---|---|---|
| `fetch` 支援的主機 | 只認得 `github.com`、`gitlab.com`（原始碼 `GITHUB_HOSTS`／`GITLAB_HOSTS` 寫死） | 不支援 GitHub Enterprise Server 或自架 GitLab，遇到其他主機直接丟錯 |
| `fetch` 的驗證方式 | `--token`，或環境變數 `GITHUB_TOKEN` → `GH_TOKEN` | 我們用環境變數注入即可 |
| `fetch` 支援的 feature | rules、commands、subagents、skills、ignore、mcp、hooks、permissions、checks（`--features`） | 四類 feature 都能用同一套流程 |
| `install` + `sources` | 有 lockfile、可重現，但**只支援 skills 與 rules** | subagents、hooks、commands 只能走 `fetch` |
| hooks 的輸出位置 | Claude Code 寫入 `.claude/settings.json`；Codex CLI 沒有對應 | 會動到同事既有的 settings.json，取得前必須先「預覽產生」 |
| commands 的輸出位置 | Claude Code 寫入 `.claude/commands/`；Codex CLI 只能用 `--simulate-commands` 模擬 | 要決定 Codex 端是否開模擬 |
| `rulesync.jsonc` 的 `features` | 目前只開 `skills`、`subagents` | 要加入 `hooks`、`commands` 才會產生，並同步更新 `.gitignore` |
| `install` 的驗證方式 | GitHub transport 同上；git transport 走本機 git 認證（SSH／credential helper） | 同上 |
| 來源格式 | `owner/repo`、`owner/repo@ref:path`、`https://github.com/owner/repo`、`github:owner/repo` | 「遠端網址」可以直接餵給 rulesync，但要先驗證主機是 github.com |
| 401／403 時 | 提示設定 `GITHUB_TOKEN`／`GH_TOKEN` | 我們要在這之前就攔截，給更清楚的訊息 |

結論：**rulesync 本身不做任何登入**，token 從哪裡來是我們 CLI 的責任。

## 3. GitHub 登入方式調研

### 3.1 可選的流程

| 流程 | 需要 client_secret？ | 適合 CLI？ | 備註 |
|---|---|---|---|
| **OAuth Device Flow** | 不需要 | ✅ 官方推薦給 CLI | 使用者在瀏覽器輸入 8 碼 user code；App 設定要勾「Enable Device Flow」 |
| Web Application Flow（loopback redirect 到 `127.0.0.1:<port>`） | **需要**，PKCE（2025-07 起支援）不能取代 secret | ⚠ 得把 secret 包在程式裡（`gh` 就是這樣做） | GitHub 目前不區分 public／confidential client |
| 重用 `gh auth token` | 不需要註冊任何 App | ✅ 零設定 | 前提是同事有裝 `gh` 且已登入 |
| 使用者自己建 PAT | 不需要 | ⚠ 體驗差 | 也就是現況 |

**建議：Device Flow 為主、`gh auth token` 為備援。** Device Flow 是唯一不用在程式裡放 secret 的 GitHub 流程；client_id 本來就是公開識別碼，可以放進版本控制。

Device Flow 細節（來源：GitHub Docs「Authorizing OAuth apps」）：

1. `POST https://github.com/login/device/code`，帶 `client_id`、`scope`，`Accept: application/json`
   → 回傳 `device_code`、`user_code`、`verification_uri`（`https://github.com/login/device`）、`expires_in`（預設 900 秒）、`interval`（通常 5 秒）
2. CLI 顯示 user code、開啟瀏覽器（`open`／`xdg-open`／`start`），開不了就請使用者手動開網址
3. 每 `interval` 秒 `POST https://github.com/login/oauth/access_token`，帶 `client_id`、`device_code`、`grant_type=urn:ietf:params:oauth:grant-type:device_code`
4. 處理回應：`authorization_pending`（繼續等）、`slow_down`（interval +5 秒）、`expired_token`（重來）、`access_denied`（使用者取消）、`device_flow_disabled`（App 沒勾選）
5. 每個 App 每小時最多 50 次 device code 申請，polling 太快也會被算進去

### 3.2 OAuth App 還是 GitHub App？

| | OAuth App | GitHub App |
|---|---|---|
| 讀私有倉庫需要的權限 | `repo` scope（**沒有唯讀 scope**，會拿到寫入權限） | `Contents: Read`（最小權限） |
| Token 壽命 | 長期有效，直到撤銷 | 預設 8 小時，用 refresh token（6 個月）續期；device flow 產生的 token 續期不需要 secret |
| 組織限制 | 受「Third-party application access policy」限制，org owner 要核准 App，否則看不到私有資源 | 不受該限制，但 App 必須被**安裝**到該 org 並勾選倉庫（要 org owner） |
| SAML SSO | 授權時要有該 org 的 SAML session | App 產生的 token 自動通過 SSO |
| GitHub 官方建議 | 舊做法 | 官方建議優先用 GitHub App |
| 實作複雜度 | 低：一次登入、存一個 token | 中：要存 refresh token、處理過期與續期 |

**建議：第一版用 OAuth App + Device Flow**，理由是實作最簡單，而且團隊規模小、org 由自己人管理，核准 App 一次就好。日後若要收緊權限（只給唯讀）或走 SSO，再換成 GitHub App；Device Flow 的程式碼兩者共用，差別只在 token 續期。

無論哪一種，都要先在 GitHub 上註冊 App（`Settings → Developer settings`），並且**組織管理員要核准（OAuth App）或安裝（GitHub App）**，否則登入成功也讀不到私有倉庫。這是部署前的必要步驟，要寫進 README。

### 3.3 Token 存放

- `gh` 的做法：優先寫入系統憑證儲存（macOS Keychain、Windows Credential Manager、Linux Secret Service），失敗時退回明文檔 `~/.config/gh/hosts.yml`。
- Node 的選項：
  - `@napi-rs/keyring`（`keyring-rs` 的綁定，`keytar` 已於 2022 年封存，不要用）：一個套件跨三平台，但是原生模組，`npm install` 時要下載預編譯二進位。
  - 零相依做法：呼叫 `security add-generic-password`（macOS）、`secret-tool`（Linux）、`cmdkey`（Windows）。
  - 明文檔備援：`~/.config/ai-toolkit/hosts.json`，權限 `0600`。
- **建議：第一版只做明文檔（0600）+ 明確警告**，並提供「登出」清除。團隊目前全是 macOS，之後再視需要加 Keychain。原因：避免引入原生模組，讓 `npm install` 在 CI 與同事機器上都不會多一個失敗點。

### 3.4 使用 token 讀取倉庫

CLI 自己不需要讀倉庫內容（交給 rulesync）。唯一要自己打的 API 是登入後的驗證：

- `GET https://api.github.com/user`（確認 token 有效、取得帳號名稱顯示在畫面）
- `GET https://api.github.com/repos/{owner}/{repo}`（確認能讀到目標倉庫；404 代表沒權限或 App 沒被 org 核准）
- 標頭：`Authorization: Bearer <token>`、`X-GitHub-Api-Version: 2022-11-28`
- 已登入的速率上限是每小時 5,000 次，不用擔心

### 3.5 GitHub Enterprise Server

- GHES 3.1 起支援 Device Flow，端點在 `https://<hostname>/login/device/code`，REST 在 `https://<hostname>/api/v3`，App 要在該 GHES 上另外註冊。
- **但 rulesync 17.0.0 不支援 GHES**（見 2.2），所以本需求第一版**只支援 github.com**。若未來需要 GHES，選項是：向 rulesync 提 issue／PR 讓 `GITHUB_HOSTS` 可設定，或改用 `install` 的 `git` transport（走本機 git 認證，就不需要我們的 OAuth 了）。

## 4. 建議的功能設計

### 4.1 主選單新增項目

| 選項 | 功能 |
|---|---|
| 登入遠端 | 選登入方式 → Device Flow 或使用 `gh` → 驗證帳號 → 存 token。**只登入帳號，不綁倉庫** |
| 從遠端取得 | 先從清單選倉庫（組織 → 倉庫，或手動輸入；上次使用的倉庫放最前面），再選 feature 類別（skills、subagents、hooks、commands），再列出該類別可用的項目讓使用者勾選，然後執行 `rulesync fetch`（沿用 `flows/fetch.js`，把 token 用 `env` 注入） |
| 登出遠端 | 刪除本機儲存的 token（不撤銷 GitHub 端授權，並提示使用者可到 GitHub Settings 撤銷） |

「從 Git 取得」既有選項保留，但如果來源的 host 是 github.com 而且本機有 token，就自動注入。

### 4.2 「登入遠端」流程

1. 選擇登入方式：
   - 用瀏覽器登入 GitHub（Device Flow，預設）
   - 使用本機 `gh` 的登入（偵測 `gh auth token` 成功才顯示這個選項）
   - 使用環境變數 `GITHUB_TOKEN`／`GH_TOKEN`（有設定才顯示）
2. Device Flow：畫面顯示 user code 與網址、嘗試開啟瀏覽器、顯示倒數，`Esc` 取消。
3. 驗證：呼叫 `/user` 與 `/user/orgs`，顯示「已以 `<login>` 登入，可存取的組織：…」。token 無效（401）要明確提示。
4. 存檔：`~/.config/ai-toolkit/hosts.json`，內容包含 host、帳號、token、登入方式、時間；`remote`（上次使用的倉庫）由「從遠端取得」寫入。用 `gh` 或環境變數登入的**不存 token**，只記住來源方式，每次重新讀取。

### 4.3 「從遠端取得」流程

1. 沒登入就先導到「登入遠端」。
2. 選倉庫：`GET /user/orgs` 列組織（本人在最前）→ `GET /orgs/{org}/repos` 或 `GET /user/repos` 列倉庫，或手動輸入 `owner/repo`／網址（host 必須是 github.com，見 3.5）。選定後用 `GET /repos/{owner}/{repo}` 與 `/contents/.rulesync` 確認讀得到而且有 `.rulesync/`；404 要翻成「倉庫不存在、沒有權限、或 OAuth App 尚未被組織核准」。OAuth App 的 token 看得到使用者所有倉庫，這個清單只是方便挑選，不是權限限制；要限制到特定倉庫得改用 GitHub App（3.2）。
3. 用 token 列出遠端 `.rulesync/` 底下各類 feature 的項目（`GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1`，一次拿到整棵樹），依類別呈現多選清單：
   - skills：`.rulesync/skills/<name>/SKILL.md`
   - subagents：`.rulesync/subagents/<name>.md`
   - commands：`.rulesync/commands/<name>.md`（可以有子目錄，會照原路徑保留）
   - hooks：`.rulesync/hooks.jsonc`（rulesync 建議的路徑；舊的 `hooks.json` 也讀得到，兩者並存時 jsonc 優先）。單一檔案，只能整份取得，沒有「挑選」的問題

   `rulesync fetch` 只有 `--skills` 能限定項目，subagents 與 commands 沒有對應參數，會整個類別一起抓。要做到「只挑幾個 subagent／command」，得在 fetch 之後由 CLI 自己刪掉沒勾選的檔案，或直接用 API 下載勾選的檔案寫入 `.rulesync/`（不經過 rulesync）。第一版建議：skills 可挑選，其他類別整批取得。這一步是加分項，第一版也可以退回到現有的「用逗號輸入 skill 名稱」。
4. ref 預設為預設分支；提供「選 tag」時可以列 `<skill>/vX.Y.Z` 的 tag（`GET /repos/{owner}/{repo}/git/matching-refs/tags/<skill>/`）。
5. 交給 `flows/fetch.js`，`run(rulesync(args, { env: { GITHUB_TOKEN: token } }))`。
6. 之後照現有流程：驗證 → 預覽產生 → 產生。

### 4.4 純文字模式

- `node cli/index.js login`：僅支援 `--token-from gh|env`，不跑 Device Flow（CI 沒有瀏覽器）。另有 `repos [--org <org>]` 列出可存取的倉庫。
- `node cli/index.js fetch ...`：token 解析順序 `--token`（不建議）→ `GITHUB_TOKEN` → `GH_TOKEN` → 本機 hosts.json → `gh auth token`。
- `node cli/index.js logout`。

### 4.5 程式碼落點

```
cli/
├── lib/
│   ├── github-auth.js   # Device Flow、gh 備援、token 讀寫、/user 與 /repos 驗證
│   └── remote.js        # 解析遠端網址、列出遠端 .rulesync 內容、tag 清單
├── flows/
│   ├── login.js         # 登入遠端／登出遠端
│   └── fetch.js         # 加入 token 注入與遠端清單多選
└── ui/components.js     # 新增 DeviceCodePrompt（顯示 code、倒數、可取消）
```

`rulesync.jsonc` 不動。若日後要走 `install` + `sources`（skills 有 lockfile），再在其他專案的 `rulesync.jsonc` 宣告，本 CLI 只負責把 token 注入 `rulesync install`。

## 5. 待決定事項

| # | 問題 | 建議 |
|---|---|---|
| 1 | 用 OAuth App 還是 GitHub App | **已決定（2026-09-24）：GitHub App**（`Contents: Read-only`、未勾 Expire user access tokens，所以 token 不過期、不需 refresh）。client_id `Ov23lizQsDU1Eq1SeXGs` 寫死在 `cli/lib/github-auth.js`。登入只綁帳號；「從遠端取得」的清單來自 `/user/installations`（App 已安裝的帳號／組織）與 `/user/installations/{id}/repositories`。使用者要先在自己的帳號或組織安裝 App 並勾選倉庫 |
| 2 | OAuth App 註冊在誰名下 | 註冊在公司 org 底下，client_id 寫進 `cli/lib/github-auth.js`（公開資訊，可提交） |
| 3 | Token 存放 | 第一版明文檔 0600；Keychain 列為後續項目 |
| 4 | 要不要支援 `install`（lockfile） | 第一版只做 `fetch`（因為 subagents 只能用 fetch）；`install` 留給其他專案自行宣告 |
| 5 | GHES／自架 GitLab | 不支援，等 rulesync 開放主機設定 |
| 6 | 「從遠端取得」是否要先列遠端清單 | 做，體驗差很多；但實作順序排在登入之後 |
| 7 | subagents／commands 要不要支援只挑幾個 | 第一版整批取得（rulesync 沒有對應參數）；要挑選就得由 CLI 在 fetch 後刪除未勾選的檔案 |
| 8 | hooks 取回後怎麼合併到 `.claude/settings.json` | 由 rulesync generate 處理，但取得前一律先「預覽產生」；hooks 內含會在同事機器上執行的指令，要求取得後人工檢視 `.rulesync/hooks.jsonc` 再產生 |
| 9 | Codex 端的 commands 是否開 `--simulate-commands` | 待定；Codex 沒有原生 commands，模擬功能會把 command 轉成 skill 形式 |

## 6. 風險與注意事項

- OAuth App 未被 org 核准時，登入成功但讀不到私有倉庫，錯誤是 404 不是 403。CLI 要把這個情況翻成人話：「請組織管理員到 Organization settings → Third-party access 核准這個 App」。
- `repo` scope 涵蓋寫入權限；token 外洩等於能改所有私有倉庫。存放與顯示都要小心：畫面上永遠只顯示前綴（`gho_****`），`formatCommand()` 不能印出 token。
- Device Flow 的 App 設定沒勾「Enable Device Flow」會回 `device_flow_disabled`，這個錯誤要有明確提示。
- 每小時 50 次 device code 申請的限制，正常使用不會碰到，但要避免重試迴圈。
- 私有倉庫的 tarball 下載連結 5 分鐘過期；rulesync 自己處理，我們不用管。
- hooks 與 subagents 取回來就是可執行的設定：hooks 會在同事的機器上跑指令，subagents 一產生就是可用的 agent。rulesync 文件也提醒 fetch 之後要先檢視再 generate。CLI 在取得 hooks 或 subagents 之後，應強制走「驗證 → 預覽產生」而不是直接產生。
- hooks 產生時會改寫 `.claude/settings.json` 的 `hooks` 區塊。若同事本機已有自己的 hooks，要先確認 rulesync 是合併還是覆蓋（實作前用「預覽產生」實測），必要時提醒使用者把個人 hooks 放到 `settings.local.json`。
- 本 repo 還沒推到遠端，含 `/` 的 tag（`speak-human-tw/v1.0.0`）能否當作 `--ref` 仍未驗證，實作「選 tag」前要先測。

## 7. 參考資料

- GitHub Docs：Authorizing OAuth apps（Device Flow 端點與錯誤碼）
  https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- GitHub Docs：Scopes for OAuth apps
  https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
- GitHub Docs：Differences between GitHub Apps and OAuth apps
  https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps
- GitHub Docs：Generating a user access token for a GitHub App / Refreshing user access tokens
  https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- GitHub Docs：About OAuth app access restrictions
  https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/about-oauth-app-access-restrictions
- GitHub Changelog：PKCE support（2025-07-14）
  https://github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication/
- gh CLI：`gh auth login`、`gh auth token`、`gh auth status`
  https://cli.github.com/manual/gh_auth_login
- `@napi-rs/keyring`
  https://github.com/Brooooooklyn/keyring-node
- rulesync 內建文件：`npm run rulesync -- docs guide/declarative-sources`、`reference/cli-commands`
