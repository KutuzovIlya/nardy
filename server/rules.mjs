/* Те же правила, что у игроков в браузере: сервер подключает
   js/engine.js и js/ai.js как есть, без копий и переписываний. */
import '../js/engine.js';
import '../js/ai.js';

export const N = globalThis.Nardy;
export const AI = globalThis.NardyAI;
