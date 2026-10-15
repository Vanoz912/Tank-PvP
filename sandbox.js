/**
 * @file sandbox.js
 * @description Модуль Зони для тестування (Полігон): підтримка 2, 3 або 4 танків, вибір команд, перемикання активного танка (Tab / кнопка), вільний вибір та видалення здібностей і проклять, зміна корпусу/гармати та відновлення HP/кулдаунів.
 */

import {
  HULL_TYPES, TURRET_TYPES, PERK_RARITIES, PERK_TYPES, PHANTOM_FORBIDDEN_PERKS,
  CURSE_TYPES, PHANTOM_FORBIDDEN_CURSES,
  BABY_FORBIDDEN_PERKS, BABY_FORBIDDEN_CURSES,
  SNIPER_FORBIDDEN_PERKS, SNIPER_FORBIDDEN_CURSES
} from './config.js?v=20261011_v17';
import { MapStorage } from './editor.js?v=20261011_v17';
import Network from './network.js?v=20261011_v17';
import {
  setTargetWinScore, p1Tank, p2Tank, p3Tank, p4Tank,
  localLoadout, p1Loadout, p2Loadout, p3Loadout, p4Loadout, testTargetPlayerId,
  gameState, localInput, p1Input, p2Input, p3Input, p4Input,
  setP1Loadout, setP2Loadout, setP3Loadout, setP4Loadout,
  setTestTargetPlayerId, setP1Input, setP2Input, setP3Input, setP4Input,
  playerSlots, setPlayerSlots,
  setupGameMap, uiHooks, registerUIHooks
} from './state.js?v=20261011_v17';

/**
 * Отримання екземпляра танка за його ID (1..4)
 */
export function getTestTank(playerId) {
  const allTanks = [p1Tank, p2Tank, p3Tank, p4Tank];
  return allTanks[(playerId || 1) - 1] || null;
}

/**
 * Запуск локальної Зони для тестування (Полігон):
 * дозволяє налаштувати 2, 3 або 4 танки, перемикатися між ними (Tab або кнопка),
 * обирати команди та вільно призначати/прибирати будь-які здібності.
 */
export function startTestMode(customMap = null) {
  if (typeof Network.disconnect === 'function') {
    Network.disconnect();
  }

  Network.isHost = true;
  Network.myPlayerId = 1;
  Network.connectionActive = false;
  Network.pingMs = 0;
  setTestTargetPlayerId(1);

  const countSelect = document.getElementById('selectTestTankCount');
  const tankCount = countSelect ? parseInt(countSelect.value, 10) || 2 : 2;

  const sHull = document.getElementById('selectHull');
  const sTurret = document.getElementById('selectTurret');
  const sWinScore = document.getElementById('selectHostWinScore');
  if (sHull && sHull.value && HULL_TYPES[sHull.value]) localLoadout.hull = sHull.value;
  if (sTurret && sTurret.value && TURRET_TYPES[sTurret.value]) localLoadout.turret = sTurret.value;
  if (sWinScore && sWinScore.value) setTargetWinScore(Number(sWinScore.value));

  setP1Loadout({ ...localLoadout });
  if (!p2Loadout || !p2Loadout.hull) setP2Loadout({ hull: 'standard', turret: 'standard' });
  if (!p3Loadout || !p3Loadout.hull) setP3Loadout({ hull: 'standard', turret: 'standard' });
  if (!p4Loadout || !p4Loadout.hull) setP4Loadout({ hull: 'standard', turret: 'standard' });

  // Ініціалізація 4 слотів для полігону
  const defaultTeams = [1, 2, 3, 4];
  const allLoadouts = [p1Loadout, p2Loadout, p3Loadout, p4Loadout];
  for (let i = 0; i < 4; i++) {
    playerSlots[i].type = i < tankCount ? 'human' : 'none';
    playerSlots[i].isReady = true;
    if (!playerSlots[i].team) playerSlots[i].team = defaultTeams[i];
    playerSlots[i].loadout = { ...allLoadouts[i] };
  }

  const selectMap = document.getElementById('selectHostMap');
  const chosenMapId = selectMap ? selectMap.value : null;
  const chosenMap = customMap || MapStorage.getMapById(chosenMapId) || (MapStorage.getMaps() && MapStorage.getMaps()[0]);

  if (gameState) {
    gameState.isTestMode = true;
    gameState.sandboxTankCount = tankCount;
  }
  setupGameMap(chosenMap, playerSlots);
  gameState.isTestMode = true;
  gameState.sandboxTankCount = tankCount;
  gameState.isRunning = true;
  gameState.myPlayerId = 1;
  gameState.testTargetPlayerId = 1;

  const allActive = [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean);
  allActive.forEach(t => {
    t.resetPerks();
    t.applyLoadout(t.hullType, t.turretType);
  });

  // Очищуємо ввід усіх танків
  uiHooks.resetPointerHoldState();
  localInput.up = false; localInput.down = false; localInput.left = false; localInput.right = false;
  localInput.shoot = false; localInput.placeMine = false; localInput.useSmoke = false;
  localInput.useBeacon = false; localInput.useRadar = false; localInput.toggleGuided = false;
  localInput.useTurbo = false; localInput.useRepair = false; localInput.reloadClip = false;
  localInput.selectedActive = null;
  localInput.turretAngle = p1Tank ? p1Tank.turretAngle : Math.PI / 2;

  [p1Input, p2Input, p3Input, p4Input].forEach(inp => {
    inp.up = false; inp.down = false; inp.left = false; inp.right = false;
    inp.shoot = false; inp.placeMine = false; inp.useSmoke = false;
    inp.useBeacon = false; inp.useRadar = false; inp.toggleGuided = false;
    inp.useTurbo = false; inp.useRepair = false; inp.reloadClip = false;
    inp.artilleryStrike = null;
    inp.selectedActive = null;
  });
  if (p1Tank) p1Input.turretAngle = p1Tank.turretAngle;
  if (p2Tank) p2Input.turretAngle = p2Tank.turretAngle;
  if (p3Tank) p3Input.turretAngle = p3Tank.turretAngle;
  if (p4Tank) p4Input.turretAngle = p4Tank.turretAngle;

  const lobbyScreen = document.getElementById('lobbyScreen');
  const editorScreen = document.getElementById('editorScreen');
  const mechScreen = document.getElementById('mechanicsScreen');
  const gameScreen = document.getElementById('gameScreen');
  const btnMenu = document.getElementById('btnMenu');
  const testPanel = document.getElementById('testModePanel');

  if (lobbyScreen) lobbyScreen.classList.add('hidden');
  if (editorScreen) editorScreen.classList.add('hidden');
  if (mechScreen) mechScreen.classList.add('hidden');
  if (gameScreen) gameScreen.classList.remove('hidden');
  if (btnMenu) btnMenu.classList.remove('hidden');
  if (testPanel) testPanel.classList.remove('hidden');

  uiHooks.setConnectionStatus('online', '🧪 ПОЛІГОН (ТЕСТ)');

  uiHooks.renderMechanicsCatalog();
  renderTestModeUI();
  uiHooks.updateTelemetryUI();
  uiHooks.updateHUD();
  return true;
}

/**
 * Перемикання керування між активними танками у Зоні для тестування (клавіша Tab або кнопка)
 */
export function switchTestActivePlayer(targetId = null) {
  if (!gameState || !gameState.isTestMode) return Network.myPlayerId;

  const allActive = [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean);
  if (allActive.length === 0) return Network.myPlayerId;

  let nextTank = null;
  if (targetId && allActive.some(t => t.id === targetId)) {
    nextTank = allActive.find(t => t.id === targetId);
  } else {
    const curIdx = allActive.findIndex(t => t.id === Network.myPlayerId);
    const nextIdx = (curIdx + 1) % allActive.length;
    nextTank = allActive[nextIdx];
  }

  const nextId = nextTank ? nextTank.id : 1;

  // Зупиняємо рух та стрільбу при перемиканні
  uiHooks.resetPointerHoldState();
  localInput.up = false; localInput.down = false; localInput.left = false; localInput.right = false;
  localInput.shoot = false; localInput.placeMine = false; localInput.useSmoke = false;
  localInput.useBeacon = false; localInput.useRadar = false; localInput.toggleGuided = false;
  localInput.useTurbo = false; localInput.useRepair = false; localInput.reloadClip = false;
  localInput.artilleryStrike = null;

  [p1Input, p2Input, p3Input, p4Input].forEach(inp => {
    inp.up = false; inp.down = false; inp.left = false; inp.right = false;
    inp.shoot = false; inp.placeMine = false; inp.useSmoke = false;
    inp.useBeacon = false; inp.useRadar = false; inp.toggleGuided = false;
    inp.useTurbo = false; inp.useRepair = false; inp.reloadClip = false;
    inp.artilleryStrike = null;
  });

  Network.myPlayerId = nextId;
  setTestTargetPlayerId(nextId);
  gameState.myPlayerId = nextId;

  if (nextTank) {
    localInput.turretAngle = nextTank.turretAngle;
    localInput.selectedActive = nextTank.selectedActive || null;
  }

  renderTestModeUI();
  uiHooks.renderPerkSelectionUI();
  uiHooks.updateHUD();
  return nextId;
}

/**
 * Вибір гравця (1..4) для налаштування його здібностей, команди та корпусу/гармати у панелі тестування
 */
export function setTestTargetPlayer(playerId) {
  const target = Math.max(1, Math.min(4, playerId || 1));
  const nextTarget = setTestTargetPlayerId(target);
  renderTestModeUI();
  return nextTarget;
}

/**
 * Додавання здібності (perkId) обраному гравцю (1..4) у Зоні для тестування
 */
export function addTestPerkForPlayer(playerId, perkId) {
  const tank = getTestTank(playerId);
  const def = PERK_TYPES[perkId];
  if (!tank || !def) return false;

  const stacks = Array.isArray(tank.acquiredPerks)
    ? tank.acquiredPerks.filter(id => id === perkId).length
    : 0;
  if (!def.stackable && stacks >= 1) return false;
  if (def.maxStacks && stacks >= def.maxStacks) return false;

  tank.applyPerk(perkId, { refreshRerolls: true });
  if (tank.id === Network.myPlayerId) {
    localInput.selectedActive = tank.selectedActive;
    uiHooks.sendLocalInput();
  }
  renderTestModeUI();
  uiHooks.updateHUD();
  return true;
}

/**
 * Видалення 1 стека здібності (perkId) в обраного гравця (1..4) у Зоні для тестування
 */
export function removeTestPerkForPlayer(playerId, perkId) {
  const tank = getTestTank(playerId);
  if (!tank || typeof tank.removePerk !== 'function') return false;
  const removed = tank.removePerk(perkId);
  if (removed && tank.id === Network.myPlayerId) {
    localInput.selectedActive = tank.selectedActive;
    uiHooks.sendLocalInput();
  }
  renderTestModeUI();
  uiHooks.updateHUD();
  return removed;
}

/**
 * Додавання прокляття (curseId) обраному гравцю (1..4) у Зоні для тестування
 */
export function addTestCurseForPlayer(playerId, curseId) {
  const tank = getTestTank(playerId);
  const def = CURSE_TYPES[curseId];
  if (!tank || !def) return false;

  const stacks = Array.isArray(tank.acquiredCurses)
    ? tank.acquiredCurses.filter(id => id === curseId).length
    : 0;
  if (!def.stackable && stacks >= 1) return false;

  const applied = tank.applyCurse(curseId);
  renderTestModeUI();
  uiHooks.updateHUD();
  return applied;
}

/**
 * Видалення 1 стека прокляття (curseId) в обраного гравця (1..4) у Зоні для тестування
 */
export function removeTestCurseForPlayer(playerId, curseId) {
  const tank = getTestTank(playerId);
  if (!tank || typeof tank.removeCurse !== 'function') return false;
  const removed = tank.removeCurse(curseId);
  renderTestModeUI();
  uiHooks.updateHUD();
  return removed;
}

/**
 * Скидання всіх здібностей обраного гравця (1..4) у Зоні для тестування
 */
export function clearTestPerksForPlayer(playerId) {
  const tank = getTestTank(playerId);
  if (!tank || typeof tank.resetPerks !== 'function') return false;
  tank.resetPerks();
  if (tank.id === Network.myPlayerId) {
    localInput.selectedActive = tank.selectedActive;
    uiHooks.sendLocalInput();
  }
  renderTestModeUI();
  uiHooks.updateHUD();
  return true;
}

/**
 * Повне відновлення HP, набоїв, мін, ремкомплектів, перероджень та скидання кулдаунів усім активним танкам у Полігоні
 */
export function healAndResetCooldownsInTestMode() {
  if (gameState) {
    gameState.roundTimeFrames = 0;
  }
  [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean).forEach(t => {
    t.isDead = false;
    t.hp = t.maxHp;
    t.ammo = t.clipSize;
    t.isReloadingClip = false;
    t.minesLeft = t.maxMines;
    t.repairKitsLeft = t.maxRepairKits;
    t.rebirthsLeft = t.maxRebirths;
    t.rerollsLeft = t.maxRerolls;
    t.smokeCooldownTimer = 0;
    t.smokeActiveTimer = 0;
    t.artilleryCooldownTimer = 0;
    t.artilleryPendingTimer = 0;
    t.artilleryPendingCol = null;
    t.artilleryPendingRow = null;
    t.beaconCooldownTimer = 0;
    t.beaconActiveTimer = 0;
    t.spotCooldownTimer = 0;
    t.spotActiveTimer = 0;
    t.guidedCooldownTimer = 0;
    t.guidedBulletArmed = false;
    t.guidedBulletActive = false;
    t.turboCooldownTimer = 0;
    t.turboActiveTimer = 0;
    t.targetingMode = null;
    t.hitInvulnTimer = 0;
    t.roundTimeDmgBonus = 0;
    t.blindTimer = 0;
    t.sniperStealthTimer = 0;
  });
  renderTestModeUI();
  uiHooks.updateHUD();
  return true;
}

/**
 * Рендеринг панелі керування Полігоном та інтерактивного каталогу здібностей для Гравців 1..4
 */
export function renderTestModeUI() {
  if (typeof document === 'undefined') return;
  const panel = document.getElementById('testModePanel');
  if (!panel) return;

  if (!gameState || !gameState.isTestMode) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');

  const curTank = getTestTank(Network.myPlayerId);
  const activeBadge = document.getElementById('testActivePlayerBadge');
  if (activeBadge) {
    const teamNames = ['🟡 К1 (Жовтий)', '🟢 К2 (Зелений)', '🔵 К3 (Блакитний)', '🟣 К4 (Фіолетовий)'];
    const teamLabel = curTank ? (teamNames[curTank.team - 1] || `Команда ${curTank.team}`) : `Гравець ${Network.myPlayerId}`;
    activeBadge.textContent = `🎮 Керування: ГРАВЕЦЬ ${Network.myPlayerId} (${teamLabel})`;
    activeBadge.className = `test-player-badge p${Network.myPlayerId}-active`;
  }

  const countSelect = document.getElementById('selectTestTankCount');
  if (countSelect) {
    countSelect.value = String(gameState.sandboxTankCount || 2);
    if (!countSelect._boundChange) {
      countSelect._boundChange = true;
      countSelect.addEventListener('change', () => {
        startTestMode();
      });
    }
  }

  const selectTestMapEvent = document.getElementById('selectTestMapEvent');
  if (selectTestMapEvent) {
    selectTestMapEvent.value = (gameState && gameState.currentMapEvent) ? gameState.currentMapEvent : 'none';
  }

  const activeCount = gameState.sandboxTankCount || 2;
  const targetTabs = [
    document.getElementById('btnTestTargetP1'),
    document.getElementById('btnTestTargetP2'),
    document.getElementById('btnTestTargetP3'),
    document.getElementById('btnTestTargetP4')
  ];

  targetTabs.forEach((tab, idx) => {
    if (!tab) return;
    const pId = idx + 1;
    tab.classList.toggle('hidden', pId > activeCount);
    const isTarget = testTargetPlayerId === pId;
    tab.classList.toggle('active', isTarget);
    tab.classList.toggle(`active-p${pId}`, isTarget);
    if (!tab._boundTargetClick) {
      tab._boundTargetClick = true;
      tab.addEventListener('click', () => {
        setTestTargetPlayer(pId);
      });
    }
  });

  const targetTank = getTestTank(testTargetPlayerId);

  // Оновлення кнопок вибору команди обраного танка
  const teamPillGroup = document.getElementById('testTargetTeamPills');
  if (teamPillGroup && targetTank) {
    const pills = teamPillGroup.querySelectorAll('.team-pill');
    pills.forEach(pill => {
      const teamNum = parseInt(pill.dataset.team, 10);
      pill.classList.toggle('active', targetTank.team === teamNum);
      if (!pill._boundTeamClick) {
        pill._boundTeamClick = true;
        pill.addEventListener('click', () => {
          const t = getTestTank(testTargetPlayerId);
          if (t) {
            t.team = teamNum;
            if (playerSlots[t.id - 1]) {
              playerSlots[t.id - 1].team = teamNum;
            }
            renderTestModeUI();
            uiHooks.updateHUD();
          }
        });
      }
    });
  }

  const selectTestHull = document.getElementById('selectTestHull');
  const selectTestTurret = document.getElementById('selectTestTurret');

  if (selectTestHull && targetTank) {
    if (selectTestHull.children.length === 0) {
      Object.values(HULL_TYPES).forEach(h => {
        const opt = document.createElement('option');
        opt.value = h.id;
        opt.textContent = h.name;
        selectTestHull.appendChild(opt);
      });
    }
    selectTestHull.value = targetTank.hullType || 'standard';
    selectTestHull.onchange = () => {
      const t = getTestTank(testTargetPlayerId);
      if (!t) return;
      const allLoadouts = [p1Loadout, p2Loadout, p3Loadout, p4Loadout];
      if (allLoadouts[testTargetPlayerId - 1]) {
        allLoadouts[testTargetPlayerId - 1].hull = selectTestHull.value;
      }
      if (playerSlots[testTargetPlayerId - 1] && playerSlots[testTargetPlayerId - 1].loadout) {
        playerSlots[testTargetPlayerId - 1].loadout.hull = selectTestHull.value;
      }
      t.applyLoadout(selectTestHull.value, t.turretType);
      t.hp = t.maxHp;
      renderTestModeUI();
      uiHooks.updateHUD();
    };
  }

  if (selectTestTurret && targetTank) {
    if (selectTestTurret.children.length === 0) {
      Object.values(TURRET_TYPES).forEach(tur => {
        const opt = document.createElement('option');
        opt.value = tur.id;
        opt.textContent = tur.name;
        selectTestTurret.appendChild(opt);
      });
    }
    selectTestTurret.value = targetTank.turretType || 'standard';
    selectTestTurret.onchange = () => {
      const t = getTestTank(testTargetPlayerId);
      if (!t) return;
      const allLoadouts = [p1Loadout, p2Loadout, p3Loadout, p4Loadout];
      if (allLoadouts[testTargetPlayerId - 1]) {
        allLoadouts[testTargetPlayerId - 1].turret = selectTestTurret.value;
      }
      if (playerSlots[testTargetPlayerId - 1] && playerSlots[testTargetPlayerId - 1].loadout) {
        playerSlots[testTargetPlayerId - 1].loadout.turret = selectTestTurret.value;
      }
      t.applyLoadout(t.hullType, selectTestTurret.value);
      t.ammo = t.clipSize;
      renderTestModeUI();
      uiHooks.updateHUD();
    };
  }

  const searchInput = document.getElementById('testPerkSearchInput');
  if (searchInput && !searchInput._boundSearchListener) {
    searchInput._boundSearchListener = true;
    searchInput.addEventListener('input', () => {
      renderTestModeUI();
    });
  }
  const searchQuery = (searchInput && typeof searchInput.value === 'string')
    ? searchInput.value.trim().toLowerCase()
    : '';

  const catalogEl = document.getElementById('testPerksCatalog');
  if (!catalogEl || !targetTank) return;

  catalogEl.innerHTML = '';
  const owned = Array.isArray(targetTank.acquiredPerks) ? targetTank.acquiredPerks : [];
  const ownedCurses = Array.isArray(targetTank.acquiredCurses) ? targetTank.acquiredCurses : [];
  const hullCfg = targetTank.hullType ? HULL_TYPES[targetTank.hullType] : null;
  const turretCfg = targetTank.turretType ? TURRET_TYPES[targetTank.turretType] : null;
  const blockHpArmor = Boolean(targetTank.blockHpAndArmorPerks || (hullCfg && hullCfg.blockHpAndArmorPerks));
  const blockSize = Boolean(targetTank.blockSizePerks || (hullCfg && hullCfg.blockSizePerks));
  const fixedFov = Boolean(targetTank.fixedFov || (turretCfg && turretCfg.fixedFov));
  const noSpread = Boolean(targetTank.noSpread || (turretCfg && turretCfg.noSpread));

  Object.values(PERK_TYPES).forEach(perk => {
    if (!perk || !perk.id) return;

    if (searchQuery) {
      const rarityObj = PERK_RARITIES[perk.rarity || 'common'];
      const rarityName = rarityObj && rarityObj.name ? rarityObj.name.toLowerCase() : '';
      const haystack = `${perk.title || ''} ${perk.description || ''} ${perk.id || ''} ${rarityName}`.toLowerCase();
      if (!haystack.includes(searchQuery)) return;
    }

    const isForbiddenForPhantom = blockHpArmor && PHANTOM_FORBIDDEN_PERKS.includes(perk.id);
    const isForbiddenForBaby = blockSize && BABY_FORBIDDEN_PERKS.includes(perk.id);
    const isForbiddenForSniper = (fixedFov && perk.id === 'fov_plus_10') || (noSpread && perk.id === 'spread_minus_05');
    const isForbiddenForHull = isForbiddenForPhantom || isForbiddenForBaby || isForbiddenForSniper;
    const stacks = owned.filter(id => id === perk.id).length;
    const maxStacks = !perk.stackable ? 1 : (perk.maxStacks || 99);
    const canAdd = !isForbiddenForHull && (stacks < maxStacks);
    const canRemove = stacks > 0;

    const item = document.createElement('div');
    item.className = `test-perk-chip perk-rarity-${perk.rarity || 'common'}${stacks > 0 ? ' has-perk has-stacks' : ''}${isForbiddenForHull ? ' forbidden-perk' : ''}`;
    item.dataset.perkId = perk.id;
    item.dataset.rarity = perk.rarity || 'common';

    const countLabel = isForbiddenForHull
      ? '🚫'
      : (!perk.stackable
        ? `${stacks}/1`
        : (perk.maxStacks ? `${stacks}/${perk.maxStacks}` : `x${stacks}`));

    const subText = isForbiddenForPhantom
      ? 'Недоступно для Фантомного корпусу'
      : (isForbiddenForBaby
        ? 'Недоступно для корпусу Малюк'
        : (isForbiddenForSniper
          ? 'Недоступно для башти Снайпер'
          : (perk.description || '')));

    item.innerHTML = `
      <span class="test-perk-chip-icon">${perk.icon || '✨'}</span>
      <div class="test-perk-chip-info">
        <div class="test-perk-chip-title" title="${perk.title}">${perk.title}</div>
        <div class="test-perk-chip-sub" title="${subText}">${subText}</div>
      </div>
      <div class="test-perk-chip-controls">
        <button type="button" class="btn-perk-step btn-perk-minus" data-action="remove" data-perk-id="${perk.id}" ${canRemove ? '' : 'disabled'}>−</button>
        <span class="test-perk-chip-count">${countLabel}</span>
        <button type="button" class="btn-perk-step btn-perk-plus" data-action="add" data-perk-id="${perk.id}" ${canAdd ? '' : 'disabled'}>+</button>
      </div>
    `;

    const btnMinus = item.querySelector('.btn-perk-minus');
    const btnPlus = item.querySelector('.btn-perk-plus');
    if (btnMinus) {
      btnMinus.onclick = (ev) => {
        ev.stopPropagation();
        removeTestPerkForPlayer(testTargetPlayerId, perk.id);
      };
    }
    if (btnPlus) {
      btnPlus.onclick = (ev) => {
        ev.stopPropagation();
        addTestPerkForPlayer(testTargetPlayerId, perk.id);
      };
    }

    catalogEl.appendChild(item);
  });

  // Додаємо картки ПРОКЛЯТЬ (CURSE_TYPES) у каталог Полігону
  Object.values(CURSE_TYPES || {}).forEach(curse => {
    if (!curse || !curse.id) return;

    if (searchQuery) {
      const haystack = `${curse.title || ''} ${curse.description || ''} ${curse.id || ''} прокляття curse`.toLowerCase();
      if (!haystack.includes(searchQuery)) return;
    }

    const isForbiddenForPhantom = blockHpArmor && PHANTOM_FORBIDDEN_CURSES.includes(curse.id);
    const isForbiddenForBaby = blockSize && BABY_FORBIDDEN_CURSES.includes(curse.id);
    const isForbiddenForSniper = (fixedFov && curse.id === 'curse_fov_minus_10') || (noSpread && curse.id === 'curse_spread_plus_05');
    const isForbiddenForHull = isForbiddenForPhantom || isForbiddenForBaby || isForbiddenForSniper;
    const stacks = ownedCurses.filter(id => id === curse.id).length;
    const maxStacks = !curse.stackable ? 1 : 99;
    const canAdd = !isForbiddenForHull && (stacks < maxStacks);
    const canRemove = stacks > 0;

    const item = document.createElement('div');
    item.className = `test-perk-chip test-curse-chip${stacks > 0 ? ' has-perk has-stacks' : ''}${isForbiddenForHull ? ' forbidden-perk' : ''}`;
    item.dataset.curseId = curse.id;

    const countLabel = isForbiddenForHull
      ? '🚫'
      : (!curse.stackable ? `${stacks}/1` : `x${stacks}`);

    const subText = isForbiddenForPhantom
      ? 'Недоступно для Фантомного корпусу'
      : (isForbiddenForBaby
        ? 'Недоступно для корпусу Малюк'
        : (isForbiddenForSniper
          ? 'Недоступно для башти Снайпер'
          : (curse.description || '')));

    item.innerHTML = `
      <span class="test-perk-chip-icon">${curse.icon || '☠️'}</span>
      <div class="test-perk-chip-info">
        <div class="test-perk-chip-title" title="☠️ Прокляття: ${curse.title}">☠️ ${curse.title}</div>
        <div class="test-perk-chip-sub" title="${subText}">${subText}</div>
      </div>
      <div class="test-perk-chip-controls">
        <button type="button" class="btn-perk-step btn-perk-minus" data-action="remove-curse" data-curse-id="${curse.id}" ${canRemove ? '' : 'disabled'}>−</button>
        <span class="test-perk-chip-count">${countLabel}</span>
        <button type="button" class="btn-perk-step btn-perk-plus" data-action="add-curse" data-curse-id="${curse.id}" ${canAdd ? '' : 'disabled'}>+</button>
      </div>
    `;

    const btnMinus = item.querySelector('.btn-perk-minus');
    const btnPlus = item.querySelector('.btn-perk-plus');
    if (btnMinus) {
      btnMinus.onclick = (ev) => {
        ev.stopPropagation();
        removeTestCurseForPlayer(testTargetPlayerId, curse.id);
      };
    }
    if (btnPlus) {
      btnPlus.onclick = (ev) => {
        ev.stopPropagation();
        addTestCurseForPlayer(testTargetPlayerId, curse.id);
      };
    }

    catalogEl.appendChild(item);
  });
}

registerUIHooks({ renderTestModeUI });
