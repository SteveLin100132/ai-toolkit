import fs from 'node:fs';
import { FEATURES, KIND_FEATURE, FETCHABLE_FEATURES, SOURCE_ROOT, displayPath } from '../lib/config.js';
import { rulesync } from '../lib/run.js';
import { listAll } from '../lib/inventory.js';
import { resolveToken, getLogin, saveRemote, METHOD_LABELS, GitHubError, installUrl } from '../lib/github-auth.js';
import { parseRemote, listOrgs, listRepos, verifyAccess, hasRulesyncDir, listRemoteFeatures, listSkillTags } from '../lib/remote.js';
import { markReview, REVIEW_FEATURES } from '../lib/review.js';
import { log, title, blank, select, multiselect, confirm, text, run, call } from './steps.js';
import { validateStep } from './shared.js';
import { flow as loginFlow } from './login.js';

export const meta = { id: 'fetch', label: '從 Git 取得', hint: '輸入 GitHub 倉庫，抓 skill／subagent／command 到 .rulesync/（rulesync fetch）' };
export const remoteMeta = { id: 'fetch:remote', label: '從遠端取得', hint: '登入後從清單挑倉庫與項目，再抓到 .rulesync/' };

const fetchable = () => Object.entries(FEATURES).filter(([value]) => FETCHABLE_FEATURES.includes(value));

// 挑倉庫：上次使用 → 組織 → 倉庫清單（可過濾）→ 手動輸入。回傳 parseRemote 的結果
function* pickRepo({ token, method }) {
  const saved = getLogin();
  const first = [];
  if (saved?.remote) first.push({ value: 'last', label: `上次使用：${saved.remote}` });
  const how = yield select('要從哪個倉庫取得？', [
    ...first,
    {
      value: 'list',
      label: '從清單選',
      hint: method === 'device' ? '列出這個 GitHub App 已安裝的帳號、組織與倉庫' : `目前的 token 來自${METHOD_LABELS[method]}，清單只會列出 GitHub App 已安裝的範圍`,
    },
    { value: 'manual', label: '手動輸入', hint: 'owner/repo、owner/repo@ref:path 或網址' },
  ]);
  if (how === 'last') return parseRemote(saved.remote);
  if (how === 'manual') return yield* askSource();

  // GitHub App 的清單 = App 已安裝的帳號／組織
  const orgs = yield call(() => listOrgs({ token }), '讀取已安裝這個 App 的帳號');
  if (!orgs.ok) {
    yield log(orgs.error.message, 'error');
    return null;
  }
  if (orgs.value.length === 0) {
    yield log(`這個 GitHub App 還沒安裝在任何帳號或組織（安裝：${installUrl()}），改用手動輸入`, 'warning');
    return yield* askSource();
  }
  const org = yield select('哪個帳號或組織？', orgs.value.map((o) => ({
    value: o.login, label: o.login, hint: `${o.isUser ? '個人帳號' : '組織'}，${o.description}`,
  })));
  const owner = orgs.value.find((o) => o.login === org);
  const repos = yield call(() => listRepos({ token, owner: org, installationId: owner.installationId }), `讀取 ${org} 的倉庫`);
  if (!repos.ok) {
    yield log(repos.error.message, 'error');
    return null;
  }
  let { repos: list } = repos.value;
  if (repos.value.hint) yield log(repos.value.hint, 'warning');
  if (repos.value.truncated) yield log('倉庫超過 500 個，只列出最近更新的 500 個；找不到請用手動輸入', 'warning');
  if (list.length === 0) {
    yield log(`${org} 底下沒有可存取的倉庫，改用手動輸入`, 'warning');
    return yield* askSource();
  }
  if (list.length > 50) {
    const kw = yield text(`共 ${list.length} 個倉庫，輸入關鍵字過濾（留空＝全部）`, { initial: '' });
    const k = kw.trim().toLowerCase();
    if (k) list = list.filter((r) => r.fullName.toLowerCase().includes(k) || r.description.toLowerCase().includes(k));
    if (list.length === 0) {
      yield log('沒有符合的倉庫，改用手動輸入', 'warning');
      return yield* askSource();
    }
  }
  const picked = yield select('哪個倉庫？', [
    ...list.map((r) => ({
      value: r.fullName,
      label: r.fullName,
      hint: `${r.private ? '私有' : '公開'}${r.updatedAt ? `，更新於 ${r.updatedAt.slice(0, 10)}` : ''}${r.description ? `，${r.description.slice(0, 40)}` : ''}`,
    })),
    { value: '__manual', label: '不在清單裡，手動輸入' },
  ]);
  if (picked === '__manual') return yield* askSource();
  return parseRemote(picked);
}

function* askSource(initial = '') {
  const s = yield text('來源（owner/repo、owner/repo@ref:path 或完整 URL）', {
    initial,
    placeholder: 'anthropics/skills',
    validate: (v) => {
      try {
        parseRemote(v);
        return null;
      } catch (e) {
        return e.message;
      }
    },
  });
  return parseRemote(s);
}

// options：純文字模式可先給 preset { source, features, ref, path, skills, conflict, prune, token }
// remote：從選單「從遠端取得」進來，會先登入、挑倉庫、列清單
export function* flow({ preset = {}, yes = false, remote = false } = {}) {
  // token：--token → 環境變數 → 瀏覽器登入存的 → gh
  let auth = yield call(() => resolveToken({ explicit: preset.token ?? null }), '尋找 GitHub token');
  auth = auth.ok ? auth.value : null;

  if (remote && !auth) {
    yield log('「從遠端取得」需要先登入 GitHub', 'warning');
    const go = yes ? false : yield confirm('要現在登入嗎？');
    if (!go) return false;
    const ok = yield* loginFlow({});
    if (!ok) return false;
    const again = yield call(() => resolveToken(), '尋找 GitHub token');
    auth = again.ok ? again.value : null;
    if (!auth) return false;
    yield blank();
    yield title('從遠端取得');
  }

  // 來源
  let parsed;
  try {
    if (preset.source) parsed = parseRemote(preset.source);
    else if (remote) parsed = yield* pickRepo(auth);
    else parsed = yield* askSource();
  } catch (e) {
    yield log(e.message, 'error');
    return false;
  }
  if (!parsed) return false;

  // 確認讀得到（有 token 才驗，沒 token 的公開倉庫交給 rulesync）
  let info = null;
  if (auth) {
    const r = yield call(() => verifyAccess({ token: auth.token, owner: parsed.owner, repo: parsed.repo }), `確認 ${parsed.fullName}`);
    if (!r.ok) {
      yield log(r.error.message, 'error');
      if (r.error instanceof GitHubError && r.error.status === 401) yield log('請執行「登入遠端」重新登入', 'muted');
      return false;
    }
    info = r.value;
    yield log(`${parsed.fullName}（${info.private ? '私有' : '公開'}，預設分支 ${info.defaultBranch}）`, 'success');
    if (remote) saveRemote(parsed.fullName);
  } else {
    yield log('沒有找到 GitHub token；公開倉庫可以繼續，私有倉庫請先「登入遠端」', 'warning');
  }

  // ref 與子目錄
  let ref = preset.ref ?? parsed.ref ?? '';
  let subPath = preset.path ?? parsed.path ?? '';
  let remoteList = null;
  if (remote && auth) {
    // 清單模式：先看遠端有什麼，再決定要什麼
    if (!parsed.ref && preset.ref === undefined) {
      const which = yield select('要取得哪個版本？', [
        { value: '', label: `預設分支（${info?.defaultBranch ?? 'HEAD'}）` },
        { value: '__input', label: '輸入分支、tag 或 commit' },
      ]);
      ref = which === '__input' ? (yield text('分支、tag 或 commit', { initial: '' })).trim() : '';
    }
    if (!parsed.path && preset.path === undefined) {
      const has = yield call(() => hasRulesyncDir({ token: auth.token, owner: parsed.owner, repo: parsed.repo, ref: ref || undefined }), '檢查 .rulesync/');
      if (has.ok && !has.value) {
        yield log(`${parsed.fullName} 的根目錄沒有 .rulesync/`, 'warning');
        const p = yield text('.rulesync/ 所在的子目錄（留空＝根目錄，會照 rulesync 預設位置找）', { initial: '' });
        subPath = p.trim();
      }
    }
    const listed = yield call(() => listRemoteFeatures({ token: auth.token, owner: parsed.owner, repo: parsed.repo, ref: ref || undefined, subPath: subPath || undefined }), '列出遠端內容');
    if (listed.ok) {
      remoteList = listed.value;
      if (remoteList.truncated) yield log('遠端檔案樹太大，清單可能不完整', 'warning');
      const found = fetchable().map(([f]) => `${FEATURES[f].label} ${remoteList[f]?.length ?? 0}`).join('、');
      yield log(`遠端 .rulesync/ 內容：${found}${remoteList.hooks ? '、Hooks 1' : ''}${remoteList.rules.length ? `、Rules ${remoteList.rules.length}` : ''}`, 'info');
      if (remoteList.hooks || remoteList.rules.length || remoteList.mcp) {
        yield log('Hooks、Rules、MCP 會整份覆寫本機檔案，本 CLI 不提供取得；需要時請手動複製', 'muted');
      }
    } else {
      yield log(`列出遠端內容失敗：${listed.error.message}，改用手動輸入名稱`, 'warning');
    }
  } else if (!preset.source) {
    if (!parsed.ref) ref = yield text('分支、tag 或 commit（留空＝預設分支）', { initial: '' });
    if (!parsed.path) subPath = yield text('倉庫內的子目錄（留空＝根目錄）', { initial: '' });
  }

  // 功能
  const features = preset.features ?? (yield multiselect(
    '要取得哪些功能？',
    fetchable().map(([value, f]) => {
      const n = remoteList ? remoteList[value]?.length ?? 0 : null;
      return {
        value,
        label: f.label,
        selected: remoteList ? n > 0 : value === 'skills',
        ...(remoteList && n === 0 ? { disabled: '遠端沒有' } : {}),
        ...(remoteList && n > 0 ? { hint: `${n} 個` } : {}),
      };
    }),
  ));
  if (features.length === 0) {
    yield log('至少要選一個功能', 'error');
    return false;
  }

  // skill：清單多選，或手動輸入
  let skills = preset.skills ?? null;
  if (skills === null && features.includes('skills')) {
    if (remoteList?.skills.length) {
      skills = yield multiselect('要取得哪些 skill？', remoteList.skills.map((s) => ({ value: s, label: s, selected: true })));
      if (skills.length === remoteList.skills.length) skills = []; // 全選＝不限定
      // 只選一個 skill 時可以指定版本 tag
      if (skills.length === 1 && !ref && auth) {
        const tags = yield call(() => listSkillTags({ token: auth.token, owner: parsed.owner, repo: parsed.repo, skill: skills[0] }), '讀取版本 tag');
        if (tags.ok && tags.value.length) {
          ref = yield select(`${skills[0]} 要用哪個版本？`, [
            { value: '', label: '預設分支的最新內容' },
            ...tags.value.map((t) => ({ value: t, label: t })),
          ]);
        }
      }
    } else {
      const s = yield text('只取得哪些 skill？用逗號分隔（留空＝全部）', { initial: '' });
      skills = s.trim() ? s.split(',').map((x) => x.trim()).filter(Boolean) : [];
    }
  }
  if (remoteList) {
    for (const f of ['subagents', 'commands']) {
      if (features.includes(f) && remoteList[f].length) yield log(`${FEATURES[f].label} 會整批取得（rulesync 沒有限定參數）：${remoteList[f].join('、')}`, 'info');
    }
  }

  const conflict = preset.conflict ?? (yield select('.rulesync/ 已有同名項目時？', [
    { value: 'overwrite', label: '覆蓋', hint: '以遠端為準（預設）' },
    { value: 'skip', label: '略過', hint: '保留本機的版本，也不會清理 skill 目錄' },
  ]));

  let prune = preset.prune ?? true;
  if (preset.prune === undefined && conflict === 'overwrite' && features.includes('skills')) {
    prune = yield select('是否清理取得的 skill 目錄？', [
      { value: true, label: '清理（預設）', hint: '刪除遠端已經沒有的檔案，包含您自己加進去的' },
      { value: false, label: '不清理（--no-prune）', hint: '只新增與覆蓋，不刪除' },
    ]);
  }

  // 列出會被影響的本機項目
  const existing = listAll();
  const affected = existing.filter((i) => {
    const f = KIND_FEATURE[i.kind];
    if (!features.includes(f)) return false;
    if (f === 'skills' && skills?.length) return skills.includes(i.name);
    return true;
  });
  // 來源裡的 @ref 與 :path 已拆到 ref／subPath，用 --ref／--path 傳
  const source = parsed.fullName;
  yield blank();
  yield title('摘要');
  yield log(`來源：${source}${ref ? ` @${ref}` : ''}${subPath ? ` :${subPath}` : ''}`, 'info');
  yield log(`功能：${features.map((f) => FEATURES[f].label).join('、')}${skills?.length ? `，限定 skill：${skills.join('、')}` : ''}`, 'info');
  yield log(`寫入：${displayPath(SOURCE_ROOT)}/，同名時${conflict === 'overwrite' ? '覆蓋' : '略過'}${prune && conflict === 'overwrite' ? '，並清理 skill 目錄' : ''}`, 'info');
  if (affected.length && conflict === 'overwrite') {
    yield log(`本機已有這些項目，若遠端同名會被覆蓋：${affected.map((i) => i.name).join('、')}`, 'warning');
  }
  yield log(auth ? `驗證：${METHOD_LABELS[auth.method]}（用環境變數 GITHUB_TOKEN 交給 rulesync，不會出現在指令裡）` : '驗證：無（僅限公開倉庫）', 'muted');
  if (features.some((f) => REVIEW_FEATURES.includes(f))) {
    yield log('Subagent 與 command 一產生就會在您的機器上生效，取得後會要求先檢視再「產生」', 'warning');
  }
  yield blank();

  if (!yes) {
    const ok = yield confirm('確定要取得嗎？', { danger: affected.length > 0 && conflict === 'overwrite' });
    if (!ok) return false;
  }

  const args = ['fetch', source, '--features', features.join(',')];
  if (ref.trim()) args.push('--ref', ref.trim());
  if (subPath.trim()) args.push('--path', subPath.trim());
  if (skills?.length) args.push('--skills', skills.join(','));
  args.push('--conflict', conflict);
  if (!prune) args.push('--no-prune');

  const before = new Map(existing.map((i) => [i.file, mtime(i.file)]));
  const { code } = yield run(rulesync(args, { env: auth ? { GITHUB_TOKEN: auth.token } : {} }));
  if (code !== 0) {
    yield log(`rulesync 結束代碼 ${code}`, 'error');
    if (!auth) yield log('若這是私有倉庫，請先「登入遠端」', 'muted');
    return false;
  }

  yield blank();
  yield title('取得結果');
  const after = listAll();
  const added = after.filter((i) => !before.has(i.file));
  const changed = after.filter((i) => before.has(i.file) && before.get(i.file) !== mtime(i.file));
  for (const i of added) yield log(`新增 ${i.kind} ${i.name}（${i.files.length} 個檔案）`, 'success');
  for (const i of changed) yield log(`更新 ${i.kind} ${i.name}`, 'success');
  if (added.length + changed.length === 0) yield log('沒有新增或更新的項目（可能是略過既有項目，或內容相同）', 'muted');

  // subagent／command 取回來就是可執行的設定：標記為需要檢視，「產生」會先 dry run 再確認
  const review = markReview({
    source: `${parsed.fullName}${ref ? `@${ref}` : ''}`,
    items: [...added, ...changed].map((i) => ({ feature: KIND_FEATURE[i.kind], name: i.name })),
  });
  if (review) {
    yield log(`已標記 ${review.items.length} 個項目需要檢視（${displayPath(SOURCE_ROOT)}/.needs-review.json）。下次「產生」會先 dry run 並要求確認`, 'warning');
  }
  yield blank();
  yield* validateStep({ features });
  yield blank();
  yield log('接下來：檢視取得的內容、補 CHANGELOG.md，然後執行「預覽產生」', 'muted');
  return true;
}

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}
