/**
 * netSync.js — Модуль авторитетного серверного такту (Host / Test Mode) та P2P WebRTC синхронізації
 *
 * Відповідальність:
 * - Авторський ігровий такт Хоста та Полігону (hostUpdate)
 * - Формування та відправка знімка стану гри клієнту (Network.sendState)
 * - Реєстрація та обробка всіх мережевих подій WebRTC (initNetworkCallbacks: onConnected, onDisconnected,
 *   onMapReceived, onLoadoutReceived, onStateReceived, onInputReceived, onPerkSelected, onPerkReroll,
 *   onEventReceived, onRematchReceived, onStatusChange, onPingUpdate, onError)
 */

import { Bullet, Mine, Explosion, SmokeCloud } from './entities.js?v=20261011_v17';
import { PERK_TYPES } from './config.js?v=20261011_v17';
import { MapStorage, updateHostMapDropdown, updateAllMapPreviews, showToast } from './editor.js?v=20261011_v17';
import Network from './network.js?v=20261011_v17';
import { sound } from './audio.js?v=20261011_v17';
import {
  setLastTankPos, triggerScreenShake, isTankOnEnemySlowingTrack,
  spawnDebris, spawnMuzzleFlash, spawnSmoke,
  updateParticles as updateParticlesVfx,
  updateExplosions as updateExplosionsVfx
} from './vfx.js?v=20261011_v17';
import {
  currentActiveMap, gridCols, gridRows, tileSize, canvasWidth, canvasHeight, tankSize,
  MAX_SCORE, setTargetWinScore,
  roundResetTimer, lastRoundLoserId, p1Tank, p2Tank,
  localLoadout, p1Loadout, p2Loadout, currentFps,
  gameState, renderTanks,
  localInput, p1Input, p2Input,
  decrementRoundResetTimer,
  setCurrentActiveMap, setP1Loadout, setP2Loadout,
  setP2Input, setArenaDims,
  setupGameMap, restoreMapState,
  resetRoundSpawns, resetForRematch
} from './state.js?v=20261011_v17';
import { updatePlayersVisibilityState } from './vision.js?v=20261011_v17';
import {
  startPerkSelection, rerollPerkOptions, selectPerk, renderPerkSelectionUI
} from './perks.js?v=20261011_v17';
import {
  checkMapCollision, checkTankCollision, spawnBullet,
  useSmokeForTank, useArtilleryForTank, surrenderMatch,
  triggerActiveAbilityForTank,
  startManualReloadForTank, useRepairKitForTank,
  updateBulletsAndCollisions, updateMinesAndCollisions, updateTankPassives
} from './combat.js?v=20261011_v17';
import {
  renderRematchUI, updateTelemetryUI, updateHUD,
  setConnectionStatus, startActiveMatch
} from './ui.js?v=20261011_v17';

/**
 * Авторитетний такт Хоста та Полігону (Authoritative Server / Test Mode Cycle)
 */
export function hostUpdate() {
  const isTest = Boolean(gameState && gameState.isTestMode);
  if ((!Network.isHost || !Network.connectionActive) && !isTest) return;

  if (roundResetTimer > 0) {
    decrementRoundResetTimer();
    if (roundResetTimer === 0 && !gameState.gameOver) {
      const loserToPick = lastRoundLoserId;
      resetRoundSpawns();
      if (loserToPick === 1 || loserToPick === 2) {
        startPerkSelection(loserToPick);
      }
    }
  }

  const isSelectingPerk = Boolean(gameState.perkSelection && gameState.perkSelection.active);

  if (!gameState.gameOver && !isSelectingPerk) {
    // Синхронізація обраної активної здібності (Q / E) від вводу гравців
    if (p1Input && typeof p1Input.selectedActive === 'string' && p1Tank) {
      p1Tank.selectedActive = p1Input.selectedActive;
      p1Tank.localSelectedActive = p1Input.selectedActive;
    }
    if (p2Input && typeof p2Input.selectedActive === 'string' && p2Tank) {
      p2Tank.selectedActive = p2Input.selectedActive;
      p2Tank.localSelectedActive = p2Input.selectedActive;
    }

    // 1. Оновлення фізики та кутів танків (з урахуванням льоду та сповільнюючих слідів ворога)
    if (roundResetTimer <= 0) {
      p1Tank.slowedByEnemyTrack = isTankOnEnemySlowingTrack(p1Tank);
      p2Tank.slowedByEnemyTrack = isTankOnEnemySlowingTrack(p2Tank);
      p1Tank.update(p1Input, p2Tank, gameState.map, canvasWidth, canvasHeight, tileSize, checkMapCollision, checkTankCollision, {
        iceGrid: gameState.ice,
        enemyTrackSlow: p1Tank.slowedByEnemyTrack
      });
      p2Tank.update(p2Input, p1Tank, gameState.map, canvasWidth, canvasHeight, tileSize, checkMapCollision, checkTankCollision, {
        iceGrid: gameState.ice,
        enemyTrackSlow: p2Tank.slowedByEnemyTrack
      });
    } else {
      if (p1Tank.spawnShieldTimer > 0) p1Tank.spawnShieldTimer--;
      if (p2Tank.spawnShieldTimer > 0) p2Tank.spawnShieldTimer--;
    }

    // 2. Обробка стрільби, ручної перезарядки (R), активних здібностей (Міни / Дим / Артилерія) та ремкомплекту (H)
    if (roundResetTimer <= 0) {
      if (p1Input.reloadClip) {
        startManualReloadForTank(p1Tank);
        p1Input.reloadClip = false;
        if (Network.myPlayerId === 1) localInput.reloadClip = false;
      }
      if (p2Input.reloadClip) {
        startManualReloadForTank(p2Tank);
        p2Input.reloadClip = false;
        if (Network.myPlayerId === 2) localInput.reloadClip = false;
      }

      if (p1Input.useRepair && p1Tank.canUseRepairKit()) {
        useRepairKitForTank(p1Tank);
        p1Input.useRepair = false;
        if (Network.myPlayerId === 1) localInput.useRepair = false;
      }
      if (p2Input.useRepair && p2Tank.canUseRepairKit()) {
        useRepairKitForTank(p2Tank);
        p2Input.useRepair = false;
        if (Network.myPlayerId === 2) localInput.useRepair = false;
      }

      if (p1Input.useSmoke && p1Tank.canUseSmoke()) {
        useSmokeForTank(p1Tank);
        p1Input.useSmoke = false;
        if (Network.myPlayerId === 1) localInput.useSmoke = false;
      }
      if (p2Input.useSmoke && p2Tank.canUseSmoke()) {
        useSmokeForTank(p2Tank);
        p2Input.useSmoke = false;
        if (Network.myPlayerId === 2) localInput.useSmoke = false;
      }

      if (p1Input.artilleryStrike && p1Tank.canUseArtillery()) {
        useArtilleryForTank(p1Tank, p1Input.artilleryStrike.col, p1Input.artilleryStrike.row);
        p1Input.artilleryStrike = null;
        if (Network.myPlayerId === 1) localInput.artilleryStrike = null;
      }
      if (p2Input.artilleryStrike && p2Tank.canUseArtillery()) {
        useArtilleryForTank(p2Tank, p2Input.artilleryStrike.col, p2Input.artilleryStrike.row);
        p2Input.artilleryStrike = null;
        if (Network.myPlayerId === 2) localInput.artilleryStrike = null;
      }

      if (p1Input.placeMine) {
        triggerActiveAbilityForTank(p1Tank);
        p1Input.placeMine = false;
        if (Network.myPlayerId === 1) localInput.placeMine = false;
      }
      if (p2Input.placeMine) {
        triggerActiveAbilityForTank(p2Tank);
        p2Input.placeMine = false;
        if (Network.myPlayerId === 2) localInput.placeMine = false;
      }

      if (p1Input.shoot && p1Tank.canShoot()) {
        spawnBullet(p1Tank);
      }

      if (p2Input.shoot && p2Tank.canShoot()) {
        spawnBullet(p2Tank);
      }
    }

    // 3. Снаряди, міни та пасивні здібності
    updateBulletsAndCollisions();
    if (roundResetTimer <= 0) {
      updateMinesAndCollisions();
      updateTankPassives();
    }

    // 4. Стелс: пряма видимість (LoS), конус погляду вежі, маскування в кущах і воді, низькі кущі, дим 3x3, ВХ та затримка погляду 1с
    updatePlayersVisibilityState();
  }

  updateExplosionsVfx(gameState);
  updateParticlesVfx(p1Tank, p2Tank, gameState);

  // Трансляція авторитетного стану клієнту (якщо активне P2P з'єднання)
  if (Network.isHost && Network.connectionActive) {
    Network.sendState({
      mapName: gameState.mapName,
      width: gameState.width,
      height: gameState.height,
      tileSize: tileSize,
      tankSize: tankSize,
      roundTimeFrames: gameState.roundTimeFrames || 0,
      surrenderedBy: gameState.surrenderedBy || 0,
      map: gameState.map,
      bushes: gameState.bushes,
      ice: gameState.ice,
      tileHp: gameState.tileHp,
      visibility: gameState.visibility,
      perkSelection: gameState.perkSelection,
      p1: {
        x: p1Tank.x, y: p1Tank.y,
        bodyAngle: p1Tank.bodyAngle, turretAngle: p1Tank.turretAngle,
        hp: p1Tank.hp, maxHp: p1Tank.maxHp, armor: p1Tank.armor,
        minDmg: p1Tank.minDmg, maxDmg: p1Tank.maxDmg,
        reloadTime: p1Tank.reloadTime, fireRate: p1Tank.fireRate,
        roundTimeDmgBonus: p1Tank.roundTimeDmgBonus || 0,
        hitInvulnTimer: p1Tank.hitInvulnTimer || 0,
        hull: p1Tank.hullType, turret: p1Tank.turretType, fov: p1Tank.fov,
        ammo: p1Tank.ammo, clipSize: p1Tank.clipSize,
        isReloadingClip: p1Tank.isReloadingClip,
        reloadProgress: p1Tank.getReloadProgress(),
        minesLeft: p1Tank.minesLeft, maxMines: p1Tank.maxMines,
        hasSmokeScreen: p1Tank.hasSmokeScreen,
        smokeCooldownTimer: p1Tank.smokeCooldownTimer || 0,
        hasArtillery: p1Tank.hasArtillery,
        artilleryCooldownTimer: p1Tank.artilleryCooldownTimer || 0,
        selectedActive: p1Tank.selectedActive,
        repairKitsLeft: p1Tank.repairKitsLeft, maxRepairKits: p1Tank.maxRepairKits,
        rebirthsLeft: p1Tank.rebirthsLeft, maxRebirths: p1Tank.maxRebirths,
        rerollsLeft: p1Tank.rerollsLeft, maxRerolls: p1Tank.maxRerolls,
        acquiredPerks: p1Tank.acquiredPerks,
        isDead: p1Tank.isDead, respawnTimer: p1Tank.respawnTimer,
        spawnShieldTimer: p1Tank.spawnShieldTimer, animFrame: p1Tank.animFrame
      },
      p2: {
        x: p2Tank.x, y: p2Tank.y,
        bodyAngle: p2Tank.bodyAngle, turretAngle: p2Tank.turretAngle,
        hp: p2Tank.hp, maxHp: p2Tank.maxHp, armor: p2Tank.armor,
        minDmg: p2Tank.minDmg, maxDmg: p2Tank.maxDmg,
        reloadTime: p2Tank.reloadTime, fireRate: p2Tank.fireRate,
        roundTimeDmgBonus: p2Tank.roundTimeDmgBonus || 0,
        hitInvulnTimer: p2Tank.hitInvulnTimer || 0,
        hull: p2Tank.hullType, turret: p2Tank.turretType, fov: p2Tank.fov,
        ammo: p2Tank.ammo, clipSize: p2Tank.clipSize,
        isReloadingClip: p2Tank.isReloadingClip,
        reloadProgress: p2Tank.getReloadProgress(),
        minesLeft: p2Tank.minesLeft, maxMines: p2Tank.maxMines,
        hasSmokeScreen: p2Tank.hasSmokeScreen,
        smokeCooldownTimer: p2Tank.smokeCooldownTimer || 0,
        hasArtillery: p2Tank.hasArtillery,
        artilleryCooldownTimer: p2Tank.artilleryCooldownTimer || 0,
        selectedActive: p2Tank.selectedActive,
        repairKitsLeft: p2Tank.repairKitsLeft, maxRepairKits: p2Tank.maxRepairKits,
        rebirthsLeft: p2Tank.rebirthsLeft, maxRebirths: p2Tank.maxRebirths,
        rerollsLeft: p2Tank.rerollsLeft, maxRerolls: p2Tank.maxRerolls,
        acquiredPerks: p2Tank.acquiredPerks,
        isDead: p2Tank.isDead, respawnTimer: p2Tank.respawnTimer,
        spawnShieldTimer: p2Tank.spawnShieldTimer, animFrame: p2Tank.animFrame
      },
      bullets: gameState.bullets.map(b => ({
        ownerId: b.ownerId, x: b.x, y: b.y, vx: b.vx, vy: b.vy, damage: b.damage, angle: b.angle,
        pierceLeft: b.pierceLeft || 0, ricochetsLeft: b.ricochetsLeft || 0,
        ignoreArmor: Boolean(b.ignoreArmor), instantBreak: Boolean(b.instantBreak),
        invisibleToEnemy: Boolean(b.invisibleToEnemy)
      })),
      mines: (gameState.mines || []).map(m => ({
        ownerId: m.ownerId, x: m.x, y: m.y
      })),
      smokeClouds: (gameState.smokeClouds || []).map(sc => ({
        ownerId: sc.ownerId, centerCol: sc.centerCol, centerRow: sc.centerRow,
        tileSize: sc.tileSize, life: sc.life, maxLife: sc.maxLife
      })),
      explosions: gameState.explosions.map(e => ({
        x: e.x, y: e.y, radius: e.radius, life: e.life, maxLife: e.maxLife, isTank: e.isTank
      })),
      score1: gameState.score1,
      score2: gameState.score2,
      targetScore: gameState.targetScore || MAX_SCORE,
      gameOver: gameState.gameOver,
      winner: gameState.winner,
      rematch: gameState.rematch,
      isEnemyVisible: gameState.visibility ? gameState.visibility.p2CanSeeP1 : gameState.isEnemyVisible
    });
  }

  updateHUD();
}

/**
 * Реєстрація мережевих подій WebRTC (Network.init)
 */
export function initNetworkCallbacks() {
  Network.init({
    onConnected: ({ isHost, myPlayerId }) => {
      const isP1 = myPlayerId === 1;
      const selectH = document.getElementById(isP1 ? 'selectHull' : 'selectGuestHull');
      const selectT = document.getElementById(isP1 ? 'selectTurret' : 'selectGuestTurret');
      if (selectH && selectH.value) localLoadout.hull = selectH.value;
      if (selectT && selectT.value) localLoadout.turret = selectT.value;

      try {
        if (typeof Network.sendMapsCatalog === 'function' && MapStorage && typeof MapStorage.getMaps === 'function') {
          Network.sendMapsCatalog(MapStorage.getMaps());
        }
      } catch (e) {
        console.warn('Не вдалося надіслати каталог карт:', e);
      }

      if (isHost && currentActiveMap) {
        Network.sendMap(currentActiveMap);
        Network.sendLoadout(localLoadout);
      } else {
        const gMap = gameState && gameState.guestSelectedMap;
        if (gMap && gMap.id && gMap.id !== 'default_classic_map' && gMap.id !== 'default') {
          Network.sendMap(gMap);
        }
        Network.sendLoadout(localLoadout);
      }
      startActiveMatch(isHost, myPlayerId);
    },
    onDisconnected: () => {
      showToast('⚠️ З\'єднання втрачено: суперник покинув гру.');
    },
    onMapsCatalogReceived: (remoteMaps) => {
      if (Array.isArray(remoteMaps) && remoteMaps.length > 0) {
        MapStorage.mergeRemoteMaps(remoteMaps);
        updateHostMapDropdown();
        updateAllMapPreviews();
      }
    },
    onMapReceived: (receivedMap) => {
      if (receivedMap && Array.isArray(receivedMap.grid)) {
        MapStorage.mergeRemoteMaps([receivedMap]);
        setupGameMap(receivedMap);
        updateHostMapDropdown();
        const remMap = document.getElementById('selectRematchMap');
        if (remMap && receivedMap.id) remMap.value = receivedMap.id;
        updateAllMapPreviews();
        if (Network.isHost) {
          showToast(`🗺️ Гравець 2 обрав карту «${receivedMap.name || 'Нова мапа'}»!`);
        }
      }
    },
    onLoadoutReceived: (loadout) => {
      if (Network.isHost) {
        setP2Loadout({ ...loadout });
        if (p2Tank) {
          const wasAtFullHp = p2Tank.hp >= p2Tank.maxHp;
          p2Tank.applyLoadout(p2Loadout.hull, p2Loadout.turret);
          if (wasAtFullHp || (gameState.score1 === 0 && gameState.score2 === 0 && p2Tank.spawnShieldTimer > 0)) {
            p2Tank.hp = p2Tank.maxHp;
          }
        }
        Network.sendLoadout(localLoadout);
      } else {
        setP1Loadout({ ...loadout });
        if (p1Tank) {
          const wasAtFullHp = p1Tank.hp >= p1Tank.maxHp;
          p1Tank.applyLoadout(p1Loadout.hull, p1Loadout.turret);
          if (wasAtFullHp) p1Tank.hp = p1Tank.maxHp;
        }
      }
      updateHUD();
    },
    onStateReceived: (newState) => {
      if (!newState) return;

      if (newState.targetScore && newState.targetScore !== MAX_SCORE) {
        setTargetWinScore(newState.targetScore);
      }

      // Якщо клієнт ще не ініціалізував мапу або розмір сітки/тайла відрізняється від Хоста — синхронізуємо геометрію 1:1
      if (!p1Tank || !p2Tank || (newState.width && newState.height && (newState.width !== gridCols || newState.height !== gridRows))) {
        setupGameMap({
          id: 'synced_host_map',
          name: newState.mapName || 'Класична',
          width: newState.width || 16,
          height: newState.height || 16,
          p1Spawn: { x: 1, y: 1 },
          p2Spawn: { x: Math.max(1, (newState.width || 16) - 2), y: Math.max(1, (newState.height || 16) - 2) },
          grid: newState.map || [],
          bushes: newState.bushes || [],
          ice: newState.ice || []
        });
      }

      if (newState.tileSize && newState.tileSize !== tileSize) {
        setArenaDims({
          tileSize: newState.tileSize,
          canvasWidth: gridCols * newState.tileSize,
          canvasHeight: gridRows * newState.tileSize,
          tankSize: newState.tankSize || Math.max(18, Math.floor(newState.tileSize * 0.82))
        });
        if (p1Tank) p1Tank.size = tankSize;
        if (p2Tank) p2Tank.size = tankSize;
        const gCanvas = typeof document !== 'undefined' ? document.getElementById('gameCanvas') : null;
        if (gCanvas) {
          gCanvas.width = canvasWidth;
          gCanvas.height = canvasHeight;
        }
      }

      p1Tank.syncFrom(newState.p1);

      if (Network.myPlayerId === 2) {
        const hostHasStaleLoadout = Boolean(
          newState.p2 &&
          ((localLoadout.hull && newState.p2.hull && newState.p2.hull !== localLoadout.hull) ||
           (localLoadout.turret && newState.p2.turret && newState.p2.turret !== localLoadout.turret))
        );

        if (hostHasStaleLoadout) {
          p2Tank.x = newState.p2.x;
          p2Tank.y = newState.p2.y;
          if (Number.isFinite(newState.p2.bodyAngle)) p2Tank.bodyAngle = newState.p2.bodyAngle;
          p2Tank.isDead = newState.p2.isDead;
          p2Tank.respawnTimer = newState.p2.respawnTimer;
          p2Tank.spawnShieldTimer = newState.p2.spawnShieldTimer;
          p2Tank.animFrame = newState.p2.animFrame;
          if (typeof newState.p2.hasSmokeScreen === 'boolean') p2Tank.hasSmokeScreen = newState.p2.hasSmokeScreen;
          if (typeof newState.p2.smokeCooldownTimer === 'number') p2Tank.smokeCooldownTimer = newState.p2.smokeCooldownTimer;
          if (typeof newState.p2.hasArtillery === 'boolean') p2Tank.hasArtillery = newState.p2.hasArtillery;
          if (typeof newState.p2.artilleryCooldownTimer === 'number') p2Tank.artilleryCooldownTimer = newState.p2.artilleryCooldownTimer;
          if (typeof newState.p2.hitInvulnTimer === 'number') p2Tank.hitInvulnTimer = newState.p2.hitInvulnTimer;
          if (typeof newState.p2.roundTimeDmgBonus === 'number') p2Tank.roundTimeDmgBonus = newState.p2.roundTimeDmgBonus;
          p2Tank.applyLoadout(localLoadout.hull, localLoadout.turret);
          Network.sendLoadout(localLoadout);
        } else {
          p2Tank.syncFrom(newState.p2);
          if (localLoadout.turret && (p2Tank.turretType !== localLoadout.turret || p2Tank.hullType !== localLoadout.hull)) {
            p2Tank.applyLoadout(localLoadout.hull, localLoadout.turret);
          }
        }

        if (Number.isFinite(localInput.turretAngle)) {
          p2Tank.turretAngle = localInput.turretAngle;
        }
      } else {
        p2Tank.syncFrom(newState.p2);
      }

      gameState.map = newState.map;
      if (newState.bushes) gameState.bushes = newState.bushes;
      if (newState.ice) gameState.ice = newState.ice;
      if (newState.tileHp) gameState.tileHp = newState.tileHp;
      if (newState.visibility) gameState.visibility = newState.visibility;
      if (typeof newState.roundTimeFrames === 'number') gameState.roundTimeFrames = newState.roundTimeFrames;
      if (typeof newState.surrenderedBy === 'number') gameState.surrenderedBy = newState.surrenderedBy;

      if (newState.perkSelection) {
        const prev = gameState.perkSelection || {};
        const wasActive = Boolean(prev.active);
        const nowActive = Boolean(newState.perkSelection.active);
        const prevKey = JSON.stringify([prev.options, prev.picksRemaining, prev.rerollsLeft]);
        const nextKey = JSON.stringify([newState.perkSelection.options, newState.perkSelection.picksRemaining, newState.perkSelection.rerollsLeft]);
        gameState.perkSelection = newState.perkSelection;
        if (wasActive !== nowActive || (nowActive && prevKey !== nextKey)) {
          renderPerkSelectionUI();
        }
      }

      if (newState.rematch) {
        gameState.rematch = {
          p1Ready: Boolean(newState.rematch.p1Ready),
          p2Ready: Boolean(newState.rematch.p2Ready)
        };
      }

      gameState.bullets = (newState.bullets || []).map(b => new Bullet(
        b.ownerId, b.x, b.y, b.vx, b.vy, b.damage || 20, b.angle || 0,
        {
          pierceLeft: b.pierceLeft || 0,
          ricochetsLeft: b.ricochetsLeft || 0,
          ignoreArmor: Boolean(b.ignoreArmor),
          instantBreak: Boolean(b.instantBreak),
          invisibleToEnemy: Boolean(b.invisibleToEnemy)
        }
      ));
      gameState.mines = (newState.mines || []).map(m => new Mine(m.ownerId, m.x, m.y));
      gameState.smokeClouds = (newState.smokeClouds || []).map(sc => new SmokeCloud(
        sc.ownerId,
        sc.centerCol,
        sc.centerRow,
        sc.tileSize || tileSize,
        sc.life,
        sc.maxLife
      ));
      gameState.explosions = (newState.explosions || []).map(e => {
        const exp = new Explosion(e.x, e.y, e.radius, e.isTank);
        exp.life = e.life;
        exp.maxLife = e.maxLife;
        return exp;
      });

      gameState.score1 = newState.score1;
      gameState.score2 = newState.score2;
      gameState.gameOver = newState.gameOver;
      gameState.winner = newState.winner;
      gameState.isEnemyVisible = newState.visibility ? newState.visibility.p2CanSeeP1 : newState.isEnemyVisible;

      updateHUD();
    },
    onInputReceived: (inputData) => {
      setP2Input(inputData);
      if (inputData && typeof inputData.selectedActive === 'string' && p2Tank) {
        p2Tank.selectedActive = inputData.selectedActive;
        p2Tank.localSelectedActive = inputData.selectedActive;
      }
    },
    onPerkSelected: (perkId) => {
      if (Network.isHost && gameState.perkSelection && gameState.perkSelection.active) {
        selectPerk(2, perkId);
      }
    },
    onPerkReroll: () => {
      if (Network.isHost && gameState.perkSelection && gameState.perkSelection.active) {
        rerollPerkOptions(2);
      }
    },
    onEventReceived: (eventName, eventData) => {
      if (eventName === 'shoot') {
        sound.playShoot();
        if (eventData) {
          const shooterTank = eventData.ownerId === 1 ? p1Tank : (eventData.ownerId === 2 ? p2Tank : null);
          if (shooterTank) {
            shooterTank.recordShot();
          }
          const hiddenFromEnemy = Boolean(eventData.hiddenFromEnemy || (shooterTank && shooterTank.invisibleBullets));
          spawnMuzzleFlash(eventData.x, eventData.y, eventData.angle, eventData.ownerId || 0, hiddenFromEnemy);
          spawnSmoke(eventData.x, eventData.y, eventData.angle, eventData.ownerId || 0, hiddenFromEnemy);
        }
      } else if (eventName === 'minePlaced') {
        sound.playSteelHit();
      } else if (eventName === 'smokeUsed') {
        sound.playSpot();
        if (eventData) {
          const smokeOwner = eventData.ownerId === 1 ? p1Tank : (eventData.ownerId === 2 ? p2Tank : null);
          if (smokeOwner) {
            smokeOwner.smokeCooldownTimer = 1800;
          }
          if (!Network.isHost) {
            gameState.smokeClouds.push(new SmokeCloud(
              eventData.ownerId,
              eventData.centerCol,
              eventData.centerRow,
              eventData.tileSize || tileSize,
              eventData.durationFrames || 300,
              eventData.durationFrames || 300
            ));
          }
          const sx = Number.isFinite(eventData.x) ? eventData.x : (eventData.centerCol + 0.5) * (eventData.tileSize || tileSize);
          const sy = Number.isFinite(eventData.y) ? eventData.y : (eventData.centerRow + 0.5) * (eventData.tileSize || tileSize);
          spawnDebris(sx, sy, 12, '#b2bec3');
        }
        updateHUD();
      } else if (eventName === 'artilleryStrike') {
        sound.playExplosion();
        if (eventData) {
          const artyOwner = eventData.ownerId === 1 ? p1Tank : (eventData.ownerId === 2 ? p2Tank : null);
          if (artyOwner) {
            artyOwner.artilleryCooldownTimer = 2100;
            artyOwner.targetingMode = null;
          }
          const ax = Number.isFinite(eventData.x) ? eventData.x : (eventData.centerCol + 0.5) * tileSize;
          const ay = Number.isFinite(eventData.y) ? eventData.y : (eventData.centerRow + 0.5) * tileSize;
          spawnDebris(ax, ay, 24, '#ff6b6b');
          triggerScreenShake(14, 22);
        }
        updateHUD();
      } else if (eventName === 'surrender') {
        if (eventData) {
          const surId = eventData.surrenderingPlayerId || eventData.playerId || 1;
          surrenderMatch(surId, { fromNetwork: true });
        }
      } else if (eventName === 'manualReload') {
        if (!Network.isHost && eventData) {
          const targetTank = eventData.playerId === 1 ? p1Tank : p2Tank;
          if (targetTank && typeof targetTank.startManualReload === 'function') {
            targetTank.startManualReload();
          }
        }
      } else if (eventName === 'repairUsed') {
        sound.playSpot();
        if (eventData) {
          spawnDebris(eventData.x, eventData.y, 10, '#2ecc71');
        }
        updateHUD();
      } else if (eventName === 'rebirth') {
        sound.playExplosion();
        if (eventData) {
          const targetTank = eventData.playerId === 1 ? p1Tank : p2Tank;
          if (targetTank) {
            targetTank.triggerRebirth();
            if (eventData.playerId === 1) {
              renderTanks.p1.x = targetTank.x;
              renderTanks.p1.y = targetTank.y;
              renderTanks.p1.bodyAngle = targetTank.bodyAngle;
              renderTanks.p1.turretAngle = targetTank.turretAngle;
              setLastTankPos(1, targetTank.x, targetTank.y, targetTank.bodyAngle);
            } else {
              renderTanks.p2.x = targetTank.x;
              renderTanks.p2.y = targetTank.y;
              renderTanks.p2.bodyAngle = targetTank.bodyAngle;
              renderTanks.p2.turretAngle = targetTank.turretAngle;
              setLastTankPos(2, targetTank.x, targetTank.y, targetTank.bodyAngle);
            }
          }
          showToast(`🔥 Гравець ${eventData.playerId} переродився на базі з повним HP!`);
          updateHUD();
        }
      } else if (eventName === 'mineExplode') {
        sound.playExplosion();
        if (eventData) {
          spawnDebris(eventData.x, eventData.y, 10, '#e74c3c');
          if (eventData.targetId === Network.myPlayerId) {
            triggerScreenShake(11, 18);
          }
        }
      } else if (eventName === 'startPerkSelection') {
        if (eventData) {
          gameState.perkSelection = {
            active: true,
            loserId: eventData.loserId,
            options: eventData.options || [],
            picksRemaining: eventData.picksRemaining || 1,
            totalPicks: eventData.totalPicks || 1,
            rerollsLeft: eventData.rerollsLeft || 0,
            maxRerolls: eventData.maxRerolls || 0
          };
          renderPerkSelectionUI();
          updateHUD();
        }
      } else if (eventName === 'perkPartialChosen') {
        if (eventData) {
          const targetTank = eventData.playerId === 1 ? p1Tank : p2Tank;
          if (targetTank) {
            if (Array.isArray(eventData.acquiredPerks)) {
              targetTank.acquiredPerks = [...eventData.acquiredPerks];
              targetTank.applyLoadout(targetTank.hullType, targetTank.turretType);
            } else if (eventData.perkId) {
              targetTank.applyPerk(eventData.perkId, { refreshRerolls: false });
            }
          }
          if (gameState.perkSelection) {
            const selSource = eventData.perkSelection || eventData;
            gameState.perkSelection.options = selSource.options || [];
            gameState.perkSelection.picksRemaining = selSource.picksRemaining || 1;
            if (typeof selSource.rerollsLeft === 'number') {
              gameState.perkSelection.rerollsLeft = selSource.rerollsLeft;
            }
          }
          const perkDef = PERK_TYPES[eventData.perkId];
          if (perkDef) {
            showToast(`✨ Гравець ${eventData.playerId} обрав 1-шу здібність: ${perkDef.title}`);
          }
          renderPerkSelectionUI();
          updateHUD();
        }
      } else if (eventName === 'perkChosen') {
        if (eventData) {
          const targetTank = eventData.playerId === 1 ? p1Tank : p2Tank;
          if (targetTank) {
            if (Array.isArray(eventData.acquiredPerks)) {
              targetTank.acquiredPerks = [...eventData.acquiredPerks];
              targetTank.applyLoadout(targetTank.hullType, targetTank.turretType);
            } else if (eventData.perkId) {
              targetTank.applyPerk(eventData.perkId, { refreshRerolls: false });
            }
            targetTank.respawn({ preserveRerolls: true });
          }
          gameState.perkSelection = { active: false, loserId: 0, options: [], picksRemaining: 1, totalPicks: 1, rerollsLeft: 0, maxRerolls: 0 };
          const perkDef = PERK_TYPES[eventData.perkId];
          if (perkDef) {
            showToast(`✨ Гравець ${eventData.playerId} обрав здібність: ${perkDef.title}`);
          }
          renderPerkSelectionUI();
          updateHUD();
        }
      } else if (eventName === 'debris') {
        if (eventData) {
          spawnDebris(eventData.x, eventData.y, 8, eventData.color);
        }
      } else if (eventName === 'tankHit') {
        sound.playSteelHit();
        if (eventData && eventData.targetId === Network.myPlayerId) {
          triggerScreenShake(7, 14);
        }
      } else if (eventName === 'armorBlock') {
        sound.playSteelHit();
        if (eventData) {
          spawnDebris(eventData.x, eventData.y, 6, '#00e5ff');
        }
      } else if (eventName === 'hitBrick') {
        sound.playBrickHit();
      } else if (eventName === 'hitSteel') {
        sound.playSteelHit();
      } else if (eventName === 'explosion') {
        sound.playExplosion();
        if (eventData && eventData.isTank) {
          triggerScreenShake(14, 22);
        }
      } else if (eventName === 'win') {
        sound.playWin();
      } else if (eventName === 'roundReset') {
        restoreMapState();
        gameState.roundTimeFrames = 0;
        if (p1Tank && p2Tank) {
          p1Tank.respawn();
          p2Tank.respawn();
          renderTanks.p1.x = p1Tank.spawnX;
          renderTanks.p1.y = p1Tank.spawnY;
          renderTanks.p1.bodyAngle = p1Tank.spawnAngle;
          renderTanks.p1.turretAngle = p1Tank.spawnAngle;

          renderTanks.p2.x = p2Tank.spawnX;
          renderTanks.p2.y = p2Tank.spawnY;
          renderTanks.p2.bodyAngle = p2Tank.spawnAngle;
          renderTanks.p2.turretAngle = p2Tank.spawnAngle;

          setLastTankPos(1, p1Tank.spawnX, p1Tank.spawnY, p1Tank.spawnAngle);
          setLastTankPos(2, p2Tank.spawnX, p2Tank.spawnY, p2Tank.spawnAngle);
          gameState.bullets = [];
          gameState.mines = [];
          gameState.smokeClouds = [];
          showToast(`⚔️ РАУНД ${gameState.score1 + gameState.score2 + 1}!`);
          updateHUD();
        }
      }
    },
    onRematchReceived: (data = {}) => {
      if (data && data.action === 'surrender') {
        const surId = data.surrenderingPlayerId || (Network.myPlayerId === 1 ? 2 : 1);
        surrenderMatch(surId, { fromNetwork: true });
        return;
      }

      if (!gameState.rematch) {
        gameState.rematch = { p1Ready: false, p2Ready: false };
      }

      if (data && data.targetScore) {
        setTargetWinScore(data.targetScore);
      }

      // Оновлюємо обрану суперником мапу під час підготовки до реваншу
      if (data && data.map && Array.isArray(data.map.grid)) {
        MapStorage.mergeRemoteMaps([data.map]);
        setCurrentActiveMap(data.map);
        updateHostMapDropdown();
        const remMap = document.getElementById('selectRematchMap');
        if (remMap && data.map.id) remMap.value = data.map.id;
        updateAllMapPreviews();
      }

      // Оновлюємо спорядження суперника
      if (data && data.loadout) {
        if (Network.isHost) {
          setP2Loadout({ ...data.loadout });
          if (p2Tank) p2Tank.applyLoadout(p2Loadout.hull, p2Loadout.turret);
        } else {
          setP1Loadout({ ...data.loadout });
          if (p1Tank) p1Tank.applyLoadout(p1Loadout.hull, p1Loadout.turret);
        }
      }

      if (data && data.action === 'winScoreChange') {
        showToast(`🏆 Ліміт перемог змінено: до ${MAX_SCORE} перемог`);
        renderRematchUI();
        updateHUD();
        return;
      }

      if (data && data.action === 'mapChange') {
        showToast(`🗺️ Суперник обрав мапу «${data.map ? data.map.name : 'Нова мапа'}» для реваншу`);
        renderRematchUI();
        return;
      }

      if (data && data.action === 'start') {
        resetForRematch();
        showToast('⚔️ Обидва гравці готові! Реванш розпочато!');
        return;
      }

      // Позначаємо готовність гравця, який надіслав запит на реванш
      if (data && (data.playerId === 1 || data.p1Ready)) {
        gameState.rematch.p1Ready = true;
      }
      if (data && (data.playerId === 2 || data.p2Ready)) {
        gameState.rematch.p2Ready = true;
      }
      if (!data || (!data.action && data.playerId === undefined)) {
        // Зворотна сумісність із викликом без параметрів: позначаємо суперника готовим
        if (Network.isHost) gameState.rematch.p2Ready = true;
        else gameState.rematch.p1Ready = true;
      }

      // Якщо тепер ОБИДВА гравці готові — запускаємо реванш!
      if (gameState.rematch.p1Ready && gameState.rematch.p2Ready) {
        resetForRematch();
        if (Network.isHost) {
          if (currentActiveMap) Network.sendMap(currentActiveMap);
          Network.sendLoadout(localLoadout);
          Network.sendRematch({
            action: 'start',
            p1Ready: true,
            p2Ready: true,
            targetScore: MAX_SCORE,
            loadout: { ...localLoadout },
            map: currentActiveMap
          });
        }
        showToast('⚔️ Обидва гравці готові! Реванш розпочато!');
      } else {
        const otherId = Network.myPlayerId === 1 ? 2 : 1;
        showToast(`🔥 Гравець ${otherId} хоче реванш! Натисніть «Реванш», щоб почати!`);
        renderRematchUI();
        updateHUD();
      }
    },
    onStatusChange: (status, text) => {
      setConnectionStatus(status, text);
    },
    onPingUpdate: (pingMs) => {
      updateTelemetryUI(currentFps, pingMs);
    },
    onError: (msg) => {
      showToast(msg);
    }
  });
}

initNetworkCallbacks();
