/**
 * @file perks.js
 * @description Модуль генерації, реролу, вибору та UI-відображення післяраундових здібностей (Perks).
 */

import {
  MAX_TANK_SPEED, HULL_TYPES, TURRET_TYPES, PERK_RARITIES, getRarityWeightWithLuck, PERK_TYPES, PHANTOM_FORBIDDEN_PERKS,
  BASE_CURSE_CHANCE, CURSE_TYPES, PHANTOM_FORBIDDEN_CURSES,
  BABY_FORBIDDEN_PERKS, BABY_FORBIDDEN_CURSES, SNIPER_FORBIDDEN_PERKS, SNIPER_FORBIDDEN_CURSES
} from './config.js?v=20261011_v17';
import { showToast } from './editor.js?v=20261011_v17';
import Network from './network.js?v=20261011_v17';
import { sound } from './audio.js?v=20261011_v17';
import {
  p1Tank, p2Tank, p3Tank, p4Tank, gameState, localInput, p1Input, p2Input, p3Input, p4Input,
  setLastRoundLoserId, uiHooks, registerUIHooks
} from './state.js?v=20261011_v17';

/**
 * Випадковий вибір одного прокляття для танка (з урахуванням унікальності curse_size_plus_10 та обмежень Фантомного корпусу, Малюка і Снайпера)
 */
export function rollCurseForTank(tank) {
  const allCurses = Object.values(CURSE_TYPES);
  const ownedCurses = (tank && Array.isArray(tank.acquiredCurses)) ? tank.acquiredCurses : [];
  const hullCfg = tank && tank.hullType ? HULL_TYPES[tank.hullType] : null;
  const turretCfg = tank && tank.turretType ? TURRET_TYPES[tank.turretType] : null;
  const blockHpArmor = Boolean((tank && tank.blockHpAndArmorPerks) || (hullCfg && hullCfg.blockHpAndArmorPerks));
  const blockSize = Boolean((tank && tank.blockSizePerks) || (hullCfg && hullCfg.blockSizePerks));
  const isSniper = Boolean(
    (tank && (tank.turretType === 'sniper' || tank.fixedFov || tank.noSpread)) ||
    (turretCfg && (turretCfg.fixedFov || turretCfg.noSpread))
  );

  const pool = allCurses.filter(c => {
    if (!c || !c.id) return false;
    if (blockHpArmor && PHANTOM_FORBIDDEN_CURSES.includes(c.id)) return false;
    if (blockSize && BABY_FORBIDDEN_CURSES.includes(c.id)) return false;
    if (isSniper && SNIPER_FORBIDDEN_CURSES.includes(c.id)) return false;
    if (!c.stackable && ownedCurses.includes(c.id)) return false;
    return true;
  });

  if (pool.length === 0) return null;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  return picked.id;
}

/**
 * Перевірка кожної запропонованої картки на прокляття (базовий шанс 15%, зменшується перком curse_chance_minus_25 на 5% за стек, до 2 стеків)
 */
export function rollOptionCursesForTank(tank, options = []) {
  const cursesEnabled = !gameState || !gameState.gameModes || gameState.gameModes.curses !== false;
  if (!cursesEnabled || !Array.isArray(options) || options.length === 0) return {};

  const reduction = tank ? (Number(tank.curseChanceReduction) || 0) : 0;
  const chance = Math.max(0, BASE_CURSE_CHANCE - reduction);
  if (chance <= 0) return {};

  const optionCurses = {};
  for (const perkId of options) {
    if (Math.random() < chance) {
      const curseId = rollCurseForTank(tank);
      if (curseId) {
        optionCurses[perkId] = curseId;
      }
    }
  }
  return optionCurses;
}

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
  // для корпусу «Малюк» (blockSizePerks) виключаються перки на розмір;
  // для башти «Снайпер» виключаються перки на кут огляду та розкид;
  // також враховуємо maxStacks, reload_minus_02 (мін. 1.0с), speed_plus_01 (макс. 5) та spread_minus_05 (мін. 0°)
  const hullCfg = tank && tank.hullType ? HULL_TYPES[tank.hullType] : null;
  const turretCfg = tank && tank.turretType ? TURRET_TYPES[tank.turretType] : null;
  const blockHpArmor = Boolean((tank && tank.blockHpAndArmorPerks) || (hullCfg && hullCfg.blockHpAndArmorPerks));
  const blockSize = Boolean((tank && tank.blockSizePerks) || (hullCfg && hullCfg.blockSizePerks));
  const isSniper = Boolean(
    (tank && (tank.turretType === 'sniper' || tank.fixedFov || tank.noSpread)) ||
    (turretCfg && (turretCfg.fixedFov || turretCfg.noSpread))
  );
  const cursesEnabled = !gameState || !gameState.gameModes || gameState.gameModes.curses !== false;

  const pool = allPerks.filter(perk => {
    if (!perk || !perk.id) return false;
    if (blockHpArmor && PHANTOM_FORBIDDEN_PERKS.includes(perk.id)) return false;
    if (blockSize && BABY_FORBIDDEN_PERKS.includes(perk.id)) return false;
    if (isSniper && SNIPER_FORBIDDEN_PERKS.includes(perk.id)) return false;
    if (!cursesEnabled && perk.id === 'curse_chance_minus_25') return false;
    const stacks = getPerkStacks(perk.id);
    if (!perk.stackable && stacks > 0) return false;
    if (perk.maxStacks && stacks >= perk.maxStacks) return false;
    if (perk.id === 'reload_minus_02' && tank && tank.clipReloadTime <= 1000) return false;
    if (perk.id === 'speed_plus_01' && tank && tank.speed >= MAX_TANK_SPEED) return false;
    if (perk.id === 'spread_minus_05' && tank && (tank.noSpread || (typeof tank.spreadHalfAngleDeg === 'number' && tank.spreadHalfAngleDeg <= 0))) return false;
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
 * - Враховує extra_choice_plus_1 (1 з 4), double_pick_perk (2 вибори за раунд) та шанс Прокляття (15%)
 */
export function startPerkSelection(loserId) {
  if (!p1Tank || !p2Tank || gameState.gameOver) return;
  if (gameState.gameModes && gameState.gameModes.perks === false) {
    setLastRoundLoserId(0);
    return;
  }
  const loserTank = [p1Tank, p2Tank, p3Tank, p4Tank][(loserId || 1) - 1] || p2Tank;

  // Оновлюємо кількість реролів на цей раунд вибору
  if (loserTank) {
    loserTank.rerollsLeft = loserTank.maxRerolls || 0;
  }

  const choiceCount = (loserTank && loserTank.choiceCount) ? loserTank.choiceCount : 3;
  const picksPerRound = (loserTank && loserTank.picksPerRound) ? loserTank.picksPerRound : 1;
  const options = rollPerkOptionsForTank(loserTank, choiceCount);
  const optionCurses = rollOptionCursesForTank(loserTank, options);

  gameState.perkSelection = {
    active: true,
    loserId,
    options,
    optionCurses,
    picksRemaining: Math.min(picksPerRound, options.length || 1),
    totalPicks: picksPerRound,
    rerollsLeft: loserTank ? (loserTank.rerollsLeft || 0) : 0
  };

  localInput.shoot = false;
  localInput.placeMine = false;
  localInput.useSmoke = false;
  localInput.useTurbo = false;
  localInput.artilleryStrike = null;
  p1Input.shoot = false;
  p1Input.placeMine = false;
  p1Input.useSmoke = false;
  p1Input.useTurbo = false;
  p1Input.artilleryStrike = null;
  p2Input.shoot = false;
  p2Input.placeMine = false;
  p2Input.useSmoke = false;
  p2Input.useTurbo = false;
  p2Input.artilleryStrike = null;
  if (p1Tank) p1Tank.targetingMode = null;
  if (p2Tank) p2Tank.targetingMode = null; if (p3Tank) p3Tank.targetingMode = null; if (p4Tank) p4Tank.targetingMode = null;

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

  const targetTank = [p1Tank, p2Tank, p3Tank, p4Tank][(playerId || 1) - 1] || p2Tank;
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
  const newOptionCurses = rollOptionCursesForTank(targetTank, newOptions);

  gameState.perkSelection.options = newOptions;
  gameState.perkSelection.optionCurses = newOptionCurses;
  gameState.perkSelection.rerollsLeft = targetTank ? targetTank.rerollsLeft : Math.max(0, availRerolls - 1);

  Network.sendEvent('startPerkSelection', gameState.perkSelection);
  sound.playSpot();
  renderPerkSelectionUI();
  uiHooks.updateHUD();
  return true;
}

/**
 * Вибір запропонованого бонусу гравцем, що програв раунд (підтримує 2 вибори поспіль при double_pick_perk та накладання прокляття)
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

  const curseId = (gameState.perkSelection.optionCurses && gameState.perkSelection.optionCurses[perkId]) || null;
  const curseDef = curseId ? CURSE_TYPES[curseId] : null;

  const targetTank = [p1Tank, p2Tank, p3Tank, p4Tank][(playerId || 1) - 1] || p2Tank;
  if (targetTank) {
    targetTank.applyPerk(perkId, { refreshRerolls: false });
    if (curseId) {
      targetTank.applyCurse(curseId);
    }
    targetTank.respawn({ preserveRerolls: true });
  }

  const remainingOptions = (gameState.perkSelection.options || []).filter(id => id !== perkId);
  if (gameState.perkSelection.optionCurses && gameState.perkSelection.optionCurses[perkId]) {
    delete gameState.perkSelection.optionCurses[perkId];
  }
  const picksLeftAfterThis = (gameState.perkSelection.picksRemaining || 1) - 1;
  const perkDef = PERK_TYPES[perkId];
  const curseSuffix = curseDef ? ` + ☠️ Прокляття: ${curseDef.title}` : '';

  // Якщо у гравця є Божественна здібність "Подвійний дар" (double_pick_perk) і ще залишився 2-й вибір у цьому раунді:
  // Рероли НЕ оновлюються після першого вибору (вони оновлюються лише раз на раунд у startPerkSelection)!
  if (picksLeftAfterThis > 0 && remainingOptions.length > 0) {
    gameState.perkSelection.options = remainingOptions;
    gameState.perkSelection.picksRemaining = picksLeftAfterThis;
    gameState.perkSelection.rerollsLeft = targetTank ? (targetTank.rerollsLeft || 0) : (gameState.perkSelection.rerollsLeft || 0);

    Network.sendEvent('perkPartialChosen', {
      playerId,
      perkId,
      curseId,
      acquiredPerks: targetTank && Array.isArray(targetTank.acquiredPerks) ? [...targetTank.acquiredPerks] : [],
      acquiredCurses: targetTank && Array.isArray(targetTank.acquiredCurses) ? [...targetTank.acquiredCurses] : [],
      perkSelection: gameState.perkSelection
    });

    if (perkDef) {
      showToast(`✨ Гравець ${playerId} обрав 1-шу здібність: ${perkDef.title}${curseSuffix} (ще ${picksLeftAfterThis} на вибір!)`);
    }
    renderPerkSelectionUI();
    uiHooks.renderTestModeUI();
    uiHooks.updateHUD();
    return true;
  }

  if (p1Tank) p1Tank.spawnShieldTimer = 120;
  if (p2Tank) p2Tank.spawnShieldTimer = 120; if (p3Tank) p3Tank.spawnShieldTimer = 120; if (p4Tank) p4Tank.spawnShieldTimer = 120;

  gameState.perkSelection = { active: false, loserId: 0, options: [], optionCurses: {}, picksRemaining: 1, totalPicks: 1, rerollsLeft: 0 };
  setLastRoundLoserId(0);

  Network.sendEvent('perkChosen', {
    playerId,
    perkId,
    curseId,
    acquiredPerks: targetTank && Array.isArray(targetTank.acquiredPerks) ? [...targetTank.acquiredPerks] : [],
    acquiredCurses: targetTank && Array.isArray(targetTank.acquiredCurses) ? [...targetTank.acquiredCurses] : []
  });

  if (perkDef) {
    showToast(`✨ Гравець ${playerId} обрав здібність: ${perkDef.title}${curseSuffix}`);
  }
  renderPerkSelectionUI();
  uiHooks.renderTestModeUI();
  uiHooks.updateHUD();
  return true;
}

/**
 * Рендеринг модального вікна вибору бонусу (3 або 4 картки з обводками рідкості, індикатором Прокляття + кнопка Реролу для переможеного
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

    const myTank = [p1Tank, p2Tank, p3Tank, p4Tank][(selectorId || 1) - 1] || p2Tank;
    const optionsList = gameState.perkSelection.options || [];
    const optionCurses = gameState.perkSelection.optionCurses || {};
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
        const curseId = optionCurses[perkId] || null;
        const curseDef = curseId ? CURSE_TYPES[curseId] : null;

        const card = document.createElement('button');
        card.type = 'button';
        card.className = `perk-card perk-rarity-${perk.rarity}${curseDef ? ' perk-card-cursed' : ''}`;
        card.dataset.perkId = perk.id;
        if (curseId) {
          card.dataset.curseId = curseId;
        }

        const stackText = perk.stackable
          ? (currentStacks > 0
              ? `Дублюється (вже є x${currentStacks}${perk.maxStacks ? `/${perk.maxStacks}` : ''})`
              : (perk.maxStacks ? `Можна дублювати (макс. ${perk.maxStacks})` : 'Можна дублювати'))
          : 'Унікальна здібність';

        const curseHtml = curseDef
          ? `<div class="perk-curse-badge">☠️ ПРОКЛЯТА: ${curseDef.title} (${curseDef.description})</div>`
          : '';

        card.innerHTML = `
          <div class="perk-rarity-badge">${rarity.name}${curseDef ? ' • ☠️ ПРОКЛЯТТЯ' : ''}</div>
          <div class="perk-card-icon">${perk.icon}</div>
          <div class="perk-card-title">${perk.title}</div>
          <div class="perk-card-desc">${perk.description}</div>
          ${curseHtml}
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
