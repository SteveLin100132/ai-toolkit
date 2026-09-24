// 只讀取 frontmatter 最上層（沒有縮排）的欄位，不做完整 YAML 解析。
// 多行寫法（>-、|）取第一行縮排內容，足以判斷是否為空。
export function readFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const body = lines.slice(1, end);
  const fields = {};
  const topLevel = [];
  for (let i = 0; i < body.length; i += 1) {
    const line = body[i];
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    topLevel.push(key);
    if (value === '' || /^[>|][-+]?$/.test(value)) {
      // 多行或巢狀：找下一行有縮排的內容
      const next = body[i + 1] ?? '';
      value = /^\s+\S/.test(next) ? next.trim() : '';
      // 巢狀區塊（例如 claudecode:）的值不是字串，標記為物件
      if (/^\s+[A-Za-z0-9_-]+:/.test(next)) value = { nested: true };
    }
    if (typeof value === 'string') value = value.replace(/^["']|["']$/g, '');
    fields[key] = value;
  }
  return { fields, topLevel, bodyStart: end + 1 };
}
