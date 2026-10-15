/**
 * input.js — Модуль обробки вводу гравця для Battle City 1990 PvP
 *
 * Відповідальність:
 * - Обробка клавіатури (WASD/Стрілки, ПРОБІЛ — активна здібність, Q/E — перемикання активок, R — перезарядка, H — ремкомплект, Tab — перемикання гравців у Полігоні)
 * - Перевірка фокуса текстових полів (isTypingInTextField)
 * - Обробка миші (наведення вежі та стрільба ЛКМ у будь-якій точці вікна)
 * - Сенсорне мобільне керування (setupMobileControls)
 * - Маршрутизація локального вводу (sendLocalInput) між Хостом, Клієнтом та Полігоном
 */

import Network from './network.js?v=20261011_v17';
import { sound } from './audio.js?v=20261011_v17';
import {
  p1Tank, p2Tank, p3Tank, p4Tank, gameState, renderTanks,
  localInput, mouseX, mouseY,
  gridCols, gridRows, tileSize,
  setP1Input, setP2Input, setP3Input, setP4Input, setMousePos,
  uiHooks, registerUIHooks
} from './state.js?v=20261011_v17';
import {
  triggerActiveAbilityForTank, cycleActiveForTank,
  startManualReloadForTank, useRepairKitForTank,
  useArtilleryForTank
} from './combat.js?v=20261011_v17';
import { switchTestActivePlayer } from './sandbox.js?v=20261011_v17';

const keyMap = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'space',
  KeyH: 'useRepair',
  KeyR: 'reloadClip',
  KeyQ: 'prevActive',
  KeyE: 'nextActive',
  Tab: 'switchTestPlayer'
};

let isMouseDown = false;
let isTouchFireDown = false;

function syncShootHoldState() {
  // Постріл здійснюється ТІЛЬКИ ЛКМ (або сенсорною кнопкою вогню на мобільному), ПРОБІЛ не стріляє!
  localInput.shoot = Boolean(isMouseDown || isTouchFireDown);
}

/**
 * Скидання стану затиснутих кнопок миші/дотику (наприклад, при перемиканні гравця в Полігоні або втраті фокуса)
 */
export function resetPointerHoldState() {
  isMouseDown = false;
  isTouchFireDown = false;
  syncShootHoldState();
}

export function getLocalPlayerTank() {
  const myId = Network.myPlayerId || 1;
  const allTanks = [p1Tank, p2Tank, p3Tank, p4Tank];
  return allTanks[myId - 1] || p1Tank;
}

/**
 * Передача локального вводу Хосту, Клієнту або активному танку в Полігоні
 */
export function sendLocalInput() {
  if (gameState && gameState.isTestMode) {
    if (Network.myPlayerId === 2) {
      setP2Input({ ...localInput });
    } else if (Network.myPlayerId === 3) {
      setP3Input({ ...localInput });
    } else if (Network.myPlayerId === 4) {
      setP4Input({ ...localInput });
    } else {
      setP1Input({ ...localInput });
    }
    return;
  }

  if (Network.isHost) {
    setP1Input({ ...localInput });
  } else {
    Network.sendInput(localInput);
  }
}

/**
 * Перевірка, чи фокус знаходиться в текстовому полі вводу (назва карти, пошук здібності, ID кімнати тощо),
 * щоб гарячі клавіші гри (S -> 'і', Space -> пробіл, ArrowLeft/Right -> курсор) не блокували друк тексту!
 */
export function isTypingInTextField(e) {
  const target = (e && e.target) || (typeof document !== 'undefined' ? document.activeElement : null);
  if (!target) return false;
  const tagName = String(target.tagName || '').toUpperCase();
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function handleKey(e, isPressed) {
  if (isTypingInTextField(e)) return;
  const action = keyMap[e.code];
  if (!action) return;

  if (action === 'switchTestPlayer') {
    if (gameState && gameState.isTestMode) {
      if (e.preventDefault) e.preventDefault();
      if (isPressed && !e.repeat) {
        sound.init();
        switchTestActivePlayer();
      }
    }
    return;
  }

  if (e.preventDefault) e.preventDefault();

  sound.init();

  if (action === 'prevActive' || action === 'nextActive') {
    if (isPressed && !e.repeat) {
      const myTank = getLocalPlayerTank();
      if (myTank) {
        cycleActiveForTank(myTank, action === 'prevActive' ? -1 : 1);
      }
    }
    return;
  }

  if (action === 'reloadClip') {
    const myTank = getLocalPlayerTank();
    if (isPressed && myTank && !myTank.isDead && !(gameState.perkSelection && gameState.perkSelection.active)) {
      localInput.reloadClip = true;
      if (Network.isHost || !Network.connectionActive) {
        startManualReloadForTank(myTank);
        localInput.reloadClip = false;
      }
    } else if (!isPressed) {
      localInput.reloadClip = false;
    }
    sendLocalInput();
    return;
  }

  if (action === 'space') {
    // ПРОБІЛ активує обрану активну здібність (Міну, Дим 3x3, Артилерію 3x3, Маяк, Радар, Керовану кулю або Турбо)
    const myTank = getLocalPlayerTank();
    const actives = (myTank && typeof myTank.getAvailableActives === 'function') ? myTank.getAvailableActives() : [];
    localInput.placeMine = false;
    localInput.useSmoke = false;
    localInput.useBeacon = false;
    localInput.useRadar = false;
    localInput.toggleGuided = false;
    localInput.useTurbo = false;

    if (myTank && actives.length > 0) {
      const chosen = (myTank.selectedActive && actives.includes(myTank.selectedActive)) ? myTank.selectedActive : actives[0];
      if (chosen === 'artillery') {
        if (isPressed && !e.repeat && !(gameState.perkSelection && gameState.perkSelection.active)) {
          triggerActiveAbilityForTank(myTank);
        }
        syncShootHoldState();
        sendLocalInput();
        return;
      }
      if (chosen === 'guided') {
        if (isPressed && !e.repeat && !(gameState.perkSelection && gameState.perkSelection.active)) {
          if (Network.isHost || !Network.connectionActive) {
            triggerActiveAbilityForTank(myTank);
          } else if (myTank.canUseGuidedBullet()) {
            localInput.toggleGuided = true;
            myTank.guidedBulletArmed = !myTank.guidedBulletArmed;
            myTank.lastGuidedLocalTriggerTime = Date.now();
            uiHooks.updateHUD();
          }
        }
        syncShootHoldState();
        sendLocalInput();
        localInput.toggleGuided = false;
        return;
      }
      if (chosen === 'turbo') {
        localInput.useTurbo = Boolean(isPressed);
        if (isPressed && !(gameState.perkSelection && gameState.perkSelection.active)) {
          if (Network.isHost || !Network.connectionActive) {
            triggerActiveAbilityForTank(myTank);
            localInput.useTurbo = false;
          } else if (myTank.canUseTurbo()) {
            myTank.turboActiveTimer = 240;
            myTank.turboCooldownTimer = 0;
            myTank.lastTurboLocalTriggerTime = Date.now();
            uiHooks.updateHUD();
          }
        }
      } else if (chosen === 'beacon') {
        localInput.useBeacon = Boolean(isPressed);
        if (isPressed && !(gameState.perkSelection && gameState.perkSelection.active)) {
          if (Network.isHost || !Network.connectionActive) {
            triggerActiveAbilityForTank(myTank);
            localInput.useBeacon = false;
          } else if (myTank.canUseBeacon()) {
            myTank.beaconActiveTimer = 420;
            myTank.beaconCooldownTimer = 0;
            myTank.lastBeaconLocalTriggerTime = Date.now();
            uiHooks.updateHUD();
          }
        }
      } else if (chosen === 'radar') {
        localInput.useRadar = Boolean(isPressed);
        if (isPressed && !(gameState.perkSelection && gameState.perkSelection.active)) {
          if (Network.isHost || !Network.connectionActive) {
            triggerActiveAbilityForTank(myTank);
            localInput.useRadar = false;
          } else if (myTank.canUseSpotEnemy()) {
            myTank.spotActiveTimer = 600;
            myTank.spotCooldownTimer = 0;
            myTank.lastSpotLocalTriggerTime = Date.now();
            uiHooks.updateHUD();
          }
        }
      } else if (chosen === 'smoke') {
        localInput.useSmoke = Boolean(isPressed);
        if (isPressed && !(gameState.perkSelection && gameState.perkSelection.active)) {
          if (Network.isHost || !Network.connectionActive) {
            triggerActiveAbilityForTank(myTank);
            localInput.useSmoke = false;
          } else if (myTank.canUseSmoke()) {
            myTank.smokeActiveTimer = 300;
            myTank.smokeCooldownTimer = 0;
            myTank.lastSmokeLocalTriggerTime = Date.now();
            uiHooks.updateHUD();
          }
        }
      } else {
        localInput.placeMine = Boolean(isPressed);
        if (isPressed && !(gameState.perkSelection && gameState.perkSelection.active)) {
          if (Network.isHost || !Network.connectionActive) {
            triggerActiveAbilityForTank(myTank);
            localInput.placeMine = false;
          }
        }
      }
    }
    syncShootHoldState();
    sendLocalInput();
    return;
  }

  if (action === 'useRepair') {
    // Клавіша H (англійська H) використовує ремонтний комплект (відновлює 20% від maxHp)
    const myTank = getLocalPlayerTank();
    if (myTank && myTank.maxRepairKits > 0) {
      localInput.useRepair = Boolean(isPressed);
      if (isPressed && (Network.isHost || !Network.connectionActive) && myTank.canUseRepairKit() && !(gameState.perkSelection && gameState.perkSelection.active)) {
        useRepairKitForTank(myTank);
        localInput.useRepair = false;
      }
    } else {
      localInput.useRepair = false;
    }
    sendLocalInput();
    return;
  }

  localInput[action] = isPressed;
  sendLocalInput();
}

/**
 * Обробка переміщення миші (працює по всьому вікну, навіть поза межами поля Canvas)
 */
export function onCanvasMouseMove(e) {
  const gameScreen = document.getElementById('gameScreen');
  if (gameScreen && gameScreen.classList.contains('hidden')) return;

  const canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getBoundingClientRect) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return;

  const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
  const clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;

  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const nextMx = (clientX - rect.left) * scaleX;
  const nextMy = (clientY - rect.top) * scaleY;
  if (!Number.isFinite(nextMx) || !Number.isFinite(nextMy)) return;
  setMousePos(nextMx, nextMy);
  localInput.aimX = Math.round(nextMx);
  localInput.aimY = Math.round(nextMy);

  const myId = Network.myPlayerId || 1;
  const myTank = getLocalPlayerTank();
  if (myTank) {
    const cx = myTank.x + myTank.size / 2;
    const cy = myTank.y + myTank.size / 2;
    const angle = Math.atan2(mouseY - cy, mouseX - cx);
    if (!Number.isFinite(angle)) return;

    myTank.turretAngle = angle;
    localInput.turretAngle = angle;
    const rKey = `p${myId}`;
    if (renderTanks[rKey]) {
      renderTanks[rKey].turretAngle = angle;
    }
    sendLocalInput();
  }
}

/**
 * Постріл та затискання ЛКМ у будь-якій точці екрана (навіть коли мишка поза зоною поля)
 */
export function onCanvasMouseDown(e) {
  if (e.button !== 0 && !e.touches) return;

  const gameScreen = document.getElementById('gameScreen');
  if (gameScreen && gameScreen.classList.contains('hidden')) return;

  // Не блокуємо взаємодію з кнопками інтерфейсу, панеллю тестування, бічними панелями, картками перків та розкривними списками
  if (e.target && typeof e.target.closest === 'function') {
    const isInteractiveUI = e.target.closest('button, select, input, summary, a, .info-accordion, .perk-card, .sidebar-perk-pill, #testModePanel, #passivePerksSidebar, #activePerksSidebar, #perkSelectionOverlay, #gameOverOverlay, #mechanicsScreen');
    if (isInteractiveUI) return;
  }

  sound.init();
  onCanvasMouseMove(e);

  // Якщо активований приціл по блоку (Артилерія 3x3) — наступний ЛКМ б'є в обраний блок!
  const myId = Network.myPlayerId || 1;
  const myTank = getLocalPlayerTank();
  if (myTank && !myTank.isDead && !(gameState.perkSelection && gameState.perkSelection.active) && myTank.targetingMode === 'artillery') {
    if (typeof myTank.canUseArtillery === 'function' && myTank.canUseArtillery()) {
      const targetCol = Math.max(0, Math.min(gridCols - 1, Math.floor(mouseX / tileSize)));
      const targetRow = Math.max(0, Math.min(gridRows - 1, Math.floor(mouseY / tileSize)));
      myTank.targetingMode = null;
      if (Network.isHost || !Network.connectionActive) {
        useArtilleryForTank(myTank, targetCol, targetRow);
      } else {
        localInput.artilleryStrike = { col: targetCol, row: targetRow };
        myTank.artilleryPendingTimer = 60;
        myTank.artilleryCooldownTimer = 0;
        myTank.lastArtilleryLocalTriggerTime = Date.now();
        sendLocalInput();
        localInput.artilleryStrike = null;
        uiHooks.updateHUD();
      }
      return;
    } else {
      myTank.targetingMode = null;
      uiHooks.updateHUD();
    }
  }

  isMouseDown = true;
  syncShootHoldState();
  sendLocalInput();
}

export function onWindowMouseUp(e) {
  if (e.button !== 0 && !e.touches) return;
  if (isMouseDown) {
    isMouseDown = false;
    syncShootHoldState();
    sendLocalInput();
  }
}

let inputListenersInitialized = false;

export function initInputListeners() {
  if (inputListenersInitialized) return;
  if (typeof window !== 'undefined') {
    inputListenersInitialized = true;
    window.addEventListener('keydown', (e) => handleKey(e, true));
    window.addEventListener('keyup', (e) => handleKey(e, false));
    window.addEventListener('mousemove', onCanvasMouseMove);
    window.addEventListener('mousedown', onCanvasMouseDown);
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('blur', () => {
      isMouseDown = false;
      isTouchFireDown = false;
      localInput.up = false;
      localInput.down = false;
      localInput.left = false;
      localInput.right = false;
      localInput.placeMine = false;
      localInput.useSmoke = false;
      localInput.useBeacon = false;
      localInput.useRadar = false;
      localInput.toggleGuided = false;
      localInput.useTurbo = false;
      localInput.useRepair = false;
      localInput.reloadClip = false;
      syncShootHoldState();
      sendLocalInput();
    });
  }
}

export function setupMobileControls() {
  const bindBtn = (id, action) => {
    const el = document.getElementById(id);
    if (!el || el._mobileControlBound) return; el._mobileControlBound = true;

    const press = (e) => {
      e.preventDefault();
      sound.init();
      if (action === 'shoot') {
        isTouchFireDown = true;
        syncShootHoldState();
        sendLocalInput();
      } else {
        localInput[action] = true;
        sendLocalInput();
      }
    };

    const release = (e) => {
      e.preventDefault();
      if (action === 'shoot') {
        isTouchFireDown = false;
        syncShootHoldState();
        sendLocalInput();
      } else {
        localInput[action] = false;
        sendLocalInput();
      }
    };

    el.addEventListener('touchstart', press);
    el.addEventListener('touchend', release);
    el.addEventListener('mousedown', press);
    el.addEventListener('mouseup', release);
  };

  bindBtn('mUp', 'up');
  bindBtn('mDown', 'down');
  bindBtn('mLeft', 'left');
  bindBtn('mRight', 'right');
  bindBtn('mFire', 'shoot');
}

registerUIHooks({
  resetPointerHoldState,
  sendLocalInput
});

initInputListeners();
