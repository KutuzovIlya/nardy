/* ============================================================
   Голос за столом. Системный синтезатор речи умеет по-русски,
   но акцента у него нет. Поэтому на экран идёт обычный текст,
   а синтезатору подсовывается тот же текст, переписанный
   «как слышится»: без мягкости, без «ы», с «э» вместо «е».
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.speechSynthesis || null;
  var voice = null, picked = false;

  function pick() {
    if (picked || !S) return voice;
    var list = [];
    try { list = S.getVoices() || []; } catch (e) { list = []; }
    if (!list.length) return null;          /* список приходит не сразу */
    picked = true;
    var ru = list.filter(function (v) { return /^ru/i.test(v.lang || ''); });
    /* мужской голос звучит уместнее, но берём любой русский */
    voice = ru.filter(function (v) { return /(yuri|pavel|male|дмитр|юри)/i.test(v.name); })[0] || ru[0] || null;
    return voice;
  }

  if (S && typeof S.addEventListener === 'function') {
    S.addEventListener('voiceschanged', function () { picked = false; pick(); });
  }

  var HARD = 'бвгджзйклмнпрстфхцчшщ';

  /* Переписываем под южный говор: «нэ», «ти», «толко», «шо» */
  function accent(text) {
    var out = '', i, ch, prev;
    /* \b в JS не знает кириллицы, поэтому границу слова ищем вручную */
    text = text.replace(/(^|[^а-яёА-ЯЁ])([Чч])то(?![а-яёА-ЯЁ])/g, function (m, pre, c) {
      return pre + (c === 'Ч' ? 'Шо' : 'шо');
    });
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      prev = (out[out.length - 1] || '').toLowerCase();
      if (ch === 'ы') ch = 'и';
      else if (ch === 'Ы') ch = 'И';
      else if (ch === 'ё') ch = 'о';
      else if (ch === 'Ё') ch = 'О';
      else if (ch === 'щ') ch = 'ш';
      else if (ch === 'Щ') ch = 'Ш';
      else if (ch === 'е' && HARD.indexOf(prev) >= 0) ch = 'э';
      else if (ch === 'ь') {
        var next = (text[i + 1] || '').toLowerCase();
        /* мягкий знак убираем, кроме случаев, где без него каша */
        if (!next || HARD.indexOf(next) >= 0) ch = '';
      }
      out += ch;
    }
    return out;
  }

  function speak(text) {
    if (!S || !text) return;
    var v = pick();
    if (!v) return;                          /* русского голоса нет — молчим */
    try {
      S.cancel();
      var u = new global.SpeechSynthesisUtterance(accent(text));
      u.voice = v;
      u.lang = v.lang || 'ru-RU';
      u.rate = 0.92;
      u.pitch = 0.78;                        /* ниже — солиднее */
      u.volume = 1;
      S.speak(u);
    } catch (e) {}
  }

  function hush() { if (S) { try { S.cancel(); } catch (e) {} } }

  /* На айфоне синтезатор просыпается только после касания экрана,
     поэтому будим его беззвучной фразой прямо в обработчике кнопки */
  function prime() {
    if (!S) return;
    try {
      var u = new global.SpeechSynthesisUtterance(' ');
      u.volume = 0;
      S.speak(u);
    } catch (e) {}
  }

  function ready() { return !!(S && pick()); }

  global.NardyVoice = { speak: speak, hush: hush, ready: ready, accent: accent, prime: prime };
})(window);
