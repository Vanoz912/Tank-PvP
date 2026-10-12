/**
 * @file ui.js
 * @description Модуль інтерфейсу користувача (HUD, бічні панелі пасивних/активних здібностей, телеметрія FPS/Ping, меню реваншу, довідник «Механіки гри», лобі та слухачі кнопок).
 */

import {
  MIN_WIN_SCORE, MAX_WIN_SCORE, HULL_TYPES, TURRET_TYPES, PERK_RARITIES, PERK_TYPES
} from './config.js?v=20261011_v17';
import { TILE_TYPES, syncTileRegistry } from './tiles.js?v=20261011_v17';
import { MapEditor, MapStorage, updateHostMapDropdown, renderMapPreview, updateAllMapPreviews, showToast } from './editor.js?v=20261011_v17';
import Network from './network.js?v=20261011_v17';
import { sound } from './audio.js?v=20261011_v17';
import {
  MAX_SCORE, setTargetWinScore, currentActiveMap, p1Tank, p2Tank,
  localLoadout, p1Loadout, p2Loadout, testTargetPlayerId, currentFps,
  gameState, renderTanks, previousVisibleState, localInput,
  setCurrentActiveMap, setP1Loadout, setP2Loadout, setPreviousVisibleState,
  setupGameMap, restoreMapState, resetRoundSpawns, resetForRematch,
  registerUIHooks
} from './state.js?v=20261011_v17';
import {
  cycleActiveForTank, selectActiveForTank, useRepairKitForTank,
  surrenderMatch
} from './combat.js?v=20261011_v17';
import {
  startTestMode, switchTestActivePlayer, setTestTargetPlayer,
  clearTestPerksForPlayer, healAndResetCooldownsInTestMode
} from './sandbox.js?v=20261011_v17';

let pendingRoomId = '';

/**
 * Відображення стану готовності обох гравців до реваншу та обраного спорядження у вікні завершення матчу
 */
export function renderRematchUI() {
  if (typeof document === 'undefined') return;
  const rematch = (gameState && gameState.rematch) ? gameState.rematch : { p1Ready: false, p2Ready: false };
  const p1Pill = document.getElementById('rematchStatusP1');
  const p2Pill = document.getElementById('rematchStatusP2');
  const banner = document.getElementById('rematchPromptBanner');
  const btnRematch = document.getElementById('btnRematch');

  if (p1Pill) {
    p1Pill.textContent = rematch.p1Ready ? '✅ Гравець 1: ХОЧЕ РЕВАНШ!' : '⏳ Гравець 1: Роздумує...';
    p1Pill.classList.toggle('ready', Boolean(rematch.p1Ready));
  }
  if (p2Pill) {
    p2Pill.textContent = rematch.p2Ready ? '✅ Гравець 2: ХОЧЕ РЕВАНШ!' : '⏳ Гравець 2: Роздумує...';
    p2Pill.classList.toggle('ready', Boolean(rematch.p2Ready));
  }

  const myId = Network.myPlayerId || 1;
  const amIReady = myId === 1 ? Boolean(rematch.p1Ready) : Boolean(rematch.p2Ready);
  const isEnemyReady = myId === 1 ? Boolean(rematch.p2Ready) : Boolean(rematch.p1Ready);

  if (banner) {
    if (isEnemyReady && !amIReady) {
      banner.textContent = `🔥 Гравець ${myId === 1 ? 2 : 1} хоче реванш! Налаштуйте танк/карту та натисніть «Реванш»!`;
      banner.style.color = '#2ecc71';
    } else if (amIReady && !isEnemyReady) {
      banner.textContent = '⏳ Ви готові до реваншу! Очікуємо рішення суперника...';
      banner.style.color = '#f1c40f';
    } else if (amIReady && isEnemyReady) {
      banner.textContent = '⚔️ Обидва гравці готові! Запускаємо новий матч...';
      banner.style.color = '#2ecc71';
    } else {
      banner.textContent = 'Оберіть карту, кількість перемог або змініть корпус/дуло та натисніть «Реванш»!';
      banner.style.color = '#f1c40f';
    }
  }

  if (btnRematch) {
    if (amIReady) {
      btnRematch.textContent = '✅ ВИ ГОТОВІ (ОЧІКУЄМО СУПЕРНИКА...)';
      btnRematch.classList.add('ready-waiting');
    } else if (isEnemyReady) {
      btnRematch.textContent = '⚔️ ПРИЙНЯТИ РЕВАНШ (ГРАТИ ЗНОВУ)';
      btnRematch.classList.remove('ready-waiting');
    } else {
      btnRematch.textContent = '🔄 ХОЧУ РЕВАНШ (ГРАТИ ЗНОВУ)';
      btnRematch.classList.remove('ready-waiting');
    }
  }
}

/**
 * Запит на реванш від гравця (1 або 2):
 * кнопка та вікно реваншу НЕ зникають, поки обидва гравці не підтвердять готовність!
 */
export function requestRematch(playerId = Network.myPlayerId) {
  if (!gameState) return false;
  if (!gameState.rematch) {
    gameState.rematch = { p1Ready: false, p2Ready: false };
  }

  // Зчитуємо обрані під час реваншу корпус, дуло, карту та кількість перемог з селектів UI
  if (playerId === Network.myPlayerId && typeof document !== 'undefined') {
    const remHull = document.getElementById('selectRematchHull');
    const remTurret = document.getElementById('selectRematchTurret');
    const remMap = document.getElementById('selectRematchMap');
    const remWinScore = document.getElementById('selectRematchWinScore');

    if (remHull && remHull.value && HULL_TYPES[remHull.value]) {
      localLoadout.hull = remHull.value;
    }
    if (remTurret && remTurret.value && TURRET_TYPES[remTurret.value]) {
      localLoadout.turret = remTurret.value;
    }
    if (remMap && remMap.value) {
      const chosenMap = MapStorage.getMapById(remMap.value);
      if (chosenMap) setCurrentActiveMap(chosenMap);
    }
    if (remWinScore && remWinScore.value) {
      setTargetWinScore(Number(remWinScore.value));
    }
  }

  if (playerId === 1) {
    setP1Loadout(localLoadout);
    gameState.rematch.p1Ready = true;
  } else {
    setP2Loadout(localLoadout);
    gameState.rematch.p2Ready = true;
  }

  if (!Network.connectionActive) {
    resetForRematch();
    return true;
  }

  if (gameState.rematch.p1Ready && gameState.rematch.p2Ready) {
    if (Network.isHost) {
      resetForRematch();
      Network.sendMap(currentActiveMap);
      Network.sendLoadout(localLoadout);
      Network.sendRematch({
        action: 'start',
        p1Ready: true,
        p2Ready: true,
        targetScore: MAX_SCORE,
        loadout: { ...localLoadout },
        map: currentActiveMap
      });
      showToast('⚔️ Обидва гравці готові! Реванш розпочато!');
    } else {
      Network.sendLoadout(localLoadout);
      Network.sendRematch({
        action: 'ready',
        playerId: 2,
        p2Ready: true,
        targetScore: MAX_SCORE,
        loadout: { ...localLoadout },
        map: currentActiveMap
      });
      renderRematchUI();
    }
    return true;
  }

  Network.sendLoadout(localLoadout);
  Network.sendRematch({
    action: 'ready',
    playerId,
    p1Ready: gameState.rematch.p1Ready,
    p2Ready: gameState.rematch.p2Ready,
    targetScore: MAX_SCORE,
    loadout: { ...localLoadout },
    map: currentActiveMap
  });

  renderRematchUI();
  updateHUD();
  return false;
}

/**
 * Автоматична генерація довідника "Механіки гри" (у головному меню та у вкладці під полем бою).
 * Підтримує згортання/розгортання головних розділів ТА окремі підсписки для кожної рідкості здібностей!
 */
export function renderMechanicsCatalog() {
  if (typeof document === 'undefined') return;
  syncTileRegistry();

  const containers = [
    document.getElementById('mechanicsCatalogContainer'),
    document.getElementById('inGameMechanicsCatalog')
  ].filter(Boolean);

  if (containers.length === 0) return;

  const tilesList = Object.values(TILE_TYPES).filter(t => t && t.id !== 0);
  const perksList = Object.values(PERK_TYPES);
  const hullsList = Object.values(HULL_TYPES);
  const turretsList = Object.values(TURRET_TYPES);

  const applyUnclippedBlockStyle = (el) => {
    if (!el || !el.style) return;
    el.style.display = 'block';
    el.style.overflow = 'visible';
    el.style.height = 'auto';
    el.style.maxHeight = 'none';
    el.style.flexShrink = '0';
  };

  containers.forEach(container => {
    container.innerHTML = '';
    applyUnclippedBlockStyle(container);

    // 1. СЕКЦІЯ (ЗГОРТАЄТЬСЯ): БЛОКИ ТА ЕЛЕМЕНТИ КАРТИ (автоматично з TILE_TYPES)
    const blocksSec = document.createElement('details');
    blocksSec.className = 'mechanics-details mechanics-section';
    blocksSec.open = true;
    applyUnclippedBlockStyle(blocksSec);

    const blocksSummary = document.createElement('summary');
    blocksSummary.className = 'mechanics-details-summary mechanics-section-title';
    blocksSummary.innerHTML = `
      <span>🧱 БЛОКИ ТА ЕЛЕМЕНТИ КАРТИ (${tilesList.length})</span>
      <span class="mechanics-details-arrow">▼</span>
    `;
    blocksSec.appendChild(blocksSummary);

    const blocksBody = document.createElement('div');
    blocksBody.className = 'mechanics-details-body';
    applyUnclippedBlockStyle(blocksBody);
    const blocksGrid = document.createElement('div');
    blocksGrid.className = 'mechanics-grid';

    tilesList.forEach(tile => {
      const card = document.createElement('div');
      card.className = 'mechanics-item-card';
      card.dataset.tileId = String(tile.id);

      const previewCanvas = document.createElement('canvas');
      previewCanvas.className = 'mechanics-tile-preview';
      previewCanvas.width = 36;
      previewCanvas.height = 36;
      const pCtx = previewCanvas.getContext ? previewCanvas.getContext('2d') : null;
      if (pCtx && typeof tile.draw === 'function') {
        pCtx.fillStyle = '#0e1117';
        pCtx.fillRect(0, 0, 36, 36);
        tile.draw(pCtx, 0, 0, 36, 0, tile.maxHp || 1);
      }

      const autoDesc = tile.description || (
        `${tile.blocksTank ? 'Блокує проїзд танків.' : 'Вільний проїзд для танків.'} ` +
        `${tile.blocksBullet ? (tile.destructible ? `Руйнується за ${tile.maxHp || 1} постр.` : 'Непробивний для куль.') : 'Прострілюється снарядами.'}`
      );

      const tags = [];
      if (tile.destructible) {
        tags.push(`💥 Міцність: ${tile.maxHp || 1} постр.`);
      } else if (tile.blocksBullet) {
        tags.push('🛡️ Непробивний');
      }
      tags.push(tile.blocksTank ? '🚧 Непрохідний' : '🚗 Прохідний');
      tags.push(tile.blocksBullet ? '🛑 Зупиняє кулі' : '⚡ Прострілюється');
      if (tile.slowFactor && tile.slowFactor < 1) {
        tags.push(`🐌 Сповільнення: ${Math.round((1 - tile.slowFactor) * 100)}%`);
      }
      if (tile.isOverlay) {
        tags.push('🌿 Стелс-маскування');
      }
      if (tile.isLowBush) {
        tags.push('🌾 Закриває ваш огляд');
      }
      if (tile.isIce) {
        tags.push('🧊 Інерція (рівень землі)');
      }

      const info = document.createElement('div');
      info.className = 'mechanics-item-info';
      info.innerHTML = `
        <div class="mechanics-item-title">${tile.name}</div>
        <div class="mechanics-item-desc">${autoDesc}</div>
        <div class="mechanics-item-tags">
          ${tags.map(t => `<span class="mechanics-tag">${t}</span>`).join('')}
        </div>
      `;

      card.appendChild(previewCanvas);
      card.appendChild(info);
      blocksGrid.appendChild(card);
    });

    blocksBody.appendChild(blocksGrid);
    blocksSec.appendChild(blocksBody);
    container.appendChild(blocksSec);

    // 2. СЕКЦІЯ (ЗГОРТАЄТЬСЯ): ЗДІБНОСТІ ПІСЛЯ РАУНДУ З ОКРЕМИМИ ПІДСПИСКАМИ ДЛЯ КОЖНОЇ РІДКОСТІ
    const perksSec = document.createElement('details');
    perksSec.className = 'mechanics-details mechanics-section';
    perksSec.open = true;
    applyUnclippedBlockStyle(perksSec);

    const perksSummary = document.createElement('summary');
    perksSummary.className = 'mechanics-details-summary mechanics-section-title';
    perksSummary.innerHTML = `
      <span>✨ ЗДІБНОСТІ ПІСЛЯ РАУНДУ (${perksList.length})</span>
      <span class="mechanics-details-arrow">▼</span>
    `;
    perksSec.appendChild(perksSummary);

    const perksBody = document.createElement('div');
    perksBody.className = 'mechanics-details-body';
    applyUnclippedBlockStyle(perksBody);

    const rarityOrder = ['common', 'rare', 'legendary', 'divine'];
    const allRarityKeys = [
      ...rarityOrder.filter(k => PERK_RARITIES[k]),
      ...Object.keys(PERK_RARITIES).filter(k => !rarityOrder.includes(k))
    ];

    allRarityKeys.forEach(rarityKey => {
      const rarity = PERK_RARITIES[rarityKey];
      const rarityPerks = perksList.filter(p => (p.rarity || 'common') === rarityKey);
      if (rarityPerks.length === 0) return;

      const raritySubDetails = document.createElement('details');
      raritySubDetails.className = `mechanics-rarity-details rarity-group-${rarityKey}`;
      raritySubDetails.dataset.rarityGroup = rarityKey;
      raritySubDetails.open = true;
      applyUnclippedBlockStyle(raritySubDetails);

      const raritySubSummary = document.createElement('summary');
      raritySubSummary.className = 'mechanics-rarity-summary';
      raritySubSummary.innerHTML = `
        <span style="color: ${rarity.textColor}; font-weight: bold;">
          <span class="perk-rarity-badge" style="border:1px solid ${rarity.borderColor}; color:${rarity.textColor}; background:${rarity.badgeBg}; margin-right: 6px;">${rarity.name}</span>
          (${rarityPerks.length} здібн. • Базовий шанс: ${rarity.weight}%)
        </span>
        <span class="mechanics-details-arrow" style="color: ${rarity.borderColor};">▼</span>
      `;
      raritySubDetails.appendChild(raritySubSummary);

      const raritySubBody = document.createElement('div');
      raritySubBody.className = 'mechanics-rarity-body';
      applyUnclippedBlockStyle(raritySubBody);
      const perksGrid = document.createElement('div');
      perksGrid.className = 'mechanics-grid';

      rarityPerks.forEach(perk => {
        const card = document.createElement('div');
        card.className = `mechanics-item-card perk-rarity-${perk.rarity || 'common'}`;
        card.dataset.perkId = perk.id;

        const stackLabel = perk.stackable
          ? (perk.maxStacks ? `🔄 Дублюється (макс. ${perk.maxStacks})` : '🔄 Може дублюватися')
          : '⭐ Унікальна (1 раз)';

        card.innerHTML = `
          <div class="mechanics-perk-icon">${perk.icon || '✨'}</div>
          <div class="mechanics-item-info">
            <div class="mechanics-item-title">
              <span>${perk.title}</span>
              <span class="perk-rarity-badge" style="border:1px solid ${rarity.borderColor}; color:${rarity.textColor}; background:${rarity.badgeBg};">${rarity.name}</span>
            </div>
            <div class="mechanics-item-desc">${perk.description || ''}</div>
            <div class="mechanics-item-tags">
              <span class="mechanics-tag">${stackLabel}</span>
            </div>
          </div>
        `;
        perksGrid.appendChild(card);
      });

      raritySubBody.appendChild(perksGrid);
      raritySubDetails.appendChild(raritySubBody);
      perksBody.appendChild(raritySubDetails);
    });

    perksSec.appendChild(perksBody);
    container.appendChild(perksSec);

    // 3. СЕКЦІЯ (ЗГОРТАЄТЬСЯ): КОРПУСИ ТА ГАРМАТИ (автоматично з HULL_TYPES та TURRET_TYPES)
    const loadoutSec = document.createElement('details');
    loadoutSec.className = 'mechanics-details mechanics-section';
    loadoutSec.open = true;
    applyUnclippedBlockStyle(loadoutSec);

    const loadoutSummary = document.createElement('summary');
    loadoutSummary.className = 'mechanics-details-summary mechanics-section-title';
    loadoutSummary.innerHTML = `
      <span>🛡️ КОРПУСИ ТА 💥 ГАРМАТИ (${hullsList.length + turretsList.length})</span>
      <span class="mechanics-details-arrow">▼</span>
    `;
    loadoutSec.appendChild(loadoutSummary);

    const loadoutBody = document.createElement('div');
    loadoutBody.className = 'mechanics-details-body';
    applyUnclippedBlockStyle(loadoutBody);
    const loadoutGrid = document.createElement('div');
    loadoutGrid.className = 'mechanics-grid';

    hullsList.forEach(h => {
      const card = document.createElement('div');
      card.className = 'mechanics-item-card';
      card.innerHTML = `
        <div class="mechanics-perk-icon">🛡️</div>
        <div class="mechanics-item-info">
          <div class="mechanics-item-title">${h.name}</div>
          <div class="mechanics-item-desc">${h.description}</div>
          <div class="mechanics-item-tags">
            <span class="mechanics-tag">❤️ ${h.maxHp} HP</span>
            <span class="mechanics-tag">🛡️ Броня: ${Math.round((h.armor || 0.2) * 100)}%</span>
            <span class="mechanics-tag">⚡ Швидкість: ${h.speed}</span>
          </div>
        </div>
      `;
      loadoutGrid.appendChild(card);
    });

    turretsList.forEach(t => {
      const card = document.createElement('div');
      card.className = 'mechanics-item-card';
      const extraTags = [];
      if (t.bulletPierce > 0) extraTags.push(`<span class="mechanics-tag">⚡ Пробиття куль: ${t.bulletPierce}</span>`);
      if (t.ricochet > 0) extraTags.push(`<span class="mechanics-tag">🪃 Рикошет: ${t.ricochet}</span>`);
      card.innerHTML = `
        <div class="mechanics-perk-icon">💥</div>
        <div class="mechanics-item-info">
          <div class="mechanics-item-title">${t.name}</div>
          <div class="mechanics-item-desc">${t.description}</div>
          <div class="mechanics-item-tags">
            <span class="mechanics-tag">⚔️ Шкода: ${t.minDmg}-${t.maxDmg}</span>
            <span class="mechanics-tag">🔋 Обойма: ${t.clipSize} (${(t.clipReloadTime / 1000)}с)</span>
            <span class="mechanics-tag">👁️ Огляд: ${t.fov}°</span>
            ${extraTags.join('')}
          </div>
        </div>
      `;
      loadoutGrid.appendChild(card);
    });

    loadoutBody.appendChild(loadoutGrid);
    loadoutSec.appendChild(loadoutBody);
    container.appendChild(loadoutSec);
  });
}

/**
 * Відображення FPS та Ping у лівому нижньому куті браузера (поза ігровим полем)
 */
export function updateTelemetryUI(fps = currentFps, ping = Network.pingMs) {
  if (typeof document === 'undefined') return;
  const fpsEl = document.getElementById('telemetryFps');
  const pingEl = document.getElementById('telemetryPing');

  if (fpsEl) {
    const val = Math.max(1, Math.round(Number(fps) || 60));
    fpsEl.textContent = `FPS: ${val}`;
    fpsEl.style.color = val >= 50 ? '#2ecc71' : (val >= 30 ? '#f1c40f' : '#ff4757');
  }

  if (pingEl) {
    if (Network.connectionActive) {
      const ms = Math.max(0, Math.round(Number(ping) || 0));
      pingEl.textContent = `PING: ${ms} ms`;
      pingEl.style.color = ms < 60 ? '#00e5ff' : (ms < 130 ? '#f1c40f' : '#ff4757');
    } else if (gameState && gameState.isTestMode) {
      pingEl.textContent = 'PING: 0 ms';
      pingEl.style.color = '#2ecc71';
    } else {
      pingEl.textContent = 'PING: — ms';
      pingEl.style.color = '#00e5ff';
    }
  }
}

/**
 * Рендеринг бічних панелей здібностей навколо ігрового поля:
 * - Зліва від поля (#passivePerksList, червоні лінії): наявні пасивні здібності (ЛИШЕ значок, назва та кількість — без опису!)
 * - Справа від поля (#activePerksList, зелені лінії): наявні активні здібності з індикацією обраної на ПРОБІЛ (Q/E), кулдауном та залишком
 */
export function renderPerksSidebars() {
  if (typeof document === 'undefined') return;
  const passiveList = document.getElementById('passivePerksList');
  const activeList = document.getElementById('activePerksList');
  const activeSwitchBanner = document.getElementById('activeSwitchHintBanner');

  const myId = Network.myPlayerId || 1;
  const myTank = myId === 1 ? p1Tank : p2Tank;

  // 1. Ліва панель: ПАСИВНІ ЗДІБНОСТІ (лише значок, назва та кількість, більший шрифт, без опису)
  if (passiveList) {
    passiveList.innerHTML = '';
    const owned = (myTank && Array.isArray(myTank.acquiredPerks)) ? myTank.acquiredPerks : [];
    const passiveStacks = {};
    const passiveOrder = [];

    owned.forEach(perkId => {
      const def = PERK_TYPES[perkId];
      if (!def || def.isActiveAbility) return;
      if (!passiveStacks[perkId]) {
        passiveStacks[perkId] = 0;
        passiveOrder.push(perkId);
      }
      passiveStacks[perkId]++;
    });

    const hullCfg = (myTank && myTank.hullType) ? HULL_TYPES[myTank.hullType] : null;
    const hasHullPassive = Boolean((myTank && myTank.unpierceableArmor) || (hullCfg && hullCfg.unpierceableArmor));
    const hasPhantomComeback = Boolean(
      myTank && myTank.hullType === 'phantom' &&
      typeof myTank.isPhantomComebackActive === 'function' &&
      myTank.isPhantomComebackActive(gameState)
    );

    if (hasHullPassive) {
      const hullPill = document.createElement('div');
      hullPill.className = 'sidebar-perk-pill passive-pill hull-passive-pill perk-rarity-divine';
      hullPill.dataset.perkId = 'hull_unpierceable_armor';
      hullPill.innerHTML = `
        <div class="sidebar-perk-icon">${(hullCfg && hullCfg.passiveIcon) || '🛡️'}</div>
        <div class="sidebar-perk-info">
          <div class="sidebar-perk-title-row">
            <span class="sidebar-perk-title">${(hullCfg && hullCfg.passiveTitle) || 'Непробивна броня'}</span>
            <span class="sidebar-perk-stack">КОРПУС</span>
          </div>
        </div>
      `;
      passiveList.appendChild(hullPill);
    }

    if (hasPhantomComeback) {
      const comebackPill = document.createElement('div');
      comebackPill.className = 'sidebar-perk-pill passive-pill hull-passive-pill perk-rarity-legendary';
      comebackPill.dataset.perkId = 'hull_phantom_comeback';
      comebackPill.innerHTML = `
        <div class="sidebar-perk-icon">${(hullCfg && hullCfg.comebackPassiveIcon) || '⚡'}</div>
        <div class="sidebar-perk-info">
          <div class="sidebar-perk-title-row">
            <span class="sidebar-perk-title">${(hullCfg && hullCfg.comebackPassiveTitle) || 'Імпульсний щит (0.25с)'}</span>
            <span class="sidebar-perk-stack">x1</span>
          </div>
        </div>
      `;
      passiveList.appendChild(comebackPill);
    }

    if (passiveOrder.length === 0 && !hasHullPassive && !hasPhantomComeback) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-empty-hint';
      empty.textContent = 'Немає пасивних здібностей';
      passiveList.appendChild(empty);
    } else {
      passiveOrder.forEach(perkId => {
        const def = PERK_TYPES[perkId];
        const stacks = passiveStacks[perkId];
        const pill = document.createElement('div');
        pill.className = `sidebar-perk-pill passive-pill perk-rarity-${def.rarity || 'common'}`;
        pill.dataset.perkId = perkId;
        pill.dataset.stacks = String(stacks);

        let badgeText = `x${stacks}`;
        if (perkId === 'time_scaling_max_dmg' && myTank && (myTank.roundTimeDmgBonus || 0) > 0) {
          badgeText = `+${myTank.roundTimeDmgBonus}⚔️`;
        } else if (def.maxStacks && stacks === 1) {
          badgeText = `1/${def.maxStacks}`;
        }
        const stackBadgeHtml = `<span class="sidebar-perk-stack">${badgeText}</span>`;

        pill.innerHTML = `
          <div class="sidebar-perk-icon">${def.icon || '✨'}</div>
          <div class="sidebar-perk-info">
            <div class="sidebar-perk-title-row">
              <span class="sidebar-perk-title">${def.title}</span>
              ${stackBadgeHtml}
            </div>
          </div>
        `;
        passiveList.appendChild(pill);
      });
    }
  }

  // 2. Права панель: АКТИВНІ ЗДІБНОСТІ (більші картки, а обрана на ПРОБІЛ — значно більша та яскравіша)
  if (activeList) {
    activeList.innerHTML = '';
    const spaceActives = (myTank && typeof myTank.getAvailableActives === 'function')
      ? myTank.getAvailableActives()
      : [];
    const selectedActive = (myTank && myTank.selectedActive && spaceActives.includes(myTank.selectedActive))
      ? myTank.selectedActive
      : (spaceActives[0] || 'mines');

    const getSpaceActiveTitle = (key) => {
      if (key === 'artillery') return '🚀 Артилерія 3×3';
      if (key === 'smoke') return '💨 Димова завіса';
      return '💣 Міни';
    };

    if (activeSwitchBanner) {
      if (spaceActives.length > 1) {
        activeSwitchBanner.classList.remove('hidden');
        const selLabel = getSpaceActiveTitle(selectedActive);
        activeSwitchBanner.textContent = `🔄 [Q / E] ПРОБІЛ: ${selLabel}`;
        activeSwitchBanner.onclick = () => {
          if (myTank) cycleActiveForTank(myTank, 1);
        };
      } else if (spaceActives.length === 1) {
        activeSwitchBanner.classList.remove('hidden');
        const selLabel = getSpaceActiveTitle(selectedActive);
        activeSwitchBanner.textContent = `⚡ На ПРОБІЛ: ${selLabel}`;
        activeSwitchBanner.onclick = null;
      } else {
        activeSwitchBanner.classList.add('hidden');
        activeSwitchBanner.onclick = null;
      }
    }

    const activeEntries = [];
    if (myTank && myTank.maxMines > 0) {
      const def = PERK_TYPES.mines_plus_3;
      const hasLeft = myTank.minesLeft > 0;
      activeEntries.push({
        perkId: 'mines_plus_3',
        activeKey: 'mines',
        isSpace: true,
        def,
        keybindText: '[ПРОБІЛ]',
        statusText: hasLeft
          ? `Залишок: ${myTank.minesLeft} / ${myTank.maxMines}`
          : `Вичерпано: 0 / ${myTank.maxMines}`,
        statusClass: hasLeft ? 'ready' : 'cooldown'
      });
    }

    if (myTank && myTank.hasSmokeScreen) {
      const def = PERK_TYPES.smoke_screen;
      const onCd = (myTank.smokeCooldownTimer || 0) > 0;
      const secLeft = onCd ? Math.ceil(myTank.smokeCooldownTimer / 60) : 0;
      activeEntries.push({
        perkId: 'smoke_screen',
        activeKey: 'smoke',
        isSpace: true,
        def,
        keybindText: '[ПРОБІЛ]',
        statusText: onCd ? `Перезарядка: ${secLeft}с` : 'ГОТОВО (5с дим)',
        statusClass: onCd ? 'cooldown' : 'ready'
      });
    }

    if (myTank && myTank.hasArtillery) {
      const def = PERK_TYPES.artillery_strike;
      const onCd = (myTank.artilleryCooldownTimer || 0) > 0;
      const secLeft = onCd ? Math.ceil(myTank.artilleryCooldownTimer / 60) : 0;
      const isTargeting = myTank.targetingMode === 'artillery';
      activeEntries.push({
        perkId: 'artillery_strike',
        activeKey: 'artillery',
        isSpace: true,
        def,
        keybindText: '[ПРОБІЛ ➔ ЛКМ]',
        statusText: isTargeting
          ? '🎯 ОБЕРІТЬ БЛОК [ЛКМ]'
          : (onCd ? `Перезарядка: ${secLeft}с` : 'ГОТОВО (Зона 3×3)'),
        statusClass: onCd ? 'cooldown' : 'ready'
      });
    }

    if (myTank && myTank.maxRepairKits > 0) {
      const def = PERK_TYPES.repair_kit_plus_1;
      const hasLeft = myTank.repairKitsLeft > 0;
      activeEntries.push({
        perkId: 'repair_kit_plus_1',
        activeKey: 'repair',
        isSpace: false,
        def,
        keybindText: '[Клавіша H]',
        statusText: hasLeft
          ? `Залишок: ${myTank.repairKitsLeft} / ${myTank.maxRepairKits}`
          : `Вичерпано: 0 / ${myTank.maxRepairKits}`,
        statusClass: hasLeft ? 'ready' : 'cooldown'
      });
    }

    if (activeEntries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-empty-hint';
      empty.textContent = 'Немає активних здібностей';
      activeList.appendChild(empty);
    } else {
      activeEntries.forEach(entry => {
        const { def, activeKey, isSpace, keybindText, statusText, statusClass } = entry;
        const isSelectedOnSpace = isSpace && selectedActive === activeKey;
        const pill = document.createElement('div');
        pill.className = `sidebar-perk-pill active-pill active-ability-card perk-rarity-${(def && def.rarity) || 'common'}${isSelectedOnSpace ? ' selected-active active-selected' : ''}`;
        pill.dataset.perkId = entry.perkId;
        pill.dataset.activeKey = activeKey;

        const selectedBadgeHtml = isSelectedOnSpace
          ? '<span class="active-selected-badge sidebar-active-selected-badge">🟢 НА ПРОБІЛ</span>'
          : (isSpace && spaceActives.length > 1 ? '<span class="sidebar-perk-stack">[Q/E]</span>' : '');

        pill.innerHTML = `
          <div class="sidebar-perk-icon">${(def && def.icon) || '⚡'}</div>
          <div class="sidebar-perk-info">
            <div class="sidebar-perk-title-row">
              <span class="sidebar-perk-title">${(def && def.title) || activeKey}</span>
              ${selectedBadgeHtml}
            </div>
            <div class="sidebar-active-meta sidebar-active-status-row">
              <span class="sidebar-active-key sidebar-active-keybind">${keybindText}</span>
              <span class="sidebar-active-cooldown ${statusClass}">${statusText}</span>
            </div>
          </div>
        `;

        if (isSpace) {
          pill.style.cursor = 'pointer';
          pill.onclick = () => {
            if (myTank) selectActiveForTank(myTank, activeKey);
          };
        } else if (activeKey === 'repair') {
          pill.style.cursor = 'pointer';
          pill.onclick = () => {
            if (myTank && myTank.canUseRepairKit()) {
              useRepairKitForTank(myTank);
            }
          };
        }

        activeList.appendChild(pill);
      });
    }
  }
}

export function updateHUD() {
  const s1 = document.getElementById('scoreP1');
  const s2 = document.getElementById('scoreP2');
  if (s1) s1.textContent = gameState.score1;
  if (s2) s2.textContent = gameState.score2;

  const targetScore = gameState.targetScore || MAX_SCORE || 5;
  const hudTargetScoreText = document.getElementById('hudTargetScoreText');
  if (hudTargetScoreText) {
    hudTargetScoreText.textContent = `ДО ${targetScore} ПЕРЕМОГ`;
  }

  // Відображення кнопки «Здатись» під час активного матчу (прихована в меню, полігоні та після завершення матчу)
  const btnSurrender = document.getElementById('btnSurrender');
  const gameScreenEl = document.getElementById('gameScreen');
  if (btnSurrender) {
    const isGameVisible = Boolean(gameScreenEl && !gameScreenEl.classList.contains('hidden'));
    if (isGameVisible && !gameState.gameOver && !(gameState && gameState.isTestMode)) {
      btnSurrender.classList.remove('hidden');
    } else {
      btnSurrender.classList.add('hidden');
    }
  }

  // Оновлення піпів перемоги відповідно до обраного ліміту (від 3 до 15)
  const syncPipsContainer = (container, currentScore, activeClass) => {
    if (!container || !container.children) return;
    while (container.children.length < targetScore && typeof document.createElement === 'function' && typeof container.appendChild === 'function') {
      const pip = document.createElement('span');
      pip.className = 'pip';
      container.appendChild(pip);
    }
    while (container.children.length > targetScore && typeof container.removeChild === 'function' && container.lastChild) {
      container.removeChild(container.lastChild);
    }
    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i];
      if (!child) continue;
      if (i < targetScore) {
        child.style.display = '';
        if (i < currentScore) child.classList.add(activeClass);
        else child.classList.remove(activeClass);
      } else {
        child.style.display = 'none';
      }
    }
  };

  syncPipsContainer(document.getElementById('pipsP1'), gameState.score1, 'active-p1');
  syncPipsContainer(document.getElementById('pipsP2'), gameState.score2, 'active-p2');

  // Оновлення власної смужки здоров'я, показника броні, куль у касеті та характеристик танка під HP баром
  const myId = Network.myPlayerId;
  const myTank = myId === 1 ? p1Tank : p2Tank;
  const hudHpText = document.getElementById('hudHpText');
  const hudArmorBadge = document.getElementById('hudArmorBadge');
  const hudAmmoBadge = document.getElementById('hudAmmoBadge');
  const hudStatDamage = document.getElementById('hudStatDamage');
  const hudStatFireRate = document.getElementById('hudStatFireRate');
  const hudStatSpeed = document.getElementById('hudStatSpeed');
  const hudStatBulletSpeed = document.getElementById('hudStatBulletSpeed');
  const hudStatFov = document.getElementById('hudStatFov');
  const hudMinesBadge = document.getElementById('hudMinesBadge');
  const hudSmokeBadge = document.getElementById('hudSmokeBadge');
  const hudArtilleryBadge = document.getElementById('hudArtilleryBadge');
  const hudActiveSwitchHint = document.getElementById('hudActiveSwitchHint');
  const hudRepairBadge = document.getElementById('hudRepairBadge');
  const hudRebirthBadge = document.getElementById('hudRebirthBadge');
  const hudHpFill = document.getElementById('hudHpFill');
  const hudBadge = document.getElementById('hudPlayerRoleBadge');

  if (hudBadge) {
    hudBadge.textContent = myId === 1 ? '🛡️ ВАШ ТАНК (ГРАВЕЦЬ 1)' : '🛡️ ВАШ ТАНК (ГРАВЕЦЬ 2)';
    hudBadge.style.color = myId === 1 ? '#f39c12' : '#2ecc71';
  }

  if (myTank && hudHpText && hudHpFill) {
    const curHp = Math.max(0, Math.round(myTank.hp));
    const maxHp = myTank.maxHp || (HULL_TYPES[myTank.hullType] && HULL_TYPES[myTank.hullType].maxHp) || 100;
    const hullArmor = (HULL_TYPES[myTank.hullType] && typeof HULL_TYPES[myTank.hullType].armor === 'number')
      ? HULL_TYPES[myTank.hullType].armor
      : (myTank.hullType === 'heavy' ? 0.30 : (myTank.hullType === 'light' ? 0.10 : 0.20));
    const armorVal = typeof myTank.armor === 'number' ? myTank.armor : hullArmor;
    const armorPct = Math.round(armorVal * 100);

    hudHpText.textContent = `HP: ${curHp} / ${maxHp}`;
    if (hudArmorBadge) {
      hudArmorBadge.textContent = `🛡️ Броня: ${armorPct}%`;
    }

    // Відображення кількості куль над HP баром
    if (hudAmmoBadge) {
      const curAmmo = Math.max(0, Number(myTank.ammo) || 0);
      const maxAmmo = Math.max(1, Number(myTank.clipSize) || 10);
      if (myTank.isReloadingClip) {
        const secLeft = Math.max(0.1, ((myTank.clipReloadTimer || 0) / 60)).toFixed(1);
        hudAmmoBadge.textContent = `🔄 Перезарядка: ${secLeft}с (${curAmmo}/${maxAmmo})`;
        hudAmmoBadge.classList.add('reloading');
      } else {
        hudAmmoBadge.textContent = `🔫 Кулі: ${curAmmo} / ${maxAmmo}`;
        hudAmmoBadge.classList.remove('reloading');
      }
    }

    // Відображення характеристик під HP баром (шкода, скорострільність / інтервал, швидкість танка, швидкість снаряду, кут огляду)
    const effMinDmg = typeof myTank.minDmg === 'number'
      ? Math.round(myTank.minDmg)
      : Math.round((typeof myTank.minDamage === 'number' ? myTank.minDamage : 15) + (Number(myTank.damageBonus) || 0));
    const effMaxDmg = typeof myTank.maxDmg === 'number'
      ? Math.round(myTank.maxDmg)
      : Math.round((typeof myTank.maxDamage === 'number' ? myTank.maxDamage : 20) + (Number(myTank.damageBonus) || 0));

    if (hudStatDamage) {
      hudStatDamage.textContent = `⚔️ Шкода: ${effMinDmg === effMaxDmg ? effMinDmg : `${effMinDmg}-${effMaxDmg}`}`;
    }
    if (hudStatFireRate) {
      const reloadMs = Math.max(80, Number(myTank.reloadTime) || 650);
      const shotsPerSec = (typeof myTank.fireRate === 'number' && myTank.fireRate > 0)
        ? myTank.fireRate
        : (1000 / reloadMs);
      const intervalSec = reloadMs / 1000;
      const spsStr = Number(shotsPerSec.toFixed(2));
      const intStr = Number(intervalSec.toFixed(2));
      hudStatFireRate.textContent = `🔥 Скоростр.: ${spsStr}/с (${intStr}с)`;
    }
    if (hudStatSpeed) {
      const spd = Number(typeof myTank.speed === 'number' ? myTank.speed : 2).toFixed(1).replace(/\.0$/, '');
      hudStatSpeed.textContent = `⚡ Швидкість: ${spd}`;
    }
    if (hudStatBulletSpeed) {
      const bSpd = Number(typeof myTank.bulletSpeed === 'number' ? myTank.bulletSpeed : 6.5).toFixed(1).replace(/\.0$/, '');
      hudStatBulletSpeed.textContent = `🚀 Шв. снаряду: ${bSpd}`;
    }
    if (hudStatFov) {
      const fovDeg = Math.round(Number(myTank.fov || myTank.fovDeg) || 90);
      hudStatFov.textContent = `👁️ Огляд: ${fovDeg}°`;
    }

    const actives = typeof myTank.getAvailableActives === 'function' ? myTank.getAvailableActives() : [];
    const hasMultipleActives = actives.length > 1;
    const selectedActive = (myTank.selectedActive && actives.includes(myTank.selectedActive))
      ? myTank.selectedActive
      : (actives[0] || 'mines');

    if (hudMinesBadge) {
      if (myTank.maxMines > 0) {
        hudMinesBadge.classList.remove('hidden');
        hudMinesBadge.textContent = `💣 Міни: ${myTank.minesLeft} / ${myTank.maxMines}`;
        if (selectedActive === 'mines') hudMinesBadge.classList.add('active-ability-selected');
        else hudMinesBadge.classList.remove('active-ability-selected');
      } else {
        hudMinesBadge.classList.add('hidden');
        hudMinesBadge.classList.remove('active-ability-selected');
      }
    }

    if (hudSmokeBadge) {
      if (myTank.hasSmokeScreen) {
        hudSmokeBadge.classList.remove('hidden');
        if (myTank.smokeCooldownTimer > 0) {
          const secLeft = Math.ceil(myTank.smokeCooldownTimer / 60);
          hudSmokeBadge.textContent = `💨 Дим: ${secLeft}с`;
        } else {
          hudSmokeBadge.textContent = '💨 Дим: ГОТОВО';
        }
        if (selectedActive === 'smoke') hudSmokeBadge.classList.add('active-ability-selected');
        else hudSmokeBadge.classList.remove('active-ability-selected');
      } else {
        hudSmokeBadge.classList.add('hidden');
        hudSmokeBadge.classList.remove('active-ability-selected');
      }
    }

    if (hudArtilleryBadge) {
      if (myTank.hasArtillery) {
        hudArtilleryBadge.classList.remove('hidden');
        if (myTank.targetingMode === 'artillery') {
          hudArtilleryBadge.textContent = '🚀 Арта: ЦІЛЬ [ЛКМ]';
        } else if (myTank.artilleryCooldownTimer > 0) {
          const secLeft = Math.ceil(myTank.artilleryCooldownTimer / 60);
          hudArtilleryBadge.textContent = `🚀 Арта: ${secLeft}с`;
        } else {
          hudArtilleryBadge.textContent = '🚀 Арта: ГОТОВО';
        }
        if (selectedActive === 'artillery') hudArtilleryBadge.classList.add('active-ability-selected');
        else hudArtilleryBadge.classList.remove('active-ability-selected');
      } else {
        hudArtilleryBadge.classList.add('hidden');
        hudArtilleryBadge.classList.remove('active-ability-selected');
      }
    }

    if (hudActiveSwitchHint) {
      if (hasMultipleActives) {
        hudActiveSwitchHint.classList.remove('hidden');
        const activeLabel = selectedActive === 'artillery'
          ? '🚀 Арта'
          : (selectedActive === 'smoke' ? '💨 Дим' : '💣 Міни');
        hudActiveSwitchHint.textContent = `[Q/E] Пробіл: ${activeLabel}`;
      } else {
        hudActiveSwitchHint.classList.add('hidden');
      }
    }

    if (hudRepairBadge) {
      if (myTank.maxRepairKits > 0) {
        hudRepairBadge.classList.remove('hidden');
        hudRepairBadge.textContent = `🔧 Рем: ${myTank.repairKitsLeft} / ${myTank.maxRepairKits} [H]`;
      } else {
        hudRepairBadge.classList.add('hidden');
      }
    }
    if (hudRebirthBadge) {
      if (myTank.maxRebirths > 0) {
        hudRebirthBadge.classList.remove('hidden');
        hudRebirthBadge.textContent = `🔥 Життя: +${myTank.rebirthsLeft}`;
      } else {
        hudRebirthBadge.classList.add('hidden');
      }
    }

    const pct = Math.max(0, Math.min(100, (curHp / maxHp) * 100));
    hudHpFill.style.width = `${pct}%`;

    hudHpFill.classList.remove('medium', 'critical');
    if (pct <= 30) {
      hudHpFill.classList.add('critical');
      hudHpText.style.color = '#e74c3c';
    } else if (pct <= 60) {
      hudHpFill.classList.add('medium');
      hudHpText.style.color = '#f39c12';
    } else {
      hudHpText.style.color = '#2ecc71';
    }
  }

  // Оновлення лівої (пасивні здібності) та правої (активні здібності) бічних панелей
  renderPerksSidebars();

  const stealthPill = document.getElementById('stealthStatusPill');
  if (stealthPill) {
    if ((Network.connectionActive || (gameState && gameState.isTestMode)) && !gameState.gameOver) {
      stealthPill.classList.remove('hidden');
      const isVisible = gameState.isEnemyVisible;

      if (isVisible) {
        stealthPill.textContent = '👁️ ВОРОГ ПОМІЧЕНИЙ';
        stealthPill.classList.add('spotted');
        stealthPill.style.background = '';
        stealthPill.style.borderColor = '';
        if (!previousVisibleState) {
          sound.playSpot();
          setPreviousVisibleState(true);
        }
      } else {
        stealthPill.textContent = '🔒 ВОРОГ В УКРИТТІ';
        stealthPill.classList.remove('spotted');
        stealthPill.style.background = '';
        stealthPill.style.borderColor = '';
        setPreviousVisibleState(false);
      }
    } else {
      stealthPill.classList.add('hidden');
    }
  }

  const overlay = document.getElementById('gameOverOverlay');
  if (overlay) {
    if (gameState.gameOver) {
      overlay.classList.remove('hidden');
      const winnerTitle = document.getElementById('winnerTitle');
      const winnerDesc = document.getElementById('winnerDesc');
      if (gameState.winner === Network.myPlayerId) {
        if (winnerTitle) {
          winnerTitle.textContent = '🏆 ПЕРЕМОГА!';
          winnerTitle.style.color = '#2ecc71';
        }
        if (winnerDesc) {
          winnerDesc.textContent = gameState.surrenderedBy
            ? 'Суперник здався! Ви здобули дострокову перемогу в матчі!'
            : `Ви здобули ${targetScore} перемог і розбили танк суперника!`;
        }
      } else {
        if (winnerTitle) {
          winnerTitle.textContent = '💥 ПОРАЗКА!';
          winnerTitle.style.color = '#e74c3c';
        }
        if (winnerDesc) {
          winnerDesc.textContent = gameState.surrenderedBy === Network.myPlayerId
            ? 'Ви здалися. Можете одразу взяти реванш!'
            : `Суперник першим набрав ${targetScore} перемог!`;
        }
      }

      // Синхронізуємо селектори карти, ліміту перемог та спорядження під час реваншу
      const remHull = document.getElementById('selectRematchHull');
      const remTurret = document.getElementById('selectRematchTurret');
      const remMap = document.getElementById('selectRematchMap');
      const remWinScore = document.getElementById('selectRematchWinScore');
      if (remHull && document.activeElement !== remHull && localLoadout.hull) {
        remHull.value = localLoadout.hull;
      }
      if (remTurret && document.activeElement !== remTurret && localLoadout.turret) {
        remTurret.value = localLoadout.turret;
      }
      if (remMap && document.activeElement !== remMap && currentActiveMap && currentActiveMap.id) {
        remMap.value = currentActiveMap.id;
      }
      if (remWinScore && document.activeElement !== remWinScore) {
        remWinScore.value = String(targetScore);
      }
      updateLoadoutStatsDesc();
      updateAllMapPreviews();
      renderRematchUI();
    } else {
      overlay.classList.add('hidden');
    }
  }
}

export function setConnectionStatus(status, text) {
  const pill = document.getElementById('connectionPill');
  if (!pill) return;
  pill.textContent = text;
  if (status === 'online') {
    pill.style.background = '#27ae60';
    pill.style.color = '#fff';
  } else if (status === 'waiting') {
    pill.style.background = '#d35400';
    pill.style.color = '#fff';
  } else {
    pill.style.background = '#7f8c8d';
    pill.style.color = '#fff';
  }
}

export function startActiveMatch(isHost, myPlayerId) {
  if (gameState) gameState.isTestMode = false;
  const testPanel = document.getElementById('testModePanel');
  if (testPanel) testPanel.classList.add('hidden');

  document.getElementById('lobbyScreen').classList.add('hidden');
  document.getElementById('editorScreen').classList.add('hidden');
  const mechScreen = document.getElementById('mechanicsScreen');
  if (mechScreen) mechScreen.classList.add('hidden');
  document.getElementById('gameScreen').classList.remove('hidden');
  document.getElementById('btnMenu').classList.remove('hidden');

  const isP1 = myPlayerId === 1;
  const selectH = document.getElementById(isP1 ? 'selectHull' : 'selectGuestHull');
  const selectT = document.getElementById(isP1 ? 'selectTurret' : 'selectGuestTurret');
  if (selectH && selectH.value) localLoadout.hull = selectH.value;
  if (selectT && selectT.value) localLoadout.turret = selectT.value;

  const remH = document.getElementById('selectRematchHull');
  const remT = document.getElementById('selectRematchTurret');
  if (remH) remH.value = localLoadout.hull;
  if (remT) remT.value = localLoadout.turret;

  if (isP1) {
    setP1Loadout({ ...localLoadout });
    if (p1Tank) p1Tank.applyLoadout(p1Loadout.hull, p1Loadout.turret);
  } else {
    setP2Loadout({ ...localLoadout });
    if (p2Tank) p2Tank.applyLoadout(p2Loadout.hull, p2Loadout.turret);
  }

  if (Network.connectionActive) {
    Network.sendLoadout(localLoadout);
  }

  const labelP1 = document.getElementById('labelP1');
  const labelP2 = document.getElementById('labelP2');
  if (myPlayerId === 1) {
    if (labelP1) labelP1.textContent = 'ТИ (ГРАВЕЦЬ 1)';
    if (labelP2) labelP2.textContent = 'СУПЕРНИК (ГРАВЕЦЬ 2)';
  } else {
    if (labelP1) labelP1.textContent = 'СУПЕРНИК (ГРАВЕЦЬ 1)';
    if (labelP2) labelP2.textContent = 'ТИ (ГРАВЕЦЬ 2)';
  }

  // Скидання та валідація кутів веж та вводу при старті бою
  const initialAngle = myPlayerId === 1 ? Math.PI / 2 : -Math.PI / 2;
  localInput.turretAngle = initialAngle;
  if (p1Tank && !Number.isFinite(p1Tank.turretAngle)) p1Tank.turretAngle = Math.PI / 2;
  if (p2Tank && !Number.isFinite(p2Tank.turretAngle)) p2Tank.turretAngle = -Math.PI / 2;
  if (!Number.isFinite(renderTanks.p1.turretAngle)) renderTanks.p1.turretAngle = Math.PI / 2;
  if (!Number.isFinite(renderTanks.p2.turretAngle)) renderTanks.p2.turretAngle = -Math.PI / 2;

  const canvas = document.getElementById('gameCanvas');
  if (canvas) {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  renderMechanicsCatalog();
  updateTelemetryUI();
  updateHUD();
}

/**
 * Повернення до головного меню (зі сторінки створення кімнати, підключення, полігону або гри)
 */
export function returnToMainMenu() {
  if (gameState) gameState.isTestMode = false;
  if (typeof Network.disconnect === 'function') {
    Network.disconnect();
  }
  const lobbyScreen = document.getElementById('lobbyScreen');
  const initView = document.getElementById('lobbyInitialView');
  const hostView = document.getElementById('lobbyHostView');
  const guestSetupView = document.getElementById('lobbyGuestSetupView');
  const guestView = document.getElementById('lobbyGuestView');
  const editorScreen = document.getElementById('editorScreen');
  const mechanicsScreen = document.getElementById('mechanicsScreen');
  const gameScreen = document.getElementById('gameScreen');
  const testPanel = document.getElementById('testModePanel');
  const btnMenu = document.getElementById('btnMenu');
  const btnSurrender = document.getElementById('btnSurrender');

  if (lobbyScreen) lobbyScreen.classList.remove('hidden');
  if (initView) initView.classList.remove('hidden');
  if (hostView) hostView.classList.add('hidden');
  if (guestSetupView) guestSetupView.classList.add('hidden');
  if (guestView) guestView.classList.add('hidden');
  if (editorScreen) editorScreen.classList.add('hidden');
  if (mechanicsScreen) mechanicsScreen.classList.add('hidden');
  if (gameScreen) gameScreen.classList.add('hidden');
  if (testPanel) testPanel.classList.add('hidden');
  if (btnMenu) btnMenu.classList.add('hidden');
  if (btnSurrender) btnSurrender.classList.add('hidden');

  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.style.setProperty('--container-max-width', '680px');
  }
  updateAllMapPreviews();
  updateTelemetryUI();
}

/**
 * Оновлення текстових підказок з характеристиками спорядження (включаючи панель реваншу)
 */
export function updateLoadoutStatsDesc() {
  const selectHull = document.getElementById('selectHull');
  const selectTurret = document.getElementById('selectTurret');
  const hostHullDesc = document.getElementById('hostHullStatsDesc');
  const hostTurretDesc = document.getElementById('hostTurretStatsDesc');

  if (selectHull && hostHullDesc) {
    const h = HULL_TYPES[selectHull.value];
    if (h) hostHullDesc.textContent = `${h.description} (HP: ${h.maxHp}, броня: ${Math.round((h.armor || 0.2) * 100)}%, швидкість: ${h.speed})`;
  }
  if (selectTurret && hostTurretDesc) {
    const t = TURRET_TYPES[selectTurret.value];
    if (t) hostTurretDesc.textContent = `${t.description} (Шкода: ${t.minDmg}-${t.maxDmg}, Обойма: ${t.clipSize} постр. / ${(t.clipReloadTime / 1000)}с, Огляд: ${t.fov}°)`;
  }

  const selectGuestHull = document.getElementById('selectGuestHull');
  const selectGuestTurret = document.getElementById('selectGuestTurret');
  const guestHullDesc = document.getElementById('guestHullStatsDesc');
  const guestTurretDesc = document.getElementById('guestTurretStatsDesc');

  if (selectGuestHull && guestHullDesc) {
    const h = HULL_TYPES[selectGuestHull.value];
    if (h) guestHullDesc.textContent = `${h.description} (HP: ${h.maxHp}, броня: ${Math.round((h.armor || 0.2) * 100)}%, швидкість: ${h.speed})`;
  }
  if (selectGuestTurret && guestTurretDesc) {
    const t = TURRET_TYPES[selectGuestTurret.value];
    if (t) guestTurretDesc.textContent = `${t.description} (Шкода: ${t.minDmg}-${t.maxDmg}, Обойма: ${t.clipSize} постр. / ${(t.clipReloadTime / 1000)}с, Огляд: ${t.fov}°)`;
  }

  const selectRematchHull = document.getElementById('selectRematchHull');
  const selectRematchTurret = document.getElementById('selectRematchTurret');
  const rematchDesc = document.getElementById('rematchLoadoutStatsDesc');
  if (selectRematchHull && selectRematchTurret && rematchDesc) {
    const h = HULL_TYPES[selectRematchHull.value] || HULL_TYPES[localLoadout.hull];
    const t = TURRET_TYPES[selectRematchTurret.value] || TURRET_TYPES[localLoadout.turret];
    if (h && t) {
      rematchDesc.textContent = `${h.name} (${h.maxHp} HP, броня ${Math.round((h.armor || 0.2) * 100)}%, шв. ${h.speed}) • ${t.name} (Шкода ${t.minDmg}-${t.maxDmg}, обойма ${t.clipSize}, огляд ${t.fov}°)`;
    }
  }
}

/**
 * Відображення меню вибору спорядження для другого гравця (Guest)
 */
export function showGuestSetupView(roomId) {
  pendingRoomId = roomId;
  const initView = document.getElementById('lobbyInitialView');
  const hostView = document.getElementById('lobbyHostView');
  const guestSetupView = document.getElementById('lobbyGuestSetupView');
  const guestView = document.getElementById('lobbyGuestView');
  const guestDisplayRoom = document.getElementById('guestDisplayRoomId');

  if (initView) initView.classList.add('hidden');
  if (hostView) hostView.classList.add('hidden');
  if (guestView) guestView.classList.add('hidden');
  if (guestSetupView) guestSetupView.classList.remove('hidden');
  if (guestDisplayRoom) guestDisplayRoom.textContent = roomId;

  const selectGuestHull = document.getElementById('selectGuestHull');
  const selectGuestTurret = document.getElementById('selectGuestTurret');
  if (selectGuestHull) selectGuestHull.value = localLoadout.hull;
  if (selectGuestTurret) selectGuestTurret.value = localLoadout.turret;
  updateHostMapDropdown();
  updateLoadoutStatsDesc();
  updateAllMapPreviews();
}

/**
 * Ініціалізація та наповнення випадаючих списків вибору спорядження та ліміту перемог (3..15)
 */
export function initLoadoutDropdowns() {
  const selectHull = document.getElementById('selectHull');
  const selectTurret = document.getElementById('selectTurret');
  const selectGuestHull = document.getElementById('selectGuestHull');
  const selectGuestTurret = document.getElementById('selectGuestTurret');
  const selectRematchHull = document.getElementById('selectRematchHull');
  const selectRematchTurret = document.getElementById('selectRematchTurret');
  const selectHostMap = document.getElementById('selectHostMap');
  const selectGuestMap = document.getElementById('selectGuestMap');
  const selectRematchMap = document.getElementById('selectRematchMap');
  const selectHostWinScore = document.getElementById('selectHostWinScore');
  const selectRematchWinScore = document.getElementById('selectRematchWinScore');

  const formatWinScoreLabel = (n) => {
    if (n === 3 || n === 4) return `${n} перемоги`;
    return `${n} перемог`;
  };

  const populateWinScoreSelect = (selectEl, selectedVal, onChange) => {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    for (let s = MIN_WIN_SCORE; s <= MAX_WIN_SCORE; s++) {
      const opt = document.createElement('option');
      opt.value = String(s);
      opt.textContent = formatWinScoreLabel(s);
      selectEl.appendChild(opt);
    }
    selectEl.value = String(selectedVal);
    selectEl.onchange = onChange;
    selectEl.oninput = onChange;
  };

  populateWinScoreSelect(selectHostWinScore, MAX_SCORE, () => {
    if (!selectHostWinScore) return;
    setTargetWinScore(Number(selectHostWinScore.value));
    updateHUD();
  });

  populateWinScoreSelect(selectRematchWinScore, MAX_SCORE, () => {
    if (!selectRematchWinScore) return;
    const newTarget = setTargetWinScore(Number(selectRematchWinScore.value));
    if (Network.connectionActive) {
      Network.sendRematch({
        action: 'winScoreChange',
        playerId: Network.myPlayerId,
        targetScore: newTarget
      });
    }
    updateHUD();
  });

  const populateSelect = (selectEl, options, selectedVal, onChange) => {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    Object.values(options).forEach(opt => {
      const el = document.createElement('option');
      el.value = opt.id;
      el.textContent = opt.name;
      selectEl.appendChild(el);
    });
    selectEl.value = selectedVal;
    selectEl.onchange = onChange;
    selectEl.oninput = onChange;
  };

  populateSelect(selectHull, HULL_TYPES, localLoadout.hull, () => {
    localLoadout.hull = selectHull.value;
    if (selectRematchHull) selectRematchHull.value = localLoadout.hull;
    setP1Loadout({ ...localLoadout });
    if (p1Tank && Network.myPlayerId === 1) p1Tank.applyLoadout(localLoadout.hull, p1Tank.turretType);
    if (p2Tank && Network.myPlayerId === 2) p2Tank.applyLoadout(localLoadout.hull, p2Tank.turretType);
    if (Network.connectionActive) Network.sendLoadout(localLoadout);
    updateLoadoutStatsDesc();
    updateHUD();
  });

  populateSelect(selectTurret, TURRET_TYPES, localLoadout.turret, () => {
    localLoadout.turret = selectTurret.value;
    if (selectRematchTurret) selectRematchTurret.value = localLoadout.turret;
    setP1Loadout({ ...localLoadout });
    if (p1Tank && Network.myPlayerId === 1) p1Tank.applyLoadout(p1Tank.hullType, localLoadout.turret);
    if (p2Tank && Network.myPlayerId === 2) p2Tank.applyLoadout(p2Tank.hullType, localLoadout.turret);
    if (Network.connectionActive) Network.sendLoadout(localLoadout);
    updateLoadoutStatsDesc();
    updateHUD();
  });

  populateSelect(selectGuestHull, HULL_TYPES, localLoadout.hull, () => {
    localLoadout.hull = selectGuestHull.value;
    if (selectRematchHull) selectRematchHull.value = localLoadout.hull;
    setP2Loadout({ ...localLoadout });
    if (p2Tank && Network.myPlayerId === 2) p2Tank.applyLoadout(localLoadout.hull, p2Tank.turretType);
    if (Network.connectionActive) Network.sendLoadout(localLoadout);
    updateLoadoutStatsDesc();
    updateHUD();
  });

  populateSelect(selectGuestTurret, TURRET_TYPES, localLoadout.turret, () => {
    localLoadout.turret = selectGuestTurret.value;
    if (selectRematchTurret) selectRematchTurret.value = localLoadout.turret;
    setP2Loadout({ ...localLoadout });
    if (p2Tank && Network.myPlayerId === 2) p2Tank.applyLoadout(p2Tank.hullType, localLoadout.turret);
    if (Network.connectionActive) Network.sendLoadout(localLoadout);
    updateLoadoutStatsDesc();
    updateHUD();
  });

  populateSelect(selectRematchHull, HULL_TYPES, localLoadout.hull, () => {
    localLoadout.hull = selectRematchHull.value;
    if (selectHull) selectHull.value = localLoadout.hull;
    if (selectGuestHull) selectGuestHull.value = localLoadout.hull;
    if (Network.myPlayerId === 1) {
      setP1Loadout({ ...localLoadout });
      if (p1Tank) p1Tank.applyLoadout(localLoadout.hull, p1Tank.turretType);
    } else {
      setP2Loadout({ ...localLoadout });
      if (p2Tank) p2Tank.applyLoadout(localLoadout.hull, p2Tank.turretType);
    }
    if (Network.connectionActive) Network.sendLoadout(localLoadout);
    updateLoadoutStatsDesc();
  });

  populateSelect(selectRematchTurret, TURRET_TYPES, localLoadout.turret, () => {
    localLoadout.turret = selectRematchTurret.value;
    if (selectTurret) selectTurret.value = localLoadout.turret;
    if (selectGuestTurret) selectGuestTurret.value = localLoadout.turret;
    if (Network.myPlayerId === 1) {
      setP1Loadout({ ...localLoadout });
      if (p1Tank) p1Tank.applyLoadout(p1Tank.hullType, localLoadout.turret);
    } else {
      setP2Loadout({ ...localLoadout });
      if (p2Tank) p2Tank.applyLoadout(p2Tank.hullType, localLoadout.turret);
    }
    if (Network.connectionActive) Network.sendLoadout(localLoadout);
    updateLoadoutStatsDesc();
  });

  if (selectHostMap) {
    const onHostMapChange = () => {
      const chosenId = selectHostMap.value;
      const chosenMap = MapStorage.getMapById(chosenId);
      if (chosenMap) {
        setCurrentActiveMap(chosenMap);
        renderMapPreview('hostMapPreviewCanvas', chosenMap);
      }
    };
    selectHostMap.onchange = onHostMapChange;
    selectHostMap.oninput = onHostMapChange;
  }

  if (selectGuestMap) {
    const onGuestMapChange = () => {
      const chosenId = selectGuestMap.value;
      const chosenMap = MapStorage.getMapById(chosenId);
      if (chosenMap) {
        if (gameState) gameState.guestSelectedMap = chosenMap;
        setCurrentActiveMap(chosenMap);
        renderMapPreview('guestMapPreviewCanvas', chosenMap);
      }
    };
    selectGuestMap.onchange = onGuestMapChange;
    selectGuestMap.oninput = onGuestMapChange;
  }

  if (selectRematchMap) {
    const onRematchMapChange = () => {
      const chosenId = selectRematchMap.value;
      const chosenMap = MapStorage.getMapById(chosenId);
      if (chosenMap) {
        setCurrentActiveMap(chosenMap);
        const hostMapSelect = document.getElementById('selectHostMap');
        if (hostMapSelect) hostMapSelect.value = chosenId;
        const guestMapSelect = document.getElementById('selectGuestMap');
        if (guestMapSelect) guestMapSelect.value = chosenId;
        renderMapPreview('rematchMapPreviewCanvas', chosenMap);
        if (Network.connectionActive) {
          Network.sendRematch({
            action: 'mapChange',
            playerId: Network.myPlayerId,
            map: chosenMap
          });
        }
      }
    };
    selectRematchMap.onchange = onRematchMapChange;
    selectRematchMap.oninput = onRematchMapChange;
  }

  updateLoadoutStatsDesc();
  updateAllMapPreviews();
}

export function initUIEventListeners() {
  const btnOpenEditor = document.getElementById('btnOpenEditor');
  if (btnOpenEditor) {
    btnOpenEditor.onclick = () => {
      document.getElementById('lobbyScreen').classList.add('hidden');
      const mechScreen = document.getElementById('mechanicsScreen');
      if (mechScreen) mechScreen.classList.add('hidden');
      document.getElementById('editorScreen').classList.remove('hidden');
      if (MapEditor.mapData) {
        const maxDim = Math.max(MapEditor.mapData.width, MapEditor.mapData.height);
        const editorSize = Math.min(Math.max(640, maxDim * 28), 920);
        document.documentElement.style.setProperty('--editor-max-width', `${editorSize}px`);
        document.documentElement.style.setProperty('--container-max-width', `${editorSize + 32}px`);
      }
      MapEditor.render();
    };
  }

  const btnEditorBack = document.getElementById('btnEditorBack');
  if (btnEditorBack) {
    btnEditorBack.onclick = () => {
      document.getElementById('editorScreen').classList.add('hidden');
      document.getElementById('lobbyScreen').classList.remove('hidden');
      document.documentElement.style.setProperty('--container-max-width', '680px');
      updateHostMapDropdown();
      updateAllMapPreviews();
      renderMechanicsCatalog();
    };
  }

  const btnOpenMechanics = document.getElementById('btnOpenMechanics');
  if (btnOpenMechanics) {
    btnOpenMechanics.onclick = () => {
      renderMechanicsCatalog();
      const lobbyScreen = document.getElementById('lobbyScreen');
      const mechScreen = document.getElementById('mechanicsScreen');
      if (lobbyScreen) lobbyScreen.classList.add('hidden');
      if (mechScreen) mechScreen.classList.remove('hidden');
      document.documentElement.style.setProperty('--container-max-width', '860px');
    };
  }

  const btnMechanicsBack = document.getElementById('btnMechanicsBack');
  if (btnMechanicsBack) {
    btnMechanicsBack.onclick = () => {
      const mechScreen = document.getElementById('mechanicsScreen');
      const lobbyScreen = document.getElementById('lobbyScreen');
      if (mechScreen) mechScreen.classList.add('hidden');
      if (lobbyScreen) lobbyScreen.classList.remove('hidden');
      document.documentElement.style.setProperty('--container-max-width', '680px');
    };
  }

  // Кнопка запуску Зони для тестування (Полігон) у головному меню
  const btnStartTestMode = document.getElementById('btnStartTestMode');
  if (btnStartTestMode) {
    btnStartTestMode.addEventListener('click', () => {
      sound.init();
      startTestMode();
      showToast('🧪 Полігон активовано! Перемикайте гравців на [Tab] та обирайте здібності.');
    });
  }

  // Кнопки керування в Зоні для тестування (Полігон)
  const btnTestSwitchPlayer = document.getElementById('btnTestSwitchPlayer');
  if (btnTestSwitchPlayer) {
    btnTestSwitchPlayer.addEventListener('click', () => {
      sound.init();
      const nextId = switchTestActivePlayer();
      showToast(`🔄 Керування перемкнуто на Гравця ${nextId}`);
    });
  }

  const btnTestHealBoth = document.getElementById('btnTestHealBoth');
  if (btnTestHealBoth) {
    btnTestHealBoth.addEventListener('click', () => {
      sound.init();
      healAndResetCooldownsInTestMode();
      showToast('💚 Обом танкам відновлено HP, набої, міни, ремкомплекти та скинуто кулдауни!');
    });
  }

  const btnTestResetMap = document.getElementById('btnTestResetMap');
  if (btnTestResetMap) {
    btnTestResetMap.addEventListener('click', () => {
      sound.init();
      restoreMapState();
      resetRoundSpawns();
      healAndResetCooldownsInTestMode();
      showToast('🧱 Карту та позиції танків відновлено!');
    });
  }

  const btnTestTogglePerks = document.getElementById('btnTestTogglePerks');
  if (btnTestTogglePerks) {
    btnTestTogglePerks.addEventListener('click', () => {
      const box = document.getElementById('testPerkManagerBox');
      if (box) {
        const isHidden = box.classList.toggle('hidden');
        btnTestTogglePerks.textContent = isHidden
          ? '✨ Розгорнути редактор здібностей'
          : '✨ Згорнути редактор здібностей';
      }
    });
  }

  const btnTestTargetP1 = document.getElementById('btnTestTargetP1');
  if (btnTestTargetP1) {
    btnTestTargetP1.addEventListener('click', () => {
      setTestTargetPlayer(1);
    });
  }

  const btnTestTargetP2 = document.getElementById('btnTestTargetP2');
  if (btnTestTargetP2) {
    btnTestTargetP2.addEventListener('click', () => {
      setTestTargetPlayer(2);
    });
  }

  const btnTestClearTargetPerks = document.getElementById('btnTestClearTargetPerks');
  if (btnTestClearTargetPerks) {
    btnTestClearTargetPerks.addEventListener('click', () => {
      clearTestPerksForPlayer(testTargetPlayerId);
      showToast(`🗑️ Здібності Гравця ${testTargetPlayerId} скинуто!`);
    });
  }

  const btnHostGame = document.getElementById('btnHostGame');
  if (btnHostGame) {
    btnHostGame.addEventListener('click', () => {
      sound.init();
      if (gameState) gameState.isTestMode = false;
      const sHull = document.getElementById('selectHull');
      const sTurret = document.getElementById('selectTurret');
      const sWinScore = document.getElementById('selectHostWinScore');
      if (sHull && sHull.value) localLoadout.hull = sHull.value;
      if (sTurret && sTurret.value) localLoadout.turret = sTurret.value;
      if (sWinScore && sWinScore.value) setTargetWinScore(Number(sWinScore.value));
      setP1Loadout({ ...localLoadout });
      const select = document.getElementById('selectHostMap');
      const chosenMapId = select ? select.value : null;
      const chosenMap = MapStorage.getMapById(chosenMapId);
      setupGameMap(chosenMap);
      if (p1Tank) p1Tank.applyLoadout(p1Loadout.hull, p1Loadout.turret);

      const initView = document.getElementById('lobbyInitialView');
      const hostView = document.getElementById('lobbyHostView');
      if (initView) initView.classList.add('hidden');
      if (hostView) hostView.classList.remove('hidden');

      Network.hostGame((id, inviteUrl) => {
        const displayRoom = document.getElementById('displayRoomId');
        const shareLink = document.getElementById('shareLinkInput');
        if (displayRoom) displayRoom.textContent = id;
        if (shareLink) shareLink.value = inviteUrl;
      });
    });
  }

  const btnHostBackToMenu = document.getElementById('btnHostBackToMenu');
  if (btnHostBackToMenu) {
    btnHostBackToMenu.addEventListener('click', () => {
      returnToMainMenu();
    });
  }

  const btnJoinGame = document.getElementById('btnJoinGame');
  if (btnJoinGame) {
    btnJoinGame.addEventListener('click', () => {
      const input = document.getElementById('inputRoomId');
      const inputVal = input ? input.value : '';
      const roomId = Network.extractRoomId(inputVal);
      if (roomId) {
        showGuestSetupView(roomId);
      } else {
        showToast('Введіть ID кімнати або посилання!');
      }
    });
  }

  const btnGuestReadyJoin = document.getElementById('btnGuestReadyJoin');
  if (btnGuestReadyJoin) {
    btnGuestReadyJoin.addEventListener('click', () => {
      sound.init();
      if (gameState) gameState.isTestMode = false;
      const selectGuestHull = document.getElementById('selectGuestHull');
      const selectGuestTurret = document.getElementById('selectGuestTurret');
      const selectGuestMap = document.getElementById('selectGuestMap');
      if (selectGuestHull && selectGuestHull.value) localLoadout.hull = selectGuestHull.value;
      if (selectGuestTurret && selectGuestTurret.value) localLoadout.turret = selectGuestTurret.value;
      if (selectGuestMap && selectGuestMap.value) {
        const chosenMap = MapStorage.getMapById(selectGuestMap.value);
        if (chosenMap) {
          if (gameState) gameState.guestSelectedMap = chosenMap;
          setCurrentActiveMap(chosenMap);
        }
      }
      setP2Loadout({ ...localLoadout });
      if (p2Tank) p2Tank.applyLoadout(p2Loadout.hull, p2Loadout.turret);

      const guestSetupView = document.getElementById('lobbyGuestSetupView');
      const guestView = document.getElementById('lobbyGuestView');
      const statusLabel = document.getElementById('guestStatusLabel');

      if (guestSetupView) guestSetupView.classList.add('hidden');
      if (guestView) guestView.classList.remove('hidden');
      if (statusLabel) statusLabel.textContent = `Підключення до кімнати ${pendingRoomId}...`;

      Network.joinGame(pendingRoomId);
    });
  }

  const btnGuestCancel = document.getElementById('btnGuestCancel');
  if (btnGuestCancel) {
    btnGuestCancel.addEventListener('click', () => {
      returnToMainMenu();
    });
  }

  const btnGuestConnectingCancel = document.getElementById('btnGuestConnectingCancel');
  if (btnGuestConnectingCancel) {
    btnGuestConnectingCancel.addEventListener('click', () => {
      returnToMainMenu();
    });
  }

  const btnCopyLink = document.getElementById('btnCopyLink');
  if (btnCopyLink) {
    btnCopyLink.addEventListener('click', () => {
      const shareInput = document.getElementById('shareLinkInput');
      if (shareInput) {
        shareInput.select();
        shareInput.setSelectionRange(0, 99999);
      }
      if (navigator.clipboard && navigator.clipboard.writeText && shareInput) {
        navigator.clipboard.writeText(shareInput.value).then(() => {
          showToast('📋 Посилання скопійовано в буфер обміну!');
        });
      } else {
        document.execCommand('copy');
        showToast('📋 Посилання скопійовано в буфер обміну!');
      }
    });
  }

  const btnCopyId = document.getElementById('btnCopyId');
  if (btnCopyId) {
    btnCopyId.addEventListener('click', () => {
      const idElem = document.getElementById('displayRoomId');
      const idText = idElem ? idElem.textContent : '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(idText).then(() => {
          showToast(`📋 ID ${idText} скопійовано!`);
        });
      } else {
        showToast(`📋 ID: ${idText}`);
      }
    });
  }

  const btnToggleSound = document.getElementById('btnToggleSound');
  if (btnToggleSound) {
    btnToggleSound.addEventListener('click', () => {
      sound.init();
      const isAudible = sound.toggleMute();
      btnToggleSound.textContent = isAudible ? '🔊 ЗВУК: УВІМК' : '🔇 ЗВУК: ВИМК';
    });
  }

  const btnSurrender = document.getElementById('btnSurrender');
  if (btnSurrender) {
    btnSurrender.addEventListener('click', () => {
      sound.init();
      surrenderMatch(Network.myPlayerId || 1);
    });
  }

  const btnMenu = document.getElementById('btnMenu');
  if (btnMenu) {
    btnMenu.addEventListener('click', () => {
      returnToMainMenu();
    });
  }

  const btnRematch = document.getElementById('btnRematch');
  if (btnRematch) {
    btnRematch.addEventListener('click', () => {
      sound.init();
      requestRematch(Network.myPlayerId);
    });
  }
}

registerUIHooks({
  renderRematchUI,
  renderMechanicsCatalog,
  updateTelemetryUI,
  setConnectionStatus,
  updateHUD
});
