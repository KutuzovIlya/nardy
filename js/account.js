/* ============================================================
   Аккаунт. Игра открыта в Telegram — профиль общий для всех
   устройств и лежит в базе Firebase под номером Telegram.
   Если когда-нибудь появится свой сервер, вход пойдёт через
   него с проверкой подписи Telegram. Открыта просто в браузере —
   играем гостем, статистика остаётся на этом устройстве.
   ============================================================ */
(function (global) {
  'use strict';

  /* адрес сервера; пока пусто — работаем без него */
  var API = '';
  try { API = localStorage.getItem('nardy.api') || API; } catch (e) {}
  API = API.replace(/\/+$/, '');

  var me = null;
  try { me = JSON.parse(localStorage.getItem('nardy.me') || 'null'); } catch (e) { me = null; }

  function save() {
    try {
      if (me) localStorage.setItem('nardy.me', JSON.stringify(me));
      else localStorage.removeItem('nardy.me');
    } catch (e) {}
  }

  /* База Firebase — главный путь; внутри артефакта её нет */
  function fb() { return !API && !!global.NardyFB && NardyFB.ready() && !global.claude; }

  function hasServer() { return !!API || fb(); }
  function signed() { return !!me; }
  function user() { return me; }

  function ask(path, body) {
    if (!API) return Promise.reject(new Error('нет сервера'));
    return fetch(API + path, body ? {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    } : undefined).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d && d.error ? d.error : 'ошибка ' + r.status);
        return d;
      });
    });
  }

  /* Вход. Гостя пускаем всегда — иначе без сервера играть нельзя */
  function login(name) {
    var initData = global.NardyTG ? NardyTG.initData() : '';
    if (API && initData) {
      return ask('/api/login', { initData: initData }).then(function (d) {
        me = { id: d.user.id, name: d.user.name, photo: d.user.photo, guest: false };
        save();
        return me;
      }, function (e) {
        return guest(name, String(e.message || e));
      });
    }
    var tg = fb() && global.NardyTG ? NardyTG.account() : null;
    if (tg) {
      me = { id: tg.id, name: tg.name, photo: tg.photo, guest: false };
      save();
      return Promise.resolve(me);
    }
    return Promise.resolve(guest(name, API || fb() ? 'вход только из Telegram' : ''));
  }

  function guest(name, why) {
    var id = null;
    try { id = localStorage.getItem('nardy.id'); } catch (e) {}
    me = {
      id: id || 'guest',
      name: (name || (global.NardyTG && NardyTG.userName()) || 'Игрок').slice(0, 18),
      photo: (global.NardyTG && NardyTG.photo()) || '',
      guest: true,
      why: why || ''
    };
    save();
    return me;
  }

  function logout() { me = null; save(); }

  function rename(name) {
    if (!me) return;
    me.name = (name || 'Игрок').slice(0, 18);
    save();
  }

  function profile(id) {
    id = id || (me && me.id) || '';
    if (fb()) return NardyFB.profile(id).then(function (u) { return { user: u }; });
    return ask('/api/profile?id=' + encodeURIComponent(id));
  }

  function top() {
    if (fb()) return NardyFB.top().then(function (list) { return { top: list }; });
    return ask('/api/top');
  }

  global.NardyAccount = {
    api: function () { return API; },
    fb: fb,
    hasServer: hasServer, signed: signed, user: user,
    login: login, logout: logout, rename: rename,
    profile: profile, top: top
  };
})(window);
