import { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import stringWidth from 'string-width';
import { html } from './html.js';
import { color, level as levels, brand } from '../theme.js';

// 簡單的單行輸入：文字、Backspace、Ctrl-U 清空、Enter 送出。
// 不用 ink-text-input，因為它會把控制字元當成文字塞進去。
function TextInput({ value, onChange, onSubmit, placeholder = '' }) {
  useInput((input, key) => {
    if (key.return) onSubmit(value);
    else if (key.backspace || key.delete) onChange(value.slice(0, -1));
    else if ((key.ctrl && input === 'u') || input === '\u0015') onChange('');
    else if (input && !key.ctrl && !key.meta && !key.escape && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.tab) {
      // 過濾掉其他控制字元
      const clean = [...input].filter((ch) => ch.charCodeAt(0) >= 32).join('');
      if (clean) onChange(value + clean);
    }
  });
  if (!value && placeholder) return html`<${Text} color=${color.muted}>${placeholder}<//>`;
  return html`<${Text} color=${color.body}>${value}<${Text} color=${color.gold}>▏<//><//>`;
}

// 標題列：navy 底，左側是 pixel art 的 AI TOOLKIT 字標（AI 白、TOOLKIT 橘），
// 右側是工具名與版本資訊。上下各留一行底色，共 5 行。
const PIXEL_ROWS = [
  { trend: '█▀█ █ ', link: '▀█▀ █▀█ █▀█ █   █ █ █ ▀█▀' },
  { trend: '█▀█ █ ', link: ' █  █ █ █ █ █   █▀▄ █  █ ' },
  { trend: '▀ ▀ ▀ ', link: ' ▀  ▀▀▀ ▀▀▀ ▀▀▀ ▀ ▀ ▀  ▀ ' },
];
const BLANK_ROW = { trend: '', link: '' };
const HEADER_ROWS = [BLANK_ROW, ...PIXEL_ROWS, BLANK_ROW];
export const HEADER_HEIGHT = HEADER_ROWS.length;
// Ink 會修掉行尾空白，底色會變短，所以行尾補一個看不見的點字空白（U+2800）
const KEEP = '\u2800';

export function Header({ right = '' }) {
  const { stdout } = useStdout();
  const width = Math.max(60, (stdout?.columns ?? 80) - 1);
  const rights = [KEEP, KEEP, brand.title, right, KEEP];
  return html`<${Box} flexDirection="column">
    ${HEADER_ROWS.map((row, i) => {
      const leftWidth = stringWidth(`  ${row.trend}${row.link}`);
      // 終端機太窄放不下右側文字時就不顯示，只留底色
      let r = rights[i];
      if (width - leftWidth - stringWidth(r) - 1 < 1) r = KEEP;
      const pad = Math.max(1, width - leftWidth - stringWidth(r) - 1);
      return html`<${Text} key=${i} backgroundColor=${color.navy}>
        <${Text} color=${color.text} bold>  ${row.trend}<//>
        <${Text} color=${color.gold} bold>${row.link}<//>
        <${Text} color=${color.blueSoft}>${' '.repeat(pad)}${r} <//>
      <//>`;
    })}
  <//>`;
}

// 把文字補到指定的顯示寬度（全形字占兩格，用 string-width 計算）
function padDisplay(s, width) {
  const w = stringWidth(s);
  return w >= width ? s : s + ' '.repeat(width - w);
}

export function Footer({ text = brand.keys }) {
  return html`<${Box} borderStyle="single" borderColor=${color.navy} borderTop borderBottom=${false} borderLeft=${false} borderRight=${false} paddingX=${1}>
    <${Text} color=${color.muted}>${text}<//>
  <//>`;
}

// 一行訊息
export function LogLine({ entry }) {
  const style = levels[entry.level] ?? levels.info;
  return html`<${Text} color=${style.color} bold=${entry.level === 'title'}>${style.prefix}${entry.text}<//>`;
}

export function Log({ entries, maxLines }) {
  const shown = maxLines ? entries.slice(-maxLines) : entries;
  const hidden = entries.length - shown.length;
  return html`<${Box} flexDirection="column">
    ${hidden > 0 ? html`<${Text} color=${color.muted}>…（上方還有 ${hidden} 行）<//>` : null}
    ${shown.map((e, i) => html`<${LogLine} key=${i} entry=${e} />`)}
  <//>`;
}

export function Busy({ text = '執行中' }) {
  return html`<${Text} color=${color.gold}><${Spinner} type="dots" /> ${text}<//>`;
}

// Device Flow 登入：大字顯示 user code 與網址、倒數，同時執行 poll(signal) 等 GitHub 授權。
// 完成呼叫 onSubmit({ ok, value|error })；Esc 中止輪詢並 onCancel()
export function DeviceCodePrompt({ userCode, verificationUri, expiresIn, poll, onSubmit, onCancel }) {
  const [left, setLeft] = useState(expiresIn);
  const controller = useRef(null);
  useEffect(() => {
    const ac = new AbortController();
    controller.current = ac;
    let done = false;
    poll(ac.signal).then(
      (value) => { if (!done) { done = true; onSubmit({ ok: true, value }); } },
      (error) => { if (!done && !ac.signal.aborted) { done = true; onSubmit({ ok: false, error }); } },
    );
    const timer = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => {
      done = true;
      clearInterval(timer);
      ac.abort();
    };
  }, []);
  useInput((input, key) => {
    if (key.escape || input === 'q') {
      controller.current?.abort();
      onCancel?.();
    }
  });
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return html`<${Box} flexDirection="column">
    <${Text} color=${color.azure} bold>請在瀏覽器完成 GitHub 登入<//>
    <${Box} flexDirection="column" borderStyle="round" borderColor=${color.gold} paddingX=${2} paddingY=${0} marginY=${1}>
      <${Text} color=${color.muted}>1. 開啟 <${Text} color=${color.body} underline>${verificationUri}<//>（已嘗試自動開啟）<//>
      <${Text} color=${color.muted}>2. 輸入這組登入碼：<//>
      <${Text} color=${color.gold} bold>   ${userCode}<//>
      <${Text} color=${color.muted}>3. 按「Authorize」後回到這裡，會自動繼續<//>
    <//>
    <${Text} color=${color.gold}><${Spinner} type="dots" /> 等待授權中（剩餘 ${mm}:${ss}）   Esc 取消<//>
  <//>`;
}

// 單選：↑↓ 移動、Enter 確認、數字鍵直接跳、Esc 取消。
// { heading: true, label } 的項目是群組標題：不能選、不編號，游標會跳過
export function Select({ question, options, onSubmit, onCancel, showNumbers = false }) {
  // 可選項目在 options 裡的位置；編號與上下移動都只看這些
  const selectable = options.map((o, i) => (o.heading ? -1 : i)).filter((i) => i >= 0);
  const [index, setIndex] = useState(selectable[0] ?? 0);
  const move = (delta) => setIndex((i) => {
    const at = selectable.indexOf(i);
    return selectable[(at + delta + selectable.length) % selectable.length];
  });
  // 數字鍵：一秒內連按兩個數字可以選 10 以上的項目（例如 1、0 → 10）
  const digits = useRef({ text: '', at: 0 });
  useInput((input, key) => {
    if (key.upArrow) move(-1);
    else if (key.downArrow) move(1);
    else if (key.return) {
      if (!options[index].disabled) onSubmit(options[index].value);
    } else if (key.escape) onCancel?.();
    else if (showNumbers && /^[0-9]$/.test(input)) {
      const now = Date.now();
      const combined = now - digits.current.at < 1000 ? digits.current.text + input : input;
      const n = Number(combined);
      if (n >= 1 && n <= selectable.length) {
        setIndex(selectable[n - 1]);
        digits.current = { text: combined, at: now };
      } else if (Number(input) >= 1 && Number(input) <= selectable.length) {
        setIndex(selectable[Number(input) - 1]);
        digits.current = { text: input, at: now };
      }
    } else if (input === 'q' && onCancel) onCancel();
  });
  // 說明文字對齊到同一欄
  const items = options.filter((o) => !o.heading);
  const labelWidth = items.some((o) => o.hint || o.disabled) ? Math.max(...items.map((o) => stringWidth(o.label))) + 2 : 0;
  return html`<${Box} flexDirection="column">
    ${question ? html`<${Text} color=${color.azure} bold>${question}<//>` : null}
    ${options.map((o, i) => {
      if (o.heading) {
        return html`<${Box} key=${`h-${i}`} marginTop=${i === 0 ? 0 : 1}>
          <${Text} color=${color.azure}>  ── ${o.label} ${'─'.repeat(Math.max(4, 44 - stringWidth(o.label)))}<//>
        <//>`;
      }
      const active = i === index;
      const num = showNumbers ? `${String(selectable.indexOf(i) + 1).padStart(2)}. ` : '';
      return html`<${Box} key=${o.value}>
        <${Text} color=${o.disabled ? color.muted : active ? color.gold : color.body} bold=${active}>${active ? '▸ ' : '  '}${num}${padDisplay(o.label, labelWidth)}<//>
        <${OptionHint} option=${o} />
      <//>`;
    })}
  <//>`;
}

// 選項的說明：停用的選項顯示停用原因，其他顯示 hint
function OptionHint({ option }) {
  if (option.disabled) return html`<${Text} color=${color.warning}>停用：${option.disabled}<//>`;
  return option.hint ? html`<${Text} color=${color.muted}>${option.hint}<//>` : null;
}

// 多選：空白鍵切換、a 全選／全不選、Enter 確認。disabled（停用原因）的選項顯示出來但不能勾選
export function MultiSelect({ question, options, onSubmit, onCancel }) {
  const [index, setIndex] = useState(0);
  const enabled = options.filter((o) => !o.disabled);
  const [chosen, setChosen] = useState(() => new Set(enabled.filter((o) => o.selected).map((o) => o.value)));
  useInput((input, key) => {
    if (key.upArrow) setIndex((i) => (i - 1 + options.length) % options.length);
    else if (key.downArrow) setIndex((i) => (i + 1) % options.length);
    else if (input === ' ') {
      if (options[index].disabled) return;
      const v = options[index].value;
      setChosen((s) => {
        const n = new Set(s);
        if (n.has(v)) n.delete(v);
        else n.add(v);
        return n;
      });
    } else if (input === 'a') {
      setChosen((s) => (s.size === enabled.length ? new Set() : new Set(enabled.map((o) => o.value))));
    } else if (key.return) onSubmit(options.map((o) => o.value).filter((v) => chosen.has(v)));
    else if (key.escape) onCancel?.();
  });
  const labelWidth = options.some((o) => o.hint || o.disabled) ? Math.max(...options.map((o) => stringWidth(o.label))) + 2 : 0;
  return html`<${Box} flexDirection="column">
    <${Text} color=${color.azure} bold>${question}<//>
    ${options.map((o, i) => {
      const active = i === index;
      const box = o.disabled ? '[-] ' : chosen.has(o.value) ? '[x] ' : '[ ] ';
      return html`<${Box} key=${o.value}>
        <${Text} color=${o.disabled ? color.muted : active ? color.gold : color.body} bold=${active}>${active ? '▸ ' : '  '}${box}${padDisplay(o.label, labelWidth)}<//>
        <${OptionHint} option=${o} />
      <//>`;
    })}
    <${Text} color=${color.muted}>空白鍵切換   a 全選／全不選   Enter 確認<//>
  <//>`;
}

// 確認：y/n，或 typed 模式要求輸入指定文字
export function Confirm({ question, danger, typed, onSubmit, onCancel }) {
  const [value, setValue] = useState('');
  useInput((input, key) => {
    if (typed) return;
    if (input === 'y' || input === 'Y') onSubmit(true);
    else if (input === 'n' || input === 'N' || key.escape) onSubmit(false);
    else if (key.return) onSubmit(false);
  });
  const c = danger ? color.danger : color.gold;
  if (typed) {
    return html`<${Box} flexDirection="column">
      <${Text} color=${c} bold>${question}<//>
      <${Box}>
        <${Text} color=${color.muted}>請輸入 ${typed} 確認，其他任何輸入視為取消：<//>
        <${TextInput} value=${value} onChange=${setValue} onSubmit=${(v) => onSubmit(v === typed)} />
      <//>
    <//>`;
  }
  return html`<${Box} flexDirection="column">
    <${Text} color=${c} bold>${question}<//>
    <${Text} color=${color.muted}>y 是   n 否<//>
  <//>`;
}

// 可捲動的全文檢視：↑↓ 一行、PageUp/PageDown 或空白鍵一頁、g/G 頭尾、Esc 或 q 關閉
export function Pager({ heading, lines, height, onClose }) {
  const [top, setTop] = useState(0);
  const page = Math.max(3, height);
  const maxTop = Math.max(0, lines.length - page);
  // 剛掛上時忽略按鍵，避免吃到前一個畫面（選文件的 Enter）殘留的輸入
  const mountedAt = useRef(Date.now());
  useInput((input, key) => {
    if (Date.now() - mountedAt.current < 200) return;
    if (key.escape || input === 'q') onClose();
    else if (key.upArrow || input === 'k') setTop((t) => Math.max(0, t - 1));
    else if (key.downArrow || input === 'j') setTop((t) => Math.min(maxTop, t + 1));
    else if (key.pageUp || input === 'b') setTop((t) => Math.max(0, t - page));
    else if (key.pageDown || input === ' ' || input === 'f') setTop((t) => Math.min(maxTop, t + page));
    else if (input === 'g') setTop(0);
    else if (input === 'G') setTop(maxTop);
  });
  const shown = lines.slice(top, top + page);
  const pct = lines.length <= page ? 100 : Math.round(((top + page) / lines.length) * 100);
  return html`<${Box} flexDirection="column">
    <${Text} color=${color.azure} bold>${heading}<//>
    <${Box} flexDirection="column" borderStyle="round" borderColor=${color.navy} paddingX=${1}>
      ${shown.map((l, i) => html`<${Text} key=${top + i} color=${/^#/.test(l) ? color.gold : color.body} bold=${/^#/.test(l)}>${l || ' '}<//>`)}
    <//>
    <${Text} color=${color.muted}>第 ${top + 1}–${Math.min(lines.length, top + page)} 行，共 ${lines.length} 行（${pct}%）   ↑↓ 捲動   空白鍵 下一頁   b 上一頁   g/G 頭尾   Esc 關閉<//>
  <//>`;
}

export function TextPrompt({ question, initial, placeholder, validate, onSubmit, onCancel }) {
  const [value, setValue] = useState(initial ?? '');
  const [error, setError] = useState(null);
  useInput((input, key) => {
    if (key.escape) onCancel?.();
    // Ctrl-U 清空整行（ink-text-input 沒有內建）
    if (key.ctrl && input === 'u') {
      setValue('');
      setError(null);
    }
  });
  const submit = (v) => {
    const msg = validate ? validate(v) : null;
    if (msg) setError(msg);
    else onSubmit(v);
  };
  return html`<${Box} flexDirection="column">
    <${Text} color=${color.azure} bold>${question}<//>
    <${Box}>
      <${Text} color=${color.gold}>${'▸ '}<//>
      <${TextInput} value=${value} onChange=${(v) => { setValue(v); setError(null); }} onSubmit=${submit} placeholder=${placeholder} />
    <//>
    ${error ? html`<${Text} color=${color.danger}>${error}<//>` : null}
  <//>`;
}
