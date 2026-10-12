/**
 * game.js — Головна точка входу (Entry Point) та оркестратор ігрового циклу Battle City 1990 PvP
 *
 * Модульна архітектура за принципом Separation of Concerns (ES Modules):
 * - tiles.js         — Реєстр тайлів карти, текстур та рослинності
 * - config.js        — Конфігурації корпусів, башт, здібностей та рідкості
 * - audio.js         — Web Audio API 8-бітний синтезатор звуків (SoundFX, sound)
 * - tankRenderer.js  — Canvas-рендеринг корпусів, гусениць, башт та індикаторів танків
 * - vfx.js           — Візуальні ефекти (Explosion, TreadMark, SmokeCloud, DebrisParticle, MuzzleFlash, SmokeParticle, ScreenShake)
 * - entities.js      — Ігрові сутності та фізика (Tank, Bullet, Mine)
 * - state.js         — Єдине джерело стану гри, гравців, вводу та життєвого циклу арени
 * - vision.js        — Система стелсу, прямої видимості (LoS), конуса огляду та маскування
 * - perks.js         — Система вибору здібностей після раунду та реролів
 * - combat.js        — Бойова система, колізії, снаряди, міни, активні та пасивні здібності
 * - renderer.js      — Головний пайплайн відмальовки сцени Canvas (drawGame, drawMap, шари кущів)
 * - sandbox.js       — Логіка та інтерфейс Зони для тестування (Полігон)
 * - ui.js            — HUD, бічні панелі здібностей, каталог механік, лобі, реванш та телеметрія
 * - input.js         — Обробка клавіатури, миші та сенсорного керування
 * - netSync.js       — Авторський такт Хоста (hostUpdate) та обробники подій WebRTC (Network.init)
 */

import {
  MAX_TANK_SPEED, MIN_WIN_SCORE, MAX_WIN_SCORE, LUCK_WEIGHT_MODIFIERS,
  getRarityWeightWithLuck, PHANTOM_FORBIDDEN_PERKS
} from './config.js?v=20261011_v17';
import { MapEditor, MapStorage, updateHostMapDropdown, renderMapPreview, updateAllMapPreviews } from './editor.js?v=20261011_v17';
import Network from './network.js?v=20261011_v17';
import { sound, SoundFX } from './audio.js?v=20261011_v17';
import {
  trackMarks, triggerScreenShake, spawnTrackMarks, isTankOnEnemySlowingTrack,
  spawnDebris, spawnMuzzleFlash, spawnSmoke,
  updateParticles as updateParticlesVfx,
  updateExplosions as updateExplosionsVfx
} from './vfx.js?v=20261011_v17';
import {
  tileSize, canvasWidth, canvasHeight,
  MAX_SCORE, setTargetWinScore, p1Tank, p2Tank, localLoadout,
  testTargetPlayerId, currentFps, setCurrentFps, gameState, localInput,
  calculateGameDimensions, setupGameMap, restoreMapState,
  resetRoundSpawns, resetForRematch
} from './state.js?v=20261011_v17';
import {
  checkLineOfSight, isInVisionCone, isTankInLowBushes,
  isVisionBlockedByEnemySmoke, canPlayerSeeBullet, canPlayerSeeTrack,
  canPlayerSeeMine, canPlayerSeeMuzzleEffect, isTankInSmoke,
  isTankInBushes, isTankInWaterCamo, isTankCamouflaged,
  shouldDrawTankOverlayHighlight, updatePlayersVisibilityState
} from './vision.js?v=20261011_v17';
import {
  rollPerkOptionsForTank, startPerkSelection, rerollPerkOptions, selectPerk, renderPerkSelectionUI
} from './perks.js?v=20261011_v17';
import {
  calculateArmorDamage, checkMapCollision, checkTankCollision, spawnBullet,
  placeMineForTank, useSmokeForTank, useArtilleryForTank, surrenderMatch,
  triggerActiveAbilityForTank,
  cycleActiveForTank, selectActiveForTank, startManualReloadForTank,
  useRepairKitForTank, applyThornsDamage, handleTankKill,
  updateBulletsAndCollisions, updateMinesAndCollisions, updateTankPassives
} from './combat.js?v=20261011_v17';
import {
  drawVisionCone, drawAimGuide, drawBushesOverlay, drawBushUnderGlow,
  drawPlayerBushHighlight, drawMap, drawLowBushesOverlay,
  drawBlockTargetingOverlay, drawRoundTimer, drawGame
} from './renderer.js?v=20261011_v17';
import {
  startTestMode, switchTestActivePlayer, setTestTargetPlayer,
  addTestPerkForPlayer, removeTestPerkForPlayer, clearTestPerksForPlayer,
  healAndResetCooldownsInTestMode, renderTestModeUI
} from './sandbox.js?v=20261011_v17';
import {
  renderRematchUI, requestRematch, renderMechanicsCatalog,
  updateTelemetryUI, renderPerksSidebars, updateHUD,
  setConnectionStatus, startActiveMatch, returnToMainMenu,
  updateLoadoutStatsDesc, showGuestSetupView, initLoadoutDropdowns,
  initUIEventListeners
} from './ui.js?v=20261011_v17';
import {
  isTypingInTextField, handleKey, onCanvasMouseMove,
  onCanvasMouseDown, onWindowMouseUp, sendLocalInput,
  resetPointerHoldState, setupMobileControls, initInputListeners
} from './input.js?v=20261011_v17';
import { hostUpdate, initNetworkCallbacks } from './netSync.js?v=20261011_v17';

// Реекспорт публічного API для повної зворотної сумісності
export {
  MAX_TANK_SPEED, MIN_WIN_SCORE, MAX_WIN_SCORE, LUCK_WEIGHT_MODIFIERS,
  getRarityWeightWithLuck, PHANTOM_FORBIDDEN_PERKS,
  sound, SoundFX,
  trackMarks, triggerScreenShake, spawnTrackMarks, isTankOnEnemySlowingTrack,
  spawnDebris, spawnMuzzleFlash, spawnSmoke,
  MAX_SCORE, setTargetWinScore, p1Tank, p2Tank, localLoadout,
  testTargetPlayerId, currentFps, gameState, localInput,
  calculateGameDimensions, setupGameMap, restoreMapState,
  resetRoundSpawns, resetForRematch,
  checkLineOfSight, isInVisionCone, isTankInLowBushes,
  isVisionBlockedByEnemySmoke, canPlayerSeeBullet, canPlayerSeeTrack,
  canPlayerSeeMine, canPlayerSeeMuzzleEffect, isTankInSmoke,
  isTankInBushes, isTankInWaterCamo, isTankCamouflaged,
  shouldDrawTankOverlayHighlight, updatePlayersVisibilityState,
  rollPerkOptionsForTank, startPerkSelection, rerollPerkOptions, selectPerk, renderPerkSelectionUI,
  calculateArmorDamage, checkMapCollision, checkTankCollision, spawnBullet,
  placeMineForTank, useSmokeForTank, useArtilleryForTank, surrenderMatch,
  triggerActiveAbilityForTank,
  cycleActiveForTank, selectActiveForTank, startManualReloadForTank,
  useRepairKitForTank, applyThornsDamage, handleTankKill,
  updateBulletsAndCollisions, updateMinesAndCollisions, updateTankPassives,
  drawVisionCone, drawAimGuide, drawBushesOverlay, drawBushUnderGlow,
  drawPlayerBushHighlight, drawMap, drawLowBushesOverlay,
  drawBlockTargetingOverlay, drawRoundTimer, drawGame,
  renderMapPreview, updateAllMapPreviews,
  startTestMode, switchTestActivePlayer, setTestTargetPlayer,
  addTestPerkForPlayer, removeTestPerkForPlayer, clearTestPerksForPlayer,
  healAndResetCooldownsInTestMode, renderTestModeUI,
  renderRematchUI, requestRematch, renderMechanicsCatalog,
  updateTelemetryUI, renderPerksSidebars, updateHUD,
  setConnectionStatus, startActiveMatch, returnToMainMenu,
  updateLoadoutStatsDesc, showGuestSetupView, initLoadoutDropdowns,
  initUIEventListeners,
  isTypingInTextField, handleKey, onCanvasMouseMove,
  onCanvasMouseDown, onWindowMouseUp, sendLocalInput,
  resetPointerHoldState, setupMobileControls, initInputListeners,
  hostUpdate, initNetworkCallbacks
};

// =========================================================================
// ГОЛОВНИЙ ІГРОВИЙ ЦИКЛ (60 FPS FIXED TIMESTEP) ТА ІНІЦІАЛІЗАЦІЯ ДОДАТКУ
// =========================================================================
let fpsFrameCount = 0;
let fpsLastTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
let lastFrameTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
const FRAME_DURATION = 1000 / 60;
let accumulator = 0;

export function gameLoop(now) {
  const dt = now - lastFrameTime;
  lastFrameTime = now;
  accumulator += dt;

  // Підрахунок FPS кожні 500 мс для телеметрії зліва знизу
  fpsFrameCount++;
  const elapsedFps = now - fpsLastTime;
  if (elapsedFps >= 500) {
    setCurrentFps(Math.max(1, Math.min(240, Math.round((fpsFrameCount * 1000) / elapsedFps))));
    fpsFrameCount = 0;
    fpsLastTime = now;
    updateTelemetryUI(currentFps, Network.pingMs);
  }

  while (accumulator >= FRAME_DURATION) {
    if ((Network.isHost && Network.connectionActive) || (gameState && gameState.isTestMode)) {
      hostUpdate();
    } else {
      const isSelectingPerk = Boolean(gameState.perkSelection && gameState.perkSelection.active);
      if (p1Tank && Network.myPlayerId === 1 && !Network.connectionActive && !gameState.gameOver && !isSelectingPerk) {
        p1Tank.slowedByEnemyTrack = isTankOnEnemySlowingTrack(p1Tank);
        p1Tank.update(localInput, null, gameState.map, canvasWidth, canvasHeight, tileSize, checkMapCollision, () => false, {
          iceGrid: gameState.ice,
          enemyTrackSlow: p1Tank.slowedByEnemyTrack
        });
        if (localInput.reloadClip) {
          startManualReloadForTank(p1Tank);
          localInput.reloadClip = false;
        }
        if (localInput.useRepair && p1Tank.canUseRepairKit()) {
          useRepairKitForTank(p1Tank);
          localInput.useRepair = false;
        }
        if (localInput.useSmoke && p1Tank.canUseSmoke()) {
          useSmokeForTank(p1Tank);
          localInput.useSmoke = false;
        }
        if (localInput.artilleryStrike && p1Tank.canUseArtillery()) {
          useArtilleryForTank(p1Tank, localInput.artilleryStrike.col, localInput.artilleryStrike.row);
          localInput.artilleryStrike = null;
        }
        if (localInput.placeMine) {
          triggerActiveAbilityForTank(p1Tank);
          localInput.placeMine = false;
        }
        if (localInput.shoot && p1Tank.canShoot()) {
          spawnBullet(p1Tank);
        }
        updateBulletsAndCollisions();
        updateMinesAndCollisions();
        updateTankPassives();
        updateHUD();
      } else if (!Network.isHost && Network.connectionActive && (localInput.shoot || localInput.placeMine || localInput.useSmoke || localInput.useRepair || localInput.reloadClip || localInput.artilleryStrike)) {
        // Підтримка безперервної передачі стану затиснутої стрільби, активок, перезарядки та ремкомплекту для клієнта
        Network.sendInput(localInput);
        if (localInput.placeMine) localInput.placeMine = false;
        if (localInput.useSmoke) localInput.useSmoke = false;
        if (localInput.useRepair) localInput.useRepair = false;
        if (localInput.reloadClip) localInput.reloadClip = false;
        if (localInput.artilleryStrike) localInput.artilleryStrike = null;
      }
      updateParticlesVfx(p1Tank, p2Tank, gameState);
      updateExplosionsVfx(gameState);
    }
    accumulator -= FRAME_DURATION;
  }

  drawGame();
  requestAnimationFrame(gameLoop);
}

export function initApp() {
  initLoadoutDropdowns();
  setupMobileControls();
  initUIEventListeners();
  MapEditor.init();
  updateHostMapDropdown();
  updateAllMapPreviews();
  renderMechanicsCatalog();
  updateTelemetryUI();

  const initialMaps = MapStorage.getMaps();
  if (initialMaps && initialMaps[0]) {
    setupGameMap(initialMaps[0]);
  }
  updateAllMapPreviews();

  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');

    if (roomParam) {
      showGuestSetupView(roomParam);
    }
  }

  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(gameLoop);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}
