import { runCommand, formatCommand } from './lib/run.js';
import { Cancelled } from './flows/steps.js';

// 驅動 flow：把每個 yield 的請求交給 io 處理，再把結果送回 flow。
// io = { log(entry), ask(prompt) → Promise<answer>, onRun?(spec) }
export async function drive(gen, io) {
  let input;
  try {
    while (true) {
      const { value, done } = gen.next(input);
      if (done) return { ok: value !== false, cancelled: false };
      input = await handle(value, io);
    }
  } catch (err) {
    // 讓 flow 的 finally 有機會執行（例如清掉暫存目錄）
    try {
      gen.return();
    } catch {
      // flow 的 finally 自己出錯就算了，原本的錯誤比較重要
    }
    if (err instanceof Cancelled) return { ok: false, cancelled: true };
    io.log({ text: err.stack ?? String(err), level: 'error' });
    return { ok: false, cancelled: false, error: err };
  }
}

async function handle(req, io) {
  switch (req.type) {
    case 'log':
      io.log(req);
      return undefined;
    case 'run': {
      io.log({ text: formatCommand(req.cmd, req.args), level: 'command' });
      io.setBusy?.(true);
      const result = await runCommand(req.cmd, req.args, {
        cwd: req.cwd,
        env: req.env,
        onLine: req.quiet ? undefined : (line) => io.log({ text: line, level: 'stdout' }),
      });
      io.setBusy?.(false);
      return result;
    }
    case 'pager':
      await io.ask(req);
      return undefined;
    case 'call': {
      // 非同步工作：錯誤丟回 flow，讓 flow 自己決定怎麼顯示
      io.setBusy?.(true, req.label);
      try {
        return { ok: true, value: await req.fn() };
      } catch (error) {
        return { ok: false, error };
      } finally {
        io.setBusy?.(false);
      }
    }
    case 'deviceCode': {
      // 畫面顯示登入碼並輪詢；回傳 { ok, value } 或 { ok:false, error }；使用者取消回傳 undefined
      const answer = await io.ask(req);
      if (answer === undefined) throw new Cancelled();
      return answer;
    }
    case 'select':
    case 'multiselect':
    case 'confirm':
    case 'text': {
      const answer = await io.ask(req);
      if (answer === undefined) throw new Cancelled();
      // 把回答也記到 log，事後看得到選了什麼
      io.log({ text: `${req.question} → ${formatAnswer(req, answer)}`, level: 'muted' });
      return answer;
    }
    default:
      throw new Error(`未知的請求：${req.type}`);
  }
}

function formatAnswer(req, answer) {
  if (req.type === 'confirm') return answer ? '是' : '否';
  if (req.type === 'select') return req.options.find((o) => o.value === answer)?.label ?? String(answer);
  if (req.type === 'multiselect') return answer.map((v) => req.options.find((o) => o.value === v)?.label ?? v).join('、') || '（無）';
  return answer === '' ? '（空）' : String(answer);
}
