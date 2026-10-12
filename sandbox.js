/**
 * @file sandbox.js
 * @description Модуль Зони для тестування (Полігон): перемикання активного гравця (Tab / кнопка), вільний вибір та видалення здібностей, зміна корпусу/гармати та відновлення HP/кулдаунів.
 */

import {
  HULL_TYPES, TURRET_TYPES, PERK_RARITIES, PERK_TYPES, PHANTOM_FORBIDDEN_PERKS
} from './config.js?v=20261011_v17';
import { MapStorage } from './editor.js?v=20261011_v17';
import Network from './network.js?v=20261011_v17';
import {
  setTargetWinScore, p1Tank, p2Tank,
  localLoadout, p1Loadout, p2Loadout, testTargetPlayerId,
  gameState, localInput, p1Input, p2Input,
  setP1Loadout, setP2Loadout, setTestTargetPlayerId, setP1Input, setP2Input,
  setupGameMap, uiHooks, registerUIHooks
} from './state.js?v=20261011_v17';

/**
 * Запуск локальної Зони для тестування (Полігон):
 * дозволяє перемикатися між Гравцем 1 та Гравцем 2 (Tab або кнопка) та вільно призначати/прибирати будь-які здібності.
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

  const sHull = document.getElementById('selectHull');
  const sTurret = document.getElementById('selectTurret');
  const sWinScore = document.getElementById('selectHostWinScore');
  if (sHull && sHull.value && HULL_TYPES[sHull.value]) localLoadout.hull = sHull.value;
  if (sTurret && sTurret.value && TURRET_TYPES[sTurret.value]) localLoadout.turret = sTurret.value;
  if (sWinScore && sWinScore.value) setTargetWinScore(Number(sWinScore.value));

  setP1Loadout(localLoadout);
  setP2Loadout({ hull: 'standard', turret: 'standard' });

  const selectMap = document.getElementById('selectHostMap');
  const chosenMapId = selectMap ? selectMap.value : null;
  const chosenMap = customMap || MapStorage.getMapById(chosenMapId) || (MapStorage.getMaps() && MapStorage.getMaps()[0]);

  if (gameState) gameState.isTestMode = true;
  setupGameMap(chosenMap);
  gameState.isTestMode = true;
  gameState.isRunning = true;
  gameState.myPlayerId = 1;
  gameState.testTargetPlayerId = 1;

  if (p1Tank) {
    p1Tank.resetPerks();
    p1Tank.applyLoadout(p1Loadout.hull, p1Loadout.turret);
  }
  if (p2Tank) {
    p2Tank.resetPerks();
    p2Tank.applyLoadout(p2Loadout.hull, p2Loadout.turret);
  }

  // Очищуємо ввід обох танків
  uiHooks.resetPointerHoldState();
  localInput.up = false; localInput.down = false; localInput.left = false; localInput.right = false;
  localInput.shoot = false; localInput.placeMine = false; localInput.useSmoke = false; localInput.useRepair = false; localInput.reloadClip = false;
  localInput.selectedActive = null;
  localInput.turretAngle = Math.PI / 2;
  setP1Input({ ...localInput, turretAngle: Math.PI / 2 });
  setP2Input({ ...localInput, turretAngle: -Math.PI / 2 });

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
  const labelP1 = document.getElementById('labelP1');
  const labelP2 = document.getElementById('labelP2');
  if (labelP1) labelP1.textContent = 'ТИ (ГРАВЕЦЬ 1)';
  if (labelP2) labelP2.textContent = 'СУПЕРНИК (ГРАВЕЦЬ 2)';

  uiHooks.renderMechanicsCatalog();
  renderTestModeUI();
  uiHooks.updateTelemetryUI();
  uiHooks.updateHUD();
  return true;
}

/**
 * Перемикання керування між Гравцем 1 та Гравцем 2 у Зоні для тестування (клавіша Tab або кнопка)
 */
export function switchTestActivePlayer(targetId = null) {
  if (!gameState || !gameState.isTestMode) return Network.myPlayerId;

  const nextId = (targetId === 1 || targetId === 2)
    ? targetId
    : (Network.myPlayerId === 1 ? 2 : 1);

  // Зупиняємо рух та стрільбу попереднього танка при перемиканні
  uiHooks.resetPointerHoldState();
  localInput.up = false; localInput.down = false; localInput.left = false; localInput.right = false;
  localInput.shoot = false; localInput.placeMine = false; localInput.useSmoke = false; localInput.useRepair = false; localInput.reloadClip = false;
  localInput.artilleryStrike = null;

  p1Input.up = false; p1Input.down = false; p1Input.left = false; p1Input.right = false;
  p1Input.shoot = false; p1Input.placeMine = false; p1Input.useSmoke = false; p1Input.useRepair = false; p1Input.reloadClip = false;
  p1Input.artilleryStrike = null;

  p2Input.up = false; p2Input.down = false; p2Input.left = false; p2Input.right = false;
  p2Input.shoot = false; p2Input.placeMine = false; p2Input.useSmoke = false; p2Input.useRepair = false; p2Input.reloadClip = false;
  p2Input.artilleryStrike = null;

  Network.myPlayerId = nextId;
  setTestTargetPlayerId(nextId);
  gameState.myPlayerId = nextId;

  const activeTank = nextId === 1 ? p1Tank : p2Tank;
  if (activeTank) {
    localInput.turretAngle = activeTank.turretAngle;
    localInput.selectedActive = activeTank.selectedActive || null;
  }

  const labelP1 = document.getElementById('labelP1');
  const labelP2 = document.getElementById('labelP2');
  if (nextId === 1) {
    if (labelP1) labelP1.textContent = 'ТИ (ГРАВЕЦЬ 1)';
    if (labelP2) labelP2.textContent = 'СУПЕРНИК (ГРАВЕЦЬ 2)';
  } else {
    if (labelP1) labelP1.textContent = 'СУПЕРНИК (ГРАВЕЦЬ 1)';
    if (labelP2) labelP2.textContent = 'ТИ (ГРАВЕЦЬ 2)';
  }

  if (gameState.visibility) {
    gameState.isEnemyVisible = nextId === 1 ? gameState.visibility.p1CanSeeP2 : gameState.visibility.p2CanSeeP1;
  }

  renderTestModeUI();
  uiHooks.renderPerkSelectionUI();
  uiHooks.updateHUD();
  return nextId;
}

/**
 * Вибір гравця (1 або 2) для налаштування його здібностей та корпусу/гармати у панелі тестування
 */
export function setTestTargetPlayer(playerId) {
  const nextTarget = setTestTargetPlayerId(playerId === 2 ? 2 : 1);
  renderTestModeUI();
  return nextTarget;
}

/**
 * Додавання здібності (perkId) обраному гравцю (1 або 2) у Зоні для тестування
 */
export function addTestPerkForPlayer(playerId, perkId) {
  const tank = playerId === 2 ? p2Tank : p1Tank;
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
 * Видалення 1 стека здібності (perkId) в обраного гравця (1 або 2) у Зоні для тестування
 */
export function removeTestPerkForPlayer(playerId, perkId) {
  const tank = playerId === 2 ? p2Tank : p1Tank;
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
 * Скидання всіх здібностей обраного гравця (1 або 2) у Зоні для тестування
 */
export function clearTestPerksForPlayer(playerId) {
  const tank = playerId === 2 ? p2Tank : p1Tank;
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
 * Повне відновлення HP, набоїв, мін, ремкомплектів, перероджень та скидання кулдауну диму/артилерії обом танкам у Полігоні
 */
export function healAndResetCooldownsInTestMode() {
  if (gameState) {
    gameState.roundTimeFrames = 0;
  }
  [p1Tank, p2Tank].forEach(t => {
    if (!t) return;
    t.isDead = false;
    t.hp = t.maxHp;
    t.ammo = t.clipSize;
    t.isReloadingClip = false;
    t.minesLeft = t.maxMines;
    t.repairKitsLeft = t.maxRepairKits;
    t.rebirthsLeft = t.maxRebirths;
    t.rerollsLeft = t.maxRerolls;
    t.smokeCooldownTimer = 0;
    t.artilleryCooldownTimer = 0;
    t.targetingMode = null;
    t.hitInvulnTimer = 0;
    t.roundTimeDmgBonus = 0;
  });
  renderTestModeUI();
  uiHooks.updateHUD();
  return true;
}

/**
 * Рендеринг панелі керування Полігоном та інтерактивного каталогу здібностей для Гравця 1 / Гравця 2
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

  const activeBadge = document.getElementById('testActivePlayerBadge');
  if (activeBadge) {
    const isP1 = Network.myPlayerId === 1;
    activeBadge.textContent = isP1
      ? '🎮 Керування: ГРАВЕЦЬ 1 (Жовтий)'
      : '🎮 Керування: ГРАВЕЦЬ 2 (Зелений)';
    activeBadge.classList.toggle('is-p2', !isP1);
  }

  const btnTargetP1 = document.getElementById('btnTestTargetP1');
  const btnTargetP2 = document.getElementById('btnTestTargetP2');
  if (btnTargetP1) btnTargetP1.classList.toggle('active', testTargetPlayerId === 1);
  if (btnTargetP2) btnTargetP2.classList.toggle('active', testTargetPlayerId === 2);

  const targetTank = testTargetPlayerId === 2 ? p2Tank : p1Tank;
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
      const t = testTargetPlayerId === 2 ? p2Tank : p1Tank;
      if (!t) return;
      if (testTargetPlayerId === 1) p1Loadout.hull = selectTestHull.value;
      else p2Loadout.hull = selectTestHull.value;
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
      const t = testTargetPlayerId === 2 ? p2Tank : p1Tank;
      if (!t) return;
      if (testTargetPlayerId === 1) p1Loadout.turret = selectTestTurret.value;
      else p2Loadout.turret = selectTestTurret.value;
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
  const hullCfg = targetTank.hullType ? HULL_TYPES[targetTank.hullType] : null;
  const blockHpArmor = Boolean(targetTank.blockHpAndArmorPerks || (hullCfg && hullCfg.blockHpAndArmorPerks));

  Object.values(PERK_TYPES).forEach(perk => {
    if (!perk || !perk.id) return;

    if (searchQuery) {
      const rarityObj = PERK_RARITIES[perk.rarity || 'common'];
      const rarityName = rarityObj && rarityObj.name ? rarityObj.name.toLowerCase() : '';
      const haystack = `${perk.title || ''} ${perk.description || ''} ${perk.id || ''} ${rarityName}`.toLowerCase();
      if (!haystack.includes(searchQuery)) return;
    }

    const isForbiddenForHull = blockHpArmor && PHANTOM_FORBIDDEN_PERKS.includes(perk.id);
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

    const subText = isForbiddenForHull
      ? 'Недоступно для Фантомного корпусу'
      : (perk.description || '');

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
}

registerUIHooks({ renderTestModeUI });
