/* ============================================================
   Отрисовка доски: орех, латунная инкрустация, войлочные пункты.
   Всё в «виртуальных» координатах 1240×820, canvas масштабирует.
   ============================================================ */
(function (global) {
  'use strict';

  var VW = 1240, VH = 820;
  var FRAME = 26, TRAY = 96, GAP = 12;
  var FX0 = FRAME + TRAY + GAP;
  var FX1 = VW - FRAME - TRAY - GAP;
  var BAR = 48;
  var PTW = (FX1 - FX0 - BAR) / 12;
  var FY0 = FRAME + 10, FY1 = VH - FRAME - 10;
  var PTH = 316, CD = 66, DD = 62;

  var C = {
    frameHi: '#5A3722', frameLo: '#24140D',
    bed: '#3E2517', bedLo: '#241209',
    bone: '#D9C39B', boneMid: '#C2A97E', boneLo: '#9C8256',
    felt: '#1D5A53', feltMid: '#154742', feltLo: '#0E332F',
    brass: '#C8A24A', dark: '#2B1710'
  };

  function colX(j) { return FX0 + j * PTW + (j >= 6 ? BAR : 0); }

  /* Геометрия пункта i: верхний ряд — 12..23 слева направо,
     нижний — 11..0 слева направо. */
  function geom(i) {
    var top = i >= 12;
    var j = top ? i - 12 : 11 - i;
    return { j: j, top: top, x: colX(j), y: top ? FY0 : FY1 - PTH, w: PTW, h: PTH };
  }

  function gapFor(n) {
    if (n <= 1) return 0;
    return Math.max(15, Math.min(58, (PTH - CD) / (n - 1)));
  }

  /* Позиция k-й шашки в стопке из n на пункте i */
  function manAt(i, k, n) {
    var g = geom(i), sp = gapFor(n);
    return {
      x: g.x + (PTW - CD) / 2,
      y: g.top ? FY0 + k * sp : FY1 - CD - k * sp
    };
  }

  /* Позиция k-й снятой шашки в лотке */
  function trayAt(player, k) {
    var x = player === 'w' ? VW - FRAME - TRAY + (TRAY - CD) / 2 : FRAME + (TRAY - CD) / 2;
    var y = player === 'w' ? FY0 + k * 30 : FY1 - CD - k * 30;
    return { x: x, y: y };
  }

  /* Прямоугольник лотка для снятых шашек */
  function trayBox(player) {
    return {
      x: player === 'w' ? VW - FRAME - TRAY + 3 : FRAME + 3,
      y: FRAME + 8,
      w: TRAY - 6,
      h: VH - 2 * FRAME - 16
    };
  }

  function diceAt(player, idx, n) {
    var cx = player === 'w' ? FX0 + 9 * PTW + BAR : FX0 + 3 * PTW;
    var total = n * DD + (n - 1) * 10;
    return { x: cx - total / 2 + idx * (DD + 10), y: (FY0 + PTH + FY1 - PTH) / 2 - DD / 2 };
  }

  /* ---------- рисование ---------- */

  function rnd32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* Древесные волокна */
  function grain(ctx, x, y, w, h, seed, lines, alpha) {
    var r = rnd32(seed), i, xx, yy, amp, ph, per;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    for (i = 0; i < lines; i++) {
      yy = y + r() * h;
      amp = 1.5 + r() * 6;
      ph = r() * 6.283;
      per = 90 + r() * 300;
      ctx.beginPath();
      ctx.moveTo(x, yy);
      for (xx = x; xx <= x + w; xx += 12) ctx.lineTo(xx, yy + Math.sin(xx / per + ph) * amp);
      ctx.strokeStyle = r() > 0.45
        ? 'rgba(255,218,168,' + (alpha * r() * 0.9).toFixed(3) + ')'
        : 'rgba(24,12,4,' + (alpha * 1.7 * r()).toFixed(3) + ')';
      ctx.lineWidth = 0.5 + r() * 1.7;
      ctx.stroke();
    }
    ctx.restore();
  }

  /* Хатам: цепочка ромбов вдоль отрезка */
  function inlayRun(ctx, x0, y0, x1, y1, offset) {
    var len = Math.hypot(x1 - x0, y1 - y0), step = 21.5;
    var n = Math.floor(len / step), i, t, x, y, k;
    var pal = [C.bone, C.brass, C.dark, C.brass];
    for (i = 0; i <= n; i++) {
      t = (i * step) / len;
      x = x0 + (x1 - x0) * t;
      y = y0 + (y1 - y0) * t;
      k = (i + offset) % pal.length;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = pal[k];
      ctx.globalAlpha = k === 2 ? 0.85 : 0.92;
      ctx.fillRect(-4.6, -4.6, 9.2, 9.2);
      ctx.restore();
    }
  }

  function drawFrame(ctx) {
    var g = ctx.createLinearGradient(0, 0, VW * 0.6, VH);
    g.addColorStop(0, C.frameHi);
    g.addColorStop(0.45, '#3A2115');
    g.addColorStop(1, C.frameLo);
    rrect(ctx, 0, 0, VW, VH, 18);
    ctx.fillStyle = g;
    ctx.fill();
    grain(ctx, 0, 0, VW, VH, 7, 190, 0.10);

    var c = FRAME / 2;
    inlayRun(ctx, c, c, VW - c, c, 0);
    inlayRun(ctx, c, VH - c, VW - c, VH - c, 2);
    inlayRun(ctx, c, c, c, VH - c, 1);
    inlayRun(ctx, VW - c, c, VW - c, VH - c, 3);

    ctx.strokeStyle = 'rgba(200,162,74,.55)';
    ctx.lineWidth = 1.1;
    rrect(ctx, 2.5, 2.5, VW - 5, VH - 5, 16); ctx.stroke();
    rrect(ctx, FRAME - 2.5, FRAME - 2.5, VW - 2 * FRAME + 5, VH - 2 * FRAME + 5, 6); ctx.stroke();
  }

  function drawBed(ctx) {
    var x = FRAME, y = FRAME, w = VW - 2 * FRAME, h = VH - 2 * FRAME;
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, C.bed);
    g.addColorStop(0.5, '#341E12');
    g.addColorStop(1, C.bedLo);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    grain(ctx, x, y, w, h, 21, 150, 0.09);

    /* тень от бортов */
    var s = ctx.createLinearGradient(x, 0, x + 40, 0);
    s.addColorStop(0, 'rgba(0,0,0,.55)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = s; ctx.fillRect(x, y, 40, h);
    s = ctx.createLinearGradient(x + w, 0, x + w - 40, 0);
    s.addColorStop(0, 'rgba(0,0,0,.55)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = s; ctx.fillRect(x + w - 40, y, 40, h);
    s = ctx.createLinearGradient(0, y, 0, y + 30);
    s.addColorStop(0, 'rgba(0,0,0,.5)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = s; ctx.fillRect(x, y, w, 30);
  }

  function drawTray(ctx, side) {
    var x = side === 'l' ? FRAME + 3 : VW - FRAME - TRAY + 3;
    var y = FRAME + 8, w = TRAY - 6, h = VH - 2 * FRAME - 16;
    rrect(ctx, x, y, w, h, 9);
    ctx.fillStyle = '#1B0F08';
    ctx.fill();
    ctx.save();
    ctx.clip();
    grain(ctx, x, y, w, h, side === 'l' ? 33 : 44, 40, 0.07);
    var s = ctx.createLinearGradient(x, y, x + 22, y);
    s.addColorStop(0, 'rgba(0,0,0,.75)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = s; ctx.fillRect(x, y, 22, h);
    ctx.restore();
    ctx.strokeStyle = 'rgba(200,162,74,.32)';
    ctx.lineWidth = 1;
    rrect(ctx, x, y, w, h, 9); ctx.stroke();

    /* гравировка «ДОМ» у дальнего края лотка */
    ctx.save();
    ctx.translate(x + w / 2, side === 'l' ? y + 40 : y + h - 40);
    ctx.rotate(side === 'l' ? -Math.PI / 2 : Math.PI / 2);
    ctx.fillStyle = 'rgba(200,162,74,.42)';
    ctx.font = '500 15px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '5px';
    ctx.fillText('ДОМ', 0, 0);
    ctx.restore();
  }

  function drawBar(ctx) {
    var x = FX0 + 6 * PTW, y = FRAME + 8, h = VH - 2 * FRAME - 16;
    var g = ctx.createLinearGradient(x, 0, x + BAR, 0);
    g.addColorStop(0, '#160C06');
    g.addColorStop(0.5, '#4A2B1A');
    g.addColorStop(1, '#160C06');
    rrect(ctx, x, y, BAR, h, 7);
    ctx.fillStyle = g; ctx.fill();
    grain(ctx, x, y, BAR, h, 55, 26, 0.10);
    ctx.strokeStyle = 'rgba(200,162,74,.30)';
    ctx.lineWidth = 1;
    rrect(ctx, x, y, BAR, h, 7); ctx.stroke();
  }

  function drawPoints(ctx) {
    var i, g, light, baseY, apexY, grd;
    for (i = 0; i < 24; i++) {
      g = geom(i);
      light = ((g.j + (g.top ? 0 : 1)) % 2) === 0;
      baseY = g.top ? FY0 : FY1;
      apexY = g.top ? FY0 + PTH : FY1 - PTH;
      ctx.beginPath();
      ctx.moveTo(g.x + 1.5, baseY);
      ctx.lineTo(g.x + PTW - 1.5, baseY);
      ctx.lineTo(g.x + PTW / 2, apexY);
      ctx.closePath();
      grd = ctx.createLinearGradient(0, baseY, 0, apexY);
      if (light) {
        grd.addColorStop(0, C.bone); grd.addColorStop(0.55, C.boneMid); grd.addColorStop(1, C.boneLo);
      } else {
        grd.addColorStop(0, C.felt); grd.addColorStop(0.55, C.feltMid); grd.addColorStop(1, C.feltLo);
      }
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,162,74,.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    /* латунная нить вдоль домов */
    ctx.strokeStyle = 'rgba(200,162,74,.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(colX(6), FY0 - 3); ctx.lineTo(colX(11) + PTW, FY0 - 3);
    ctx.moveTo(colX(0), FY1 + 3); ctx.lineTo(colX(5) + PTW, FY1 + 3);
    ctx.stroke();
  }

  function drawLight(ctx) {
    var g = ctx.createLinearGradient(0, 0, VW * 0.75, VH);
    g.addColorStop(0, 'rgba(255,240,214,.09)');
    g.addColorStop(0.35, 'rgba(255,240,214,.02)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    rrect(ctx, 0, 0, VW, VH, 18);
    ctx.fillStyle = g; ctx.fill();

    var v = ctx.createRadialGradient(VW / 2, VH * 0.42, VH * 0.30, VW / 2, VH * 0.5, VH * 0.95);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,.45)');
    rrect(ctx, 0, 0, VW, VH, 18);
    ctx.fillStyle = v; ctx.fill();
  }

  function render(canvas) {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    var dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(w * dpr / VW, 0, 0, h * dpr / VH, 0, 0);
    ctx.clearRect(0, 0, VW, VH);
    drawFrame(ctx);
    drawBed(ctx);
    drawTray(ctx, 'l');
    drawTray(ctx, 'r');
    drawPoints(ctx);
    drawBar(ctx);
    drawLight(ctx);
  }

  global.NardyBoard = {
    VW: VW, VH: VH, CD: CD, DD: DD, PTW: PTW, PTH: PTH, FY0: FY0, FY1: FY1,
    geom: geom, manAt: manAt, trayAt: trayAt, trayBox: trayBox, diceAt: diceAt, gapFor: gapFor,
    render: render
  };
})(window);
