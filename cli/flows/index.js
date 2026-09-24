import * as validate from './validate.js';
import * as generate from './generate.js';
import * as importFlow from './import.js';
import * as fetchFlow from './fetch.js';
import * as docs from './docs.js';
import * as installGlobal from './install-global.js';
import * as newFlow from './new.js';
import * as release from './release.js';
import * as misc from './misc.js';
import * as login from './login.js';

// 主選單順序
export const menu = [
  { ...validate.meta, start: () => validate.flow() },
  { ...generate.metaDry, start: (o) => generate.flow({ ...o, dryRun: true }) },
  { ...generate.meta, start: (o) => generate.flow(o) },
  { ...importFlow.meta, start: () => importFlow.flow() },
  { ...login.meta, start: (o) => login.flow(o) },
  { ...fetchFlow.remoteMeta, start: (o) => fetchFlow.flow({ ...o, remote: true }) },
  { ...fetchFlow.meta, start: (o) => fetchFlow.flow(o) },
  { ...installGlobal.meta, start: (o) => installGlobal.flow(o) },
  { ...newFlow.meta, start: () => newFlow.flow() },
  { ...release.meta, start: () => release.flow() },
  { ...misc.doctorMeta, start: () => misc.doctorFlow() },
  { ...docs.meta, start: (o) => docs.flow(o) },
  { ...misc.gitignoreMeta, start: () => misc.gitignoreFlow() },
  { ...misc.cleanMeta, start: (o) => misc.cleanFlow(o) },
  { ...login.logoutMeta, start: (o) => login.logoutFlow(o) },
];

export const byId = Object.fromEntries(menu.map((m) => [m.id, m]));
