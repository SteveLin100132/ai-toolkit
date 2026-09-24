import {
  HOSTS_FILE, CLIENT_ID, METHOD_LABELS, installUrl, configureUrl, getLogin, saveLogin, clearLogin, hasGh, ghToken, envToken,
  requestDeviceCode, pollForToken, openBrowser, fetchUser, maskToken,
} from '../lib/github-auth.js';
import { listOrgs } from '../lib/remote.js';
import { displayPath } from '../lib/config.js';
import { log, title, blank, select, confirm, call, deviceCode } from './steps.js';

export const meta = { id: 'login', label: '登入遠端', hint: '用瀏覽器登入 GitHub（或借用本機 gh），之後「從遠端取得」不用再設 token' };
export const logoutMeta = { id: 'logout', label: '登出遠端', hint: '刪除本機儲存的 GitHub 登入' };

// 顯示目前的登入狀態，回傳 hosts.json 的項目（沒有就 null）
export function* showLoginStatus() {
  const saved = getLogin();
  if (!saved) {
    yield log('尚未登入', 'muted');
    return null;
  }
  yield log(`已以 ${saved.login} 登入（${METHOD_LABELS[saved.method] ?? saved.method}${saved.token ? `，token ${maskToken(saved.token)}` : ''}）`, 'info');
  if (saved.remote) yield log(`上次使用的倉庫：${saved.remote}`, 'muted');
  return saved;
}

// options.preset.tokenFrom：純文字模式指定 gh 或 env
export function* flow({ preset = {}, yes = false } = {}) {
  yield title('登入 GitHub');
  const saved = yield* showLoginStatus();
  if (saved && !yes && !preset.tokenFrom) {
    const again = yield select('要怎麼做？', [
      { value: 'keep', label: '保留目前的登入', hint: '回到選單' },
      { value: 'again', label: '重新登入', hint: '會覆蓋目前的登入' },
    ]);
    if (again === 'keep') return true;
  }

  // 可用的登入方式：Device Flow 永遠有；gh 與環境變數偵測到才顯示
  const ghReady = yield call(() => hasGh(), '偵測本機 gh');
  const hasEnv = Boolean(envToken());
  const options = [
    { value: 'device', label: '用瀏覽器登入 GitHub', hint: CLIENT_ID ? '會開啟 GitHub 頁面輸入登入碼（GitHub App，只讀取已安裝的倉庫）' : '尚未設定 client_id，選了會說明怎麼設定' },
  ];
  if (ghReady.ok && ghReady.value) options.push({ value: 'gh', label: '使用本機 gh 的登入', hint: '不存 token，每次向 gh 取得' });
  if (hasEnv) options.push({ value: 'env', label: '使用環境變數 GITHUB_TOKEN／GH_TOKEN', hint: '不存 token，每次讀環境變數' });

  let method = preset.tokenFrom ?? null;
  if (method && !options.some((o) => o.value === method)) {
    yield log(method === 'gh' ? '本機 gh 尚未登入 github.com（請先執行 gh auth login）' : '沒有設定 GITHUB_TOKEN 或 GH_TOKEN', 'error');
    return false;
  }
  if (!method && yes) {
    // 純文字模式不能開瀏覽器：有環境變數就用環境變數，否則用 gh
    method = hasEnv ? 'env' : ghReady.ok && ghReady.value ? 'gh' : null;
    if (!method) {
      yield log('純文字模式無法開瀏覽器登入。請設定 GITHUB_TOKEN／GH_TOKEN，或先執行 gh auth login，或改用互動式介面', 'error');
      return false;
    }
  }
  if (!method) method = yield select('要用哪種方式登入？', options);

  let token;
  if (method === 'device') {
    const req = yield call(() => requestDeviceCode(), '向 GitHub 申請登入碼');
    if (!req.ok) {
      yield log(req.error.message, 'error');
      return false;
    }
    const { deviceCode: code, userCode, verificationUri, expiresIn, interval } = req.value;
    openBrowser(verificationUri);
    yield log(`登入碼：${userCode}   網址：${verificationUri}`, 'info');
    const result = yield deviceCode({
      userCode,
      verificationUri,
      expiresIn,
      poll: (signal) => pollForToken({ deviceCode: code, interval, expiresIn, signal }),
    });
    if (!result.ok) {
      yield log(result.error?.message ?? '登入失敗', 'error');
      return false;
    }
    token = result.value.token;
    yield log(`已取得 token ${maskToken(token)}`, 'success');
  } else if (method === 'gh') {
    const r = yield call(() => ghToken(), '向 gh 取得 token');
    if (!r.ok || !r.value) {
      yield log('無法從 gh 取得 token', 'error');
      return false;
    }
    token = r.value;
  } else {
    token = envToken();
  }

  // 驗證 token、取得帳號與組織
  const user = yield call(() => fetchUser({ token }), '驗證帳號');
  if (!user.ok) {
    yield log(user.error.message, 'error');
    return false;
  }
  saveLogin({ login: user.value.login, method, token });

  yield blank();
  yield log(`已以 ${user.value.login} 登入（${METHOD_LABELS[method]}）`, 'success');
  if (method === 'device') {
    // GitHub App 的 token 只看得到 App 已安裝的帳號／組織；gh 與環境變數的 token 是一般 token，不適用安裝清單
    // 還沒安裝就順手開瀏覽器到安裝頁，裝好再讀一次，讓「從遠端取得」一進去就有清單
    let orgs = yield call(() => listOrgs({ token }), '讀取已安裝這個 App 的帳號');
    if (orgs.ok && orgs.value.length === 0 && !yes && /^https?:\/\//.test(installUrl())) {
      yield log('這個 App 還沒安裝在任何帳號或組織，「從遠端取得」的清單會是空的', 'warning');
      const go = yield confirm('要現在開啟瀏覽器安裝這個 App 嗎？（安裝時勾選要分享的倉庫）');
      if (go) {
        openBrowser(installUrl());
        yield log(`已開啟瀏覽器：${installUrl()}`, 'info');
        const done = yield confirm('在 GitHub 完成安裝後回來按確認，重新讀取清單');
        if (done) orgs = yield call(() => listOrgs({ token }), '讀取已安裝這個 App 的帳號');
      }
    }
    if (orgs.ok) {
      const names = orgs.value.map((o) => `${o.login}（${o.description}）`);
      yield log(names.length ? `已安裝這個 App 的帳號／組織：${names.join('、')}` : '這個 App 還沒安裝在任何帳號或組織，「從遠端取得」的清單會是空的', names.length ? 'info' : 'warning');
      for (const o of orgs.value.filter((x) => x.description !== '所有倉庫')) yield log(`${o.login} 勾選倉庫：${configureUrl(o)}`, 'muted');
      yield log(`要讀取某個組織的倉庫，該組織的管理員必須安裝這個 App 並勾選倉庫：${installUrl()}`, 'muted');
    } else {
      yield log(`讀取安裝清單失敗：${orgs.error.message}`, 'warning');
    }
  } else {
    yield log('這個 token 不是由本 CLI 的 GitHub App 發出，「從遠端取得」無法列倉庫清單，請用「手動輸入」或「從 Git 取得」', 'muted');
  }
  yield log(`登入資訊存在 ${displayPath(HOSTS_FILE)}${method === 'device' ? '（含 token，權限 0600）' : '（不含 token）'}`, 'muted');
  if (method === 'device') yield log(`token 只有已安裝倉庫的唯讀權限，但仍請不要把 ${displayPath(HOSTS_FILE)} 複製到別處`, 'muted');
  yield log('接下來可以用「從遠端取得」挑選倉庫', 'muted');
  return true;
}

export function* logoutFlow({ yes = false } = {}) {
  yield title('登出 GitHub');
  const saved = yield* showLoginStatus();
  if (!saved) return true;
  if (!yes) {
    const ok = yield confirm('要刪除本機的登入資訊嗎？');
    if (!ok) return false;
  }
  clearLogin();
  yield log(`已刪除 ${displayPath(HOSTS_FILE)} 裡 github.com 的登入`, 'success');
  if (saved.method === 'device') yield log('這不會撤銷 GitHub 端的授權。要撤銷請到 GitHub → Settings → Applications → Authorized OAuth Apps', 'muted');
  return true;
}
