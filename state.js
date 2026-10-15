/**
 * state.js — Центральне сховище стану гри (Central State Store & Arena Lifecycle)
 *
 * Відповідає за:
 * - Глобальний стан арени (gameState, p1Tank, p2Tank, renderTanks, lastKnownEnemy)
 * - Параметри сітки та Canvas (gridCols, gridRows, tileSize, canvasWidth, canvasHeight, tankSize)
 * - Стан вводу (localInput, p1Input, p2Input, mouseX, mouseY) та спорядження (localLoadout, p1Loadout, p2Loadout)
 * - Життєвий цикл карти та раундів (calculateGameDimensions, setupGameMap, restoreMapState, resetRoundSpawns, resetForRematch)
 */

import { TILE_BY_ID, TILE_TYPES, syncTileRegistry, generateTileBijection } from './tiles.js?v=20261011_v17';
import { Tank, FlyingOrb } from './entities.js?v=20261011_v17';
import { WIN_SCORE, MIN_WIN_SCORE, MAX_WIN_SCORE, MAP_EVENTS } from './config.js?v=20261011_v17';
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

// Обрані режими матчу (Здібності, Прокляття, Події на карті [болванка], Фізика [болванка])
export let selectedGameModes = {
  perks: true,
  curses: true,
  mapEvents: false,
  physics: false
};
export function setGameModes(modes) {
  if (!modes || typeof modes !== 'object') return selectedGameModes;
  let perks = modes.perks !== undefined ? Boolean(modes.perks) : Boolean(selectedGameModes.perks);
  let curses = modes.curses !== undefined ? Boolean(modes.curses) : Boolean(selectedGameModes.curses);
  const cursesJustTurnedOn = !selectedGameModes.curses && modes.curses === true;
  if ((modes.coupledTrigger === 'curses' || modes.perks === undefined || cursesJustTurnedOn) && modes.curses === true) {
    perks = true;
    curses = true;
  } else if (!perks) {
    curses = false;
  }
  selectedGameModes = {
    perks,
    curses,
    mapEvents: modes.mapEvents !== undefined ? Boolean(modes.mapEvents) : Boolean(selectedGameModes.mapEvents),
    physics: modes.physics !== undefined ? Boolean(modes.physics) : Boolean(selectedGameModes.physics)
  };
  if (gameState) {
    gameState.gameModes = { ...selectedGameModes };
  }
  return selectedGameModes;
}

export const RESPAWN_DELAY_FRAMES = 120;
export const PROXIMITY_REVEAL_DIST = 90;
export let roundResetTimer = 0;
export let lastRoundLoserId = 0;

export let p1Tank = null;
export let p2Tank = null;
export let p3Tank = null;
export let p4Tank = null;
export let tanks = [];

// Спорядження гравців
export const localLoadout = { hull: 'standard', turret: 'standard' };
export let p1Loadout = { hull: 'standard', turret: 'standard' };
export let p2Loadout = { hull: 'standard', turret: 'standard' };
export let p3Loadout = { hull: 'standard', turret: 'standard' };
export let p4Loadout = { hull: 'standard', turret: 'standard' };

// Конфігурація 4 слотів лобі
export let playerSlots = [
  { id: 1, type: 'human', team: 1, loadout: { hull: 'standard', turret: 'standard' }, isReady: true, name: 'Гравець 1 (Хост)' },
  { id: 2, type: 'human', team: 2, loadout: { hull: 'standard', turret: 'standard' }, isReady: false, name: 'Гравець 2' },
  { id: 3, type: 'none', team: 3, loadout: { hull: 'standard', turret: 'standard' }, isReady: false, name: 'Гравець 3' },
  { id: 4, type: 'none', team: 4, loadout: { hull: 'standard', turret: 'standard' }, isReady: false, name: 'Гравець 4' }
];

// Командні налаштування та рахунок (підтримка 2, 3, 4 команд)
export let teamScores = { 1: 0, 2: 0, 3: 0, 4: 0 };
export let teamSettings = {
  friendlyFire: false, // окремий вибір: куля влучає в союзника, але 0 шкоди від усіх факторів
  sharedVision: true   // окремий вибір: союзники діляться тактичним оглядом
};

// ID гравця, для якого зараз відкритий редактор здібностей у Зоні Тестування (1..4)
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
  p3: null,
  p4: null,
  tanks: [],
  playerSlots: [...playerSlots],
  teamScores: { ...teamScores },
  teamSettings: { ...teamSettings },
  bullets: [],
  mines: [],
  smokeClouds: [],
  pendingArtilleryStrikes: [],
  explosions: [],
  score1: 0,
  score2: 0,
  targetScore: MAX_SCORE,
  gameModes: { ...selectedGameModes },
  currentMapEvent: null, // 'darkness' | 'acid_rain' | 'artillery_barrage' | 'battle_royale' | 'snow_storm' | 'shuffled_blocks' | 'chaos_orbs' | 'reverse_vision' | null
  mapEventBannerTimer: 0, // 75 кадрів (~1.25 секунди) на старті раунду
  battleRoyaleZone: null,
  envArtilleryTimer: 0,
  envArtilleryStrikes: [],
  acidRainTickTimer: 0,
  roundTimeFrames: 0, currentMapEvent: null, mapEventBannerTimer: 0, battleRoyaleZone: null, envArtilleryTimer: 0, envArtilleryStrikes: [], acidRainTickTimer: 0, tilePropertyMap: null, flyingOrbs: [], orbSpawnTimer: 0,
  tilePropertyMap: null, // Взаємно однозначна бієкція для shuffled_blocks: { [tileId]: mappedTileId }
  flyingOrbs: [], // Літаючі аномальні сфери для chaos_orbs
  orbSpawnTimer: 0,
  gameOver: false,
  winner: 0,
  isEnemyVisible: true,
  visibility: { p1CanSeeP2: true, p2CanSeeP1: true },
  perkSelection: {
    active: false,
    loserId: 0,
    options: [],
    optionCurses: {},
    picksRemaining: 1,
    totalPicks: 1,
    rerollsLeft: 0
  },
  rematch: {
    p1Ready: false,
    p2Ready: false
  }
};

// Інтерполяція рендерингу (роздільні кути корпусу та вежі для 4 танків)
export const renderTanks = {
  p1: { x: 0, y: 0, bodyAngle: Math.PI / 2, turretAngle: Math.PI / 2 },
  p2: { x: 0, y: 0, bodyAngle: -Math.PI / 2, turretAngle: -Math.PI / 2 },
  p3: { x: 0, y: 0, bodyAngle: Math.PI, turretAngle: Math.PI },
  p4: { x: 0, y: 0, bodyAngle: 0, turretAngle: 0 }
};

export let previousVisibleState = false;
export const lastKnownEnemy = { x: 0, y: 0, bodyAngle: 0, turretAngle: 0, alpha: 0 };

// Введення (керування)
export const localInput = {
  up: false, down: false, left: false, right: false,
  shoot: false, placeMine: false, useSmoke: false, artilleryStrike: null,
  useBeacon: false, useRadar: false, toggleGuided: false, useTurbo: false,
  useRepair: false, reloadClip: false,
  selectedActive: null,
  turretAngle: 0,
  aimX: 320,
  aimY: 320
};
export let p1Input = {
  up: false, down: false, left: false, right: false,
  shoot: false, placeMine: false, useSmoke: false, artilleryStrike: null,
  useBeacon: false, useRadar: false, toggleGuided: false, useTurbo: false,
  useRepair: false, reloadClip: false,
  selectedActive: null,
  turretAngle: Math.PI / 2,
  aimX: 320,
  aimY: 320
};
export let p2Input = {
  up: false, down: false, left: false, right: false,
  shoot: false, placeMine: false, useSmoke: false, artilleryStrike: null,
  useBeacon: false, useRadar: false, toggleGuided: false, useTurbo: false,
  useRepair: false, reloadClip: false,
  selectedActive: null,
  turretAngle: -Math.PI / 2,
  aimX: 320,
  aimY: 320
};
export let p3Input = {
  up: false, down: false, left: false, right: false,
  shoot: false, placeMine: false, useSmoke: false, artilleryStrike: null,
  useBeacon: false, useRadar: false, toggleGuided: false, useTurbo: false,
  useRepair: false, reloadClip: false,
  selectedActive: null,
  turretAngle: Math.PI,
  aimX: 320,
  aimY: 320
};
export let p4Input = {
  up: false, down: false, left: false, right: false,
  shoot: false, placeMine: false, useSmoke: false, artilleryStrike: null,
  useBeacon: false, useRadar: false, toggleGuided: false, useTurbo: false,
  useRepair: false, reloadClip: false,
  selectedActive: null,
  turretAngle: 0,
  aimX: 320,
  aimY: 320
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
  sendLocalInput: () => {},
  showAbilityToast: () => {},
  renderLobbySlots: () => {},
  updateLobbyStartValidation: () => {}
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
export function setP3Loadout(loadout) {
  p3Loadout = { ...loadout };
}
export function setP4Loadout(loadout) {
  p4Loadout = { ...loadout };
}
export function setTestTargetPlayerId(id) {
  testTargetPlayerId = Math.max(1, Math.min(4, Number(id) || 1));
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
export function setP3Input(input) {
  p3Input = input;
}
export function setP4Input(input) {
  p4Input = input;
}
export function setPlayerSlots(slots) {
  if (Array.isArray(slots)) {
    playerSlots = slots.map(s => ({ ...s, loadout: { ...s.loadout } }));
    if (gameState) gameState.playerSlots = [...playerSlots];
  }
  return playerSlots;
}
export function setTeamSettings(settings) {
  if (settings && typeof settings === 'object') {
    teamSettings = { ...teamSettings, ...settings };
    if (gameState) gameState.teamSettings = { ...teamSettings };
  }
  return teamSettings;
}
export function setTeamScore(teamId, score) {
  teamScores[teamId] = Number(score) || 0;
  if (gameState && gameState.teamScores) {
    gameState.teamScores[teamId] = teamScores[teamId];
  }
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
export function setupGameMap(mapData, customSlots = null) {
  if (Array.isArray(customSlots)) {
    setPlayerSlots(customSlots);
  }
  mapData = mapData || { name: 'Класична', width: 16, height: 16, grid: [] };
  gridCols = mapData.width || 16;
  gridRows = mapData.height || 16;

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

  const p1Spawn = mapData.p1Spawn || { x: 1, y: 1 };
  const p2Spawn = mapData.p2Spawn || { x: Math.max(1, gridCols - 2), y: Math.max(1, gridRows - 2) };
  const p3Spawn = mapData.p3Spawn || { x: Math.max(1, gridCols - 2), y: 1 };
  const p4Spawn = mapData.p4Spawn || { x: 1, y: Math.max(1, gridRows - 2) };

  const spawnPad = Math.floor((tileSize - tankSize) / 2);
  const p1X = p1Spawn.x * tileSize + spawnPad;
  const p1Y = p1Spawn.y * tileSize + spawnPad;
  const p2X = p2Spawn.x * tileSize + spawnPad;
  const p2Y = p2Spawn.y * tileSize + spawnPad;
  const p3X = p3Spawn.x * tileSize + spawnPad;
  const p3Y = p3Spawn.y * tileSize + spawnPad;
  const p4X = p4Spawn.x * tileSize + spawnPad;
  const p4Y = p4Spawn.y * tileSize + spawnPad;

  if (Network.myPlayerId === 1) {
    p1Loadout = { ...localLoadout };
  } else if (Network.myPlayerId === 2) {
    p2Loadout = { ...localLoadout };
  } else if (Network.myPlayerId === 3) {
    p3Loadout = { ...localLoadout };
  } else if (Network.myPlayerId === 4) {
    p4Loadout = { ...localLoadout };
  }

  syncTileRegistry();

  const wasTestMode = Boolean(gameState && gameState.isTestMode);
  const wasRunning = Boolean(gameState && gameState.isRunning);
  const testTankCount = (gameState && gameState.sandboxTankCount) ? gameState.sandboxTankCount : 2;

  const slot1 = (playerSlots && playerSlots[0]) || { team: 1, loadout: p1Loadout };
  const slot2 = (playerSlots && playerSlots[1]) || { team: 2, loadout: p2Loadout };
  const slot3 = (playerSlots && playerSlots[2]) || { team: 3, loadout: p3Loadout };
  const slot4 = (playerSlots && playerSlots[3]) || { team: 4, loadout: p4Loadout };

  p1Tank = new Tank(1, p1X, p1Y, Math.PI / 2, { size: tankSize, hull: slot1.loadout.hull, turret: slot1.loadout.turret, team: slot1.team });
  p2Tank = new Tank(2, p2X, p2Y, -Math.PI / 2, { size: tankSize, hull: slot2.loadout.hull, turret: slot2.loadout.turret, team: slot2.team });

  const needP3 = (slot3.type !== 'none' && slot3.type !== undefined) || (wasTestMode && testTankCount >= 3);
  p3Tank = needP3
    ? new Tank(3, p3X, p3Y, Math.PI, { size: tankSize, hull: slot3.loadout.hull, turret: slot3.loadout.turret, team: slot3.team })
    : null;

  const needP4 = (slot4.type !== 'none' && slot4.type !== undefined) || (wasTestMode && testTankCount >= 4);
  p4Tank = needP4
    ? new Tank(4, p4X, p4Y, 0, { size: tankSize, hull: slot4.loadout.hull, turret: slot4.loadout.turret, team: slot4.team })
    : null;

  tanks = [p1Tank, p2Tank, p3Tank, p4Tank].filter(Boolean);

  gameState = {
    isRunning: wasRunning,
    isTestMode: wasTestMode,
    sandboxTankCount: testTankCount,
    mapName: mapData.name,
    width: gridCols,
    height: gridRows,
    tileSize: tileSize,
    tankSize: tankSize,
    canvasWidth: canvasWidth,
    canvasHeight: canvasHeight,
    map: mapGrid,
    bushes: bushesGrid,
    ice: iceGrid,
    tileHp: tileHpGrid,
    p1: p1Tank,
    p2: p2Tank,
    p3: p3Tank,
    p4: p4Tank,
    tanks: tanks,
    playerSlots: [...playerSlots],
    teamScores: { ...teamScores },
    teamSettings: { ...teamSettings },
    bullets: [],
    mines: [],
    smokeClouds: [],
    explosions: [],
    pendingArtilleryStrikes: [],
    score1: 0,
    score2: 0,
    targetScore: MAX_SCORE,
    gameModes: { ...selectedGameModes },
    roundTimeFrames: 0, currentMapEvent: null, mapEventBannerTimer: 0, battleRoyaleZone: null, envArtilleryTimer: 0, envArtilleryStrikes: [], acidRainTickTimer: 0, tilePropertyMap: null, flyingOrbs: [], orbSpawnTimer: 0,
    gameOver: false,
    winner: 0,
    isEnemyVisible: true,
    visibility: { p1CanSeeP2: true, p2CanSeeP1: true },
    perkSelection: {
      active: false,
      loserId: 0,
      options: [],
      optionCurses: {},
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

  if (p3Tank) {
    renderTanks.p3.x = p3X;
    renderTanks.p3.y = p3Y;
    renderTanks.p3.bodyAngle = Math.PI;
    renderTanks.p3.turretAngle = Math.PI;
    setLastTankPos(3, p3X, p3Y, Math.PI);
  }
  if (p4Tank) {
    renderTanks.p4.x = p4X;
    renderTanks.p4.y = p4Y;
    renderTanks.p4.bodyAngle = 0;
    renderTanks.p4.turretAngle = 0;
    setLastTankPos(4, p4X, p4Y, 0);
  }

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
  gameState.pendingArtilleryStrikes = [];
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

  if (gameState) {
    p1Tank.roundsLost = gameState.score2 || 0;
    p2Tank.roundsLost = gameState.score1 || 0;
  }

  tanks.forEach(tank => {
    if (tank) {
      tank.respawn();
      const pKey = `p${tank.id}`;
      if (renderTanks[pKey]) {
        renderTanks[pKey].x = tank.spawnX;
        renderTanks[pKey].y = tank.spawnY;
        renderTanks[pKey].bodyAngle = tank.spawnAngle;
        renderTanks[pKey].turretAngle = tank.spawnAngle;
      }
      setLastTankPos(tank.id, tank.spawnX, tank.spawnY, tank.spawnAngle);
    }
  });

  gameState.bullets = [];
  gameState.mines = [];
  gameState.smokeClouds = [];
  gameState.pendingArtilleryStrikes = [];
  gameState.roundTimeFrames = 0;
  localInput.shoot = false;
  localInput.placeMine = false;
  localInput.useSmoke = false;
  localInput.artilleryStrike = null;
  localInput.useBeacon = false;
  localInput.useRadar = false;
  localInput.toggleGuided = false;
  localInput.useTurbo = false;

  [p1Input, p2Input, p3Input, p4Input].forEach(inp => {
    if (inp) {
      inp.shoot = false;
      inp.placeMine = false;
      inp.useSmoke = false;
      inp.artilleryStrike = null;
      inp.useBeacon = false;
      inp.useRadar = false;
      inp.toggleGuided = false;
      inp.useTurbo = false;
    }
  });

  // Динамічні карти: з імовірністю 90% активується одна з подій (10% звичайна гра)
  if (selectedGameModes.mapEvents && (Network.isHost || gameState.isTestMode || !Network.connectionActive)) {
    const roll = Math.random();
    let chosenEvent = null;
    if (roll < 0.90) {
      const keys = Object.keys(MAP_EVENTS);
      chosenEvent = keys[Math.floor(Math.random() * keys.length)];
    }
    setMapEvent(chosenEvent, true);
    if (Network.isHost && Network.connectionActive) {
      Network.sendEvent('mapEventSelected', {
        eventId: chosenEvent,
        tilePropertyMap: gameState.tilePropertyMap
      });
    }
  } else if (!selectedGameModes.mapEvents) {
    setMapEvent(null, false);
  }

  Network.sendEvent('roundReset');
  showToast(`⚔️ РАУНД ${gameState.score1 + gameState.score2 + 1}!`);
  uiHooks.updateHUD();
}

/**
 * Встановлення поточної активної події карти («Динамічні карти»)
 * @param {string|null} eventId - 'darkness' | 'acid_rain' | 'artillery_barrage' | 'battle_royale' | 'snow_storm' | 'shuffled_blocks' | 'chaos_orbs' | null
 * @param {boolean} forceBanner - показувати напис на початку (180 кадрів = ~3.0 секунди)
 */
export function setMapEvent(eventId, forceBanner = true) {
  if (!gameState) return null;
  gameState.currentMapEvent = (eventId && MAP_EVENTS[eventId]) ? eventId : null;
  gameState.mapEventBannerTimer = forceBanner ? 180 : 0;
  gameState.envArtilleryTimer = 0;
  gameState.envArtilleryStrikes = [];
  gameState.acidRainTickTimer = 0;
  gameState.flyingOrbs = [];
  gameState.orbSpawnTimer = 0;
  gameState.tilePropertyMap = null;

  if (gameState.currentMapEvent === 'shuffled_blocks') {
    gameState.tilePropertyMap = generateTileBijection(TILE_TYPES);
  } else if (gameState.currentMapEvent === 'chaos_orbs') {
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    gameState.flyingOrbs = [new FlyingOrb(cx, cy)];
  } else if (gameState.currentMapEvent === 'battle_royale') {
    const maxR = Math.hypot(canvasWidth, canvasHeight) / 2;
    gameState.battleRoyaleZone = {
      cx: canvasWidth / 2,
      cy: canvasHeight / 2,
      x: canvasWidth / 2,
      y: canvasHeight / 2,
      radius: maxR,
      maxRadius: maxR
    };
    gameState.battleRoyaleDamageTimer = 0;
  } else {
    gameState.battleRoyaleZone = null;
  }
  return gameState.currentMapEvent;
}

/**
 * Перезапуск гри після завершення матчу (Реванш) — скидає всі здібності, міни та рахунок,
 * застосовуючи обрану під час реваншу карту, кількість перемог, режими та спорядження (корпус + дуло)
 */
export function resetForRematch() {
  roundResetTimer = 0;
  lastRoundLoserId = 0;
  if (p1Tank) {
    p1Tank.roundsLost = 0;
    p1Tank.resetPerks();
  }
  if (p2Tank) {
    p2Tank.roundsLost = 0;
    p2Tank.resetPerks(); if (p3Tank) { p3Tank.roundsLost = 0; p3Tank.resetPerks(); } if (p4Tank) { p4Tank.roundsLost = 0; p4Tank.resetPerks(); }
  }
  if (currentActiveMap) {
    setupGameMap(currentActiveMap);
  } else if (gameState) {
    gameState.bullets = [];
    gameState.mines = [];
    gameState.smokeClouds = [];
    gameState.explosions = [];
    gameState.pendingArtilleryStrikes = [];
    gameState.score1 = 0;
    gameState.score2 = 0;
    gameState.targetScore = MAX_SCORE;
    gameState.gameModes = { ...selectedGameModes };
    gameState.roundTimeFrames = 0;
    gameState.gameOver = false;
    gameState.winner = 0;
    gameState.perkSelection = { active: false, loserId: 0, options: [], optionCurses: {}, picksRemaining: 1, totalPicks: 1, rerollsLeft: 0 };
    gameState.rematch = { p1Ready: false, p2Ready: false };
  }
  if (gameState) {
    gameState.targetScore = MAX_SCORE;
    gameState.gameModes = { ...selectedGameModes };
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
    p2Tank.ammo = p2Tank.clipSize; if (p3Tank) { p3Tank.applyLoadout(p3Loadout.hull, p3Loadout.turret); p3Tank.hp = p3Tank.maxHp; p3Tank.ammo = p3Tank.clipSize; } if (p4Tank) { p4Tank.applyLoadout(p4Loadout.hull, p4Loadout.turret); p4Tank.hp = p4Tank.maxHp; p4Tank.ammo = p4Tank.clipSize; }
  }
  const overlay = typeof document !== 'undefined' ? document.getElementById('gameOverOverlay') : null;
  if (overlay) overlay.classList.add('hidden');
  uiHooks.renderPerkSelectionUI();
  uiHooks.renderRematchUI();
  uiHooks.updateHUD();
}
