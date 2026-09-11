/* ============================================================
   Профиль: звание, наколки, медальон, фото, «о себе».

   Звание и наколки даются только за игру с людьми — компьютер
   считается отдельно, иначе звание можно было бы набить на новичке.
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- звание: по числу побед над людьми ---------- */

  /* of — то же звание в родительном падеже: «ещё 3 победы до Бродяги» */
  var RANKS = [
    { name: 'Шнырь', of: 'Шныря', from: 0 },
    { name: 'Фраер', of: 'Фраера', from: 5 },
    { name: 'Бродяга', of: 'Бродяги', from: 15 },
    { name: 'Блатной', of: 'Блатного', from: 40 },
    { name: 'Смотрящий', of: 'Смотрящего', from: 100 },
    { name: 'Вор в законе', of: 'Вора в законе', from: 250 }
  ];

  function rank(wins) {
    var i = 0;
    while (i + 1 < RANKS.length && wins >= RANKS[i + 1].from) i++;
    var next = RANKS[i + 1] || null;
    return {
      name: RANKS[i].name,
      level: i,
      next: next ? next.of : null,
      need: next ? next.from - wins : 0
    };
  }

  /* ---------- наколки ---------- */

  var BADGES = [
    { id: 'mars1', name: 'Первый марс', hint: 'выиграть, пока соперник не снял ни одной шашки', mark: '✶' },
    { id: 'mars10', name: 'Десять марсов', hint: 'поставить десять марсов', mark: 'Ⅹ' },
    { id: 'six3', name: 'Три шеш-беша', hint: 'выбросить 6-6 трижды за одну партию', mark: '⚅' },
    { id: 'shutout', name: 'Всухую', hint: 'выиграть матч, не отдав ни одной партии', mark: '∅' },
    { id: 'game100', name: 'Сотая партия', hint: 'сыграть сто партий с людьми', mark: 'Ⅽ' }
  ];

  /* ---------- резные медальоны вместо фото ---------- */

  var MEDALS = [
    { id: 'star', mark: '✵' },
    { id: 'crown', mark: '♛' },
    { id: 'spade', mark: '♠' },
    { id: 'cross', mark: '✠' },
    { id: 'moon', mark: '☾' },
    { id: 'dice', mark: '⚄' }
  ];
  var medalCache = {};

  function medalOf(id) {
    for (var i = 0; i < MEDALS.length; i++) if (MEDALS[i].id === id) return MEDALS[i];
    return null;
  }

  /* Медальон рисуем сами: тёмный орех, латунный обод, знак золотом
     с тенью — будто вырезан в дереве и залит металлом. */
  function medal(id, size) {
    var m = medalOf(id);
    if (!m) return '';
    size = size || 160;
    var key = id + ':' + size;
    if (medalCache[key]) return medalCache[key];
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d'), r = size / 2;

    var wood = g.createRadialGradient(r * .7, r * .6, r * .1, r, r, r);
    wood.addColorStop(0, '#5A3B22');
    wood.addColorStop(.7, '#3A2414');
    wood.addColorStop(1, '#1E120A');
    g.fillStyle = wood;
    g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();

    /* волокна дерева */
    g.save();
    g.beginPath(); g.arc(r, r, r * .96, 0, Math.PI * 2); g.clip();
    g.globalAlpha = .13;
    g.strokeStyle = '#0D0704';
    for (var i = 0; i < 14; i++) {
      g.lineWidth = 1 + (i % 3);
      g.beginPath();
      var y = size * (i / 14) + (i % 2 ? 3 : -2);
      g.moveTo(0, y);
      g.bezierCurveTo(r * .6, y - 6, r * 1.3, y + 7, size, y - 2);
      g.stroke();
    }
    g.restore();

    /* латунный обод и резная канавка */
    var rim = g.createLinearGradient(0, 0, size, size);
    rim.addColorStop(0, '#F1D98F');
    rim.addColorStop(.5, '#A8822E');
    rim.addColorStop(1, '#E5C97F');
    g.lineWidth = size * .06;
    g.strokeStyle = rim;
    g.beginPath(); g.arc(r, r, r - size * .03, 0, Math.PI * 2); g.stroke();
    g.lineWidth = size * .012;
    g.strokeStyle = 'rgba(10,6,3,.7)';
    g.beginPath(); g.arc(r, r, r * .8, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(229,201,127,.35)';
    g.beginPath(); g.arc(r, r, r * .8 + size * .012, 0, Math.PI * 2); g.stroke();

    /* знак: тёмная выемка, поверх золото */
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = Math.round(size * .5) + 'px Forum, Georgia, "Apple Symbols", serif';
    g.fillStyle = 'rgba(8,5,2,.85)';
    g.fillText(m.mark, r + size * .012, r + size * .03);
    var gold = g.createLinearGradient(0, r - size * .25, 0, r + size * .25);
    gold.addColorStop(0, '#FFF0C0');
    gold.addColorStop(.45, '#E5C97F');
    gold.addColorStop(1, '#9A7426');
    g.fillStyle = gold;
    g.fillText(m.mark, r, r + size * .01);

    medalCache[key] = c.toDataURL('image/png');
    return medalCache[key];
  }

  /* ---------- своё фото: ужимаем до 160×160, чтобы база не пухла ---------- */

  function shrink(file) {
    return new Promise(function (ok, no) {
      if (!file || !/^image\//.test(file.type)) { no(new Error('не картинка')); return; }
      var rd = new FileReader();
      rd.onerror = function () { no(new Error('не прочиталось')); };
      rd.onload = function () {
        var img = new Image();
        img.onerror = function () { no(new Error('не картинка')); };
        img.onload = function () {
          var S = 160, c = document.createElement('canvas');
          c.width = c.height = S;
          var g = c.getContext('2d');
          var side = Math.min(img.width, img.height);
          var sx = (img.width - side) / 2, sy = (img.height - side) / 2;
          g.drawImage(img, sx, sy, side, side, 0, 0, S, S);
          ok(c.toDataURL('image/jpeg', .82));
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }

  /* ---------- как игрок выглядит: фото, медальон, «о себе» ----------
     Хранится на телефоне; у игроков из Telegram ещё и в общей базе. */

  var LOOK = 'nardy.look';

  function look() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(LOOK) || 'null'); } catch (e) { v = null; }
    v = v || {};
    return { pic: v.pic || 'tg', medal: v.medal || 'star', photo: v.photo || '', about: v.about || '' };
  }

  function setLook(patch) {
    var v = look(), k;
    for (k in patch) v[k] = patch[k];
    try { localStorage.setItem(LOOK, JSON.stringify(v)); } catch (e) {}
    return v;
  }

  /* Картинка игрока по его настройкам: своё фото, медальон или фото из Telegram */
  function picture(v, tgPhoto, size) {
    if (v.pic === 'photo' && v.photo) return v.photo;
    if (v.pic === 'medal') return medal(v.medal, size);
    if (tgPhoto) return tgPhoto;
    return medal(v.medal || 'star', size);
  }

  global.NardyProfile = {
    RANKS: RANKS, BADGES: BADGES, MEDALS: MEDALS,
    rank: rank, medal: medal, shrink: shrink,
    look: look, setLook: setLook, picture: picture
  };
})(window);
