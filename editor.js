/**
 * editor.js — Візуальний редактор карт та керування сховищем (localStorage)
 * 
 * Відповідає за:
 * 1. Динамічну палітру інструментів з tiles.js + спавни P1/P2.
 * 2. Drag-to-draw малювання та стирання на сітці будь-якого розміру (10x10 - 30x30).
 * 3. Валідацію, збереження, завантаження та видалення карт у localStorage.
 * 4. Експорт функції оновлення списку карт у меню хоста.
 */

import { TILE_TYPES, TILE_BY_ID, syncTileRegistry, isGroundDecorTileId } from './tiles.js?v=20261011_v17';

/**
 * Сховище карт у localStorage браузера
 */
export const MapStorage = {
  STORAGE_KEY: 'BATTLE_CITY_PVP_MAPS_V2',

  _readRaw() {
    try {
      if (typeof localStorage === 'undefined') return null;
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) {
        const maps = JSON.parse(data);
        if (Array.isArray(maps) && maps.length > 0) {
          return maps;
        }
      }
    } catch (e) {
      console.error('Помилка читання localStorage:', e);
    }
    return null;
  },

  getMaps() {
    const raw = this._readRaw();
    const presets = [
      this.generateDefaultMap(),
      this.generateIceFortressMap(),
      this.generateBunkerLabMap()
    ];

    if (raw) {
      let updatedStorage = false;
      // Додаємо нові вбудовані пресет-карти, якщо їх ще немає у збереженому списку
      presets.forEach(preset => {
        if (!raw.some(m => m && m.id === preset.id)) {
          raw.push(preset);
          updatedStorage = true;
        }
      });

      // Забезпечуємо наявність масивів bushes та ice, а також оновленої трави у дефолтній карті
      raw.forEach(m => {
        if (!m.bushes) {
          m.bushes = [];
          for (let r = 0; r < m.height; r++) {
            m.bushes[r] = [];
            for (let c = 0; c < m.width; c++) {
              m.bushes[r][c] = 0;
            }
          }
          if (m.id === 'default_classic_map') {
            for (let r = 4; r <= 11; r++) {
              if (m.bushes[r]) { m.bushes[r][1] = 1; m.bushes[r][14] = 1; }
            }
            if (m.bushes[6]) { m.bushes[6][7] = 1; m.bushes[6][8] = 1; }
            if (m.bushes[9]) { m.bushes[9][7] = 1; m.bushes[9][8] = 1; }
            if (m.bushes[7]) { m.bushes[7][3] = 1; m.bushes[7][4] = 1; }
            if (m.bushes[8]) { m.bushes[8][11] = 1; m.bushes[8][12] = 1; }
          }
          updatedStorage = true;
        }

        if (!m.ice) {
          m.ice = [];
          for (let r = 0; r < m.height; r++) {
            m.ice[r] = [];
            for (let c = 0; c < m.width; c++) {
              m.ice[r][c] = 0;
            }
          }
          updatedStorage = true;
        }

        // Забезпечуємо наявність спавнів P3 та P4 для підтримки мультиплеєра до 4 гравців
        if (!m.p3Spawn && m.width && m.height) {
          m.p3Spawn = { x: Math.max(1, m.width - 2), y: 1 };
          updatedStorage = true;
        }
        if (!m.p4Spawn && m.width && m.height) {
          m.p4Spawn = { x: 1, y: Math.max(1, m.height - 2) };
          updatedStorage = true;
        }

        // Гарантуємо наявність повних блоків декоративної трави та мілкої води на класичній мапі
        if (m.id === 'default_classic_map' && m.grid) {
          const grassCoords = [
            [5, 7], [5, 8], [10, 7], [10, 8],
            [2, 2], [2, 3], [13, 12], [13, 13],
            [5, 1], [10, 1], [5, 14], [10, 14]
          ];
          grassCoords.forEach(([gr, gc]) => {
            if (m.grid[gr] && m.grid[gr][gc] === 0) {
              m.grid[gr][gc] = 7;
              updatedStorage = true;
            }
          });
          const shallowCoords = [[7, 2], [8, 2], [7, 13], [8, 13]];
          shallowCoords.forEach(([sr, sc]) => {
            if (m.grid[sr] && m.grid[sr][sc] === 3) {
              m.grid[sr][sc] = 8;
              updatedStorage = true;
            }
          });
        }
      });

      if (updatedStorage) {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(raw));
          }
        } catch (e) {
          // Ігноруємо помилки квоти localStorage
        }
      }
      return raw;
    }

    // Якщо карт немає, генеруємо стартовий набір карт
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(presets));
      }
    } catch (e) {
      console.error('Помилка запису в localStorage:', e);
    }
    return presets;
  },

  getAllMaps() {
    return this.getMaps();
  },

  getMapById(id) {
    const maps = this.getMaps();
    return maps.find(m => m.id === id) || maps[0];
  },

  saveMap(mapData) {
    const maps = this.getMaps();
    const existingIndex = maps.findIndex(m => m.id === mapData.id);
    if (existingIndex >= 0) {
      maps[existingIndex] = mapData;
    } else {
      maps.push(mapData);
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(maps));
      }
    } catch (e) {
      console.error('Помилка запису в localStorage:', e);
    }
  },

  /**
   * Імпорт карт від іншого гравця по P2P, щоб обидва гравці бачили всі карти у списку вибору та реваншу
   */
  mergeRemoteMaps(remoteMaps) {
    if (!Array.isArray(remoteMaps) || remoteMaps.length === 0) return this.getMaps();
    const maps = this.getMaps();
    let changed = false;
    remoteMaps.forEach(rm => {
      if (!rm || !rm.id || !rm.name || !Array.isArray(rm.grid)) return;
      const idx = maps.findIndex(m => m.id === rm.id);
      if (idx === -1) {
        maps.push(rm);
        changed = true;
      }
    });
    if (changed) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(maps));
        }
      } catch (e) {
        // ignore quota errors
      }
    }
    return maps;
  },

  deleteMap(id) {
    let maps = this.getMaps();
    maps = maps.filter(m => m.id !== id);
    if (maps.length === 0) {
      maps.push(this.generateDefaultMap());
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(maps));
      }
    } catch (e) {
      console.error('Помилка запису в localStorage:', e);
    }
    return maps;
  },

  generateDefaultMap() {
    const size = 16;
    const grid = [];
    const bushes = [];
    const ice = [];
    for (let r = 0; r < size; r++) {
      grid[r] = [];
      bushes[r] = [];
      ice[r] = [];
      for (let c = 0; c < size; c++) {
        grid[r][c] = 0; // Порожньо
        bushes[r][c] = 0;
        ice[r][c] = 0;
      }
    }

    // Симетрична арена з цеглою, бетоном та річкою (Глибока та Мілка вода) по центру
    for (let c = 2; c < size - 2; c++) {
      if (c !== 7 && c !== 8) {
        if (c === 2 || c === size - 3) {
          grid[7][c] = 8; // Брід (Мілка вода) по краях річки
          grid[8][c] = 8;
        } else {
          grid[7][c] = 3; // Річка (Глибока вода)
          grid[8][c] = 3;
        }
      }
    }

    // Сталеві опори біля мосту
    grid[6][6] = 2; grid[6][9] = 2;
    grid[9][6] = 2; grid[9][9] = 2;

    // Цегляні укриття
    grid[3][3] = 1; grid[3][4] = 1; grid[4][3] = 1; grid[4][4] = 1;
    grid[3][11] = 1; grid[3][12] = 1; grid[4][11] = 1; grid[4][12] = 1;
    grid[11][3] = 1; grid[11][4] = 1; grid[12][3] = 1; grid[12][4] = 1;
    grid[11][11] = 1; grid[11][12] = 1; grid[12][11] = 1; grid[12][12] = 1;

    grid[2][7] = 2; grid[2][8] = 2;
    grid[13][7] = 2; grid[13][8] = 2;

    // 2-HP Міцні блоки біля підходів до річки
    grid[5][4] = 5; grid[5][11] = 5;
    grid[10][4] = 5; grid[10][11] = 5;

    // 3-HP Броньовані блоки захисту баз
    grid[1][7] = 6; grid[1][8] = 6;
    grid[14][7] = 6; grid[14][8] = 6;

    // Засідки в кущах: бічні маскувальні коридори для стелс-обходу
    for (let r = 4; r <= 11; r++) {
      bushes[r][1] = 1;
      bushes[r][14] = 1;
    }
    // Кущі навколо мосту та по річці
    bushes[6][7] = 1; bushes[6][8] = 1;
    bushes[9][7] = 1; bushes[9][8] = 1;
    bushes[7][3] = 1; bushes[7][4] = 1;
    bushes[8][11] = 1; bushes[8][12] = 1;

    // Декоративна газонна трава (галявини та зелені підходи до річки)
    grid[5][7] = 7; grid[5][8] = 7;
    grid[10][7] = 7; grid[10][8] = 7;
    grid[2][2] = 7; grid[2][3] = 7;
    grid[13][12] = 7; grid[13][13] = 7;
    grid[5][1] = 7; grid[10][1] = 7;
    grid[5][14] = 7; grid[10][14] = 7;

    return {
      id: 'default_classic_map',
      name: 'Класична',
      width: size,
      height: size,
      p1Spawn: { x: 1, y: 1 },
      p2Spawn: { x: 14, y: 14 },
      p3Spawn: { x: 14, y: 1 },
      p4Spawn: { x: 1, y: 14 },
      grid: grid,
      bushes: bushes,
      ice: ice
    };
  },

  generateIceFortressMap() {
    const size = 16;
    const grid = Array.from({ length: size }, () => Array(size).fill(0));
    const bushes = Array.from({ length: size }, () => Array(size).fill(0));
    const ice = Array.from({ length: size }, () => Array(size).fill(0));

    // Крижане озеро по діагоналі та центру
    for (let r = 4; r <= 11; r++) {
      for (let c = 4; c <= 11; c++) {
        if (Math.abs(r - c) <= 2) {
          ice[r][c] = 1;
        }
      }
    }
    // Острівці укріплень
    grid[7][7] = 2; grid[8][8] = 2;
    grid[7][8] = 6; grid[8][7] = 6;
    grid[4][11] = 5; grid[5][11] = 1; grid[4][10] = 1;
    grid[11][4] = 5; grid[10][4] = 1; grid[11][5] = 1;
    grid[3][3] = 1; grid[3][4] = 1; grid[4][3] = 1;
    grid[12][12] = 1; grid[12][11] = 1; grid[11][12] = 1;
    grid[2][7] = 5; grid[2][8] = 5;
    grid[13][7] = 5; grid[13][8] = 5;

    // Декоративне каміння та низькі кущі на флангах
    grid[6][2] = 9; grid[7][2] = 9;
    grid[8][13] = 9; grid[9][13] = 9;
    grid[2][12] = 12; grid[13][3] = 12;

    for (let r = 2; r <= 5; r++) { bushes[r][13] = 1; bushes[size - 1 - r][2] = 1; }

    return {
      id: 'preset_ice_fortress',
      name: 'Крижана Фортеця',
      width: size,
      height: size,
      p1Spawn: { x: 1, y: 1 },
      p2Spawn: { x: 14, y: 14 },
      p3Spawn: { x: 14, y: 1 },
      p4Spawn: { x: 1, y: 14 },
      grid,
      bushes,
      ice
    };
  },

  generateBunkerLabMap() {
    const size = 16;
    const grid = Array.from({ length: size }, () => Array(size).fill(0));
    const bushes = Array.from({ length: size }, () => Array(size).fill(0));
    const ice = Array.from({ length: size }, () => Array(size).fill(0));

    // Симетричні бункерні коридори
    for (let r = 3; r <= 12; r++) {
      if (r !== 7 && r !== 8) {
        grid[r][5] = (r === 5 || r === 10) ? 2 : 1;
        grid[r][10] = (r === 5 || r === 10) ? 2 : 1;
      }
    }
    grid[7][7] = 6; grid[7][8] = 6;
    grid[8][7] = 6; grid[8][8] = 6;
    grid[3][7] = 5; grid[3][8] = 5;
    grid[12][7] = 5; grid[12][8] = 5;

    // Мілководні броди на флангах
    grid[7][1] = 8; grid[7][2] = 8; grid[8][1] = 8; grid[8][2] = 8;
    grid[7][13] = 8; grid[7][14] = 8; grid[8][13] = 8; grid[8][14] = 8;

    // Трава та маскувальні кущі в центральних проходах
    bushes[7][5] = 1; bushes[8][5] = 1;
    bushes[7][10] = 1; bushes[8][10] = 1;
    grid[5][7] = 11; grid[5][8] = 11;
    grid[10][7] = 11; grid[10][8] = 11;

    return {
      id: 'preset_bunker_lab',
      name: 'Лабіринт Бункерів',
      width: size,
      height: size,
      p1Spawn: { x: 1, y: 1 },
      p2Spawn: { x: 14, y: 14 },
      p3Spawn: { x: 14, y: 1 },
      p4Spawn: { x: 1, y: 14 },
      grid,
      bushes,
      ice
    };
  }
};

/**
 * Візуальне сповіщення (Toast)
 */
let toastTimeoutId = null;

export function showToast(msg) {
  if (typeof document === 'undefined') return;
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  if (toastTimeoutId !== null) {
    clearTimeout(toastTimeoutId);
  }
  toastTimeoutId = setTimeout(() => {
    toast.classList.remove('show');
    toastTimeoutId = null;
  }, 2500);
}

/**
 * Перевірка карти на ризик софт-локу під час події «Обман зору» (shuffled_blocks):
 * Якщо спавн будь-якого гравця оточений блоками арени (кущами, льодом, водою, стінами тощо),
 * які під час бієкції можуть перетворитися на неруйнівний бетон/сталь і замкнути гравця в глухому куті.
 * @param {Object} mapData
 * @returns {boolean} true, якщо виявлено ризик софт-локу
 */
export function checkMapPotentialSoftlock(mapData) {
  if (!mapData || !Array.isArray(mapData.grid) || !mapData.p1Spawn || !mapData.p2Spawn) return false;
  const cols = Math.max(1, Number(mapData.width) || 16);
  const rows = Math.max(1, Number(mapData.height) || 16);

  const isPermanentPassage = (c, r) => {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return false;
    if (mapData.bushes && mapData.bushes[r] && mapData.bushes[r][c] === 1) return false;
    const tileId = (mapData.grid[r] && typeof mapData.grid[r][c] === 'number') ? mapData.grid[r][c] : 0;
    // Тільки порожня клітинка та чисті декорації гарантовано НЕ стануть сталлю/бетоном при «Обмані зору»
    return tileId === 0 || tileId === 7 || tileId === 11 || tileId === 12 || tileId === 13;
  };

  const checkSpawn = (spawn) => {
    if (!spawn || typeof spawn.x !== 'number' || typeof spawn.y !== 'number') return false;
    const sx = Math.floor(spawn.x);
    const sy = Math.floor(spawn.y);

    // BFS перевірка кількості гарантовано відкритих клітинок навколо спавну
    const visited = new Set();
    const queue = [[sx, sy]];
    visited.add(`${sx},${sy}`);

    while (queue.length > 0 && visited.size < 4) {
      const [cx, cy] = queue.shift();
      const neighbors = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1]
      ];
      for (const [nx, ny] of neighbors) {
        const key = `${nx},${ny}`;
        if (!visited.has(key) && isPermanentPassage(nx, ny)) {
          visited.add(key);
          queue.push([nx, ny]);
        }
      }
    }

    // Якщо спавн замкнений у кишені з менш ніж 3 постійних прохідних клітинок — є ризик софт-локу
    return visited.size < 3;
  };

  return checkSpawn(mapData.p1Spawn) || checkSpawn(mapData.p2Spawn) || checkSpawn(mapData.p3Spawn) || checkSpawn(mapData.p4Spawn);
}

/**
 * Підрахунок кількості дійсних спавнів на карті (від 1 до 4)
 * @param {Object} mapData 
 * @returns {number}
 */
export function countMapSpawns(mapData) {
  if (!mapData) return 0;
  let count = 0;
  if (mapData.p1Spawn && typeof mapData.p1Spawn.x === 'number') count++;
  if (mapData.p2Spawn && typeof mapData.p2Spawn.x === 'number') count++;
  if (mapData.p3Spawn && typeof mapData.p3Spawn.x === 'number') count++;
  if (mapData.p4Spawn && typeof mapData.p4Spawn.x === 'number') count++;
  return count;
}

/**
 * Рендеринг міні-прев'ю карти на будь-якому елементі <canvas> (у головному меню, лобі гостя та у вікні реваншу)
 */
export function renderMapPreview(canvasOrId, mapData) {
  const canvas = typeof canvasOrId === 'string'
    ? (typeof document !== 'undefined' ? document.getElementById(canvasOrId) : null)
    : canvasOrId;
  if (!canvas || !mapData || !Array.isArray(mapData.grid)) return false;

  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  syncTileRegistry();
  const cols = Math.max(1, Number(mapData.width) || 16);
  const rows = Math.max(1, Number(mapData.height) || 16);
  const cw = canvas.width || 160;
  const ch = canvas.height || 160;
  const cellW = cw / cols;
  const cellH = ch / rows;
  const cellSize = Math.min(cellW, cellH);

  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = '#0f1419';
  ctx.fillRect(0, 0, cw, ch);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tileId = (mapData.grid[r] && typeof mapData.grid[r][c] === 'number') ? mapData.grid[r][c] : 0;
      const hasIceUnder = Boolean(mapData.ice && mapData.ice[r] && mapData.ice[r][c] === 1);
      const isGroundDecor = isGroundDecorTileId(tileId);
      const px = c * cellW;
      const py = r * cellH;

      if (hasIceUnder || tileId === 10) {
        TILE_TYPES.ICE.draw(ctx, px, py, cellSize);
      } else if (isGroundDecor) {
        const decorBlock = TILE_BY_ID[tileId] || TILE_TYPES.EMPTY;
        decorBlock.draw(ctx, px, py, cellSize);
      } else if (tileId === 0) {
        TILE_TYPES.EMPTY.draw(ctx, px, py, cellSize);
      }

      if (tileId !== 0 && !isGroundDecor) {
        const block = TILE_BY_ID[tileId] || TILE_TYPES.EMPTY;
        block.draw(ctx, px, py, cellSize);
      }

      if (mapData.bushes && mapData.bushes[r] && mapData.bushes[r][c] === 1) {
        TILE_TYPES.BUSH.draw(ctx, px, py, cellSize);
      }
    }
  }

  // Маркери спавнів P1, P2, P3, P4
  const drawSpawnDot = (spawn, color, label) => {
    if (!spawn || typeof spawn.x !== 'number' || typeof spawn.y !== 'number') return;
    const sx = spawn.x * cellW;
    const sy = spawn.y * cellH;
    ctx.fillStyle = color;
    ctx.fillRect(sx + 1, sy + 1, Math.max(4, cellW - 2), Math.max(4, cellH - 2));
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 1, sy + 1, Math.max(4, cellW - 2), Math.max(4, cellH - 2));
    if (cellSize >= 9) {
      ctx.fillStyle = '#000000';
      ctx.font = `bold ${Math.max(7, Math.floor(cellSize * 0.55))}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, sx + cellW / 2, sy + cellH / 2 + 0.5);
    }
  };

  drawSpawnDot(mapData.p1Spawn, '#f1c40f', '1');
  drawSpawnDot(mapData.p2Spawn, '#2ecc71', '2');
  drawSpawnDot(mapData.p3Spawn, '#00d2d3', '3');
  drawSpawnDot(mapData.p4Spawn, '#e056fd', '4');
  return true;
}

/**
 * Оновлення всіх прев'ю карт відповідно до вибраних значень у селектах
 */
export function updateAllMapPreviews() {
  if (typeof document === 'undefined') return;
  const pairs = [
    ['selectHostMap', 'hostMapPreviewCanvas', 'hostMapPreviewMeta'],
    ['selectGuestMap', 'guestMapPreviewCanvas', 'guestMapPreviewMeta'],
    ['selectRematchMap', 'rematchMapPreviewCanvas', 'rematchMapPreviewMeta']
  ];
  pairs.forEach(([selectId, canvasId, metaId]) => {
    const select = document.getElementById(selectId);
    const canvas = document.getElementById(canvasId);
    if (!select || !canvas) return;
    const mapData = MapStorage.getMapById(select.value);
    if (mapData) {
      renderMapPreview(canvas, mapData);
      const metaEl = metaId ? document.getElementById(metaId) : null;
      if (metaEl) {
        const spawns = countMapSpawns(mapData);
        metaEl.textContent = `${mapData.name} • ${mapData.width}×${mapData.height} (Спавнів: ${spawns})`;
      }
    }
  });
}

/**
 * Оновлення випадаючого списку збережених карт у лобі Хоста, лобі Гостя та у вікні Реваншу
 * @param {number} [minSpawns=1] - Фільтр: відображати лише карти з кількістю спавнів >= minSpawns
 */
export function updateHostMapDropdown(minSpawns = 1) {
  const allMaps = MapStorage.getMaps();
  const selectIds = ['selectHostMap', 'selectGuestMap', 'selectRematchMap'];

  selectIds.forEach(selectId => {
    const select = typeof document !== 'undefined' ? document.getElementById(selectId) : null;
    if (!select) return;
    const prevVal = select.value;
    select.innerHTML = '';

    // Фільтруємо карти за кількістю спавнів (для забезпечення рівної кількості баз усім гравцям)
    const filtered = allMaps.filter(m => countMapSpawns(m) >= minSpawns);
    const mapsToRender = filtered.length > 0 ? filtered : allMaps;

    mapsToRender.forEach(map => {
      const opt = document.createElement('option');
      opt.value = map.id;
      const spawns = countMapSpawns(map);
      opt.textContent = `${map.name} (${map.width}x${map.height}, 🚩${spawns})`;
      select.appendChild(opt);
    });

    if (prevVal && mapsToRender.some(m => m.id === prevVal)) {
      select.value = prevVal;
    } else if (mapsToRender.length > 0) {
      select.value = mapsToRender[0].id;
    }
  });

  updateAllMapPreviews();
}

/**
 * Візуальний редактор карт
 */
export const MapEditor = {
  canvas: null,
  ctx: null,
  selectedTool: 1, // 0..3 або 'SPAWN_P1' | 'SPAWN_P2'
  isDrawing: false,
  mapData: null,

  init() {
    this.canvas = document.getElementById('editorCanvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    // Базова сітка 15x15
    this.createNewMap(15, 15, 'Нова Карта');
    this.setupPalette();
    this.setupEventListeners();
    this.renderSavedMapsList();
    this.render();
  },

  createNewMap(width, height, name = 'Нова Карта') {
    width = Math.max(10, Math.min(30, parseInt(width, 10) || 15));
    height = Math.max(10, Math.min(30, parseInt(height, 10) || 15));

    const grid = [];
    const bushes = [];
    const ice = [];
    for (let r = 0; r < height; r++) {
      grid[r] = [];
      bushes[r] = [];
      ice[r] = [];
      for (let c = 0; c < width; c++) {
        grid[r][c] = 0;
        bushes[r][c] = 0;
        ice[r][c] = 0;
      }
    }

    this.mapData = {
      id: 'map_' + Date.now(),
      name: name,
      width: width,
      height: height,
      p1Spawn: { x: 1, y: 1 },
      p2Spawn: { x: width - 2, y: height - 2 },
      p3Spawn: { x: width - 2, y: 1 },
      p4Spawn: { x: 1, y: height - 2 },
      grid: grid,
      bushes: bushes,
      ice: ice
    };

    const maxDim = Math.max(width, height);
    const editorCanvasSize = Math.max(600, Math.min(900, maxDim * 28));
    if (this.canvas) {
      this.canvas.width = editorCanvasSize;
      this.canvas.height = editorCanvasSize;
    }

    const editorSize = Math.min(Math.max(640, maxDim * 28), 920);
    document.documentElement.style.setProperty('--editor-max-width', `${editorSize}px`);
    document.documentElement.style.setProperty('--container-max-width', `${editorSize + 32}px`);

    const wInput = document.getElementById('editorWidth');
    const hInput = document.getElementById('editorHeight');
    const nameInput = document.getElementById('editorMapName');
    if (wInput) wInput.value = width;
    if (hInput) hInput.value = height;
    if (nameInput) nameInput.value = name;
  },

  setupPalette() {
    syncTileRegistry();
    const paletteContainer = document.getElementById('editorPalette');
    if (!paletteContainer) return;

    let searchWrap = paletteContainer.querySelector('.editor-palette-search-row');
    let searchInput = paletteContainer.querySelector('#editorBlockSearchInput');
    let gridContainer = paletteContainer.querySelector('.editor-blocks-catalog');

    if (!searchWrap || !searchInput || !gridContainer) {
      paletteContainer.innerHTML = '';

      searchWrap = document.createElement('div');
      searchWrap.className = 'test-perk-search-row editor-palette-search-row';

      searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.id = 'editorBlockSearchInput';
      searchInput.className = 'cyber-input test-perk-search-input';
      searchInput.placeholder = '🔍 Пошук блоку або інструменту за назвою чи описом...';
      searchInput.autocomplete = 'off';
      searchInput.value = this.paletteSearchQuery || '';
      searchInput.oninput = (e) => {
        this.paletteSearchQuery = e.target.value || '';
        this.renderPaletteCards();
      };

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'btn btn-tool test-perk-search-clear';
      clearBtn.textContent = '✖';
      clearBtn.title = 'Очистити пошук';
      clearBtn.onclick = () => {
        this.paletteSearchQuery = '';
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        this.renderPaletteCards();
      };

      searchWrap.appendChild(searchInput);
      searchWrap.appendChild(clearBtn);
      paletteContainer.appendChild(searchWrap);

      gridContainer = document.createElement('div');
      gridContainer.className = 'editor-blocks-catalog';
      paletteContainer.appendChild(gridContainer);
    }

    this.renderPaletteCards();
  },

  renderPaletteCards() {
    const paletteContainer = document.getElementById('editorPalette');
    if (!paletteContainer) return;
    const gridContainer = paletteContainer.querySelector('.editor-blocks-catalog') || paletteContainer;
    gridContainer.innerHTML = '';

    const items = [];

    // 1. Блоки з TILE_TYPES
    Object.values(TILE_TYPES).forEach(block => {
      let badge = 'Декор / Поверхня';
      let categoryClass = 'cat-ground';
      if (block.id === 0) {
        badge = 'Інструмент • Очищення';
        categoryClass = 'cat-tool';
      } else if (block.id === 15 || block.isArmoredGlass) {
        badge = 'Броньоване скло • Огляд';
        categoryClass = 'cat-steel';
      } else if (block.id === 16 || block.isAcid) {
        badge = 'Токсичність • Кислота';
        categoryClass = 'cat-water';
      } else if (block.id === 17 || block.isAcidBarrel) {
        badge = 'Вибухова бочка • 3 HP';
        categoryClass = 'cat-wall';
      } else if (block.destructible) {
        badge = `Укріплення • ${block.maxHp || 2} постріли`;
        categoryClass = 'cat-wall';
      } else if (block.blocksTank && block.blocksBullet) {
        badge = 'Непробивна перешкода';
        categoryClass = 'cat-steel';
      } else if (block.isWater) {
        badge = block.isDeepWater ? 'Вода • Глибока' : 'Вода • Мілководдя';
        categoryClass = 'cat-water';
      } else if (block.isOverlay || block.isLowBush) {
        badge = 'Маскування • Рослинність';
        categoryClass = 'cat-bush';
      } else if (block.isIce) {
        badge = 'Ковзання • Інерція';
        categoryClass = 'cat-ice';
      }

      items.push({
        tool: block.id,
        name: block.name,
        badge,
        categoryClass,
        description: block.description || '',
        drawPreview: (ctx, size) => {
          if (block.id !== 0) {
            TILE_TYPES.EMPTY.draw(ctx, 0, 0, size);
          }
          block.draw(ctx, 0, 0, size, 0, block.maxHp || 1);
        }
      });
    });

    // 2. Спеціальні інструменти редактора (Прибрати кущі, Прибрати лід, Спавн P1, Спавн P2)
    items.push(
      {
        tool: 'REMOVE_BUSH',
        name: '✂️ Прибрати кущі',
        badge: 'Інструмент • Тільки шар кущів',
        categoryClass: 'cat-tool',
        description: 'Стирає лише високі маскувальні кущі з клітинки, залишаючи стіну або декор під ними недоторканими.',
        drawPreview: (ctx, size) => {
          TILE_TYPES.EMPTY.draw(ctx, 0, 0, size);
          TILE_TYPES.BUSH.draw(ctx, 0, 0, size);
          ctx.strokeStyle = '#ff4757';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(6, 6);
          ctx.lineTo(size - 6, size - 6);
          ctx.moveTo(size - 6, 6);
          ctx.lineTo(6, size - 6);
          ctx.stroke();
        }
      },
      {
        tool: 'REMOVE_ICE',
        name: '⛏️ Прибрати лід',
        badge: 'Інструмент • Тільки шар льоду',
        categoryClass: 'cat-tool',
        description: 'Прибирає крижане покриття під блоком, не руйнуючи встановлену зверху стіну чи кущі.',
        drawPreview: (ctx, size) => {
          TILE_TYPES.ICE.draw(ctx, 0, 0, size);
          ctx.strokeStyle = '#ff4757';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(6, 6);
          ctx.lineTo(size - 6, size - 6);
          ctx.moveTo(size - 6, 6);
          ctx.lineTo(6, size - 6);
          ctx.stroke();
        }
      },
      {
        tool: 'SPAWN_P1',
        name: '🚩 Спавн P1 (Жовтий)',
        badge: 'Точка відродження • Гравець 1',
        categoryClass: 'cat-spawn-p1',
        description: 'Встановлює стартову базу для Гравця 1 (Хоста). На карті може бути рівно одна точка P1.',
        drawPreview: (ctx, size) => {
          TILE_TYPES.EMPTY.draw(ctx, 0, 0, size);
          ctx.fillStyle = 'rgba(243, 156, 18, 0.35)';
          ctx.fillRect(2, 2, size - 4, size - 4);
          ctx.strokeStyle = '#f39c12';
          ctx.lineWidth = 2;
          ctx.strokeRect(2, 2, size - 4, size - 4);
          ctx.fillStyle = '#f1c40f';
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('P1', size / 2, size / 2);
        }
      },
      {
        tool: 'SPAWN_P2',
        name: '🚩 Спавн P2 (Зелений)',
        badge: 'Точка відродження • Гравець 2',
        categoryClass: 'cat-spawn-p2',
        description: 'Встановлює стартову базу для Гравця 2 (Гостя). На карті може бути рівно одна точка P2.',
        drawPreview: (ctx, size) => {
          TILE_TYPES.EMPTY.draw(ctx, 0, 0, size);
          ctx.fillStyle = 'rgba(46, 204, 113, 0.35)';
          ctx.fillRect(2, 2, size - 4, size - 4);
          ctx.strokeStyle = '#2ecc71';
          ctx.lineWidth = 2;
          ctx.strokeRect(2, 2, size - 4, size - 4);
          ctx.fillStyle = '#2ecc71';
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('P2', size / 2, size / 2);
        }
      },
      {
        tool: 'SPAWN_P3',
        name: '🚩 Спавн P3 (Ціан)',
        badge: 'Точка відродження • Гравець 3',
        categoryClass: 'cat-spawn-p3',
        description: 'Встановлює стартову базу для Гравця 3. На карті може бути рівно одна точка P3.',
        drawPreview: (ctx, size) => {
          TILE_TYPES.EMPTY.draw(ctx, 0, 0, size);
          ctx.fillStyle = 'rgba(0, 210, 211, 0.35)';
          ctx.fillRect(2, 2, size - 4, size - 4);
          ctx.strokeStyle = '#00d2d3';
          ctx.lineWidth = 2;
          ctx.strokeRect(2, 2, size - 4, size - 4);
          ctx.fillStyle = '#00d2d3';
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('P3', size / 2, size / 2);
        }
      },
      {
        tool: 'SPAWN_P4',
        name: '🚩 Спавн P4 (Фіолетовий)',
        badge: 'Точка відродження • Гравець 4',
        categoryClass: 'cat-spawn-p4',
        description: 'Встановлює стартову базу для Гравця 4. На карті може бути рівно одна точка P4.',
        drawPreview: (ctx, size) => {
          TILE_TYPES.EMPTY.draw(ctx, 0, 0, size);
          ctx.fillStyle = 'rgba(224, 86, 253, 0.35)';
          ctx.fillRect(2, 2, size - 4, size - 4);
          ctx.strokeStyle = '#e056fd';
          ctx.lineWidth = 2;
          ctx.strokeRect(2, 2, size - 4, size - 4);
          ctx.fillStyle = '#e056fd';
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('P4', size / 2, size / 2);
        }
      }
    );

    const query = String(this.paletteSearchQuery || '').trim().toLowerCase();
    const filtered = query
      ? items.filter(it =>
          it.name.toLowerCase().includes(query) ||
          it.badge.toLowerCase().includes(query) ||
          it.description.toLowerCase().includes(query)
        )
      : items;

    if (filtered.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'test-perk-search-empty';
      emptyEl.textContent = `Нічого не знайдено за запитом «${this.paletteSearchQuery}»`;
      gridContainer.appendChild(emptyEl);
      return;
    }

    filtered.forEach(item => {
      const isSelected = String(this.selectedTool) === String(item.tool);
      const card = document.createElement('div');
      card.className = `editor-block-chip palette-btn ${item.categoryClass} ${isSelected ? 'active' : ''}`;
      card.dataset.tool = item.tool;

      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = 40;
      previewCanvas.height = 40;
      previewCanvas.className = 'editor-block-preview-canvas';
      const pCtx = previewCanvas.getContext('2d');
      if (pCtx && typeof item.drawPreview === 'function') {
        item.drawPreview(pCtx, 40);
      }

      const info = document.createElement('div');
      info.className = 'editor-block-info';
      info.innerHTML = `
        <div class="editor-block-header">
          <span class="editor-block-title">${item.name}</span>
          <span class="editor-block-status ${isSelected ? 'active' : ''}">${isSelected ? '✓ ОБРАНО' : 'ОБРАТИ'}</span>
        </div>
        <div class="editor-block-badge">${item.badge}</div>
        <div class="editor-block-desc">${item.description}</div>
      `;

      card.appendChild(previewCanvas);
      card.appendChild(info);
      card.onclick = () => {
        this.setTool(item.tool);
      };
      gridContainer.appendChild(card);
    });
  },

  setTool(tool) {
    this.selectedTool = tool;
    document.querySelectorAll('.palette-btn').forEach(btn => {
      const isAct = String(btn.dataset.tool) === String(tool);
      btn.classList.toggle('active', isAct);
      const statusEl = btn.querySelector('.editor-block-status');
      if (statusEl) {
        statusEl.classList.toggle('active', isAct);
        statusEl.textContent = isAct ? '✓ ОБРАНО' : 'ОБРАТИ';
      }
    });
  },

  setupEventListeners() {
    if (this._listenersAttached) return;
    this._listenersAttached = true;
    const getCellCoords = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;

      const cellSize = this.canvas.width / this.mapData.width;
      const cellYSize = this.canvas.height / this.mapData.height;

      const c = Math.floor(x / cellSize);
      const r = Math.floor(y / cellYSize);
      return { c, r };
    };

    const applyTool = (c, r) => {
      if (c < 0 || c >= this.mapData.width || r < 0 || r >= this.mapData.height) return;

      if (!this.mapData.bushes) {
        this.mapData.bushes = Array(this.mapData.height).fill(null).map(() => Array(this.mapData.width).fill(0));
      }
      if (!this.mapData.ice) {
        this.mapData.ice = Array(this.mapData.height).fill(null).map(() => Array(this.mapData.width).fill(0));
      }

      if (this.selectedTool === 'SPAWN_P1') {
        // Рівно один спавн P1, старий переміщується
        this.mapData.p1Spawn = { x: c, y: r };
        this.mapData.grid[r][c] = 0; // Очищуємо клітинку під спавном
        this.mapData.bushes[r][c] = 0;
        if (this.mapData.p2Spawn.x === c && this.mapData.p2Spawn.y === r) {
          this.mapData.p2Spawn = { x: 0, y: 0 };
        }
      } else if (this.selectedTool === 'SPAWN_P2') {
        // Рівно один спавн P2, старий переміщується
        this.mapData.p2Spawn = { x: c, y: r };
        this.mapData.grid[r][c] = 0;
        this.mapData.bushes[r][c] = 0;
        if (this.mapData.p1Spawn.x === c && this.mapData.p1Spawn.y === r) {
          this.mapData.p1Spawn = { x: 0, y: 0 };
        }
      } else if (this.selectedTool === 'SPAWN_P3') {
        // Рівно один спавн P3 (Ціан)
        this.mapData.p3Spawn = { x: c, y: r };
        this.mapData.grid[r][c] = 0;
        this.mapData.bushes[r][c] = 0;
      } else if (this.selectedTool === 'SPAWN_P4') {
        // Рівно один спавн P4 (Фіолетовий)
        this.mapData.p4Spawn = { x: c, y: r };
        this.mapData.grid[r][c] = 0;
        this.mapData.bushes[r][c] = 0;
      } else if (this.selectedTool === 4 || this.selectedTool === 'BUSH') {
        // Встановлюємо високі кущі як шар поверхні над БУДЬ-ЯКИМ наявним блоком (вкл. низькі кущі) або просто на землю!
        this.mapData.bushes[r][c] = 1;
      } else if (this.selectedTool === 'REMOVE_BUSH') {
        // Стираємо тільки високі кущі, залишаючи блок під ними цілим
        this.mapData.bushes[r][c] = 0;
      } else if (this.selectedTool === 10 || this.selectedTool === 'ICE') {
        // Встановлюємо Лід як шар на рівні землі (на 1 рівні з декором трави/каміння — тому прибирає декор землі/воду з клітинки)
        this.mapData.ice[r][c] = 1;
        const curTile = this.mapData.grid[r][c];
        if (isGroundDecorTileId(curTile) || curTile === 3 || curTile === 8) {
          this.mapData.grid[r][c] = 0;
        }
      } else if (this.selectedTool === 'REMOVE_ICE') {
        // Стираємо тільки лід під блоком
        this.mapData.ice[r][c] = 0;
        if (this.mapData.grid[r][c] === 10) this.mapData.grid[r][c] = 0;
      } else if (this.selectedTool === 0) {
        // Ластик: стирає і базовий блок, і кущі, і лід
        this.mapData.grid[r][c] = 0;
        this.mapData.bushes[r][c] = 0;
        this.mapData.ice[r][c] = 0;
      } else {
        // Базові блоки та наземний декор (не можна затирати клітинки спавнів)
        if ((this.mapData.p1Spawn && this.mapData.p1Spawn.x === c && this.mapData.p1Spawn.y === r) ||
            (this.mapData.p2Spawn && this.mapData.p2Spawn.x === c && this.mapData.p2Spawn.y === r) ||
            (this.mapData.p3Spawn && this.mapData.p3Spawn.x === c && this.mapData.p3Spawn.y === r) ||
            (this.mapData.p4Spawn && this.mapData.p4Spawn.x === c && this.mapData.p4Spawn.y === r)) {
          return;
        }
        const toolId = parseInt(this.selectedTool, 10);
        // Якщо ставимо наземний декор (трава/каміння: 7, 11, 12, 13), кислоту (16) або воду (3, 8) — вони на одному рівні з льодом, тому замінюють лід
        if (isGroundDecorTileId(toolId) || toolId === 3 || toolId === 8 || toolId === 16) {
          this.mapData.ice[r][c] = 0;
        }
        this.mapData.grid[r][c] = toolId;
      }
      this.render();
    };

    // Миша
    this.canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.isDrawing = true;
      const { c, r } = getCellCoords(e);
      applyTool(c, r);
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDrawing) return;
      const { c, r } = getCellCoords(e);
      applyTool(c, r);
    });

    window.addEventListener('mouseup', () => {
      this.isDrawing = false;
    });

    // Сенсорний екран
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.isDrawing = true;
      const { c, r } = getCellCoords(e);
      applyTool(c, r);
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!this.isDrawing) return;
      const { c, r } = getCellCoords(e);
      applyTool(c, r);
    }, { passive: false });

    this.canvas.addEventListener('touchend', () => {
      this.isDrawing = false;
    });

    // Кнопка ресайзу
    const btnResize = document.getElementById('btnEditorResize');
    if (btnResize) {
      btnResize.onclick = () => {
        const w = parseInt(document.getElementById('editorWidth').value, 10);
        const h = parseInt(document.getElementById('editorHeight').value, 10);
        const name = document.getElementById('editorMapName').value || 'Нова Карта';
        this.createNewMap(w, h, name);
        this.render();
        showToast('Розмір сітки оновлено!');
      };
    }

    // Кнопка збереження карти
    const btnSave = document.getElementById('btnSaveMap');
    if (btnSave) {
      btnSave.onclick = () => {
        this.saveCurrentMap();
      };
    }
  },

  saveCurrentMap() {
    const nameInput = document.getElementById('editorMapName');
    const name = nameInput.value.trim();

    if (!name) {
      showToast('Введіть назву карти!');
      return;
    }

    // ВАЛІДАЦІЯ: обов'язково обидва спавни
    if (!this.mapData.p1Spawn || this.mapData.p1Spawn.x === undefined ||
        !this.mapData.p2Spawn || this.mapData.p2Spawn.x === undefined) {
      showToast('Встановіть точки спавну обох гравців!');
      return;
    }

    const hasSoftlock = checkMapPotentialSoftlock(this.mapData);
    this.mapData.possibleSoftlock = hasSoftlock;
    this.mapData.name = name;
    MapStorage.saveMap(this.mapData);
    if (hasSoftlock) {
      showToast(`Карту "${name}" збережено! ⚠️ Увага: можливий софт-лок при «Обмані зору».`);
    } else {
      showToast(`Карту "${name}" успішно збережено!`);
    }

    this.renderSavedMapsList();
    updateHostMapDropdown();
  },

  renderSavedMapsList() {
    const container = document.getElementById('editorSavedMapsList');
    if (!container) return;
    container.innerHTML = '';
    const maps = MapStorage.getMaps();

    maps.forEach(map => {
      const hasSoftlock = Boolean(map.possibleSoftlock || checkMapPotentialSoftlock(map));
      const softlockBadge = hasSoftlock
        ? `<span class="editor-softlock-badge" title="При увімкнених подіях («Обман зору») на цій карті можливий софт-лок">⚠️ Можливий софт-лок</span>`
        : '';

      const card = document.createElement('div');
      card.className = 'editor-map-card';
      card.innerHTML = `
        <div class="editor-map-info">
          <div class="editor-map-name">${map.name} ${softlockBadge}</div>
          <div class="editor-map-meta">Розмір: ${map.width}x${map.height}</div>
        </div>
        <div class="editor-map-actions">
          <button class="btn btn-tool btn-load-map">Завантажити</button>
          <button class="btn btn-tool btn-del-map" style="background:#c0392b;">Видалити</button>
        </div>
      `;

      card.querySelector('.btn-load-map').onclick = () => {
        this.loadMap(map);
      };

      card.querySelector('.btn-del-map').onclick = () => {
        if (confirm(`Видалити карту "${map.name}"?`)) {
          MapStorage.deleteMap(map.id);
          this.renderSavedMapsList();
          updateHostMapDropdown();
          showToast('Карту видалено!');
        }
      };

      container.appendChild(card);
    });
  },

  loadMap(map) {
    this.mapData = JSON.parse(JSON.stringify(map));
    if (!this.mapData.bushes) {
      this.mapData.bushes = [];
      for (let r = 0; r < this.mapData.height; r++) {
        this.mapData.bushes[r] = [];
        for (let c = 0; c < this.mapData.width; c++) {
          this.mapData.bushes[r][c] = 0;
        }
      }
    }
    if (!this.mapData.ice) {
      this.mapData.ice = [];
      for (let r = 0; r < this.mapData.height; r++) {
        this.mapData.ice[r] = [];
        for (let c = 0; c < this.mapData.width; c++) {
          this.mapData.ice[r][c] = 0;
        }
      }
    }

    const maxDim = Math.max(map.width, map.height);
    const editorCanvasSize = Math.max(600, Math.min(900, maxDim * 28));
    if (this.canvas) {
      this.canvas.width = editorCanvasSize;
      this.canvas.height = editorCanvasSize;
    }

    const editorSize = Math.min(Math.max(640, maxDim * 28), 920);
    document.documentElement.style.setProperty('--editor-max-width', `${editorSize}px`);
    document.documentElement.style.setProperty('--container-max-width', `${editorSize + 32}px`);

    const wInput = document.getElementById('editorWidth');
    const hInput = document.getElementById('editorHeight');
    const nameInput = document.getElementById('editorMapName');
    if (wInput) wInput.value = map.width;
    if (hInput) hInput.value = map.height;
    if (nameInput) nameInput.value = map.name;

    this.render();
    showToast(`Завантажено карту "${map.name}"`);
  },

  render() {
    if (!this.mapData || !this.ctx) return;

    const cols = this.mapData.width;
    const rows = this.mapData.height;

    const cellSizeX = this.canvas.width / cols;
    const cellSizeY = this.canvas.height / rows;
    const cellSize = Math.min(cellSizeX, cellSizeY);

    this.ctx.fillStyle = '#0e1117';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 1. Малювання шару землі (Лід, Декор трави/каміння або Порожньо) та базових блоків через TILE_BY_ID
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const hasIceUnder = Boolean(this.mapData.ice && this.mapData.ice[r] && this.mapData.ice[r][c] === 1);
        const tileId = this.mapData.grid[r][c];
        const isGroundDecor = isGroundDecorTileId(tileId);

        // Шар 1 (рівень землі): Лід та наземний декор (трава 1/2, каміння 1/2) знаходяться на одному рівні!
        if (hasIceUnder || tileId === 10) {
          TILE_TYPES.ICE.draw(this.ctx, c * cellSizeX, r * cellSizeY, cellSize);
        } else if (isGroundDecor) {
          const decorBlock = TILE_BY_ID[tileId] || TILE_TYPES.EMPTY;
          decorBlock.draw(this.ctx, c * cellSizeX, r * cellSizeY, cellSize);
        } else if (tileId === 0) {
          TILE_TYPES.EMPTY.draw(this.ctx, c * cellSizeX, r * cellSizeY, cellSize);
        }

        // Шар 2 (об'ємні блоки, стіни, вода, низькі кущі — тільки НЕ наземний декор)
        if (tileId !== 0 && !isGroundDecor) {
          const block = TILE_BY_ID[tileId] || TILE_TYPES.EMPTY;
          block.draw(this.ctx, c * cellSizeX, r * cellSizeY, cellSize);
          // Якщо під об'ємним блоком є лід — показуємо у редакторі маленький блакитний індикатор кутика
          if (hasIceUnder) {
            this.ctx.fillStyle = '#7ed6df';
            this.ctx.fillRect(c * cellSizeX + 2, r * cellSizeY + 2, 5, 5);
          }
        }
      }
    }

    // 2. Малювання шару високих кущів поверх базових блоків (вкл. поверх низьких кущів!)
    if (this.mapData.bushes) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (this.mapData.bushes[r][c] === 1) {
            TILE_TYPES.BUSH.draw(this.ctx, c * cellSizeX, r * cellSizeY, cellSize);
          }
        }
      }
    }

    // Сітка редактора
    this.ctx.strokeStyle = '#2c3e50';
    this.ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c++) {
      this.ctx.beginPath();
      this.ctx.moveTo(c * cellSizeX, 0);
      this.ctx.lineTo(c * cellSizeX, rows * cellSizeY);
      this.ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, r * cellSizeY);
      this.ctx.lineTo(cols * cellSizeX, r * cellSizeY);
      this.ctx.stroke();
    }

    // Відображення спавну P1 (Жовтий)
    if (this.mapData.p1Spawn) {
      const sx = this.mapData.p1Spawn.x * cellSizeX;
      const sy = this.mapData.p1Spawn.y * cellSizeY;
      this.ctx.fillStyle = 'rgba(243, 156, 18, 0.4)';
      this.ctx.fillRect(sx, sy, cellSizeX, cellSizeY);
      this.ctx.strokeStyle = '#f39c12';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(sx + 2, sy + 2, cellSizeX - 4, cellSizeY - 4);
      this.ctx.fillStyle = '#f39c12';
      this.ctx.font = `${Math.floor(cellSize * 0.45)}px 'Press Start 2P', monospace`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText('P1', sx + cellSizeX / 2, sy + cellSizeY / 2);
    }

    // Відображення спавну P2 (Зелений)
    if (this.mapData.p2Spawn) {
      const sx = this.mapData.p2Spawn.x * cellSizeX;
      const sy = this.mapData.p2Spawn.y * cellSizeY;
      this.ctx.fillStyle = 'rgba(46, 204, 113, 0.4)';
      this.ctx.fillRect(sx, sy, cellSizeX, cellSizeY);
      this.ctx.strokeStyle = '#2ecc71';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(sx + 2, sy + 2, cellSizeX - 4, cellSizeY - 4);
      this.ctx.fillStyle = '#2ecc71';
      this.ctx.font = `${Math.floor(cellSize * 0.45)}px 'Press Start 2P', monospace`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText('P2', sx + cellSizeX / 2, sy + cellSizeY / 2);
    }

    // Відображення спавну P3 (Ціан)
    if (this.mapData.p3Spawn) {
      const sx = this.mapData.p3Spawn.x * cellSizeX;
      const sy = this.mapData.p3Spawn.y * cellSizeY;
      this.ctx.fillStyle = 'rgba(0, 210, 211, 0.4)';
      this.ctx.fillRect(sx, sy, cellSizeX, cellSizeY);
      this.ctx.strokeStyle = '#00d2d3';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(sx + 2, sy + 2, cellSizeX - 4, cellSizeY - 4);
      this.ctx.fillStyle = '#00d2d3';
      this.ctx.font = `${Math.floor(cellSize * 0.45)}px 'Press Start 2P', monospace`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText('P3', sx + cellSizeX / 2, sy + cellSizeY / 2);
    }

    // Відображення спавну P4 (Фіолетовий)
    if (this.mapData.p4Spawn) {
      const sx = this.mapData.p4Spawn.x * cellSizeX;
      const sy = this.mapData.p4Spawn.y * cellSizeY;
      this.ctx.fillStyle = 'rgba(224, 86, 253, 0.4)';
      this.ctx.fillRect(sx, sy, cellSizeX, cellSizeY);
      this.ctx.strokeStyle = '#e056fd';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(sx + 2, sy + 2, cellSizeX - 4, cellSizeY - 4);
      this.ctx.fillStyle = '#e056fd';
      this.ctx.font = `${Math.floor(cellSize * 0.45)}px 'Press Start 2P', monospace`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText('P4', sx + cellSizeX / 2, sy + cellSizeY / 2);
    }
  }
};

export default MapEditor;
