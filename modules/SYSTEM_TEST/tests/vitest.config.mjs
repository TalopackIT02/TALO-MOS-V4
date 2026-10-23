import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
export default {root:resolve(here,'../../../backend'),resolve:{dedupe:['vitest','express','zod','react']},
  test:{dir:here,include:['**/*.test.ts'],environment:'node',env:{NODE_ENV:'test'}}};
