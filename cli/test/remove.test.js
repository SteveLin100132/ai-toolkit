import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planRemoval, applyRemoval, stripTomlTable } from '../lib/remove.js';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-remove-'));
  const w = (rel, text = 'x') => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  };
  // .rulesync/ 原始檔
  w('.rulesync/skills/a/SKILL.md', '---\nname: a\ndescription: d\n---\n');
  w('.rulesync/subagents/bot.md', '---\nname: bot\ndescription: d\n---\n');
  w('.rulesync/commands/commit.md', '---\ndescription: d\n---\n');
  w('.rulesync/rules/root.md', '---\nroot: true\n---\nmain');
  w('.rulesync/rules/style.md', '---\nroot: false\n---\nstyle');
  w('.rulesync/hooks.jsonc', '{"hooks":{}}');
  w('.rulesync/mcp.jsonc', '{"mcpServers":{}}');
  // 產生出來的輸出 + 使用者自己的東西
  w('.claude/skills/a/SKILL.md');
  w('.claude/skills/mine/SKILL.md');
  w('.agents/skills/a/SKILL.md');
  w('.claude/agents/bot.md');
  w('.claude/agents/other.md');
  w('.codex/agents/bot.toml');
  w('.claude/commands/commit.md');
  w('.claude/rules/style.md');
  w('CLAUDE.md');
  w('AGENTS.md');
  w('.claude/settings.json', JSON.stringify({ permissions: { allow: [] }, hooks: { PreToolUse: [] } }));
  w('.codex/hooks.json', '{}');
  w('.mcp.json', JSON.stringify({ mcpServers: { x: {} } }));
  w('.codex/config.toml', 'model = "o3"\n\n[mcp_servers.x]\ncommand = "npx"\n\n[mcp_servers.x.env]\nA = "1"\n\n[other]\nk = 1\n');
  return { root, sourceRoot: path.join(root, '.rulesync') };
}

test('planRemoval：只列對得上 .rulesync/ 項目的輸出，混用檔案標為 strip', () => {
  const { root, sourceRoot } = setup();
  const plan = planRemoval({ targets: ['claudecode', 'codexcli'], features: ['skills', 'subagents', 'commands', 'rules', 'hooks', 'mcp'], root, sourceRoot });
  const rel = (p) => path.relative(root, p);
  const byAction = (a) => plan.filter((s) => s.action === a).map((s) => rel(s.path)).sort();
  assert.deepEqual(byAction('delete'), ['.agents/skills/a', '.claude/agents/bot.md', '.claude/commands/commit.md', '.claude/rules/style.md', '.claude/skills/a', '.codex/agents/bot.toml', '.codex/hooks.json', 'AGENTS.md', 'CLAUDE.md']);
  assert.deepEqual(byAction('strip'), ['.claude/settings.json', '.codex/config.toml', '.mcp.json']);
  // 使用者自己的 skill／subagent 不在計畫裡
  assert.ok(!plan.some((s) => rel(s.path).includes('mine') || rel(s.path).includes('other')));
});

test('planRemoval：沒有原始檔的單一輸出不動（不是我們產生的）', () => {
  const { root, sourceRoot } = setup();
  fs.rmSync(path.join(sourceRoot, 'hooks.jsonc'));
  fs.rmSync(path.join(sourceRoot, 'rules'), { recursive: true });
  const plan = planRemoval({ targets: ['claudecode', 'codexcli'], features: ['hooks', 'rules'], root, sourceRoot });
  assert.deepEqual(plan, []);
});

test('applyRemoval：刪檔、拿掉區段、空目錄一併清掉，其他設定保留', () => {
  const { root, sourceRoot } = setup();
  const plan = planRemoval({ targets: ['claudecode', 'codexcli'], features: ['skills', 'subagents', 'commands', 'rules', 'hooks', 'mcp'], root, sourceRoot });
  const r = applyRemoval(plan, { root });
  assert.equal(r.skipped.length, 0);
  const exists = (rel) => fs.existsSync(path.join(root, rel));
  assert.equal(exists('.claude/skills/a'), false);
  assert.equal(exists('.claude/skills/mine/SKILL.md'), true);
  assert.equal(exists('.claude/agents/other.md'), true);
  assert.equal(exists('.claude/commands'), false); // commands/ 空了就一併刪
  assert.equal(exists('.agents'), false);
  assert.equal(exists('CLAUDE.md'), false);
  assert.equal(exists('.codex/hooks.json'), false);
  assert.equal(exists('.codex/agents'), false);
  // settings.json 保留 permissions，拿掉 hooks
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8')), { permissions: { allow: [] } });
  // .mcp.json 只剩 mcpServers → 整個刪掉
  assert.equal(exists('.mcp.json'), false);
  const toml = fs.readFileSync(path.join(root, '.codex/config.toml'), 'utf8');
  assert.match(toml, /model = "o3"/);
  assert.match(toml, /\[other\]/);
  assert.doesNotMatch(toml, /mcp_servers/);
  assert.equal(exists('.rulesync/skills/a/SKILL.md'), true); // 原始檔不動
});

test('stripTomlTable：拿掉 [t.*] 與 [[t.*]]，到下一個別的標頭為止', () => {
  const text = 'a = 1\n[mcp_servers.x]\nc = 1\n[[mcp_servers.y]]\nd = 2\n[keep]\ne = 3\n[mcp_servers]\nf = 4\n';
  assert.equal(stripTomlTable(text, 'mcp_servers'), 'a = 1\n[keep]\ne = 3\n');
});
