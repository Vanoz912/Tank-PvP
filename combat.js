/**
 * @file combat.js
 * @description Модуль бойової фізики, колізій, стрільби, мін, димової завіси, шипів, переродження та пасивних здібностей.
 */

import { HULL_TYPES } from './config.js?v=20261011_v17';
import { TILE_BY_ID, getEffectiveTile, getEffectiveCellTile, isCellEffectiveHighBush } from './tiles.js?v=20261011_v17';
import { Bullet, Mine, SmokeCloud, FlyingOrb } from './entities.js?v=20261011_v17';
import { showToast } from './editor.js?v=20261011_v17';
import Network from './network.js?v=20261011_v17';
import { sound } from './audio.js?v=20261011_v17';
import {
  triggerScreenShake, setLastTankPos, spawnDebris, spawnMuzzleFlash, spawnSmoke, spawnTracerTrail,
  addExplosion as addExplosionVfx
} from './vfx.js?v=20261011_v17';
import {
  MAX_SCORE, RESPAWN_DELAY_FRAMES,
  gridCols, gridRows, tileSize, canvasWidth, canvasHeight, tankSize,
  p1Tank, p2Tank, p3Tank, p4Tank, teamScores, gameState, renderTanks, localInput, p1Input, p2Input, p3Input, p4Input, mouseX, mouseY,
  setRoundResetTimer, setLastRoundLoserId, currentActiveMap, uiHooks
} from './state.js?v=20261011_v17';
import { isTankInBushes, isTankInLowBushes } from './vision.js?v=20261011_v17';

/**
 * Додавання вибуху
 */
function addExplosion(x, y, radius, isTankExplosion = false) {
  addExplosionVfx(gameState, x, y, radius, isTankExplosion);
}

/**
 * Розрахунок спрацювання броні корпусу (шанс повного блокування шкоди):
 * З імовірністю armor (10%, 20% або 30%) броня блокує ВСЮ шкоду (повертає 0),
 * інакше проходить повна шкода снаряда (rawDamage).
 * @param {number} rawDamage - вихідна шкода снаряда
 * @param {number} armor - шанс повного блокування шкоди (0.10, 0.20, 0.30)
 * @param {number} [roll=Math.random()] - випадкове число [0, 1) для перевірки шансу
 * @returns {number} 0 (якщо заблоковано) або rawDamage
 */
export function calculateArmorDamage(rawDamage, armor = 0.20, roll = Math.random()) {
  const validArmor = Math.max(0, Math.min(0.99, Number.isFinite(armor) ? armor : 0.20));
  if (roll < validArmor) {
    return 0; // 100% шкоди заблоковано бронею (рикошет / непробиття)
  }
  return rawDamage;
}

/**
 * Перевірка зіткнення прямокутника з мапою (з підтримкою Божественної здібності walk_deep_water для глибокої води)
 */
export function checkMapCollision(x, y, w, h, map, tank = null) {
  if (x < -0.1 || y < -0.1 || x + w > canvasWidth + 0.1 || y + h > canvasHeight + 0.1) {
    return true;
  }

  const startCol = Math.floor(x / tileSize);
  const endCol = Math.floor((x + w - 0.05) / tileSize);
  const startRow = Math.floor(y / tileSize);
  const endRow = Math.floor((y + h - 0.05) / tileSize);

  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      if (r >= 0 && r < gridRows && c >= 0 && c < gridCols) {
        const block = getEffectiveCellTile(r, c, gameState);
        if (block && block.blocksTank) {
          // Якщо це Глибока вода (id: 3) і танк має Божественну здібність walk_deep_water або активна Снігова буря (вода стала льодом) — вільно проїжджає!
          if (block.id === 3 && ((tank && tank.canWalkDeepWater) || (gameState && gameState.currentMapEvent === 'snow_storm'))) {
            continue;
          }
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Перевірка зіткнення танків між собою (з урахуванням динамічного розміру кожного танка)
 */
export function checkTankCollision(tank, otherTank, newX, newY) {
  if (!otherTank || otherTank.isDead) return false;
  const s1 = (tank && tank.size) || tankSize;
  const s2 = (otherTank && otherTank.size) || tankSize;
  return (
    newX < otherTank.x + s2 &&
    newX + s1 > otherTank.x &&
    newY < otherTank.y + s2 &&
    newY + s1 > otherTank.y
  );
}

/**
 * Створення снаряда при пострілі з кінчика дула за вектором turretAngle (з урахуванням розкиду кулі, трасера Снайпера та шансу осліплення ворога в момент пострілу)
 * Підтримує Керований снаряд (guided_bullet): 2x урон та плавне керування за курсором
 */
export function spawnBullet(tank) {
  const muzzle = tank.getMuzzlePosition();
  const isGuided = Boolean(
    tank.guidedBulletArmed &&
    typeof tank.consumeGuidedBulletOnShot === 'function' &&
    tank.consumeGuidedBulletOnShot()
  );
  const isTracer = Boolean(!isGuided && (tank.isTracer || tank.turretType === 'sniper'));
  const bulletSpeed = isGuided
    ? Math.max(3.3, Math.min(4.2, (tank.speed || 2) * 1.65))
    : tank.bulletSpeed;

  // Розкид кулі при стрільбі (відхилення в межах [-spreadHalfAngleDeg, +spreadHalfAngleDeg] від лінії прицілювання)
  let shotAngle = tank.turretAngle;
  if (!isGuided && !tank.noSpread && (tank.spreadHalfAngleDeg || 0) > 0) {
    const halfRad = (tank.spreadHalfAngleDeg * Math.PI) / 180;
    const spreadOffset = (Math.random() * 2 - 1) * halfRad;
    shotAngle = Math.atan2(Math.sin(tank.turretAngle + spreadOffset), Math.cos(tank.turretAngle + spreadOffset));
  }

  const vx = Math.cos(shotAngle) * bulletSpeed;
  const vy = Math.sin(shotAngle) * bulletSpeed;
  const baseDamage = Math.floor(Math.random() * (tank.maxDmg - tank.minDmg + 1)) + tank.minDmg;
  const damage = isGuided ? baseDamage * 2 : baseDamage;

  // Звичайна здібність blind_bullet_chance: у момент пострілу вираховується вірогідність (2% за стек, до 20%), чи осліпить ЦЯ випущена куля ціль при влучанні
  const blindStacks = Math.min(10, Math.max(0, Number(tank.blindBulletStacks) || 0));
  const blindChance = typeof tank.blindChance === 'number'
    ? tank.blindChance
    : (typeof tank.blindBulletChance === 'number' ? tank.blindBulletChance : (blindStacks * 0.02));
  const blindsOnHit = (blindStacks > 0 || blindChance > 0) && (Math.random() < blindChance);

  // Рідкісна здібність vampiric_shot: 10% шанс при попаданні полікувати стрільця на 30% від нанесеної шкоди
  const healsOnHit = Boolean(tank.hasVampiricShot && Math.random() < 0.10);

  // Легендарна здібність magnetic_bullets: плавно відхиляється до ворога (Керована + Магнітна = ніяк; Снайпер + Магнітна = ніяк; Рикошет + Магнітна = працює)
  const isMagnetic = Boolean(!isGuided && !isTracer && tank.turretType !== 'sniper' && tank.hasMagneticBullets);

  const bullet = new Bullet(
    tank.id,
    muzzle.x,
    muzzle.y,
    vx,
    vy,
    damage,
    shotAngle,
    {
      pierceLeft: tank.bulletPierce || 0,
      ricochetsLeft: isGuided ? 0 : (tank.bulletRicochet || 0), // Керована + Рикошет = ніяк (ракета вибухає при ударі об стіну)
      ignoreArmor: Boolean(tank.ignoreArmor),
      instantBreak: Boolean(tank.instantBreakObstacles),
      invisibleToEnemy: Boolean(tank.invisibleBullets),
      isGuided,
      isTracer,
      blindsOnHit,
      healsOnHit,
      isMagnetic,
      speed: bulletSpeed,
      team: tank.team || tank.id
    }
  );
  gameState.bullets.push(bullet);
  tank.recordShot();
  if (isGuided) {
    uiHooks.updateHUD();
  }

  const hiddenFromEnemy = Boolean(tank.invisibleBullets);
  // Візуальні ефекти спалаху та диму на кінчику ствола
  spawnMuzzleFlash(muzzle.x, muzzle.y, shotAngle, tank.id, hiddenFromEnemy);
  spawnSmoke(muzzle.x, muzzle.y, shotAngle, tank.id, hiddenFromEnemy);

  Network.sendEvent('shoot', {
    x: muzzle.x,
    y: muzzle.y,
    angle: shotAngle,
    ownerId: tank.id,
    hiddenFromEnemy,
    isGuided,
    isTracer,
    blindsOnHit,
    healsOnHit,
    isMagnetic
  });
  sound.playShoot();
  return bullet;
}

/**
 * Встановлення міни на полі бою (на ПРОБІЛ)
 */
export function placeMineForTank(tank) {
  if (!tank || !tank.canPlaceMine()) return null;
  const cx = tank.x + tank.size / 2;
  const cy = tank.y + tank.size / 2;

  const mine = new Mine(tank.id, cx, cy, 40, 60, { team: tank.team || tank.id });
  if (!gameState.mines) gameState.mines = [];
  gameState.mines.push(mine);
  tank.recordMinePlaced();

  Network.sendEvent('minePlaced', { ownerId: tank.id, x: cx, y: cy });
  sound.playSteelHit();
  uiHooks.updateHUD();
  return mine;
}

/**
 * Використання димової завіси 3x3 блоки на 5 секунд (на ПРОБІЛ при наявності легендарного перка smoke_screen)
 */
export function useSmokeForTank(tank) {
  if (!tank || !tank.triggerSmoke()) return null;
  const cx = tank.x + tank.size / 2;
  const cy = tank.y + tank.size / 2;
  const centerCol = Math.floor(cx / tileSize);
  const centerRow = Math.floor(cy / tileSize);

  const cloud = new SmokeCloud(tank.id, centerCol, centerRow, tileSize, 300, 300);
  if (!gameState.smokeClouds) gameState.smokeClouds = [];
  gameState.smokeClouds.push(cloud);

  Network.sendEvent('smokeUsed', {
    ownerId: tank.id,
    centerCol,
    centerRow,
    x: cx,
    y: cy,
    tileSize,
    durationFrames: 300
  });
  sound.playSpot();
  uiHooks.updateHUD();
  return cloud;
}

/**
 * Активація Маяка Регенерації (beacon_heal): підсвічує танк на 7с і відновлює +2 HP/с за стек (КД 20с після завершення дії)
 */
export function useBeaconForTank(tank) {
  if (!tank || !tank.triggerBeacon()) return false;
  const cx = tank.x + tank.size / 2;
  const cy = tank.y + tank.size / 2;
  spawnDebris(cx, cy, 8, '#00e5ff');
  Network.sendEvent('beaconUsed', { ownerId: tank.id, x: cx, y: cy });
  sound.playSpot();
  uiHooks.updateHUD();
  return true;
}

/**
 * Активація Радара Розвідки (spot_enemy_10s): підсвічує ворога на 10с (КД 40с після завершення дії)
 */
export function useSpotEnemyForTank(tank) {
  if (!tank || !tank.triggerSpotEnemy()) return false;
  const cx = tank.x + tank.size / 2;
  const cy = tank.y + tank.size / 2;
  spawnDebris(cx, cy, 8, '#f1c40f');
  Network.sendEvent('radarUsed', { ownerId: tank.id, x: cx, y: cy });
  sound.playSpot();
  uiHooks.updateHUD();
  return true;
}

/**
 * Активація Турбо-прискорення (turbo_boost): +50% швидкості на 5с (КД 25с після завершення дії)
 */
export function useTurboForTank(tank) {
  if (!tank || !tank.triggerTurbo()) return false;
  const cx = tank.x + tank.size / 2;
  const cy = tank.y + tank.size / 2;
  spawnDebris(cx, cy, 8, '#00e5ff');
  Network.sendEvent('turboUsed', { ownerId: tank.id, x: cx, y: cy });
  sound.playSpot();
  uiHooks.updateHUD();
  return true;
}

/**
 * Перемикання режиму Керованого Снаряда (guided_bullet): наступний ЛКМ постріл летить за курсором з 2x уроном (КД 45с після знищення кулі)
 */
export function triggerGuidedBulletForTank(tank) {
  if (!tank || !tank.canUseGuidedBullet()) return false;
  const armed = tank.toggleGuidedBulletArm();
  sound.playSteelHit();
  uiHooks.updateHUD();
  return armed;
}

/**
 * Перевірка, чи стоїть танк на калюжі кислоти (id: 16)
 */
export function isTankOnAcid(tank, map, tileSize) {
  if (!tank || !map || !tileSize) return false;
  const tSize = tank.size || tankSize;
  const pad = 3;
  const startCol = Math.floor((tank.x + pad) / tileSize);
  const endCol = Math.floor((tank.x + tSize - pad) / tileSize);
  const startRow = Math.floor((tank.y + pad) / tileSize);
  const endRow = Math.floor((tank.y + tSize - pad) / tileSize);

  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      if (r >= 0 && r < gridRows && c >= 0 && c < gridCols) {
        if (map[r] && map[r][c] === 16) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Вибух бочки з кислотою (acid_barrel, id: 17):
 * - Під бочкою з'являється кислота (id: 16)
 * - У зоні 3x3 на вільних ділянках з'являються ще 2 кислоти
 */
export function triggerAcidBarrelExplosion(barrelRow, barrelCol) {
  if (!gameState || !gameState.map || !gameState.map[barrelRow]) return;

  // 1. Під зруйнованою бочкою з'являється кислота
  gameState.map[barrelRow][barrelCol] = 16;
  if (gameState.tileHp && gameState.tileHp[barrelRow]) {
    gameState.tileHp[barrelRow][barrelCol] = 0;
  }

  const barrelCx = barrelCol * tileSize + tileSize / 2;
  const barrelCy = barrelRow * tileSize + tileSize / 2;
  addExplosion(barrelCx, barrelCy, 20, false);
  spawnDebris(barrelCx, barrelCy, 12, '#26de81');
  sound.playAcidSizzle();

  // 2. У зоні 3x3 на вільних ділянках з'являються ще 2 кислоти
  const candidates = [];
  const p1Sp = currentActiveMap && currentActiveMap.p1Spawn;
  const p2Sp = currentActiveMap && currentActiveMap.p2Spawn;

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = barrelRow + dr;
      const c = barrelCol + dc;
      if (r < 0 || r >= gridRows || c < 0 || c >= gridCols) continue;
      if (p1Sp && p1Sp.x === c && p1Sp.y === r) continue;
      if (p2Sp && p2Sp.x === c && p2Sp.y === r) continue;

      const tileId = gameState.map[r] ? gameState.map[r][c] : 0;
      const block = TILE_BY_ID[tileId];
      const isSolid = block && block.blocksTank;
      const isWater = (tileId === 3 || tileId === 8);
      const isAlreadyAcid = (tileId === 16);

      if (!isSolid && !isWater && !isAlreadyAcid) {
        candidates.push({ r, c });
      }
    }
  }

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const placed = candidates.slice(0, 2);
  for (const pos of placed) {
    if (gameState.map[pos.r]) {
      gameState.map[pos.r][pos.c] = 16;
      if (gameState.tileHp && gameState.tileHp[pos.r]) {
        gameState.tileHp[pos.r][pos.c] = 0;
      }
    }
    const pcx = pos.c * tileSize + tileSize / 2;
    const pcy = pos.r * tileSize + tileSize / 2;
    spawnDebris(pcx, pcy, 6, '#26de81');
  }

  Network.sendEvent('acidBarrelExploded', {
    row: barrelRow,
    col: barrelCol,
    extraAcids: placed
  });
}

/**
 * Безпосередній вибух артилерійського удару в зоні 3x3 (викликається через 1 секунду = 60 кадрів після наведення та кліку ЛКМ):
 * - Одноразовий урон: 60 у центральну клітинку, 25 у 8 сусідніх клітинок навколо (включно з самошкодою!)
 * - Повністю руйнує всі блоки та кущі в зоні 3x3 (окрім бетону та броньованого скла по краях), а в центрі руйнує навіть Бетон / Сталь (id: 2) та Броньоване скло (id: 15)
 * - Запускає перезарядку 35 секунд (2100 кадрів при 60 FPS)
 */
function destroyArenaZone3x3(centerCol, centerRow) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = centerRow + dr;
      const c = centerCol + dc;
      if (r < 0 || r >= gridRows || c < 0 || c >= gridCols) continue;

      const isCenter = (dr === 0 && dc === 0);
      const cellCx = c * tileSize + tileSize / 2;
      const cellCy = r * tileSize + tileSize / 2;

      if (gameState.bushes && gameState.bushes[r] && gameState.bushes[r][c]) {
        gameState.bushes[r][c] = 0;
        spawnDebris(cellCx, cellCy, 5, '#2ecc71');
      }

      if (gameState.map && gameState.map[r]) {
        const tileId = gameState.map[r][c];
        const block = TILE_BY_ID[tileId];
        const isWaterOrIce = (tileId === 3 || tileId === 8 || tileId === 10);
        // Бетон (2) та Броньоване скло (15) руйнуються ТІЛЬКИ прямим попаданням у центр артилерії!
        const canDestroyTile = tileId > 0 && !isWaterOrIce && ((tileId !== 2 && tileId !== 15) || isCenter);

        if (canDestroyTile) {
          if (tileId === 17) {
            triggerAcidBarrelExplosion(r, c);
          } else {
            gameState.map[r][c] = (gameState.ice && gameState.ice[r] && gameState.ice[r][c] === 1) ? 10 : 0;
            if (gameState.tileHp && gameState.tileHp[r]) {
              gameState.tileHp[r][c] = 0;
            }
            spawnDebris(cellCx, cellCy, isCenter ? 12 : 7, (block && block.color) || '#e67e22');
          }
        }
      }

      addExplosion(cellCx, cellCy, isCenter ? 26 : 16, isCenter);
    }
  }

  if (Array.isArray(gameState.mines) && gameState.mines.length > 0) {
    const zLeft = (centerCol - 1) * tileSize;
    const zRight = (centerCol + 2) * tileSize;
    const zTop = (centerRow - 1) * tileSize;
    const zBottom = (centerRow + 2) * tileSize;
    gameState.mines = gameState.mines.filter(m => !(m.x >= zLeft && m.x <= zRight && m.y >= zTop && m.y <= zBottom));
  }
}

export function executeArtilleryExplosion(tank, targetCol, targetRow) {
  if (!tank) return null;
  if (typeof tank.triggerArtillery === 'function') {
    tank.triggerArtillery();
  }

  const centerCol = Math.max(0, Math.min(gridCols - 1, Math.floor(Number(targetCol) || 0)));
  const centerRow = Math.max(0, Math.min(gridRows - 1, Math.floor(Number(targetRow) || 0)));

  destroyArenaZone3x3(centerCol, centerRow);

  triggerScreenShake(12, 20);
  Network.sendEvent('artilleryUsed', {
    ownerId: tank.id,
    centerCol,
    centerRow,
    tileSize
  });
  sound.playExplosion();

  // 2. Одноразовий урон танкам у зоні 3x3 (60 у центр, 25 навколо; включно із самошкодою!)
  const allTanks = (gameState && Array.isArray(gameState.tanks) && gameState.tanks.length > 0)
    ? gameState.tanks
    : [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean);
  const allowFriendlyFire = Boolean(gameState && gameState.teamSettings && gameState.teamSettings.friendlyFire);

  const cLeft = centerCol * tileSize;
  const cRight = (centerCol + 1) * tileSize;
  const cTop = centerRow * tileSize;
  const cBottom = (centerRow + 1) * tileSize;
  const zLeft = (centerCol - 1) * tileSize;
  const zRight = (centerCol + 2) * tileSize;
  const zTop = (centerRow - 1) * tileSize;
  const zBottom = (centerRow + 2) * tileSize;

  for (const target of allTanks) {
    if (!target || target.isDead || target.spawnShieldTimer > 0) continue;
    if (gameState.gameOver) break;

    // Перевірка вогню по своїх (Friendly Fire): якщо FF вимкнено, союзники не отримують урону
    const isFriendly = (target.team === tank.team && target.id !== tank.id);
    if (isFriendly && !allowFriendlyFire) {
      continue;
    }

    const targetSize = target.size || tankSize;
    const pad = 2;
    const tx1 = target.x + pad;
    const ty1 = target.y + pad;
    const tx2 = target.x + targetSize - pad;
    const ty2 = target.y + targetSize - pad;
    const tCenter = target.getCenter();
    const tCol = Math.floor(tCenter.x / tileSize);
    const tRow = Math.floor(tCenter.y / tileSize);

    const inCenter = (tCol === centerCol && tRow === centerRow) ||
      (tx1 < cRight && tx2 > cLeft && ty1 < cBottom && ty2 > cTop &&
       Math.hypot(tCenter.x - (cLeft + tileSize / 2), tCenter.y - (cTop + tileSize / 2)) <= tileSize * 0.62);
    const inZone = inCenter || (tx1 < zRight && tx2 > zLeft && ty1 < zBottom && ty2 > zTop);

    if (!inZone) continue;

    // Влучання викриває Снайпера
    target.sniperStealthTimer = 0;

    if (target.hitInvulnTimer > 0) {
      spawnDebris(tCenter.x, tCenter.y, 6, '#00e5ff');
      Network.sendEvent('armorBlock', { targetId: target.id, x: tCenter.x, y: tCenter.y });
      continue;
    }

    if (typeof target.isPhantomComebackActive === 'function' && target.isPhantomComebackActive(gameState)) {
      target.hitInvulnTimer = (HULL_TYPES.phantom && HULL_TYPES.phantom.hitInvulnFrames) || 15;
    }

    const rawDmg = inCenter ? 60 : 25;
    const isUnpierceable = Boolean(
      target.unpierceableArmor ||
      (HULL_TYPES[target.hullType] && HULL_TYPES[target.hullType].unpierceableArmor)
    );
    const finalDmg = isUnpierceable
      ? calculateArmorDamage(rawDmg, target.armor || 0.99)
      : rawDmg;

    if (finalDmg <= 0) {
      spawnDebris(tCenter.x, tCenter.y, 6, '#00e5ff');
      Network.sendEvent('armorBlock', { targetId: target.id, x: tCenter.x, y: tCenter.y });
      continue;
    }

    target.hp = Math.max(0, target.hp - finalDmg);
    Network.sendEvent('tankHit', { targetId: target.id, damage: finalDmg });

    if (target.id !== tank.id) {
      applyThornsDamage(target, tank, finalDmg);
    }

    if (target.hp <= 0) {
      const killerId = (target.id === tank.id) ? (target.id === 1 ? 2 : 1) : tank.id;
      handleTankKill(target, killerId);
    }
  }

  uiHooks.updateHUD();
  return { centerCol, centerRow };
}

/**
 * Виконання удару Артилерійського обстрілу від події на карті (artillery_barrage):
 * 3x3 зона, у центрі 60 урону (руйнує навіть бетон), по периметру 25 урону.
 */
export function executeEnvironmentalArtillery(centerCol, centerRow) {
  const cCol = Math.max(0, Math.min(gridCols - 1, Math.floor(Number(centerCol) || 0)));
  const cRow = Math.max(0, Math.min(gridRows - 1, Math.floor(Number(centerRow) || 0)));

  destroyArenaZone3x3(cCol, cRow);

  triggerScreenShake(12, 20);
  sound.playExplosion();

  // 2. Урон танкам: 60 у центр, 25 по периметру
  const cLeft = cCol * tileSize;
  const cRight = (cCol + 1) * tileSize;
  const cTop = cRow * tileSize;
  const cBottom = (cRow + 1) * tileSize;
  const zLeft = (cCol - 1) * tileSize;
  const zRight = (cCol + 2) * tileSize;
  const zTop = (cRow - 1) * tileSize;
  const zBottom = (cRow + 2) * tileSize;

  const allTanks = (gameState && Array.isArray(gameState.tanks) && gameState.tanks.length > 0)
    ? gameState.tanks
    : [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean);

  for (const target of allTanks) {
    if (!target || target.isDead || target.spawnShieldTimer > 0) continue;
    if (gameState.gameOver) break;

    const targetSize = target.size || tankSize;
    const pad = 2;
    const tx1 = target.x + pad;
    const ty1 = target.y + pad;
    const tx2 = target.x + targetSize - pad;
    const ty2 = target.y + targetSize - pad;
    const tCenter = target.getCenter();
    const tCol = Math.floor(tCenter.x / tileSize);
    const tRow = Math.floor(tCenter.y / tileSize);

    const inCenter = (tCol === cCol && tRow === cRow) ||
      (tx1 < cRight && tx2 > cLeft && ty1 < cBottom && ty2 > cTop &&
       Math.hypot(tCenter.x - (cLeft + tileSize / 2), tCenter.y - (cTop + tileSize / 2)) <= tileSize * 0.62);
    const inZone = inCenter || (tx1 < zRight && tx2 > zLeft && ty1 < zBottom && ty2 > zTop);

    if (!inZone) continue;

    target.sniperStealthTimer = 0;
    const rawDmg = inCenter ? 60 : 25;
    const finalDmg = calculateArmorDamage(rawDmg, target.armor || 0);

    if (finalDmg <= 0) {
      spawnDebris(tCenter.x, tCenter.y, 6, '#bdc3c7');
      Network.sendEvent('armorBlock', { targetId: target.id, x: tCenter.x, y: tCenter.y });
      continue;
    }

    target.hp = Math.max(0, target.hp - finalDmg);
    Network.sendEvent('tankHit', { targetId: target.id, damage: finalDmg });

    if (target.hp <= 0) {
      handleTankKill(target, null);
    }
  }

  uiHooks.updateHUD();
  return { centerCol: cCol, centerRow: cRow };
}

/**
 * Оновлення аномальних літаючих куль для події «Аномальні сфери» (chaos_orbs):
 * - Рух, обертання та відбивання від стін
 * - Поява нової кулі кожні 20 секунд (1200 кадрів), максимум 5
 * - Постріли у 4 сторони кожні 2 секунди (120 кадрів)
 */
export function updateFlyingOrbs(gameState) {
  if (!gameState || gameState.currentMapEvent !== 'chaos_orbs') return;
  if (!Array.isArray(gameState.flyingOrbs)) gameState.flyingOrbs = [];

  const isHostOrSolo = Network.isHost || gameState.isTestMode || !Network.connectionActive;

  if (isHostOrSolo) {
    gameState.orbSpawnTimer = (gameState.orbSpawnTimer || 0) + 1;
    // Кожні 20 секунд (1200 кадрів) з'являється ще одна куля (максимум 5)
    if (gameState.orbSpawnTimer >= 1200) {
      gameState.orbSpawnTimer = 0;
      if (gameState.flyingOrbs.length < 5) {
        const cx = Math.random() * (canvasWidth - 120) + 60;
        const cy = Math.random() * (canvasHeight - 120) + 60;
        gameState.flyingOrbs.push(new FlyingOrb(cx, cy));
        Network.sendEvent('orbSpawned', { x: cx, y: cy });
      }
    }
  }

  for (const orb of gameState.flyingOrbs) {
    orb.update(canvasWidth, canvasHeight, gameState.map, tileSize, (ox, oy, rotAngle) => {
      if (isHostOrSolo) {
        // Залп у 4 сторони (хрестом)
        for (let i = 0; i < 4; i++) {
          const a = rotAngle + (i * Math.PI) / 2;
          const bulletSpeed = 5.5;
          const vx = Math.cos(a) * bulletSpeed;
          const vy = Math.sin(a) * bulletSpeed;
          const bullet = new Bullet(0, ox, oy, vx, vy, 20, a, { speed: bulletSpeed });
          gameState.bullets.push(bullet);
        }
        sound.playShoot();
      }
    });
  }
}

/**
 * Замовлення артилерійського удару в зону 3x3 клітинки (Легендарна активка artillery_strike):
 * Постріл/вибух відбувається через 1 секунду (60 кадрів) після вибору блоку ЛКМ!
 */
export function useArtilleryForTank(tank, targetCol, targetRow, options = {}) {
  if (!tank) return null;
  if (options && options.immediate) {
    return executeArtilleryExplosion(tank, targetCol, targetRow);
  }
  if (!tank.triggerArtilleryPending()) return null;

  const centerCol = Math.max(0, Math.min(gridCols - 1, Math.floor(Number(targetCol) || 0)));
  const centerRow = Math.max(0, Math.min(gridRows - 1, Math.floor(Number(targetRow) || 0)));

  if (!Array.isArray(gameState.pendingArtilleryStrikes)) {
    gameState.pendingArtilleryStrikes = [];
  }
  const strike = {
    ownerId: tank.id,
    centerCol,
    centerRow,
    timer: 60,
    maxTimer: 60,
    timerFrames: 60,
    maxFrames: 60
  };
  gameState.pendingArtilleryStrikes.push(strike);

  Network.sendEvent('artilleryQueued', {
    ownerId: tank.id,
    centerCol,
    centerRow,
    timer: 60,
    delayFrames: 60
  });
  sound.playSpot();
  uiHooks.updateHUD();
  return { centerCol, centerRow, pending: true, timer: 60 };
}

/**
 * Дострокова здача матчу ("Здатись"):
 * пропускає всі раундів, присуджує перемогу супернику та відкриває вікно Реваншу
 */
export function surrenderMatch(surrenderingPlayerId = Network.myPlayerId, options = {}) {
  if (!gameState || gameState.gameOver) return false;
  const playerId = surrenderingPlayerId === 2 ? 2 : 1;
  const winnerId = playerId === 1 ? 2 : 1;
  const targetWinScore = (gameState && gameState.targetScore) ? gameState.targetScore : MAX_SCORE;

  if (!options.fromNetwork && !Network.isHost && Network.connectionActive && playerId === Network.myPlayerId) {
    Network.sendSurrender(playerId);
  }

  if (winnerId === 1) {
    gameState.score1 = targetWinScore;
  } else {
    gameState.score2 = targetWinScore;
  }

  gameState.gameOver = true;
  gameState.winner = winnerId;
  gameState.surrenderedBy = playerId;
  gameState.perkSelection = { active: false, loserId: 0, options: [], optionCurses: {}, picksRemaining: 1, totalPicks: 1, rerollsLeft: 0 };
  gameState.rematch = { p1Ready: false, p2Ready: false };
  setRoundResetTimer(0);
  setLastRoundLoserId(0);

  const allTanks = (gameState && Array.isArray(gameState.tanks) && gameState.tanks.length > 0)
    ? gameState.tanks
    : [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean);
  allTanks.forEach(t => { if (t) t.targetingMode = null; });
  localInput.shoot = false;
  localInput.artilleryStrike = null;

  if (Network.isHost && Network.connectionActive) {
    Network.sendEvent('surrender', {
      surrenderingPlayerId: playerId,
      playerId,
      winner: winnerId,
      score1: gameState.score1,
      score2: gameState.score2
    });
  }

  sound.playWin();
  showToast(`🏳️ Гравець ${playerId} здався! Перемога Гравця ${winnerId}!`);
  uiHooks.renderPerkSelectionUI();
  uiHooks.renderRematchUI();
  uiHooks.updateHUD();
  return true;
}

/**
 * Активація обраної активної здібності на ПРОБІЛ (Міни, Дим 3x3, Артилерія 3x3, Маяк, Радар, Керована куля, Турбо)
 */
export function triggerActiveAbilityForTank(tank) {
  if (!tank || tank.isDead) return null;
  const actives = typeof tank.getAvailableActives === 'function' ? tank.getAvailableActives() : [];
  if (actives.length === 0) return null;

  const selected = tank.selectedActive || actives[0];
  if (selected === 'artillery' && tank.hasArtillery) {
    if (tank.canUseArtillery()) {
      const mode = tank.toggleBlockTargeting('artillery');
      uiHooks.updateHUD();
      return mode;
    }
    return null;
  }
  if (selected === 'smoke' && tank.hasSmokeScreen) {
    if (tank.canUseSmoke()) return useSmokeForTank(tank);
    return null;
  }
  if ((selected === 'mines' || selected === 'mine') && tank.maxMines > 0) {
    if (tank.canPlaceMine()) return placeMineForTank(tank);
    return null;
  }
  if (selected === 'beacon' && tank.hasBeaconHeal) {
    if (tank.canUseBeacon()) return useBeaconForTank(tank);
    return null;
  }
  if (selected === 'radar' && tank.hasSpotEnemy) {
    if (tank.canUseSpotEnemy()) return useSpotEnemyForTank(tank);
    return null;
  }
  if (selected === 'guided' && tank.hasGuidedBullet) {
    if (tank.canUseGuidedBullet()) return triggerGuidedBulletForTank(tank);
    return null;
  }
  if (selected === 'turbo' && tank.hasTurboBoost) {
    if (tank.canUseTurbo()) return useTurboForTank(tank);
    return null;
  }

  // Fallback якщо обрана активка ще не синхронізована
  if (tank.hasArtillery && tank.canUseArtillery()) {
    const mode = tank.toggleBlockTargeting('artillery');
    uiHooks.updateHUD();
    return mode;
  }
  if (tank.hasSmokeScreen && tank.canUseSmoke()) return useSmokeForTank(tank);
  if (tank.maxMines > 0 && tank.canPlaceMine()) return placeMineForTank(tank);
  if (tank.hasBeaconHeal && tank.canUseBeacon()) return useBeaconForTank(tank);
  if (tank.hasSpotEnemy && tank.canUseSpotEnemy()) return useSpotEnemyForTank(tank);
  if (tank.hasGuidedBullet && tank.canUseGuidedBullet()) return triggerGuidedBulletForTank(tank);
  if (tank.hasTurboBoost && tank.canUseTurbo()) return useTurboForTank(tank);
  return null;
}

export function processTankActionInputs(tank, inputObj, syncLocal = false) {
  if (!tank || !inputObj) return;

  if (inputObj.reloadClip) {
    startManualReloadForTank(tank);
    inputObj.reloadClip = false;
    if (syncLocal) localInput.reloadClip = false;
  }
  if (inputObj.useRepair && tank.canUseRepairKit()) {
    useRepairKitForTank(tank);
    inputObj.useRepair = false;
    if (syncLocal) localInput.useRepair = false;
  }
  if (inputObj.useSmoke && tank.canUseSmoke()) {
    useSmokeForTank(tank);
    inputObj.useSmoke = false;
    if (syncLocal) localInput.useSmoke = false;
  }
  if (inputObj.useBeacon && tank.canUseBeacon()) {
    useBeaconForTank(tank);
    inputObj.useBeacon = false;
    if (syncLocal) localInput.useBeacon = false;
  }
  if (inputObj.useRadar && tank.canUseSpotEnemy()) {
    useSpotEnemyForTank(tank);
    inputObj.useRadar = false;
    if (syncLocal) localInput.useRadar = false;
  }
  if (inputObj.toggleGuided && tank.canUseGuidedBullet()) {
    triggerGuidedBulletForTank(tank);
    inputObj.toggleGuided = false;
    if (syncLocal) localInput.toggleGuided = false;
  }
  if (inputObj.useTurbo && tank.canUseTurbo()) {
    useTurboForTank(tank);
    inputObj.useTurbo = false;
    if (syncLocal) localInput.useTurbo = false;
  }
  if (inputObj.artilleryStrike && tank.canUseArtillery()) {
    useArtilleryForTank(tank, inputObj.artilleryStrike.col, inputObj.artilleryStrike.row);
    inputObj.artilleryStrike = null;
    if (syncLocal) localInput.artilleryStrike = null;
  }
  if (inputObj.placeMine) {
    triggerActiveAbilityForTank(tank);
    inputObj.placeMine = false;
    if (syncLocal) localInput.placeMine = false;
  }
  if (inputObj.shoot && tank.canShoot()) {
    spawnBullet(tank);
  }
}

/**
 * Перемикання активної здібності (Міни <-> Дим) на клавіші Q / E (з миттєвою синхронізацією на Хост)
 */
export function cycleActiveForTank(tank, dir = 1) {
  if (!tank || typeof tank.cycleActiveAbility !== 'function') return null;
  const nextActive = tank.cycleActiveAbility(dir);
  if (tank.id === Network.myPlayerId && nextActive) {
    localInput.selectedActive = nextActive;
    uiHooks.sendLocalInput();
  }
  uiHooks.updateHUD();
  return nextActive;
}

/**
 * Прямий вибір активної здібності на ПРОБІЛ ('mines' або 'smoke')
 */
export function selectActiveForTank(tank, activeKey) {
  if (!tank || typeof tank.setSelectedActive !== 'function') return null;
  const chosen = tank.setSelectedActive(activeKey);
  if (tank.id === Network.myPlayerId && chosen) {
    localInput.selectedActive = chosen;
    uiHooks.sendLocalInput();
  }
  uiHooks.updateHUD();
  return chosen;
}

/**
 * Ручна дострокова перезарядка касети на клавішу R (навіть якщо в обоймі ще є кулі)
 */
export function startManualReloadForTank(tank) {
  if (!tank || typeof tank.startManualReload !== 'function') return false;
  if (!tank.startManualReload()) return false;
  Network.sendEvent('manualReload', { playerId: tank.id });
  sound.playSteelHit();
  uiHooks.updateHUD();
  return true;
}

/**
 * Використання ремонтного комплекту (на англійську клавішу H) — відновлює 20% від максимального HP
 */
export function useRepairKitForTank(tank) {
  if (!tank || !tank.useRepairKit()) return false;
  const cx = tank.x + tank.size / 2;
  const cy = tank.y + tank.size / 2;
  spawnDebris(cx, cy, 6, '#2ecc71');
  Network.sendEvent('repairUsed', {
    playerId: tank.id,
    x: cx,
    y: cy,
    hp: tank.hp,
    repairKitsLeft: tank.repairKitsLeft
  });
  sound.playSpot();
  uiHooks.updateHUD();
  return true;
}

/**
 * Шипи (thorns_50): коли танк отримує шкоду, а противник знаходиться в невеликому радіусі поруч,
 * противник отримує ту саму шкоду в розмірі 50%
 */
export function applyThornsDamage(victimTank, attackerTank, damageDealt) {
  if (!victimTank || !victimTank.hasThorns || !attackerTank || attackerTank.isDead || attackerTank.spawnShieldTimer > 0) {
    return 0;
  }
  if (!(damageDealt > 0)) return 0;

  const c1 = victimTank.getCenter();
  const c2 = attackerTank.getCenter();
  const dist = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  const thornsRadius = Math.max(75, Math.round(tankSize * 2.65));

  if (dist > thornsRadius) return 0;

  const thornsDmg = Math.max(1, Math.round(damageDealt * 0.50));
  attackerTank.hp = Math.max(0, attackerTank.hp - thornsDmg);
  addExplosion(c2.x, c2.y, 8, false);
  Network.sendEvent('tankHit', { targetId: attackerTank.id, damage: thornsDmg });
  sound.playSteelHit();

  if (attackerTank.hp <= 0) {
    handleTankKill(attackerTank, victimTank.id);
  }
  return thornsDmg;
}

/**
 * Обробка знищення танка (від кулі, міни, шипів або аури ближнього бою).
 * Якщо у танка є Божественна здібність rebirth_plus_1 (rebirthsLeft > 0),
 * танк перероджується з повним HP на місці свого спавну, а раунд НЕ закінчується!
 */
export function handleTankKill(victimTank, killerId) {
  if (!victimTank || victimTank.isDead) return;
  const vSize = victimTank.size || tankSize;

  // Перевірка Божественної здібності "+1 переродження (раунд не скінчується)"
  if (victimTank.rebirthsLeft > 0) {
    const oldX = victimTank.x;
    const oldY = victimTank.y;
    if (victimTank.triggerRebirth()) {
      addExplosion(oldX + vSize / 2, oldY + vSize / 2, 24, true);
      if (victimTank.id === 1) {
        renderTanks.p1.x = victimTank.x;
        renderTanks.p1.y = victimTank.y;
        renderTanks.p1.bodyAngle = victimTank.bodyAngle;
        renderTanks.p1.turretAngle = victimTank.turretAngle;
        setLastTankPos(1, victimTank.x, victimTank.y, victimTank.bodyAngle);
      } else {
        renderTanks.p2.x = victimTank.x;
        renderTanks.p2.y = victimTank.y;
        renderTanks.p2.bodyAngle = victimTank.bodyAngle;
        renderTanks.p2.turretAngle = victimTank.turretAngle;
        setLastTankPos(2, victimTank.x, victimTank.y, victimTank.bodyAngle);
      }
      Network.sendEvent('rebirth', {
        playerId: victimTank.id,
        x: victimTank.x,
        y: victimTank.y,
        hp: victimTank.hp,
        rebirthsLeft: victimTank.rebirthsLeft
      });
      sound.playExplosion();
      showToast(`🔥 Гравець ${victimTank.id} переродився на базі з повним HP!`);
      uiHooks.updateHUD();
      return;
    }
  }

  const allTanks = (gameState && Array.isArray(gameState.tanks) && gameState.tanks.length > 0)
    ? gameState.tanks
    : [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean);

  victimTank.hp = 0;
  victimTank.isDead = true;
  victimTank.respawnTimer = RESPAWN_DELAY_FRAMES;
  addExplosion(victimTank.x + vSize / 2, victimTank.y + vSize / 2, 28, true);

  if (victimTank.id === Network.myPlayerId) {
    triggerScreenShake(14, 22);
  }

  Network.sendEvent('explosion', { isTank: true });
  sound.playExplosion();

  // Визначаємо, які команди ще мають живі танки
  const aliveTanks = allTanks.filter(t => t && !t.isDead);
  const aliveTeams = new Set(aliveTanks.map(t => t.team));

  // Якщо в живих залишилося <= 1 команда — раунд завершено!
  if (aliveTeams.size <= 1) {
    const winningTeam = aliveTeams.size === 1 ? Array.from(aliveTeams)[0] : null;

    if (winningTeam !== null) {
      if (!gameState.teamScores) gameState.teamScores = { 1: 0, 2: 0, 3: 0, 4: 0 };
      gameState.teamScores[winningTeam] = (gameState.teamScores[winningTeam] || 0) + 1;
      teamScores[winningTeam] = gameState.teamScores[winningTeam];
      if (winningTeam === 1) gameState.score1 = teamScores[1];
      if (winningTeam === 2) gameState.score2 = teamScores[2];
    }

    const targetWinScore = (gameState && gameState.targetScore) ? gameState.targetScore : MAX_SCORE;
    const isMatchOver = winningTeam !== null && (gameState.teamScores[winningTeam] >= targetWinScore);

    if (isMatchOver) {
      gameState.gameOver = true;
      gameState.winner = winningTeam;
      gameState.rematch = { p1Ready: false, p2Ready: false };
      gameState.pendingArtilleryStrikes = [];
      setLastRoundLoserId(0);
      Network.sendEvent('win', { winner: winningTeam });
      sound.playWin();
      uiHooks.renderRematchUI();
    } else {
      // Раунд завершено: якщо режим "Здібності" увімкнений — запам'ятовуємо переможеного для вибору бонусу
      const perksEnabled = !gameState.gameModes || gameState.gameModes.perks !== false;
      setLastRoundLoserId(perksEnabled ? victimTank.id : 0);
      setRoundResetTimer(75);
      gameState.bullets = [];
      gameState.pendingArtilleryStrikes = [];
    }
  }
}

/**
 * Допоміжна функція завершення дії керованого снаряда (запускає КД 45с лише після знищення кулі)
 */
function notifyBulletDestroyed(bullet) {
  if (!bullet || !bullet.isGuided) return;
  const allTanks = (gameState && Array.isArray(gameState.tanks) && gameState.tanks.length > 0)
    ? gameState.tanks
    : [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean);
  const ownerTank = allTanks.find(t => t && t.id === bullet.ownerId);
  if (ownerTank && typeof ownerTank.onGuidedBulletDestroyed === 'function') {
    ownerTank.onGuidedBulletDestroyed();
    uiHooks.updateHUD();
  }
}

/**
 * Оновлення снарядів та колізій (Куля-стіна з рикошетом та миттєвим руйнуванням, Куля-танк із бронею та шипами, Куля-куля з пробиттям, суб-кроки для снайпера)
 */
export function updateBulletsAndCollisions() {
  const remainingBullets = [];

  for (let i = 0; i < gameState.bullets.length; i++) {
    const b = gameState.bullets[i]; const frameStartX = b.x; const frameStartY = b.y;
    const allTanks = (gameState && Array.isArray(gameState.tanks) && gameState.tanks.length > 0)
      ? gameState.tanks
      : [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean);
    const shooterTank = allTanks.find(t => t && t.id === b.ownerId);

    let aimX = null;
    let aimY = null;
    if (b.isGuided) {
      const inputs = [p1Input, p2Input, p3Input, p4Input];
      const curInp = inputs[b.ownerId - 1];
      if (Network.myPlayerId === b.ownerId && Number.isFinite(mouseX)) {
        aimX = mouseX;
        aimY = mouseY;
      } else if (curInp && Number.isFinite(curInp.aimX)) {
        aimX = curInp.aimX;
        aimY = curInp.aimY;
      } else {
        aimX = mouseX;
        aimY = mouseY;
      }
    }

    // Найближчий ворожий танк для магнітних куль (інша команда)
    let targetEnemyTank = null;
    let minEnemyDist = Infinity;
    for (const t of allTanks) {
      if (t && !t.isDead && t.id !== b.ownerId && t.team !== b.team) {
        const d = Math.hypot(t.x - b.x, t.y - b.y);
        if (d < minEnemyDist) {
          minEnemyDist = d;
          targetEnemyTank = t;
        }
      }
    }

    const totalSpeed = Math.hypot(b.vx, b.vy) || b.speed || 4;
    const subSteps = (!b.isGuided && totalSpeed > 7) ? Math.max(1, Math.ceil(totalSpeed / 5)) : 1;
    let bulletDestroyed = false;

    for (let step = 0; step < subSteps; step++) {
      const prevX = b.x;
      const prevY = b.y;

      if (subSteps === 1) {
        b.update(aimX, aimY, targetEnemyTank);
      } else {
        if (step === 0 && (b.isGuided || b.isMagnetic)) {
          b.update(aimX, aimY, targetEnemyTank);
          b.x -= b.vx;
          b.y -= b.vy;
        }
        b.x += b.vx / subSteps;
        b.y += b.vy / subSteps;
      }

      // 1. Межі карти (з підтримкою відбивання для куль із властивістю "Рикошет")
      if (b.isOutOfBounds(canvasWidth, canvasHeight)) {
        if (b.ricochetsLeft > 0) {
          b.ricochetsLeft--;
          if (b.x <= 0) {
            b.x = 1;
            b.vx = Math.abs(b.vx);
          } else if (b.x >= canvasWidth) {
            b.x = canvasWidth - 1;
            b.vx = -Math.abs(b.vx);
          }
          if (b.y <= 0) {
            b.y = 1;
            b.vy = Math.abs(b.vy);
          } else if (b.y >= canvasHeight) {
            b.y = canvasHeight - 1;
            b.vy = -Math.abs(b.vy);
          }
          b.angle = Math.atan2(b.vy, b.vx);
          addExplosion(b.x, b.y, 6);
          sound.playSteelHit();
          Network.sendEvent('hitSteel');
        } else {
          addExplosion(b.x, b.y, 6);
          notifyBulletDestroyed(b);
          bulletDestroyed = true;
          break;
        }
      }

      // 2. Зіткнення з блоками карти через TILE_BY_ID (з підтримкою перка instant_break_obstacles та механіки Рикошету)
      const bulletBox = { x: b.x, y: b.y, w: 6, h: 6 };
      const startCol = Math.floor(bulletBox.x / tileSize);
      const endCol = Math.floor((bulletBox.x + bulletBox.w) / tileSize);
      const startRow = Math.floor(bulletBox.y / tileSize);
      const endRow = Math.floor((bulletBox.y + bulletBox.h) / tileSize);

      let hitObstacle = false;
      let bouncedOffWall = false;

      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          if (r >= 0 && r < gridRows && c >= 0 && c < gridCols) {
            const block = getEffectiveCellTile(r, c, gameState);

            if (block && block.blocksBullet) {
              hitObstacle = true;
              if (block.destructible) {
                if (!gameState.tileHp) gameState.tileHp = [];
                if (!gameState.tileHp[r]) gameState.tileHp[r] = [];
                if (typeof gameState.tileHp[r][c] !== 'number' || gameState.tileHp[r][c] <= 0) {
                  gameState.tileHp[r][c] = block.maxHp || 1;
                }

                // Якщо куля має перк instant_break_obstacles ("Трощитель перешкод") — знищує будь-яку знищувану перешкоду з 1 влучання!
                if (b.instantBreak) {
                  gameState.tileHp[r][c] = 0;
                } else {
                  gameState.tileHp[r][c]--;
                }

                // Спавн частинок уламків (Debris)
                const blockCenterX = c * tileSize + tileSize / 2;
                const blockCenterY = r * tileSize + tileSize / 2;
                spawnDebris(blockCenterX, blockCenterY, 8, block.color || '#b84418');
                Network.sendEvent('debris', { x: blockCenterX, y: blockCenterY, color: block.color || '#b84418' });

                if (gameState.tileHp[r][c] <= 0) {
                  const destroyedTileId = gameState.map && gameState.map[r] ? gameState.map[r][c] : 0;
                  // Блок повністю зруйновано! (Якщо це був високий кущ під «Обманом зору» — прибираємо кущ; інакше оновлюємо map)
                  if (gameState.bushes && gameState.bushes[r] && gameState.bushes[r][c] === 1 && gameState.currentMapEvent === 'shuffled_blocks') {
                    gameState.bushes[r][c] = 0;
                  } else {
                    gameState.map[r][c] = (gameState.ice && gameState.ice[r] && gameState.ice[r][c] === 1) ? 10 : 0;
                  }
                  gameState.tileHp[r][c] = 0;
                  addExplosion(blockCenterX, blockCenterY, 12);
                  Network.sendEvent('hitBrick');
                  sound.playBrickHit();

                  if (destroyedTileId === 17) {
                    triggerAcidBarrelExplosion(r, c);
                  }
                } else {
                  // Блок витримав удар і вкрився тріщинами!
                  addExplosion(b.x, b.y, 7);
                  Network.sendEvent('hitSteel');
                  sound.playSteelHit();
                }
              } else {
                addExplosion(b.x, b.y, 6);
                Network.sendEvent('hitSteel');
                sound.playSteelHit();
              }

              // Механіка "Рикошет": куля відскакує від стіни (при цьому стіні вже нанесено шкоду вище!)
              if (b.ricochetsLeft > 0) {
                b.ricochetsLeft--;
                const tileLeft = c * tileSize;
                const tileRight = (c + 1) * tileSize;
                const tileTop = r * tileSize;
                const tileBottom = (r + 1) * tileSize;

                const crossedVertical = (prevX + 6 <= tileLeft) || (prevX >= tileRight);
                const crossedHorizontal = (prevY + 6 <= tileTop) || (prevY >= tileBottom);

                if (crossedVertical && !crossedHorizontal) {
                  b.vx = -b.vx;
                } else if (crossedHorizontal && !crossedVertical) {
                  b.vy = -b.vy;
                } else {
                  const tileCx = tileLeft + tileSize / 2;
                  const tileCy = tileTop + tileSize / 2;
                  if (Math.abs((prevX + 3) - tileCx) >= Math.abs((prevY + 3) - tileCy)) {
                    b.vx = -b.vx;
                  } else {
                    b.vy = -b.vy;
                  }
                }

                b.x = prevX + (b.vx / subSteps);
                b.y = prevY + (b.vy / subSteps);
                b.angle = Math.atan2(b.vy, b.vx);
                bouncedOffWall = true;
              }
              break;
            }
          }
        }
        if (hitObstacle) break;
      }

      if (hitObstacle && !bouncedOffWall) {
        notifyBulletDestroyed(b);
        bulletDestroyed = true;
        break;
      }

      // 3. Влучання в танк (ворога або союзника з перевіркою Friendly Fire)
      for (const targetTank of allTanks) {
        if (!targetTank || targetTank.isDead || targetTank.id === b.ownerId || targetTank.spawnShieldTimer > 0) continue;

        const tSize = targetTank.size || tankSize;
        const hitTank = (
          b.x < targetTank.x + tSize &&
          b.x + 6 > targetTank.x &&
          b.y < targetTank.y + tSize &&
          b.y + 6 > targetTank.y
        );

        if (!hitTank) continue;

        // ПЕРЕВІРКА ВОГНЮ ПО СВОЇХ (Friendly Fire):
        // За вимогами: куля НЕ пролітає повз — вона влучає в союзника, руйнується, але завдає 0 шкоди!
        const isFriendly = (targetTank.team === b.team);
        const allowFriendlyFire = Boolean(gameState && gameState.teamSettings && gameState.teamSettings.friendlyFire);

        if (isFriendly && !allowFriendlyFire) {
          addExplosion(b.x, b.y, 6);
          spawnDebris(b.x, b.y, 4, '#bdc3c7');
          sound.playSteelHit();
          Network.sendEvent('armorBlock', { targetId: targetTank.id, x: b.x, y: b.y });
          notifyBulletDestroyed(b);
          bulletDestroyed = true;
          break;
        }

        // Влучання викриває Снайпера
        targetTank.sniperStealthTimer = 0;

        // Осліплення при влучанні
        if (b.blindsOnHit) {
          targetTank.blindTimer = 90;
          Network.sendEvent('blindTriggered', {
            shooterId: b.ownerId,
            targetId: targetTank.id,
            durationFrames: 90
          });
        }

        // 0. Фантомний щит невразливості
        if (targetTank.hitInvulnTimer > 0) {
          addExplosion(b.x, b.y, 6);
          spawnDebris(b.x, b.y, 5, '#00e5ff');
          sound.playSteelHit();
          Network.sendEvent('armorBlock', { targetId: targetTank.id, x: b.x, y: b.y });
          notifyBulletDestroyed(b);
          bulletDestroyed = true;
          break;
        }

        if (typeof targetTank.isPhantomComebackActive === 'function' && targetTank.isPhantomComebackActive(gameState)) {
          targetTank.hitInvulnTimer = (HULL_TYPES.phantom && HULL_TYPES.phantom.hitInvulnFrames) || 15;
        }

        // Розрахунок броні
        const targetArmor = typeof targetTank.getEffectiveArmor === 'function'
          ? targetTank.getEffectiveArmor(gameState.map, gameState.bushes, tileSize, gameState)
          : (typeof targetTank.armor === 'number'
            ? targetTank.armor
            : ((HULL_TYPES[targetTank.hullType] && HULL_TYPES[targetTank.hullType].armor) || 0.20));
        const isUnpierceable = Boolean(
          targetTank.unpierceableArmor ||
          (HULL_TYPES[targetTank.hullType] && HULL_TYPES[targetTank.hullType].unpierceableArmor)
        );
        const canIgnoreArmor = Boolean(b.ignoreArmor && !isUnpierceable);
        const finalDamage = canIgnoreArmor ? b.damage : calculateArmorDamage(b.damage, targetArmor);

        if (finalDamage === 0) {
          addExplosion(b.x, b.y, 6);
          spawnDebris(b.x, b.y, 6, '#00e5ff');
          sound.playSteelHit();
          Network.sendEvent('armorBlock', { targetId: targetTank.id, x: b.x, y: b.y });
          notifyBulletDestroyed(b);
          bulletDestroyed = true;
          break;
        }

        targetTank.hp = Math.max(0, targetTank.hp - finalDamage);

        // Вампірський постріл: лікує стрільця на 30% від шкоди
        if (b.healsOnHit && shooterTank && !shooterTank.isDead && finalDamage > 0) {
          const healAmt = Math.max(1, Math.round(finalDamage * 0.30));
          shooterTank.hp = Math.min(shooterTank.maxHp, shooterTank.hp + healAmt);
          const scx = shooterTank.x + (shooterTank.size || 40) / 2;
          const scy = shooterTank.y + (shooterTank.size || 40) / 2;
          spawnDebris(scx, scy, 7, '#2ecc71');
        }

        if (targetTank.id === Network.myPlayerId) {
          triggerScreenShake(7, 14);
        }

        Network.sendEvent('tankHit', { targetId: targetTank.id, damage: finalDamage });

        // Перевірка шипів
        applyThornsDamage(targetTank, shooterTank, finalDamage);

        if (targetTank.hp <= 0) {
          handleTankKill(targetTank, b.ownerId);
        } else {
          addExplosion(b.x, b.y, 8);
          sound.playSteelHit();
        }

        notifyBulletDestroyed(b);
        bulletDestroyed = true;
        break;
      }
    }

    // Якщо це снайперська трасуюча куля — залишаємо слід трасера за поточний кадр
    if (b.isTracer && (Math.abs(b.x - frameStartX) > 0.1 || Math.abs(b.y - frameStartY) > 0.1)) {
      const hiddenFromEnemy = Boolean(b.invisibleToEnemy);
      spawnTracerTrail(frameStartX, frameStartY, b.x, b.y, b.ownerId, hiddenFromEnemy);
      Network.sendEvent('tracer', {
        x1: frameStartX,
        y1: frameStartY,
        x2: b.x,
        y2: b.y,
        ownerId: b.ownerId,
        hiddenFromEnemy
      });
    }

    if (!bulletDestroyed) {
      remainingBullets.push(b);
    }
  }

  // 4. Зіткнення куль суперників у польоті з урахуванням пробиття снарядів (bulletPierce)
  if (remainingBullets.length >= 2) {
    const destroyedIndices = new Set();
    for (let i = 0; i < remainingBullets.length; i++) {
      if (destroyedIndices.has(i)) continue;
      for (let j = i + 1; j < remainingBullets.length; j++) {
        if (destroyedIndices.has(j)) continue;
        const b1 = remainingBullets[i];
        const b2 = remainingBullets[j];
        if (b1.ownerId !== b2.ownerId) {
          const dist = Math.hypot(b1.x - b2.x, b1.y - b2.y);
          if (dist < 12) {
            addExplosion((b1.x + b2.x) / 2, (b1.y + b2.y) / 2, 8);
            sound.playSteelHit();
            Network.sendEvent('hitSteel');

            const p1Pierce = b1.pierceLeft || 0;
            const p2Pierce = b2.pierceLeft || 0;

            if (p1Pierce > 0 && p2Pierce === 0) {
              b1.pierceLeft--;
              destroyedIndices.add(j);
            } else if (p2Pierce > 0 && p1Pierce === 0) {
              b2.pierceLeft--;
              destroyedIndices.add(i);
              break;
            } else if (p1Pierce > 0 && p2Pierce > 0) {
              if (p1Pierce > p2Pierce) {
                b1.pierceLeft -= (p2Pierce + 1);
                destroyedIndices.add(j);
              } else if (p2Pierce > p1Pierce) {
                b2.pierceLeft -= (p1Pierce + 1);
                destroyedIndices.add(i);
                break;
              } else {
                b1.pierceLeft = 0;
                b2.pierceLeft = 0;
                destroyedIndices.add(i);
                destroyedIndices.add(j);
                break;
              }
            } else {
              destroyedIndices.add(i);
              destroyedIndices.add(j);
              break;
            }
          }
        }
      }
    }
    for (const idx of destroyedIndices) {
      notifyBulletDestroyed(remainingBullets[idx]);
    }
    gameState.bullets = remainingBullets.filter((_, idx) => !destroyedIndices.has(idx));
    return;
  }

  gameState.bullets = remainingBullets;
}

/**
 * Оновлення мін та перевірка наїзду ворожого танка на міну:
 * - Себе міна не чіпає
 * - Через міни можна стріляти
 * - Пошкодження міни: 40-60 HP
 */
export function updateMinesAndCollisions() {
  if (!gameState.mines || gameState.mines.length === 0) return;

  const allTanks = (gameState.tanks && gameState.tanks.length > 0)
    ? gameState.tanks
    : [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean);
  const allowFriendlyFire = Boolean(gameState.teamSettings && gameState.teamSettings.friendlyFire);

  for (let i = gameState.mines.length - 1; i >= 0; i--) {
    const mine = gameState.mines[i];
    if (typeof mine.update === 'function') mine.update();

    const ownerTank = allTanks.find(t => t && t.id === mine.ownerId);

    for (const enemyTank of allTanks) {
      if (!enemyTank || enemyTank.isDead || enemyTank.spawnShieldTimer > 0) continue;
      // Власник міни на неї не наступає
      if (enemyTank.id === mine.ownerId) continue;

      const isAlly = (typeof mine.team !== 'undefined' && typeof enemyTank.team !== 'undefined')
        ? (mine.team === enemyTank.team)
        : (ownerTank && ownerTank.team === enemyTank.team);

      // Якщо дружній вогонь вимкнено — союзники не детонують міни
      if (isAlly && !allowFriendlyFire) continue;

      const eSize = enemyTank.size || tankSize;
      const closestX = Math.max(enemyTank.x, Math.min(mine.x, enemyTank.x + eSize));
      const closestY = Math.max(enemyTank.y, Math.min(mine.y, enemyTank.y + eSize));
      const dist = Math.hypot(mine.x - closestX, mine.y - closestY);

      if (dist <= (mine.radius || 10)) {
        const dmg = typeof mine.rollDamage === 'function' ? mine.rollDamage() : 50;
        gameState.mines.splice(i, 1);

        enemyTank.sniperStealthTimer = 0;
        const finalDmg = (isAlly && !allowFriendlyFire) ? 0 : dmg;
        enemyTank.hp = Math.max(0, enemyTank.hp - finalDmg);
        addExplosion(mine.x, mine.y, 22, false);
        spawnDebris(mine.x, mine.y, 10, '#e74c3c');

        if (enemyTank.id === Network.myPlayerId) {
          triggerScreenShake(11, 18);
        }

        Network.sendEvent('mineExplode', { targetId: enemyTank.id, x: mine.x, y: mine.y, damage: finalDmg });
        sound.playExplosion();

        // Перевірка перка "Шипи" при вибуху міни впритул до її власника
        if (ownerTank && finalDmg > 0) {
          applyThornsDamage(enemyTank, ownerTank, finalDmg);
        }

        if (enemyTank.hp <= 0) {
          handleTankKill(enemyTank, mine.ownerId);
        }
        break;
      }
    }
  }
}

/**
 * Пасивні здібності танків під час активного раунду:
 * 0) Таймер раунду (roundTimeFrames), перезарядки активних здібностей (після завершення таймера дії!),
 *    відкладений на 1с удар артилерії, +1 макс. урону кожні 10с (time_scaling_max_dmg)
 * 1) Регенерація +1 HP (за стек) кожні 5 секунд (300 тіків) та Маяк Регенерації (+2 HP/с за стек під час 7с підсвічування)
 * 2) Ближній розряд: впритул (у невеликому радіусі) знімає 10 HP ворогу кожні 2 секунди (120 тіків),
 *    таймер скидається в 0, коли ворог виходить з радіуса
 */
export function updateTankPassives() {
  const tanks = (gameState.tanks && gameState.tanks.length > 0)
    ? gameState.tanks
    : [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean);
  let hudNeedsUpdate = false;
  const artilleryExplodedTankIds = new Set();

  // 0.0. Обробка 1-секундної затримки перед артилерійським ударом (pendingArtilleryStrikes)
  if (gameState && Array.isArray(gameState.pendingArtilleryStrikes) && gameState.pendingArtilleryStrikes.length > 0) {
    for (let i = gameState.pendingArtilleryStrikes.length - 1; i >= 0; i--) {
      const strike = gameState.pendingArtilleryStrikes[i];
      if (!strike) {
        gameState.pendingArtilleryStrikes.splice(i, 1);
        continue;
      }
      const curTimer = typeof strike.timer === 'number' ? strike.timer : (strike.timerFrames || 0);
      const nextTimer = curTimer - 1;
      strike.timer = nextTimer;
      strike.timerFrames = nextTimer;
      const ownerTank = tanks.find(t => t && t.id === strike.ownerId);
      if (ownerTank) {
        ownerTank.artilleryPendingTimer = Math.max(0, nextTimer);
      }
      if (nextTimer <= 0) {
        gameState.pendingArtilleryStrikes.splice(i, 1);
        if (ownerTank && (Network.isHost || gameState.isTestMode || !Network.connectionActive)) {
          executeArtilleryExplosion(ownerTank, strike.centerCol, strike.centerRow);
          artilleryExplodedTankIds.add(ownerTank.id);
        }
        hudNeedsUpdate = true;
      }
    }
  }

  // 0.1. Таймер раунду та рідкісна здібність "+1 макс. урону кожні 10с раунду" (time_scaling_max_dmg)
  if (gameState && !gameState.gameOver && (!gameState.perkSelection || !gameState.perkSelection.active)) {
    gameState.roundTimeFrames = (gameState.roundTimeFrames || 0) + 1;
    if (gameState.mapEventBannerTimer > 0) {
      gameState.mapEventBannerTimer--;
    }
    const expectedTimeBonus = Math.floor(gameState.roundTimeFrames / 600);
    for (const t of tanks) {
      if (!t) continue;
      if (t.hasTimeScalingMaxDmg) {
        if (t.roundTimeDmgBonus !== expectedTimeBonus) {
          t.roundTimeDmgBonus = expectedTimeBonus;
          const baseMax = typeof t.baseMaxDmg === 'number' ? t.baseMaxDmg : t.maxDmg;
          t.maxDmg = baseMax + expectedTimeBonus;
          hudNeedsUpdate = true;
        }
      } else if (t.roundTimeDmgBonus !== 0) {
        t.roundTimeDmgBonus = 0;
        if (typeof t.baseMaxDmg === 'number') {
          t.maxDmg = t.baseMaxDmg;
        }
        hudNeedsUpdate = true;
      }
    }
  }

  // 0.15. Динамічні події на карті (Map Events): Кислотний дощ, Батл рояль, Артилерійський обстріл
  if (gameState && !gameState.gameOver && (!gameState.perkSelection || !gameState.perkSelection.active) && gameState.currentMapEvent) {
    const isHostOrSolo = Network.isHost || gameState.isTestMode || !Network.connectionActive;

    // 1) Кислотний дощ: кожні 2 секунди (120 кадрів) знімається 1 HP крізь броню. У високих кущах та у воді не знімається.
    // Кислотний дощ не пробиває броню фантома (unpierceableArmor)!
    if (gameState.currentMapEvent === 'acid_rain') {
      gameState.acidRainTickTimer = (gameState.acidRainTickTimer || 0) + 1;
      if (gameState.acidRainTickTimer >= 120) {
        gameState.acidRainTickTimer = 0;
        if (isHostOrSolo) {
          for (const t of tanks) {
            if (!t || t.isDead || t.spawnShieldTimer > 0) continue;
            // Кислотний дощ не пробиває броню фантома
            if (t.hullType === 'phantom' || t.unpierceableArmor) continue;
            const inHighBushes = isTankInBushes(t, gameState.bushes, tileSize);
            const inWater = (typeof t.isOnShallowWater === 'function' && t.isOnShallowWater(gameState.map, tileSize)) ||
                            (typeof t.isOnDeepWater === 'function' && t.isOnDeepWater(gameState.map, tileSize));
            if (!inHighBushes && !inWater) {
              t.hp = Math.max(0, t.hp - 1);
              Network.sendEvent('tankHit', { targetId: t.id, damage: 1, trueDamage: true });
              if (t.hp <= 0) {
                handleTankKill(t, null);
              }
              hudNeedsUpdate = true;
            }
          }
        }
      }
    }

    // 2) Батл рояль: безпечна зона звужується після 20 секунд (1200 кадрів). Поза зоною — 10 HP кожні 2 секунди (120 кадрів) крізь броню.
    else if (gameState.currentMapEvent === 'battle_royale') {
      const zx = (gameState.battleRoyaleZone && typeof gameState.battleRoyaleZone.cx === 'number')
        ? gameState.battleRoyaleZone.cx
        : ((gameState.battleRoyaleZone && typeof gameState.battleRoyaleZone.x === 'number') ? gameState.battleRoyaleZone.x : (canvasWidth / 2));
      const zy = (gameState.battleRoyaleZone && typeof gameState.battleRoyaleZone.cy === 'number')
        ? gameState.battleRoyaleZone.cy
        : ((gameState.battleRoyaleZone && typeof gameState.battleRoyaleZone.y === 'number') ? gameState.battleRoyaleZone.y : (canvasHeight / 2));
      const maxRad = Math.hypot(canvasWidth, canvasHeight) / 2;
      const minRad = Math.max(50, tileSize * 2);

      if (!gameState.battleRoyaleZone) {
        gameState.battleRoyaleZone = {
          cx: zx,
          cy: zy,
          x: zx,
          y: zy,
          radius: maxRad,
          maxRadius: maxRad
        };
      }

      // Звуження починається ТІЛЬКИ через 20 секунд (1200 кадрів)!
      const roundFrames = gameState.roundTimeFrames || 0;
      if (roundFrames < 1200) {
        gameState.battleRoyaleZone.radius = maxRad;
      } else {
        const shrinkProgress = Math.min(1, (roundFrames - 1200) / 3600); // 60с на стискання до мінімуму
        gameState.battleRoyaleZone.radius = Math.max(minRad, maxRad - shrinkProgress * (maxRad - minRad));
      }

      gameState.battleRoyaleDamageTimer = (gameState.battleRoyaleDamageTimer || 0) + 1;
      if (gameState.battleRoyaleDamageTimer >= 120) {
        gameState.battleRoyaleDamageTimer = 0;
        if (isHostOrSolo) {
          for (const t of tanks) {
            if (!t || t.isDead || t.spawnShieldTimer > 0) continue;
            const tc = t.getCenter();
            const distCenter = Math.hypot(tc.x - zx, tc.y - zy);
            if (distCenter > gameState.battleRoyaleZone.radius) {
              t.hp = Math.max(0, t.hp - 10);
              Network.sendEvent('tankHit', { targetId: t.id, damage: 10, trueDamage: true });
              sound.playSteelHit();
              addExplosion(tc.x, tc.y, 8, false);
              if (t.hp <= 0) {
                handleTankKill(t, null);
              }
              hudNeedsUpdate = true;
            }
          }
        }
      }
    }

    // 2.5) Аномальні сфери (chaos_orbs): оновлення руху, відбивання, спавну та 4-сторонньої стрільби куль
    else if (gameState.currentMapEvent === 'chaos_orbs') {
      updateFlyingOrbs(gameState);
    }

    // 3) Артилерійський обстріл: кожні 3.5-5с на випадковій клітинці з'являється мітка на 2.5с (150 кадрів)
    else if (gameState.currentMapEvent === 'artillery_barrage') {
      if (isHostOrSolo) {
        gameState.envArtilleryTimer = (gameState.envArtilleryTimer || 0) + 1;
        if (gameState.envArtilleryTimer >= 220) {
          gameState.envArtilleryTimer = Math.floor(Math.random() * 40);
          const randCol = Math.floor(Math.random() * gridCols);
          const randRow = Math.floor(Math.random() * gridRows);
          if (!Array.isArray(gameState.envArtilleryStrikes)) gameState.envArtilleryStrikes = [];
          gameState.envArtilleryStrikes.push({
            centerCol: randCol,
            centerRow: randRow,
            timerFrames: 150,
            maxFrames: 150
          });
          Network.sendEvent('envArtillerySpawn', { centerCol: randCol, centerRow: randRow });
        }
      }

      if (Array.isArray(gameState.envArtilleryStrikes)) {
        for (let i = gameState.envArtilleryStrikes.length - 1; i >= 0; i--) {
          const s = gameState.envArtilleryStrikes[i];
          s.timerFrames--;
          if (s.timerFrames <= 0) {
            gameState.envArtilleryStrikes.splice(i, 1);
            if (isHostOrSolo) {
              executeEnvironmentalArtillery(s.centerCol, s.centerRow);
            }
          }
        }
      }
    }
  }

  // 0.2. Зменшення таймерів дії та перезарядки активних здібностей (КД стартує ПІСЛЯ завершення таймера дії!)
  for (const t of tanks) {
    if (!t) continue;

    // Осліплення (blindTimer)
    if (t.blindTimer > 0) {
      t.blindTimer--;
    }

    // Дим 3x3: 5с (300 кадрів) дії -> потім 20с (1200 кадрів) перезарядки
    if (t.smokeActiveTimer > 0) {
      const prevAct = Math.ceil(t.smokeActiveTimer / 60);
      t.smokeActiveTimer--;
      const nextAct = Math.ceil(t.smokeActiveTimer / 60);
      if (t.smokeActiveTimer <= 0) {
        t.smokeActiveTimer = 0;
        t.smokeCooldownTimer = 1800;
        hudNeedsUpdate = true;
      } else if (prevAct !== nextAct) {
        hudNeedsUpdate = true;
      }
    } else if (t.smokeCooldownTimer > 0) {
      const prevSec = Math.ceil(t.smokeCooldownTimer / 60);
      t.smokeCooldownTimer--;
      const nextSec = Math.ceil(t.smokeCooldownTimer / 60);
      if (t.smokeCooldownTimer === 0 && t.id === Network.myPlayerId && typeof uiHooks.showAbilityToast === 'function') {
        uiHooks.showAbilityToast('Димова завіса готова!', '💨');
      }
      if (prevSec !== nextSec) hudNeedsUpdate = true;
    }

    // Артилерія: 35с (2100 кадрів) перезарядки після вибуху
    if (!artilleryExplodedTankIds.has(t.id) && t.artilleryCooldownTimer > 0) {
      const prevArtSec = Math.ceil(t.artilleryCooldownTimer / 60);
      t.artilleryCooldownTimer--;
      const nextArtSec = Math.ceil(t.artilleryCooldownTimer / 60);
      if (t.artilleryCooldownTimer === 0 && t.id === Network.myPlayerId && typeof uiHooks.showAbilityToast === 'function') {
        uiHooks.showAbilityToast('Артилерія перезаряджена!', '🎯');
      }
      if (prevArtSec !== nextArtSec) hudNeedsUpdate = true;
    }

    // Маяк Регенерації: 7с (420 кадрів) дії -> потім 20с (1200 кадрів) перезарядки
    if (t.beaconActiveTimer > 0) {
      const prevBeaconAct = Math.ceil(t.beaconActiveTimer / 60);
      t.beaconActiveTimer--;
      const nextBeaconAct = Math.ceil(t.beaconActiveTimer / 60);
      if (prevBeaconAct !== nextBeaconAct) hudNeedsUpdate = true;

      if (!t.isDead && (t.beaconStacks || 0) > 0) {
        t.beaconHealTickTimer = (t.beaconHealTickTimer || 0) + 1;
        if (t.beaconHealTickTimer >= 60) {
          t.beaconHealTickTimer = 0;
          const healAmt = 2 * t.beaconStacks;
          if (t.hp < t.maxHp) {
            t.hp = Math.min(t.maxHp, t.hp + healAmt);
            hudNeedsUpdate = true;
          }
        }
      }

      if (t.beaconActiveTimer <= 0) {
        t.beaconActiveTimer = 0;
        t.beaconHealTickTimer = 0;
        t.beaconCooldownTimer = 1200;
        hudNeedsUpdate = true;
      }
    } else {
      t.beaconHealTickTimer = 0;
      if (t.beaconCooldownTimer > 0) {
        const prevBeaconCd = Math.ceil(t.beaconCooldownTimer / 60);
        t.beaconCooldownTimer--;
        const nextBeaconCd = Math.ceil(t.beaconCooldownTimer / 60);
        if (t.beaconCooldownTimer === 0 && t.id === Network.myPlayerId && typeof uiHooks.showAbilityToast === 'function') {
          uiHooks.showAbilityToast('Маяк регенерації готовий!', '✨');
        }
        if (prevBeaconCd !== nextBeaconCd) hudNeedsUpdate = true;
      }
    }

    // Радар Розвідки: 10с (600 кадрів) дії -> потім 40с (2400 кадрів) перезарядки
    if (t.spotActiveTimer > 0) {
      const prevSpotAct = Math.ceil(t.spotActiveTimer / 60);
      t.spotActiveTimer--;
      const nextSpotAct = Math.ceil(t.spotActiveTimer / 60);
      if (t.spotActiveTimer <= 0) {
        t.spotActiveTimer = 0;
        t.spotCooldownTimer = 2400;
        hudNeedsUpdate = true;
      } else if (prevSpotAct !== nextSpotAct) {
        hudNeedsUpdate = true;
      }
    } else if (t.spotCooldownTimer > 0) {
      const prevSpotCd = Math.ceil(t.spotCooldownTimer / 60);
      t.spotCooldownTimer--;
      const nextSpotCd = Math.ceil(t.spotCooldownTimer / 60);
      if (t.spotCooldownTimer === 0 && t.id === Network.myPlayerId && typeof uiHooks.showAbilityToast === 'function') {
        uiHooks.showAbilityToast('Радар розвідки готовий!', '📡');
      }
      if (prevSpotCd !== nextSpotCd) hudNeedsUpdate = true;
    }

    // Керований Снаряд: 45с (2700 кадрів) перезарядки (стартує в onGuidedBulletDestroyed)
    if (!t.guidedBulletActive && t.guidedCooldownTimer > 0) {
      const prevGuidedCd = Math.ceil(t.guidedCooldownTimer / 60);
      t.guidedCooldownTimer--;
      const nextGuidedCd = Math.ceil(t.guidedCooldownTimer / 60);
      if (t.guidedCooldownTimer === 0 && t.id === Network.myPlayerId && typeof uiHooks.showAbilityToast === 'function') {
        uiHooks.showAbilityToast('Керована куля готова!', '🚀');
      }
      if (prevGuidedCd !== nextGuidedCd) hudNeedsUpdate = true;
    }

    // Турбо: 4с (240 кадрів) дії -> потім 25с (1500 кадрів) перезарядки
    if (t.turboActiveTimer > 0) {
      const prevTurboAct = Math.ceil(t.turboActiveTimer / 60);
      t.turboActiveTimer--;
      const nextTurboAct = Math.ceil(t.turboActiveTimer / 60);
      if (t.turboActiveTimer <= 0) {
        t.turboActiveTimer = 0;
        t.turboCooldownTimer = 1500;
        hudNeedsUpdate = true;
      } else if (prevTurboAct !== nextTurboAct) {
        hudNeedsUpdate = true;
      }
    } else if (t.turboCooldownTimer > 0) {
      const prevTurboCd = Math.ceil(t.turboCooldownTimer / 60);
      t.turboCooldownTimer--;
      const nextTurboCd = Math.ceil(t.turboCooldownTimer / 60);
      if (t.turboCooldownTimer === 0 && t.id === Network.myPlayerId && typeof uiHooks.showAbilityToast === 'function') {
        uiHooks.showAbilityToast('Здібність «Турбо» перезарядилась!', '⚡');
      }
      if (prevTurboCd !== nextTurboCd) hudNeedsUpdate = true;
    }
  }
  if (hudNeedsUpdate) {
    uiHooks.updateHUD();
  }

  // 1. Регенерація (+1 HP за стек кожні 5 секунд = 300 кадрів при 60 FPS)
  for (const t of tanks) {
    if (!t || t.isDead || !(t.regenAmount > 0)) {
      if (t) t.regenTimer = 0;
      continue;
    }
    if (t.hp < t.maxHp) {
      t.regenTimer = (t.regenTimer || 0) + 1;
      if (t.regenTimer >= 300) {
        t.hp = Math.min(t.maxHp, t.hp + t.regenAmount);
        t.regenTimer = 0;
      }
    } else {
      t.regenTimer = 0;
    }
  }

  // 2. Ближній розряд (proximity_burn: кожні 2 секунди = 120 кадрів у радіусі ~85px)
  const proximityRadius = Math.max(75, Math.round(tankSize * 2.65));
  const allowFriendlyFire = Boolean(gameState.teamSettings && gameState.teamSettings.friendlyFire);

  for (const attacker of tanks) {
    if (!attacker || attacker.isDead || !(attacker.proximityDmg > 0)) {
      if (attacker) attacker.proximityTimer = 0;
      continue;
    }

    const c1 = attacker.getCenter();
    let hasTargetInRange = false;

    for (const target of tanks) {
      if (!target || target === attacker || target.isDead || target.spawnShieldTimer > 0) continue;
      // Якщо одна команда і дружній вогонь вимкнено — не дамажить союзника
      if (target.team === attacker.team && !allowFriendlyFire) continue;

      const c2 = target.getCenter();
      const dist = Math.hypot(c2.x - c1.x, c2.y - c1.y);

      if (dist <= proximityRadius) {
        hasTargetInRange = true;
        attacker.proximityTimer = (attacker.proximityTimer || 0) + 1;
        if (attacker.proximityTimer >= 120) {
          attacker.proximityTimer = 0;
          const dmg = (target.team === attacker.team && !allowFriendlyFire) ? 0 : attacker.proximityDmg;
          if (dmg > 0) {
            target.sniperStealthTimer = 0;
            target.hp = Math.max(0, target.hp - dmg);
            addExplosion(c2.x, c2.y, 10, false);
            Network.sendEvent('tankHit', { targetId: target.id, damage: dmg });
            sound.playSteelHit();

            // Перевірка перка "Шипи" у цілі при отриманні шкоди від ближнього розряду
            applyThornsDamage(target, attacker, dmg);

            if (target.hp <= 0) {
              handleTankKill(target, attacker.id);
            }
          }
        }
        break; // Обробили найближчу ціль у радіусі
      }
    }

    if (!hasTargetInRange) {
      attacker.proximityTimer = 0;
    }
  }

  // 3. Регенерація Дерев'яного корпусу (у низьких або високих кущах +3 HP кожні 5 секунд = 300 кадрів)
  for (const t of tanks) {
    if (!t || t.isDead || t.hullType !== 'wooden') {
      if (t) t.woodenBushRegenTimer = 0;
      continue;
    }
    const inHigh = isTankInBushes(t, gameState.bushes, tileSize);
    const inLow = isTankInLowBushes(t, gameState);
    if (inHigh || inLow) {
      if (t.hp < t.maxHp) {
        t.woodenBushRegenTimer = (t.woodenBushRegenTimer || 0) + 1;
        if (t.woodenBushRegenTimer >= 300) {
          t.woodenBushRegenTimer = 0;
          t.hp = Math.min(t.maxHp, t.hp + 3);
          const tc = t.getCenter();
          spawnDebris(tc.x, tc.y, 6, '#2ecc71');
          hudNeedsUpdate = true;
        }
      } else {
        t.woodenBushRegenTimer = 0;
      }
    } else {
      t.woodenBushRegenTimer = 0;
    }
  }

  // 4. Небезпека калюж кислоти (id: 16): одразу 5 пошкоджень HP при наїзді, потім по 5 HP кожні 3 секунди (180 кадрів)
  const isHostOrSoloCombat = Network.isHost || gameState.isTestMode || !Network.connectionActive;
  if (isHostOrSoloCombat) {
    for (const t of tanks) {
      if (!t || t.isDead || t.spawnShieldTimer > 0) {
        if (t) {
          t.isOnAcid = false;
          t.acidTimer = 0;
        }
        continue;
      }

      const onAcid = isTankOnAcid(t, gameState.map, tileSize);
      if (onAcid) {
        if (!t.isOnAcid) {
          t.isOnAcid = true;
          t.acidTimer = 0;
          t.hp = Math.max(0, t.hp - 5);
          sound.playAcidSizzle();
          const tc = t.getCenter();
          addExplosion(tc.x, tc.y, 6, false);
          spawnDebris(tc.x, tc.y, 6, '#2ed573');
          Network.sendEvent('tankHit', { targetId: t.id, damage: 5, trueDamage: true });
          if (t.hp <= 0) {
            handleTankKill(t, null);
          }
          hudNeedsUpdate = true;
        } else {
          t.acidTimer = (t.acidTimer || 0) + 1;
          if (t.acidTimer >= 180) {
            t.acidTimer = 0;
            t.hp = Math.max(0, t.hp - 5);
            sound.playAcidSizzle();
            const tc = t.getCenter();
            addExplosion(tc.x, tc.y, 6, false);
            spawnDebris(tc.x, tc.y, 6, '#2ed573');
            Network.sendEvent('tankHit', { targetId: t.id, damage: 5, trueDamage: true });
            if (t.hp <= 0) {
              handleTankKill(t, null);
            }
            hudNeedsUpdate = true;
          }
        }
      } else {
        t.isOnAcid = false;
        t.acidTimer = 0;
      }
    }
  }

  if (hudNeedsUpdate) {
    uiHooks.updateHUD();
  }
}
