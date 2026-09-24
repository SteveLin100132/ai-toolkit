// TUI 配色（深色終端機版）：藍色系當底、橘色當強調。
export const color = {
  navy: '#1b4f9c', // 主色：標題列、邊框
  azure: '#2c6ebb', // 次要標題、指令預覽
  blueSoft: '#adc8e8', // 淡藍文字
  gold: '#ed9b26', // 強調：目前選中的項目、主要動作
  goldDeep: '#e37b24', // 深一階的強調色
  text: '#ffffff', // 底色上的主要文字
  body: '#e1e6ee', // 深色底的主要文字
  muted: '#9aa6b8', // 說明文字、快速鍵
  success: '#2e9e6b',
  warning: '#e3a008',
  danger: '#d64545',
};

// 訊息等級 → 顏色與前綴符號（不用 emoji，只用簡單符號）
export const level = {
  info: { color: color.body, prefix: '  ' },
  muted: { color: color.muted, prefix: '  ' },
  title: { color: color.azure, prefix: '' },
  command: { color: color.azure, prefix: '$ ' },
  success: { color: color.success, prefix: '✓ ' },
  warning: { color: color.warning, prefix: '! ' },
  error: { color: color.danger, prefix: '✗ ' },
  stdout: { color: color.muted, prefix: '  │ ' },
};

export const brand = {
  title: 'AI Toolkit',
  keys: '↑↓ 選擇   Enter 確認   Esc 返回   q 離開',
};
