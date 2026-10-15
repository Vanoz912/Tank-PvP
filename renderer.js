/**
 * @file renderer.js
 * @description Модуль візуалізації ігрового поля (Canvas 2D): мапа, шари кущів, конус погляду, приціл, підсвітка та головний кадр drawGame.
 */

import { TURRET_TYPES, MAP_EVENTS } from './config.js?v=20261011_v17';
import { TILE_TYPES, TILE_BY_ID, drawLowBushFoliage, isGroundDecorTileId, drawDamageCracks, getEffectiveCellTile } from './tiles.js?v=20261011_v17';
import Network from './network.js?v=20261011_v17';
import {
  trackMarks, debrisParticles, muzzleFlashes, smokeParticles, tracerTrails, consumeScreenShake,
  drawWeatherEffects
} from './vfx.js?v=20261011_v17';
import {
  gridCols, gridRows, tileSize, canvasWidth, canvasHeight,
  p1Tank, p2Tank, p3Tank, p4Tank, gameState, renderTanks, lastKnownEnemy,
  mouseX, mouseY, lerpAngle
} from './state.js?v=20261011_v17';
import {
  canPlayerSeeBullet, canPlayerSeeTrack, canPlayerSeeMine, canPlayerSeeMuzzleEffect,
  canPlayerSeeTracer, isTankSniperCamouflaged, isInVisionCone,
  isTankInSmoke, isTankCamouflaged, shouldDrawTankOverlayHighlight
} from './vision.js?v=20261011_v17';

let gameCanvas = null;
let gameCtx = null;

export function ensureGameContext() {
  if (!gameCtx && typeof document !== 'undefined') {
    gameCanvas = document.getElementById('gameCanvas');
    if (gameCanvas) {
      gameCtx = gameCanvas.getContext('2d');
    }
  }
  return gameCtx;
}

/**
 * Рендеринг тактичного конуса погляду (динамічний FOV за типом гармати: 50° / 90° / 125°), що прямує за вежею гравця
 */
export function drawVisionCone(ctx, tank, renderPos, canvasW, canvasH) {
  if (!tank || tank.isDead) return;
  const cx = renderPos.x + tank.size / 2;
  const cy = renderPos.y + tank.size / 2;
  const fovDegrees = tank.fov || (TURRET_TYPES[tank.turretType] && TURRET_TYPES[tank.turretType].fov) || 90;
  const halfFovRad = (fovDegrees / 2) * (Math.PI / 180);

  // Орієнтація конуса за кутом вежі
  let baseAngle = renderPos.turretAngle;
  if (!Number.isFinite(baseAngle)) {
    baseAngle = Number.isFinite(tank.turretAngle) ? tank.turretAngle : (tank.isP1 ? Math.PI / 2 : -Math.PI / 2);
    renderPos.turretAngle = baseAngle;
  }

  const startAngle = baseAngle - halfFovRad;
  const endAngle = baseAngle + halfFovRad;
  const maxRange = Math.max(canvasW, canvasH) * 1.25;

  ctx.save();
  try {
    // М'який напівпрозорий промінь світла (тактичний сектор огляду)
    const grad = ctx.createRadialGradient(cx, cy, tank.size * 0.45, cx, cy, maxRange * 0.7);
    if (tank.isP1) {
      grad.addColorStop(0, 'rgba(241, 196, 15, 0.28)');
      grad.addColorStop(0.4, 'rgba(241, 196, 15, 0.12)');
      grad.addColorStop(0.8, 'rgba(241, 196, 15, 0.04)');
      grad.addColorStop(1, 'rgba(241, 196, 15, 0.0)');
    } else {
      grad.addColorStop(0, 'rgba(46, 204, 113, 0.28)');
      grad.addColorStop(0.4, 'rgba(46, 204, 113, 0.12)');
      grad.addColorStop(0.8, 'rgba(46, 204, 113, 0.04)');
      grad.addColorStop(1, 'rgba(46, 204, 113, 0.0)');
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxRange, startAngle, endAngle);
    ctx.closePath();
    ctx.fill();

    // Тактичні штрихові бічні лінії межі погляду
    ctx.strokeStyle = tank.isP1 ? 'rgba(241, 196, 15, 0.55)' : 'rgba(46, 204, 113, 0.55)';
    ctx.lineWidth = 1.5;
    if (typeof ctx.setLineDash === 'function') {
      ctx.setLineDash([6, 4]);
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(startAngle) * maxRange, cy + Math.sin(startAngle) * maxRange);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(endAngle) * maxRange, cy + Math.sin(endAngle) * maxRange);
    ctx.stroke();
    if (typeof ctx.setLineDash === 'function') {
      ctx.setLineDash([]);
    }
  } finally {
    ctx.restore();
  }
}

/**
 * Рендеринг штрих-пунктирної лінії прицілювання від танка до позиції миші (Crosshair & Aim Line)
 */
export function drawAimGuide(ctx, tank, renderPos, targetX, targetY) {
  if (!tank || tank.isDead || !Number.isFinite(targetX) || !Number.isFinite(targetY)) return;

  const cx = renderPos ? (renderPos.x + tank.size / 2) : (tank.x + tank.size / 2);
  const cy = renderPos ? (renderPos.y + tank.size / 2) : (tank.y + tank.size / 2);

  // Якщо курсор миші вийшов за межі поля, проектуємо приціл уздовж променя на край арени
  let aimX = targetX;
  let aimY = targetY;
  const margin = 8;
  const minX = margin;
  const maxX = Math.max(margin, canvasWidth - margin);
  const minY = margin;
  const maxY = Math.max(margin, canvasHeight - margin);

  if (aimX < minX || aimX > maxX || aimY < minY || aimY > maxY) {
    const dx = aimX - cx;
    const dy = aimY - cy;
    let t = 1;
    if (dx > 0 && aimX > maxX) t = Math.min(t, (maxX - cx) / dx);
    if (dx < 0 && aimX < minX) t = Math.min(t, (minX - cx) / dx);
    if (dy > 0 && aimY > maxY) t = Math.min(t, (maxY - cy) / dy);
    if (dy < 0 && aimY < minY) t = Math.min(t, (minY - cy) / dy);
    t = Math.max(0, Math.min(1, t));
    aimX = cx + dx * t;
    aimY = cy + dy * t;
  }

  ctx.save();

  const isP1 = tank.isP1;
  const guideColor = isP1 ? 'rgba(243, 156, 18, 0.75)' : 'rgba(46, 204, 113, 0.75)';
  const crosshairColor = isP1 ? '#f1c40f' : '#2ecc71';

  // 1. Штрих-пунктирна тактична лінія від центру танка до точки прицілювання
  ctx.strokeStyle = guideColor;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([8, 4, 2, 4]); // штрих - пробіл - точка - пробіл
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(aimX, aimY);
  ctx.stroke();

  // 2. Тактичне перехрестя (Crosshair Reticle) у точці, куди цілишся
  ctx.setLineDash([]);
  ctx.strokeStyle = crosshairColor;
  ctx.lineWidth = 1.5;

  // Зовнішнє коло прицілу
  ctx.beginPath();
  ctx.arc(aimX, aimY, 6.5, 0, Math.PI * 2);
  ctx.stroke();

  // 4 риски перехрестя
  const tickDist = 4;
  const tickLen = 5;
  ctx.beginPath();
  ctx.moveTo(aimX - tickDist - tickLen, aimY);
  ctx.lineTo(aimX - tickDist, aimY);
  ctx.moveTo(aimX + tickDist, aimY);
  ctx.lineTo(aimX + tickDist + tickLen, aimY);
  ctx.moveTo(aimX, aimY - tickDist - tickLen);
  ctx.lineTo(aimX, aimY - tickDist);
  ctx.moveTo(aimX, aimY + tickDist);
  ctx.lineTo(aimX, aimY + tickDist + tickLen);
  ctx.stroke();

  // Центральна точка прицілу
  ctx.fillStyle = crosshairColor;
  ctx.beginPath();
  ctx.arc(aimX, aimY, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Рендеринг шару кущів поверх мапи та танків
 */
export function drawBushesOverlay(ctx, bushes, tileSize) {
  if (!bushes || bushes.length === 0) return;
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      if (bushes[r] && bushes[r][c] === 1) {
        TILE_TYPES.BUSH.draw(ctx, c * tileSize, r * tileSize, tileSize);
        if (gameState && gameState.tileHp && gameState.tileHp[r] && typeof gameState.tileHp[r][c] === 'number') {
          const effTile = getEffectiveCellTile(r, c, gameState);
          const curHp = gameState.tileHp[r][c];
          if (effTile && effTile.destructible && effTile.maxHp > 1 && curHp < effTile.maxHp && curHp > 0) {
            const dmgLevel = (curHp === 1 && effTile.maxHp >= 3) ? 2 : 1;
            drawDamageCracks(ctx, c * tileSize, r * tileSize, tileSize, dmgLevel);
          }
        }
      }
    }
  }
}

/**
 * М'яке кругове світіння на землі під танком усередині кущів або диму
 */
export function drawBushUnderGlow(ctx, renderPos, size, isP1) {
  ctx.save();
  const cx = renderPos.x + size / 2;
  const cy = renderPos.y + size / 2;
  const pulse = Math.sin(Date.now() / 150) * 3;
  const rad = size * 0.72 + pulse;

  const grad = ctx.createRadialGradient(cx, cy, size * 0.15, cx, cy, rad);
  if (isP1) {
    grad.addColorStop(0, 'rgba(241, 196, 15, 0.45)');
    grad.addColorStop(1, 'rgba(241, 196, 15, 0)');
  } else {
    grad.addColorStop(0, 'rgba(46, 204, 113, 0.45)');
    grad.addColorStop(1, 'rgba(46, 204, 113, 0)');
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Спеціальна підсвітка танка у кущах або під димом (для себе та видимого ворога)
 * Малює чіткий контур корпусу з гусеницями, ПЕРЕДОМ (шеврон-стрілка ▲ + фари) та ЗАДОМ (червоні кормові вогні + решітка), а також дуло за turretAngle
 */
export function drawPlayerBushHighlight(ctx, tank, renderPos, tileSize, isEnemy = false) {
  const cx = renderPos.x + tank.size / 2;
  const cy = renderPos.y + tank.size / 2;
  const pulse = Math.sin(Date.now() / 160);

  ctx.save();

  const glowColor = tank.isP1 ? '#ffeaa7' : '#55efc4';
  const highlightColor = tank.isP1 ? '#f1c40f' : '#2ecc71';
  const half = tank.size / 2;
  const treadW = Math.max(4, Math.floor(tank.size * 0.22));
  const bAngle = Number.isFinite(renderPos.bodyAngle)
    ? renderPos.bodyAngle
    : (Number.isFinite(tank.bodyAngle) ? tank.bodyAngle : 0);
  const tAngle = Number.isFinite(renderPos.turretAngle)
    ? renderPos.turretAngle
    : (Number.isFinite(tank.turretAngle) ? tank.turretAngle : bAngle);

  // 1. Контур корпусу за bodyAngle з чітким розрізненням ПЕРЕДУ (-Y) та ЗАДУ (+Y)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(bAngle + Math.PI / 2);

  // Напівпрозора заливка та основний неоновий контур корпусу
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 10 + pulse * 4;
  ctx.fillStyle = tank.isP1 ? 'rgba(241, 196, 15, 0.24)' : 'rgba(46, 204, 113, 0.24)';
  ctx.fillRect(-half, -half, tank.size, tank.size);

  ctx.strokeStyle = glowColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(-half, -half, tank.size, tank.size);

  // Контури лівої та правої гусениць (щоб чітко читалась поздовжня вісь танка)
  ctx.lineWidth = 1.3;
  ctx.strokeRect(-half, -half, treadW, tank.size);
  ctx.strokeRect(half - treadW, -half, treadW, tank.size);

  // --- ПЕРЕД КОРПУСУ (-Y, напрямок руху вперед W): Яскравий шеврон-стрілка ▲ та передні фари ---
  ctx.fillStyle = '#fff375';
  ctx.fillRect(-half + 0.5, -half - 1, treadW - 1, 3);
  ctx.fillRect(half - treadW + 0.5, -half - 1, treadW - 1, 3);

  // Виступаючий передній вказівник напрямку корпусу (стрілка ПЕРЕД)
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = glowColor;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-half * 0.46, -half + 6);
  ctx.lineTo(0, -half - 4.5);
  ctx.lineTo(half * 0.46, -half + 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // --- ЗАД / КОРМА КОРПУСУ (+Y, напрямок руху назад S): Червона кормова смуга, стоп-вогні та решітка ---
  ctx.shadowBlur = 4;
  ctx.shadowColor = '#ff4757';
  ctx.fillStyle = '#ff4757';
  // Задні червоні габаритні ліхтарі на гусеницях та червоний кормовий борт
  ctx.fillRect(-half + 0.5, half - 3, treadW - 1, 3);
  ctx.fillRect(half - treadW + 0.5, half - 3, treadW - 1, 3);
  ctx.fillRect(-half + treadW + 1, half - 2.5, tank.size - treadW * 2 - 2, 2.5);

  // Поперечні лінії кормової решітки двигуна ззаду
  ctx.strokeStyle = 'rgba(255, 71, 87, 0.85)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-half + treadW + 2, half - 5.5);
  ctx.lineTo(half - treadW - 2, half - 5.5);
  ctx.moveTo(-half + treadW + 2, half - 8);
  ctx.lineTo(half - treadW - 2, half - 8);
  ctx.stroke();

  ctx.restore();

  // 2. Контур башти та дула за turretAngle
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tAngle + Math.PI / 2);

  const gunW = Math.max(3, Math.floor(tank.size * 0.14));
  const gunLen = Math.floor(tank.size * 0.56);
  ctx.strokeStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 6;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(5, tank.size * 0.22), 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeRect(-gunW / 2, -half - gunLen + 4, gunW, gunLen);
  ctx.restore();

  // 3. Анімований неоновий покажчик над танком
  const markerY = renderPos.y - 16 + pulse * 2;

  ctx.fillStyle = glowColor;
  ctx.shadowColor = highlightColor;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(cx, markerY + 5);
  ctx.lineTo(cx - 5, markerY);
  ctx.lineTo(cx + 5, markerY);
  ctx.closePath();
  ctx.fill();

  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.shadowBlur = 4;
  ctx.fillText(isEnemy ? 'ВОРОГ' : 'ТИ', cx, markerY - 3);

  ctx.restore();
}

export function drawMap(map, tileHp, iceGrid = null) {
  const ctx = ensureGameContext();
  if (!ctx) return;
  const wavePhase = Math.floor(Date.now() / 320) % 4;
  const isSnowStorm = gameState && gameState.currentMapEvent === 'snow_storm';

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const tileId = map[r][c];
      const hasIceUnder = (iceGrid && iceGrid[r] && iceGrid[r][c] === 1) || tileId === 10 || (isSnowStorm && (tileId === 3 || tileId === 8));
      const isGroundDecor = isGroundDecorTileId(tileId);

      // Якщо на клітинці є шар льоду (на рівні землі), спочатку малюємо лід.
      // Під час Снігової бурі вся мілка та глибока вода стає льодом!
      if (hasIceUnder) {
        TILE_TYPES.ICE.draw(ctx, c * tileSize, r * tileSize, tileSize, wavePhase, 1);
        if (tileId === 0 || tileId === 10 || isGroundDecor || tileId === 9 || tileId === 3 || tileId === 8) continue;
      } else if (isSnowStorm && (tileId === 0 || isGroundDecor || tileId === 9)) {
        // Під час Снігової бурі вся підлога стає снігом
        TILE_TYPES.SNOW.draw(ctx, c * tileSize, r * tileSize, tileSize, wavePhase, 1);
        continue;
      } else if (tileId === 9) {
        // Для низьких кущів (id: 9) на рівні землі малюємо лише ґрунт; саме листя малюється між корпусом і вежею танка!
        TILE_TYPES.EMPTY.draw(ctx, c * tileSize, r * tileSize, tileSize, wavePhase, 1);
        continue;
      }

      const block = TILE_BY_ID[tileId] || TILE_TYPES.EMPTY;
      const hp = (tileHp && tileHp[r]) ? tileHp[r][c] : (block.maxHp || 1);
      block.draw(ctx, c * tileSize, r * tileSize, tileSize, wavePhase, hp);

      // Якщо блок зазнав пошкоджень (зокрема під час події «Обман зору», де блок зовні може виглядати як бетон/кущ/вода) — гарантовано малюємо тріщини поверх нього!
      const effTile = getEffectiveCellTile(r, c, gameState);
      if (effTile && effTile.destructible && effTile.maxHp > 1 && hp < effTile.maxHp && hp > 0) {
        if (tileId !== 1 && tileId !== 5 && tileId !== 6) {
          const dmgLevel = (hp === 1 && effTile.maxHp >= 3) ? 2 : 1;
          drawDamageCracks(ctx, c * tileSize, r * tileSize, tileSize, dmgLevel);
        }
      }
    }
  }
}

/**
 * Малювання листя низьких кущів (id: 9) ПОВЕРХ корпусів танків, але ПІД вежею та дулом танків!
 */
export function drawLowBushesOverlay(ctx, map, size = tileSize) {
  if (!ctx || !map) return;
  for (let r = 0; r < map.length; r++) {
    if (!map[r]) continue;
    for (let c = 0; c < map[r].length; c++) {
      if (map[r][c] === 9) {
        drawLowBushFoliage(ctx, c * size, r * size, size);
      }
    }
  }
}

export function drawGame() {
  if (!p1Tank || !p2Tank) return;
  const ctx = ensureGameContext();
  if (!ctx) return;

  // 0. Завжди скидаємо матрицю трансформації до одиничної (0, 0) для унеможливлення зсуву поля
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  ctx.save();
  try {
    // Ефект тряски камери (Screen Shake)
    consumeScreenShake(ctx);

    ctx.clearRect(-20, -20, canvasWidth + 40, canvasHeight + 40);

  // 1. Малювання базової мапи (з підтримкою льоду під блоками)
  drawMap(gameState.map, gameState.tileHp, gameState.ice);

  // 2. Плавна інтерполяція рендера для всіх активних танків
  const allTanks = (gameState && Array.isArray(gameState.tanks) && gameState.tanks.length > 0)
    ? gameState.tanks
    : [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean);

  allTanks.forEach(t => {
    if (!t) return;
    const key = `p${t.id}`;
    if (renderTanks[key]) {
      renderTanks[key].x += (t.x - renderTanks[key].x) * 0.45;
      renderTanks[key].y += (t.y - renderTanks[key].y) * 0.45;
      renderTanks[key].bodyAngle = lerpAngle(renderTanks[key].bodyAngle, t.bodyAngle, 0.45);
      renderTanks[key].turretAngle = lerpAngle(renderTanks[key].turretAngle, t.turretAngle, 0.6);
    }
  });

  const myId = Network.myPlayerId || 1;
  const myTank = allTanks.find(t => t && t.id === myId) || p1Tank || allTanks[0];
  const myRenderPos = renderTanks[`p${myTank ? myTank.id : 1}`];
  const otherTanks = allTanks.filter(t => t && t.id !== (myTank ? myTank.id : myId));

  // 2.0. Малювання слідів від гусениць на землі (Tracks):
  // Свої сліди видно завжди, а ворожі — тільки при прямій видимості (як ворога/кулі)
  trackMarks.forEach(t => {
    if (canPlayerSeeTrack(myTank, t, gameState.map, tileSize)) {
      t.draw(ctx);
    }
  });

  // 2.1. Тактичний конус погляду (50° / 90° / 110° за вежею) для власного танка
  if (myTank && !myTank.isDead) {
    drawVisionCone(ctx, myTank, myRenderPos, canvasWidth, canvasHeight);
  }

  // 2.15. Малювання встановлених мін (власні видно завжди, ворожі — тільки при ВХ або в полі зору зі Слідом виявлення)
  if (gameState.mines && gameState.mines.length > 0) {
    gameState.mines.forEach(mine => {
      if (canPlayerSeeMine(myTank, mine, gameState.map, tileSize)) {
        mine.draw(ctx, mine.ownerId === myTank.id);
      }
    });
  }

  // 2.2. Малювання уламків цегли (Debris)
  debrisParticles.forEach(d => d.draw(ctx));

  const isMySniperStealth = isTankSniperCamouflaged(myTank);

  // Підсвітка малюється у високих кущах, під димом, або при активному Маяку/Радарі
  const showMyOverlayHighlight = shouldDrawTankOverlayHighlight(myTank, gameState.bushes, gameState.smokeClouds, tileSize, myRenderPos);

  // Свічення під власним танком у високих кущах або під димом (на рівні землі)
  if (showMyOverlayHighlight && myTank && !myTank.isDead) {
    drawBushUnderGlow(ctx, myRenderPos, myTank.size, myTank.isP1);
  }

  // Свічення під іншими танками
  otherTanks.forEach(otherTank => {
    if (!otherTank || otherTank.isDead) return;
    const isAlly = myTank && otherTank.team === myTank.team;
    const canSee = isAlly || (gameState.visibility && typeof gameState.visibility.canSee === 'function'
      ? gameState.visibility.canSee(myTank.id, otherTank.id)
      : (myTank.id === 1 ? gameState.visibility.p1CanSeeP2 : gameState.visibility.p2CanSeeP1));
    const otherRenderPos = renderTanks[`p${otherTank.id}`];
    const showHighlight = shouldDrawTankOverlayHighlight(otherTank, gameState.bushes, gameState.smokeClouds, tileSize, otherRenderPos) ||
      Boolean(myTank && (myTank.spotActiveTimer || 0) > 0);
    if (canSee && showHighlight) {
      drawBushUnderGlow(ctx, otherRenderPos, otherTank.size, otherTank.isP1);
    }
  });

  // 3. Малювання танків у два шари з низькими кущами між корпусом і вежею:
  // 3а. Спочатку малюємо КОРПУСИ танків (layer = 'hull')
  const myDrawAlpha = isMySniperStealth ? 0.62 : 1.0;
  if (myTank) {
    myTank.draw(ctx, myRenderPos, false, myDrawAlpha, 'hull');
  }

  otherTanks.forEach(otherTank => {
    if (!otherTank || otherTank.isDead) return;
    const isAlly = myTank && otherTank.team === myTank.team;
    const canSee = isAlly || (gameState.visibility && typeof gameState.visibility.canSee === 'function'
      ? gameState.visibility.canSee(myTank.id, otherTank.id)
      : (myTank.id === 1 ? gameState.visibility.p1CanSeeP2 : gameState.visibility.p2CanSeeP1));
    const otherRenderPos = renderTanks[`p${otherTank.id}`];
    const isCamouflaged = isTankCamouflaged(otherTank, gameState.bushes, gameState.map, tileSize) || isTankSniperCamouflaged(otherTank);
    const inSmoke = isTankInSmoke(otherTank, gameState.smokeClouds, otherRenderPos);

    if (canSee) {
      otherTank.draw(ctx, otherRenderPos, false, 1.0, 'hull');
      if (!isAlly && otherTanks.length === 1) {
        lastKnownEnemy.x = otherRenderPos.x;
        lastKnownEnemy.y = otherRenderPos.y;
        lastKnownEnemy.bodyAngle = otherRenderPos.bodyAngle;
        lastKnownEnemy.turretAngle = otherRenderPos.turretAngle;
        lastKnownEnemy.alpha = (isCamouflaged || inSmoke) ? 0 : 0.55;
      }
    } else if (!isAlly && otherTanks.length === 1 && lastKnownEnemy.alpha > 0 && !isCamouflaged && !inSmoke) {
      otherTank.draw(ctx, lastKnownEnemy, true, lastKnownEnemy.alpha, 'hull');
    }
  });

  // 3б. Малюємо листя НИЗЬКИХ КУЩІВ (id: 9) поверх корпусу танка, але під вежею та дулом!
  drawLowBushesOverlay(ctx, gameState.map, tileSize);

  // 3в. Малюємо ВЕЖУ та ДУЛО танків (layer = 'turret') поверх низьких кущів!
  if (myTank) {
    myTank.draw(ctx, myRenderPos, false, myDrawAlpha, 'turret');
  }

  otherTanks.forEach(otherTank => {
    if (!otherTank || otherTank.isDead) return;
    const isAlly = myTank && otherTank.team === myTank.team;
    const canSee = isAlly || (gameState.visibility && typeof gameState.visibility.canSee === 'function'
      ? gameState.visibility.canSee(myTank.id, otherTank.id)
      : (myTank.id === 1 ? gameState.visibility.p1CanSeeP2 : gameState.visibility.p2CanSeeP1));
    const otherRenderPos = renderTanks[`p${otherTank.id}`];
    const isCamouflaged = isTankCamouflaged(otherTank, gameState.bushes, gameState.map, tileSize) || isTankSniperCamouflaged(otherTank);
    const inSmoke = isTankInSmoke(otherTank, gameState.smokeClouds, otherRenderPos);

    if (canSee) {
      otherTank.draw(ctx, otherRenderPos, false, 1.0, 'turret');
    } else if (!isAlly && otherTanks.length === 1 && lastKnownEnemy.alpha > 0 && !isCamouflaged && !inSmoke) {
      otherTank.draw(ctx, lastKnownEnemy, true, lastKnownEnemy.alpha, 'turret');
      lastKnownEnemy.alpha = Math.max(0, lastKnownEnemy.alpha - 0.005);
    }
  });

  // 3.9. Малювання трасувальних слідів снайпера (TracerTrail)
  tracerTrails.forEach(tr => {
    if (canPlayerSeeTracer(myTank, tr, gameState.map, tileSize)) {
      tr.draw(ctx);
    }
  });

  // 4. Малювання снарядів (видно тільки власні та ворожі при прямій видимості)
  gameState.bullets.forEach(b => {
    if (canPlayerSeeBullet(myTank, b, gameState.map, tileSize)) {
      b.draw(ctx);
    }
  });

  // 5. Малювання спалахів та диму з дула
  muzzleFlashes.forEach(m => {
    if (canPlayerSeeMuzzleEffect(myTank, m, gameState.map, tileSize)) {
      m.draw(ctx);
    }
  });
  smokeParticles.forEach(s => {
    if (canPlayerSeeMuzzleEffect(myTank, s, gameState.map, tileSize)) {
      s.draw(ctx);
    }
  });

  // 6. Малювання вибухів та попереджувальних зон артилерії (1 сек до удару)
  if (gameState.pendingArtilleryStrikes && gameState.pendingArtilleryStrikes.length > 0) {
    drawPendingArtilleryStrikes(ctx, gameState.pendingArtilleryStrikes);
  }
  if (gameState.envArtilleryStrikes && gameState.envArtilleryStrikes.length > 0) {
    drawEnvironmentalArtilleryStrikes(ctx, gameState.envArtilleryStrikes);
  }
  gameState.explosions.forEach(exp => exp.draw(ctx));

  // 6.1. Безпечна зона Батл Рояль
  if (gameState.currentMapEvent === 'battle_royale' && gameState.battleRoyaleZone) {
    drawBattleRoyaleZone(ctx, gameState.battleRoyaleZone);
  }

  // 6.15. Аномальні літаючі сфери (chaos_orbs)
  if (gameState.flyingOrbs && gameState.flyingOrbs.length > 0) {
    gameState.flyingOrbs.forEach(orb => {
      if (orb && typeof orb.draw === 'function') orb.draw(ctx);
    });
  }

  // 6.2. Погодні ефекти (Кислотний дощ, Снігова буря)
  drawWeatherEffects(ctx, gameState, canvasWidth, canvasHeight);

  // 7. Малювання шару кущів (ВЕРХНІЙ ШАР) та димових завіс 3x3 (SmokeCloud)
  drawBushesOverlay(ctx, gameState.bushes, tileSize);

  if (gameState.smokeClouds && gameState.smokeClouds.length > 0) {
    gameState.smokeClouds.forEach(sc => {
      sc.draw(ctx, sc.ownerId === myTank.id);
    });
  }

  // 8. ПІДСВІТКА ТАНКІВ У ВИСОКИХ КУЩАХ АБО ПІД ДИМОМ (на воді підсвітка вимкнена!)
  if (showMyOverlayHighlight && !myTank.isDead) {
    drawPlayerBushHighlight(ctx, myTank, myRenderPos, tileSize, false);
  }
  otherTanks.forEach(otherTank => {
    if (!otherTank || otherTank.isDead) return;
    const isAlly = myTank && otherTank.team === myTank.team;
    const canSee = isAlly || (gameState.visibility && typeof gameState.visibility.canSee === 'function'
      ? gameState.visibility.canSee(myTank.id, otherTank.id)
      : (myTank.id === 1 ? gameState.visibility?.p1CanSeeP2 : gameState.visibility?.p2CanSeeP1));
    const otherRenderPos = renderTanks[`p${otherTank.id}`];
    const showHighlight = shouldDrawTankOverlayHighlight(otherTank, gameState.bushes, gameState.smokeClouds, tileSize, otherRenderPos) ||
      Boolean(myTank && (myTank.spotActiveTimer || 0) > 0);
    if (canSee && showHighlight) {
      drawPlayerBushHighlight(ctx, otherTank, otherRenderPos, tileSize, true);
    }
  });

  // 8.5. Подія «Пітьма»: накладання темного савану на мапу
  if (gameState.currentMapEvent === 'darkness' && myTank && !myTank.isDead) {
    drawDarknessOverlay(ctx, myTank, myRenderPos, otherTanks);
  }

  // 8.1. ІНДИКАТОР ПЕРЕЗАРЯДКИ КАСЕТИ — ТІЛЬКИ ДЛЯ ВЛАСНОГО ТАНКА (ворог перезарядку НЕ бачить!)
  if (myTank && !myTank.isDead) {
    myTank.drawReloadIndicator(ctx, myRenderPos);
  }

  // 9. Універсальне виділення вибраного блоку під курсором миші (для Артилерії 3x3 та майбутніх механік блоків)
  if (myTank && !myTank.isDead && !gameState.gameOver && myTank.targetingMode) {
    drawBlockTargetingOverlay(ctx, myTank, mouseX, mouseY);
  }

  // 10. Штрих-пунктирна лінія прицілювання від танка до точки миші (приціл)
  if (myTank && !myTank.isDead && !gameState.gameOver) {
    drawAimGuide(ctx, myTank, myRenderPos, mouseX, mouseY);
  }

  // 11. Таймер раунду на полі бою (стає прозорим, коли поруч знаходиться танк або приціл)
  drawRoundTimer(ctx, myTank, myRenderPos, otherTanks);

  // 12. Ефект осліплення (білий екран на 1.5 сек) від здібності «Світлошумовий снаряд»
  if (myTank && (myTank.blindTimer || 0) > 0 && !gameState.gameOver) {
    drawFlashbangOverlay(ctx, myTank.blindTimer);
  }

  // 13. Банер події на карті (триває 3 секунди на початку раунду, таймер зменшується в такті фізики 60 FPS)
  if (gameState.mapEventBannerTimer > 0) {
    drawMapEventBanner(ctx, gameState.currentMapEvent, gameState.mapEventBannerTimer);
  }
  } catch (err) {
    console.error('Помилка у пайплайні drawGame:', err);
  } finally {
    ctx.restore();
  }
}

/**
 * Рендеринг попереджувальної зони удару Артилерії 3x3 протягом 1 секунди (60 кадрів) перед детонацією
 */
export function drawPendingArtilleryStrikes(ctx, strikes) {
  if (!ctx || !Array.isArray(strikes) || strikes.length === 0) return;
  ctx.save();
  for (const s of strikes) {
    const curFrames = typeof s.timerFrames === 'number' ? s.timerFrames : (typeof s.timer === 'number' ? s.timer : 0);
    const maxFrames = typeof s.maxFrames === 'number' ? s.maxFrames : (typeof s.maxTimer === 'number' ? s.maxTimer : 60);
    const progress = 1 - Math.max(0, Math.min(1, curFrames / maxFrames));
    const pulse = (Math.sin(Date.now() / 65) + 1) * 0.5;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = s.centerRow + dr;
        const c = s.centerCol + dc;
        if (r < 0 || r >= gridRows || c < 0 || c >= gridCols) continue;
        const rx = c * tileSize;
        const ry = r * tileSize;
        const isCenter = (dr === 0 && dc === 0);
        ctx.fillStyle = isCenter
          ? `rgba(255, 71, 87, ${0.28 + pulse * 0.25})`
          : `rgba(255, 165, 2, ${0.16 + pulse * 0.14})`;
        ctx.fillRect(rx, ry, tileSize, tileSize);
        ctx.strokeStyle = isCenter ? '#ff4757' : 'rgba(255, 165, 2, 0.85)';
        ctx.lineWidth = isCenter ? 2.2 : 1.3;
        ctx.strokeRect(rx + 1, ry + 1, tileSize - 2, tileSize - 2);
      }
    }
    // Звужувальне кільце відліку 1 секунди у центрі удару
    const cx = (s.centerCol + 0.5) * tileSize;
    const cy = (s.centerRow + 0.5) * tileSize;
    const maxRad = tileSize * 1.45;
    const curRad = Math.max(4, maxRad * (1 - progress));
    ctx.strokeStyle = '#ff4757';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(cx, cy, curRad, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Ефект осліплення (білий екран на 1.5 сек = 90 кадрів) від здібності «Світлошумовий снаряд»
 */
export function drawFlashbangOverlay(ctx, blindTimer) {
  if (!ctx || blindTimer <= 0) return;
  ctx.save();
  // Повна біла заливка перші ~60 кадрів (1.0 с), потім плавне згасання за останні 30 кадрів (0.5 с)
  const alpha = blindTimer > 30 ? 0.96 : Math.max(0, (blindTimer / 30) * 0.96);
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
  ctx.fillRect(-20, -20, canvasWidth + 40, canvasHeight + 40);
  ctx.restore();
}

/**
 * Універсальна візуалізація вибору блоку на арені (використовується для Артилерії 3x3 та майбутніх механік з блоками)
 */
export function drawBlockTargetingOverlay(ctx, tank, targetX, targetY) {
  if (!ctx || !tank || !tank.targetingMode) return;
  const hoverCol = Math.max(0, Math.min(gridCols - 1, Math.floor((Number.isFinite(targetX) ? targetX : canvasWidth / 2) / tileSize)));
  const hoverRow = Math.max(0, Math.min(gridRows - 1, Math.floor((Number.isFinite(targetY) ? targetY : canvasHeight / 2) / tileSize)));

  const pulse = (Math.sin(Date.now() / 130) + 1) * 0.5;
  const isArtillery = tank.targetingMode === 'artillery';
  const radius = isArtillery ? 1 : 0;

  ctx.save();

  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const r = hoverRow + dr;
      const c = hoverCol + dc;
      if (r < 0 || r >= gridRows || c < 0 || c >= gridCols) continue;

      const isCenter = (dr === 0 && dc === 0);
      const rx = c * tileSize;
      const ry = r * tileSize;

      if (isCenter) {
        // Центральний вибраний блок (урон 60 + руйнує навіть бетон)
        ctx.fillStyle = `rgba(255, 71, 87, ${0.26 + pulse * 0.14})`;
        ctx.fillRect(rx, ry, tileSize, tileSize);

        ctx.strokeStyle = '#ff4757';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([]);
        ctx.strokeRect(rx + 1, ry + 1, tileSize - 2, tileSize - 2);

        // Кутові тактичні дужки виділеного блоку
        const corner = Math.max(5, Math.floor(tileSize * 0.26));
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        // Верхній лівий
        ctx.moveTo(rx + 2, ry + 2 + corner);
        ctx.lineTo(rx + 2, ry + 2);
        ctx.lineTo(rx + 2 + corner, ry + 2);
        // Верхній правий
        ctx.moveTo(rx + tileSize - 2 - corner, ry + 2);
        ctx.lineTo(rx + tileSize - 2, ry + 2);
        ctx.lineTo(rx + tileSize - 2, ry + 2 + corner);
        // Нижній лівий
        ctx.moveTo(rx + 2, ry + tileSize - 2 - corner);
        ctx.lineTo(rx + 2, ry + tileSize - 2);
        ctx.lineTo(rx + 2 + corner, ry + tileSize - 2);
        // Нижній правий
        ctx.moveTo(rx + tileSize - 2 - corner, ry + tileSize - 2);
        ctx.lineTo(rx + tileSize - 2, ry + tileSize - 2);
        ctx.lineTo(rx + tileSize - 2, ry + tileSize - 2 - corner);
        ctx.stroke();

        if (isArtillery && tileSize >= 22) {
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = '#000000';
          ctx.shadowBlur = 4;
          ctx.fillText('60', rx + tileSize / 2, ry + tileSize / 2);
          ctx.shadowBlur = 0;
        }
      } else {
        // Периметр 3x3 навколо центрального блоку (урон 25)
        ctx.fillStyle = `rgba(255, 165, 2, ${0.14 + pulse * 0.08})`;
        ctx.fillRect(rx, ry, tileSize, tileSize);

        ctx.strokeStyle = 'rgba(255, 165, 2, 0.8)';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(rx + 1, ry + 1, tileSize - 2, tileSize - 2);
        ctx.setLineDash([]);

        if (isArtillery && tileSize >= 24) {
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(255, 234, 167, 0.9)';
          ctx.fillText('25', rx + tileSize / 2, ry + tileSize / 2);
        }
      }
    }
  }

  // Підказка над зоною прицілювання
  const zoneTopY = (hoverRow - radius) * tileSize;
  const zoneBottomY = (hoverRow + radius + 1) * tileSize;
  const labelX = Math.max(75, Math.min(canvasWidth - 75, (hoverCol + 0.5) * tileSize));
  const labelY = zoneTopY > 24 ? (zoneTopY - 8) : Math.min(canvasHeight - 8, zoneBottomY + 14);

  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(10, 14, 20, 0.82)';
  const labelText = isArtillery ? '🎯 ЛКМ: ЗАЛП 3×3 (60/25)' : '🎯 ЛКМ: ВИБРАТИ БЛОК';
  const metrics = ctx.measureText(labelText);
  const bw = Math.ceil(metrics.width) + 12;
  const bh = 16;
  ctx.fillRect(labelX - bw / 2, labelY - bh / 2, bw, bh);
  ctx.strokeStyle = '#ff4757';
  ctx.lineWidth = 1;
  ctx.strokeRect(labelX - bw / 2, labelY - bh / 2, bw, bh);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(labelText, labelX, labelY);

  ctx.restore();
}

/**
 * Рендеринг таймера раунду у верхній центральній частині поля бою:
 * стає напівпрозорим (alpha ~0.16), коли біля нього проїжджає будь-який видимий танк або наведено курсор миші.
 */
export function drawRoundTimer(ctx, myTank, myRenderPos, otherTanks = []) {
  if (!ctx || !gameState) return;

  const totalSec = Math.max(0, Math.floor((gameState.roundTimeFrames || 0) / 60));
  const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const secs = String(totalSec % 60).padStart(2, '0');
  const timeStr = `${mins}:${secs}`;

  const pillW = 76;
  const pillH = 24;
  const centerX = canvasWidth / 2;
  const centerY = 17;
  const pillX = Math.round(centerX - pillW / 2);
  const pillY = Math.round(centerY - pillH / 2);

  // Перевірка відстані від танків (і курсора) до таймера для автоматичної прозорості
  let minTankDist = Infinity;
  if (myTank && !myTank.isDead) {
    const pos = myRenderPos || myTank;
    const tx = pos.x + myTank.size / 2;
    const ty = pos.y + myTank.size / 2;
    minTankDist = Math.min(minTankDist, Math.hypot(tx - centerX, ty - centerY));
  }
  if (Array.isArray(otherTanks)) {
    otherTanks.forEach(ot => {
      if (!ot || ot.isDead) return;
      const isAlly = myTank && ot.team === myTank.team;
      const canSee = isAlly || (gameState.visibility && typeof gameState.visibility.canSee === 'function'
        ? gameState.visibility.canSee(myTank ? myTank.id : 1, ot.id)
        : (myTank && myTank.id === 1 ? gameState.visibility?.p1CanSeeP2 : gameState.visibility?.p2CanSeeP1));
      if (canSee) {
        const oPos = renderTanks[`p${ot.id}`] || ot;
        const ox = oPos.x + ot.size / 2;
        const oy = oPos.y + ot.size / 2;
        minTankDist = Math.min(minTankDist, Math.hypot(ox - centerX, oy - centerY));
      }
    });
  }

  const fadeRadius = Math.max(92, tileSize * 2.8);
  let alpha = 0.78;
  if (minTankDist < fadeRadius) {
    // Плавний перехід до прозорості 0.16, коли танк наближається до таймера
    const ratio = Math.max(0, minTankDist / fadeRadius);
    alpha = 0.15 + ratio * 0.45;
  } else if (Number.isFinite(mouseX) && Number.isFinite(mouseY)) {
    const cursorDist = Math.hypot(mouseX - centerX, mouseY - centerY);
    if (cursorDist < 55) {
      alpha = 0.25;
    }
  }

  ctx.save();
  try {
    ctx.globalAlpha = alpha;

    // Напівпрозора капсула таймера
    ctx.fillStyle = 'rgba(11, 15, 22, 0.82)';
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
    ctx.lineWidth = 1.2;

    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(pillX, pillY, pillW, pillH, 6);
    } else if (typeof ctx.rect === 'function') {
      ctx.rect(pillX, pillY, pillW, pillH);
    }
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#eaf6ff';
    ctx.fillText(`⏱ ${timeStr}`, centerX, centerY + 0.5);
  } finally {
    ctx.restore();
  }
}

/**
 * Рендеринг зон попередження артилерійського обстрілу від події на карті (artillery_barrage, 2.5с = 150 кадрів)
 */
export function drawEnvironmentalArtilleryStrikes(ctx, strikes) {
  if (!ctx || !Array.isArray(strikes) || strikes.length === 0) return;
  ctx.save();
  try {
    for (const s of strikes) {
      const progress = 1 - Math.max(0, Math.min(1, (s.timerFrames || 0) / (s.maxFrames || 150)));
      const pulse = (Math.sin(Date.now() / 65) + 1) * 0.5;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const r = s.centerRow + dr;
          const c = s.centerCol + dc;
          if (r < 0 || r >= gridRows || c < 0 || c >= gridCols) continue;
          const rx = c * tileSize;
          const ry = r * tileSize;
          const isCenter = (dr === 0 && dc === 0);
          ctx.fillStyle = isCenter
            ? `rgba(235, 47, 6, ${0.32 + pulse * 0.28})`
            : `rgba(250, 152, 58, ${0.18 + pulse * 0.16})`;
          ctx.fillRect(rx, ry, tileSize, tileSize);
          ctx.strokeStyle = isCenter ? '#eb2f06' : 'rgba(250, 152, 58, 0.9)';
          ctx.lineWidth = isCenter ? 2.4 : 1.3;
          ctx.strokeRect(rx + 1, ry + 1, tileSize - 2, tileSize - 2);
        }
      }
      // Звужувальне кільце відліку 2.5 секунди у центрі удару
      const cx = (s.centerCol + 0.5) * tileSize;
      const cy = (s.centerRow + 0.5) * tileSize;
      const maxRad = tileSize * 1.5;
      const curRad = Math.max(4, maxRad * (1 - progress));
      ctx.strokeStyle = '#eb2f06';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(cx, cy, curRad, 0, Math.PI * 2);
      ctx.stroke();

      const secLeft = Math.max(0, (s.timerFrames || 0) / 60).toFixed(1);
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 4;
      ctx.fillText(`${secLeft}с`, cx, cy);
      ctx.shadowBlur = 0;
    }
  } finally {
    ctx.restore();
  }
}

/**
 * Рендеринг зони звуження Батл Рояль (battle_royale):
 * Червоний небезпечний саван поза безпечним колом та неонова лінія кордону
 */
export function drawBattleRoyaleZone(ctx, zone) {
  if (!ctx || !zone || typeof zone.radius !== 'number') return;
  const cx = zone.cx ?? zone.x ?? (canvasWidth / 2);
  const cy = zone.cy ?? zone.y ?? (canvasHeight / 2);
  const rad = Math.max(0, zone.radius);
  const roundFrames = (gameState && typeof gameState.roundTimeFrames === 'number') ? gameState.roundTimeFrames : 0;
  const isBeforeShrink = roundFrames < 1200;

  ctx.save();
  if (isBeforeShrink) {
    // До початку звуження (перші 20 секунд = 1200 кадрів):
    // Поле НЕ червоне! Показуємо таймер до початку звуження та тонкий попереджувальний контур
    const secLeft = Math.max(0, Math.ceil((1200 - roundFrames) / 60));
    const pulse = (Math.sin(Date.now() / 150) + 1) * 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, rad - 4, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 71, 87, ${0.4 + pulse * 0.35})`;
    ctx.lineWidth = 2.0;
    ctx.setLineDash([10, 8]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Акуратний бейдж попередження під таймером раунду
    const badgeW = 270;
    const badgeH = 22;
    const bx = (canvasWidth - badgeW) / 2;
    const by = 34;
    ctx.fillStyle = 'rgba(12, 16, 24, 0.88)';
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(bx, by, badgeW, badgeH, 6);
    } else {
      ctx.rect(bx, by, badgeW, badgeH);
    }
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff6b6b';
    ctx.fillText(`⚠️ ЗОНА ЗВУЖУВАТИМЕТЬСЯ ЧЕРЕЗ ${secLeft}с`, canvasWidth / 2, by + badgeH / 2);
  } else {
    // Небезпечний червоний туман поза звуженою зоною
    ctx.beginPath();
    ctx.rect(-20, -20, canvasWidth + 40, canvasHeight + 40);
    ctx.arc(cx, cy, rad, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(231, 76, 60, 0.22)';
    ctx.fill();

    // Неонове пульсуюче кільце межі зони
    const pulse = (Math.sin(Date.now() / 120) + 1) * 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 71, 87, ${0.7 + pulse * 0.3})`;
    ctx.lineWidth = 2.4;
    ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

let darknessCanvas = null;

/**
 * Рендеринг пітьми (darkness):
 * Освітлена тільки невелика зона біля танка (~70px) та сектор огляду (FOV).
 * При наявності ВХ (hasWallhack) ворожий танк видно крізь пітьму.
 */
export function drawDarknessOverlay(ctx, myTank, myRenderPos, otherTanks = []) {
  if (!ctx || !myTank || myTank.isDead) return;
  const cx = myRenderPos ? (myRenderPos.x + myTank.size / 2) : (myTank.x + myTank.size / 2);
  const cy = myRenderPos ? (myRenderPos.y + myTank.size / 2) : (myTank.y + myTank.size / 2);
  const fovDegrees = myTank.fov || (TURRET_TYPES[myTank.turretType] && TURRET_TYPES[myTank.turretType].fov) || 90;
  const halfFovRad = (fovDegrees / 2) * (Math.PI / 180);
  const baseAngle = Number.isFinite(myRenderPos?.turretAngle) ? myRenderPos.turretAngle : (myTank.turretAngle || 0);
  const startAngle = baseAngle - halfFovRad;
  const endAngle = baseAngle + halfFovRad;
  const maxRange = Math.max(canvasWidth, canvasHeight) * 1.25;
  const proximityRadius = Math.min(75, tileSize * 2.2);

  if (!darknessCanvas && typeof document !== 'undefined') {
    darknessCanvas = document.createElement('canvas');
  }
  if (!darknessCanvas) return;
  if (darknessCanvas.width !== canvasWidth || darknessCanvas.height !== canvasHeight) {
    darknessCanvas.width = canvasWidth;
    darknessCanvas.height = canvasHeight;
  }
  const dCtx = darknessCanvas.getContext('2d');
  dCtx.clearRect(0, 0, canvasWidth, canvasHeight);

  // 1. Повна чорна пітьма
  dCtx.fillStyle = 'rgba(6, 8, 12, 0.96)';
  dCtx.fillRect(0, 0, canvasWidth, canvasHeight);

  // 2. Вирізаємо освітлені ділянки через destination-out
  dCtx.globalCompositeOperation = 'destination-out';

  // 2а. Освітлена зона біля танка (~70-75px)
  const proxGrad = dCtx.createRadialGradient(cx, cy, proximityRadius * 0.45, cx, cy, proximityRadius);
  proxGrad.addColorStop(0, 'rgba(0, 0, 0, 1.0)');
  proxGrad.addColorStop(0.85, 'rgba(0, 0, 0, 0.9)');
  proxGrad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
  dCtx.fillStyle = proxGrad;
  dCtx.beginPath();
  dCtx.arc(cx, cy, proximityRadius, 0, Math.PI * 2);
  dCtx.fill();

  // 2б. Освітлений сектор огляду за конусом вежі
  const coneGrad = dCtx.createRadialGradient(cx, cy, myTank.size * 0.4, cx, cy, maxRange * 0.7);
  coneGrad.addColorStop(0, 'rgba(0, 0, 0, 1.0)');
  coneGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0.92)');
  coneGrad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
  dCtx.fillStyle = coneGrad;
  dCtx.beginPath();
  dCtx.moveTo(cx, cy);
  dCtx.arc(cx, cy, maxRange, startAngle, endAngle);
  dCtx.closePath();
  dCtx.fill();

  dCtx.globalCompositeOperation = 'source-over';

  // 3. Накладаємо маску пітьми на головне полотно
  ctx.save();
  ctx.drawImage(darknessCanvas, 0, 0);
  ctx.restore();

  // 4. "З вх видно гравця (тільки гравця)"
  if (myTank.hasWallhack && Array.isArray(otherTanks)) {
    otherTanks.forEach(enemyTank => {
      if (!enemyTank || enemyTank.isDead) return;
      const isAlly = myTank && enemyTank.team === myTank.team;
      if (isAlly) return;
      const canSee = gameState.visibility && typeof gameState.visibility.canSee === 'function'
        ? gameState.visibility.canSee(myTank.id, enemyTank.id)
        : (myTank.id === 1 ? gameState.visibility?.p1CanSeeP2 : gameState.visibility?.p2CanSeeP1);
      if (!canSee) return;
      const ePos = renderTanks[`p${enemyTank.id}`] || enemyTank;
      const ec = enemyTank.getCenter();
      const distToMe = Math.hypot(ec.x - cx, ec.y - cy);
      const inProx = distToMe <= proximityRadius;
      const inCone = isInVisionCone(myTank, ec.x, ec.y, fovDegrees);
      if (!inProx && !inCone) {
        ctx.save();
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 12;
        enemyTank.draw(ctx, ePos, false, 0.95, 'all');
        ctx.shadowBlur = 0;
        ctx.restore();
      }
    });
  }
}

/**
 * Рендеринг банера оголошення події на карті або звичайної гри тривалістю ~3.0 секунди (180 кадрів)
 */
export function drawMapEventBanner(ctx, eventId, timerFrames) {
  if (!ctx || timerFrames <= 0) return;
  const eventInfo = (eventId && MAP_EVENTS && MAP_EVENTS[eventId]) ? MAP_EVENTS[eventId] : {
    icon: '☀️',
    name: 'Звичайна гра',
    desc: 'Класичні правила бою без додаткових модифікаторів арени'
  };

  let alpha = 1.0;
  if (timerFrames > 160) {
    alpha = (180 - timerFrames) / 20;
  } else if (timerFrames < 25) {
    alpha = timerFrames / 25;
  }
  alpha = Math.max(0, Math.min(1, alpha));

  ctx.save();
  ctx.globalAlpha = alpha;

  const bannerW = Math.min(520, canvasWidth - 32);
  const bannerH = 68;
  const bx = (canvasWidth - bannerW) / 2;
  const by = 38;

  ctx.fillStyle = 'rgba(10, 14, 24, 0.94)';
  ctx.strokeStyle = eventId ? '#00e5ff' : '#2ecc71';
  ctx.lineWidth = 2.5;
  ctx.shadowColor = eventId ? '#00e5ff' : '#2ecc71';
  ctx.shadowBlur = 14;

  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(bx, by, bannerW, bannerH, 10);
  } else {
    ctx.rect(bx, by, bannerW, bannerH);
  }
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${eventInfo.icon} ПОДІЯ: ${eventInfo.name.toUpperCase()}!`, canvasWidth / 2, by + 24);

  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#cbd5e1';
  ctx.fillText(eventInfo.desc || eventInfo.description || '', canvasWidth / 2, by + 48);

  ctx.restore();
}
