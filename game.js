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
  getRarityWeightWithLuck, PHANTOM_FORBIDDEN_PERKS,
  GAME_MODES, BASE_CURSE_CHANCE, CURSE_TYPES, PHANTOM_FORBIDDEN_CURSES,
  BABY_FORBIDDEN_PERKS, BABY_FORBIDDEN_CURSES,
  SNIPER_FORBIDDEN_PERKS, SNIPER_FORBIDDEN_CURSES,
  MAP_EVENTS
} from './config.js?v=20261011_v17';
import { MapEditor, MapStorage, updateHostMapDropdown, renderMapPreview, updateAllMapPreviews } from './editor.js?v=20261011_v17';
import Network from './network.js?v=20261011_v17';
import { sound, SoundFX } from './audio.js?v=20261011_v17';
import {
  trackMarks, triggerScreenShake, spawnTrackMarks, isTankOnEnemySlowingTrack,
  spawnDebris, spawnMuzzleFlash, spawnSmoke,
  TracerTrail, tracerTrails, spawnTracerTrail,
  updateParticles as updateParticlesVfx,
  updateExplosions as updateExplosionsVfx
} from './vfx.js?v=20261011_v17';
import {
  tileSize, canvasWidth, canvasHeight,
  MAX_SCORE, setTargetWinScore, selectedGameModes, setGameModes,
  p1Tank, p2Tank, localLoadout,
  testTargetPlayerId, currentFps, setCurrentFps, gameState, localInput,
  calculateGameDimensions, setupGameMap, restoreMapState,
  resetRoundSpawns, resetForRematch, setMapEvent
} from './state.js?v=20261011_v17';
import {
  checkLineOfSight, isInVisionCone, isTankInLowBushes,
  isObserverBlindedByLowBushes, isTankInLightHullCamo,
  isVisionBlockedByEnemySmoke, canPlayerSeeBullet, canPlayerSeeTracer, canPlayerSeeTrack,
  canPlayerSeeMine, canPlayerSeeMuzzleEffect, isTankInSmoke,
  isTankInBushes, isTankInWaterCamo, isTankSniperCamouflaged, isTankCamouflaged,
  shouldDrawTankOverlayHighlight, updatePlayersVisibilityState
} from './vision.js?v=20261011_v17';
import {
  rollPerkOptionsForTank, rollCurseForTank, rollOptionCursesForTank,
  startPerkSelection, rerollPerkOptions, selectPerk, renderPerkSelectionUI
} from './perks.js?v=20261011_v17';
import {
  calculateArmorDamage, checkMapCollision, checkTankCollision, spawnBullet,
  placeMineForTank, useSmokeForTank, useArtilleryForTank, executeArtilleryExplosion,
  executeEnvironmentalArtillery,
  useBeaconForTank, useSpotEnemyForTank, triggerGuidedBulletForTank, useTurboForTank,
  surrenderMatch, triggerActiveAbilityForTank, processTankActionInputs,
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
  addTestPerkForPlayer, removeTestPerkForPlayer,
  addTestCurseForPlayer, removeTestCurseForPlayer,
  clearTestPerksForPlayer,
  healAndResetCooldownsInTestMode, renderTestModeUI
} from './sandbox.js?v=20261011_v17';
import {
  syncGameModeCheckboxes, readGameModeCheckboxes,
  renderRematchUI, requestRematch, renderMechanicsCatalog,
  updateTelemetryUI, renderPerksSidebars, updateHUD,
  setConnectionStatus, startActiveMatch, returnToMainMenu,
  updateLoadoutStatsDesc, showGuestSetupView, initLoadoutDropdowns,
  initUIEventListeners, showAbilityToast
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
  GAME_MODES, BASE_CURSE_CHANCE, CURSE_TYPES, PHANTOM_FORBIDDEN_CURSES,
  BABY_FORBIDDEN_PERKS, BABY_FORBIDDEN_CURSES,
  SNIPER_FORBIDDEN_PERKS, SNIPER_FORBIDDEN_CURSES,
  MAP_EVENTS,
  sound, SoundFX,
  trackMarks, triggerScreenShake, spawnTrackMarks, isTankOnEnemySlowingTrack,
  spawnDebris, spawnMuzzleFlash, spawnSmoke,
  TracerTrail, tracerTrails, spawnTracerTrail,
  MAX_SCORE, setTargetWinScore, selectedGameModes, setGameModes,
  p1Tank, p2Tank, localLoadout,
  testTargetPlayerId, currentFps, gameState, localInput,
  calculateGameDimensions, setupGameMap, restoreMapState,
  resetRoundSpawns, resetForRematch, setMapEvent,
  checkLineOfSight, isInVisionCone, isTankInLowBushes,
  isObserverBlindedByLowBushes, isTankInLightHullCamo,
  isVisionBlockedByEnemySmoke, canPlayerSeeBullet, canPlayerSeeTracer, canPlayerSeeTrack,
  canPlayerSeeMine, canPlayerSeeMuzzleEffect, isTankInSmoke,
  isTankInBushes, isTankInWaterCamo, isTankSniperCamouflaged, isTankCamouflaged,
  shouldDrawTankOverlayHighlight, updatePlayersVisibilityState,
  rollPerkOptionsForTank, rollCurseForTank, rollOptionCursesForTank,
  startPerkSelection, rerollPerkOptions, selectPerk, renderPerkSelectionUI,
  calculateArmorDamage, checkMapCollision, checkTankCollision, spawnBullet,
  placeMineForTank, useSmokeForTank, useArtilleryForTank, executeArtilleryExplosion,
  executeEnvironmentalArtillery,
  useBeaconForTank, useSpotEnemyForTank, triggerGuidedBulletForTank, useTurboForTank,
  surrenderMatch, triggerActiveAbilityForTank, processTankActionInputs,
  cycleActiveForTank, selectActiveForTank, startManualReloadForTank,
  useRepairKitForTank, applyThornsDamage, handleTankKill,
  updateBulletsAndCollisions, updateMinesAndCollisions, updateTankPassives,
  drawVisionCone, drawAimGuide, drawBushesOverlay, drawBushUnderGlow,
  drawPlayerBushHighlight, drawMap, drawLowBushesOverlay,
  drawBlockTargetingOverlay, drawRoundTimer, drawGame,
  renderMapPreview, updateAllMapPreviews,
  startTestMode, switchTestActivePlayer, setTestTargetPlayer,
  addTestPerkForPlayer, removeTestPerkForPlayer,
  addTestCurseForPlayer, removeTestCurseForPlayer,
  clearTestPerksForPlayer,
  healAndResetCooldownsInTestMode, renderTestModeUI,
  syncGameModeCheckboxes, readGameModeCheckboxes,
  renderRematchUI, requestRematch, renderMechanicsCatalog,
  updateTelemetryUI, renderPerksSidebars, updateHUD,
  setConnectionStatus, startActiveMatch, returnToMainMenu,
  updateLoadoutStatsDesc, showGuestSetupView, initLoadoutDropdowns,
  initUIEventListeners, showAbilityToast,
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
let lastRenderTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
const FRAME_DURATION = 1000 / 60;
let accumulator = 0;

export function gameLoop(now) {
  try {
    if (!now) now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const elapsedSinceLastRender = now - lastRenderTime;

    // Лок/обмеження на 60 FPS для моніторів із високою частотою оновлення (120/144/240 Гц)
    if (elapsedSinceLastRender < 15.5) {
      return;
    }
    lastRenderTime = now;

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

    // Запобігання переповненню акумулятора при перемиканні вкладок або затримках
    if (accumulator > FRAME_DURATION * 10) {
      accumulator = FRAME_DURATION * 10;
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
            enemyTrackSlow: p1Tank.slowedByEnemyTrack,
            gameState
          });
          processTankActionInputs(p1Tank, localInput, true);
          updateBulletsAndCollisions();
          updateMinesAndCollisions();
          updateTankPassives();
          updateHUD();
        } else if (!Network.isHost && Network.connectionActive) {
          const hasActionInput = Boolean(
            localInput.shoot || localInput.placeMine || localInput.useSmoke ||
            localInput.useBeacon || localInput.useRadar || localInput.toggleGuided ||
            localInput.useTurbo || localInput.useRepair || localInput.reloadClip ||
            localInput.artilleryStrike
          );
          const hasMoveInput = Boolean(localInput.up || localInput.down || localInput.left || localInput.right);
          if (hasActionInput || hasMoveInput) {
            // Підтримка безперервної передачі стану руху, затиснутої стрільби, активок, перезарядки та ремкомплекту для клієнта
            Network.sendInput(localInput);
          }
          if (localInput.placeMine) localInput.placeMine = false;
          if (localInput.useSmoke) localInput.useSmoke = false;
          if (localInput.useBeacon) localInput.useBeacon = false;
          if (localInput.useRadar) localInput.useRadar = false;
          if (localInput.toggleGuided) localInput.toggleGuided = false;
          if (localInput.useTurbo) localInput.useTurbo = false;
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
  } catch (loopError) {
    console.error('Помилка в ігровому циклі gameLoop:', loopError);
  } finally {
    requestAnimationFrame(gameLoop);
  }
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
