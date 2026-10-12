/**
 * @file renderer.js
 * @description Модуль візуалізації ігрового поля (Canvas 2D): мапа, шари кущів, конус погляду, приціл, підсвітка та головний кадр drawGame.
 */

import { TURRET_TYPES } from './config.js?v=20261011_v17';
import { TILE_TYPES, TILE_BY_ID, drawLowBushFoliage, isGroundDecorTileId } from './tiles.js?v=20261011_v17';
import Network from './network.js?v=20261011_v17';
import {
  trackMarks, debrisParticles, muzzleFlashes, smokeParticles, consumeScreenShake
} from './vfx.js?v=20261011_v17';
import {
  gridCols, gridRows, tileSize, canvasWidth, canvasHeight,
  p1Tank, p2Tank, gameState, renderTanks, lastKnownEnemy,
  mouseX, mouseY, lerpAngle
} from './state.js?v=20261011_v17';
import {
  canPlayerSeeBullet, canPlayerSeeTrack, canPlayerSeeMine, canPlayerSeeMuzzleEffect,
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
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(startAngle) * maxRange, cy + Math.sin(startAngle) * maxRange);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(endAngle) * maxRange, cy + Math.sin(endAngle) * maxRange);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
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

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const tileId = map[r][c];
      const hasIceUnder = (iceGrid && iceGrid[r] && iceGrid[r][c] === 1) || tileId === 10;
      const isGroundDecor = isGroundDecorTileId(tileId);

      // Якщо на клітинці є шар льоду (на рівні землі), спочатку малюємо лід.
      // Наземний декор (трава 1/2, каміння 1/2) знаходиться на тому ж 1-му рівні з льодом і НЕ перекриває лід!
      if (hasIceUnder) {
        TILE_TYPES.ICE.draw(ctx, c * tileSize, r * tileSize, tileSize, wavePhase, 1);
        if (tileId === 0 || tileId === 10 || isGroundDecor || tileId === 9) continue;
      } else if (tileId === 9) {
        // Для низьких кущів (id: 9) на рівні землі малюємо лише ґрунт; саме листя малюється між корпусом і вежею танка!
        TILE_TYPES.EMPTY.draw(ctx, c * tileSize, r * tileSize, tileSize, wavePhase, 1);
        continue;
      }

      const block = TILE_BY_ID[tileId] || TILE_TYPES.EMPTY;
      const hp = (tileHp && tileHp[r]) ? tileHp[r][c] : (block.maxHp || 1);
      block.draw(ctx, c * tileSize, r * tileSize, tileSize, wavePhase, hp);
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

  ctx.save();

  // Ефект тряски камери (Screen Shake)
  consumeScreenShake(ctx);

  ctx.clearRect(-20, -20, canvasWidth + 40, canvasHeight + 40);

  // 1. Малювання базової мапи (з підтримкою льоду під блоками)
  drawMap(gameState.map, gameState.tileHp, gameState.ice);

  // 2. Плавна інтерполяція рендера
  const myId = Network.myPlayerId;
  renderTanks.p1.x += (p1Tank.x - renderTanks.p1.x) * 0.45;
  renderTanks.p1.y += (p1Tank.y - renderTanks.p1.y) * 0.45;
  renderTanks.p1.bodyAngle = lerpAngle(renderTanks.p1.bodyAngle, p1Tank.bodyAngle, 0.45);
  renderTanks.p1.turretAngle = lerpAngle(renderTanks.p1.turretAngle, p1Tank.turretAngle, 0.6);

  renderTanks.p2.x += (p2Tank.x - renderTanks.p2.x) * 0.45;
  renderTanks.p2.y += (p2Tank.y - renderTanks.p2.y) * 0.45;
  renderTanks.p2.bodyAngle = lerpAngle(renderTanks.p2.bodyAngle, p2Tank.bodyAngle, 0.45);
  renderTanks.p2.turretAngle = lerpAngle(renderTanks.p2.turretAngle, p2Tank.turretAngle, 0.6);

  const myTank = myId === 1 ? p1Tank : p2Tank;
  const enemyTank = myId === 1 ? p2Tank : p1Tank;
  const myRenderPos = myId === 1 ? renderTanks.p1 : renderTanks.p2;
  const enemyRenderPos = myId === 1 ? renderTanks.p2 : renderTanks.p1;

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

  const isEnemyCamouflaged = isTankCamouflaged(enemyTank, gameState.bushes, gameState.map, tileSize);
  const isEnemyInSmoke = isTankInSmoke(enemyTank, gameState.smokeClouds, enemyRenderPos);

  // Підсвітка малюється ТІЛЬКИ у високих кущах або під димом (на воді підсвітка вимкнена, бо танк і так видно!)
  const showMyOverlayHighlight = shouldDrawTankOverlayHighlight(myTank, gameState.bushes, gameState.smokeClouds, tileSize, myRenderPos);
  const showEnemyOverlayHighlight = shouldDrawTankOverlayHighlight(enemyTank, gameState.bushes, gameState.smokeClouds, tileSize, enemyRenderPos);

  const canSeeEnemy = myId === 1 ?
    (gameState.visibility ? gameState.visibility.p1CanSeeP2 : gameState.isEnemyVisible) :
    (gameState.visibility ? gameState.visibility.p2CanSeeP1 : gameState.isEnemyVisible);

  // Свічення під танком у високих кущах або під димом (на рівні землі)
  if (showMyOverlayHighlight && !myTank.isDead) {
    drawBushUnderGlow(ctx, myRenderPos, myTank.size, myTank.isP1);
  }
  if (canSeeEnemy && !enemyTank.isDead && showEnemyOverlayHighlight) {
    drawBushUnderGlow(ctx, enemyRenderPos, enemyTank.size, enemyTank.isP1);
  }

  // 3. Малювання танків у два шари з низькими кущами між корпусом і вежею:
  // 3а. Спочатку малюємо КОРПУСИ танків (layer = 'hull')
  myTank.draw(ctx, myRenderPos, false, 1.0, 'hull');

  let drawEnemyActive = false;
  let drawEnemyGhost = false;
  if (canSeeEnemy && !enemyTank.isDead) {
    drawEnemyActive = true;
    enemyTank.draw(ctx, enemyRenderPos, false, 1.0, 'hull');
    lastKnownEnemy.x = enemyRenderPos.x;
    lastKnownEnemy.y = enemyRenderPos.y;
    lastKnownEnemy.bodyAngle = enemyRenderPos.bodyAngle;
    lastKnownEnemy.turretAngle = enemyRenderPos.turretAngle;
    lastKnownEnemy.alpha = (isEnemyCamouflaged || isEnemyInSmoke) ? 0 : 0.55;
  } else if (lastKnownEnemy.alpha > 0 && !isEnemyCamouflaged && !isEnemyInSmoke) {
    drawEnemyGhost = true;
    enemyTank.draw(ctx, lastKnownEnemy, true, lastKnownEnemy.alpha, 'hull');
  }

  // 3б. Малюємо листя НИЗЬКИХ КУЩІВ (id: 9) поверх корпусу танка, але під вежею та дулом!
  drawLowBushesOverlay(ctx, gameState.map, tileSize);

  // 3в. Малюємо ВЕЖУ та ДУЛО танків (layer = 'turret') поверх низьких кущів!
  myTank.draw(ctx, myRenderPos, false, 1.0, 'turret');
  if (drawEnemyActive) {
    enemyTank.draw(ctx, enemyRenderPos, false, 1.0, 'turret');
  } else if (drawEnemyGhost) {
    enemyTank.draw(ctx, lastKnownEnemy, true, lastKnownEnemy.alpha, 'turret');
    lastKnownEnemy.alpha = Math.max(0, lastKnownEnemy.alpha - 0.005);
  }

  // 4. Малювання снарядів (видно тільки власні та ворожі при прямій видимості)
  gameState.bullets.forEach(b => {
    if (canPlayerSeeBullet(myTank, b, gameState.map, tileSize)) {
      b.draw(ctx);
    }
  });

  // 5. Малювання спалахів та диму з дула (ворожий дим від пострілу НЕ видно, коли самого ворога не видно!)
  muzzleFlashes.forEach(m => {
    if (canPlayerSeeMuzzleEffect(myTank, m, gameState.map, tileSize, canSeeEnemy)) {
      m.draw(ctx);
    }
  });
  smokeParticles.forEach(s => {
    if (canPlayerSeeMuzzleEffect(myTank, s, gameState.map, tileSize, canSeeEnemy)) {
      s.draw(ctx);
    }
  });

  // 6. Малювання вибухів
  gameState.explosions.forEach(exp => exp.draw(ctx));

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
  if (canSeeEnemy && !enemyTank.isDead && showEnemyOverlayHighlight) {
    drawPlayerBushHighlight(ctx, enemyTank, enemyRenderPos, tileSize, true);
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
  drawRoundTimer(ctx, myTank, myRenderPos, enemyTank, enemyRenderPos, canSeeEnemy);

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
export function drawRoundTimer(ctx, myTank, myRenderPos, enemyTank, enemyRenderPos, canSeeEnemy) {
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
  if (canSeeEnemy && enemyTank && !enemyTank.isDead) {
    const ePos = enemyRenderPos || enemyTank;
    const ex = ePos.x + enemyTank.size / 2;
    const ey = ePos.y + enemyTank.size / 2;
    minTankDist = Math.min(minTankDist, Math.hypot(ex - centerX, ey - centerY));
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
  ctx.globalAlpha = alpha;

  // Напівпрозора капсула таймера
  ctx.fillStyle = 'rgba(11, 15, 22, 0.82)';
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
  ctx.lineWidth = 1.2;

  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(pillX, pillY, pillW, pillH, 6);
  } else {
    ctx.rect(pillX, pillY, pillW, pillH);
  }
  ctx.fill();
  ctx.stroke();

  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#eaf6ff';
  ctx.fillText(`⏱ ${timeStr}`, centerX, centerY + 0.5);

  ctx.restore();
}
