import { git } from '../lib/run.js';
import { listSkills } from '../lib/inventory.js';
import { log, title, blank, select, text, confirm, run } from './steps.js';

export const meta = { id: 'release', label: '發布版本', hint: '為某個 skill 打 <skill-name>/vX.Y.Z tag' };

function bump(version, kind) {
  const [ma, mi, pa] = version.split('.').map(Number);
  if (kind === 'major') return `${ma + 1}.0.0`;
  if (kind === 'minor') return `${ma}.${mi + 1}.0`;
  return `${ma}.${mi}.${pa + 1}`;
}

export function* flow() {
  const skills = listSkills();
  if (skills.length === 0) {
    yield log('沒有任何 skill', 'muted');
    return false;
  }
  const name = yield select(
    '要發布哪個 skill？',
    skills.map((s) => ({ value: s.name, label: s.name, hint: s.version ? `CHANGELOG 最新版本 v${s.version}` : '沒有 CHANGELOG.md' })),
  );
  const skill = skills.find((s) => s.name === name);

  // 工作目錄要乾淨，tag 才會對到已提交的內容
  const status = yield run(git(['status', '--porcelain']));
  if (status.lines.length > 0) {
    yield log('工作目錄有未提交的變更，請先 commit 再發布', 'error');
    return false;
  }

  const existing = yield run(git(['tag', '--list', `${name}/v*`]));
  const tags = existing.lines.map((l) => l.trim()).filter(Boolean).sort();
  yield log(tags.length ? `既有的 tag：${tags.join('、')}` : '還沒有任何 tag', 'muted');

  const current = skill.version ?? (tags.length ? tags.at(-1).split('/v')[1] : '0.0.0');
  const choice = yield select(`目前版本 v${current}，要發布哪一種版本？`, [
    { value: 'changelog', label: `照 CHANGELOG（v${skill.version ?? '？'}）`, hint: 'CHANGELOG.md 最上面的版本號' },
    { value: 'patch', label: `patch → v${bump(current, 'patch')}`, hint: '文字修正、錯誤修正' },
    { value: 'minor', label: `minor → v${bump(current, 'minor')}`, hint: '新增功能' },
    { value: 'major', label: `major → v${bump(current, 'major')}`, hint: '觸發條件或行為有不相容的變更' },
    { value: 'custom', label: '自行輸入' },
  ]);
  let version;
  if (choice === 'changelog') {
    if (!skill.version) {
      yield log('CHANGELOG.md 沒有版本號，請先補上', 'error');
      return false;
    }
    version = skill.version;
  } else if (choice === 'custom') {
    version = yield text('版本號（X.Y.Z）', { validate: (v) => (/^\d+\.\d+\.\d+$/.test(v) ? null : '格式必須是 X.Y.Z') });
  } else {
    version = bump(current, choice);
  }

  const tag = `${name}/v${version}`;
  if (tags.includes(tag)) {
    yield log(`tag ${tag} 已經存在`, 'error');
    return false;
  }
  if (skill.version && skill.version !== version) {
    yield log(`提醒：CHANGELOG.md 最新版本是 v${skill.version}，與要發布的 v${version} 不同`, 'warning');
  }

  const ok = yield confirm(`要建立 tag ${tag} 嗎？`);
  if (!ok) return false;
  const created = yield run(git(['tag', '-a', tag, '-m', `${name} v${version}`]));
  if (created.code !== 0) return false;
  yield log(`已建立 tag ${tag}`, 'success');

  yield blank();
  const push = yield confirm(`要推送 tag 到 origin 嗎？`);
  if (push) {
    const pushed = yield run(git(['push', 'origin', tag]));
    if (pushed.code === 0) yield log('已推送', 'success');
  } else {
    yield log(`之後可自行執行：git push origin ${tag}`, 'muted');
  }
  return true;
}
