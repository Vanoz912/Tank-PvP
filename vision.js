/**
 * vision.js — Система прямого погляду (LoS), конуса огляду (FOV), маскування та туману війни (Fog of War)
 *
 * Відповідає за:
 * - Трасування променя прямої видимості (checkLineOfSight) та конуса вежі (isInVisionCone)
 * - Перевірку маскування у високих кущах, низьких кущах, воді та під димом 3x3
 * - Визначення видимості ворожих куль, слідів гусениць, мін та ефектів пострілу
 * - Авторитетний розрахунок взаємної видимості гравців (updatePlayersVisibilityState)
 */

import { TILE_BY_ID } from './tiles.js?v=20261011_v17';
import { TURRET_TYPES } from './config.js?v=20261011_v17';
import Network from './network.js?v=20261011_v17';
import {
  PROXIMITY_REVEAL_DIST,
  gridCols,
  gridRows,
  tileSize,
  p1Tank,
  p2Tank,
  gameState
} from './state.js?v=20261011_v17';

/**
 * Перевірка прямої видимості (Line of Sight)
 */
export function checkLineOfSight(x1, y1, x2, y2, map) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);

  if (dist <= Math.min(PROXIMITY_REVEAL_DIST, tileSize * 2.2)) return true;

  const steps = Math.ceil(dist / 6);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = x1 + dx * t;
    const py = y1 + dy * t;
    const c = Math.floor(px / tileSize);
    const r = Math.floor(py / tileSize);

    if (r >= 0 && r < gridRows && c >= 0 && c < gridCols) {
      const tileId = map[r][c];
      const block = TILE_BY_ID[tileId];
      if (block && block.blocksBullet) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Перевірка, чи знаходиться ціль у конусі погляду танка (Cone of Vision)
 * Сектор огляду орієнтується ЗА ВЕЖЕЮ (turretAngle)
 */
export function isInVisionCone(observer, targetX, targetY, fovDegrees = null) {
  if (!observer || observer.isDead) return false;

  const ox = observer.x + observer.size / 2;
  const oy = observer.y + observer.size / 2;
  const dx = targetX - ox;
  const dy = targetY - oy;
  const dist = Math.hypot(dx, dy);

  if (dist < 0.001) return true;

  const targetAngle = Math.atan2(dy, dx);
  let diff = targetAngle - observer.turretAngle;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));

  const effectiveFov = typeof fovDegrees === 'number' ? fovDegrees : (observer.fov || (TURRET_TYPES[observer.turretType] && TURRET_TYPES[observer.turretType].fov) || 90);
  const halfFovRad = (effectiveFov / 2) * (Math.PI / 180);
  return Math.abs(diff) <= halfFovRad;
}

/**
 * Перевірка, чи знаходиться танк у "низьких кущах" (TILE_TYPES.LOW_BUSH, id: 9):
 * Коли танк у низьких кущах (>= 50% площі / 3 з 5 точок), він НЕ може бачити ворога (окрім ВХ),
 * проте ворог БАЧИТЬ його! Якщо поєднати низькі кущі + високі кущі — ні ти не бачиш ворога, ні ворог тебе.
 */
export function isTankInLowBushes(tank, map, tileSizeVal = tileSize) {
  if (!tank || tank.isDead || !map || map.length === 0) return false;
  if (typeof tank.isOnLowBush === 'function') {
    return tank.isOnLowBush(map, tileSizeVal);
  }
  const inset = Math.max(3, Math.floor(tank.size * 0.15));
  const cx = tank.x + tank.size / 2;
  const cy = tank.y + tank.size / 2;

  const samplePoints = [
    { x: cx, y: cy },
    { x: tank.x + inset, y: tank.y + inset },
    { x: tank.x + tank.size - inset, y: tank.y + inset },
    { x: tank.x + inset, y: tank.y + tank.size - inset },
    { x: tank.x + tank.size - inset, y: tank.y + tank.size - inset }
  ];

  let count = 0;
  for (const pt of samplePoints) {
    const c = Math.floor(pt.x / tileSizeVal);
    const r = Math.floor(pt.y / tileSizeVal);
    if (r >= 0 && r < map.length && c >= 0 && c < map[0].length) {
      if (map[r][c] === 9) count++;
    }
  }
  return count >= 3;
}

/**
 * Перевірка, чи перекриває ворожа димова завіса 3x3 (smoke_screen) лінію погляду спостерігача:
 * - Власник диму бачить крізь свій дим вільно!
 * - Ворог не бачить крізь чужий дим і не бачить цілі всередині чужого диму.
 */
export function isVisionBlockedByEnemySmoke(observerId, x1, y1, x2, y2, smokeClouds = (gameState && gameState.smokeClouds)) {
  if (!Array.isArray(smokeClouds) || smokeClouds.length === 0) return false;
  for (let i = 0; i < smokeClouds.length; i++) {
    const cloud = smokeClouds[i];
    if (!cloud || cloud.life <= 0) continue;
    // Власний дим НЕ закриває огляд власнику
    if (cloud.ownerId === observerId) continue;
    if (typeof cloud.intersectsSegment === 'function') {
      if (cloud.intersectsSegment(x1, y1, x2, y2)) return true;
    } else if (
      x2 >= cloud.x && x2 <= cloud.x + cloud.width &&
      y2 >= cloud.y && y2 <= cloud.y + cloud.height
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Перевірка видимості снаряда для спостерігача (Тактичний туман для куль)
 */
export function canPlayerSeeBullet(observer, bullet, map, tileSizeVal = tileSize) {
  if (!observer || !bullet) return false;

  // Власний снаряд завжди видимий для гравця
  if (bullet.ownerId === observer.id) return true;

  if (observer.isDead) return false;
  if (observer.hasWallhack) return true;
  if (bullet.invisibleToEnemy) return false;
  if (isTankInLowBushes(observer, map, tileSizeVal)) return false;

  const cx = observer.x + observer.size / 2;
  const cy = observer.y + observer.size / 2;
  if (isVisionBlockedByEnemySmoke(observer.id, cx, cy, bullet.x, bullet.y)) return false;

  const dist = Math.hypot(bullet.x - cx, bullet.y - cy);
  const proximityDist = Math.min(PROXIMITY_REVEAL_DIST, tileSizeVal * 1.5);

  const fov = observer.fov || (TURRET_TYPES[observer.turretType] && TURRET_TYPES[observer.turretType].fov) || 90;
  const inCone = isInVisionCone(observer, bullet.x, bullet.y, fov);
  const inProximity = dist <= proximityDist;

  if (!inCone && !inProximity) return false;

  return checkLineOfSight(cx, cy, bullet.x, bullet.y, map);
}

/**
 * Перевірка видимості слідів гусениць (Fog of War для слідів)
 */
export function canPlayerSeeTrack(observer, track, map, tileSizeVal = tileSize) {
  if (!observer || !track) return false;

  // Власні сліди (або нейтральні без ownerId) завжди видимі для гравця
  if (!track.ownerId || track.ownerId === observer.id) return true;

  if (observer.isDead) return false;
  if (observer.hasWallhack) return true;
  if (track.invisibleToEnemy) return false;
  if (isTankInLowBushes(observer, map, tileSizeVal)) return false;

  const cx = observer.x + observer.size / 2;
  const cy = observer.y + observer.size / 2;
  if (isVisionBlockedByEnemySmoke(observer.id, cx, cy, track.x, track.y)) return false;

  const dist = Math.hypot(track.x - cx, track.y - cy);
  const proximityDist = Math.min(PROXIMITY_REVEAL_DIST, tileSizeVal * 1.5);
  const fov = observer.fov || (TURRET_TYPES[observer.turretType] && TURRET_TYPES[observer.turretType].fov) || 90;
  const inCone = isInVisionCone(observer, track.x, track.y, fov);
  const inProximity = dist <= proximityDist;

  if (!inCone && !inProximity) return false;

  return checkLineOfSight(cx, cy, track.x, track.y, map);
}

/**
 * Перевірка видимості міни (Fog of War для мін):
 * - Свої міни гравець бачить ЗАВЖДИ
 * - Ворожі міни НЕ видимі взагалі за замовчуванням!
 * - Виключення 1: Божественна здібність "ВХ" (wallhack_vision) — видно завжди і скрізь
 * - Виключення 2: Рідкісна здібність "Слід виявлення" (linger_vision_1s) — видно ТІЛЬКИ в полі зору
 */
export function canPlayerSeeMine(observer, mine, map, tileSizeVal = tileSize) {
  if (!observer || !mine) return false;

  if (mine.ownerId === observer.id) return true;
  if (observer.isDead) return false;

  // Виключення 1: ВХ (wallhack_vision) — ворожі міни видно завжди
  if (observer.hasWallhack) return true;

  // Без "Сліду виявлення" (linger_vision_1s) ворожі міни не видимі взагалі
  if (!observer.hasLingerVision) return false;

  // Виключення 2: "Слід виявлення" — тільки в полі зору
  if (isTankInLowBushes(observer, map, tileSizeVal)) return false;

  const cx = observer.x + observer.size / 2;
  const cy = observer.y + observer.size / 2;
  if (isVisionBlockedByEnemySmoke(observer.id, cx, cy, mine.x, mine.y)) return false;

  const dist = Math.hypot(mine.x - cx, mine.y - cy);
  const proximityDist = Math.min(PROXIMITY_REVEAL_DIST, tileSizeVal * 1.35);
  const fov = observer.fov || (TURRET_TYPES[observer.turretType] && TURRET_TYPES[observer.turretType].fov) || 90;
  const inCone = isInVisionCone(observer, mine.x, mine.y, fov);
  const inProximity = dist <= proximityDist;

  if (!inCone && !inProximity) return false;

  return checkLineOfSight(cx, cy, mine.x, mine.y, map);
}

/**
 * Перевірка, чи бачить гравець (observer) спалах або дим від пострілу (MuzzleFlash / SmokeParticle):
 * - Власний дим/спалах від пострілу видно завжди
 * - Ворожий дим/спалах видно ТІЛЬКИ тоді, коли сам ворожий танк видимий для спостерігача (і кулі не невидимі)
 */
export function canPlayerSeeMuzzleEffect(observer, effect, map, tileSizeVal = tileSize, canSeeEnemyOverride = null) {
  if (!observer || !effect) return false;
  if (!effect.ownerId || effect.ownerId === observer.id) return true;
  if (observer.isDead) return false;
  if (effect.hiddenFromEnemy) return false;
  if (canSeeEnemyOverride === false) return false;
  if (observer.hasWallhack) return true;

  const hasActiveLinger = Boolean(observer.hasLingerVision && observer.lingerTimer > 0);
  if (canSeeEnemyOverride === true && hasActiveLinger) return true;

  if (isTankInLowBushes(observer, map, tileSizeVal)) return false;

  const cx = observer.x + observer.size / 2;
  const cy = observer.y + observer.size / 2;
  if (isVisionBlockedByEnemySmoke(observer.id, cx, cy, effect.x, effect.y, gameState.smokeClouds)) return false;

  const shooterTank = effect.ownerId === 1 ? p1Tank : (effect.ownerId === 2 ? p2Tank : null);
  const meleeDist = Math.min(PROXIMITY_REVEAL_DIST, tileSizeVal * 1.25);

  if (shooterTank && !shooterTank.isDead) {
    const sc = shooterTank.getCenter();
    const tankDist = Math.hypot(sc.x - cx, sc.y - cy);
    if (isVisionBlockedByEnemySmoke(observer.id, cx, cy, sc.x, sc.y, gameState.smokeClouds)) return false;
    if (isTankCamouflaged(shooterTank, gameState.bushes, map, tileSizeVal) && tankDist > meleeDist) {
      return false;
    }
  }

  const dist = Math.hypot(effect.x - cx, effect.y - cy);
  const proximityDist = Math.min(PROXIMITY_REVEAL_DIST, tileSizeVal * 1.35);
  const fov = observer.fov || (TURRET_TYPES[observer.turretType] && TURRET_TYPES[observer.turretType].fov) || 90;
  const inCone = isInVisionCone(observer, effect.x, effect.y, fov);
  const inProximity = dist <= proximityDist;

  if (!inCone && !inProximity) return false;

  return checkLineOfSight(cx, cy, effect.x, effect.y, map);
}

/**
 * Перевірка, чи перекриває будь-яка активна димова завіса 3x3 (SmokeCloud) танк
 */
export function isTankInSmoke(tank, smokeClouds = (gameState && gameState.smokeClouds), renderPos = null) {
  if (!tank || tank.isDead || !smokeClouds || smokeClouds.length === 0) return false;
  const rx = renderPos && Number.isFinite(renderPos.x) ? renderPos.x : tank.x;
  const ry = renderPos && Number.isFinite(renderPos.y) ? renderPos.y : tank.y;
  const inset = Math.max(2, Math.floor(tank.size * 0.12));
  const cx = rx + tank.size / 2;
  const cy = ry + tank.size / 2;

  const samplePoints = [
    { x: cx, y: cy },
    { x: rx + inset, y: ry + inset },
    { x: rx + tank.size - inset, y: ry + inset },
    { x: rx + inset, y: ry + tank.size - inset },
    { x: rx + tank.size - inset, y: ry + tank.size - inset }
  ];

  for (const sc of smokeClouds) {
    if (!sc || sc.life <= 0 || typeof sc.containsPoint !== 'function') continue;
    for (const pt of samplePoints) {
      if (sc.containsPoint(pt.x, pt.y)) return true;
    }
  }
  return false;
}

/**
 * Перевірка, чи знаходиться танк усередині кущів (Camouflage detection)
 * Вимагає, щоб щонайменше ПОЛОВИНА танка (>= 50% площі / 3 з 5 контрольних точок)
 * перебувала всередині кущів, а не просто ледь зачепила край!
 */
export function isTankInBushes(tank, bushes, tileSizeVal = tileSize) {
  if (!tank || tank.isDead || !bushes || bushes.length === 0) return false;
  const inset = Math.max(3, Math.floor(tank.size * 0.15));
  const cx = tank.x + tank.size / 2;
  const cy = tank.y + tank.size / 2;

  // 5 контрольних точок: центр та 4 кути (з відступом для точного виміру площі)
  const samplePoints = [
    { x: cx, y: cy },
    { x: tank.x + inset, y: tank.y + inset },
    { x: tank.x + tank.size - inset, y: tank.y + inset },
    { x: tank.x + inset, y: tank.y + tank.size - inset },
    { x: tank.x + tank.size - inset, y: tank.y + tank.size - inset }
  ];

  let inCount = 0;
  for (const pt of samplePoints) {
    const c = Math.floor(pt.x / tileSizeVal);
    const r = Math.floor(pt.y / tileSizeVal);
    if (r >= 0 && r < bushes.length && c >= 0 && c < bushes[0].length) {
      if (bushes[r][c] === 1) inCount++;
    }
  }

  // Щонайменше 3 з 5 точок (понад 50% площі танка) повинні знаходитися в кущах
  return inCount >= 3;
}

/**
 * Перевірка маскування танка у мілкій (id: 8) або глибокій (id: 3) воді при наявності легендарної здібності water_camouflage
 */
export function isTankInWaterCamo(tank, map, tileSizeVal = tileSize) {
  if (!tank || tank.isDead || !tank.hasWaterCamo || !map || map.length === 0) return false;
  const inset = Math.max(3, Math.floor(tank.size * 0.15));
  const cx = tank.x + tank.size / 2;
  const cy = tank.y + tank.size / 2;

  const samplePoints = [
    { x: cx, y: cy },
    { x: tank.x + inset, y: tank.y + inset },
    { x: tank.x + tank.size - inset, y: tank.y + inset },
    { x: tank.x + inset, y: tank.y + tank.size - inset },
    { x: tank.x + tank.size - inset, y: tank.y + tank.size - inset }
  ];

  let inWaterCount = 0;
  for (const pt of samplePoints) {
    const c = Math.floor(pt.x / tileSizeVal);
    const r = Math.floor(pt.y / tileSizeVal);
    if (r >= 0 && r < map.length && c >= 0 && c < map[0].length) {
      const tid = map[r][c];
      if (tid === 3 || tid === 8) inWaterCount++;
    }
  }

  return inWaterCount >= 3;
}

/**
 * Комбінована перевірка маскування танка (у високих кущах або у воді з перком water_camouflage)
 */
export function isTankCamouflaged(tank, bushes, map, tileSizeVal = tileSize) {
  return isTankInBushes(tank, bushes, tileSizeVal) || isTankInWaterCamo(tank, map, tileSizeVal);
}

/**
 * Перевірка, чи потрібно малювати підсвітку (контур + світіння) для танка:
 * ТІЛЬКИ коли танк перекритий високими кущами або димовою завісою 3x3!
 * На воді (навіть із перком water_camouflage) підсвітка ВИМКНЕНА, бо танк і так добре видно.
 */
export function shouldDrawTankOverlayHighlight(tank, bushes = (gameState && gameState.bushes), smokeClouds = (gameState && gameState.smokeClouds), tileSizeVal = tileSize, renderPos = null) {
  if (!tank || tank.isDead) return false;
  return isTankInBushes(tank, bushes, tileSizeVal) || isTankInSmoke(tank, smokeClouds, renderPos);
}

/**
 * Авторитетний розрахунок взаємної видимості гравців (LoS, FOV вежі, кущі, низькі кущі, дим 3x3, ВХ та Слід виявлення)
 */
export function updatePlayersVisibilityState() {
  if (!gameState || !p1Tank || !p2Tank) return;

  if (!p1Tank.isDead && !p2Tank.isDead) {
    const c1 = p1Tank.getCenter();
    const c2 = p2Tank.getCenter();
    const dist = Math.hypot(c2.x - c1.x, c2.y - c1.y);

    const p1Camouflaged = isTankCamouflaged(p1Tank, gameState.bushes, gameState.map, tileSize);
    const p2Camouflaged = isTankCamouflaged(p2Tank, gameState.bushes, gameState.map, tileSize);

    // Низькі кущі: ти не бачиш ворога, але ворог бачить тебе!
    const p1InLowBush = isTankInLowBushes(p1Tank, gameState.map, tileSize);
    const p2InLowBush = isTankInLowBushes(p2Tank, gameState.map, tileSize);

    // Дим 3x3: ворожий дим закриває погляд ворогу, а власник бачить крізь свій дим
    const p1BlockedBySmoke = isVisionBlockedByEnemySmoke(1, c1.x, c1.y, c2.x, c2.y, gameState.smokeClouds);
    const p2BlockedBySmoke = isVisionBlockedByEnemySmoke(2, c2.x, c2.y, c1.x, c1.y, gameState.smokeClouds);

    const directLoS = checkLineOfSight(c1.x, c1.y, c2.x, c2.y, gameState.map);

    // Відстань розкриття впритул (ближній бій / контакт корпусами)
    const meleeDist = Math.min(PROXIMITY_REVEAL_DIST, tileSize * 1.25);

    // Конус погляду орієнтується за кутом вежі та типом гармати (динамічний FOV)
    const p1Fov = p1Tank.fov || (TURRET_TYPES[p1Tank.turretType] && TURRET_TYPES[p1Tank.turretType].fov) || 90;
    const p2Fov = p2Tank.fov || (TURRET_TYPES[p2Tank.turretType] && TURRET_TYPES[p2Tank.turretType].fov) || 90;
    const p1HasVisionCone = isInVisionCone(p1Tank, c2.x, c2.y, p1Fov);
    const p2HasVisionCone = isInVisionCone(p2Tank, c1.x, c1.y, p2Fov);

    // Пряма видимість або Божественна здібність "ВХ (бачити ворога скрізь)"
    const rawP1SeeP2 = Boolean(p1Tank.hasWallhack) ||
      (!p1InLowBush && !p1BlockedBySmoke && (p1HasVisionCone || dist <= meleeDist) && directLoS && (!p2Camouflaged || dist <= meleeDist));
    const rawP2SeeP1 = Boolean(p2Tank.hasWallhack) ||
      (!p2InLowBush && !p2BlockedBySmoke && (p2HasVisionCone || dist <= meleeDist) && directLoS && (!p1Camouflaged || dist <= meleeDist));

    // Рідкісна здібність linger_vision_1s: коли ворог зникає, ти ще можеш його бачити 1 секунду (60 кадрів)
    if (rawP1SeeP2) {
      p1Tank.lingerTimer = p1Tank.hasLingerVision ? 60 : 0;
    } else if (p1Tank.hasLingerVision && p1Tank.lingerTimer > 0) {
      p1Tank.lingerTimer--;
    }
    const p1CanSeeP2 = rawP1SeeP2 || (Boolean(p1Tank.hasLingerVision) && p1Tank.lingerTimer > 0);

    if (rawP2SeeP1) {
      p2Tank.lingerTimer = p2Tank.hasLingerVision ? 60 : 0;
    } else if (p2Tank.hasLingerVision && p2Tank.lingerTimer > 0) {
      p2Tank.lingerTimer--;
    }
    const p2CanSeeP1 = rawP2SeeP1 || (Boolean(p2Tank.hasLingerVision) && p2Tank.lingerTimer > 0);

    gameState.visibility = { p1CanSeeP2, p2CanSeeP1 };
    gameState.isEnemyVisible = Network.myPlayerId === 1 ? p1CanSeeP2 : p2CanSeeP1;
  } else {
    gameState.visibility = { p1CanSeeP2: false, p2CanSeeP1: false };
    gameState.isEnemyVisible = false;
  }
}
