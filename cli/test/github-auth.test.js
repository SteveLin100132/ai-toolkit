import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  maskToken, readHosts, saveLogin, saveRemote, clearLogin, getLogin, resolveToken, resolveTokens, envToken,
  requestDeviceCode, pollForToken, explainStatus, GitHubError,
} from '../lib/github-auth.js';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tk-auth-')), 'sub', 'hosts.json');

test('maskToken 只顯示前綴與前 4 碼', () => {
  assert.equal(maskToken('gho_abcdefghijklmnop'), 'gho_abcd****');
  assert.equal(maskToken('github_pat_ABCDEFG'), 'github_pat_ABCD****');
  assert.equal(maskToken('xyz'), 'xyz****');
  assert.equal(maskToken(''), '');
});

test('hosts.json：建立時權限 0600、只刪該 host、remote 只由 saveRemote 寫入', () => {
  const file = tmpFile();
  assert.deepEqual(readHosts(file), {});
  saveLogin({ login: 'alice', method: 'device', token: 'gho_secret' }, file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(getLogin(file).token, 'gho_secret');
  assert.equal(getLogin(file).remote, undefined);
  saveRemote('acme/toolkit', file);
  assert.equal(getLogin(file).remote, 'acme/toolkit');
  // 重新登入保留 remote；gh 登入不存 token
  saveLogin({ login: 'alice', method: 'gh', token: 'should-not-save' }, file);
  assert.equal(getLogin(file).token, undefined);
  assert.equal(getLogin(file).remote, 'acme/toolkit');
  // 其他 host 不受影響
  const hosts = readHosts(file);
  hosts['example.com'] = { login: 'x' };
  fs.writeFileSync(file, JSON.stringify(hosts));
  assert.equal(clearLogin(file), true);
  assert.deepEqual(readHosts(file), { 'example.com': { login: 'x' } });
  assert.equal(clearLogin(file), false);
});

test('resolveToken 的順序：explicit → hosts.json（device）→ 環境變數 → 無；resolveTokens 回傳全部候選', async () => {
  const file = tmpFile();
  assert.equal(await resolveToken({ env: {}, file, allowGh: false }), null);
  saveLogin({ login: 'a', method: 'device', token: 'ghu_saved' }, file);
  assert.deepEqual(await resolveToken({ env: {}, file, allowGh: false }), { token: 'ghu_saved', method: 'device' });
  // 瀏覽器登入（GitHub App 的 token）優先於環境變數，環境變數當備援
  assert.deepEqual(await resolveTokens({ env: { GH_TOKEN: 'gh_env' }, file, allowGh: false }), [
    { token: 'ghu_saved', method: 'device' }, { token: 'gh_env', method: 'env' },
  ]);
  assert.deepEqual(await resolveToken({ env: { GITHUB_TOKEN: 'first', GH_TOKEN: 'second' }, file: tmpFile(), allowGh: false }), { token: 'first', method: 'env' });
  assert.deepEqual(await resolveToken({ explicit: 'cli', env: { GITHUB_TOKEN: 'x' }, file, allowGh: false }), { token: 'cli', method: 'explicit' });
  // hosts.json 記的是 gh／env 時不存 token，不會被拿來用
  saveLogin({ login: 'a', method: 'gh' }, file);
  assert.equal(await resolveToken({ env: {}, file, allowGh: false }), null);
  assert.equal(envToken({}), null);
});

const jsonResponse = (json, status = 200) => ({
  status,
  json: async () => json,
  text: async () => JSON.stringify(json),
  headers: new Headers(),
});

test('requestDeviceCode：沒有 client_id 就拒絕；device_flow_disabled 翻成中文', async () => {
  await assert.rejects(() => requestDeviceCode({ clientId: '' }), (e) => e instanceof GitHubError && e.code === 'no_client_id');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: init.body });
    return jsonResponse({ error: 'device_flow_disabled' });
  };
  await assert.rejects(() => requestDeviceCode({ clientId: 'abc', fetchImpl }), /Enable Device Flow/);
  assert.match(calls[0].url, /login\/device\/code$/);
  assert.match(calls[0].body, /client_id=abc/);
  // GitHub App 的權限由 App 設定決定，不帶 scope
  assert.doesNotMatch(calls[0].body, /scope=/);
});

test('CLIENT_ID 已寫死，且 explainStatus 404 提到安裝 GitHub App', async () => {
  const { CLIENT_ID } = await import('../lib/github-auth.js');
  assert.match(CLIENT_ID, /^Ov23li/);
  assert.match(explainStatus(404, 'x'), /GitHub App 尚未安裝/);
});

test('pollForToken：authorization_pending 繼續、slow_down 拉長間隔、最後拿到 token', async () => {
  const replies = [
    { error: 'authorization_pending' },
    { error: 'slow_down', interval: 10 },
    { error: 'authorization_pending' },
    { access_token: 'gho_ok', scope: 'repo', token_type: 'bearer' },
  ];
  const waits = [];
  const fetchImpl = async () => jsonResponse(replies.shift());
  const sleepImpl = async (ms) => { waits.push(ms); };
  const r = await pollForToken({ deviceCode: 'd', interval: 5, expiresIn: 900, clientId: 'abc', fetchImpl, sleepImpl });
  assert.equal(r.token, 'gho_ok');
  assert.deepEqual(waits, [5000, 5000, 10000, 10000]);
});

test('pollForToken：expired_token 與 access_denied 會丟出中文錯誤；signal 中止丟 cancelled', async () => {
  const sleepImpl = async () => {};
  await assert.rejects(
    () => pollForToken({ deviceCode: 'd', clientId: 'abc', fetchImpl: async () => jsonResponse({ error: 'expired_token' }), sleepImpl }),
    /已過期/,
  );
  await assert.rejects(
    () => pollForToken({ deviceCode: 'd', clientId: 'abc', fetchImpl: async () => jsonResponse({ error: 'access_denied' }), sleepImpl }),
    /取消了授權/,
  );
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => pollForToken({ deviceCode: 'd', clientId: 'abc', signal: ac.signal, fetchImpl: async () => jsonResponse({}) }),
    (e) => e.code === 'cancelled',
  );
});

test('explainStatus：401／403／404 翻成人話', () => {
  assert.match(explainStatus(401), /重新「登入遠端」/);
  assert.match(explainStatus(404, '讀取 a/b'), /GitHub App 尚未安裝/);
  assert.match(explainStatus(403, '', { headers: new Headers({ 'x-ratelimit-remaining': '0' }) }), /速率限制/);
  assert.match(explainStatus(403, '讀取', { headers: new Headers() }), /沒有權限/);
});
