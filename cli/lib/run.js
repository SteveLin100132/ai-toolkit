import { spawn } from 'node:child_process';
import { ROOT, RULESYNC_BIN } from './config.js';

// 執行外部指令，逐行回傳輸出。回傳 { code, lines }。
export function runCommand(cmd, args, { cwd = ROOT, env = {}, onLine } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = [];
    let buffer = '';
    const push = (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line.trim() === '') continue;
        lines.push(line);
        onLine?.(line);
      }
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (err) => {
      const line = `無法執行 ${cmd}：${err.message}`;
      lines.push(line);
      onLine?.(line);
      resolve({ code: 1, lines });
    });
    child.on('close', (code) => {
      if (buffer.trim()) {
        lines.push(buffer);
        onLine?.(buffer);
      }
      resolve({ code: code ?? 1, lines });
    });
  });
}

// 給畫面顯示用的指令字串（rulesync 顯示成 npx rulesync）
export function formatCommand(cmd, args) {
  const isRulesync = cmd === process.execPath && args[0] === RULESYNC_BIN;
  const name = isRulesync ? 'npx rulesync' : cmd;
  const quoted = (isRulesync ? args.slice(1) : args).map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a));
  return [name, ...quoted].join(' ');
}

// rulesync 用目前的 node 執行它的入口檔，不依賴 node_modules/.bin 的 shim 或執行權限
export const rulesync = (args, opts) => ({ cmd: process.execPath, args: [RULESYNC_BIN, ...args], ...opts });
export const git = (args, opts) => ({ cmd: 'git', args, ...opts });
