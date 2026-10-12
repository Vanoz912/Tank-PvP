/**
 * @file perks.js
 * @description Модуль генерації, реролу, вибору та UI-відображення післяраундових здібностей (Perks).
 */

import {
  MAX_TANK_SPEED, HULL_TYPES, PERK_RARITIES, getRarityWeightWithLuck, PERK_TYPES, PHANTOM_FORBIDDEN_PERKS
} from './config.js?v=20261011_v17';
import { showToast } from './editor.js?v=20261011_v17';
import Network from './network.js?v=20261011_v17';
import { sound } from './audio.js?v=20261011_v17';
import {
  p1Tank, p2Tank, gameState, localInput, p1Input, p2Input,
  setLastRoundLoserId, uiHooks, registerUIHooks
} from './state.js?v=20261011_v17';

/**
 * Генерація випадкових бонусів (перків) для гравця, що програв раунд,
 * з урахуванням ваги рідкості, модифікаторів Удачі (luck_plus_1: Звичайні -5, Рідкісні -1.5, Легендарні +4, Божественні +1.5),
 * кількості варіантів (3 або 4 з перком extra_choice_plus_1) та ліміту дублікатів (maxStacks).
 */
export function rollPerkOptionsForTank(tank, count = null) {
  const effectiveCount = typeof count === 'number' ? count : ((tank && tank.choiceCount) ? tank.choiceCount : 3);
  const allPerks = Object.values(PERK_TYPES);
  const owned = (tank && tank.acquiredPerks) ? tank.acquiredPerks : [];
  const getPerkStacks = (perkId) => Array.isArray(owned)
    ? owned.filter(id => id === perkId).length
    : (Number(owned[perkId]) || 0);
  const luckStacks = tank ? (Number(tank.luckStacks) || 0) : 0;

  // Фільтруємо доступні перки: недубльовані, які вже взяті, виключаються;
  // для Фантомного корпусу (blockHpAndArmorPerks) виключаються перки на HP, броню, регенерацію та ремкомплект;
  // також враховуємо maxStacks (наприклад, для реролу maxStacks: 3), reload_minus_02 (мін. 1.0с) та speed_plus_01 (макс. 5)
  const hullCfg = tank && tank.hullType ? HULL_TYPES[tank.hullType] : null;
  const blockHpArmor = Boolean((tank && tank.blockHpAndArmorPerks) || (hullCfg && hullCfg.blockHpAndArmorPerks));

  const pool = allPerks.filter(perk => {
    if (!perk || !perk.id) return false;
    if (blockHpArmor && PHANTOM_FORBIDDEN_PERKS.includes(perk.id)) return false;
    const stacks = getPerkStacks(perk.id);
    if (!perk.stackable && stacks > 0) return false;
    if (perk.maxStacks && stacks >= perk.maxStacks) return false;
    if (perk.id === 'reload_minus_02' && tank && tank.clipReloadTime <= 1000) return false;
    if (perk.id === 'speed_plus_01' && tank && tank.speed >= MAX_TANK_SPEED) return false;
    return true;
  });

  const chosen = [];
  const available = [...pool];

  for (let i = 0; i < effectiveCount && available.length > 0; i++) {
    const buckets = {};
    available.forEach(p => {
      const rKey = p.rarity || 'common';
      if (!buckets[rKey]) buckets[rKey] = [];
      buckets[rKey].push(p);
    });

    const activeRarities = Object.keys(buckets).filter(r => buckets[r].length > 0);
    if (activeRarities.length === 0) break;

    const totalWeight = activeRarities.reduce((sum, r) => sum + getRarityWeightWithLuck(r, luckStacks), 0);
    let roll = Math.random() * totalWeight;
    let selectedRarity = activeRarities[0];

    for (const r of activeRarities) {
      const w = getRarityWeightWithLuck(r, luckStacks);
      if (roll < w) {
        selectedRarity = r;
        break;
      }
      roll -= w;
    }

    const bucket = buckets[selectedRarity];
    const pickedIndexInBucket = Math.floor(Math.random() * bucket.length);
    const pickedPerk = bucket[pickedIndexInBucket];

    chosen.push(pickedPerk.id);
    const idxInAvailable = available.findIndex(p => p.id === pickedPerk.id);
    if (idxInAvailable !== -1) available.splice(idxInAvailable, 1);
  }

  return chosen;
}

/**
 * Запуск фази вибору бонусу після раунду для гравця, що програв:
 * - Оновлює рероли на кожен новий вибір (rerollsLeft = maxRerolls, до 3 дублікатів)
 * - Враховує extra_choice_plus_1 (1 з 4) та double_pick_perk (2 вибори за раунд)
 */
export function startPerkSelection(loserId) {
  if (!p1Tank || !p2Tank || gameState.gameOver) return;
  const loserTank = loserId === 1 ? p1Tank : p2Tank;

  // Оновлюємо кількість реролів на цей раунд вибору
  if (loserTank) {
    loserTank.rerollsLeft = loserTank.maxRerolls || 0;
  }

  const choiceCount = (loserTank && loserTank.choiceCount) ? loserTank.choiceCount : 3;
  const picksPerRound = (loserTank && loserTank.picksPerRound) ? loserTank.picksPerRound : 1;
  const options = rollPerkOptionsForTank(loserTank, choiceCount);

  gameState.perkSelection = {
    active: true,
    loserId,
    options,
    picksRemaining: Math.min(picksPerRound, options.length || 1),
    totalPicks: picksPerRound,
    rerollsLeft: loserTank ? (loserTank.rerollsLeft || 0) : 0
  };

  localInput.shoot = false;
  localInput.placeMine = false;
  localInput.useSmoke = false;
  localInput.artilleryStrike = null;
  p1Input.shoot = false;
  p1Input.placeMine = false;
  p1Input.useSmoke = false;
  p1Input.artilleryStrike = null;
  p2Input.shoot = false;
  p2Input.placeMine = false;
  p2Input.useSmoke = false;
  p2Input.artilleryStrike = null;
  if (p1Tank) p1Tank.targetingMode = null;
  if (p2Tank) p2Tank.targetingMode = null;

  Network.sendEvent('startPerkSelection', gameState.perkSelection);
  renderPerkSelectionUI();
  uiHooks.updateHUD();
}

/**
 * Рерол (перегенерація) запропонованих здібностей під час вибору (перк reroll_plus_1, до 3 разів за раунд)
 */
export function rerollPerkOptions(playerId = Network.myPlayerId) {
  if (!gameState.perkSelection || !gameState.perkSelection.active) return false;
  if (gameState.perkSelection.loserId !== playerId) return false;

  const targetTank = playerId === 1 ? p1Tank : p2Tank;
  const availRerolls = targetTank ? (targetTank.rerollsLeft || 0) : (gameState.perkSelection.rerollsLeft || 0);
  if (availRerolls <= 0) return false;

  if (!Network.isHost && Network.connectionActive) {
    Network.sendPerkReroll();
    return true;
  }

  if (targetTank) {
    targetTank.rerollsLeft = Math.max(0, (targetTank.rerollsLeft || 0) - 1);
  }
  const choiceCount = (targetTank && targetTank.choiceCount) ? targetTank.choiceCount : 3;
  const newOptions = rollPerkOptionsForTank(targetTank, choiceCount);

  gameState.perkSelection.options = newOptions;
  gameState.perkSelection.rerollsLeft = targetTank ? targetTank.rerollsLeft : Math.max(0, availRerolls - 1);

  Network.sendEvent('startPerkSelection', gameState.perkSelection);
  sound.playSpot();
  renderPerkSelectionUI();
  uiHooks.updateHUD();
  return true;
}

/**
 * Вибір запропонованого бонусу гравцем, що програв раунд (підтримує 2 вибори поспіль при double_pick_perk)
 */
export function selectPerk(playerId, perkId) {
  if (!gameState.perkSelection || !gameState.perkSelection.active) return false;
  if (gameState.perkSelection.loserId !== playerId) return false;
  if (!PERK_TYPES[perkId]) return false;

  // Якщо вибір робить Гість (Клієнт) при активному P2P з'єднанні — надсилаємо вибір Хосту
  if (!Network.isHost && Network.connectionActive) {
    Network.sendPerkChoice(perkId);
    return true;
  }

  const targetTank = playerId === 1 ? p1Tank : p2Tank;
  if (targetTank) {
    targetTank.applyPerk(perkId, { refreshRerolls: false });
    targetTank.respawn({ preserveRerolls: true });
  }

  const remainingOptions = (gameState.perkSelection.options || []).filter(id => id !== perkId);
  const picksLeftAfterThis = (gameState.perkSelection.picksRemaining || 1) - 1;
  const perkDef = PERK_TYPES[perkId];

  // Якщо у гравця є Божественна здібність "Подвійний дар" (double_pick_perk) і ще залишився 2-й вибір у цьому раунді:
  // Рероли НЕ оновлюються після першого вибору (вони оновлюються лише раз на раунд у startPerkSelection)!
  if (picksLeftAfterThis > 0 && remainingOptions.length > 0) {
    gameState.perkSelection.options = remainingOptions;
    gameState.perkSelection.picksRemaining = picksLeftAfterThis;
    gameState.perkSelection.rerollsLeft = targetTank ? (targetTank.rerollsLeft || 0) : (gameState.perkSelection.rerollsLeft || 0);

    Network.sendEvent('perkPartialChosen', {
      playerId,
      perkId,
      acquiredPerks: targetTank && Array.isArray(targetTank.acquiredPerks) ? [...targetTank.acquiredPerks] : [],
      perkSelection: gameState.perkSelection
    });

    if (perkDef) {
      showToast(`✨ Гравець ${playerId} обрав 1-шу здібність: ${perkDef.title} (ще ${picksLeftAfterThis} на вибір!)`);
    }
    renderPerkSelectionUI();
    uiHooks.renderTestModeUI();
    uiHooks.updateHUD();
    return true;
  }

  if (p1Tank) p1Tank.spawnShieldTimer = 120;
  if (p2Tank) p2Tank.spawnShieldTimer = 120;

  gameState.perkSelection = { active: false, loserId: 0, options: [], picksRemaining: 1, totalPicks: 1, rerollsLeft: 0 };
  setLastRoundLoserId(0);

  Network.sendEvent('perkChosen', {
    playerId,
    perkId,
    acquiredPerks: targetTank && Array.isArray(targetTank.acquiredPerks) ? [...targetTank.acquiredPerks] : []
  });

  if (perkDef) {
    showToast(`✨ Гравець ${playerId} обрав здібність: ${perkDef.title}`);
  }
  renderPerkSelectionUI();
  uiHooks.renderTestModeUI();
  uiHooks.updateHUD();
  return true;
}

/**
 * Рендеринг модального вікна вибору бонусу (3 або 4 картки з обводками рідкості + кнопка Реролу для переможеного
 * або екран очікування "Зачекайте, супротивник вибирає здібність..." для переможця)
 */
export function renderPerkSelectionUI() {
  if (typeof document === 'undefined') return;
  const overlay = document.getElementById('perkSelectionOverlay');
  if (!overlay) return;

  const loserView = document.getElementById('perkLoserView');
  const winnerWaitView = document.getElementById('perkWinnerWaitView');
  const cardsContainer = document.getElementById('perkCardsContainer');
  const modalTitle = document.getElementById('perkModalTitle');
  const modalSubtitle = document.getElementById('perkModalSubtitle');
  const rerollContainer = document.getElementById('perkRerollContainer');
  const btnReroll = document.getElementById('btnRerollPerks');

  if (!gameState.perkSelection || !gameState.perkSelection.active || gameState.gameOver) {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');
  const isTest = Boolean(gameState.isTestMode);
  const selectorId = isTest ? gameState.perkSelection.loserId : Network.myPlayerId;
  const isMeLoser = isTest || (Network.myPlayerId === gameState.perkSelection.loserId);

  if (isMeLoser) {
    if (loserView) loserView.classList.remove('hidden');
    if (winnerWaitView) winnerWaitView.classList.add('hidden');

    const myTank = selectorId === 1 ? p1Tank : p2Tank;
    const optionsList = gameState.perkSelection.options || [];
    const picksRemaining = gameState.perkSelection.picksRemaining || 1;
    const rerollsLeft = typeof gameState.perkSelection.rerollsLeft === 'number'
      ? gameState.perkSelection.rerollsLeft
      : (myTank ? (myTank.rerollsLeft || 0) : 0);

    if (modalTitle) {
      const playerPrefix = isTest ? `[ГРАВЕЦЬ ${selectorId}] ` : '';
      modalTitle.textContent = `⚡ ${playerPrefix}ОБЕРІТЬ ${picksRemaining} З ${optionsList.length} ЗДІБНОСТЕЙ`;
    }
    if (modalSubtitle) {
      modalSubtitle.textContent = picksRemaining > 1
        ? `Подвійний дар активний! Залишилось обрати здібностей: ${picksRemaining}`
        : 'Ви поступилися у раунді — оберіть бонус для підсилення танка до кінця матчу:';
    }

    if (rerollContainer && btnReroll) {
      if (rerollsLeft > 0) {
        rerollContainer.classList.remove('hidden');
        btnReroll.textContent = `🎲 РЕРОЛ ЗДІБНОСТЕЙ (${rerollsLeft})`;
        btnReroll.onclick = () => {
          sound.init();
          rerollPerkOptions(selectorId);
        };
      } else {
        rerollContainer.classList.add('hidden');
      }
    }

    if (cardsContainer) {
      cardsContainer.innerHTML = '';
      cardsContainer.classList.toggle('four-cards', optionsList.length >= 4);
      const owned = (myTank && myTank.acquiredPerks) ? myTank.acquiredPerks : [];

      optionsList.forEach(perkId => {
        const perk = PERK_TYPES[perkId];
        if (!perk) return;
        const rarity = PERK_RARITIES[perk.rarity] || PERK_RARITIES.common;
        const currentStacks = Array.isArray(owned)
          ? owned.filter(id => id === perk.id).length
          : (owned[perk.id] || 0);

        const card = document.createElement('button');
        card.type = 'button';
        card.className = `perk-card perk-rarity-${perk.rarity}`;
        card.dataset.perkId = perk.id;

        const stackText = perk.stackable
          ? (currentStacks > 0
              ? `Дублюється (вже є x${currentStacks}${perk.maxStacks ? `/${perk.maxStacks}` : ''})`
              : (perk.maxStacks ? `Можна дублювати (макс. ${perk.maxStacks})` : 'Можна дублювати'))
          : 'Унікальна здібність';

        card.innerHTML = `
          <div class="perk-rarity-badge">${rarity.name}</div>
          <div class="perk-card-icon">${perk.icon}</div>
          <div class="perk-card-title">${perk.title}</div>
          <div class="perk-card-desc">${perk.description}</div>
          <div class="perk-card-stack">${stackText}</div>
        `;

        card.onclick = () => {
          sound.init();
          selectPerk(selectorId, perk.id);
        };

        cardsContainer.appendChild(card);
      });
    }
  } else {
    if (loserView) loserView.classList.add('hidden');
    if (winnerWaitView) winnerWaitView.classList.remove('hidden');
  }
}

registerUIHooks({ renderPerkSelectionUI });
