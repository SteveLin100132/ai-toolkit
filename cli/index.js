#!/usr/bin/env node
// ai-toolkit CLI 入口。不帶參數進入互動式介面，帶指令則以純文字模式執行。

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  process.stderr.write(`需要 Node >= 22，目前是 ${process.versions.node}。請執行：nvm use\n`);
  process.exit(1);
}

// 輸出接到 head 之類的工具被提前關閉時，安靜結束
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const { parseArgs, printHelp, runHeadless } = await import('./headless.js');

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`${err.message}\n\n`);
  printHelp();
  process.exit(2);
}

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args._.length > 0) {
  process.exit(await runHeadless(args));
}

if (!process.stdout.isTTY) {
  process.stderr.write('互動式介面需要終端機。請帶指令執行，或用 --help 查看說明。\n');
  process.exit(2);
}

const { render } = await import('ink');
const { App } = await import('./ui/app.js');
const { html } = await import('./ui/html.js');
const { waitUntilExit } = render(html`<${App} />`);
await waitUntilExit();
