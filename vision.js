/**
 * vision.js — Система прямого погляду (LoS), конуса огляду (FOV), маскування та туману війни (Fog of War)
 *
 * Відповідає за:
 * - Трасування променя прямої видимості (checkLineOfSight) та конуса вежі (isInVisionCone)
 * - Перевірку маскування у високих кущах, низьких кущах, воді та під димом 3x3
 * - Визначення видимості ворожих куль, слідів гусениць, мін та ефектів пострілу
 * - Авторитетний розрахунок взаємної видимості гравців (updatePlayersVisibilityState)
 */

import { TILE_BY_ID, getEffectiveTile, getEffectiveTileId, getEffectiveCellTile, isCellEffectiveHighBush } from './tiles.js?v=20261011_v17';
import { TURRET_TYPES } from './config.js?v=20261011_v17';
import Network from './network.js?v=20261011_v17';
import {
  PROXIMITY_REVEAL_DIST,
  gridCols,
  gridRows,
  tileSize,
  p1Tank,
  p2Tank,
  p3Tank,
  p4Tank,
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
      const block = getEffectiveCellTile(r, c, gameState);
      if (block && block.blocksBullet && !block.transparentVision) {
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
 * Коли танк у низьких кущах (>= 50% площі / 3 з 5 точок), він НЕ може бачити ворога (окрім ВХ або Середнього корпусу),
 * проте ворог БАЧИТЬ його (якщо це не Легкий корпус, який маскується в низьких кущах)!
 */
export function isTankInLowBushes(tank, mapOrGameState, tileSizeVal = tileSize) {
  const map = (mapOrGameState && Array.isArray(mapOrGameState.map)) ? mapOrGameState.map : mapOrGameState;
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
      if (getEffectiveTileId(map[r][c], gameState) === 9) count++;
    }
  }
  return count >= 3;
}

/**
 * Перевірка, чи засліплений спостерігач низькими кущами:
 * Середній корпус (hullType === 'standard' або seeInLowBush === true) та Дерев'яний корпус (wooden) БАЧАТЬ у низьких кущах!
 */
export function isObserverBlindedByLowBushes(observer, mapOrGameState, tileSizeVal = tileSize) {
  if (!observer || observer.isDead) return false;
  if (observer.hullType === 'standard' || observer.hullType === 'wooden' || observer.seeInLowBush) return false;
  return isTankInLowBushes(observer, mapOrGameState, tileSizeVal);
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
 * З урахуванням події «Реверсивне спостереження» (reverse_vision) та ВХ
 */
export function canPlayerSeeBullet(observer, bullet, map, tileSizeVal = tileSize) {
  if (!observer || !bullet) return false;

  // Власний снаряд завжди видимий для гравця
  if (bullet.ownerId === observer.id) return true;

  if (observer.isDead) return false;
  if (observer.hasWallhack) return true;

  const isReverseVision = gameState && gameState.currentMapEvent === 'reverse_vision';

  let normalVisible = true;
  if (bullet.invisibleToEnemy) {
    normalVisible = false;
  } else if (isObserverBlindedByLowBushes(observer, map, tileSizeVal)) {
    normalVisible = false;
  } else {
    const cx = observer.x + observer.size / 2;
    const cy = observer.y + observer.size / 2;
    if (isVisionBlockedByEnemySmoke(observer.id, cx, cy, bullet.x, bullet.y)) {
      normalVisible = false;
    } else {
      const dist = Math.hypot(bullet.x - cx, bullet.y - cy);
      const proximityDist = Math.min(PROXIMITY_REVEAL_DIST, tileSizeVal * 1.5);
      const fov = observer.fov || (TURRET_TYPES[observer.turretType] && TURRET_TYPES[observer.turretType].fov) || 90;
      const inCone = isInVisionCone(observer, bullet.x, bullet.y, fov);
      const inProximity = dist <= proximityDist;

      if (!inCone && !inProximity) {
        normalVisible = false;
      } else if (!checkLineOfSight(cx, cy, bullet.x, bullet.y, map)) {
        normalVisible = false;
      }
    }
  }

  if (isReverseVision) {
    return !normalVisible;
  }
  return normalVisible;
}

/**
 * Перевірка видимості слідів гусениць (Fog of War для слідів)
 * З урахуванням події «Реверсивне спостереження» (reverse_vision) та ВХ
 */
export function canPlayerSeeTrack(observer, track, map, tileSizeVal = tileSize) {
  if (!observer || !track) return false;

  // Власні сліди (або нейтральні без ownerId) завжди видимі для гравця
  if (!track.ownerId || track.ownerId === observer.id) return true;

  if (observer.isDead) return false;
  if (observer.hasWallhack) return true;

  const isReverseVision = gameState && gameState.currentMapEvent === 'reverse_vision';

  let normalVisible = true;
  if (track.invisibleToEnemy) {
    normalVisible = false;
  } else if (isObserverBlindedByLowBushes(observer, map, tileSizeVal)) {
    normalVisible = false;
  } else {
    const cx = observer.x + observer.size / 2;
    const cy = observer.y + observer.size / 2;
    if (isVisionBlockedByEnemySmoke(observer.id, cx, cy, track.x, track.y)) {
      normalVisible = false;
    } else {
      const dist = Math.hypot(track.x - cx, track.y - cy);
      const proximityDist = Math.min(PROXIMITY_REVEAL_DIST, tileSizeVal * 1.5);
      const fov = observer.fov || (TURRET_TYPES[observer.turretType] && TURRET_TYPES[observer.turretType].fov) || 90;
      const inCone = isInVisionCone(observer, track.x, track.y, fov);
      const inProximity = dist <= proximityDist;

      if (!inCone && !inProximity) {
        normalVisible = false;
      } else if (!checkLineOfSight(cx, cy, track.x, track.y, map)) {
        normalVisible = false;
      }
    }
  }

  if (isReverseVision) {
    return !normalVisible;
  }
  return normalVisible;
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
  if (isObserverBlindedByLowBushes(observer, map, tileSizeVal)) return false;

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
 * - Ворожий дим/спалах у звичайному режимі видно ТІЛЬКИ тоді, коли сам ворожий танк видимий для спостерігача (і кулі не невидимі)
 * - У режимі «Реверсивне спостереження» (reverse_vision) видимість інвертується (ВХ бачить завжди)
 */
export function canPlayerSeeMuzzleEffect(observer, effect, map, tileSizeVal = tileSize, canSeeEnemyOverride = null) {
  if (!observer || !effect) return false;
  if (!effect.ownerId || effect.ownerId === observer.id) return true;
  if (observer.isDead) return false;
  if (observer.hasWallhack) return true;

  const isReverseVision = gameState && gameState.currentMapEvent === 'reverse_vision';

  let normalVisible = true;
  if (effect.hiddenFromEnemy) {
    normalVisible = false;
  } else if (isObserverBlindedByLowBushes(observer, map, tileSizeVal)) {
    normalVisible = false;
  } else {
    const cx = observer.x + observer.size / 2;
    const cy = observer.y + observer.size / 2;
    if (isVisionBlockedByEnemySmoke(observer.id, cx, cy, effect.x, effect.y, gameState.smokeClouds)) {
      normalVisible = false;
    } else {
      const allTanks = (gameState && Array.isArray(gameState.tanks) && gameState.tanks.length > 0)
        ? gameState.tanks
        : [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean);
      const shooterTank = allTanks.find(t => t && t.id === effect.ownerId);
      const meleeDist = Math.min(PROXIMITY_REVEAL_DIST, tileSizeVal * 1.25);

      if (shooterTank && !shooterTank.isDead) {
        const sc = shooterTank.getCenter();
        const tankDist = Math.hypot(sc.x - cx, sc.y - cy);
        if (isVisionBlockedByEnemySmoke(observer.id, cx, cy, sc.x, sc.y, gameState.smokeClouds)) {
          normalVisible = false;
        } else if (isTankCamouflaged(shooterTank, gameState.bushes, map, tileSizeVal) && tankDist > meleeDist) {
          normalVisible = false;
        }
      }

      if (normalVisible) {
        const dist = Math.hypot(effect.x - cx, effect.y - cy);
        const proximityDist = Math.min(PROXIMITY_REVEAL_DIST, tileSizeVal * 1.35);
        const fov = observer.fov || (TURRET_TYPES[observer.turretType] && TURRET_TYPES[observer.turretType].fov) || 90;
        const inCone = isInVisionCone(observer, effect.x, effect.y, fov);
        const inProximity = dist <= proximityDist;

        if (!inCone && !inProximity) {
          normalVisible = false;
        } else if (!checkLineOfSight(cx, cy, effect.x, effect.y, map)) {
          normalVisible = false;
        }
      }
    }
  }

  if (isReverseVision) {
    return !normalVisible;
  }

  if (canSeeEnemyOverride === false) return false;
  const hasActiveLinger = Boolean(observer.hasLingerVision && ((observer.lingerTimer > 0) || (observer.lingerTimers && observer.lingerTimers[effect.ownerId] > 0)));
  if (canSeeEnemyOverride === true && hasActiveLinger) return true;

  return normalVisible;
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
  if (!tank || tank.isDead) return false;
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
    if (isCellEffectiveHighBush(r, c, gameState)) inCount++;
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
      const tid = getEffectiveTileId(map[r][c], gameState);
      const isBushWater = Boolean(
        gameState && gameState.currentMapEvent === 'shuffled_blocks' &&
        gameState.bushes && gameState.bushes[r] && gameState.bushes[r][c] === 1 &&
        (getEffectiveTileId(4, gameState) === 3 || getEffectiveTileId(4, gameState) === 8)
      );
      if (tid === 3 || tid === 8 || isBushWater) inWaterCount++;
    }
  }

  return inWaterCount >= 3;
}

/**
 * Перевірка вродженого маскування Легкого корпусу (hullType === 'light') у низьких кущах (id: 9) та мілкій воді (id: 8)
 */
export function isTankInLightHullCamo(tank, map, tileSizeVal = tileSize) {
  if (!tank || tank.isDead || !map || map.length === 0) return false;
  const isLight = tank.hullType === 'light' || Boolean(tank.camoInLowBushAndShallowWater);
  const isWooden = tank.hullType === 'wooden' || Boolean(tank.camoInLowBush);
  if (!isLight && !isWooden) return false;

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

  let camoCount = 0;
  for (const pt of samplePoints) {
    const c = Math.floor(pt.x / tileSizeVal);
    const r = Math.floor(pt.y / tileSizeVal);
    if (r >= 0 && r < map.length && c >= 0 && c < map[0].length) {
      const tid = getEffectiveTileId(map[r][c], gameState);
      const isBushLowOrWater = Boolean(
        gameState && gameState.currentMapEvent === 'shuffled_blocks' &&
        gameState.bushes && gameState.bushes[r] && gameState.bushes[r][c] === 1 &&
        (getEffectiveTileId(4, gameState) === 9 || (isLight && getEffectiveTileId(4, gameState) === 8))
      );
      // Дерев'яний корпус маскується у низьких кущах (9), Легкий — у низьких кущах (9) та мілкій воді (8)
      if (tid === 9 || (isLight && tid === 8) || isBushLowOrWater) camoCount++;
    }
  }

  return camoCount >= 3;
}

/**
 * Перевірка оптичного маскування башти «Снайпер» (turretType === 'sniper'):
 * Через 1 секунду (60 кадрів), коли корпус стоїть нерухомо (повертати башту і стріляти можна), танк стає невидимим.
 */
export function isTankSniperCamouflaged(tank) {
  if (!tank || tank.isDead || tank.turretType !== 'sniper') return false;
  return (tank.sniperStealthTimer || 0) >= 120;
}

/**
 * Перевірка видимості трасуючого сліду снайперської кулі (TracerTrail)
 * З урахуванням події «Реверсивне спостереження» (reverse_vision) та ВХ
 */
export function canPlayerSeeTracer(observer, tracer, map, tileSizeVal = tileSize) {
  if (!observer || !tracer) return false;
  if (!tracer.ownerId || tracer.ownerId === observer.id) return true;
  if (observer.isDead) return false;
  if (observer.hasWallhack) return true;

  const isReverseVision = gameState && gameState.currentMapEvent === 'reverse_vision';

  let normalVisible = false;
  if (!tracer.hiddenFromEnemy && !isObserverBlindedByLowBushes(observer, map, tileSizeVal)) {
    const cx = observer.x + observer.size / 2;
    const cy = observer.y + observer.size / 2;
    const proximityDist = Math.min(PROXIMITY_REVEAL_DIST, tileSizeVal * 1.5);
    const fov = observer.fov || (TURRET_TYPES[observer.turretType] && TURRET_TYPES[observer.turretType].fov) || 90;

    // Перевіряємо декілька точок вздовж траси снаряда
    const samples = 6;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const px = tracer.x1 + (tracer.x2 - tracer.x1) * t;
      const py = tracer.y1 + (tracer.y2 - tracer.y1) * t;
      if (isVisionBlockedByEnemySmoke(observer.id, cx, cy, px, py)) continue;
      const dist = Math.hypot(px - cx, py - cy);
      const inCone = isInVisionCone(observer, px, py, fov);
      const inProximity = dist <= proximityDist;
      if ((inCone || inProximity) && checkLineOfSight(cx, cy, px, py, map)) {
        normalVisible = true;
        break;
      }
    }
  }

  if (isReverseVision) {
    return !normalVisible;
  }
  return normalVisible;
}

/**
 * Комбінована перевірка маскування танка (у високих кущах, у воді з water_camouflage, для Легкого корпусу в низьких кущах/мілкій воді або нерухомого Снайпера).
 * Якщо активний Маяк Регенерації (beaconActiveTimer > 0), танк світиться і НЕ маскується!
 */
export function isTankCamouflaged(tank, bushes, map, tileSizeVal = tileSize) {
  if (!tank || tank.isDead) return false;
  if ((tank.beaconActiveTimer || 0) > 0) return false;
  return (
    isTankInBushes(tank, bushes, tileSizeVal) ||
    isTankInWaterCamo(tank, map, tileSizeVal) ||
    isTankInLightHullCamo(tank, map, tileSizeVal) ||
    isTankSniperCamouflaged(tank)
  );
}

/**
 * Перевірка, чи потрібно малювати підсвітку (контур + світіння) для танка:
 * Коли танк перекритий високими кущами, димовою завісою 3x3, підсвічений Маяком Регенерації або у стелсі Снайпера!
 */
export function shouldDrawTankOverlayHighlight(tank, bushes = (gameState && gameState.bushes), smokeClouds = (gameState && gameState.smokeClouds), tileSizeVal = tileSize, renderPos = null) {
  if (!tank || tank.isDead) return false;
  return (
    (tank.beaconActiveTimer || 0) > 0 ||
    isTankSniperCamouflaged(tank) ||
    isTankInBushes(tank, bushes, tileSizeVal) ||
    isTankInSmoke(tank, smokeClouds, renderPos)
  );
}

/**
 * Авторитетний розрахунок взаємної видимості гравців (LoS, FOV вежі, кущі, низькі кущі, дим 3x3, ВХ, Радар, Маяк та Слід виявлення)
 */
export function updatePlayersVisibilityState() {
  if (!gameState) return;

  const allTanks = (gameState.tanks && gameState.tanks.length > 0)
    ? gameState.tanks
    : [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean);

  if (allTanks.length === 0) {
    gameState.visibility = { p1CanSeeP2: false, p2CanSeeP1: false, matrix: {} };
    gameState.isEnemyVisible = false;
    return;
  }

  const isDarkness = gameState && gameState.currentMapEvent === 'darkness';
  const isReverseVision = gameState && gameState.currentMapEvent === 'reverse_vision';
  const meleeDist = Math.min(PROXIMITY_REVEAL_DIST, tileSize * 1.25);
  const darknessProximity = Math.min(PROXIMITY_REVEAL_DIST, tileSize * 2.2);

  // 1. Скидання нерухомого стелсу снайпера при контакті впритул
  for (let i = 0; i < allTanks.length; i++) {
    const t1 = allTanks[i];
    if (!t1 || t1.isDead) continue;
    const c1 = t1.getCenter();
    for (let j = i + 1; j < allTanks.length; j++) {
      const t2 = allTanks[j];
      if (!t2 || t2.isDead) continue;
      const c2 = t2.getCenter();
      const dist = Math.hypot(c2.x - c1.x, c2.y - c1.y);
      if (dist <= meleeDist) {
        if (t1.turretType === 'sniper') t1.sniperStealthTimer = 0;
        if (t2.turretType === 'sniper') t2.sniperStealthTimer = 0;
      }
    }
  }

  // 2. Розрахунок прямої видимості між кожною парою (observer -> target)
  const directVis = {};
  for (const obs of allTanks) {
    if (!obs) continue;
    directVis[obs.id] = directVis[obs.id] || {};
    const c1 = obs.getCenter();
    const obsBlinded = isObserverBlindedByLowBushes(obs, gameState.map, tileSize);
    const obsFov = obs.fov || (TURRET_TYPES[obs.turretType] && TURRET_TYPES[obs.turretType].fov) || 90;

    for (const tgt of allTanks) {
      if (!tgt) continue;
      if (tgt.id === obs.id) {
        directVis[obs.id][tgt.id] = true;
        continue;
      }
      if (obs.isDead || tgt.isDead) {
        directVis[obs.id][tgt.id] = false;
        continue;
      }
      // Союзники завжди бачать один одного
      if (tgt.team === obs.team) {
        directVis[obs.id][tgt.id] = true;
        continue;
      }

      const c2 = tgt.getCenter();
      const dist = Math.hypot(c2.x - c1.x, c2.y - c1.y);
      const tgtCamouflaged = isTankCamouflaged(tgt, gameState.bushes, gameState.map, tileSize);
      const obsBlockedBySmoke = isVisionBlockedByEnemySmoke(obs.id, c1.x, c1.y, c2.x, c2.y, gameState.smokeClouds);
      const directLoS = checkLineOfSight(c1.x, c1.y, c2.x, c2.y, gameState.map);
      const obsHasVisionCone = isInVisionCone(obs, c2.x, c2.y, obsFov);
      const obsInDarknessZone = !isDarkness || (dist <= darknessProximity) || obsHasVisionCone;

      const normalLoS = (obsInDarknessZone && !obsBlinded && !obsBlockedBySmoke && (obsHasVisionCone || dist <= meleeDist) && directLoS && (!tgtCamouflaged || dist <= meleeDist));
      const normalSee = (obs.spotActiveTimer || 0) > 0 || (tgt.beaconActiveTimer || 0) > 0 || normalLoS;

      let canSee = false;
      if (isReverseVision) {
        canSee = Boolean(obs.hasWallhack) || !normalSee;
      } else {
        canSee = Boolean(obs.hasWallhack) || normalSee;
      }
      directVis[obs.id][tgt.id] = canSee;
    }
  }

  // 3. Спільний тактичний огляд (Shared Vision) між союзниками по команді
  const sharedVisionEnabled = Boolean(gameState.teamSettings && gameState.teamSettings.sharedVision);
  const effectiveVis = {};
  for (const obs of allTanks) {
    if (!obs) continue;
    effectiveVis[obs.id] = effectiveVis[obs.id] || {};
    for (const tgt of allTanks) {
      if (!tgt) continue;
      if (obs.isDead || tgt.isDead) {
        effectiveVis[obs.id][tgt.id] = false;
        continue;
      }
      if (tgt.team === obs.team) {
        effectiveVis[obs.id][tgt.id] = true;
        continue;
      }

      let canSeeTgt = Boolean(directVis[obs.id] && directVis[obs.id][tgt.id]);
      if (!canSeeTgt && sharedVisionEnabled) {
        // Перевіряємо, чи будь-який живий союзник бачить цю ціль
        const allySees = allTanks.some(ally => ally && !ally.isDead && ally.team === obs.team && directVis[ally.id] && directVis[ally.id][tgt.id]);
        if (allySees) {
          canSeeTgt = true;
        }
      }
      effectiveVis[obs.id][tgt.id] = canSeeTgt;
    }
  }

  // 4. Підтримка linger_vision_1s (Слід виявлення)
  for (const obs of allTanks) {
    if (!obs) continue;
    if (!obs.hasLingerVision) continue;
    if (!obs.lingerTimers) obs.lingerTimers = {};
    for (const tgt of allTanks) {
      if (!tgt || tgt.team === obs.team) continue;
      const rawSee = Boolean(effectiveVis[obs.id] && effectiveVis[obs.id][tgt.id]);
      if (rawSee) {
        obs.lingerTimers[tgt.id] = 60;
      } else if (obs.lingerTimers[tgt.id] > 0) {
        obs.lingerTimers[tgt.id]--;
        effectiveVis[obs.id][tgt.id] = true;
      }
    }
  }

  // 5. Збереження у gameState.visibility
  const p1CanSeeP2 = Boolean(effectiveVis[1] && effectiveVis[1][2]);
  const p2CanSeeP1 = Boolean(effectiveVis[2] && effectiveVis[2][1]);
  gameState.visibility = {
    p1CanSeeP2,
    p2CanSeeP1,
    matrix: effectiveVis,
    canSee: (observerId, targetId) => Boolean(effectiveVis[observerId] && effectiveVis[observerId][targetId])
  };

  const myId = Network.myPlayerId || 1;
  const myTank = allTanks.find(t => t && t.id === myId);
  const myTeam = myTank ? myTank.team : myId;
  const anyEnemyVisible = allTanks.some(t => t && !t.isDead && t.team !== myTeam && effectiveVis[myId] && effectiveVis[myId][t.id]);
  gameState.isEnemyVisible = anyEnemyVisible;
}
