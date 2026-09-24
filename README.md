# ai-toolkit

團隊 AI Skill 與 Subagent 的唯一原始來源。原始檔放在 `.rulesync/`，採用 [Rulesync](https://github.com/dyoshikawa/rulesync) 格式，透過 rulesync 同時產生 Claude Code 與 Codex CLI 兩種格式。

所有操作都透過本 repo 的互動式 CLI 進行，不需要記 rulesync 的指令。這份 README 是本 repo 唯一的維護說明，不限定使用哪個 AI 工具。不論是人工維護，還是由 AI 工具代為操作，都請依照本文件的規則。

> 依據 rulesync **17.0.0** 撰寫。Rulesync 更新很快，升級後請先用 `npm run rulesync -- --help` 與 `npm run rulesync -- docs <文件>` 確認格式與路徑沒有變。

## 快速開始

CLI 以目前目錄（往上找到第一個含 `rulesync.jsonc` 的目錄）當作專案根目錄，`.rulesync/` 原始檔與輸出目錄都在那裡。可以用 `AI_TOOLKIT_ROOT` 環境變數直接指定。

**在任何有 `rulesync.jsonc` 的專案裡使用（npm 套件 `ai-toolkit-cli`，指令 `ai-toolkit`）：**

```bash
npx ai-toolkit-cli                    # 進入互動式介面
npx ai-toolkit-cli validate           # 純文字模式
npm i -g ai-toolkit-cli && ai-toolkit # 或全域安裝
```

沒有 `rulesync.jsonc` 時，需要設定的功能（產生、預覽、安裝到全域、清理、更新 .gitignore）會用套件內附的範本（`cli/templates/rulesync.jsonc`：Claude Code + Codex CLI，全部功能）在專案根目錄建立 `rulesync.jsonc` 與 `.rulesync/`：互動式會先確認，純文字模式直接建立。也可以用 `npx ai-toolkit-cli init` 先建好再編輯。

**開發本 repo：**

```bash
nvm install 22   # 第一次才需要
nvm use          # 依 .nvmrc 切換到 Node 22
npm install
npm start        # 進入互動式介面（專案根目錄就是本 repo）
npm test
```

`.npmrc` 設定了 `engine-strict=true`，Node 版本低於 22 時 `npm install` 會直接報錯。

## 互動式介面

`npm start` 會開啟 TUI（深色終端機配色）。主選單：

| 選項 | 功能 | 會問什麼 |
|---|---|---|
| 1. 驗證 | 檢查所有 rule、skill、subagent、command 的 frontmatter、名稱、不必要的檔案，root rule 是否只有一個，以及 `hooks.jsonc`、`mcp.json` 能否解析 | 不問 |
| 2. 預覽產生（dry run） | 列出會寫出哪些檔案，不寫入 | 工具、功能 |
| 3. 產生 | 先驗證，再寫入專案的 `.claude/`、`.agents/`、`.codex/` | 工具、功能、確認 |
| 4. 匯入 | 把 Claude Code 或 Codex 既有的 rules、skills、subagents、commands、hooks、MCP 轉成 rulesync 格式，先暫存再合併 | 來源工具、功能、專案或全域、來源目錄、確認 |
| 5. 登入遠端 | 登入 GitHub 帳號（瀏覽器 Device Flow、借用本機 `gh`，或環境變數），之後「從遠端取得」不用再設 token | 登入方式；瀏覽器登入會顯示登入碼 |
| 6. 從遠端取得 | 登入後從清單挑組織 → 倉庫 → 版本 → 項目，再 `rulesync fetch` 到 `.rulesync/` | 倉庫（上次使用／清單／手動）、版本、功能、skill（可選版本 tag）、同名處理、是否清理、確認 |
| 7. 從 Git 取得 | 手動輸入 GitHub 倉庫，`rulesync fetch` 抓 skill／subagent／command 到 `.rulesync/`；有登入就自動帶 token | 來源、ref、子目錄、功能、限定 skill、同名處理、是否清理、確認 |
| 8. 安裝到全域 | 寫入 `~/.claude`、`~/.claude.json`、`~/.agents`、`~/.codex`；也可以還原備份 | 安裝／dry run／還原、工具、功能、確認 |
| 9. 新增 | 建立 rule、skill、subagent、command 骨架，或在 `hooks.jsonc` 加一筆 hook、在 `mcp.json` 加一個 MCP 伺服器 | 種類；rule／skill／subagent／command：名稱、描述（rule 另問是否為 root）；hook：事件、matcher、指令；MCP：名稱、連線方式、指令或網址；確認 |
| 10. 發布版本 | 為某個 skill 打 `<skill-name>/vX.Y.Z` tag | skill、版本、確認、是否推送 |
| 11. 診斷 | `rulesync doctor`，唯讀 | 不問 |
| 12. 查閱 rulesync 文件 | 讀取內建於 rulesync 的官方文件（可捲動），或全文搜尋 | 瀏覽／搜尋、文件或關鍵字 |
| 13. 更新 .gitignore | 依 `rulesync.jsonc` 的 targets 與 features 加入忽略規則 | 不問 |
| 14. 清理輸出 | `generate --delete`，刪除專案輸出目錄中不是由 `.rulesync/` 產生的檔案 | 工具、功能、輸入 `yes` |
| 15. 登出遠端 | 刪除本機儲存的 GitHub 登入（不撤銷 GitHub 端授權） | 確認 |

選功能時，所選工具在這個層級都不支援的功能會標成 `[-]` 停用並寫出原因，不會從清單拿掉；只有部分工具支援時，說明欄會寫出哪些工具會處理。目前唯一的例子是 **Codex CLI 的 Commands 只支援全域**：專案層級的「產生」不會寫出 Codex 的 command，產生完會再提醒一次，要用「安裝到全域」才會寫到 `~/.codex/prompts/`。

「匯入」注意事項：
- rulesync 17.0.0 的 `import` 會依功能把結果分散寫到目前目錄、來源專案或 `~/.rulesync/`，而且會整份覆寫 `mcp`、`hooks`。所以 CLI 會先匯入到暫存目錄，再比對、合併進本 repo 的 `.rulesync/`，來源專案與 `~/` 都不會被寫入。
- 同名的 rule、skill、subagent、command 會被覆蓋；skill 資料夾裡本機多出來的檔案（例如 `CHANGELOG.md`）會保留。
- MCP 伺服器與 hooks 用**合併**的方式：新的加進去、同名但設定不同的 MCP 伺服器會被覆蓋、完全相同的 hook 會略過，既有的保留。
- 匯入的主規則（Claude Code 匯入成 `rules/CLAUDE.md`，Codex CLI 匯入成 `rules/overview.md`）跟既有的主規則不同名時，會讓您選：匯入成一般規則、取代既有主規則，或不匯入主規則。
- Codex CLI 的 `AGENTS.md` 已經合併了所有一般規則，匯入後如果本 repo 還有一般規則，再產生時內容會重複，要手動整理。
- 「從 Git 取得」目前只開放 skills、subagents、commands。

「從遠端取得」「從 Git 取得」注意事項：
- 預設會**清理**取得的 skill 目錄，遠端沒有的檔案（包含您自己加的）會被刪除。要保留就選「不清理」（`--no-prune`）。
- 私有倉庫要先「登入遠端」（見下一節）。token 依序找：`--token` → `GITHUB_TOKEN` → `GH_TOKEN` → 登入遠端存的 → 本機 `gh`；交給 rulesync 時用環境變數注入，不會出現在畫面上的指令裡。
- 只支援 github.com：rulesync 17.0.0 的 `fetch` 只認得 github.com 與 gitlab.com，GitHub Enterprise Server 目前做不到。
- 「從遠端取得」會先列出遠端 `.rulesync/` 有哪些 skill、subagent、command；skill 可以勾選，subagent 與 command 只能整批取得（rulesync 沒有限定參數）。只選一個 skill 時可以挑 `<skill>/vX.Y.Z` 的版本 tag。遠端的 hooks、rules、MCP 不提供取得，因為會整份覆寫本機檔案。
- 取得的 subagent 與 command 一產生就會在您的機器上生效，所以 CLI 會寫下 `.rulesync/.needs-review.json`（已列入 `.gitignore`）：下次「產生」會先列出這些項目、跑 dry run、要求確認後才寫入。純文字模式要帶 `--yes` 才會略過這個確認。
- 取得的檔案直接進 `.rulesync/`，之後跟自己寫的 skill 一樣用「驗證」「預覽產生」處理。

## 登入遠端

「登入遠端」只登入 GitHub **帳號**，不綁倉庫；倉庫在「從遠端取得」時從清單挑。三種方式：

| 方式 | 需要什麼 | 存什麼 |
|---|---|---|
| 用瀏覽器登入 GitHub | 什麼都不用；CLI 會顯示 8 碼登入碼並開啟 `https://github.com/login/device` | token 存在 `~/.config/ai-toolkit/hosts.json`，權限 0600 |
| 使用本機 `gh` 的登入 | 已 `gh auth login` | 只記錄登入方式，每次向 `gh auth token` 取得 |
| 使用環境變數 | `GITHUB_TOKEN` 或 `GH_TOKEN` | 只記錄登入方式，每次讀環境變數 |

瀏覽器登入用的是本 CLI 的 **GitHub App** 走 Device Flow（`client_id` 寫在 `cli/lib/github-auth.js`，是公開識別碼）。這個 App 只有 **Contents: Read-only** 權限，token 不會過期，而且**只看得到 App 已安裝並勾選的倉庫**。所以：

- 使用者第一次用之前，要在自己的帳號或組織**安裝**這個 App 並勾選要分享的倉庫（組織需要管理員）。沒安裝的話登入會成功，但「從遠端取得」的清單是空的、指定倉庫會回 404。
- `gh` 與環境變數提供的是一般 token，不受 App 安裝範圍限制，但「從遠端取得」的倉庫清單仍只列 App 已安裝的範圍；要抓其他倉庫請用「手動輸入」或「從 Git 取得」。
- 撤銷授權：GitHub → Settings → Applications → Authorized GitHub Apps；「登出遠端」只刪本機檔案。

換一個 App（例如自己 fork 發布）時，改 `CLIENT_ID` 與 `APP_SLUG` 即可，App 要勾選「Enable Device Flow」、不要勾「Expire user access tokens」；測試時可用環境變數 `AI_TOOLKIT_GITHUB_CLIENT_ID`、`AI_TOOLKIT_GITHUB_APP_SLUG` 覆蓋。

操作方式：`↑↓` 或數字鍵選擇，`Enter` 確認，多選用空白鍵切換、`a` 全選，`Esc` 返回，`q` 離開。每個動作執行前都會顯示實際執行的 rulesync 指令。

## 純文字模式（給 CI 與 AI 工具）

帶指令執行就不會進入互動式介面，也不會問問題：沒給參數就照 `rulesync.jsonc`，需要確認的動作沒有 `--yes` 就中止。

```bash
npm run validate
npm run generate:dry
npm run generate
npm run doctor
npm run gitignore
npm run install-global:dry
npm run install-global -- --yes      # 仍會備份
npm run clean -- --yes
node cli/index.js fetch anthropics/skills --skills skill-creator --yes
npm run login                        # 純文字模式不開瀏覽器：有 GITHUB_TOKEN 就用它，否則借用 gh；--token-from gh|env 可指定
npm run repos -- --org <組織>        # 列出登入帳號能存取的倉庫（一行一個 owner/repo）
npm run logout -- --yes
npm run generate -- --yes            # 有「尚未檢視的遠端項目」時，不帶 --yes 會在 dry run 後中止
node cli/index.js docs               # 列出文件；docs <識別碼> 印出、docs --search <關鍵字> 搜尋
node cli/index.js --help             # 完整說明，含 -t/--targets、-f/--features
npm run rulesync -- <參數>            # 直接呼叫專案內的 rulesync
```

匯入、新增、發布版本只提供互動式介面。

## 目錄結構

```
ai-toolkit/
├── README.md               # 本文件
├── rulesync.jsonc          # targets：claudecode、codexcli；features：rules、skills、subagents、commands、hooks、mcp
├── package.json            # 鎖定 rulesync 版本；npm scripts 都指向 cli/
├── .npmrc / .nvmrc         # engine-strict、Node 22
├── .rulesync/
│   ├── rules/<name>.md     # root: true 的那份產生 CLAUDE.md、AGENTS.md，只能有一個
│   ├── skills/<name>/
│   │   ├── SKILL.md        # frontmatter 必須有 name 與 description
│   │   ├── CHANGELOG.md
│   │   └── ...             # 附屬檔案
│   ├── subagents/<name>.md
│   ├── commands/<name>.md  # 斜線指令，檔名就是指令名稱
│   ├── hooks.jsonc         # 所有 hook 都在這一個檔案
│   └── mcp.jsonc           # 所有 MCP 伺服器都在這一個檔案（舊檔名 mcp.json 仍可讀）
├── scripts/hooks/          # hook 呼叫的腳本（rulesync 只轉換 hooks 設定，不會複製腳本）
└── cli/
    ├── index.js            # 入口：不帶參數進 TUI，帶指令走純文字模式
    ├── theme.js            # TUI 配色與訊息等級
    ├── driver.js           # 驅動 flow，把請求交給畫面或純文字模式
    ├── headless.js         # 純文字模式
    ├── lib/                # 純邏輯：設定、驗證、執行指令、備份、清單
    │   ├── github-auth.js  # GitHub 登入：Device Flow、token 來源與 hosts.json
    │   ├── remote.js       # 遠端倉庫：解析網址、列組織與倉庫、列 .rulesync/ 內容與 tag
    │   └── review.js       # 從遠端取得後「需要先檢視」的標記
    ├── flows/              # 每個功能一個 flow（async generator），畫面與純文字共用
    ├── ui/                 # Ink 畫面元件
    └── test/               # node --test（npm test）
```

Git 只追蹤原始檔。產生出來的檔案（`.claude/`、`.agents/`、`.codex/`、`CLAUDE.md`、`AGENTS.md`、`.mcp.json`）與 `node_modules/` 已列入 `.gitignore`；`package-lock.json` 要提交。

## 輸出路徑（以 rulesync 17.0.0 dry run 實測）

| | Claude Code | Codex CLI |
|---|---|---|
| Skills（專案） | `.claude/skills/<name>/` | `.agents/skills/<name>/` |
| Skills（全域） | `~/.claude/skills/<name>/` | `~/.agents/skills/<name>/` |
| Subagents（專案） | `.claude/agents/<name>.md` | `.codex/agents/<name>.toml` |
| Subagents（全域） | `~/.claude/agents/<name>.md` | `~/.codex/agents/<name>.toml` |
| Commands（專案） | `.claude/commands/<name>.md` | 不支援 |
| Commands（全域） | `~/.claude/commands/<name>.md` | `~/.codex/prompts/<name>.md` |
| Hooks（專案） | `.claude/settings.json` 的 `hooks` | `.codex/hooks.json` |
| Hooks（全域） | `~/.claude/settings.json` 的 `hooks` | `~/.codex/hooks.json` |
| Rules（專案） | root → `CLAUDE.md`；其他 → `.claude/rules/<name>.md` | 全部合併進 `AGENTS.md` |
| Rules（全域） | root → `~/.claude/CLAUDE.md`；其他 → `~/.claude/rules/<name>.md` | 全部合併進 `~/.codex/AGENTS.md` |
| MCP（專案） | `.mcp.json` | `.codex/config.toml` 的 `[mcp_servers.*]` |
| MCP（全域） | `~/.claude.json` 的 `mcpServers` | `~/.codex/config.toml` 的 `[mcp_servers.*]` |

產生時對既有檔案的影響（實測）：

- **Rules**：`CLAUDE.md`、`AGENTS.md` 會被**整份覆寫**。
- **MCP**：會**整段取代**既有的 MCP 伺服器清單，其他設定保留。
- **Hooks**：會**整段取代**既有的 `hooks`，其他設定保留。Codex CLI 支援的 hook 事件比 Claude Code 少，不支援的事件只會產生到 Claude Code。
- 沒有對應的原始檔（例如沒有 `.rulesync/mcp.jsonc`）時不會動到輸出檔。

「安裝到全域」會先備份這些檔案，並列出哪些既有內容會被取代。

- 全域模式下，Codex 的 skill 在 `~/.agents/skills/`，**不是** `~/.codex/skills/`；subagent 才在 `~/.codex/agents/`。
- frontmatter 中放在 `claudecode:` 區塊的欄位只會出現在 Claude Code 的輸出；`codexcli:` 區塊只會出現在 Codex 的輸出。共用欄位（`name`、`description`）兩邊都有；Codex 不支援的共用欄位（例如 `user-invocable`）會被拿掉。
- Codex 的 subagent 是 TOML，內文會轉成 `developer_instructions`。
- 以 `.` 開頭的隱藏檔（例如 `.DS_Store`、`.thumbnail`）不會被複製到輸出。
- ChatGPT 不讀本機資料夾，rulesync 也沒有對應的 target。要在 ChatGPT 網頁版或手機版使用，需另外打包成 OpenAI plugin。

## 維護規則

### 撰寫語言

- 本 repo 的文件一律使用**繁體中文**（台灣用語）撰寫，包含 README.md 與各 skill 的 CHANGELOG.md。
- CLI 的介面文字、輸出訊息與程式碼註解（包含 `rulesync.jsonc` 內的註解）也使用繁體中文。
- 程式碼、指令、檔名、frontmatter 的欄位名稱等識別字維持英文。

### 可以修改的範圍

- **只修改 `.rulesync/` 底下的原始檔**，以及 repo 自己的 README.md、cli/、rulesync.jsonc、package.json。
- **產生出來的檔案一律不要手動編輯**：`.claude/`、`.agents/`、`.codex/` 和 `~/` 底下的對應目錄。下次產生就會被覆蓋。
- 不要直接寫入全域目錄，一律透過「安裝到全域」。由 AI 工具代為操作時，必須先取得使用者同意。
- 「清理輸出」（`--delete`）會刪除所有非本 repo 管理的項目，CLI 一定先 dry run 並要求輸入 `yes`。它只清理專案目錄，不會動到全域目錄。

### rulesync 設定注意事項

- `rulesync.jsonc` 目前開啟 `rules`、`skills`、`subagents`、`commands`、`hooks`、`mcp`。要加入 `permissions` 等其他功能前，先用「預覽產生」確認會寫出哪些檔案。
- 更新 `.gitignore` 請用選單的「更新 .gitignore」。直接執行沒限定 `-t`／`-f` 的 `rulesync gitignore`，會把所有工具、所有功能的檔案（包含 `**/CLAUDE.md`、`**/AGENTS.md`）都列入忽略。

## SOP 1：新增或修改 skill／subagent

1. `npm start` → **7. 新增**（或直接編輯既有的 `.rulesync/skills/<name>/`、`.rulesync/subagents/<name>.md`）
   - frontmatter 必須有 `name` 與 `description`，且 `name` 必須與資料夾名稱（subagent 為檔名）完全一致：小寫英文、數字、連字號，最多 64 個字元
   - Claude Code 專用的欄位放在 `claudecode:` 區塊；Codex 專用的欄位放在 `codexcli:` 區塊
   - 內文避免寫死特定工具專屬的東西（特定工具名稱、`.claude/` 路徑、要求啟動 subagent 的指示）。無法避免時，要補上給其他工具的說明或替代步驟
   - 更新該 skill 的 `CHANGELOG.md`（見[版本規則](#版本規則)）
2. **1. 驗證**
3. **2. 預覽產生**
4. **3. 產生**，在本 repo 的輸出目錄試用
5. 提交：只提交 `.rulesync/` 與 repo 自己的檔案
6. 需要發布時 → **8. 發布版本**

## SOP 2：匯入既有的 Claude Code skill 並轉成 Codex 格式

> 本 repo 的 `.claude/`、`.agents/`、`.codex/` 是 rulesync 的輸出目錄（已列入 `.gitignore`）。匯入之後，真正的原始檔變成 `.rulesync/` 那一份，之後每次產生都會用它覆蓋輸出目錄。所以匯入前要先備份，匯入後只修改 `.rulesync/`。

1. 備份原檔，例如 `cp -Rp <來源專案>/.claude/skills/<name> ~/<name>.bak`
2. `npm start` → **4. 匯入**
   - 來源工具：Claude Code
   - 功能：Skills（或加上 Subagents）
   - 來源層級：專案（輸入來源專案的根目錄，留空＝本 repo）或全域（`~/.claude/`）
   - CLI 會先列出來源內容與 `.rulesync/` 裡會被覆蓋的同名項目，確認後才匯入
3. 匯入完成後 CLI 會自動驗證。依結果整理：
   - 刪除不必要的檔案（例如 `.thumbnail`、`.DS_Store`）
   - 新增 `CHANGELOG.md`
   - 檢查內文與附屬檔案是否有寫死 Claude Code 專屬的東西，必要時改寫
4. **1. 驗證** → **2. 預覽產生** → **3. 產生**
5. 比對兩邊輸出，正常情況下只有 SKILL.md 的 frontmatter 不同：`diff -r .claude/skills/<name> .agents/skills/<name>`
6. 提交 `.rulesync/skills/<name>/`
7. （選用）**6. 安裝到全域**

## SOP 3：安裝到本機的全域目錄

`npm start` → **6. 安裝到全域** → 選「安裝」。流程：驗證 → 列出會被覆蓋的同名項目 → dry run → 備份 → 確認 → 寫入。

- 備份位置：`~/.ai-toolkit-backups/<時間戳記>/`，可用同一個選項的「還原備份」復原
- 不使用 `--delete`，其他來源安裝的項目不會被動到。但同名的項目**會被覆蓋**，CLI 會先列出
- 純文字模式：`npm run install-global:dry`、`npm run install-global -- --yes`

## 版本規則

- 每個 skill 各自管理版本，tag 格式：`<skill-name>/vX.Y.Z`（例如 `speak-human-tw/v1.2.0`）
- 每個 skill 資料夾內維護自己的 `CHANGELOG.md`，最新版本放最上面。「發布版本」會讀這個版本號當預設值：

  ```markdown
  ## [1.2.0] - 2026-09-23
  ### 新增
  - ...
  ```

- 語意化版本：觸發條件或行為有不相容的變更 → MAJOR；新增功能 → MINOR；文字修正或錯誤修正 → PATCH
- 「發布版本」要求工作目錄乾淨（先 commit），建立 tag 後會問要不要推送
- CHANGELOG.md 會被當成附屬檔案一起複製到產生出來的 skill 目錄，這是預期行為
- subagent 是單一檔案，不要求 CHANGELOG.md，也不打 tag

## 在其他專案中使用這些 skill

在其他專案中操作（該專案需要有自己的 `rulesync.jsonc`）：

**方式 A：用 `fetch` 一次性取得**

```bash
# 取得全部 skill（預設 target=rulesync，會讀取 repo 的 .rulesync/skills）
rulesync fetch <org>/ai-toolkit --features skills

# 只取得指定 skill，並鎖定版本 tag
rulesync fetch <org>/ai-toolkit --features skills --skills speak-human-tw --ref speak-human-tw/v1.0.0

rulesync generate
```

取得的 skill 會寫入該專案的 `.rulesync/skills/`。私有 repo 需要設定 `GITHUB_TOKEN`／`GH_TOKEN`，或使用 `--token`。

**方式 B：宣告 `sources` + `rulesync install`（可重現，有 lockfile）**

```jsonc
// 其他專案的 rulesync.jsonc
{
  "targets": ["claudecode", "codexcli"],
  "features": ["skills"],
  "sources": [
    { "source": "<org>/ai-toolkit", "skills": ["speak-human-tw"], "path": ".rulesync/skills" }
  ]
}
```

```bash
rulesync install && rulesync generate
```

安裝的 skill 會放在 `.rulesync/skills/.curated/`，版本鎖定在 `rulesync.lock`。

> ⚠ 本 repo 還沒有推到遠端，所以 `<org>` 路徑、`path` 設定，以及含 `/` 的 tag（例如 `speak-human-tw/v1.0.0`）能否當作 `--ref` 使用，都還沒實際測試。推上去之後，請用 `rulesync fetch ... --verbose` 逐一確認，再更新這一節。
