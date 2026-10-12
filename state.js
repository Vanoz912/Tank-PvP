/**
 * state.js — Центральне сховище стану гри (Central State Store & Arena Lifecycle)
 *
 * Відповідає за:
 * - Глобальний стан арени (gameState, p1Tank, p2Tank, renderTanks, lastKnownEnemy)
 * - Параметри сітки та Canvas (gridCols, gridRows, tileSize, canvasWidth, canvasHeight, tankSize)
 * - Стан вводу (localInput, p1Input, p2Input, mouseX, mouseY) та спорядження (localLoadout, p1Loadout, p2Loadout)
 * - Життєвий цикл карти та раундів (calculateGameDimensions, setupGameMap, restoreMapState, resetRoundSpawns, resetForRematch)
 */

import { TILE_BY_ID, syncTileRegistry } from './tiles.js?v=20261011_v17';
import { Tank } from './entities.js?v=20261011_v17';
import { WIN_SCORE, MIN_WIN_SCORE, MAX_WIN_SCORE } from './config.js?v=20261011_v17';
import { showToast } from './editor.js?v=20261011_v17';
import Network from './network.js?v=20261011_v17';
import { setLastTankPos, clearVfxState } from './vfx.js?v=20261011_v17';

export let currentActiveMap = null;
export let gridCols = 16;
export let gridRows = 16;
export let tileSize = 32;
export let canvasWidth = 640;
export let canvasHeight = 640;
export let tankSize = 26;

// Налаштовувана кількість перемог у матчі (від 3 до 15, за замовчуванням 5)
export let MAX_SCORE = WIN_SCORE || 5;
export function setTargetWinScore(score) {
  const num = Math.round(Number(score) || WIN_SCORE || 5);
  const clamped = Math.max(MIN_WIN_SCORE || 3, Math.min(MAX_WIN_SCORE || 15, num));
  MAX_SCORE = clamped;
  if (gameState) {
    gameState.targetScore = clamped;
  }
  return clamped;
}

export const RESPAWN_DELAY_FRAMES = 120;
export const PROXIMITY_REVEAL_DIST = 90;
export let roundResetTimer = 0;
export let lastRoundLoserId = 0;

export let p1Tank = null;
export let p2Tank = null;

// Спорядження гравців
export const localLoadout = { hull: 'standard', turret: 'standard' };
export let p1Loadout = { hull: 'standard', turret: 'standard' };
export let p2Loadout = { hull: 'standard', turret: 'standard' };

// ID гравця, для якого зараз відкритий редактор здібностей у Зоні Тестування (1 або 2)
export let testTargetPlayerId = 1;

// Телеметрія (FPS та Ping)
export let currentFps = 60;

export let gameState = {
  isTestMode: false,
  mapName: 'Класична',
  width: 16,
  height: 16,
  map: [],
  bushes: [],
  ice: [],
  tileHp: [],
  p1: null,
  p2: null,
  bullets: [],
  mines: [],
  smokeClouds: [],
  explosions: [],
  score1: 0,
  score2: 0,
  targetScore: MAX_SCORE,
  roundTimeFrames: 0,
  gameOver: false,
  winner: 0,
  isEnemyVisible: true,
  visibility: { p1CanSeeP2: true, p2CanSeeP1: true },
  perkSelection: {
    active: false,
    loserId: 0,
    options: [],
    picksRemaining: 1,
    totalPicks: 1,
    rerollsLeft: 0
  },
  rematch: {
    p1Ready: false,
    p2Ready: false
  }
};

// Інтерполяція рендерингу (роздільні кути корпусу та вежі)
export const renderTanks = {
  p1: { x: 0, y: 0, bodyAngle: Math.PI / 2, turretAngle: Math.PI / 2 },
  p2: { x: 0, y: 0, bodyAngle: -Math.PI / 2, turretAngle: -Math.PI / 2 }
};

export let previousVisibleState = false;
export const lastKnownEnemy = { x: 0, y: 0, bodyAngle: 0, turretAngle: 0, alpha: 0 };

// Введення (керування)
export const localInput = {
  up: false, down: false, left: false, right: false,
  shoot: false, placeMine: false, useSmoke: false, artilleryStrike: null, useRepair: false, reloadClip: false,
  selectedActive: null,
  turretAngle: 0
};
export let p1Input = {
  up: false, down: false, left: false, right: false,
  shoot: false, placeMine: false, useSmoke: false, artilleryStrike: null, useRepair: false, reloadClip: false,
  selectedActive: null,
  turretAngle: Math.PI / 2
};
export let p2Input = {
  up: false, down: false, left: false, right: false,
  shoot: false, placeMine: false, useSmoke: false, artilleryStrike: null, useRepair: false, reloadClip: false,
  selectedActive: null,
  turretAngle: -Math.PI / 2
};

export let mouseX = 320;
export let mouseY = 320;

// Реєстр UI-колбеків для уникнення циклічних залежностей між станом та UI
export const uiHooks = {
  renderPerkSelectionUI: () => {},
  renderRematchUI: () => {},
  renderTestModeUI: () => {},
  renderMechanicsCatalog: () => {},
  updateTelemetryUI: () => {},
  setConnectionStatus: () => {},
  resetPointerHoldState: () => {},
  updateHUD: () => {},
  sendLocalInput: () => {}
};

export function registerUIHooks(hooks) {
  if (hooks && typeof hooks === 'object') {
    Object.assign(uiHooks, hooks);
  }
}

// =========================================================================
// СЕТТЕРИ СТАНУ ДЛЯ SAFE LIVE BINDINGS В ES MODULES
// =========================================================================
export function setRoundResetTimer(val) {
  roundResetTimer = val;
}
export function decrementRoundResetTimer() {
  if (roundResetTimer > 0) roundResetTimer--;
  return roundResetTimer;
}
export function setLastRoundLoserId(id) {
  lastRoundLoserId = id;
}
export function setCurrentActiveMap(map) {
  currentActiveMap = map;
}
export function setP1Loadout(loadout) {
  p1Loadout = { ...loadout };
}
export function setP2Loadout(loadout) {
  p2Loadout = { ...loadout };
}
export function setTestTargetPlayerId(id) {
  testTargetPlayerId = id === 2 ? 2 : 1;
  if (gameState) gameState.testTargetPlayerId = testTargetPlayerId;
  return testTargetPlayerId;
}
export function setCurrentFps(fps) {
  currentFps = fps;
}
export function setPreviousVisibleState(val) {
  previousVisibleState = Boolean(val);
}
export function setP1Input(input) {
  p1Input = input;
}
export function setP2Input(input) {
  p2Input = input;
}
export function setMousePos(x, y) {
  mouseX = x;
  mouseY = y;
}
export function setArenaDims(dims) {
  if (!dims) return;
  if (typeof dims.gridCols === 'number') gridCols = dims.gridCols;
  if (typeof dims.gridRows === 'number') gridRows = dims.gridRows;
  if (typeof dims.tileSize === 'number') tileSize = dims.tileSize;
  if (typeof dims.canvasWidth === 'number') canvasWidth = dims.canvasWidth;
  if (typeof dims.canvasHeight === 'number') canvasHeight = dims.canvasHeight;
  if (typeof dims.tankSize === 'number') tankSize = dims.tankSize;
}

/**
 * Плавна інтерполяція кута в радіанах без стрибків через -PI / PI
 */
export function lerpAngle(current, target, factor) {
  if (!Number.isFinite(current)) return Number.isFinite(target) ? target : 0;
  if (!Number.isFinite(target)) return current;
  let diff = target - current;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  return current + diff * factor;
}

/**
 * Розрахунок логічного розміру клітинки (tileSize) та внутрішньої роздільної здатності Canvas.
 */
export function calculateGameDimensions(cols, rows) {
  const maxDim = Math.max(cols, rows);

  let targetTile;
  if (maxDim <= 16) {
    targetTile = Math.floor(640 / maxDim);
  } else {
    targetTile = Math.max(24, Math.floor(768 / maxDim));
  }

  targetTile = Math.max(20, Math.min(48, targetTile));

  return {
    tileSize: targetTile,
    canvasWidth: cols * targetTile,
    canvasHeight: rows * targetTile
  };
}

/**
 * Ініціалізація та адаптація розміру Canvas під будь-який розмір сітки
 * @param {Object} mapData - Об'єкт карти з localStorage або отриманий по мережі
 */
export function setupGameMap(mapData) {
  gridCols = mapData.width;
  gridRows = mapData.height;

  // Копія масиву клітинок карти, кущів, льоду (на рівні землі) та стану здоров'я блоків (HP)
  const mapGrid = [];
  const bushesGrid = [];
  const iceGrid = [];
  const tileHpGrid = [];
  for (let r = 0; r < gridRows; r++) {
    mapGrid[r] = [];
    bushesGrid[r] = [];
    iceGrid[r] = [];
    tileHpGrid[r] = [];
    for (let c = 0; c < gridCols; c++) {
      const tileId = mapData.grid && mapData.grid[r] ? mapData.grid[r][c] : 0;
      mapGrid[r][c] = tileId;
      bushesGrid[r][c] = (mapData.bushes && mapData.bushes[r]) ? (mapData.bushes[r][c] || 0) : 0;
      const hasGroundIce = (mapData.ice && mapData.ice[r] && mapData.ice[r][c] === 1) || tileId === 10;
      iceGrid[r][c] = hasGroundIce ? 1 : 0;
      const blockDef = TILE_BY_ID[tileId];
      tileHpGrid[r][c] = (blockDef && blockDef.maxHp) ? blockDef.maxHp : 0;
    }
  }

  currentActiveMap = {
    ...mapData,
    grid: mapGrid.map(row => [...row]),
    bushes: bushesGrid.map(row => [...row]),
    ice: iceGrid.map(row => [...row])
  };

  const dims = calculateGameDimensions(gridCols, gridRows);
  tileSize = dims.tileSize;
  canvasWidth = dims.canvasWidth;
  canvasHeight = dims.canvasHeight;

  tankSize = Math.max(18, Math.floor(tileSize * 0.82));

  if (typeof document !== 'undefined' && document.documentElement) {
    const root = document.documentElement;
    root.style.setProperty('--game-max-width', `${canvasWidth}px`);
    root.style.setProperty('--container-max-width', `${Math.max(1140, canvasWidth + 500)}px`);
  }

  const gameCanvas = typeof document !== 'undefined' ? document.getElementById('gameCanvas') : null;
  if (gameCanvas) {
    gameCanvas.width = canvasWidth;
    gameCanvas.height = canvasHeight;
  }

  const p1Pad = Math.floor((tileSize - tankSize) / 2);
  const p1X = mapData.p1Spawn.x * tileSize + p1Pad;
  const p1Y = mapData.p1Spawn.y * tileSize + p1Pad;

  const p2Pad = Math.floor((tileSize - tankSize) / 2);
  const p2X = mapData.p2Spawn.x * tileSize + p2Pad;
  const p2Y = mapData.p2Spawn.y * tileSize + p2Pad;

  if (Network.myPlayerId === 1) {
    p1Loadout = { ...localLoadout };
  } else if (Network.myPlayerId === 2) {
    p2Loadout = { ...localLoadout };
  }

  syncTileRegistry();

  const wasTestMode = Boolean(gameState && gameState.isTestMode);

  p1Tank = new Tank(1, p1X, p1Y, Math.PI / 2, { size: tankSize, hull: p1Loadout.hull, turret: p1Loadout.turret });
  p2Tank = new Tank(2, p2X, p2Y, -Math.PI / 2, { size: tankSize, hull: p2Loadout.hull, turret: p2Loadout.turret });

  gameState = {
    isTestMode: wasTestMode,
    mapName: mapData.name,
    width: gridCols,
    height: gridRows,
    map: mapGrid,
    bushes: bushesGrid,
    ice: iceGrid,
    tileHp: tileHpGrid,
    p1: p1Tank,
    p2: p2Tank,
    bullets: [],
    mines: [],
    smokeClouds: [],
    explosions: [],
    score1: 0,
    score2: 0,
    targetScore: MAX_SCORE,
    roundTimeFrames: 0,
    gameOver: false,
    winner: 0,
    isEnemyVisible: true,
    visibility: { p1CanSeeP2: true, p2CanSeeP1: true },
    perkSelection: {
      active: false,
      loserId: 0,
      options: [],
      picksRemaining: 1,
      totalPicks: 1,
      rerollsLeft: 0
    },
    rematch: {
      p1Ready: false,
      p2Ready: false
    }
  };

  renderTanks.p1.x = p1X;
  renderTanks.p1.y = p1Y;
  renderTanks.p1.bodyAngle = Math.PI / 2;
  renderTanks.p1.turretAngle = Math.PI / 2;

  renderTanks.p2.x = p2X;
  renderTanks.p2.y = p2Y;
  renderTanks.p2.bodyAngle = -Math.PI / 2;
  renderTanks.p2.turretAngle = -Math.PI / 2;

  setLastTankPos(1, p1X, p1Y, Math.PI / 2);
  setLastTankPos(2, p2X, p2Y, -Math.PI / 2);
  clearVfxState();

  const hudMap = typeof document !== 'undefined' ? document.getElementById('hudMapName') : null;
  if (hudMap) hudMap.textContent = mapData.name;

  roundResetTimer = 0;
  lastRoundLoserId = 0;
  const overlay = typeof document !== 'undefined' ? document.getElementById('gameOverOverlay') : null;
  if (overlay) overlay.classList.add('hidden');
  uiHooks.renderPerkSelectionUI();
  uiHooks.updateHUD();
}

/**
 * Повне відновлення карти до початкового стану після завершення кожного раунду:
 * відновлює всі зруйновані або пошкоджені блоки, їхній запас міцності (HP), кущі, лід та очищує сліди/уламки/міни/дим
 */
export function restoreMapState() {
  if (!currentActiveMap || !gameState) return;
  syncTileRegistry();

  const mapGrid = [];
  const bushesGrid = [];
  const iceGrid = [];
  const tileHpGrid = [];

  for (let r = 0; r < gridRows; r++) {
    mapGrid[r] = [];
    bushesGrid[r] = [];
    iceGrid[r] = [];
    tileHpGrid[r] = [];
    for (let c = 0; c < gridCols; c++) {
      const tileId = (currentActiveMap.grid && currentActiveMap.grid[r]) ? currentActiveMap.grid[r][c] : 0;
      mapGrid[r][c] = tileId;
      bushesGrid[r][c] = (currentActiveMap.bushes && currentActiveMap.bushes[r]) ? (currentActiveMap.bushes[r][c] || 0) : 0;
      const hasGroundIce = (currentActiveMap.ice && currentActiveMap.ice[r] && currentActiveMap.ice[r][c] === 1) || tileId === 10;
      iceGrid[r][c] = hasGroundIce ? 1 : 0;
      const blockDef = TILE_BY_ID[tileId];
      tileHpGrid[r][c] = (blockDef && blockDef.maxHp) ? blockDef.maxHp : 0;
    }
  }

  gameState.map = mapGrid;
  gameState.bushes = bushesGrid;
  gameState.ice = iceGrid;
  gameState.tileHp = tileHpGrid;
  gameState.bullets = [];
  gameState.mines = [];
  gameState.smokeClouds = [];
  gameState.explosions = [];
  gameState.roundTimeFrames = 0;

  clearVfxState();
  lastKnownEnemy.alpha = 0;
}

/**
 * Завершення раунду: оновлення карти до початкового стану та миттєва телепортація ОБОХ гравців на спавн з повним HP та щитами
 */
export function resetRoundSpawns() {
  if (!p1Tank || !p2Tank) return;
  roundResetTimer = 0;

  restoreMapState();

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
  gameState.roundTimeFrames = 0;
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

  Network.sendEvent('roundReset');
  showToast(`⚔️ РАУНД ${gameState.score1 + gameState.score2 + 1}!`);
  uiHooks.updateHUD();
}

/**
 * Перезапуск гри після завершення матчу (Реванш) — скидає всі здібності, міни та рахунок,
 * застосовуючи обрану під час реваншу карту, кількість перемог та спорядження (корпус + дуло)
 */
export function resetForRematch() {
  roundResetTimer = 0;
  lastRoundLoserId = 0;
  if (p1Tank) p1Tank.resetPerks();
  if (p2Tank) p2Tank.resetPerks();
  if (currentActiveMap) {
    setupGameMap(currentActiveMap);
  } else if (gameState) {
    gameState.bullets = [];
    gameState.mines = [];
    gameState.smokeClouds = [];
    gameState.explosions = [];
    gameState.score1 = 0;
    gameState.score2 = 0;
    gameState.targetScore = MAX_SCORE;
    gameState.roundTimeFrames = 0;
    gameState.gameOver = false;
    gameState.winner = 0;
    gameState.perkSelection = { active: false, loserId: 0, options: [], picksRemaining: 1, totalPicks: 1, rerollsLeft: 0 };
    gameState.rematch = { p1Ready: false, p2Ready: false };
  }
  if (gameState) {
    gameState.targetScore = MAX_SCORE;
    gameState.roundTimeFrames = 0;
  }
  if (p1Tank) {
    p1Tank.applyLoadout(p1Loadout.hull, p1Loadout.turret);
    p1Tank.hp = p1Tank.maxHp;
    p1Tank.ammo = p1Tank.clipSize;
  }
  if (p2Tank) {
    p2Tank.applyLoadout(p2Loadout.hull, p2Loadout.turret);
    p2Tank.hp = p2Tank.maxHp;
    p2Tank.ammo = p2Tank.clipSize;
  }
  const overlay = typeof document !== 'undefined' ? document.getElementById('gameOverOverlay') : null;
  if (overlay) overlay.classList.add('hidden');
  uiHooks.renderPerkSelectionUI();
  uiHooks.renderRematchUI();
  uiHooks.updateHUD();
}
