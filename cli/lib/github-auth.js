import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// GitHub 登入：token 的來源、儲存與 Device Flow。
// token 永遠不進指令參數、不印在畫面；交給 rulesync 時用環境變數 GITHUB_TOKEN 注入。

// GitHub App「AI Toolkit」的 client_id（公開識別碼，可以提交）。Device Flow 不需要 client_secret。
// 權限只有 Contents: Read-only，token 不會過期（App 設定未勾 Expire user access tokens）。
// 註冊步驟見 docs/tasks/remote-login-and-fetch/01-register-oauth-app.md。環境變數 AI_TOOLKIT_GITHUB_CLIENT_ID 可覆蓋（測試用）。
export const CLIENT_ID = process.env.AI_TOOLKIT_GITHUB_CLIENT_ID || 'Iv23libBFLDvIKpIYNy5';
// GitHub App 的 slug（安裝頁網址 https://github.com/apps/<slug>/installations/new 用）。留空就只顯示一般說明
export const APP_SLUG = process.env.AI_TOOLKIT_GITHUB_APP_SLUG || 'ai-toolkit-cli';
export const installUrl = () => (APP_SLUG ? `https://github.com/apps/${APP_SLUG}/installations/new` : 'GitHub → Settings → Applications → 安裝這個 App');
export const HOST = 'github.com';
export const API_BASE = 'https://api.github.com';
export const USER_AGENT = 'ai-toolkit';

const configHome = () => {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.config');
};
export const CONFIG_DIR = path.join(configHome(), 'ai-toolkit');
export const HOSTS_FILE = path.join(CONFIG_DIR, 'hosts.json');

// ---- hosts.json ----
// { "github.com": { login, method: "device"|"gh"|"env", token?（只有 device 才存）, remote?（上次選的倉庫）, remoteFromList?, savedAt } }

export function readHosts(file = HOSTS_FILE) {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    return json && typeof json === 'object' ? json : {};
  } catch {
    return {};
  }
}

function writeHosts(hosts, file = HOSTS_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(hosts, null, 2) + '\n', { mode: 0o600 });
  // 檔案原本就存在時 mode 參數不會生效，補一次
  fs.chmodSync(file, 0o600);
}

export function getLogin(file = HOSTS_FILE) {
  return readHosts(file)[HOST] ?? null;
}

// 用 gh 或環境變數登入的不存 token，只記住來源方式，每次重新解析
export function saveLogin({ login, method, token }, file = HOSTS_FILE) {
  const hosts = readHosts(file);
  const previous = hosts[HOST] ?? {};
  hosts[HOST] = {
    login,
    method,
    ...(method === 'device' && token ? { token } : {}),
    ...(previous.remote ? { remote: previous.remote, remoteFromList: Boolean(previous.remoteFromList) } : {}),
    savedAt: new Date().toISOString(),
  };
  writeHosts(hosts, file);
  return hosts[HOST];
}

// 記住上次在「從遠端取得」選的倉庫（owner/repo），以及是從清單選的還是手動輸入的
// （清單選的視為 rulesync 專案，抓的時候會自動帶 --path .rulesync；手動輸入照 rulesync 原生語意）
export function saveRemote(remote, { fromList = false } = {}, file = HOSTS_FILE) {
  const hosts = readHosts(file);
  if (!hosts[HOST]) return null;
  hosts[HOST] = { ...hosts[HOST], remote, remoteFromList: Boolean(fromList) };
  writeHosts(hosts, file);
  return hosts[HOST];
}

// 只刪這個 host 的項目，不刪整個檔案
export function clearLogin(file = HOSTS_FILE) {
  const hosts = readHosts(file);
  const had = HOST in hosts;
  delete hosts[HOST];
  if (had) writeHosts(hosts, file);
  return had;
}

// ---- token 解析 ----

// 只顯示前綴與前 4 碼：gho_abcd****
export function maskToken(token) {
  if (!token) return '';
  const m = /^(gh[a-z]_|github_pat_)?(.{0,4})/.exec(token);
  return `${m?.[1] ?? ''}${m?.[2] ?? ''}****`;
}

// 執行指令並回傳 stdout（失敗或逾時回傳 null）
function capture(cmd, args, { timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? out.trim() : null); });
  });
}

// 本機 gh 是否已登入 github.com
export async function hasGh() {
  const out = await capture('gh', ['auth', 'status', '--hostname', HOST, '--json', 'hosts']);
  return out !== null;
}

export async function ghToken() {
  const out = await capture('gh', ['auth', 'token', '--hostname', HOST]);
  return out || null;
}

export function envToken(env = process.env) {
  return env.GITHUB_TOKEN || env.GH_TOKEN || null;
}

// 所有找得到的 token，依優先順序：explicit（--token）→ hosts.json 的瀏覽器登入（device）→ GITHUB_TOKEN → GH_TOKEN → gh auth token。
// 瀏覽器登入排在環境變數前面：它是使用者在本 CLI 明確做的登入，而且只有它是 GitHub App 的 token，
// 「從遠端取得」列倉庫清單（/user/installations）只接受這種 token。
// 回傳 [{ token, method }]，可能是空陣列。hosts.json 記的是 gh／env 時不會存 token，照同樣的順序重新找。
export async function resolveTokens({ explicit = null, env = process.env, file = HOSTS_FILE, allowGh = true } = {}) {
  const list = [];
  if (explicit) list.push({ token: explicit, method: 'explicit' });
  const saved = getLogin(file);
  if (saved?.method === 'device' && saved.token) list.push({ token: saved.token, method: 'device' });
  const fromEnv = envToken(env);
  if (fromEnv) list.push({ token: fromEnv, method: 'env' });
  if (allowGh) {
    const t = await ghToken();
    if (t) list.push({ token: t, method: 'gh' });
  }
  return list;
}

// 第一個找得到的 token，找不到回傳 null
export async function resolveToken(opts) {
  return (await resolveTokens(opts))[0] ?? null;
}

export const METHOD_LABELS = {
  explicit: '--token 參數',
  env: '環境變數 GITHUB_TOKEN／GH_TOKEN',
  device: '瀏覽器登入',
  gh: '本機 gh 的登入',
};

// ---- GitHub API ----

export class GitHubError extends Error {
  constructor(message, { status = 0, code = null, body = null } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

// 呼叫 REST API，回傳 { status, headers, json }。401／403／404 由呼叫端翻成人話
export async function ghApi(pathname, { token, method = 'GET', query = {}, accept = 'application/vnd.github+json', fetchImpl = fetch } = {}) {
  const url = new URL(pathname.startsWith('http') ? pathname : `${API_BASE}${pathname}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const headers = {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetchImpl(url, { method, headers });
  } catch (err) {
    throw new GitHubError(`連不上 GitHub：${err.message}`, { code: 'network' });
  }
  let json = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, headers: res.headers, json };
}

// 把常見的 HTTP 狀態翻成中文，context 是「在做什麼」（例如「讀取倉庫 a/b」）
export function explainStatus(status, context, { headers } = {}) {
  if (status === 401) return 'token 無效或已被撤銷，請重新「登入遠端」';
  if (status === 403) {
    const remaining = headers?.get?.('x-ratelimit-remaining');
    if (remaining === '0') return 'GitHub API 速率限制已用完，請稍後再試';
    return `沒有權限${context ? `：${context}` : ''}（請確認這個 GitHub App 已安裝在該帳號或組織，且有勾選這個倉庫）`;
  }
  if (status === 404) return `${context ? `${context}：` : ''}倉庫不存在、沒有權限、或 GitHub App 尚未安裝在該帳號／組織並勾選這個倉庫（安裝：${installUrl()}；GitHub 對沒權限的私有倉庫一律回 404）`;
  return `GitHub 回應 ${status}${context ? `（${context}）` : ''}`;
}

// 驗證 token 並取得帳號
export async function fetchUser({ token, fetchImpl }) {
  const r = await ghApi('/user', { token, fetchImpl });
  if (r.status !== 200) throw new GitHubError(explainStatus(r.status, '讀取帳號', r), { status: r.status });
  return { login: r.json.login, name: r.json.name ?? null };
}

// ---- Device Flow ----
// 1. requestDeviceCode()：申請 user code
// 2. 畫面顯示 user code 與網址，開啟瀏覽器
// 3. pollForToken()：每 interval 秒問一次，直到拿到 token、逾時或取消

const DEVICE_CODE_URL = `https://${HOST}/login/device/code`;
const ACCESS_TOKEN_URL = `https://${HOST}/login/oauth/access_token`;

async function postForm(url, params, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: new URLSearchParams(params).toString(),
    });
  } catch (err) {
    throw new GitHubError(`連不上 GitHub：${err.message}`, { code: 'network' });
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

export const DEVICE_ERRORS = {
  device_flow_disabled: 'GitHub App 沒有啟用 Device Flow。請到 GitHub 的 App 設定勾選「Enable Device Flow」',
  incorrect_client_credentials: 'client_id 不正確。請確認 cli/lib/github-auth.js 的 CLIENT_ID（或環境變數 AI_TOOLKIT_GITHUB_CLIENT_ID）',
  incorrect_device_code: 'device code 不正確，請重新登入',
  expired_token: '登入碼已過期（15 分鐘），請重新登入',
  access_denied: '您在 GitHub 上取消了授權',
  unsupported_grant_type: 'GitHub 不接受這個授權方式（程式錯誤）',
};

// GitHub App 的權限在 App 設定裡決定，不用（也不能）帶 scope
export async function requestDeviceCode({ clientId = CLIENT_ID, fetchImpl = fetch } = {}) {
  if (!clientId) {
    throw new GitHubError('尚未設定 GitHub App 的 client_id。請先完成 docs/tasks/remote-login-and-fetch/01-register-oauth-app.md，或設定環境變數 AI_TOOLKIT_GITHUB_CLIENT_ID', { code: 'no_client_id' });
  }
  const { status, json } = await postForm(DEVICE_CODE_URL, { client_id: clientId }, fetchImpl);
  if (json.error) throw new GitHubError(DEVICE_ERRORS[json.error] ?? `GitHub 回應錯誤：${json.error}`, { status, code: json.error });
  if (status !== 200 || !json.device_code) throw new GitHubError(`申請登入碼失敗（HTTP ${status}）`, { status });
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    expiresIn: Number(json.expires_in ?? 900),
    interval: Number(json.interval ?? 5),
  };
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new GitHubError('已取消', { code: 'cancelled' })); return; }
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  function onAbort() { clearTimeout(t); reject(new GitHubError('已取消', { code: 'cancelled' })); }
  signal?.addEventListener('abort', onAbort, { once: true });
});

// 輪詢直到拿到 token。signal 中止時丟出 code 為 cancelled 的 GitHubError。
// 不會自動重新申請 device code（每個 App 每小時最多 50 次），過期就回報讓使用者重來。
export async function pollForToken({ deviceCode, interval = 5, expiresIn = 900, clientId = CLIENT_ID, signal, fetchImpl = fetch, sleepImpl = sleep } = {}) {
  const deadline = Date.now() + expiresIn * 1000;
  let wait = Math.max(1, interval);
  while (Date.now() < deadline) {
    await sleepImpl(wait * 1000, signal);
    const { status, json } = await postForm(ACCESS_TOKEN_URL, {
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }, fetchImpl);
    if (json.access_token) return { token: json.access_token, scope: json.scope ?? '', tokenType: json.token_type ?? 'bearer' };
    if (json.error === 'authorization_pending') continue;
    if (json.error === 'slow_down') {
      wait = Number(json.interval ?? wait + 5);
      continue;
    }
    throw new GitHubError(DEVICE_ERRORS[json.error] ?? `GitHub 回應錯誤：${json.error ?? status}`, { status, code: json.error ?? null });
  }
  throw new GitHubError(DEVICE_ERRORS.expired_token, { code: 'expired_token' });
}

// 嘗試開啟瀏覽器；開不了不算錯誤（畫面上有網址可以手動開）
export function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
