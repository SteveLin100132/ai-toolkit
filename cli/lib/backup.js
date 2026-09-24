import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_ROOT, HOME } from './config.js';

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// 把 HOME 底下的目錄與檔案備份到 ~/.ai-toolkit-backups/<時間戳記>/<相對路徑>
// 回傳 { backupDir, copied: [{ from, to }], skipped: [dir] }
export function backupDirs(dirs) {
  const backupDir = path.join(BACKUP_ROOT, stamp());
  const copied = [];
  const skipped = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      skipped.push(dir);
      continue;
    }
    const rel = path.relative(HOME, dir);
    const to = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(dir, to, { recursive: true, preserveTimestamps: true });
    copied.push({ from: dir, to });
  }
  return { backupDir, copied, skipped };
}

export function listBackups() {
  if (!fs.existsSync(BACKUP_ROOT)) return [];
  return fs
    .readdirSync(BACKUP_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse()
    .map((name) => {
      const dir = path.join(BACKUP_ROOT, name);
      // 找出這個備份裡有哪些目錄與檔案（相對於 HOME，深度 2，例如 .claude/skills）
      // HOME 底下直接的檔案（例如 .claude.json）只有一層
      const contents = [];
      for (const top of fs.readdirSync(dir)) {
        const topDir = path.join(dir, top);
        if (!fs.statSync(topDir).isDirectory()) {
          contents.push(top);
          continue;
        }
        for (const sub of fs.readdirSync(topDir)) contents.push(path.join(top, sub));
      }
      return { name, dir, contents };
    });
}

// 把備份還原回 HOME（覆蓋同名檔案，不刪除備份裡沒有的檔案）
export function restoreBackup(backup) {
  const restored = [];
  for (const rel of backup.contents) {
    const from = path.join(backup.dir, rel);
    const to = path.join(HOME, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true, force: true, preserveTimestamps: true });
    restored.push({ from, to });
  }
  return restored;
}
