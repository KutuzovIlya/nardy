/* Те же правила, что у игроков в браузере: сервер подключает
   js/engine.js, js/ai.js и js/table.js как есть, без копий. */
import '../js/engine.js';
import '../js/ai.js';
import '../js/table.js';

export const N = globalThis.Nardy;
export const AI = globalThis.NardyAI;
export const T = globalThis.NardyTable;
