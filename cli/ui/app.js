import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { html } from './html.js';
import { Header, HEADER_HEIGHT, Footer, Log, Busy, Select, MultiSelect, Confirm, TextPrompt, Pager, DeviceCodePrompt } from './components.js';
import { color, brand } from '../theme.js';
import { drive } from '../driver.js';
import { menu } from '../flows/index.js';
import { loadConfig, readPackageVersion, MISSING_CONFIG, ROOT } from '../lib/config.js';
import { listRules, listSkills, listSubagents, listCommands, readHooks, readMcp } from '../lib/inventory.js';
import { Cancelled } from '../flows/steps.js';

const versionInfo = `v${readPackageVersion()} · rulesync ${readPackageVersion('rulesync')} · node ${process.versions.node} · ${ROOT}`;

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 30;
  const [screen, setScreen] = useState('menu');
  const [current, setCurrent] = useState(null);
  const [log, setLog] = useState([]);
  const [prompt, setPrompt] = useState(null);
  const [busy, setBusyState] = useState(false);
  const [busyText, setBusyText] = useState('執行中');
  const setBusy = useCallback((on, label) => {
    setBusyState(on);
    setBusyText(label ?? '執行中');
  }, []);
  const [finished, setFinished] = useState(null);
  const resolver = useRef(null);

  const backToMenu = useCallback(() => {
    setScreen('menu');
    setLog([]);
    setPrompt(null);
    setFinished(null);
    setCurrent(null);
  }, []);

  // 開始一個 flow
  const start = useCallback(async (item) => {
    setCurrent(item);
    setScreen('flow');
    setLog([]);
    setFinished(null);
    const io = {
      log: (entry) => setLog((l) => [...l, entry]),
      setBusy,
      ask: (req) => new Promise((resolve) => {
        resolver.current = resolve;
        setPrompt(req);
      }),
    };
    const result = await drive(item.start({}), io);
    setPrompt(null);
    setFinished(result);
  }, []);

  const answer = useCallback((value) => {
    const r = resolver.current;
    resolver.current = null;
    setPrompt(null);
    r?.(value);
  }, []);

  // flow 結束後按 Enter 或 Esc 回選單
  useInput((input, key) => {
    if (screen !== 'flow' || !finished) return;
    if (key.return || key.escape || input === 'q') backToMenu();
  }, { isActive: screen === 'flow' && !!finished });

  if (screen === 'menu') {
    return html`<${MenuScreen} onPick=${start} onQuit=${() => exit()} />`;
  }

  const isPager = prompt?.type === 'pager';
  const overhead = 7 + HEADER_HEIGHT + (prompt ? Math.min(12, (prompt.options?.length ?? 0) + 4) : 0);
  const logLines = isPager ? 3 : Math.max(5, rows - overhead);
  const pagerHeight = Math.max(5, rows - HEADER_HEIGHT - logLines - 9);
  return html`<${Box} flexDirection="column">
    <${Header} right=${versionInfo} />
    <${Box} flexDirection="column" paddingX=${1} paddingTop=${1}>
      <${Text} color=${color.gold} bold>${current?.label}<//>
      <${Log} entries=${log} maxLines=${logLines} />
      ${busy ? html`<${Busy} text=${busyText} />` : null}
      ${prompt ? html`<${Box} marginTop=${1}><${PromptView} prompt=${prompt} onAnswer=${answer} pagerHeight=${pagerHeight} /><//>` : null}
      ${finished ? html`<${Box} marginTop=${1}>
        <${Text} color=${finished.cancelled ? color.muted : finished.ok ? color.success : color.danger} bold>
          ${finished.cancelled ? '已取消' : finished.ok ? '完成' : '未完成'}
        <//>
      <//>` : null}
    <//>
    <${Footer} text=${finished ? 'Enter 返回選單   q 離開' : isPager ? 'Esc 關閉文件' : prompt ? brand.keys : '執行中…'} />
  <//>`;
}

function PromptView({ prompt, onAnswer, pagerHeight }) {
  const cancel = () => onAnswer(undefined);
  switch (prompt.type) {
    case 'select':
      return html`<${Select} question=${prompt.question} options=${prompt.options} onSubmit=${onAnswer} onCancel=${cancel} />`;
    case 'multiselect':
      return html`<${MultiSelect} question=${prompt.question} options=${prompt.options} onSubmit=${onAnswer} onCancel=${cancel} />`;
    case 'confirm':
      return html`<${Confirm} question=${prompt.question} danger=${prompt.danger} typed=${prompt.typed} onSubmit=${onAnswer} onCancel=${cancel} />`;
    case 'pager':
      return html`<${Pager} heading=${prompt.heading} lines=${prompt.lines} height=${pagerHeight} onClose=${() => onAnswer(true)} />`;
    case 'text':
      return html`<${TextPrompt} question=${prompt.question} initial=${prompt.initial} placeholder=${prompt.placeholder} validate=${prompt.validate} onSubmit=${onAnswer} onCancel=${cancel} />`;
    case 'deviceCode':
      return html`<${DeviceCodePrompt} userCode=${prompt.userCode} verificationUri=${prompt.verificationUri} expiresIn=${prompt.expiresIn} poll=${prompt.poll} onSubmit=${onAnswer} onCancel=${cancel} />`;
    default:
      return null;
  }
}

function MenuScreen({ onPick, onQuit }) {
  const [summary] = useState(() => {
    try {
      const config = loadConfig();
      if (!config.exists) return `${MISSING_CONFIG}。目前只能使用登入、查文件等不需要設定的功能`;
      return `${listRules().length} 個 rule · ${listSkills().length} 個 skill · ${listSubagents().length} 個 subagent · ${listCommands().length} 個 command · ${readHooks().count} 個 hook · ${readMcp().count} 個 MCP · targets：${config.targets.join('、')} · features：${config.features.join('、')}`;
    } catch (err) {
      return `讀取 rulesync.jsonc 失敗：${err.message}`;
    }
  });
  const options = [
    ...menu.map((m) => ({ value: m.id, label: m.label, hint: m.hint })),
    { value: '__quit', label: '離開' },
  ];
  return html`<${Box} flexDirection="column">
    <${Header} right=${versionInfo} />
    <${Box} flexDirection="column" paddingX=${1} paddingTop=${1}>
      <${Text} color=${color.muted}>${summary}<//>
      <${Box} marginTop=${1}>
        <${Select}
          options=${options}
          showNumbers
          onSubmit=${(v) => (v === '__quit' ? onQuit() : onPick(menu.find((m) => m.id === v)))}
          onCancel=${onQuit}
        />
      <//>
    <//>
    <${Footer} text=${'↑↓ 或數字鍵選擇   Enter 執行   q 離開'} />
  <//>`;
}
