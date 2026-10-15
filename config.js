/**
 * config.js — Конфігураційні об'єкти спорядження та характеристик (Loadout Architecture)
 * 
 * Експортує:
 * - HULL_TYPES: типи корпусів танка (HP, швидкість пересування, швидкість повороту)
 * - TURRET_TYPES: типи гармат та башт (мін/макс шкода, швидкість снаряда, час перезарядки)
 */

export const GAME_MODES = {
  perks: {
    id: 'perks',
    title: '✨ Здібності',
    description: 'Вибір здібностей після кожного програного раунду.',
    defaultEnabled: true,
    isStub: false
  },
  curses: {
    id: 'curses',
    title: '☠️ Прокляття',
    description: 'Кожна здібність при виборі має 15% шанс отримати прокляття.',
    defaultEnabled: true,
    isStub: false
  },
  mapEvents: {
    id: 'mapEvents',
    title: '🌋 Події на карті',
    description: 'Динамічні події на арені (болванка — реалізується згодом).',
    defaultEnabled: false,
    isStub: true
  }
};

export const BASE_CURSE_CHANCE = 0.15;

export const HULL_TYPES = {
  standard: {
    id: 'standard',
    name: 'Середній корпус (100 HP, 20% броня)',
    maxHp: 100,
    armor: 0.20,
    speed: 2,
    rotateSpeed: 0.04,
    baseSizeScale: 1.0,
    seeInLowBush: true,
    ignoreShallowWater: true,
    passiveIcon: '🧭',
    passiveTitle: 'Огляд у низьких кущах + Всюдихід',
    passiveDesc: 'Бачить у низьких кущах, не сповільнюється у мілкій воді',
    description: 'Збалансований середній корпус (20% броні). Пасивка: бачить у низьких кущах і його не сповільнює мілка вода.'
  },
  heavy: {
    id: 'heavy',
    name: 'Важкий корпус (140 HP, 30% броня)',
    maxHp: 140,
    armor: 0.30,
    speed: 1.5,
    rotateSpeed: 0.03,
    baseSizeScale: 1.0,
    coverArmorBonus: 0.10,
    passiveIcon: '🛡️',
    passiveTitle: '+10% Броні в укриттях/воді',
    passiveDesc: '+10% броні у кущах, низьких кущах, мілкій та глибокій воді',
    description: 'Посилена важка броня (30% базово). Пасивка: +10% до броні (40%), поки танк у кущах, низьких кущах або воді.'
  },
  light: {
    id: 'light',
    name: 'Легкий корпус (75 HP, 10% броня)',
    maxHp: 75,
    armor: 0.10,
    speed: 2.5,
    rotateSpeed: 0.05,
    baseSizeScale: 1.0,
    camoInLowBushAndShallowWater: true,
    passiveIcon: '🌿',
    passiveTitle: 'Маскування в низьких кущах і воді',
    passiveDesc: 'Його не видно у низьких кущах та мілкій воді',
    description: 'Швидкісний розвідувальний корпус (10% броні). Пасивка: повністю невидимий у низьких кущах та мілкій воді.'
  },
  phantom: {
    id: 'phantom',
    name: 'Фантомний корпус (1 HP, 95% броня)',
    maxHp: 1,
    armor: 0.95,
    speed: 2,
    rotateSpeed: 0.04,
    baseSizeScale: 1.0,
    unpierceableArmor: true,
    blockHpAndArmorPerks: true,
    hitInvulnSeconds: 0.25,
    hitInvulnFrames: 15,
    passiveIcon: '🛡️',
    passiveTitle: 'Непробивна броня',
    passiveDesc: 'Ворог не може пробити броню навіть зі здібностями',
    comebackPassiveIcon: '⚡',
    comebackPassiveTitle: 'Щит після влучання (0.25с)',
    comebackPassiveDesc: 'Після 50% програних раундів: кожне влучання дає 0.25с невразливості',
    description: 'Експериментальний корпус (1 HP, 95% броні). Броню неможливо пробити; після 50% програних раундів кожне влучання дає 0.25с невразливості.'
  },
  baby: {
    id: 'baby',
    name: 'Малюк (50 HP, 5% броня, -50% розмір)',
    maxHp: 50,
    armor: 0.05,
    speed: 1.0,
    rotateSpeed: 0.02,
    baseSizeScale: 0.50,
    blockSizePerks: true,
    passiveIcon: '🐣',
    passiveTitle: 'Малюк (-50% розмір та старти)',
    passiveDesc: 'Розмір і стартові характеристики менші на 50%, броня 5%. Не отримує здібності на розмір',
    description: 'Мініатюрний корпус: розмір та стартові характеристики менші на 50% від звичайного (50 HP, швидкість 1.0), броня 5%. Не може отримати здібності чи прокляття, які впливають на розмір.'
  },
  wooden: {
    id: 'wooden',
    name: 'Дерев\'яний корпус (60 HP, 0% броня, швидкість 2.5)',
    maxHp: 60,
    armor: 0.0,
    speed: 2.5,
    rotateSpeed: 0.04,
    baseSizeScale: 1.0,
    camoInLowBush: true,
    seeInLowBush: true,
    bushRegenHp: 3,
    bushRegenInterval: 300,
    lostRoundHpBonus: 10,
    passiveIcon: '🪵',
    passiveTitle: 'Сили лісу + Адаптація',
    passiveDesc: 'У кущах реген 3 HP/5с. У низьких кущах невидимий і бачить ворога. +10 HP за кожен програний раунд',
    description: 'Легкий маневровий корпус із міцної деревини (60 HP, 0% броні, швидкість 2.5). Пасивка: у високих та низьких кущах відновлює 3 HP кожні 5с; у низьких кущах непомітний і бачить ворога; за кожен програний раунд максимальне HP зростає на 10.'
  }
};

export const PHANTOM_FORBIDDEN_PERKS = [
  'hp_plus_10',
  'armor_plus_15',
  'regen_3_per_5s',
  'repair_kit_plus_1',
  'beacon_heal',
  'vampiric_shot'
];

export const PHANTOM_FORBIDDEN_CURSES = [
  'curse_hp_minus_10',
  'curse_armor_minus_5'
];

export const BABY_FORBIDDEN_PERKS = [
  'shrink_tank_20'
];

export const BABY_FORBIDDEN_CURSES = [
  'curse_size_plus_10'
];

export const SNIPER_FORBIDDEN_PERKS = [
  'fov_plus_10',
  'spread_minus_05'
];

export const SNIPER_FORBIDDEN_CURSES = [
  'curse_fov_minus_10',
  'curse_spread_plus_05'
];

export const MAX_TANK_SPEED = 5;

export const TURRET_TYPES = {
  standard: {
    id: 'standard',
    name: 'Звичайне дуло (15-20 шкоди, 10 постр./3с, розкид 5°, 90° огляд)',
    minDmg: 15,
    maxDmg: 20,
    bulletSpeed: 6.5,
    reloadTime: 650, // інтервал між пострілами (мс)
    clipSize: 10, // пострілів до перезарядки
    clipReloadTime: 3000, // перезарядка касети: 3 секунди
    fov: 90,
    spreadHalfAngleDeg: 2.5, // ±2.5° в обидві сторони (загальний розкид 5°)
    spreadDeg: 5,
    bulletPierce: 0,
    ricochet: 0,
    description: 'Універсальна бойова гармата: обойма 10 пострілів, перезарядка 3 с, розкид 5° (±2.5°), огляд 90°.'
  },
  heavy: {
    id: 'heavy',
    name: 'Важка гармата (35-50 шкоди, 1 пробиття, 5 постр./2с, розкид 3°, 50° огляд)',
    minDmg: 35,
    maxDmg: 50,
    bulletSpeed: 5.0,
    reloadTime: 1350,
    clipSize: 5, // 5 пострілів до перезарядки
    clipReloadTime: 2000, // перезарядка касети: 2 секунди
    fov: 50,
    spreadHalfAngleDeg: 1.5, // ±1.5° в обидві сторони (загальний розкид 3°)
    spreadDeg: 3,
    bulletPierce: 1, // базово +1 пробиття снаряду
    ricochet: 0,
    description: 'Потужна великокаліберна гармата з +1 пробиттям снарядів: обойма 5 пострілів, перезарядка 2 с, розкид 3° (±1.5°), огляд 50°.'
  },
  rapid: {
    id: 'rapid',
    name: 'Скорострільне дуло (4-9 шкоди, 15 постр./4с, розкид 8°, 110° огляд)',
    minDmg: 4,
    maxDmg: 9,
    bulletSpeed: 7.8,
    reloadTime: 280,
    clipSize: 15, // 15 пострілів до перезарядки
    clipReloadTime: 4000, // перезарядка касети: 4 секунди
    fov: 110,
    spreadHalfAngleDeg: 4.0, // ±4° в обидві сторони (загальний розкид 8°)
    spreadDeg: 8,
    bulletPierce: 0,
    ricochet: 0,
    description: 'Високошвидкісний скоростріл: обойма 15 пострілів, перезарядка 4 с, розкид 8° (±4°), огляд 110°.'
  },
  ricochet: {
    id: 'ricochet',
    name: 'Дуло «Рикошет» (15-20 шкоди, 1 рикошет, 10 постр./3с, розкид 4°, 90° огляд)',
    minDmg: 15,
    maxDmg: 20,
    bulletSpeed: 6.5,
    reloadTime: 650,
    clipSize: 10,
    clipReloadTime: 3000,
    fov: 90,
    spreadHalfAngleDeg: 2.0, // ±2° в обидві сторони (загальний розкид 4°)
    spreadDeg: 4,
    bulletPierce: 0,
    ricochet: 1, // базово +1 рикошет від стін
    description: 'Тактичне дуло з системою відбиття: снаряди мають +1 рикошет від стін, розкид 4° (±2°), обойма 10 пострілів / 3 с, огляд 90°.'
  },
  sniper: {
    id: 'sniper',
    name: 'Снайпер (30-80 шкоди, 5 куль / 4с, 1 постр./3с, без розкиду, 35° огляд)',
    minDmg: 30,
    maxDmg: 80,
    bulletSpeed: 56.0, // подвоєна швидкість кулі (надмиттєвий постріл)
    reloadTime: 3000, // 1 куля в 3 секунди
    clipSize: 5, // обойма 5 куль
    clipReloadTime: 4000, // перезарядка 4 секунди
    fov: 35, // кут огляду 35 градусів
    fixedFov: true, // не може змінювати кут огляду
    spreadHalfAngleDeg: 0, // нема розкиду
    spreadDeg: 0,
    noSpread: true,
    isTracer: true, // трасувальна куля (лишає слід, що зникає)
    stationaryCamoDelayFrames: 120, // через 2с нерухомості корпусу стає невидимий
    bulletPierce: 0,
    ricochet: 0,
    passiveIcon: '🎯',
    passiveTitle: 'Снайперський стелс (2с) + Трасер',
    passiveDesc: 'Без розкиду, фіксований огляд 35°. Через 2с нерухомості корпусу стає невидимим (крутити башту і стріляти можна)',
    description: 'Снайперська гармата: урон 30-80, без розкиду, надшвидка трасувальна куля, обойма 5 куль (перезарядка 4с, 1 постріл в 3с), незмінний огляд 35°. Через 2с нерухомості корпусу стає невидимим.'
  }
};

/**
 * Випадкові та керовані події арени («Динамічні карти»)
 */
export const MAP_EVENTS = {
  darkness: {
    id: 'darkness',
    name: 'Пітьма',
    icon: '🌌',
    bannerText: '🌌 ПОДІЯ: ПІТЬМА',
    desc: 'Нічого не видно крім невеликої зони біля танка та конуса огляду',
    description: 'Нічого не видно крім невеликої зони біля танка та конуса огляду. З ВХ видно тільки ворожого гравця.'
  },
  acid_rain: {
    id: 'acid_rain',
    name: 'Кислотний дощ',
    icon: '🌧️',
    bannerText: '🌧️ ПОДІЯ: КИСЛОТНИЙ ДОЩ',
    desc: 'Кожні 2с знімається 1 HP крізь броню (окрім високих кущів та води)',
    description: 'Кожні 2 секунди знімається 1 HP крізь броню. У високих кущах та у воді шкода не наноситься.'
  },
  artillery_barrage: {
    id: 'artillery_barrage',
    name: 'Артилерійський обстріл',
    icon: '🎯',
    bannerText: '🎯 ПОДІЯ: АРТИЛЕРІЙСЬКИЙ ОБСТРІЛ',
    desc: 'Випадкові зони артобстрілу з потужним залпом через 2.5 секунди',
    description: 'На випадкових клітинках з\'являються мітки артобстрілу з ударом через 2.5 секунди.'
  },
  battle_royale: {
    id: 'battle_royale',
    name: 'Батл рояль',
    icon: '👑',
    bannerText: '👑 ПОДІЯ: БАТЛ РОЯЛЬ',
    desc: 'Зона бойових дій звужується; поза зоною 10 HP шкоди в 2с',
    description: 'Зона бойових дій звужується з часом. Поза зоною отримуєте 10 HP шкоди в 2 секунди крізь броню.'
  },
  snow_storm: {
    id: 'snow_storm',
    name: 'Сніг',
    icon: '❄️',
    bannerText: '❄️ ПОДІЯ: СНІГОВИЙ ШТОРМ',
    desc: 'Вся підлога стає снігом (-10% швидкості), вода стає льодом',
    description: 'Вся підлога стає снігом (-10% швидкості), сліди лишаються до кінця раунду (невидимі сліди не працюють). Вода стає льодом.'
  },
  shuffled_blocks: {
    id: 'shuffled_blocks',
    name: 'Обман зору',
    icon: '🎭',
    bannerText: '🎭 ПОДІЯ: ОБМАН ЗОРУ',
    desc: 'Всі фізичні блоки арени отримують властивості інших блоків',
    description: 'Всі фізичні блоки не ті, якими здаються! Властивості блоків арени переплутані за принципом взаємно однозначної бієкції (декоративні блоки залишаються самими собою).'
  },
  chaos_orbs: {
    id: 'chaos_orbs',
    name: 'Аномальні сфери',
    icon: '🔮',
    bannerText: '🔮 ПОДІЯ: АНОМАЛЬНІ СФЕРИ',
    desc: 'Літаюча куля крутиться, відскакує і стріляє у 4 сторони (+1 куля кожні 20с)',
    description: 'На початку раунду з\'являється куля: крутиться, літає по карті, відскакує від стін і стріляє у 4 сторони. Кожні 20 секунд з\'являється ще одна (максимум 5).'
  },
  reverse_vision: {
    id: 'reverse_vision',
    name: 'Реверсивне спостереження',
    icon: '🌀',
    bannerText: '🌀 ПОДІЯ: РЕВЕРСИВНЕ СПОСТЕРЕЖЕННЯ',
    desc: 'Бачиш ворога тільки тоді, коли не маєш його бачити. ВХ бачить завжди!',
    description: 'Коли ви маєте бачити ворога — ви його не бачите, і коли маєте не бачити — то бачите! Божественна здібність ВХ бачить завжди.'
  }
};

export const PERK_RARITIES = {
  common: {
    id: 'common',
    name: 'ЗВИЧАЙНА',
    label: 'ЗВИЧАЙНА',
    weight: 70, // Найчастіше
    borderColor: '#95a5a6', // Сіра обводка
    glowColor: 'rgba(149, 165, 166, 0.35)',
    badgeBg: '#2f3542',
    textColor: '#bdc3c7'
  },
  rare: {
    id: 'rare',
    name: 'РІДКІСНА',
    label: 'РІДКІСНА',
    weight: 25, // Рідше
    borderColor: '#3498db', // Синя обводка
    glowColor: 'rgba(52, 152, 219, 0.5)',
    badgeBg: '#183a5a',
    textColor: '#54a0ff'
  },
  legendary: {
    id: 'legendary',
    name: 'ЛЕГЕНДАРНА',
    label: 'ЛЕГЕНДАРНА',
    weight: 7, // Оновлено: вага 7 (замість 5)
    borderColor: '#f1c40f', // Золота обводка
    glowColor: 'rgba(241, 196, 15, 0.65)',
    badgeBg: '#5c4308',
    textColor: '#ffeaa7'
  },
  divine: {
    id: 'divine',
    name: 'БОЖЕСТВЕННА',
    label: 'БОЖЕСТВЕННА',
    weight: 2, // Базова вага 2
    borderColor: '#ff007f', // Яскрава малиново-неонова обводка
    glowColor: 'rgba(255, 0, 127, 0.75)',
    badgeBg: '#4a0e2e',
    textColor: '#ff7eb3'
  }
};

/**
 * Модифікатори ваги рідкості за кожен рівень здібності «Удача» (luck_plus_1).
 * Звичайна -10, Рідкісна -5, Легендарна +2, Божественна +1.
 */
export const LUCK_WEIGHT_MODIFIERS = {
  common: -10,
  rare: -5,
  legendary: 2,
  divine: 1
};

/**
 * Обчислення ефективної ваги рідкості з урахуванням накопичених стаків «Удачі»
 */
export function getRarityWeightWithLuck(rarityId, luckStacks = 0) {
  const baseWeight = PERK_RARITIES[rarityId]?.weight ?? 25;
  const mod = LUCK_WEIGHT_MODIFIERS[rarityId] ?? 0;
  const stacks = Math.max(0, Number(luckStacks) || 0);
  return Math.max(1, baseWeight + mod * stacks);
}

export const PERK_TYPES = {
  // === ЗВИЧАЙНІ (COMMON) ===
  hp_plus_10: {
    id: 'hp_plus_10',
    rarity: 'common',
    stackable: true,
    icon: '❤️',
    title: '+10 Макс. Здоров\'я',
    description: '+10 до максимального запасу HP танка.'
  },
  speed_plus_01: {
    id: 'speed_plus_01',
    rarity: 'common',
    stackable: true,
    icon: '⚡',
    title: '+0.1 Швидкості',
    description: '+0.1 до швидкості руху корпусу (максимум до 5.0).'
  },
  fov_plus_10: {
    id: 'fov_plus_10',
    rarity: 'common',
    stackable: true,
    icon: '👁️',
    title: '+10° Огляду',
    description: '+10 градусів до кута огляду вежі.'
  },
  ammo_plus: {
    id: 'ammo_plus',
    rarity: 'common',
    stackable: true,
    icon: '🔋',
    title: '+Снаряди в обойму',
    description: '+1 (важке та снайпер) / +2 (середнє та рикошет) / +3 (швидкісне) снарядів в обойму.'
  },
  reload_minus_02: {
    id: 'reload_minus_02',
    rarity: 'common',
    stackable: true,
    icon: '⏱️',
    title: '-0.2с Перезарядки',
    description: '-0.2 секунди перезарядки касети (мінімум 1 секунда).'
  },
  max_dmg_plus_7: {
    id: 'max_dmg_plus_7',
    rarity: 'common',
    stackable: true,
    icon: '💥',
    title: '+7 Макс. Пошкоджень',
    description: '+7 до максимальних пошкоджень гармати.'
  },
  instant_break_obstacles: {
    id: 'instant_break_obstacles',
    rarity: 'common',
    stackable: false,
    icon: '🔨',
    title: 'Руйнівник перешкод',
    description: 'Кулі одразу знищують перешкоди з 1 влучання (окрім незнищенних сталевих блоків).'
  },
  invisible_bullets: {
    id: 'invisible_bullets',
    rarity: 'common',
    stackable: false,
    icon: '👻',
    title: 'Невидимі кулі',
    description: 'Ваші кулі повністю невидимі для ворога.'
  },
  invisible_tracks: {
    id: 'invisible_tracks',
    rarity: 'common',
    stackable: false,
    icon: '🐾',
    title: 'Невидимі сліди',
    description: 'Ваші сліди від гусениць повністю невидимі для ворога.'
  },
  repair_kit_plus_1: {
    id: 'repair_kit_plus_1',
    rarity: 'common',
    stackable: true,
    isActiveAbility: true,
    activeKey: 'repair',
    icon: '🔧',
    title: '+1 Ремонтний комплект (H)',
    description: 'Гравець отримує +1 ремонтний комплект (відновлює 20% макс. HP на англійську клавішу H, оновлюється щораунду).'
  },
  bullet_speed_plus_01: {
    id: 'bullet_speed_plus_01',
    rarity: 'common',
    stackable: true,
    icon: '🚀',
    title: 'Швидкість кулі +2',
    description: 'Збільшує швидкість польоту ваших снарядів на +2 (можна дублювати).'
  },
  extra_choice_plus_1: {
    id: 'extra_choice_plus_1',
    rarity: 'common',
    stackable: false,
    icon: '🃏',
    title: '+1 Здібність на вибір (1 з 4)',
    description: 'При кожному наступному виборі здібностей вам пропонується 4 варіанти замість 3 (унікальна).'
  },
  reroll_plus_1: {
    id: 'reroll_plus_1',
    rarity: 'common',
    stackable: true,
    maxStacks: 3,
    icon: '🎲',
    title: '+1 Рерол здібностей на вибір',
    description: 'Дає +1 рерол карток при кожному наступному виборі здібностей (оновлюється кожен раунд, максимум 3 дублікати).'
  },
  no_ice_slide: {
    id: 'no_ice_slide',
    rarity: 'common',
    stackable: false,
    icon: '🧊',
    title: 'Льодоступи (Не ковзаєш на льоду)',
    description: 'Ти не ковзаєш на льоду — повне зчеплення гусениць без інерції (унікальна).'
  },
  fire_rate_plus_02: {
    id: 'fire_rate_plus_02',
    rarity: 'common',
    stackable: true,
    icon: '🔥',
    title: '+0.2 Постр./с (Скорострільність)',
    description: 'Зменшує інтервал між пострілами, збільшуючи скорострільність на +0.2 постріли в секунду (можна дублювати).'
  },
  curse_chance_minus_25: {
    id: 'curse_chance_minus_25',
    rarity: 'common',
    stackable: true,
    maxStacks: 2,
    icon: '🧿',
    title: '-5% Шанс прокляття',
    description: 'Зменшує шанс отримати прокляття на картках здібностей на 5% за стак (дублюється максимум 2 рази: 15% → 10% → 5%).'
  },
  blind_bullet_chance: {
    id: 'blind_bullet_chance',
    rarity: 'common',
    stackable: true,
    maxStacks: 10,
    icon: '☀️',
    title: 'Осліплюючий постріл (2%)',
    description: 'З 2% шансом за стак ваша випущена куля в момент пострілу осліплює ворога (білий екран) на 1.5 секунди (дублюється, максимум 10).'
  },

  // === РІДКІСНІ (RARE) ===
  thorns_50: {
    id: 'thorns_50',
    rarity: 'rare',
    stackable: false,
    icon: '🌵',
    title: 'Шипи (50% відбиття)',
    description: 'Коли ти отримуєш шкоду в невеликому радіусі, противник отримує ту саму шкоду в розмірі 50%.'
  },
  bullet_pierce: {
    id: 'bullet_pierce',
    rarity: 'rare',
    stackable: true,
    icon: '☄️',
    title: 'Пробиття куль +1',
    description: 'Ваша куля може пробити +1 ворожу кулю та летіти далі.'
  },
  regen_3_per_5s: {
    id: 'regen_3_per_5s',
    rarity: 'rare',
    stackable: true,
    icon: '💚',
    title: 'Регенерація +1 HP',
    description: 'Відновлює +1 здоров\'я кожні 5 секунд (можна дублювати).'
  },
  proximity_burn: {
    id: 'proximity_burn',
    rarity: 'rare',
    stackable: true,
    icon: '🔥',
    title: 'Аура ближнього бою',
    description: 'Впритул (у невеликому радіусі) знімає 10 HP ворогу кожні 2 секунди (таймер оновлюється, коли ворог не в радіусі).'
  },
  ignore_armor: {
    id: 'ignore_armor',
    rarity: 'rare',
    stackable: false,
    icon: '🗡️',
    title: 'Бронебійні снаряди',
    description: 'Ваші постріли повністю ігнорують броню супротивника.'
  },
  dmg_plus_5: {
    id: 'dmg_plus_5',
    rarity: 'rare',
    stackable: true,
    icon: '⚔️',
    title: '+5 Мін. та Макс. Пошкоджень',
    description: '+5 до максимальних та мінімальних пошкоджень гармати.'
  },
  ignore_shallow_water: {
    id: 'ignore_shallow_water',
    rarity: 'rare',
    stackable: false,
    icon: '🛞',
    title: 'Всюдихід (Мілка вода)',
    description: 'Мілка вода більше не сповільнює ваш танк.'
  },
  ricochet_plus_1: {
    id: 'ricochet_plus_1',
    rarity: 'rare',
    stackable: true,
    icon: '🪃',
    title: 'Рикошет +1',
    description: 'Кулі отримують +1 рикошет від стін (при цьому стінам наноситься шкода).'
  },
  linger_vision_1s: {
    id: 'linger_vision_1s',
    rarity: 'rare',
    stackable: false,
    icon: '📡',
    title: 'Слід виявлення (1 с)',
    description: 'Коли ворог зникає з прямої видимості, ти ще можеш його бачити 1 секунду. Також дозволяє бачити ворожі міни у своєму полі зору.'
  },
  luck_plus_1: {
    id: 'luck_plus_1',
    rarity: 'rare',
    stackable: true,
    icon: '🍀',
    title: 'Удача',
    description: 'Знижує шанс звичайних (-10 ваги) та рідкісних (-5 ваги) і збільшує шанс легендарних (+2 ваги) та божественних (+1 ваги) здібностей.'
  },
  slowing_tracks: {
    id: 'slowing_tracks',
    rarity: 'rare',
    stackable: true,
    icon: '🕸️',
    title: 'Сповільнюючі сліди',
    description: 'Якщо ворог наїжджає на ваші сліди, він сповільнюється на 30%. Кожне взяття додає +0.25 с часу існування слідів (дублюється лише час).'
  },
  time_scaling_max_dmg: {
    id: 'time_scaling_max_dmg',
    rarity: 'rare',
    stackable: false,
    icon: '⏳',
    title: '+1 Макс. урону кожні 10с',
    description: 'Кожні 10 секунд раунду додає +1 до максимального урону гармати (унікальна).'
  },
  shrink_tank_20: {
    id: 'shrink_tank_20',
    rarity: 'rare',
    stackable: false,
    icon: '🐜',
    title: 'Міні-танк (-20% розміру)',
    description: 'Ваш танк зменшується на 20% (унікальна).'
  },
  beacon_heal: {
    id: 'beacon_heal',
    rarity: 'rare',
    stackable: true,
    isActiveAbility: true,
    isSpaceActive: true,
    activeKey: 'beacon',
    icon: '🚨',
    title: 'Маяк регенерації (+2 HP/с, 7с)',
    description: 'Активка на ПРОБІЛ: ваш танк підсвічується ворогу на 7 секунд, але ви відновлюєте +2 HP кожну секунду (дублювання додає +2 HP/с). Перезарядка 20 с після дії таймера.'
  },
  turbo_boost: {
    id: 'turbo_boost',
    rarity: 'rare',
    stackable: false,
    isActiveAbility: true,
    isSpaceActive: true,
    activeKey: 'turbo',
    durationFrames: 240,
    cooldownFrames: 1500,
    icon: '🚀',
    title: 'Турбо (+50% швидкості на 4с)',
    description: 'Активка на ПРОБІЛ: ваша швидкість збільшується на 50% на 4 секунди. Перезарядка 25 с після закінчення дії таймера (унікальна).'
  },
  spread_minus_05: {
    id: 'spread_minus_05',
    rarity: 'rare',
    stackable: true,
    icon: '📐',
    title: '-0.5° Розкиду кулі',
    description: 'Зменшується розкид кулі на -0.5 градусів в обидві сторони від лінії пострілу (дублюється).'
  },
  vampiric_shot: {
    id: 'vampiric_shot',
    rarity: 'rare',
    stackable: false,
    icon: '🩸',
    title: 'Вампірський постріл (10%)',
    description: 'Кожен постріл з 10% шансом при попаданні полікує вас на 30% від нанесеної шкоди (шанс розраховується при пострілі) (унікальна).'
  },

  // === ЛЕГЕНДАРНІ (LEGENDARY) ===
  mines_plus_3: {
    id: 'mines_plus_3',
    rarity: 'legendary',
    stackable: true,
    isActiveAbility: true,
    isSpaceActive: true,
    activeKey: 'mines',
    icon: '💣',
    title: 'Міни (+3 щораунду)',
    description: 'На ПРОБІЛ залишає міну (40-60 шкоди, повністю невидима для ворога, окрім ВХ або Сліду виявлення в полі зору; оновлюються кожен раунд). Перемикання активок: Q / E.'
  },
  armor_plus_15: {
    id: 'armor_plus_15',
    rarity: 'legendary',
    stackable: false,
    icon: '🛡️',
    title: '+15% Броні',
    description: 'Додає +15% до шансу повністю заблокувати шкоду бронею корпусу.'
  },
  water_camouflage: {
    id: 'water_camouflage',
    rarity: 'legendary',
    stackable: false,
    icon: '🌊',
    title: 'Водне маскування',
    description: 'Ти отримуєш повне маскування (як у кущах), перебуваючи у мілкій або глибокій воді.'
  },
  smoke_screen: {
    id: 'smoke_screen',
    rarity: 'legendary',
    stackable: false,
    isActiveAbility: true,
    isSpaceActive: true,
    activeKey: 'smoke',
    icon: '💨',
    title: 'Дим (Активка 3×3)',
    description: 'На ПРОБІЛ випускає дим у зоні 3×3 на 5 секунд. Ворог крізь нього не бачить, а ти бачиш. Перезарядка 30 секунд після закінчення дії диму.'
  },
  artillery_strike: {
    id: 'artillery_strike',
    rarity: 'legendary',
    stackable: false,
    isActiveAbility: true,
    isSpaceActive: true,
    activeKey: 'artillery',
    icon: '🎯',
    title: 'Артилерія (Зона 3×3)',
    description: 'На ПРОБІЛ виділяє блок під мишкою, наступний ЛКМ викликає залп 3×3, що б\'є через 1 секунду (у центр 60 урону та руйнує навіть бетон, навколо 25 урону та руйнує всі інші блоки). Перезарядка 35 с.'
  },
  spot_enemy_10s: {
    id: 'spot_enemy_10s',
    rarity: 'legendary',
    stackable: false,
    isActiveAbility: true,
    isSpaceActive: true,
    activeKey: 'radar',
    icon: '🛰️',
    title: 'Підсвічування ворога (10с)',
    description: 'Активка на ПРОБІЛ: підсвічує ворога на 10 секунд скрізь на карті. Перезарядка 40 с після закінчення дії таймера (унікальна).'
  },
  guided_bullet: {
    id: 'guided_bullet',
    rarity: 'legendary',
    stackable: false,
    isActiveAbility: true,
    isSpaceActive: true,
    activeKey: 'guided',
    icon: '☄️',
    title: 'Керування кулею (×2 урон)',
    description: 'Активка на ПРОБІЛ: заряджає постріл, після чого наступна куля (ЛКМ) летить у бік курсора з подвійним уроном. Перезарядка 45 с починається після знищення кулі (унікальна).'
  },
  magnetic_bullets: {
    id: 'magnetic_bullets',
    rarity: 'legendary',
    stackable: false,
    icon: '🧲',
    title: 'Магнітні кулі',
    description: 'Ваші кулі наводяться (не повністю наводяться, а лише плавно відхиляються в сторону противника) на ворога, який знаходиться недалеко від кулі (унікальна).'
  },

  // === БОЖЕСТВЕННІ (DIVINE) ===
  walk_deep_water: {
    id: 'walk_deep_water',
    rarity: 'divine',
    stackable: false,
    icon: '🔱',
    title: 'Ходіння по глибокій воді',
    description: 'Можна вільно переміщатись по глибокій воді, як по суші.'
  },
  rebirth_plus_1: {
    id: 'rebirth_plus_1',
    rarity: 'divine',
    stackable: false,
    icon: '🐦‍🔥',
    title: '+1 Переродження',
    description: '+1 переродження щораунду: при знищенні танк перероджується з повним HP на місці спавну, і раунд не скінчується (унікальна).'
  },
  wallhack_vision: {
    id: 'wallhack_vision',
    rarity: 'divine',
    stackable: false,
    icon: '🧿',
    title: 'ВХ (Бачити ворога скрізь)',
    description: 'Повне всебачення: ти бачиш ворога, його кулі, міни та сліди скрізь на карті незважаючи на стіни чи укриття.'
  },
  double_pick_perk: {
    id: 'double_pick_perk',
    rarity: 'divine',
    stackable: false,
    icon: '👑',
    title: 'Подвійний вибір (2 з 3 здібностей)',
    description: 'Після програшу раунду ти можеш обирати одразу 2 здібності замість 1 із запропонованих карток.'
  }
};

export const CURSE_TYPES = {
  curse_size_plus_10: {
    id: 'curse_size_plus_10',
    stackable: false,
    icon: '☠️',
    title: 'Танк +10% розміру',
    description: 'Ваш танк збільшується на 10% (унікальна).'
  },
  curse_speed_minus_01: {
    id: 'curse_speed_minus_01',
    stackable: true,
    icon: '🐌',
    title: '-0.2 Швидкості',
    description: 'Ваша швидкість зменшується на -0.2 (дублюється).'
  },
  curse_fov_minus_10: {
    id: 'curse_fov_minus_10',
    stackable: true,
    icon: '🕶️',
    title: '-10° Кута огляду',
    description: 'Ваш кут огляду зменшується на -10° (дублюється).'
  },
  curse_hp_minus_10: {
    id: 'curse_hp_minus_10',
    stackable: true,
    icon: '💔',
    title: '-10 Здоров\'я',
    description: 'Ваше максимальне здоров\'я зменшується на -10 HP (дублюється).'
  },
  curse_fire_rate_minus_015: {
    id: 'curse_fire_rate_minus_015',
    stackable: true,
    icon: '⏳',
    title: '-0.15 Постр./с',
    description: 'Ваша скорострільність зменшується на -0.15 пострілів/с (дублюється).'
  },
  curse_armor_minus_5: {
    id: 'curse_armor_minus_5',
    stackable: true,
    icon: '🔓',
    title: '-5% Броні',
    description: 'Ваша броня зменшується на -5% (дублюється).'
  },
  curse_spread_plus_05: {
    id: 'curse_spread_plus_05',
    stackable: true,
    icon: '💢',
    title: '+0.5° Розкиду кулі',
    description: 'Збільшується розкид кулі на +0.5 градусів в обидві сторони від лінії пострілу (дублюється).'
  }
};

export const WIN_SCORE = 5;
export const MIN_WIN_SCORE = 3;
export const MAX_WIN_SCORE = 15;

export default {
  WIN_SCORE,
  MIN_WIN_SCORE,
  MAX_WIN_SCORE,
  MAX_TANK_SPEED,
  GAME_MODES,
  BASE_CURSE_CHANCE,
  HULL_TYPES,
  TURRET_TYPES,
  PERK_RARITIES,
  LUCK_WEIGHT_MODIFIERS,
  getRarityWeightWithLuck,
  PERK_TYPES,
  CURSE_TYPES,
  PHANTOM_FORBIDDEN_PERKS,
  PHANTOM_FORBIDDEN_CURSES,
  BABY_FORBIDDEN_PERKS,
  BABY_FORBIDDEN_CURSES,
  SNIPER_FORBIDDEN_PERKS,
  SNIPER_FORBIDDEN_CURSES
};



