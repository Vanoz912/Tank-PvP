/**
 * @file 
 * @description Модуль бойової фізики, колізій, стрільби, мін, димової завіси, шипів, переродження та пасивних здібностей.
 */

import { HULL_TYPES } from './config.js?v=20261011_v17';
import { TILE_BY_ID } from './tiles.js?v=20261011_v17';
import { Bullet, Mine, SmokeCloud } from './entities.js?v=20261011_v17';
import { showToast } from './editor.js?v=20261011_v17';
import Network from './network.js?v=20261011_v17';
import { sound } from './audio.js?v=20261011_v17';
import {
  triggerScreenShake, setLastTankPos, spawnDebris, spawnMuzzleFlash, spawnSmoke,
  addExplosion as addExplosionVfx
} from './vfx.js?v=20261011_v17';
import {
  MAX_SCORE, RESPAWN_DELAY_FRAMES,
  gridCols, gridRows, tileSize, canvasWidth, canvasHeight, tankSize,
  p1Tank, p2Tank, gameState, renderTanks, localInput,
  setRoundResetTimer, setLastRoundLoserId, uiHooks
} from './state.js?v=20261011_v17';

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
        const tileId = map[r][c];
        const block = TILE_BY_ID[tileId];
        if (block && block.blocksTank) {
          // Якщо це Глибока вода (id: 3) і танк має Божественну здібність walk_deep_water — вільно проїжджає!
          if (tileId === 3 && tank && tank.canWalkDeepWater) {
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
 * Перевірка зіткнення танків між собою
 */
export function checkTankCollision(tank, otherTank, newX, newY) {
  if (!otherTank || otherTank.isDead) return false;
  return (
    newX < otherTank.x + tankSize &&
    newX + tankSize > otherTank.x &&
    newY < otherTank.y + tankSize &&
    newY + tankSize > otherTank.y
  );
}

/**
 * Створення снаряда при пострілі з кінчика дула за вектором turretAngle
 */
export function spawnBullet(tank) {
  const muzzle = tank.getMuzzlePosition();
  const vx = Math.cos(tank.turretAngle) * tank.bulletSpeed;
  const vy = Math.sin(tank.turretAngle) * tank.bulletSpeed;
  const damage = Math.floor(Math.random() * (tank.maxDmg - tank.minDmg + 1)) + tank.minDmg;

  gameState.bullets.push(new Bullet(
    tank.id,
    muzzle.x,
    muzzle.y,
    vx,
    vy,
    damage,
    tank.turretAngle,
    {
      pierceLeft: tank.bulletPierce || 0,
      ricochetsLeft: tank.bulletRicochet || 0,
      ignoreArmor: Boolean(tank.ignoreArmor),
      instantBreak: Boolean(tank.instantBreakObstacles),
      invisibleToEnemy: Boolean(tank.invisibleBullets)
    }
  ));
  tank.recordShot();

  const hiddenFromEnemy = Boolean(tank.invisibleBullets);
  // Візуальні ефекти спалаху та диму на кінчику ствола
  spawnMuzzleFlash(muzzle.x, muzzle.y, tank.turretAngle, tank.id, hiddenFromEnemy);
  spawnSmoke(muzzle.x, muzzle.y, tank.turretAngle, tank.id, hiddenFromEnemy);

  Network.sendEvent('shoot', {
    x: muzzle.x,
    y: muzzle.y,
    angle: tank.turretAngle,
    ownerId: tank.id,
    hiddenFromEnemy
  });
  sound.playShoot();
}

/**
 * Встановлення міни на полі бою (на ПРОБІЛ)
 */
export function placeMineForTank(tank) {
  if (!tank || !tank.canPlaceMine()) return null;
  const cx = tank.x + tank.size / 2;
  const cy = tank.y + tank.size / 2;

  const mine = new Mine(tank.id, cx, cy);
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
 * Артилерійський удар у зону 3x3 клітинки (Легендарна активка artillery_strike):
 * - Одноразовий урон: 60 у центральну клітинку, 25 у 8 сусідніх клітинок навколо (включно з самошкодою!)
 * - Повністю руйнує всі блоки та кущі в зоні 3x3 (окрім бетону по краях), а в центрі руйнує навіть Бетон / Сталь (id: 2)
 * - Перезарядка: 35 секунд (2100 кадрів при 60 FPS)
 */
export function useArtilleryForTank(tank, targetCol, targetRow) {
  if (!tank || !tank.triggerArtillery()) return null;

  const centerCol = Math.max(0, Math.min(gridCols - 1, Math.floor(Number(targetCol) || 0)));
  const centerRow = Math.max(0, Math.min(gridRows - 1, Math.floor(Number(targetRow) || 0)));

  // 1. Руйнування блоків, кущів та мін у зоні 3x3
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = centerRow + dr;
      const c = centerCol + dc;
      if (r < 0 || r >= gridRows || c < 0 || c >= gridCols) continue;

      const isCenter = (dr === 0 && dc === 0);
      const cellCx = c * tileSize + tileSize / 2;
      const cellCy = r * tileSize + tileSize / 2;

      // Руйнування накладних високих кущів
      if (gameState.bushes && gameState.bushes[r] && gameState.bushes[r][c]) {
        gameState.bushes[r][c] = 0;
        spawnDebris(cellCx, cellCy, 5, '#2ecc71');
      }

      // Руйнування блоків карти (усіх блоків окрім води/льоду; бетон id: 2 руйнується тільки в центрі!)
      if (gameState.map && gameState.map[r]) {
        const tileId = gameState.map[r][c];
        const block = TILE_BY_ID[tileId];
        const isWaterOrIce = (tileId === 3 || tileId === 8 || tileId === 10);
        const canDestroyTile = tileId > 0 && !isWaterOrIce && (tileId !== 2 || isCenter);

        if (canDestroyTile) {
          gameState.map[r][c] = (gameState.ice && gameState.ice[r] && gameState.ice[r][c] === 1) ? 10 : 0;
          if (gameState.tileHp && gameState.tileHp[r]) {
            gameState.tileHp[r][c] = 0;
          }
          spawnDebris(cellCx, cellCy, isCenter ? 12 : 7, (block && block.color) || '#e67e22');
        }
      }

      addExplosion(cellCx, cellCy, isCenter ? 26 : 16, isCenter);
    }
  }

  // Детонація мін, що опинилися в зоні 3x3 артилерійського удару
  if (Array.isArray(gameState.mines) && gameState.mines.length > 0) {
    const zLeft = (centerCol - 1) * tileSize;
    const zRight = (centerCol + 2) * tileSize;
    const zTop = (centerRow - 1) * tileSize;
    const zBottom = (centerRow + 2) * tileSize;
    gameState.mines = gameState.mines.filter(m => !(m.x >= zLeft && m.x <= zRight && m.y >= zTop && m.y <= zBottom));
  }

  triggerScreenShake(12, 20);
  Network.sendEvent('artilleryUsed', {
    ownerId: tank.id,
    centerCol,
    centerRow,
    tileSize
  });
  sound.playExplosion();

  // 2. Одноразовий урон танкам у зоні 3x3 (60 у центр, 25 навколо; включно із самошкодою!)
  const orderedTargets = tank.id === 1 ? [p2Tank, p1Tank] : [p1Tank, p2Tank];
  const cLeft = centerCol * tileSize;
  const cRight = (centerCol + 1) * tileSize;
  const cTop = centerRow * tileSize;
  const cBottom = (centerRow + 1) * tileSize;
  const zLeft = (centerCol - 1) * tileSize;
  const zRight = (centerCol + 2) * tileSize;
  const zTop = (centerRow - 1) * tileSize;
  const zBottom = (centerRow + 2) * tileSize;

  for (const target of orderedTargets) {
    if (!target || target.isDead || target.spawnShieldTimer > 0) continue;
    if (gameState.gameOver) break;

    const pad = 2;
    const tx1 = target.x + pad;
    const ty1 = target.y + pad;
    const tx2 = target.x + tankSize - pad;
    const ty2 = target.y + tankSize - pad;
    const tCenter = target.getCenter();
    const tCol = Math.floor(tCenter.x / tileSize);
    const tRow = Math.floor(tCenter.y / tileSize);

    const inCenter = (tCol === centerCol && tRow === centerRow) ||
      (tx1 < cRight && tx2 > cLeft && ty1 < cBottom && ty2 > cTop &&
       Math.hypot(tCenter.x - (cLeft + tileSize / 2), tCenter.y - (cTop + tileSize / 2)) <= tileSize * 0.62);
    const inZone = inCenter || (tx1 < zRight && tx2 > zLeft && ty1 < zBottom && ty2 > zTop);

    if (!inZone) continue;

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
 * Дострокова здача матчу ("Здатись"):
 * пропускає всі раунди, присуджує перемогу супернику та відкриває вікно Реваншу
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
  gameState.perkSelection = { active: false, loserId: 0, options: [], picksRemaining: 1, totalPicks: 1, rerollsLeft: 0 };
  gameState.rematch = { p1Ready: false, p2Ready: false };
  setRoundResetTimer(0);
  setLastRoundLoserId(0);

  if (p1Tank) p1Tank.targetingMode = null;
  if (p2Tank) p2Tank.targetingMode = null;
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
 * Активація обраної активної здібності на ПРОБІЛ (Міни, Дим 3x3 або прицілювання Артилерії 3x3)
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

  // Fallback якщо обрана активка ще не синхронізована
  if (tank.hasArtillery && tank.canUseArtillery()) {
    const mode = tank.toggleBlockTargeting('artillery');
    uiHooks.updateHUD();
    return mode;
  }
  if (tank.hasSmokeScreen && tank.canUseSmoke()) return useSmokeForTank(tank);
  if (tank.maxMines > 0 && tank.canPlaceMine()) return placeMineForTank(tank);
  return null;
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

  // Перевірка Божественної здібності "+1 переродження (раунд не скінчується)"
  if (victimTank.rebirthsLeft > 0) {
    const oldX = victimTank.x;
    const oldY = victimTank.y;
    if (victimTank.triggerRebirth()) {
      addExplosion(oldX + tankSize / 2, oldY + tankSize / 2, 24, true);
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

  victimTank.hp = 0;
  victimTank.isDead = true;
  victimTank.respawnTimer = RESPAWN_DELAY_FRAMES;
  addExplosion(victimTank.x + tankSize / 2, victimTank.y + tankSize / 2, 28, true);

  if (victimTank.id === 1) {
    triggerScreenShake(14, 22);
  }

  if (killerId === 1) gameState.score1++;
  else gameState.score2++;

  Network.sendEvent('explosion', { isTank: true });
  sound.playExplosion();

  const targetWinScore = (gameState && gameState.targetScore) ? gameState.targetScore : MAX_SCORE;

  if (gameState.score1 >= targetWinScore) {
    gameState.gameOver = true;
    gameState.winner = 1;
    gameState.rematch = { p1Ready: false, p2Ready: false };
    setLastRoundLoserId(0);
    Network.sendEvent('win');
    sound.playWin();
    uiHooks.renderRematchUI();
  } else if (gameState.score2 >= targetWinScore) {
    gameState.gameOver = true;
    gameState.winner = 2;
    gameState.rematch = { p1Ready: false, p2Ready: false };
    setLastRoundLoserId(0);
    Network.sendEvent('win');
    sound.playWin();
    uiHooks.renderRematchUI();
  } else {
    // Раунд завершено: запам'ятовуємо переможеного для вибору бонусу та ставимо таймер
    setLastRoundLoserId(victimTank.id);
    setRoundResetTimer(75);
    gameState.bullets = [];
  }
}

/**
 * Оновлення снарядів та колізій (Куля-стіна з рикошетом та миттєвим руйнуванням, Куля-танк із бронею та шипами, Куля-куля з пробиттям)
 */
export function updateBulletsAndCollisions() {
  const remainingBullets = [];

  for (let i = 0; i < gameState.bullets.length; i++) {
    const b = gameState.bullets[i];
    const prevX = b.x;
    const prevY = b.y;
    b.update();

    // 1. Межі карти
    if (b.isOutOfBounds(canvasWidth, canvasHeight)) {
      addExplosion(b.x, b.y, 6);
      continue;
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
          const tileId = gameState.map[r][c];
          const block = TILE_BY_ID[tileId];

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

              // Спавн частинок уламків цегли (Debris)
              const blockCenterX = c * tileSize + tileSize / 2;
              const blockCenterY = r * tileSize + tileSize / 2;
              spawnDebris(blockCenterX, blockCenterY, 8, block.color || '#b84418');
              Network.sendEvent('debris', { x: blockCenterX, y: blockCenterY, color: block.color || '#b84418' });

              if (gameState.tileHp[r][c] <= 0) {
                // Блок повністю зруйновано! (Якщо під ним був лід у gameState.ice[r][c] === 1, лід залишається!)
                gameState.map[r][c] = (gameState.ice && gameState.ice[r] && gameState.ice[r][c] === 1) ? 10 : 0;
                gameState.tileHp[r][c] = 0;
                addExplosion(blockCenterX, blockCenterY, 12);
                Network.sendEvent('hitBrick');
                sound.playBrickHit();
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

              b.x = prevX + b.vx;
              b.y = prevY + b.vy;
              b.angle = Math.atan2(b.vy, b.vx);
              bouncedOffWall = true;
            }
            break;
          }
        }
      }
      if (hitObstacle) break;
    }

    if (hitObstacle && !bouncedOffWall) continue;

    // 3. Влучання в танк суперника із застосуванням шкоди (через міни кулі пролітають вільно)
    const targetTank = b.ownerId === 1 ? p2Tank : p1Tank;
    const shooterTank = b.ownerId === 1 ? p1Tank : p2Tank;
    if (targetTank && !targetTank.isDead && targetTank.spawnShieldTimer <= 0) {
      const hitTank = (
        b.x < targetTank.x + tankSize &&
        b.x + 6 > targetTank.x &&
        b.y < targetTank.y + tankSize &&
        b.y + 6 > targetTank.y
      );

      if (hitTank) {
        // 0. Якщо у Фантомного корпусу діє 0.25с імпульсний щит невразливості після попереднього влучання — блокуємо постріл без перевірки шансу броні
        if (targetTank.hitInvulnTimer > 0) {
          addExplosion(b.x, b.y, 6);
          spawnDebris(b.x, b.y, 5, '#00e5ff');
          sound.playSteelHit();
          Network.sendEvent('armorBlock', { targetId: targetTank.id, x: b.x, y: b.y });
          continue;
        }

        // Якщо у Фантомного корпусу розблоковано камбек-пасивку (після 50% програних раундів) — після кожного влучання вмикається 0.25с (15 кадрів) невразливості
        if (typeof targetTank.isPhantomComebackActive === 'function' && targetTank.isPhantomComebackActive(gameState)) {
          targetTank.hitInvulnTimer = (HULL_TYPES.phantom && HULL_TYPES.phantom.hitInvulnFrames) || 15;
        }

        // Перевірка спрацювання броні корпусу:
        // Для Фантомного корпусу (unpierceableArmor: true) ворог НЕ може пробити броню навіть зі здібністю "Бронебійні снаряди" (ignore_armor)!
        const targetArmor = typeof targetTank.armor === 'number'
          ? targetTank.armor
          : ((HULL_TYPES[targetTank.hullType] && HULL_TYPES[targetTank.hullType].armor) || 0.20);
        const isUnpierceable = Boolean(
          targetTank.unpierceableArmor ||
          (HULL_TYPES[targetTank.hullType] && HULL_TYPES[targetTank.hullType].unpierceableArmor)
        );
        const canIgnoreArmor = Boolean(b.ignoreArmor && !isUnpierceable);
        const finalDamage = canIgnoreArmor ? b.damage : calculateArmorDamage(b.damage, targetArmor);

        if (finalDamage === 0) {
          // Броня повністю заблокувала всю шкоду (Рикошет!)
          addExplosion(b.x, b.y, 6);
          spawnDebris(b.x, b.y, 6, '#00e5ff');
          sound.playSteelHit();
          Network.sendEvent('armorBlock', { targetId: targetTank.id, x: b.x, y: b.y });
          continue;
        }

        targetTank.hp = Math.max(0, targetTank.hp - finalDamage);

        // Тряска екрана при влучанні у власний танк хоста
        if (targetTank.id === 1) {
          triggerScreenShake(7, 14);
        }

        Network.sendEvent('tankHit', { targetId: targetTank.id, damage: finalDamage });

        // Перевірка перка "Шипи" (thorns_50): якщо стрілець у невеликому радіусі поруч, він отримує 50% шкоди у відповідь
        applyThornsDamage(targetTank, shooterTank, finalDamage);

        if (targetTank.hp <= 0) {
          handleTankKill(targetTank, b.ownerId);
        } else {
          // Танк поранений, але продовжує бій
          addExplosion(b.x, b.y, 8);
          sound.playSteelHit();
        }

        continue;
      }
    }

    remainingBullets.push(b);
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

  for (let i = gameState.mines.length - 1; i >= 0; i--) {
    const mine = gameState.mines[i];
    if (typeof mine.update === 'function') mine.update();

    const enemyTank = mine.ownerId === 1 ? p2Tank : p1Tank;
    const ownerTank = mine.ownerId === 1 ? p1Tank : p2Tank;
    if (!enemyTank || enemyTank.isDead || enemyTank.spawnShieldTimer > 0) continue;

    const closestX = Math.max(enemyTank.x, Math.min(mine.x, enemyTank.x + tankSize));
    const closestY = Math.max(enemyTank.y, Math.min(mine.y, enemyTank.y + tankSize));
    const dist = Math.hypot(mine.x - closestX, mine.y - closestY);

    if (dist <= (mine.radius || 10)) {
      const dmg = typeof mine.rollDamage === 'function' ? mine.rollDamage() : 50;
      gameState.mines.splice(i, 1);

      enemyTank.hp = Math.max(0, enemyTank.hp - dmg);
      addExplosion(mine.x, mine.y, 22, false);
      spawnDebris(mine.x, mine.y, 10, '#e74c3c');

      if (enemyTank.id === 1) {
        triggerScreenShake(11, 18);
      }

      Network.sendEvent('mineExplode', { targetId: enemyTank.id, x: mine.x, y: mine.y, damage: dmg });
      sound.playExplosion();

      // Перевірка перка "Шипи" при вибуху міни впритул до її власника
      applyThornsDamage(enemyTank, ownerTank, dmg);

      if (enemyTank.hp <= 0) {
        handleTankKill(enemyTank, mine.ownerId);
        break;
      }
    }
  }
}

/**
 * Пасивні здібності танків під час активного раунду:
 * 0) Таймер раунду (roundTimeFrames), перезарядка диму (30с) та артилерії (35с), +1 макс. урону кожні 10с (time_scaling_max_dmg)
 * 1) Регенерація +1 HP (за стек) кожні 5 секунд (300 тіків)
 * 2) Ближній розряд: впритул (у невеликому радіусі) знімає 10 HP ворогу кожні 2 секунди (120 тіків),
 *    таймер скидається в 0, коли ворог виходить з радіуса
 */
export function updateTankPassives() {
  const tanks = [p1Tank, p2Tank];
  let hudNeedsUpdate = false;

  // 0.1. Таймер раунду та рідкісна здібність "+1 макс. урону кожні 10с раунду" (time_scaling_max_dmg)
  if (gameState && !gameState.gameOver && (!gameState.perkSelection || !gameState.perkSelection.active)) {
    gameState.roundTimeFrames = (gameState.roundTimeFrames || 0) + 1;
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

  // 0.2. Зменшення таймера перезарядки димової завіси (30с = 1800 кадрів) та артилерії (35с = 2100 кадрів)
  for (const t of tanks) {
    if (!t) continue;
    if (t.smokeCooldownTimer > 0) {
      const prevSec = Math.ceil(t.smokeCooldownTimer / 60);
      t.smokeCooldownTimer--;
      const nextSec = Math.ceil(t.smokeCooldownTimer / 60);
      if (prevSec !== nextSec) hudNeedsUpdate = true;
    }
    if (t.artilleryCooldownTimer > 0) {
      const prevArtSec = Math.ceil(t.artilleryCooldownTimer / 60);
      t.artilleryCooldownTimer--;
      const nextArtSec = Math.ceil(t.artilleryCooldownTimer / 60);
      if (prevArtSec !== nextArtSec) hudNeedsUpdate = true;
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
  const pairs = [
    [p1Tank, p2Tank],
    [p2Tank, p1Tank]
  ];

  for (const [attacker, target] of pairs) {
    if (!attacker || attacker.isDead || !(attacker.proximityDmg > 0) || !target || target.isDead || target.spawnShieldTimer > 0) {
      if (attacker) attacker.proximityTimer = 0;
      continue;
    }

    const c1 = attacker.getCenter();
    const c2 = target.getCenter();
    const dist = Math.hypot(c2.x - c1.x, c2.y - c1.y);

    if (dist <= proximityRadius) {
      attacker.proximityTimer = (attacker.proximityTimer || 0) + 1;
      if (attacker.proximityTimer >= 120) {
        attacker.proximityTimer = 0;
        const dmg = attacker.proximityDmg;
        target.hp = Math.max(0, target.hp - dmg);
        addExplosion(c2.x, c2.y, 10, false);
        Network.sendEvent('tankHit', { targetId: target.id, damage: dmg });
        sound.playSteelHit();

        // Перевірка перка "Шипи" у цілі при отриманні шкоди від ближнього розряду
        applyThornsDamage(target, attacker, dmg);

        if (target.hp <= 0) {
          handleTankKill(target, attacker.id);
          break;
        }
      }
    } else {
      // Коли ворог не в радіусі — таймер негайно оновлюється (скидається в 0)
      attacker.proximityTimer = 0;
    }
  }
}
