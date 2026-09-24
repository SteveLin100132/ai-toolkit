import { ghApi, explainStatus, GitHubError, HOST } from './github-auth.js';

// 遠端倉庫：解析使用者輸入、列出可存取的倉庫、確認權限、列出 .rulesync/ 內容。
// 只支援 github.com：rulesync 17.0.0 的 fetch 只認得 github.com 與 gitlab.com（主機名寫死在原始碼），
// GitHub Enterprise Server 目前做不到。

const UNSUPPORTED_HOST = (host) => `rulesync 17.0.0 只支援 github.com（與 gitlab.com），不支援 ${host}。GitHub Enterprise Server 要等 rulesync 開放主機設定`;
const NAME = /^[\w.-]+$/;

// 接受：owner/repo、owner/repo@ref、owner/repo:path、owner/repo@ref:path、github:owner/repo、
// https://github.com/owner/repo(.git)、https://github.com/owner/repo/tree/<ref>/<path>
// 回傳 { owner, repo, ref, path, source }，source 是交給 rulesync 的字串
export function parseRemote(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('請輸入倉庫');
  if (/^https?:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`不是有效的網址：${raw}`);
    }
    const host = url.hostname.toLowerCase();
    if (host !== HOST && host !== `www.${HOST}`) throw new Error(UNSUPPORTED_HOST(host));
    const seg = url.pathname.split('/').filter(Boolean);
    if (seg.length < 2) throw new Error(`網址缺少 owner/repo：${raw}`);
    const owner = seg[0];
    const repo = seg[1].replace(/\.git$/, '');
    let ref;
    let path;
    if (seg.length > 2 && (seg[2] === 'tree' || seg[2] === 'blob')) {
      ref = seg[3];
      path = seg.length > 4 ? seg.slice(4).join('/') : undefined;
    }
    return build(owner, repo, ref, path);
  }
  let rest = raw;
  const prefix = /^([a-z]+):(?=[\w.-]+\/)/i.exec(rest);
  if (prefix) {
    if (prefix[1].toLowerCase() !== 'github') throw new Error(UNSUPPORTED_HOST(prefix[1]));
    rest = rest.slice(prefix[0].length);
  }
  let path;
  const colon = rest.indexOf(':');
  if (colon !== -1) {
    path = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
    if (!path) throw new Error('「:」後面的子目錄不能是空的');
  }
  let ref;
  const at = rest.indexOf('@');
  if (at !== -1) {
    ref = rest.slice(at + 1);
    rest = rest.slice(0, at);
    if (!ref) throw new Error('「@」後面的 ref 不能是空的');
  }
  const parts = rest.split('/');
  if (parts.length !== 2 || !NAME.test(parts[0]) || !NAME.test(parts[1])) {
    throw new Error('格式：owner/repo、owner/repo@ref:path 或 https://github.com/owner/repo');
  }
  return build(parts[0], parts[1].replace(/\.git$/, ''), ref, path);
}

function build(owner, repo, ref, path) {
  let source = `${owner}/${repo}`;
  if (ref) source += `@${ref}`;
  if (path) source += `:${path}`;
  return { owner, repo, ref: ref ?? null, path: path ?? null, source, fullName: `${owner}/${repo}` };
}

// ---- 倉庫清單 ----

// 解析 Link 標頭裡的 rel="next"
export function nextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const m = /<([^>]+)>;\s*rel="next"/.exec(part.trim());
    if (m) return m[1];
  }
  return null;
}

// 抓完所有分頁（最多 maxPages 頁），回傳 { items, truncated }。key：回應是物件時取哪個陣列欄位
async function paginate(pathname, { token, query, maxPages = 5, key = null, context = '列出倉庫', fetchImpl }) {
  const items = [];
  let url = pathname;
  let q = { per_page: 100, ...query };
  for (let page = 0; page < maxPages && url; page += 1) {
    const r = await ghApi(url, { token, query: q, fetchImpl });
    if (r.status !== 200) throw new GitHubError(explainStatus(r.status, context, r), { status: r.status });
    const list = key ? r.json?.[key] : r.json;
    items.push(...(Array.isArray(list) ? list : []));
    url = nextLink(r.headers?.get?.('link'));
    q = {}; // next 連結已含查詢參數
  }
  return { items, truncated: Boolean(url) };
}

// GitHub App 的使用者 token 只看得到「App 已安裝的帳號／組織」及安裝時勾選的倉庫，
// 所以清單來自 /user/installations，而不是 /user/orgs。個人帳號放最前面。
// 回傳 [{ login, isUser, installationId, description }]
export const NOT_APP_TOKEN = '這個 token 不是本 CLI 的 GitHub App 發出的（例如來自環境變數 GITHUB_TOKEN／GH_TOKEN 或本機 gh），無法列出倉庫清單。請用「登入遠端」的「用瀏覽器登入 GitHub」，或改用「手動輸入」／「從 Git 取得」';

export async function listOrgs({ token, fetchImpl } = {}) {
  let items;
  try {
    ({ items } = await paginate('/user/installations', { token, fetchImpl, key: 'installations', maxPages: 2, context: '讀取已安裝的帳號' }));
  } catch (e) {
    // /user/installations 只接受 GitHub App 的 user token，一般 token 會回 403
    if (e instanceof GitHubError && e.status === 403) throw new GitHubError(NOT_APP_TOKEN, { status: 403, code: 'not_app_token' });
    throw e;
  }
  const list = items
    .filter((i) => i.account?.login)
    .map((i) => ({
      login: i.account.login,
      isUser: i.account.type === 'User',
      installationId: i.id,
      description: i.repository_selection === 'all' ? '所有倉庫' : '只有勾選的倉庫',
    }));
  return list.sort((a, b) => Number(b.isUser) - Number(a.isUser) || a.login.localeCompare(b.login));
}

const repoSummary = (r) => ({
  fullName: r.full_name,
  owner: r.owner?.login,
  name: r.name,
  private: Boolean(r.private),
  defaultBranch: r.default_branch,
  description: r.description ?? '',
  updatedAt: r.pushed_at ?? r.updated_at ?? null,
  archived: Boolean(r.archived),
});

// 列某個安裝（帳號／組織）底下 App 有權限的倉庫。安裝時沒勾選的倉庫不會出現，所以回傳值帶 hint
export async function listRepos({ token, owner, installationId, fetchImpl } = {}) {
  const { items, truncated } = await paginate(`/user/installations/${encodeURIComponent(installationId)}/repositories`, {
    token, fetchImpl, key: 'repositories', context: `列出 ${owner} 的倉庫`,
  });
  const repos = items.map(repoSummary).filter((r) => !r.archived).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const hint = repos.length === 0
    ? `${owner} 安裝這個 App 時沒有勾選任何倉庫。請到 GitHub → Settings → Applications → 這個 App → Configure 勾選倉庫`
    : null;
  return { repos, truncated, hint };
}

// ---- 單一倉庫 ----

export async function verifyAccess({ token, owner, repo, fetchImpl } = {}) {
  const r = await ghApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { token, fetchImpl });
  if (r.status !== 200) throw new GitHubError(explainStatus(r.status, `讀取 ${owner}/${repo}`, r), { status: r.status });
  return repoSummary(r.json);
}

// feature 目錄的根：rulesync 專案是 <subPath>/.rulesync/；bare 是 <subPath>/ 本身
// （rulesync fetch 的語意：直接在指定路徑底下找 skills/、subagents/…，不會自己進 .rulesync/）
export function featureRoot(subPath, { bare = false } = {}) {
  return [subPath, bare ? null : '.rulesync'].filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\.\//, '');
}

// 倉庫（或子目錄）底下有沒有 .rulesync/
export async function hasRulesyncDir({ token, owner, repo, ref, subPath, fetchImpl } = {}) {
  const dir = featureRoot(subPath);
  const r = await ghApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${dir}`, { token, query: { ref }, fetchImpl });
  if (r.status === 200) return true;
  if (r.status === 404) return false;
  throw new GitHubError(explainStatus(r.status, `讀取 ${owner}/${repo} 的 ${dir}`, r), { status: r.status });
}

// 列出遠端各類 feature 的項目：預設看 <subPath>/.rulesync/，bare 直接看 <subPath>/。
// 一次抓整棵樹（recursive），檢查 truncated。回傳 { skills, subagents, commands, hooks, rules, truncated }
export async function listRemoteFeatures({ token, owner, repo, ref, subPath, bare = false, fetchImpl } = {}) {
  const treeRef = ref || 'HEAD';
  const r = await ghApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(treeRef)}`, { token, query: { recursive: 1 }, fetchImpl });
  if (r.status !== 200) throw new GitHubError(explainStatus(r.status, `讀取 ${owner}/${repo} 的檔案樹（${treeRef}）`, r), { status: r.status });
  const root = featureRoot(subPath, { bare });
  const prefix = root ? `${root}/` : '';
  const result = { skills: [], subagents: [], commands: [], rules: [], hooks: false, mcp: false, truncated: Boolean(r.json.truncated) };
  for (const entry of r.json.tree ?? []) {
    if (entry.type !== 'blob' || !entry.path.startsWith(prefix)) continue;
    const rel = entry.path.slice(prefix.length);
    let m;
    if ((m = /^skills\/([^/]+)\/SKILL\.md$/.exec(rel))) result.skills.push(m[1]);
    else if ((m = /^subagents\/([^/]+)\.md$/.exec(rel))) result.subagents.push(m[1]);
    else if ((m = /^commands\/(.+)\.md$/.exec(rel))) result.commands.push(m[1]);
    else if ((m = /^rules\/([^/]+)\.md$/.exec(rel))) result.rules.push(m[1]);
    else if (/^hooks\.jsonc?$/.test(rel)) result.hooks = true;
    else if (/^mcp\.jsonc?$/.test(rel)) result.mcp = true;
  }
  for (const k of ['skills', 'subagents', 'commands', 'rules']) result[k].sort();
  return result;
}

// 某個 skill 的版本 tag：<skill>/vX.Y.Z，新到舊
export async function listSkillTags({ token, owner, repo, skill, fetchImpl } = {}) {
  const r = await ghApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/matching-refs/tags/${encodeURIComponent(skill)}/`, { token, fetchImpl });
  if (r.status !== 200) throw new GitHubError(explainStatus(r.status, `讀取 ${owner}/${repo} 的 tag`, r), { status: r.status });
  const tags = (r.json ?? [])
    .map((t) => t.ref?.replace(/^refs\/tags\//, ''))
    .filter((t) => t && new RegExp(`^${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/v\\d+\\.\\d+\\.\\d+$`).test(t));
  const ver = (t) => t.split('/v')[1].split('.').map(Number);
  return tags.sort((a, b) => {
    const [x, y] = [ver(a), ver(b)];
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
  });
}
