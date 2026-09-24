import { validateStep } from './shared.js';

export const meta = { id: 'validate', label: '驗證', hint: '檢查 rule、skill、subagent、command 的 frontmatter 與名稱，以及 hooks、MCP 設定檔' };

export function* flow() {
  const result = yield* validateStep();
  return result.errors === 0;
}
