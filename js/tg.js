/* ============================================================
   Telegram: приложение открывается внутри мессенджера.
   Всё необязательное — если запущено просто в браузере, модуль
   молча отвечает «нет».
   ============================================================ */
(function (global) {
  'use strict';

  var BOT = 'vashi_nardy_bot';   /* имя бота из @BotFather */
  var APP = 'nardy';   /* короткое имя мини-приложения из @BotFather */

  var W = global.Telegram && global.Telegram.WebApp ? global.Telegram.WebApp : null;
  var on = !!(W && W.initData !== undefined && W.platform && W.platform !== 'unknown');

  function ready() {
    if (!on) return;
    try {
      W.ready();
      W.expand();
      if (W.disableVerticalSwipes) W.disableVerticalSwipes();   /* иначе перетаскивание шашки свернёт окно */
      if (W.setHeaderColor) W.setHeaderColor('#0F1218');
      if (W.setBackgroundColor) W.setBackgroundColor('#0F1218');
      if (W.enableClosingConfirmation) W.enableClosingConfirmation();
      document.documentElement.classList.add('tg');
      if (W.platform === 'ios' || W.platform === 'android') {
        document.documentElement.classList.add('tg-mobile');
      }
      /* На iOS высоту окна знает только сам Telegram — 100dvh там врёт */
      applyHeight();
      if (W.onEvent) {
        W.onEvent('viewportChanged', applyHeight);
        W.onEvent('themeChanged', applyHeight);
      }
    } catch (e) {}
  }

  function applyHeight() {
    try {
      var h = W.viewportStableHeight || W.viewportHeight;
      if (h) document.documentElement.style.setProperty('--tgh', Math.round(h) + 'px');
      window.dispatchEvent(new Event('resize'));
    } catch (e) {}
  }

  /* Имя из профиля — чтобы не заставлять представляться */
  function userName() {
    try {
      var u = W && W.initDataUnsafe && W.initDataUnsafe.user;
      if (!u) return '';
      return (u.first_name || u.username || '').slice(0, 18);
    } catch (e) { return ''; }
  }

  /* Фото профиля — если Telegram его отдал */
  function photo() {
    try {
      var u = W && W.initDataUnsafe && W.initDataUnsafe.user;
      return (u && u.photo_url) || '';
    } catch (e) { return ''; }
  }

  /* Подписанные данные о входе — их проверяет сервер */
  function initData() {
    try { return (W && W.initData) || ''; } catch (e) { return ''; }
  }

  function startParam() {
    try {
      var p = W && W.initDataUnsafe && W.initDataUnsafe.start_param;
      return p ? String(p).toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
    } catch (e) { return ''; }
  }

  /* Отдача, ради которой всё и затевалось: доска отзывается на пальцы */
  function buzz(kind) {
    if (!on || !W.HapticFeedback) return;
    try {
      var h = W.HapticFeedback;
      if (kind === 'move') h.impactOccurred('light');
      else if (kind === 'off') h.impactOccurred('medium');
      else if (kind === 'dice') h.impactOccurred('rigid');
      else if (kind === 'win') h.notificationOccurred('success');
      else if (kind === 'lose') h.notificationOccurred('warning');
      else if (kind === 'no') h.notificationOccurred('error');
      else if (kind === 'tap') h.selectionChanged();
    } catch (e) {}
  }

  function deepLink(code) {
    if (!BOT) return '';
    return 'https://t.me/' + BOT + '/' + APP + '?startapp=' + code;
  }

  /* Приглашение уходит в чат Telegram, а не в буфер обмена */
  function invite(code, text) {
    var link = deepLink(code);
    if (!on || !link) return false;
    try {
      W.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(link) +
        '&text=' + encodeURIComponent(text || 'Партию в нарды?'));
      return true;
    } catch (e) { return false; }
  }

  function close() { if (on) { try { W.close(); } catch (e) {} } }

  global.NardyTG = {
    on: on,
    bot: function () { return BOT; },
    ready: ready,
    userName: userName,
    photo: photo,
    initData: initData,
    startParam: startParam,
    buzz: buzz,
    deepLink: deepLink,
    invite: invite,
    close: close,
    platform: on ? W.platform : ''
  };
})(window);
