import chalk from 'chalk';
import { color, level as levels } from './theme.js';
import { drive } from './driver.js';
import { byId } from './flows/index.js';
import { loadConfig, MISSING_CONFIG } from './lib/config.js';

// 純文字模式：給 CI、npm scripts 與 AI 工具用。沒有互動，遇到要問的問題就用預設值或參數，
// 需要確認的動作沒有 --yes 就中止。
const HELP = `用法：node cli/index.js [指令] [參數]

不帶指令會進入互動式介面。

指令：
  validate                       驗證 .rulesync/ 原始檔
  generate [--dry-run]           產生（或預覽）專案輸出
  install-global [--dry-run] [--yes]
                                 安裝到 ~/.claude、~/.agents、~/.codex（會備份）
  doctor                         rulesync doctor
  gitignore                      更新 .gitignore
  clean [--yes]                  generate --delete（先 dry run）
  fetch <來源> [--features a,b] [--ref r] [--path p] [--skills a,b]
        [--conflict overwrite|skip] [--no-prune] [--token t] [--yes]
                                 從 GitHub 倉庫取得 skill／subagent／command 到 .rulesync/
                                 token 依序找：--token → GITHUB_TOKEN → GH_TOKEN → 登入資訊 → gh
  login [--token-from gh|env]    登入 GitHub（純文字模式不開瀏覽器，只能借用 gh 或環境變數）
  logout [--yes]                 刪除本機的登入資訊
  repos [--org <組織>]           列出登入帳號能存取的倉庫（一行一個 owner/repo）
  docs [文件識別碼]              列出或印出 rulesync 內建文件
  docs --search <關鍵字>         全文搜尋文件

共用參數：
  -t, --targets <a,b>            限定工具（預設照 rulesync.jsonc）
  -f, --features <a,b>           限定功能（預設照 rulesync.jsonc）
  -y, --yes                      略過確認（備份照做）
  -h, --help                     顯示說明

匯入、新增、發布版本只提供互動式介面。
`;

export function parseArgs(argv) {
  const args = { _: [], dryRun: false, yes: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--targets' || a === '-t') args.targets = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--features' || a === '-f') args.features = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--ref') args.ref = argv[++i] ?? '';
    else if (a === '--path') args.path = argv[++i] ?? '';
    else if (a === '--skills') args.skills = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--conflict') args.conflict = argv[++i] ?? 'overwrite';
    else if (a === '--no-prune') args.prune = false;
    // --token 會留在 shell history，建議改用環境變數 GITHUB_TOKEN
    else if (a === '--token') args.token = argv[++i] ?? '';
    else if (a === '--token-from') args.tokenFrom = argv[++i] ?? '';
    else if (a === '--org') args.org = argv[++i] ?? '';
    else if (a === '--search') args.search = argv[++i] ?? '';
    else if (a.startsWith('-')) throw new Error(`不認得的參數：${a}`);
    else args._.push(a);
  }
  return args;
}

const HEADLESS = {
  validate: (a) => byId.validate.start(),
  // 產生本來不用確認（yes: true）；「尚未檢視的遠端項目」則要明確帶 --yes 才會略過確認
  generate: (a) => byId.generate.start({ dryRun: a.dryRun, yes: true, reviewYes: a.yes, preset: a.preset }),
  'install-global': (a) => byId['install-global'].start({ mode: a.dryRun ? 'dry' : 'install', yes: a.yes, preset: a.preset }),
  doctor: () => byId.doctor.start(),
  gitignore: () => byId.gitignore.start(),
  clean: (a) => byId.clean.start({ yes: a.yes, preset: a.preset }),
  fetch: (a) => byId.fetch.start({
    yes: a.yes,
    preset: {
      source: a._[1], features: a.features ?? ['skills'], ref: a.ref ?? '', path: a.path ?? '',
      skills: a.skills ?? [], conflict: a.conflict ?? 'overwrite', prune: a.prune ?? true,
      token: a.token || null,
    },
  }),
  login: (a) => byId.login.start({ yes: true, preset: { tokenFrom: a.tokenFrom || undefined } }),
  logout: (a) => byId.logout.start({ yes: a.yes }),
  docs: (a) => byId.docs.start({ preset: a.search ? { search: a.search } : { doc: a._[1] ?? '' } }),
};

// repos：不走 flow，直接印 owner/repo 給腳本用
async function listReposHeadless(args) {
  const { resolveToken } = await import('./lib/github-auth.js');
  const { listOrgs, listRepos } = await import('./lib/remote.js');
  const auth = await resolveToken({ explicit: args.token || null });
  if (!auth) {
    process.stderr.write(chalk.hex(color.danger)('找不到 GitHub token：請設定 GITHUB_TOKEN，或先執行 login\n'));
    return 2;
  }
  if (auth.method !== 'device') {
    process.stderr.write(chalk.hex(color.warning)(`! token 來自${auth.method === 'gh' ? '本機 gh' : '環境變數／參數'}，不是本 CLI 的 GitHub App，倉庫清單只會列出這個 App 已安裝的範圍\n`));
  }
  try {
    const orgs = await listOrgs({ token: auth.token });
    const targets = args.org ? orgs.filter((o) => o.login.toLowerCase() === args.org.toLowerCase()) : orgs;
    if (args.org && targets.length === 0) {
      process.stderr.write(chalk.hex(color.danger)(`${args.org} 尚未安裝這個 GitHub App\n`));
      return 1;
    }
    for (const o of targets) {
      const { repos, hint } = await listRepos({ token: auth.token, owner: o.login, installationId: o.installationId });
      for (const r of repos) process.stdout.write(`${r.fullName}\n`);
      if (hint) process.stderr.write(chalk.hex(color.warning)(`! ${hint}\n`));
    }
    return 0;
  } catch (err) {
    process.stderr.write(chalk.hex(color.danger)(`${err.message}\n`));
    return 1;
  }
}

export function printHelp() {
  process.stdout.write(HELP);
}

export async function runHeadless(args) {
  const command = args._[0];
  if (command === 'fetch' && !args._[1]) {
    process.stderr.write(chalk.hex(color.danger)('fetch 需要指定來源，例如 fetch anthropics/skills\n'));
    return 2;
  }
  if (command === 'repos') return listReposHeadless(args);
  if (command === 'docs' && !args._[1] && !args.search) {
    // 沒給識別碼：直接列出清單
    const { runCommand, rulesync } = await import('./lib/run.js');
    const spec = rulesync(['docs']);
    const r = await runCommand(spec.cmd, spec.args, { onLine: (l) => process.stdout.write(l + '\n') });
    return r.code;
  }
  if (!HEADLESS[command]) {
    process.stderr.write(chalk.hex(color.danger)(`不支援的指令：${command}\n\n`));
    printHelp();
    return 2;
  }
  // 純文字模式不問問題：沒給參數就照 rulesync.jsonc。login／logout／fetch／docs 不需要設定檔
  const config = loadConfig();
  const needsConfig = !['login', 'logout', 'docs', 'fetch'].includes(command);
  if (needsConfig && !config.exists) {
    process.stderr.write(chalk.hex(color.danger)(`${MISSING_CONFIG}\n`));
    return 2;
  }
  const preset = { targets: args.targets ?? config.targets, features: args.features ?? config.features };
  const gen = HEADLESS[command]({ ...args, preset });

  const io = {
    log: (entry) => {
      const style = levels[entry.level] ?? levels.info;
      const text = entry.level === 'title' ? chalk.bold(entry.text) : entry.text;
      process.stdout.write(chalk.hex(style.color)(style.prefix + text) + '\n');
    },
    ask: async (req) => {
      if (req.type === 'pager') {
        for (const l of req.lines) process.stdout.write(l + '\n');
        return true;
      }
      // 純文字模式不能互動：需要確認的一律當作拒絕，除非有 --yes
      if (req.type === 'confirm') {
        if (args.yes && !req.typed) return true;
        io.log({ text: `需要確認：${req.question}。純文字模式請加 --yes，或改用互動式介面`, level: 'error' });
        return false;
      }
      io.log({ text: `這個步驟需要互動（${req.question}），請改用互動式介面`, level: 'error' });
      return undefined;
    },
  };
  const result = await drive(gen, io);
  return result.ok ? 0 : 1;
}
