/* ============================================================
   Аккаунт. Если сервер поднят и игра открыта в Telegram —
   вход настоящий: подпись initData проверяется на сервере,
   профиль общий для всех устройств. Если сервера нет — играем
   гостем, и вся статистика остаётся на этом устройстве.
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

  function hasServer() { return !!API; }
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
    return Promise.resolve(guest(name, API ? 'вход только из Telegram' : ''));
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

  function profile(id) { return ask('/api/profile?id=' + encodeURIComponent(id || (me && me.id) || '')); }
  function top() { return ask('/api/top'); }

  global.NardyAccount = {
    api: function () { return API; },
    hasServer: hasServer, signed: signed, user: user,
    login: login, logout: logout, rename: rename,
    profile: profile, top: top
  };
})(window);
