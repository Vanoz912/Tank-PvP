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

import { Bullet, Mine, Explosion, SmokeCloud, FlyingOrb } from './entities.js?v=20261011_v17';
import { PERK_TYPES, CURSE_TYPES } from './config.js?v=20261011_v17';
import { MapStorage, updateHostMapDropdown, renderMapPreview, updateAllMapPreviews, showToast, countMapSpawns } from './editor.js?v=20261011_v17';
import Network from './network.js?v=20261011_v17';
import { sound } from './audio.js?v=20261011_v17';
import {
  setLastTankPos, triggerScreenShake, isTankOnEnemySlowingTrack,
  spawnDebris, spawnMuzzleFlash, spawnSmoke, spawnTracerTrail,
  updateParticles as updateParticlesVfx,
  updateExplosions as updateExplosionsVfx
} from './vfx.js?v=20261011_v17';
import {
  currentActiveMap, gridCols, gridRows, tileSize, canvasWidth, canvasHeight, tankSize,
  MAX_SCORE, setTargetWinScore, selectedGameModes, setGameModes,
  roundResetTimer, lastRoundLoserId, p1Tank, p2Tank, p3Tank, p4Tank,
  localLoadout, p1Loadout, p2Loadout, p3Loadout, p4Loadout, currentFps,
  playerSlots, setPlayerSlots, teamSettings, setTeamSettings, teamScores, setTeamScore,
  gameState, renderTanks,
  localInput, p1Input, p2Input, p3Input, p4Input,
  decrementRoundResetTimer,
  setCurrentActiveMap, setP1Loadout, setP2Loadout, setP3Loadout, setP4Loadout,
  setP2Input, setP3Input, setP4Input, setArenaDims,
  setupGameMap, restoreMapState,
  resetRoundSpawns, resetForRematch, uiHooks
} from './state.js?v=20261011_v17';
import { updatePlayersVisibilityState } from './vision.js?v=20261011_v17';
import {
  startPerkSelection, rerollPerkOptions, selectPerk, renderPerkSelectionUI
} from './perks.js?v=20261011_v17';
import {
  checkMapCollision, checkTankCollision, spawnBullet,
  useSmokeForTank, useArtilleryForTank,
  useBeaconForTank, useSpotEnemyForTank, triggerGuidedBulletForTank, useTurboForTank,
  surrenderMatch, triggerActiveAbilityForTank, processTankActionInputs,
  startManualReloadForTank, useRepairKitForTank,
  updateBulletsAndCollisions, updateMinesAndCollisions, updateTankPassives
} from './combat.js?v=20261011_v17';
import {
  renderRematchUI, updateTelemetryUI, updateHUD,
  setConnectionStatus, startActiveMatch, renderLobbySlots, updateLobbyStartValidation
} from './ui.js?v=20261011_v17';

/**
 * Авторитетний такт Хоста та Полігону (Authoritative Server / Test Mode Cycle)
 */
function serializeTankState(tank) {
  if (!tank) return null;
  return {
    id: tank.id,
    team: tank.team || tank.id,
    x: tank.x, y: tank.y, size: tank.size,
    bodyAngle: tank.bodyAngle, turretAngle: tank.turretAngle,
    hp: tank.hp, maxHp: tank.maxHp, armor: tank.armor,
    minDmg: tank.minDmg, maxDmg: tank.maxDmg,
    reloadTime: tank.reloadTime, fireRate: tank.fireRate,
    spreadHalfAngleDeg: tank.spreadHalfAngleDeg,
    roundTimeDmgBonus: tank.roundTimeDmgBonus || 0,
    hitInvulnTimer: tank.hitInvulnTimer || 0,
    hull: tank.hullType, turret: tank.turretType, fov: tank.fov,
    ammo: tank.ammo, clipSize: tank.clipSize,
    isReloadingClip: tank.isReloadingClip,
    reloadProgress: typeof tank.getReloadProgress === 'function' ? tank.getReloadProgress() : 0,
    minesLeft: tank.minesLeft, maxMines: tank.maxMines,
    hasSmokeScreen: tank.hasSmokeScreen,
    smokeCooldownTimer: tank.smokeCooldownTimer || 0,
    smokeActiveTimer: tank.smokeActiveTimer || 0,
    hasArtillery: tank.hasArtillery,
    artilleryCooldownTimer: tank.artilleryCooldownTimer || 0,
    artilleryPendingTimer: tank.artilleryPendingTimer || 0,
    hasBeaconHeal: tank.hasBeaconHeal,
    beaconStacks: tank.beaconStacks || 0,
    beaconCooldownTimer: tank.beaconCooldownTimer || 0,
    beaconActiveTimer: tank.beaconActiveTimer || 0,
    hasSpotEnemy: tank.hasSpotEnemy,
    spotCooldownTimer: tank.spotCooldownTimer || 0,
    spotActiveTimer: tank.spotActiveTimer || 0,
    hasGuidedBullet: tank.hasGuidedBullet,
    guidedCooldownTimer: tank.guidedCooldownTimer || 0,
    guidedBulletArmed: Boolean(tank.guidedBulletArmed),
    guidedBulletActive: Boolean(tank.guidedBulletActive),
    hasTurboBoost: tank.hasTurboBoost,
    turboCooldownTimer: tank.turboCooldownTimer || 0,
    turboActiveTimer: tank.turboActiveTimer || 0,
    sniperStealthTimer: tank.sniperStealthTimer || 0,
    blindTimer: tank.blindTimer || 0,
    selectedActive: tank.selectedActive,
    repairKitsLeft: tank.repairKitsLeft, maxRepairKits: tank.maxRepairKits,
    rebirthsLeft: tank.rebirthsLeft, maxRebirths: tank.maxRebirths,
    rerollsLeft: tank.rerollsLeft, maxRerolls: tank.maxRerolls,
    acquiredPerks: tank.acquiredPerks || [],
    acquiredCurses: tank.acquiredCurses || [],
    isDead: tank.isDead, respawnTimer: tank.respawnTimer,
    spawnShieldTimer: tank.spawnShieldTimer, animFrame: tank.animFrame
  };
}

export function hostUpdate() {
  const isTest = Boolean(gameState && gameState.isTestMode);
  if ((!Network.isHost || !Network.connectionActive) && !isTest) return;

  if (roundResetTimer > 0) {
    decrementRoundResetTimer();
    if (roundResetTimer === 0 && !gameState.gameOver) {
      const loserToPick = lastRoundLoserId;
      resetRoundSpawns();
      if (loserToPick >= 1 && loserToPick <= 4) {
        startPerkSelection(loserToPick);
      }
    }
  }

  const isSelectingPerk = Boolean(gameState.perkSelection && gameState.perkSelection.active);

  const activeTanks = (gameState && Array.isArray(gameState.tanks) && gameState.tanks.length > 0)
    ? gameState.tanks
    : [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean);
  const allInputs = [p1Input, p2Input, p3Input, p4Input];

  if (!gameState.gameOver && !isSelectingPerk) {
    // 0. Синхронізація обраної активної здібності (Q / E) від вводу гравців
    activeTanks.forEach(tank => {
      const inp = allInputs[tank.id - 1];
      if (inp && typeof inp.selectedActive === 'string') {
        tank.selectedActive = inp.selectedActive;
        tank.localSelectedActive = inp.selectedActive;
      }
    });

    // 1. Оновлення фізики та кутів танків (з урахуванням льоду та сповільнюючих слідів ворога)
    if (roundResetTimer <= 0) {
      activeTanks.forEach(tank => {
        tank.slowedByEnemyTrack = isTankOnEnemySlowingTrack(tank);
        const otherTanks = activeTanks.filter(t => t !== tank);
        tank.update(allInputs[tank.id - 1] || {}, otherTanks, gameState.map, canvasWidth, canvasHeight, tileSize, checkMapCollision, checkTankCollision, {
          iceGrid: gameState.ice,
          enemyTrackSlow: tank.slowedByEnemyTrack,
          gameState
        });
      });
    } else {
      activeTanks.forEach(tank => {
        if (tank.spawnShieldTimer > 0) tank.spawnShieldTimer--;
      });
    }

    // 2. Обробка стрільби, ручної перезарядки (R), активних здібностей та ремкомплекту (H)
    if (roundResetTimer <= 0) {
      activeTanks.forEach(tank => {
        processTankActionInputs(tank, allInputs[tank.id - 1] || {}, Network.myPlayerId === tank.id);
      });
    }

    // 3. Снаряди, міни та пасивні здібності
    updateBulletsAndCollisions();
    if (roundResetTimer <= 0) {
      updateMinesAndCollisions();
      updateTankPassives();
    }

    // 4. Стелс: пряма видимість (LoS), конус погляду вежі, маскування, тактичний огляд союзників
    updatePlayersVisibilityState();
  }

  updateExplosionsVfx(gameState);
  updateParticlesVfx(p1Tank, p2Tank, gameState);

  // Трансляція авторитетного стану клієнтам зіркової топології
  if (Network.isHost && Network.connectionActive) {
    Network.sendState({
      isMatchStarted: Boolean(gameState && gameState.isRunning),
      mapName: gameState.mapName,
      width: gridCols,
      height: gridRows,
      tileSize: tileSize,
      tankSize: tankSize,
      roundTimeFrames: gameState.roundTimeFrames || 0,
      surrenderedBy: gameState.surrenderedBy || 0,
      gameModes: gameState.gameModes || selectedGameModes,
      map: gameState.map,
      bushes: gameState.bushes,
      ice: gameState.ice,
      tileHp: gameState.tileHp,
      visibility: {
        p1CanSeeP2: Boolean(gameState.visibility ? gameState.visibility.p1CanSeeP2 : true),
        p2CanSeeP1: Boolean(gameState.visibility ? gameState.visibility.p2CanSeeP1 : true),
        matrix: (gameState.visibility && gameState.visibility.matrix) ? gameState.visibility.matrix : null
      },
      currentMapEvent: gameState.currentMapEvent,
      mapEventBannerTimer: gameState.mapEventBannerTimer || 0,
      battleRoyaleZone: gameState.battleRoyaleZone,
      envArtilleryStrikes: gameState.envArtilleryStrikes || [],
      perkSelection: gameState.perkSelection,
      pendingArtilleryStrikes: gameState.pendingArtilleryStrikes || [],
      tilePropertyMap: gameState.tilePropertyMap,
      flyingOrbs: (gameState.flyingOrbs || []).map(o => ({
        x: o.x, y: o.y, vx: o.vx, vy: o.vy,
        angle: typeof o.rotationAngle === 'number' ? o.rotationAngle : (o.angle || 0),
        rotationAngle: typeof o.rotationAngle === 'number' ? o.rotationAngle : (o.angle || 0),
        radius: o.radius
      })),
      p1: serializeTankState(p1Tank),
      p2: serializeTankState(p2Tank),
      p3: serializeTankState(p3Tank),
      p4: serializeTankState(p4Tank),
      playerSlots: playerSlots,
      teamScores: teamScores,
      teamSettings: teamSettings,
      bullets: gameState.bullets.map(b => ({
        ownerId: b.ownerId, team: b.team || b.ownerId, x: b.x, y: b.y, vx: b.vx, vy: b.vy, damage: b.damage, angle: b.angle,
        pierceLeft: b.pierceLeft || 0, ricochetsLeft: b.ricochetsLeft || 0,
        ignoreArmor: Boolean(b.ignoreArmor), instantBreak: Boolean(b.instantBreak),
        invisibleToEnemy: Boolean(b.invisibleToEnemy),
        isGuided: Boolean(b.isGuided), isTracer: Boolean(b.isTracer), speed: b.speed,
        blindsOnHit: Boolean(b.blindsOnHit),
        healsOnHit: Boolean(b.healsOnHit),
        isMagnetic: Boolean(b.isMagnetic)
      })),
      mines: (gameState.mines || []).map(m => ({
        ownerId: m.ownerId, team: m.team || m.ownerId, x: m.x, y: m.y
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
    onConnected: ({ isHost, myPlayerId, slotId, lobbyPreview }) => {
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

      if (isHost) {
        if (currentActiveMap) {
          Network.sendMap(currentActiveMap);
        }
        Network.sendLoadout(localLoadout);
        Network.sendRematch({
          action: 'lobbySettingsSync',
          targetScore: MAX_SCORE,
          gameModes: { ...selectedGameModes },
          map: currentActiveMap
        });
      } else {
        Network.sendLoadout(localLoadout);
      }

      if (isHost || lobbyPreview) {
        if (isHost) {
          uiHooks.renderLobbySlots();
          uiHooks.updateLobbyStartValidation();
        } else {
          updateHostMapDropdown();
          updateAllMapPreviews();
          uiHooks.renderLobbySlots();
          uiHooks.updateLobbyStartValidation();
        }
        return;
      }

      startActiveMatch(isHost, myPlayerId);
    },
    onGuestJoined: (slotId) => {
      if (Network.isHost && playerSlots[slotId - 1]) {
        playerSlots[slotId - 1].type = 'human';
        playerSlots[slotId - 1].isReady = false;
        playerSlots[slotId - 1].name = `Гравець ${slotId}`;
        const activeCount = playerSlots.filter(s => s.type !== 'none').length;
        updateHostMapDropdown(activeCount);
        Network.sendLobbyUpdate({
          playerSlots,
          teamSettings,
          map: currentActiveMap,
          targetScore: MAX_SCORE,
          gameModes: selectedGameModes
        });
        uiHooks.renderLobbySlots();
        uiHooks.updateLobbyStartValidation();
        showToast(`🟢 Гравець ${slotId} приєднався до кімнати!`);
      }
    },
    onGuestLeft: (slotId) => {
      if (Network.isHost && playerSlots[slotId - 1]) {
        playerSlots[slotId - 1].type = 'none';
        playerSlots[slotId - 1].isReady = false;
        const activeCount = playerSlots.filter(s => s.type !== 'none').length;
        updateHostMapDropdown(activeCount);
        Network.sendLobbyUpdate({
          playerSlots,
          teamSettings,
          map: currentActiveMap,
          targetScore: MAX_SCORE,
          gameModes: selectedGameModes
        });
        uiHooks.renderLobbySlots();
        uiHooks.updateLobbyStartValidation();
        showToast(`⚠️ Гравець ${slotId} покинув кімнату.`);
      }
    },
    onSlotAssign: (mySlotId) => {
      Network.myPlayerId = mySlotId;
      const guestView = document.getElementById('lobbyGuestView');
      const roomView = document.getElementById('lobbyRoomView');
      if (guestView) guestView.classList.add('hidden');
      if (roomView) roomView.classList.remove('hidden');
      uiHooks.renderLobbySlots();
      uiHooks.updateLobbyStartValidation();
      showToast(`🎮 Вам призначено Слот ${mySlotId}!`);
    },
    onSlotUpdate: (slotData, fromSlot) => {
      if (Network.isHost && playerSlots[fromSlot - 1]) {
        const slot = playerSlots[fromSlot - 1];
        if (typeof slotData.team === 'number') slot.team = slotData.team;
        if (typeof slotData.isReady === 'boolean') slot.isReady = slotData.isReady;
        if (slotData.loadout && typeof slotData.loadout === 'object') {
          slot.loadout = { ...slotData.loadout };
          const allTanks = [p1Tank, p2Tank, p3Tank, p4Tank];
          const t = allTanks[fromSlot - 1];
          if (t) t.applyLoadout(slot.loadout.hull, slot.loadout.turret);
        }
        Network.sendLobbyUpdate({
          playerSlots,
          teamSettings,
          map: currentActiveMap,
          targetScore: MAX_SCORE,
          gameModes: selectedGameModes
        });
        uiHooks.renderLobbySlots();
        uiHooks.updateLobbyStartValidation();
      }
    },
    onLobbyUpdate: (lobbyState) => {
      if (!Network.isHost && lobbyState) {
        if (gameState && gameState.isRunning) {
          return;
        }
        if (Array.isArray(lobbyState.playerSlots)) {
          setPlayerSlots(lobbyState.playerSlots);
        }
        if (lobbyState.teamSettings) {
          setTeamSettings(lobbyState.teamSettings);
        }
        if (lobbyState.targetScore && lobbyState.targetScore !== MAX_SCORE) {
          setTargetWinScore(lobbyState.targetScore);
        }
        if (lobbyState.gameModes) {
          setGameModes(lobbyState.gameModes);
        }
        if (lobbyState.map && lobbyState.map.grid) {
          setCurrentActiveMap(lobbyState.map);
          renderMapPreview('hostMapPreviewCanvas', lobbyState.map);
        }
        const guestView = document.getElementById('lobbyGuestView');
        const roomView = document.getElementById('lobbyRoomView');
        if (guestView) guestView.classList.add('hidden');
        if (roomView) roomView.classList.remove('hidden');
        uiHooks.renderLobbySlots();
        uiHooks.updateLobbyStartValidation();
      }
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
        const guestMap = document.getElementById('selectGuestMap');
        if (guestMap && receivedMap.id) guestMap.value = receivedMap.id;
        const remMap = document.getElementById('selectRematchMap');
        if (remMap && receivedMap.id) remMap.value = receivedMap.id;
        updateAllMapPreviews();
        if (Network.isHost) {
          showToast(`🗺️ Обрано карту «${receivedMap.name || 'Нова мапа'}»!`);
        }
      }
    },
    onLoadoutReceived: (loadout, fromSlot = 2) => {
      const slotId = fromSlot || 2;
      if (playerSlots[slotId - 1]) {
        playerSlots[slotId - 1].loadout = { ...loadout };
      }
      const allTanks = [p1Tank, p2Tank, p3Tank, p4Tank];
      const targetTank = allTanks[slotId - 1];
      if (targetTank) {
        targetTank.applyLoadout(loadout.hull, loadout.turret);
      }
      uiHooks.renderLobbySlots();
      updateHUD();
    },
    onStateReceived: (newState) => {
      if (!newState) return;
      try {
        if (newState.isMatchStarted) {
        Network.isGuestInLobbySetup = false;
        if (Array.isArray(newState.playerSlots)) {
          setPlayerSlots(newState.playerSlots);
        }
        if (newState.teamSettings) {
          setTeamSettings(newState.teamSettings);
        }
        const lobbyScreen = document.getElementById('lobbyScreen');
        const roomView = document.getElementById('lobbyRoomView');
        const guestView = document.getElementById('lobbyGuestView');
        const browserView = document.getElementById('lobbyBrowserView');
        const isLobbyVisible = (lobbyScreen && !lobbyScreen.classList.contains('hidden')) ||
                               (roomView && !roomView.classList.contains('hidden')) ||
                               (guestView && !guestView.classList.contains('hidden')) ||
                               (browserView && !browserView.classList.contains('hidden'));

        if (!gameState || !gameState.isRunning || isLobbyVisible) {
          if (newState.map && Array.isArray(newState.map)) {
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
            }, playerSlots);
          } else {
            setupGameMap(currentActiveMap, playerSlots);
          }
          startActiveMatch(false, Network.myPlayerId);
        }
      }
      if (Network.isGuestInLobbySetup) return;

      if (newState.targetScore && newState.targetScore !== MAX_SCORE) {
        setTargetWinScore(newState.targetScore);
      }

      if (newState.gameModes && typeof newState.gameModes === 'object') {
        setGameModes(newState.gameModes);
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
        }, playerSlots);
        if (newState.isMatchStarted && gameState) {
          gameState.isRunning = true;
        }
      }

      if (newState.tileSize && newState.tileSize !== tileSize) {
        setArenaDims({
          tileSize: newState.tileSize,
          canvasWidth: gridCols * newState.tileSize,
          canvasHeight: gridRows * newState.tileSize,
          tankSize: newState.tankSize || Math.max(18, Math.floor(newState.tileSize * 0.82))
        });
        const allActive = [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean);
        allActive.forEach(t => {
          t.baseSize = tankSize;
          t.size = Math.max(10, Math.round(tankSize * (t.sizeScale || 1)));
        });
        const gCanvas = typeof document !== 'undefined' ? document.getElementById('gameCanvas') : null;
        if (gCanvas) {
          gCanvas.width = canvasWidth;
          gCanvas.height = canvasHeight;
        }
      }

      // Синхронізація всіх активних танків
      const allTanks = [p1Tank, p2Tank, p3Tank, p4Tank];
      const stateTanks = [newState.p1, newState.p2, newState.p3, newState.p4];
      allTanks.forEach((tank, idx) => {
        const slotId = idx + 1;
        const tankState = stateTanks[idx];
        if (!tank || !tankState) return;

        if (Network.myPlayerId === slotId) {
          tank.syncFrom(tankState);
          if (localLoadout.turret && (tank.turretType !== localLoadout.turret || tank.hullType !== localLoadout.hull)) {
            tank.applyLoadout(localLoadout.hull, localLoadout.turret);
          }
          if (Number.isFinite(localInput.turretAngle)) {
            tank.turretAngle = localInput.turretAngle;
          }
        } else {
          tank.syncFrom(tankState);
        }
      });

      if (newState.teamScores) {
        Object.assign(teamScores, newState.teamScores);
      }
      if (newState.teamSettings) {
        setTeamSettings(newState.teamSettings);
      }
      if (Array.isArray(newState.playerSlots)) {
        setPlayerSlots(newState.playerSlots);
      }

      gameState.map = newState.map;
      if (newState.bushes) gameState.bushes = newState.bushes;
      if (newState.ice) gameState.ice = newState.ice;
      if (newState.tileHp) gameState.tileHp = newState.tileHp;
      if (newState.visibility) {
        const m = newState.visibility.matrix;
        gameState.visibility = {
          p1CanSeeP2: Boolean(newState.visibility.p1CanSeeP2),
          p2CanSeeP1: Boolean(newState.visibility.p2CanSeeP1),
          matrix: m || null,
          canSee: (obsId, tgtId) => Boolean(m && m[obsId] && m[obsId][tgtId])
        };
      }
      if (typeof newState.roundTimeFrames === 'number') gameState.roundTimeFrames = newState.roundTimeFrames;
      if (typeof newState.surrenderedBy === 'number') gameState.surrenderedBy = newState.surrenderedBy;
      if (newState.currentMapEvent !== undefined) {
        gameState.currentMapEvent = newState.currentMapEvent;
      }
      if (typeof newState.mapEventBannerTimer === 'number') {
        gameState.mapEventBannerTimer = newState.mapEventBannerTimer;
      }
      if (newState.battleRoyaleZone) {
        gameState.battleRoyaleZone = newState.battleRoyaleZone;
      }
      if (Array.isArray(newState.envArtilleryStrikes)) {
        gameState.envArtilleryStrikes = newState.envArtilleryStrikes;
      }
      if (Array.isArray(newState.pendingArtilleryStrikes)) {
        gameState.pendingArtilleryStrikes = newState.pendingArtilleryStrikes;
      }

      if (newState.tilePropertyMap !== undefined) {
        gameState.tilePropertyMap = newState.tilePropertyMap;
      }
      if (Array.isArray(newState.flyingOrbs)) {
        gameState.flyingOrbs = newState.flyingOrbs.map(od => {
          const orb = new FlyingOrb(od.x, od.y, od.vx, od.vy);
          const rot = typeof od.rotationAngle === 'number' ? od.rotationAngle : (od.angle || 0);
          orb.rotationAngle = rot;
          orb.angle = rot;
          if (typeof od.radius === 'number') orb.radius = od.radius;
          return orb;
        });
      }

      if (newState.perkSelection) {
        const prev = gameState.perkSelection || {};
        const wasActive = Boolean(prev.active);
        const nowActive = Boolean(newState.perkSelection.active);
        const prevKey = JSON.stringify([prev.options, prev.optionCurses, prev.picksRemaining, prev.rerollsLeft]);
        const nextKey = JSON.stringify([newState.perkSelection.options, newState.perkSelection.optionCurses, newState.perkSelection.picksRemaining, newState.perkSelection.rerollsLeft]);
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
          team: b.team || b.ownerId,
          pierceLeft: b.pierceLeft || 0,
          ricochetsLeft: b.ricochetsLeft || 0,
          ignoreArmor: Boolean(b.ignoreArmor),
          instantBreak: Boolean(b.instantBreak),
          invisibleToEnemy: Boolean(b.invisibleToEnemy),
          isGuided: Boolean(b.isGuided),
          isTracer: Boolean(b.isTracer),
          speed: b.speed,
          blindsOnHit: Boolean(b.blindsOnHit),
          healsOnHit: Boolean(b.healsOnHit),
          isMagnetic: Boolean(b.isMagnetic)
        }
      ));
      gameState.mines = (newState.mines || []).map(m => new Mine(m.ownerId, m.x, m.y, 40, 60, { team: m.team || m.ownerId }));
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
      gameState.isEnemyVisible = newState.visibility ? newState.visibility.p2CanSeeP1 : gameState.isEnemyVisible;

      updateHUD();
    } catch (err) {
      console.error('Помилка обробки onStateReceived на клієнті:', err);
    }
    },
    onInputReceived: (inputData, fromSlot = 2) => {
      const slotId = fromSlot || 2;
      if (slotId === 2) setP2Input(inputData);
      else if (slotId === 3) setP3Input(inputData);
      else if (slotId === 4) setP4Input(inputData);

      const allTanks = [p1Tank, p2Tank, p3Tank, p4Tank];
      const targetTank = allTanks[slotId - 1];
      if (inputData && typeof inputData.selectedActive === 'string' && targetTank) {
        targetTank.selectedActive = inputData.selectedActive;
        targetTank.localSelectedActive = inputData.selectedActive;
      }
    },
    onPerkSelected: (perkId, fromSlot = 2) => {
      if (Network.isHost && gameState.perkSelection && gameState.perkSelection.active) {
        selectPerk(fromSlot || gameState.perkSelection.loserId || 2, perkId);
      }
    },
    onPerkReroll: (fromSlot = 2) => {
      if (Network.isHost && gameState.perkSelection && gameState.perkSelection.active) {
        rerollPerkOptions(fromSlot || gameState.perkSelection.loserId || 2);
      }
    },
    onEventReceived: (eventName, eventData) => {
      if (eventName === 'shoot') {
        sound.playShoot();
        if (eventData) {
          const shooterTank = [p1Tank, p2Tank, p3Tank, p4Tank][(eventData.ownerId || 1) - 1] || null;
          if (shooterTank) {
            shooterTank.recordShot();
          }
          const hiddenFromEnemy = Boolean(eventData.hiddenFromEnemy || (shooterTank && shooterTank.invisibleBullets));
          spawnMuzzleFlash(eventData.x, eventData.y, eventData.angle, eventData.ownerId || 0, hiddenFromEnemy);
          spawnSmoke(eventData.x, eventData.y, eventData.angle, eventData.ownerId || 0, hiddenFromEnemy);
        }
      } else if (eventName === 'tracer') {
        if (!Network.isHost && eventData) {
          spawnTracerTrail(
            eventData.x1,
            eventData.y1,
            eventData.x2,
            eventData.y2,
            eventData.ownerId || 0,
            Boolean(eventData.hiddenFromEnemy)
          );
        }
      } else if (eventName === 'blindTriggered') {
        sound.playSpot();
        if (eventData) {
          const targetTank = [p1Tank, p2Tank, p3Tank, p4Tank][(eventData.targetId || 1) - 1] || null;
          if (targetTank) {
            targetTank.blindTimer = eventData.durationFrames || 90;
          }
          if (eventData.targetId === Network.myPlayerId) {
            showToast('☀️ Осліплення! Ворожий снаряд засліпив ваш екран на 1.5с!');
          } else {
            showToast('☀️ Ваш постріл засліпив ворога на 1.5с!');
          }
        }
      } else if (eventName === 'minePlaced') {
        sound.playSteelHit();
      } else if (eventName === 'smokeUsed') {
        sound.playSpot();
        if (eventData) {
          const smokeOwner = [p1Tank, p2Tank, p3Tank, p4Tank][(eventData.ownerId || 1) - 1] || null;
          if (smokeOwner) {
            smokeOwner.smokeActiveTimer = eventData.durationFrames || 300;
            smokeOwner.smokeCooldownTimer = 0;
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
      } else if (eventName === 'artilleryQueued') {
        sound.playSpot();
        if (eventData) {
          const artyOwner = [p1Tank, p2Tank, p3Tank, p4Tank][(eventData.ownerId || 1) - 1] || null;
          if (artyOwner) {
            artyOwner.artilleryPendingTimer = eventData.delayFrames || 60;
            artyOwner.artilleryCooldownTimer = 0;
            artyOwner.targetingMode = null;
          }
          if (!Network.isHost && gameState) {
            if (!Array.isArray(gameState.pendingArtilleryStrikes)) {
              gameState.pendingArtilleryStrikes = [];
            }
            const delay = eventData.delayFrames || eventData.timer || 60;
            gameState.pendingArtilleryStrikes.push({
              ownerId: eventData.ownerId,
              centerCol: eventData.centerCol,
              centerRow: eventData.centerRow,
              timer: delay,
              maxTimer: delay,
              timerFrames: delay,
              maxFrames: delay
            });
          }
        }
        updateHUD();
      } else if (eventName === 'artilleryStrike' || eventName === 'artilleryUsed') {
        sound.playExplosion();
        if (eventData) {
          const artyOwner = [p1Tank, p2Tank, p3Tank, p4Tank][(eventData.ownerId || 1) - 1] || null;
          if (artyOwner) {
            artyOwner.artilleryPendingTimer = 0;
            artyOwner.artilleryCooldownTimer = 2100;
            artyOwner.targetingMode = null;
          }
          const ax = Number.isFinite(eventData.x) ? eventData.x : (eventData.centerCol + 0.5) * tileSize;
          const ay = Number.isFinite(eventData.y) ? eventData.y : (eventData.centerRow + 0.5) * tileSize;
          spawnDebris(ax, ay, 24, '#ff6b6b');
          triggerScreenShake(14, 22);
        }
        updateHUD();
      } else if (eventName === 'beaconUsed') {
        sound.playSpot();
        if (eventData) {
          const beaconOwner = [p1Tank, p2Tank, p3Tank, p4Tank][(eventData.ownerId || 1) - 1] || null;
          if (beaconOwner) {
            beaconOwner.beaconActiveTimer = 420;
            beaconOwner.beaconCooldownTimer = 0;
          }
          if (Number.isFinite(eventData.x) && Number.isFinite(eventData.y)) {
            spawnDebris(eventData.x, eventData.y, 12, '#2ecc71');
          }
        }
        updateHUD();
      } else if (eventName === 'radarUsed') {
        sound.playSpot();
        if (eventData) {
          const radarOwner = [p1Tank, p2Tank, p3Tank, p4Tank][(eventData.ownerId || 1) - 1] || null;
          if (radarOwner) {
            radarOwner.spotActiveTimer = 600;
            radarOwner.spotCooldownTimer = 0;
          }
        }
        updateHUD();
      } else if (eventName === 'turboUsed') {
        sound.playSpot();
        if (eventData) {
          const turboOwner = [p1Tank, p2Tank, p3Tank, p4Tank][(eventData.ownerId || 1) - 1] || null;
          if (turboOwner) {
            turboOwner.turboActiveTimer = 240;
            turboOwner.turboCooldownTimer = 0;
          }
          if (Number.isFinite(eventData.x) && Number.isFinite(eventData.y)) {
            spawnDebris(eventData.x, eventData.y, 10, '#00e5ff');
          }
        }
        updateHUD();
      } else if (eventName === 'surrender') {
        if (eventData) {
          const surId = eventData.surrenderingPlayerId || eventData.playerId || 1;
          surrenderMatch(surId, { fromNetwork: true });
        }
      } else if (eventName === 'manualReload') {
        if (!Network.isHost && eventData) {
          const targetTank = [p1Tank, p2Tank, p3Tank, p4Tank][(eventData.playerId || 1) - 1] || p2Tank;
          if (targetTank && typeof targetTank.startManualReload === 'function') {
            targetTank.startManualReload();
          }
        }
      } else if (eventName === 'repairUsed') {
        sound.playSpot();
        if (eventData) {
          const targetTank = [p1Tank, p2Tank, p3Tank, p4Tank][(eventData.playerId || 1) - 1] || null;
          const rx = Number.isFinite(eventData.x) ? eventData.x : (targetTank ? targetTank.x + targetTank.size / 2 : null);
          const ry = Number.isFinite(eventData.y) ? eventData.y : (targetTank ? targetTank.y + targetTank.size / 2 : null);
          if (Number.isFinite(rx) && Number.isFinite(ry)) {
            spawnDebris(rx, ry, 10, '#2ecc71');
          }
        }
        updateHUD();
      } else if (eventName === 'rebirth') {
        sound.playExplosion();
        if (eventData) {
          const targetTank = [p1Tank, p2Tank, p3Tank, p4Tank][(eventData.playerId || 1) - 1] || p2Tank;
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
      } else if (eventName === 'acidBarrelExploded') {
        sound.playAcidSizzle();
        if (eventData) {
          if (!Network.isHost && gameState && gameState.map) {
            if (gameState.map[eventData.row]) {
              gameState.map[eventData.row][eventData.col] = 16;
              if (gameState.tileHp && gameState.tileHp[eventData.row]) {
                gameState.tileHp[eventData.row][eventData.col] = 0;
              }
            }
            if (Array.isArray(eventData.extraAcids)) {
              for (const pos of eventData.extraAcids) {
                if (gameState.map[pos.r]) {
                  gameState.map[pos.r][pos.c] = 16;
                  if (gameState.tileHp && gameState.tileHp[pos.r]) {
                    gameState.tileHp[pos.r][pos.c] = 0;
                  }
                }
              }
            }
          }
          const bx = (eventData.col + 0.5) * tileSize;
          const by = (eventData.row + 0.5) * tileSize;
          spawnDebris(bx, by, 12, '#26de81');
          gameState.explosions.push(new Explosion(bx, by, 20, false));
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
            optionCurses: eventData.optionCurses || {},
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
          const targetTank = [p1Tank, p2Tank, p3Tank, p4Tank][(eventData.playerId || 1) - 1] || p2Tank;
          if (targetTank) {
            if (Array.isArray(eventData.acquiredPerks)) {
              targetTank.acquiredPerks = [...eventData.acquiredPerks];
            } else if (eventData.perkId) {
              targetTank.applyPerk(eventData.perkId, { refreshRerolls: false });
            }
            if (Array.isArray(eventData.acquiredCurses)) {
              targetTank.acquiredCurses = [...eventData.acquiredCurses];
            } else if (eventData.curseId) {
              targetTank.applyCurse(eventData.curseId);
            }
            targetTank.applyLoadout(targetTank.hullType, targetTank.turretType);
          }
          if (gameState.perkSelection) {
            const selSource = eventData.perkSelection || eventData;
            gameState.perkSelection.options = selSource.options || [];
            gameState.perkSelection.optionCurses = selSource.optionCurses || {};
            gameState.perkSelection.picksRemaining = selSource.picksRemaining || 1;
            if (typeof selSource.rerollsLeft === 'number') {
              gameState.perkSelection.rerollsLeft = selSource.rerollsLeft;
            }
          }
          const perkDef = PERK_TYPES[eventData.perkId];
          const curseDef = eventData.curseId ? CURSE_TYPES[eventData.curseId] : null;
          if (perkDef) {
            if (curseDef) {
              showToast(`☠️ Гравець ${eventData.playerId} обрав: ${perkDef.title} + Прокляття «${curseDef.title}»!`);
            } else {
              showToast(`✨ Гравець ${eventData.playerId} обрав 1-шу здібність: ${perkDef.title}`);
            }
          }
          renderPerkSelectionUI();
          updateHUD();
        }
      } else if (eventName === 'perkChosen') {
        if (eventData) {
          const targetTank = [p1Tank, p2Tank, p3Tank, p4Tank][(eventData.playerId || 1) - 1] || p2Tank;
          if (targetTank) {
            if (Array.isArray(eventData.acquiredPerks)) {
              targetTank.acquiredPerks = [...eventData.acquiredPerks];
            } else if (eventData.perkId) {
              targetTank.applyPerk(eventData.perkId, { refreshRerolls: false });
            }
            if (Array.isArray(eventData.acquiredCurses)) {
              targetTank.acquiredCurses = [...eventData.acquiredCurses];
            } else if (eventData.curseId) {
              targetTank.applyCurse(eventData.curseId);
            }
            targetTank.applyLoadout(targetTank.hullType, targetTank.turretType);
            targetTank.respawn({ preserveRerolls: true });
          }
          gameState.perkSelection = { active: false, loserId: 0, options: [], optionCurses: {}, picksRemaining: 1, totalPicks: 1, rerollsLeft: 0, maxRerolls: 0 };
          const perkDef = PERK_TYPES[eventData.perkId];
          const curseDef = eventData.curseId ? CURSE_TYPES[eventData.curseId] : null;
          if (perkDef) {
            if (curseDef) {
              showToast(`☠️ Гравець ${eventData.playerId} обрав: ${perkDef.title} + Прокляття «${curseDef.title}»!`);
            } else {
              showToast(`✨ Гравець ${eventData.playerId} обрав здібність: ${perkDef.title}`);
            }
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
          gameState.pendingArtilleryStrikes = [];
          showToast(`⚔️ РАУНД ${gameState.score1 + gameState.score2 + 1}!`);
          updateHUD();
        }
      } else if (eventName === 'mapEventSelected') {
        if (!Network.isHost && eventData) {
          gameState.currentMapEvent = eventData.eventId || null;
          gameState.mapEventBannerTimer = 180;
          if (eventData.tilePropertyMap) {
            gameState.tilePropertyMap = eventData.tilePropertyMap;
          }
        }
      } else if (eventName === 'orbSpawned') {
        if (!Network.isHost && eventData) {
          if (!Array.isArray(gameState.flyingOrbs)) gameState.flyingOrbs = [];
          if (gameState.flyingOrbs.length < 5) {
            gameState.flyingOrbs.push(new FlyingOrb(eventData.x, eventData.y));
          }
        }
      }
    },
    onRematchReceived: (data = {}) => {
      if (data && data.action === 'lobbyGameStart') {
        Network.isGuestInLobbySetup = false;
        if (Array.isArray(data.playerSlots)) {
          setPlayerSlots(data.playerSlots);
        }
        if (data.teamSettings) {
          setTeamSettings(data.teamSettings);
        }
        if (data.targetScore) {
          setTargetWinScore(data.targetScore);
        }
        if (data.gameModes) {
          setGameModes(data.gameModes);
        }
        if (data.map && Array.isArray(data.map.grid)) {
          MapStorage.mergeRemoteMaps([data.map]);
          setCurrentActiveMap(data.map);
        }
        setupGameMap(currentActiveMap, playerSlots);
        startActiveMatch(false, Network.myPlayerId);
        showToast('⚔️ Бій розпочато хостом! В бій!');
        return;
      }

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
        const guestWinEl = typeof document !== 'undefined' ? document.getElementById('selectGuestWinScore') : null;
        if (guestWinEl) guestWinEl.value = String(MAX_SCORE);
      }

      if (data && data.gameModes && typeof data.gameModes === 'object') {
        setGameModes(data.gameModes);
      }

      // Оновлюємо обрану суперником мапу під час підготовки до реваншу або в лобі
      if (data && data.map && Array.isArray(data.map.grid)) {
        MapStorage.mergeRemoteMaps([data.map]);
        setCurrentActiveMap(data.map);
        updateHostMapDropdown();
        const guestMap = typeof document !== 'undefined' ? document.getElementById('selectGuestMap') : null;
        if (guestMap && data.map.id) guestMap.value = data.map.id;
        const remMap = typeof document !== 'undefined' ? document.getElementById('selectRematchMap') : null;
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

      if (data && data.action === 'lobbySettingsSync') {
        renderRematchUI();
        updateAllMapPreviews();
        updateHUD();
        return;
      }

      if (data && data.action === 'guestReadyStart') {
        if (Network.isHost) {
          Network.peerWaitingForGuestReady = false;
          if (currentActiveMap) {
            setupGameMap(currentActiveMap);
            Network.sendMap(currentActiveMap);
          }
          Network.sendLoadout(localLoadout);
          startActiveMatch(true, 1);
        }
        return;
      }

      if (data && data.action === 'winScoreChange') {
        showToast(`🏆 Ліміт перемог змінено: до ${MAX_SCORE} перемог`);
        renderRematchUI();
        updateHUD();
        return;
      }

      if (data && data.action === 'gameModesChange') {
        showToast(`⚙️ Режими бою оновлено!`);
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
            gameModes: { ...selectedGameModes },
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
