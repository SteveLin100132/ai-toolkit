import htm from 'htm';
import { createElement } from 'react';

// 不用編譯就能寫 JSX 風格的樣板：html`<${Box}>...</${Box}>`
export const html = htm.bind(createElement);
