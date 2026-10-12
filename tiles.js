/**
 * tiles.js — Реєстр типів блоків та елементів карти (Extensible Tile Registry)
 * 
 * Експортує централізовану конфігурацію TILE_TYPES та допоміжний словник TILE_BY_ID.
 * Будь-який новий блок, доданий сюди, автоматично з'являється у палітрі редактора!
 */

export const TILE_TYPES = {
  EMPTY: {
    id: 0,
    name: 'Порожньо (Ластик)',
    description: 'Вільна клітинка арени. Органічний темний ґрунт без перешкод.',
    color: '#0f1419',
    editorColor: '#11171d',
    blocksTank: false,
    blocksBullet: false,
    destructible: false,
    maxHp: 0,
    draw: (ctx, x, y, size) => {
      drawOrganicSoilBase(ctx, x, y, size);
    }
  },

  BRICK: {
    id: 1,
    name: 'Цегла (2 постріли)',
    description: 'Класична цегляна стіна. Зупиняє танки та снаряди, руйнується за 2 влучання будь-якої гармати. Відновлюється на початку кожного раунду.',
    color: '#b84418',
    editorColor: '#b84418',
    blocksTank: true,
    blocksBullet: true,
    destructible: true,
    maxHp: 2,
    draw: (ctx, x, y, size, wavePhase = 0, hp = 2) => {
      // 1. ОДИН ЦІЛІСНИЙ МОНОЛІТНИЙ БЛОК ЦЕГЛИ (НЕ 4 В 1)
      ctx.fillStyle = '#380e03'; // Темний шовний розчин контуру
      ctx.fillRect(x, y, size, size);

      const inset = Math.max(1, Math.floor(size * 0.06));
      const bodyW = size - inset * 2;
      const bodyH = size - inset * 2;

      // Основне тіло цегли
      ctx.fillStyle = '#b84418';
      ctx.fillRect(x + inset, y + inset, bodyW, bodyH);

      // 3D рельєф (Bevel): верхній і лівий відблиск
      ctx.fillStyle = '#e56336';
      ctx.fillRect(x + inset, y + inset, bodyW, 2);
      ctx.fillRect(x + inset, y + inset, 2, bodyH);

      // 3D рельєф (Bevel): нижня і права тінь
      ctx.fillStyle = '#4a1505';
      ctx.fillRect(x + inset, y + size - inset - 2, bodyW, 2);
      ctx.fillRect(x + size - inset - 2, y + inset, 2, bodyH);

      // Центральний горизонтальний шов єдиного монолітного блоку
      const midY = y + Math.floor(size / 2);
      ctx.fillStyle = '#380e03';
      ctx.fillRect(x + inset, midY - 1, bodyW, 2);
      ctx.fillStyle = '#e56336';
      ctx.fillRect(x + inset, midY + 1, bodyW, 1);

      // Вертикальні поперечні розшивки для автентичної цегляної кладки
      const quarterW = Math.floor(bodyW / 2);
      ctx.fillStyle = '#380e03';
      ctx.fillRect(x + inset + quarterW, y + inset, 2, midY - (y + inset));
      ctx.fillRect(x + inset + Math.floor(quarterW * 0.5), midY + 1, 2, y + size - inset - midY - 1);
      ctx.fillRect(x + inset + Math.floor(quarterW * 1.5), midY + 1, 2, y + size - inset - midY - 1);

      // Тріщини при пошкодженні (після 1-го пострілу, коли hp < 2)
      if (hp < 2) {
        drawDamageCracks(ctx, x, y, size, 1);
      }
    }
  },

  STEEL: {
    id: 2,
    name: 'Бетон / Сталь (Непробивний)',
    description: 'Монолітна сталева бронеплита. Повністю непробивна для будь-яких снарядів, блокує рух танків та лінію огляду.',
    color: '#bdc3c7',
    editorColor: '#bdc3c7',
    blocksTank: true,
    blocksBullet: true,
    destructible: false,
    maxHp: 0,
    draw: (ctx, x, y, size) => {
      // 1. ОДИН ЦІЛІСНИЙ МОНОЛІТНИЙ СТАЛЕВИЙ БРОНЕБЛОК (НЕ 4 В 1)
      ctx.fillStyle = '#2c3e50'; // Темна металева рама
      ctx.fillRect(x, y, size, size);

      const border = Math.max(2, Math.floor(size * 0.08));
      const plateW = size - border * 2;
      const plateH = size - border * 2;

      // Основна сталева плита
      ctx.fillStyle = '#95a5a6';
      ctx.fillRect(x + border, y + border, plateW, plateH);

      // Внутрішня дзеркальна сталева поверхня
      const innerPad = Math.max(2, Math.floor(size * 0.14));
      ctx.fillStyle = '#bdc3c7';
      ctx.fillRect(x + innerPad, y + innerPad, size - innerPad * 2, size - innerPad * 2);

      // Яскравий металевий блік зверху та зліва
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + border, y + border, plateW, 2);
      ctx.fillRect(x + border, y + border, 2, plateH);
      ctx.fillRect(x + innerPad, y + innerPad, size - innerPad * 2, 1.5);
      ctx.fillRect(x + innerPad, y + innerPad, 1.5, size - innerPad * 2);

      // Глибока тінь знизу та справа
      ctx.fillStyle = '#34495e';
      ctx.fillRect(x + border, y + size - border - 2, plateW, 2);
      ctx.fillRect(x + size - border - 2, y + border, 2, plateH);

      // 4 промислові кутові заклепки (Rivets) цілісного бронеблоку
      const rOffset = Math.max(3, Math.floor(size * 0.16));
      const rSize = Math.max(2, Math.floor(size * 0.09));
      const rivetCoords = [
        { rx: x + rOffset, ry: y + rOffset },
        { rx: x + size - rOffset - rSize, ry: y + rOffset },
        { rx: x + rOffset, ry: y + size - rOffset - rSize },
        { rx: x + size - rOffset - rSize, ry: y + size - rOffset - rSize }
      ];

      rivetCoords.forEach(pt => {
        ctx.fillStyle = '#1e272e';
        ctx.fillRect(pt.rx, pt.ry, rSize, rSize);
        ctx.fillStyle = '#ecf0f1';
        ctx.fillRect(pt.rx + 1, pt.ry + 1, Math.max(1, rSize - 2), Math.max(1, rSize - 2));
      });

      // Центральне ребро жорсткості
      const mid = Math.floor(size / 2);
      ctx.fillStyle = '#7f8c8d';
      ctx.fillRect(x + mid - 1, y + innerPad + 2, 2, size - innerPad * 2 - 4);
      ctx.fillRect(x + innerPad + 2, y + mid - 1, size - innerPad * 2 - 4, 2);
    }
  },

  WATER: {
    id: 3,
    name: '🌊 Глибока вода',
    description: 'Глибоководна перешкода: блокує проїзд танків (окрім божественної здібності «Ходіння по глибокій воді», при цьому сповільнює рух на 50%). Снаряди та промінь прямої видимості пролітають над водою вільно.',
    color: '#0984e3',
    editorColor: '#0984e3',
    blocksTank: true,
    blocksBullet: false, // Снаряди пролітають крізь воду!
    destructible: false,
    slowFactor: 0.5, // Сповільнює танк на 50% (коли танк їде по глибокій воді)
    isWater: true,
    isDeepWater: true,
    maxHp: 0,
    draw: (ctx, x, y, size, wavePhase = 0) => {
      drawDeepWaterTile(ctx, x, y, size, wavePhase);
    }
  },

  BUSH: {
    id: 4,
    name: '🌿 Кущі (Маскування)',
    description: 'Шар маскування поверх будь-якої клітинки. Коли понад 50% корпусу танка в кущах, він стає повністю невидимим для ворога (окрім контакту впритул).',
    color: '#10ac84',
    editorColor: '#10ac84',
    isOverlay: true, // Може накладатися поверх будь-якого блоку або стояти окремо
    blocksTank: false, // Танк вільно їздить крізь кущі
    blocksBullet: false, // Снаряди пролітають крізь кущі
    destructible: false,
    maxHp: 0,
    draw: (ctx, x, y, size) => {
      drawBush(ctx, x, y, size);
    }
  },

  STONE_2HP: {
    id: 5,
    name: 'Міцний блок (4 постріли)',
    description: 'Армований кам\'яний блок підвищеної міцності. Витримує 4 влучання (поступово вкривається тріщинами). Блокує танки та снаряди.',
    color: '#4b6584',
    editorColor: '#4b6584',
    blocksTank: true,
    blocksBullet: true,
    destructible: true,
    maxHp: 4,
    draw: (ctx, x, y, size, wavePhase = 0, hp = 4) => {
      // 1. ОДИН ЦІЛІСНИЙ МОНОЛІТНИЙ КАМ'ЯНИЙ БЛОК (4 HP)
      ctx.fillStyle = '#1e272e'; // Темний монолітний каркас
      ctx.fillRect(x, y, size, size);

      const border = Math.max(2, Math.floor(size * 0.08));
      const innerW = size - border * 2;
      const innerH = size - border * 2;

      // Тіло темного армованого базальту/граніту
      ctx.fillStyle = '#4b6584';
      ctx.fillRect(x + border, y + border, innerW, innerH);

      // Верхній/лівий кам'яний відблиск
      ctx.fillStyle = '#778ca3';
      ctx.fillRect(x + border, y + border, innerW, 2);
      ctx.fillRect(x + border, y + border, 2, innerH);

      // Нижня/права тінь
      ctx.fillStyle = '#2c3e50';
      ctx.fillRect(x + border, y + size - border - 2, innerW, 2);
      ctx.fillRect(x + size - border - 2, y + border, 2, innerH);

      // Сталеві пояси армування цілісного блоку (дві горизонтальні смуги)
      const bandY1 = y + Math.floor(size * 0.3);
      const bandY2 = y + Math.floor(size * 0.65);
      ctx.fillStyle = '#2f3542';
      ctx.fillRect(x + border, bandY1, innerW, 3);
      ctx.fillRect(x + border, bandY2, innerW, 3);
      ctx.fillStyle = '#a4b0be';
      ctx.fillRect(x + border, bandY1 + 1, innerW, 1.5);
      ctx.fillRect(x + border, bandY2 + 1, innerW, 1.5);

      // 2 індикатори міцності (заклепки/маркери для 4 HP)
      const dotY = y + Math.floor(size / 2);
      const dotR = Math.max(2, Math.floor(size * 0.07));
      const midX = x + Math.floor(size / 2);

      // Відображення стану HP (4 постріли)
      ctx.fillStyle = hp >= 3 ? '#2ecc71' : (hp === 2 ? '#f1c40f' : '#e74c3c');
      ctx.fillRect(midX - dotR - 4, dotY - dotR, dotR * 2, dotR * 2);
      ctx.fillStyle = hp >= 4 ? '#2ecc71' : (hp >= 2 ? '#f1c40f' : '#e74c3c');
      ctx.fillRect(midX + 4 - dotR, dotY - dotR, dotR * 2, dotR * 2);

      // Тріщини при пошкодженні (від 3 HP до 1 HP)
      if (hp === 3 || hp === 2) {
        drawDamageCracks(ctx, x, y, size, 1);
      } else if (hp === 1) {
        drawDamageCracks(ctx, x, y, size, 2);
      }
    }
  },

  ARMORED_3HP: {
    id: 6,
    name: 'Броньований блок (6 пострілів)',
    description: 'Важке бункерне укріплення з індикаторами цілісності. Витримує 6 прямих влучань перед руйнуванням. Блокує танки та кулі.',
    color: '#2d3436',
    editorColor: '#e67e22',
    blocksTank: true,
    blocksBullet: true,
    destructible: true,
    maxHp: 6,
    draw: (ctx, x, y, size, wavePhase = 0, hp = 6) => {
      // 1. ОДИН ЦІЛІСНИЙ ВАЖКИЙ БУНКЕРНИЙ БЛОК (6 HP)
      ctx.fillStyle = '#111417'; // Надважка композитна рама
      ctx.fillRect(x, y, size, size);

      const border = Math.max(2, Math.floor(size * 0.08));
      const innerW = size - border * 2;
      const innerH = size - border * 2;

      // Основна титанова пластина
      ctx.fillStyle = '#2d3436';
      ctx.fillRect(x + border, y + border, innerW, innerH);

      // Світлий металевий кант
      ctx.fillStyle = '#636e72';
      ctx.fillRect(x + border, y + border, innerW, 2);
      ctx.fillRect(x + border, y + border, 2, innerH);

      ctx.fillStyle = '#1e272e';
      ctx.fillRect(x + border, y + size - border - 2, innerW, 2);
      ctx.fillRect(x + size - border - 2, y + border, 2, innerH);

      // Кутові бурштинові маркування броні (Hazard/Composite corners)
      const hazardW = Math.max(4, Math.floor(size * 0.22));
      ctx.fillStyle = '#d35400';
      ctx.fillRect(x + border, y + border, hazardW, 3);
      ctx.fillRect(x + border, y + border, 3, hazardW);
      ctx.fillRect(x + size - border - hazardW, y + size - border - 3, hazardW, 3);
      ctx.fillRect(x + size - border - 3, y + size - border - hazardW, 3, hazardW);

      ctx.fillStyle = '#f39c12';
      ctx.fillRect(x + border + 1, y + border + 1, hazardW - 1, 1.5);
      ctx.fillRect(x + border + 1, y + border + 1, 1.5, hazardW - 1);

      // Центральна посилена шестикутна серцевина
      const midX = x + Math.floor(size / 2);
      const midY = y + Math.floor(size / 2);
      const coreR = Math.max(4, Math.floor(size * 0.24));
      ctx.fillStyle = '#3d4554';
      ctx.fillRect(midX - coreR, midY - coreR, coreR * 2, coreR * 2);
      ctx.fillStyle = '#57606f';
      ctx.fillRect(midX - coreR + 1, midY - coreR + 1, coreR * 2 - 2, 1.5);

      // 3 світлодіоди/заклепки міцності цілісного бронеблоку (кожний відповідає за 2 HP із 6)
      const nodeR = Math.max(2, Math.floor(size * 0.065));
      const spacing = Math.max(5, Math.floor(size * 0.16));

      // Індикатор 1 (зліва: 1-2 HP)
      ctx.fillStyle = hp >= 2 ? '#2ecc71' : (hp === 1 ? '#f1c40f' : '#c0392b');
      ctx.fillRect(midX - spacing - nodeR, midY - nodeR, nodeR * 2, nodeR * 2);

      // Індикатор 2 (по центру: 3-4 HP)
      ctx.fillStyle = hp >= 4 ? '#2ecc71' : (hp === 3 ? '#f1c40f' : '#c0392b');
      ctx.fillRect(midX - nodeR, midY - nodeR, nodeR * 2, nodeR * 2);

      // Індикатор 3 (справа: 5-6 HP)
      ctx.fillStyle = hp >= 6 ? '#2ecc71' : (hp === 5 ? '#f1c40f' : '#c0392b');
      ctx.fillRect(midX + spacing - nodeR, midY - nodeR, nodeR * 2, nodeR * 2);

      // Візуальні пошкодження тріщинами
      if (hp <= 4 && hp >= 3) {
        drawDamageCracks(ctx, x, y, size, 1);
      } else if (hp <= 2 && hp >= 1) {
        drawDamageCracks(ctx, x, y, size, 2);
      }
    }
  },

  GRASS: {
    id: 7,
    name: '🌱 Декоративна трава 1',
    description: 'Ділянка тонкої трави на темному ґрунті арени (на одному рівні з льодом та іншим декором). Не заважає руху танків чи польоту куль і не дає невидимості.',
    color: '#27ae60',
    editorColor: '#27ae60',
    blocksTank: false, // Танк вільно пересувається по траві
    blocksBullet: false, // Снаряди вільно пролітають крізь траву
    destructible: false,
    isGroundLayer: true,
    isGroundDecor: true,
    maxHp: 0,
    draw: (ctx, x, y, size) => {
      drawGrassTile(ctx, x, y, size);
    }
  },

  SHALLOW_WATER: {
    id: 8,
    name: '💧 Мілка вода',
    description: 'Мілководний брід: дозволяє проїзд танків, але сповільнює їхню швидкість на 50% (якщо немає здібності «Всюдихід»). Снаряди пролітають вільно.',
    color: '#00a8ff',
    editorColor: '#00a8ff',
    blocksTank: false, // Танк може їхати по мілкій воді
    blocksBullet: false, // Снаряди пролітають вільно
    destructible: false,
    slowFactor: 0.5, // Сповільнює танк на 50%
    isWater: true,
    isShallowWater: true,
    maxHp: 0,
    draw: (ctx, x, y, size, wavePhase = 0) => {
      // 1. Світліша бірюзово-блакитна основа мілководдя (чітко відрізняється від темно-синьої глибокої води)
      ctx.fillStyle = '#0c638c';
      ctx.fillRect(x, y, size, size);

      const inset = Math.max(1, Math.floor(size * 0.06));
      ctx.fillStyle = '#1488b8';
      ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);

      // 2. Просвіти мілкого піщано-галькового дна
      ctx.fillStyle = 'rgba(129, 236, 236, 0.25)';
      ctx.fillRect(x + Math.floor(size * 0.16), y + Math.floor(size * 0.18), Math.floor(size * 0.28), Math.floor(size * 0.22));
      ctx.fillRect(x + Math.floor(size * 0.52), y + Math.floor(size * 0.55), Math.floor(size * 0.30), Math.floor(size * 0.24));

      // 3. Легкі рухомі брижі на поверхні мілкої води
      ctx.fillStyle = '#81ecec';
      const offset1 = (wavePhase * 3) % Math.max(1, size - 8);
      const offset2 = ((wavePhase + 2) * 3) % Math.max(1, size - 8);
      ctx.fillRect(x + 2 + offset1, y + Math.floor(size * 0.28), Math.floor(size * 0.28), 1.8);
      ctx.fillRect(x + 2 + offset2, y + Math.floor(size * 0.68), Math.floor(size * 0.32), 1.8);

      // Тонкий світлий контур мілководдя
      ctx.strokeStyle = 'rgba(116, 185, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    }
  },

  LOW_BUSH: {
    id: 9,
    name: '🌾 Низькі кущі',
    description: 'Чагарник висотою до башти танка (вище корпуса, але нижче дула): перебуваючи в ньому, ти НЕ можеш бачити ворога, проте ворог бачить тебе. У поєднанні з високими кущами — ні ти не бачиш ворога, ні ворог не бачить тебе!',
    color: '#6ab04c',
    editorColor: '#6ab04c',
    blocksTank: false,
    blocksBullet: false,
    destructible: false,
    isLowBush: true,
    maxHp: 0,
    draw: (ctx, x, y, size) => {
      drawLowBushTile(ctx, x, y, size);
    },
    drawFoliage: (ctx, x, y, size) => {
      drawLowBushFoliage(ctx, x, y, size);
    }
  },

  ICE: {
    id: 10,
    name: '🧊 Лід',
    description: 'Крижана поверхня на рівні землі (на одному рівні з декоративною травою та камінням — взаємно замінює їх): танк отримує інерцію руху та ковзає по льоду.',
    color: '#7ed6df',
    editorColor: '#7ed6df',
    blocksTank: false,
    blocksBullet: false,
    destructible: false,
    isIce: true,
    isGroundLayer: true,
    isGroundDecor: true,
    maxHp: 0,
    draw: (ctx, x, y, size) => {
      drawIceTile(ctx, x, y, size);
    }
  },

  GRASS_2: {
    id: 11,
    name: '🌿 Декоративна трава 2',
    description: 'Другий варіант дрібної польової трави з конюшиною на темному ґрунті арени (на одному рівні з льодом). Не заважає руху танків чи польоту куль.',
    color: '#2ecc71',
    editorColor: '#2ecc71',
    blocksTank: false,
    blocksBullet: false,
    destructible: false,
    isGroundLayer: true,
    isGroundDecor: true,
    maxHp: 0,
    draw: (ctx, x, y, size) => {
      drawGrassTile2(ctx, x, y, size);
    }
  },

  STONE_DECOR_1: {
    id: 12,
    name: '🪨 Декоративне каміння 1',
    description: 'Дрібна розсипчаста галька на темному ґрунті в стилі декоративної трави (на одному рівні з льодом). Не заважає руху танків чи польоту куль.',
    color: '#7f8c8d',
    editorColor: '#7f8c8d',
    blocksTank: false,
    blocksBullet: false,
    destructible: false,
    isGroundLayer: true,
    isGroundDecor: true,
    maxHp: 0,
    draw: (ctx, x, y, size) => {
      drawStoneDecorTile1(ctx, x, y, size);
    }
  },

  STONE_DECOR_2: {
    id: 13,
    name: '🪨 Декоративне каміння 2',
    description: 'Другий варіант дрібного гострокутного каміння на рівні землі (на одному рівні з льодом). Не заважає руху танків чи польоту куль.',
    color: '#95a5a6',
    editorColor: '#95a5a6',
    blocksTank: false,
    blocksBullet: false,
    destructible: false,
    isGroundLayer: true,
    isGroundDecor: true,
    maxHp: 0,
    draw: (ctx, x, y, size) => {
      drawStoneDecorTile2(ctx, x, y, size);
    }
  }
};

/**
 * Процедурний рендеринг реалістичних тріщин пошкодження (Damage Cracks)
 * @param {CanvasRenderingContext2D} ctx 
 * @param {number} x - координата X
 * @param {number} y - координата Y
 * @param {number} size - розмір клітинки
 * @param {number} damageLevel - 1 (помірна тріщина), 2 (глибокий розлам)
 */
export function drawDamageCracks(ctx, x, y, size, damageLevel = 1) {
  ctx.save();
  const midX = x + Math.floor(size * 0.5);
  const midY = y + Math.floor(size * 0.48);

  // 1. ТЕМНА ГЛИБОКА ТРІЩИНА
  ctx.strokeStyle = '#05070a';
  ctx.lineWidth = Math.max(1.5, Math.floor(size * 0.06));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'miter';

  ctx.beginPath();
  // Основний розлам по діагоналі
  ctx.moveTo(x + Math.floor(size * 0.22), y + Math.floor(size * 0.2));
  ctx.lineTo(x + Math.floor(size * 0.38), y + Math.floor(size * 0.42));
  ctx.lineTo(midX, midY);
  ctx.lineTo(x + Math.floor(size * 0.68), y + Math.floor(size * 0.58));
  ctx.lineTo(x + Math.floor(size * 0.82), y + Math.floor(size * 0.8));
  ctx.stroke();

  // 2. СВІТЛИЙ БЛІК ВІДКОЛУ НА КРАЯХ ТРІЩИНИ (додає 3D глибини)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + Math.floor(size * 0.22) + 1, y + Math.floor(size * 0.2) + 1);
  ctx.lineTo(x + Math.floor(size * 0.38) + 1, y + Math.floor(size * 0.42) + 1);
  ctx.lineTo(midX + 1, midY + 1);
  ctx.stroke();

  // 3. ЯКЩО DAMAGE LEVEL 2 (СИЛЬНІ ПАВУТИННІ РОЗЛАМИ)
  if (damageLevel >= 2) {
    ctx.strokeStyle = '#05070a';
    ctx.lineWidth = Math.max(1.5, Math.floor(size * 0.055));

    ctx.beginPath();
    // Бічне розгалуження вліво вниз
    ctx.moveTo(midX, midY);
    ctx.lineTo(x + Math.floor(size * 0.32), y + Math.floor(size * 0.74));
    ctx.lineTo(x + Math.floor(size * 0.16), y + Math.floor(size * 0.82));

    // Бічне розгалуження вправо вгору
    ctx.moveTo(midX, midY);
    ctx.lineTo(x + Math.floor(size * 0.65), y + Math.floor(size * 0.28));
    ctx.lineTo(x + Math.floor(size * 0.86), y + Math.floor(size * 0.22));
    ctx.stroke();

    // Світловий контур розгалужень
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(midX + 1, midY + 1);
    ctx.lineTo(x + Math.floor(size * 0.32) + 1, y + Math.floor(size * 0.74) + 1);
    ctx.moveTo(midX + 1, midY + 1);
    ctx.lineTo(x + Math.floor(size * 0.65) + 1, y + Math.floor(size * 0.28) + 1);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Рендеринг кущів: Варіант 1 «Ажурна перфорована крона» (Pixel Foliage Cutout)
 * 
 * Базовий блок (цегла, вода, камінь, сталь чи ґрунт) залишається чітко видимим
 * крізь органічні просвіти (32-34% площі клітинки). Листя формує пишні подушки з
 * м'якою тінню без суцільного закриття блоку.
 */
export function drawBush(ctx, x, y, size) {
  const s = size / 32;
  const p = (v) => Math.round(v * s);

  // Органічні листяні пластини / шапки крони (Lush Leaf Lobes)
  const clusters = [
    // 1. Верхньо-ліва шапка листя
    { x: 1,  y: 1,  w: 11, h: 10 },
    { x: 3,  y: 11, w: 7,  h: 4 },
    { x: 11, y: 3,  w: 4,  h: 5 },

    // 2. Верхньо-права шапка
    { x: 19, y: 2,  w: 12, h: 10 },
    { x: 16, y: 4,  w: 4,  h: 5 },
    { x: 21, y: 10, w: 8,  h: 3 },

    // 3. Нижньо-ліва шапка
    { x: 1,  y: 18, w: 12, h: 12 },
    { x: 11, y: 21, w: 4,  h: 6 },

    // 4. Нижньо-права шапка
    { x: 18, y: 17, w: 12, h: 12 },
    { x: 13, y: 20, w: 6,  h: 7 },

    // Невеликий внутрішній пагін у бік просвіту
    { x: 11, y: 12, w: 3,  h: 3 }
  ];

  // 1. М'яка контактна тінь на базовому блоці під листям (Ambient Drop Shadow)
  ctx.fillStyle = 'rgba(5, 22, 12, 0.42)';
  const sh = Math.max(1, p(1.5));
  clusters.forEach(c => {
    ctx.fillRect(x + p(c.x) + sh, y + p(c.y) + sh, p(c.w), p(c.h));
  });

  // 2. Глибока темна основа крони (Темний контур зелені)
  ctx.fillStyle = '#143d2b';
  clusters.forEach(c => {
    ctx.fillRect(x + p(c.x), y + p(c.y), p(c.w), p(c.h));
  });

  // Зубчасті піксельні виступи на зовнішніх краях
  const frills = [
    { fx: 3,  fy: 0,  w: 6, h: 1 },
    { fx: 21, fy: 1,  w: 6, h: 1 },
    { fx: 0,  fy: 3,  w: 1, h: 6 },
    { fx: 31, fy: 3,  w: 1, h: 6 },
    { fx: 0,  fy: 20, w: 1, h: 6 },
    { fx: 31, fy: 19, w: 1, h: 6 },
    { fx: 3,  fy: 30, w: 6, h: 1 },
    { fx: 20, fy: 30, w: 7, h: 1 }
  ];
  frills.forEach(f => {
    ctx.fillRect(x + p(f.fx), y + p(f.fy), Math.max(1, p(f.w)), Math.max(1, p(f.h)));
  });

  // 3. Основне пишне тіло листяних шапок (Смарагдова зелень)
  ctx.fillStyle = '#2d6a4f';
  clusters.forEach(c => {
    const pad = Math.max(1, p(1.5));
    if (p(c.w) > pad * 2 && p(c.h) > pad * 2) {
      ctx.fillRect(x + p(c.x) + pad, y + p(c.y) + pad, p(c.w) - pad * 2, p(c.h) - pad * 2);
    }
  });

  // 4. Освітлені шари листяних подушок (Соковитий салатово-зелений)
  ctx.fillStyle = '#40916c';
  const leafPads = [
    { px: 2,  py: 2,  w: 8,  h: 7 },
    { px: 20, py: 3,  w: 9,  h: 6 },
    { px: 3,  py: 20, w: 8,  h: 7 },
    { px: 20, py: 19, w: 9,  h: 7 },
    { px: 14, py: 21, w: 5,  h: 5 }
  ];
  leafPads.forEach(lp => {
    ctx.fillRect(x + p(lp.px), y + p(lp.py), p(lp.w), p(lp.h));
  });

  // 5. Яскраві сонячні гребені листя (Sunlit Canopy Ridges)
  ctx.fillStyle = '#52b788';
  const ridges = [
    { rx: 3,  ry: 2,  w: 6, h: 2 },
    { rx: 21, ry: 3,  w: 7, h: 2 },
    { rx: 4,  ry: 19, w: 6, h: 2 },
    { rx: 21, ry: 18, w: 7, h: 2 },
    { rx: 14, ry: 20, w: 4, h: 2 }
  ];
  ridges.forEach(r => {
    ctx.fillRect(x + p(r.rx), y + p(r.ry), p(r.w), p(r.h));
  });

  // 6. Світлі золотисто-зелені акценти та відблиски роси на верхівках
  ctx.fillStyle = '#74c69d';
  const highlights = [
    { hx: 4,  hy: 2,  w: 4, h: 1 },
    { hx: 22, hy: 3,  w: 4, h: 1 },
    { hx: 5,  hy: 19, w: 4, h: 1 },
    { hx: 22, hy: 18, w: 4, h: 1 },
    { hx: 15, hy: 20, w: 3, h: 1 }
  ];
  highlights.forEach(h => {
    ctx.fillRect(x + p(h.hx), y + p(h.hy), Math.max(2, p(h.w)), Math.max(1, p(h.h)));
  });

  // Сяючі піксельні крапки
  ctx.fillStyle = '#d8f3dc';
  ctx.fillRect(x + p(5),  y + p(3),  Math.max(1, p(1)), Math.max(1, p(1)));
  ctx.fillRect(x + p(23), y + p(4),  Math.max(1, p(1)), Math.max(1, p(1)));
  ctx.fillRect(x + p(5),  y + p(20), Math.max(1, p(1)), Math.max(1, p(1)));
  ctx.fillRect(x + p(23), y + p(19), Math.max(1, p(1)), Math.max(1, p(1)));

  // 7. Природні тіньові прожилки всередині масиву (глибина листя)
  ctx.fillStyle = '#143d2b';
  ctx.fillRect(x + p(6),  y + p(7),  p(3), Math.max(1, p(1.5)));
  ctx.fillRect(x + p(22), y + p(8),  p(4), Math.max(1, p(1.5)));
  ctx.fillRect(x + p(6),  y + p(24), p(4), Math.max(1, p(1.5)));
  ctx.fillRect(x + p(22), y + p(23), p(4), Math.max(1, p(1.5)));
}

/**
 * Рендеринг ультратонкої травинки / пучка (ширина кожної травинки рівно 1 px)
 */
export function drawGrassTuft(ctx, gx, gy, seed = 0.5) {
  ctx.save();
  const bx = Math.round(gx);
  const by = Math.round(gy);

  // Тонка 1px тінь біля корінця
  ctx.fillStyle = '#090d11';
  ctx.fillRect(bx, by + 2, 1, 1);

  // Тонке стебло 1px завширшки
  ctx.fillStyle = '#1e7e46';
  ctx.fillRect(bx, by, 1, 2);

  // Світлий кінчик 1x1 px
  ctx.fillStyle = seed > 0.5 ? '#2ecc71' : '#52be80';
  ctx.fillRect(bx, by - 1, 1, 1);

  ctx.restore();
}

/**
 * Рендеринг органічної підкладки темного ґрунту арени (використовується у порожніх клітинках, траві та декоративному камінні)
 * Без штучної центральної крапки та різких рамок — сусідні клітинки органічно зливаються одна з одною.
 */
export function drawOrganicSoilBase(ctx, x, y, size) {
  const s = size / 32;
  const p = (v) => Math.round(v * s);

  // 1. Базовий темний ґрунт арени (єдиний тон для EMPTY, GRASS, GRASS_2, STONE_DECOR_1, STONE_DECOR_2)
  ctx.fillStyle = '#0f1419';
  ctx.fillRect(x, y, size, size);

  // 2. М'які природні мікро-плями ґрунту (ледь помітна градація без виділення центру)
  const darkSoilPatches = [
    { x: 2,  y: 2,  w: 10, h: 8, c: '#11171d' },
    { x: 17, y: 3,  w: 11, h: 8, c: '#0d1217' },
    { x: 8,  y: 12, w: 13, h: 8, c: '#12181f' },
    { x: 2,  y: 21, w: 11, h: 8, c: '#0d1217' },
    { x: 18, y: 20, w: 11, h: 9, c: '#11171d' }
  ];
  darkSoilPatches.forEach(sp => {
    ctx.fillStyle = sp.c;
    ctx.fillRect(x + p(sp.x), y + p(sp.y), Math.max(2, p(sp.w)), Math.max(2, p(sp.h)));
  });

  // 3. Поодинокі мікро-пищинки ґрунту 1x1 px по краях/діагоналях (природна фактура землі)
  if (size >= 20) {
    ctx.fillStyle = '#151c24';
    ctx.fillRect(x + p(6),  y + p(8),  1, 1);
    ctx.fillRect(x + p(23), y + p(6),  1, 1);
    ctx.fillRect(x + p(11), y + p(24), 1, 1);
    ctx.fillRect(x + p(26), y + p(22), 1, 1);

    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(x + p(14), y + p(5),  1, 1);
    ctx.fillRect(x + p(5),  y + p(18), 1, 1);
    ctx.fillRect(x + p(21), y + p(15), 1, 1);
  }

  // 4. Надтонкий напівпрозорий контур сітки, що не ріже око
  ctx.strokeStyle = 'rgba(22, 29, 38, 0.42)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
}

/**
 * Рендеринг клітинки декоративної трави:
 * - Органічний темний ґрунт ідентичний порожній клітинці
 * - Травинки ультратонкі (ширина строго 1px), 52 тонкі травинки по всій клітинці
 */
export function drawGrassTile(ctx, x, y, size) {
  ctx.save();
  const s = size / 32;
  const p = (v) => Math.round(v * s);

  // 1. Єдина органічна основа темного ґрунту
  drawOrganicSoilBase(ctx, x, y, size);

  // 2. 52 тонкі окремі травинки (ширина кожної травинки СТРОГО 1px, без злиття у товсті блоки!)
  const fineBlades = [
    // Ряд 1
    { x: 2, y: 3, h: 2 }, { x: 5, y: 2, h: 3 }, { x: 8, y: 4, h: 2 }, { x: 11, y: 2, h: 2 },
    { x: 14, y: 3, h: 3 }, { x: 17, y: 2, h: 2 }, { x: 20, y: 4, h: 3 }, { x: 23, y: 2, h: 2 },
    { x: 26, y: 3, h: 3 }, { x: 29, y: 2, h: 2 },
    // Ряд 2
    { x: 3, y: 7, h: 3 }, { x: 6, y: 6, h: 2 }, { x: 9, y: 8, h: 3 }, { x: 12, y: 6, h: 2 },
    { x: 16, y: 7, h: 2 }, { x: 19, y: 6, h: 3 }, { x: 22, y: 8, h: 2 }, { x: 25, y: 7, h: 3 },
    { x: 28, y: 6, h: 2 },
    // Ряд 3
    { x: 2, y: 12, h: 2 }, { x: 5, y: 11, h: 3 }, { x: 8, y: 13, h: 2 }, { x: 11, y: 11, h: 3 },
    { x: 14, y: 12, h: 2 }, { x: 18, y: 11, h: 3 }, { x: 21, y: 13, h: 2 }, { x: 24, y: 11, h: 2 },
    { x: 27, y: 12, h: 3 }, { x: 30, y: 11, h: 2 },
    // Ряд 4
    { x: 4, y: 17, h: 3 }, { x: 7, y: 16, h: 2 }, { x: 10, y: 18, h: 3 }, { x: 13, y: 16, h: 2 },
    { x: 16, y: 17, h: 3 }, { x: 20, y: 16, h: 2 }, { x: 23, y: 18, h: 3 }, { x: 26, y: 16, h: 2 },
    { x: 29, y: 17, h: 3 },
    // Ряд 5
    { x: 2, y: 22, h: 2 }, { x: 5, y: 23, h: 3 }, { x: 9, y: 21, h: 2 }, { x: 12, y: 23, h: 3 },
    { x: 15, y: 22, h: 2 }, { x: 18, y: 24, h: 3 }, { x: 22, y: 22, h: 2 }, { x: 25, y: 23, h: 3 },
    { x: 28, y: 21, h: 2 },
    // Ряд 6
    { x: 3, y: 28, h: 3 }, { x: 7, y: 27, h: 2 }, { x: 11, y: 29, h: 2 }, { x: 15, y: 27, h: 3 },
    { x: 19, y: 28, h: 2 }, { x: 23, y: 27, h: 3 }, { x: 27, y: 29, h: 2 }, { x: 30, y: 27, h: 2 }
  ];

  fineBlades.forEach((b, idx) => {
    const bx = x + p(b.x);
    const by = y + p(b.y);
    const bh = Math.max(2, Math.round(b.h * Math.min(1.15, Math.max(0.85, s))));

    // Тонка 1px тінь під травинкою
    ctx.fillStyle = '#090c10';
    ctx.fillRect(bx, by + bh, 1, 1);

    // Тонке 1px стебло травинки
    ctx.fillStyle = (idx % 2 === 0) ? '#1b6d3e' : '#21834b';
    ctx.fillRect(bx, by, 1, bh);

    // Тонкий 1x1 px світлий кінчик (іноді з легким нахилом на 1px уверх)
    ctx.fillStyle = (idx % 3 === 0) ? '#45cd7d' : '#2ecc71';
    ctx.fillRect(bx, by, 1, 1);
  });

  ctx.restore();
}

/**
 * Рендеринг оновленої Глибокої води (TILE_TYPES.WATER)
 * Безшовна текстура глибокого океану/річки без білих чи блакитних смуг на стиках між клітинками
 */
export function drawDeepWaterTile(ctx, x, y, size, wavePhase = 0) {
  ctx.save();
  const s = size / 32;
  const p = (v) => Math.round(v * s);

  // 1. Базова глибока темно-синя гладь (без будь-яких контрастних рамок по краях, щоб сусідні блоки зливалися)
  ctx.fillStyle = '#0f2454';
  ctx.fillRect(x, y, size, size);

  // 2. Органічні підводні западини (темніші плями глибини)
  ctx.fillStyle = '#0a193d';
  ctx.fillRect(x + p(3), y + p(4), p(12), p(9));
  ctx.fillRect(x + p(15), y + p(17), p(14), p(10));
  ctx.fillRect(x + p(4), y + p(21), p(9), p(7));

  // 3. Проміжні підводні течії середньої глибини
  ctx.fillStyle = '#16357a';
  ctx.fillRect(x + p(16), y + p(3), p(12), p(7));
  ctx.fillRect(x + p(2), y + p(13), p(11), p(6));
  ctx.fillRect(x + p(12), y + p(25), p(15), p(5));

  // 4. Плавні анімовані гребені глибоководних хвиль усередині клітинки
  const shift1 = ((wavePhase % 4) - 1.5) * p(1.5);
  const shift2 = (((wavePhase + 2) % 4) - 1.5) * p(1.5);

  ctx.fillStyle = '#1e4db7';
  ctx.fillRect(x + p(5) + shift1, y + p(6), p(10), Math.max(2, p(2)));
  ctx.fillRect(x + p(15) + shift2, y + p(15), p(11), Math.max(2, p(2)));
  ctx.fillRect(x + p(7) - shift1, y + p(24), p(10), Math.max(2, p(2)));

  // 5. Тонкі бірюзові бліки на гребенях хвиль (внутрішні, не торкаються країв клітинки)
  ctx.fillStyle = '#00a8ff';
  ctx.fillRect(x + p(7) + shift1, y + p(6), p(6), Math.max(1, p(1.2)));
  ctx.fillRect(x + p(17) + shift2, y + p(15), p(7), Math.max(1, p(1.2)));
  ctx.fillRect(x + p(9) - shift1, y + p(24), p(5), Math.max(1, p(1.2)));

  ctx.restore();
}

/**
 * Рендеринг крони «Низькі кущі» (малюється вище корпуса танка, але нижче башти/дула!)
 */
export function drawLowBushFoliage(ctx, x, y, size) {
  ctx.save();
  const s = size / 32;
  const p = (v) => Math.round(v * s);

  const bushes = [
    { cx: 6, cy: 6, w: 9, h: 7 },
    { cx: 18, cy: 5, w: 10, h: 8 },
    { cx: 11, cy: 14, w: 11, h: 8 },
    { cx: 4, cy: 21, w: 9, h: 7 },
    { cx: 20, cy: 19, w: 9, h: 8 },
    { cx: 12, cy: 24, w: 10, h: 6 }
  ];

  // Тіньова підкладка низьких чагарників
  ctx.fillStyle = 'rgba(20, 38, 15, 0.88)';
  bushes.forEach(b => {
    ctx.fillRect(x + p(b.cx - 1), y + p(b.cy), p(b.w + 2), p(b.h + 1));
  });

  // Основна оливково-зелена маса низьких кущів
  ctx.fillStyle = '#4a7c2c';
  bushes.forEach(b => {
    ctx.fillRect(x + p(b.cx), y + p(b.cy), p(b.w), p(b.h));
  });

  // Світліші верхівки листя та гілочок
  ctx.fillStyle = '#78b833';
  bushes.forEach(b => {
    ctx.fillRect(x + p(b.cx + 1), y + p(b.cy + 1), p(Math.max(3, b.w - 3)), p(Math.max(2, b.h - 4)));
  });

  // Дрібні жовто-зелені акценти суцвіть/верхівок
  ctx.fillStyle = '#badc58';
  ctx.fillRect(x + p(8), y + p(8), p(2), p(2));
  ctx.fillRect(x + p(21), y + p(7), p(2), p(2));
  ctx.fillRect(x + p(14), y + p(16), p(3), p(2));
  ctx.fillRect(x + p(7), y + p(23), p(2), p(2));
  ctx.fillRect(x + p(23), y + p(21), p(2), p(2));

  ctx.restore();
}

/**
 * Рендеринг блоку «Низькі кущі» (TILE_TYPES.LOW_BUSH, id: 9)
 * Густий низькорослий чагарник оливково-лаймового відтінку
 */
export function drawLowBushTile(ctx, x, y, size) {
  ctx.save();
  // 1. Єдиний органічний темний фон арени під кущами
  drawOrganicSoilBase(ctx, x, y, size);
  ctx.restore();

  // 2. Листя низьких кущів
  drawLowBushFoliage(ctx, x, y, size);
}

/**
 * Рендеринг другого варіанту декоративної трави (TILE_TYPES.GRASS_2, id: 11)
 * У стилі першої декоративної трави: темний фон арени + мініатюрні кущики польової конюшини й травинок
 */
export function drawGrassTile2(ctx, x, y, size) {
  ctx.save();
  const s = size / 32;
  const p = (v) => Math.round(v * s);

  // 1. Єдиний органічний темний ґрунт арени
  drawOrganicSoilBase(ctx, x, y, size);

  // 2. Мініатюрні V-подібні пучки трави та трилистники (маленькі, 1-2px)
  const tufts = [
    { x: 4, y: 5 }, { x: 11, y: 4 }, { x: 19, y: 6 }, { x: 26, y: 4 },
    { x: 7, y: 11 }, { x: 15, y: 10 }, { x: 23, y: 12 }, { x: 29, y: 10 },
    { x: 3, y: 17 }, { x: 10, y: 18 }, { x: 18, y: 16 }, { x: 25, y: 18 },
    { x: 6, y: 24 }, { x: 14, y: 23 }, { x: 21, y: 25 }, { x: 28, y: 23 },
    { x: 4, y: 29 }, { x: 12, y: 28 }, { x: 20, y: 29 }, { x: 27, y: 28 }
  ];

  tufts.forEach((t, idx) => {
    const tx = x + p(t.x);
    const ty = y + p(t.y);
    // Тінь
    ctx.fillStyle = '#090c10';
    ctx.fillRect(tx, ty + 2, 2, 1);
    // Основа кущика
    ctx.fillStyle = (idx % 2 === 0) ? '#166534' : '#15803d';
    ctx.fillRect(tx, ty, 1, 2);
    ctx.fillRect(tx + 1, ty - 1, 1, 2);
    // Світлий кінчик
    ctx.fillStyle = (idx % 3 === 0) ? '#55efc4' : '#2ecc71';
    ctx.fillRect(tx + (idx % 2), ty - 1, 1, 1);
  });

  ctx.restore();
}

/**
 * Рендеринг декоративного каміння 1 (TILE_TYPES.STONE_DECOR_1, id: 12)
 * Дрібна розсипчаста галька на темному ґрунті (маленькі камінці у масштабі декоративної трави)
 */
export function drawStoneDecorTile1(ctx, x, y, size) {
  ctx.save();
  const s = size / 32;
  const p = (v) => Math.round(v * s);

  // 1. Єдиний органічний темний фон арени
  drawOrganicSoilBase(ctx, x, y, size);

  // 2. Дрібні камінці-галька (2x2 та 3x2 px з тінями та бліками)
  const pebbles = [
    { x: 5,  y: 5,  w: 3, h: 2, c: '#636e72', hi: '#b2bec3' },
    { x: 14, y: 4,  w: 2, h: 2, c: '#57606f', hi: '#a4b0be' },
    { x: 24, y: 6,  w: 3, h: 2, c: '#747d8c', hi: '#dfe4ea' },
    { x: 8,  y: 12, w: 2, h: 2, c: '#57606f', hi: '#a4b0be' },
    { x: 19, y: 11, w: 3, h: 2, c: '#636e72', hi: '#ced6e0' },
    { x: 4,  y: 19, w: 3, h: 2, c: '#747d8c', hi: '#dfe4ea' },
    { x: 14, y: 18, w: 3, h: 3, c: '#636e72', hi: '#b2bec3' },
    { x: 25, y: 17, w: 2, h: 2, c: '#57606f', hi: '#a4b0be' },
    { x: 9,  y: 26, w: 3, h: 2, c: '#636e72', hi: '#ced6e0' },
    { x: 21, y: 25, w: 3, h: 2, c: '#747d8c', hi: '#dfe4ea' }
  ];

  pebbles.forEach(pb => {
    const px = x + p(pb.x);
    const py = y + p(pb.y);
    const pw = Math.max(2, p(pb.w));
    const ph = Math.max(2, p(pb.h));

    // Тінь під камінцем
    ctx.fillStyle = '#07090c';
    ctx.fillRect(px, py + ph, pw, 1);

    // Тіло камінця
    ctx.fillStyle = pb.c;
    ctx.fillRect(px, py, pw, ph);

    // Верхній 1px блік
    ctx.fillStyle = pb.hi;
    ctx.fillRect(px, py, Math.max(1, pw - 1), 1);
  });

  ctx.restore();
}

/**
 * Рендеринг декоративного каміння 2 (TILE_TYPES.STONE_DECOR_2, id: 13)
 * Другий варіант дрібного гострокутного сланцевого каміння та крихти на рівні землі
 */
export function drawStoneDecorTile2(ctx, x, y, size) {
  ctx.save();
  const s = size / 32;
  const p = (v) => Math.round(v * s);

  // 1. Єдиний органічний темний фон арени
  drawOrganicSoilBase(ctx, x, y, size);

  // 2. Групки дрібних гранчастих камінців та кам'яної крихти
  const shards = [
    { x: 6,  y: 7,  w: 3, h: 2, c: '#7f8c8d', hi: '#ecf0f1' },
    { x: 10, y: 9,  w: 2, h: 1, c: '#576574', hi: '#8395a7' },
    { x: 21, y: 5,  w: 3, h: 2, c: '#576574', hi: '#c8d6e5' },
    { x: 25, y: 7,  w: 2, h: 2, c: '#7f8c8d', hi: '#dfe6e9' },
    { x: 13, y: 15, w: 4, h: 2, c: '#636e72', hi: '#dfe6e9' },
    { x: 18, y: 17, w: 2, h: 2, c: '#576574', hi: '#b2bec3' },
    { x: 5,  y: 23, w: 3, h: 2, c: '#576574', hi: '#c8d6e5' },
    { x: 9,  y: 25, w: 2, h: 2, c: '#7f8c8d', hi: '#ecf0f1' },
    { x: 22, y: 22, w: 3, h: 2, c: '#7f8c8d', hi: '#dfe6e9' },
    { x: 26, y: 24, w: 2, h: 1, c: '#576574', hi: '#8395a7' }
  ];

  shards.forEach(sh => {
    const sx = x + p(sh.x);
    const sy = y + p(sh.y);
    const sw = Math.max(2, p(sh.w));
    const shH = Math.max(1, p(sh.h));

    // Тінь
    ctx.fillStyle = '#06080b';
    ctx.fillRect(sx + 1, sy + shH, sw, 1);

    // Основна грань
    ctx.fillStyle = sh.c;
    ctx.fillRect(sx, sy, sw, shH);

    // Світла грань
    ctx.fillStyle = sh.hi;
    ctx.fillRect(sx, sy, 1, 1);
  });

  ctx.restore();
}

/**
 * Перевірка, чи є числовий ID клітинки декоративним покриттям землі (трава / каміння / лід)
 */
export function isGroundDecorTileId(tileId) {
  return tileId === 7 || tileId === 10 || tileId === 11 || tileId === 12 || tileId === 13;
}

/**
 * Рендеринг елемента «Лід» (TILE_TYPES.ICE, id: 10)
 * Напівпрозора кристалічна крижана плитка на рівні землі з діагональними бліками
 */
export function drawIceTile(ctx, x, y, size) {
  ctx.save();
  const s = size / 32;
  const p = (v) => Math.round(v * s);

  // 1. Крижана блакитно-бірюзова основа
  ctx.fillStyle = '#38678f';
  ctx.fillRect(x, y, size, size);

  ctx.fillStyle = '#60a3bc';
  ctx.fillRect(x + p(1), y + p(1), size - p(2), size - p(2));

  // 2. Дзеркальна внутрішня поверхня льоду
  ctx.fillStyle = '#82ccdd';
  ctx.fillRect(x + p(3), y + p(3), size - p(6), size - p(6));

  // 3. Діагональні крижані відблиски (Specular Ice Glints)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.lineWidth = Math.max(1.5, p(2));
  ctx.beginPath();
  ctx.moveTo(x + p(5), y + p(14));
  ctx.lineTo(x + p(14), y + p(5));
  ctx.moveTo(x + p(9), y + p(24));
  ctx.lineTo(x + p(24), y + p(9));
  ctx.moveTo(x + p(18), y + p(27));
  ctx.lineTo(x + p(27), y + p(18));
  ctx.stroke();

  // 4. Кристалічний внутрішній кант
  ctx.strokeStyle = 'rgba(223, 249, 251, 0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);

  ctx.restore();
}

// Словник для швидкого пошуку за числовим ID
export const TILE_BY_ID = {};
Object.values(TILE_TYPES).forEach(tile => {
  TILE_BY_ID[tile.id] = tile;
});

/**
 * Допоміжна функція для автоматичного оновлення словника TILE_BY_ID,
 * якщо у TILE_TYPES динамічно додано нові блоки
 */
export function syncTileRegistry() {
  Object.values(TILE_TYPES).forEach(tile => {
    if (tile && typeof tile.id === 'number') {
      TILE_BY_ID[tile.id] = tile;
    }
  });
  return TILE_BY_ID;
}

export default TILE_TYPES;


