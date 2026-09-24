import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemote, nextLink, listOrgs, listRepos, listRemoteFeatures, listSkillTags, verifyAccess, featureRoot } from '../lib/remote.js';

test('parseRemote 支援五種格式', () => {
  assert.deepEqual(parseRemote('acme/toolkit'), { owner: 'acme', repo: 'toolkit', ref: null, path: null, source: 'acme/toolkit', fullName: 'acme/toolkit' });
  assert.deepEqual(parseRemote('acme/toolkit@v1.0.0:packages/x').source, 'acme/toolkit@v1.0.0:packages/x');
  assert.equal(parseRemote('acme/toolkit@v1.0.0:packages/x').ref, 'v1.0.0');
  assert.equal(parseRemote('acme/toolkit@v1.0.0:packages/x').path, 'packages/x');
  assert.equal(parseRemote('github:acme/toolkit').fullName, 'acme/toolkit');
  assert.equal(parseRemote('https://github.com/acme/toolkit.git').fullName, 'acme/toolkit');
  const tree = parseRemote('https://github.com/acme/toolkit/tree/main/packages/x');
  assert.equal(tree.ref, 'main');
  assert.equal(tree.path, 'packages/x');
  // 含 / 的 tag
  assert.equal(parseRemote('acme/toolkit@speak-human-tw/v1.0.0').ref, 'speak-human-tw/v1.0.0');
});

test('parseRemote 拒絕非 github.com 與壞格式', () => {
  assert.throws(() => parseRemote('https://ghe.example.com/a/b'), /只支援 github\.com/);
  assert.throws(() => parseRemote('gitlab:a/b'), /只支援 github\.com/);
  assert.throws(() => parseRemote('justoneword'), /格式/);
  assert.throws(() => parseRemote('a/b@'), /ref 不能是空的/);
  assert.throws(() => parseRemote('a/b:'), /子目錄不能是空的/);
  assert.throws(() => parseRemote(''), /請輸入/);
});

test('nextLink 解析 Link 標頭', () => {
  assert.equal(nextLink('<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"'), 'https://api.github.com/x?page=2');
  assert.equal(nextLink('<https://api.github.com/x?page=1>; rel="prev"'), null);
  assert.equal(nextLink(undefined), null);
});

// 假的 fetch：依 URL 路徑回應
const fake = (routes) => {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    calls.push(u.pathname + u.search);
    const key = Object.keys(routes).find((k) => u.pathname + u.search === k || u.pathname === k);
    const r = routes[key] ?? { status: 404, json: { message: 'Not Found' } };
    return {
      status: r.status ?? 200,
      headers: new Headers(r.headers ?? {}),
      text: async () => JSON.stringify(r.json),
    };
  };
  return { fetchImpl, calls };
};

test('listOrgs：來自 /user/installations，個人帳號在最前，分頁跟著 Link 走', async () => {
  const inst = (id, login, type, sel = 'selected') => ({ id, account: { login, type }, repository_selection: sel });
  const { fetchImpl } = fake({
    '/user/installations?per_page=100': { json: { installations: [inst(2, 'acme', 'Organization', 'all')] }, headers: { link: '<https://api.github.com/user/installations?per_page=100&page=2>; rel="next"' } },
    '/user/installations?per_page=100&page=2': { json: { installations: [inst(1, 'alice', 'User'), inst(3, 'beta', 'Organization')] } },
  });
  const orgs = await listOrgs({ token: 't', fetchImpl });
  assert.deepEqual(orgs.map((o) => o.login), ['alice', 'acme', 'beta']);
  assert.equal(orgs[0].isUser, true);
  assert.equal(orgs[1].installationId, 2);
  assert.equal(orgs[1].description, '所有倉庫');
  assert.deepEqual(await listOrgs({ token: 't', fetchImpl: fake({ '/user/installations': { json: { installations: [] } } }).fetchImpl }), []);
});

test('listOrgs：一般 token 呼叫 /user/installations 回 403 時，說明要用瀏覽器登入', async () => {
  const { fetchImpl } = fake({ '/user/installations': { status: 403, json: { message: 'Resource not accessible by personal access token' } } });
  await assert.rejects(() => listOrgs({ token: 'ghp_classic', fetchImpl }), (e) => e.code === 'not_app_token' && /用瀏覽器登入 GitHub/.test(e.message));
});

test('listRepos：從安裝底下列倉庫，沒勾選倉庫時帶 hint；封存的倉庫略過', async () => {
  const repo = (name, priv, archived = false) => ({ full_name: `acme/${name}`, name, owner: { login: 'acme' }, private: priv, default_branch: 'main', archived, pushed_at: '2026-09-01T00:00:00Z' });
  const { fetchImpl, calls } = fake({ '/user/installations/2/repositories': { json: { repositories: [repo('pub', false), repo('old', false, true)] } } });
  const r = await listRepos({ token: 't', owner: 'acme', installationId: 2, fetchImpl });
  assert.deepEqual(r.repos.map((x) => x.fullName), ['acme/pub']);
  assert.equal(r.hint, null);
  assert.match(calls[0], /^\/user\/installations\/2\/repositories/);
  const { fetchImpl: f2 } = fake({ '/user/installations/2/repositories': { json: { repositories: [] } } });
  assert.match((await listRepos({ token: 't', owner: 'acme', installationId: 2, fetchImpl: f2 })).hint, /沒有勾選任何倉庫/);
});

test('verifyAccess：404 翻成人話', async () => {
  const { fetchImpl } = fake({});
  await assert.rejects(() => verifyAccess({ token: 't', owner: 'a', repo: 'b', fetchImpl }), /GitHub App 尚未安裝/);
});

test('listRemoteFeatures：依 .rulesync/ 路徑分類', async () => {
  const blob = (p) => ({ path: p, type: 'blob' });
  const { fetchImpl } = fake({
    '/repos/acme/toolkit/git/trees/HEAD': {
      json: {
        truncated: false,
        tree: [
          blob('README.md'),
          blob('.rulesync/skills/b-skill/SKILL.md'),
          blob('.rulesync/skills/a-skill/SKILL.md'),
          blob('.rulesync/skills/a-skill/CHANGELOG.md'),
          blob('.rulesync/subagents/reviewer.md'),
          blob('.rulesync/commands/git/commit.md'),
          blob('.rulesync/hooks.jsonc'),
          blob('.rulesync/rules/main.md'),
          { path: '.rulesync/skills', type: 'tree' },
        ],
      },
    },
  });
  const r = await listRemoteFeatures({ token: 't', owner: 'acme', repo: 'toolkit', fetchImpl });
  assert.deepEqual(r.skills, ['a-skill', 'b-skill']);
  assert.deepEqual(r.subagents, ['reviewer']);
  assert.deepEqual(r.commands, ['git/commit']);
  assert.deepEqual(r.rules, ['main']);
  assert.equal(r.hooks, true);
  assert.equal(r.mcp, false);
});

test('listRemoteFeatures：subPath 前綴', async () => {
  const { fetchImpl, calls } = fake({
    '/repos/acme/toolkit/git/trees/dev': { json: { tree: [{ path: 'pkg/.rulesync/skills/x/SKILL.md', type: 'blob' }, { path: '.rulesync/skills/root/SKILL.md', type: 'blob' }] } },
  });
  const r = await listRemoteFeatures({ token: 't', owner: 'acme', repo: 'toolkit', ref: 'dev', subPath: 'pkg', fetchImpl });
  assert.deepEqual(r.skills, ['x']);
  assert.match(calls[0], /recursive=1/);
});

test('listRemoteFeatures：bare 直接看路徑底下（rulesync fetch 原生語意），不進 .rulesync/', async () => {
  const blob = (p) => ({ path: p, type: 'blob' });
  const tree = [blob('skills/root-skill/SKILL.md'), blob('.rulesync/skills/hidden/SKILL.md'), blob('pkg/skills/nested/SKILL.md'), blob('pkg/subagents/bot.md')];
  const { fetchImpl } = fake({ '/repos/acme/toolkit/git/trees/HEAD': { json: { tree } } });
  const root = await listRemoteFeatures({ token: 't', owner: 'acme', repo: 'toolkit', bare: true, fetchImpl });
  assert.deepEqual(root.skills, ['root-skill']);
  const sub = await listRemoteFeatures({ token: 't', owner: 'acme', repo: 'toolkit', subPath: 'pkg', bare: true, fetchImpl });
  assert.deepEqual(sub.skills, ['nested']);
  assert.deepEqual(sub.subagents, ['bot']);
  // 預設（rulesync 專案）只看 .rulesync/
  const def = await listRemoteFeatures({ token: 't', owner: 'acme', repo: 'toolkit', fetchImpl });
  assert.deepEqual(def.skills, ['hidden']);
});

test('featureRoot：清單選的補 .rulesync，bare 照原路徑', () => {
  assert.equal(featureRoot(''), '.rulesync');
  assert.equal(featureRoot('pkg'), 'pkg/.rulesync');
  assert.equal(featureRoot('./pkg/'), 'pkg/.rulesync');
  assert.equal(featureRoot('', { bare: true }), '');
  assert.equal(featureRoot('pkg', { bare: true }), 'pkg');
});

test('listSkillTags：只留 <skill>/vX.Y.Z，新到舊', async () => {
  const { fetchImpl } = fake({
    '/repos/acme/toolkit/git/matching-refs/tags/speak-human-tw/': {
      json: [
        { ref: 'refs/tags/speak-human-tw/v1.2.0' },
        { ref: 'refs/tags/speak-human-tw/v1.10.0' },
        { ref: 'refs/tags/speak-human-tw/v0.9.0' },
        { ref: 'refs/tags/speak-human-tw/beta' },
      ],
    },
  });
  const tags = await listSkillTags({ token: 't', owner: 'acme', repo: 'toolkit', skill: 'speak-human-tw', fetchImpl });
  assert.deepEqual(tags, ['speak-human-tw/v1.10.0', 'speak-human-tw/v1.2.0', 'speak-human-tw/v0.9.0']);
});
