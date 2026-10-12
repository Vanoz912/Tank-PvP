/**
 * config.js — Конфігураційні об'єкти спорядження та характеристик (Loadout Architecture)
 * 
 * Експортує:
 * - HULL_TYPES: типи корпусів танка (HP, швидкість пересування, швидкість повороту)
 * - TURRET_TYPES: типи гармат та башт (мін/макс шкода, швидкість снаряда, час перезарядки)
 */

export const HULL_TYPES = {
  standard: {
    id: 'standard',
    name: 'Середній корпус (100 HP, 20% броня)',
    maxHp: 100,
    armor: 0.20,
    speed: 2,
    rotateSpeed: 0.04,
    description: 'Збалансований середній корпус: оптимальна швидкість та 20% шанс заблокувати всю шкоду.'
  },
  heavy: {
    id: 'heavy',
    name: 'Важкий корпус (140 HP, 30% броня)',
    maxHp: 140,
    armor: 0.30,
    speed: 1.5,
    rotateSpeed: 0.03,
    description: 'Посилена важка броня (30% шанс заблокувати всю шкоду) ціною зниженої маневреності.'
  },
  light: {
    id: 'light',
    name: 'Легкий корпус (75 HP, 10% броня)',
    maxHp: 75,
    armor: 0.10,
    speed: 2.5,
    rotateSpeed: 0.05,
    description: 'Полегшений швидкісний корпус (10% шанс заблокувати всю шкоду) для стрімких флангових атак.'
  },
  phantom: {
    id: 'phantom',
    name: 'Фантомний корпус (1 HP, 95% броня)',
    maxHp: 1,
    armor: 0.95,
    speed: 2,
    rotateSpeed: 0.04,
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
  }
};

export const PHANTOM_FORBIDDEN_PERKS = [
  'hp_plus_10',
  'armor_plus_15',
  'regen_3_per_5s',
  'repair_kit_plus_1'
];

export const MAX_TANK_SPEED = 5;

export const TURRET_TYPES = {
  standard: {
    id: 'standard',
    name: 'Звичайне дуло (15-20 шкоди, 10 пострілів / 3с, 90° огляд)',
    minDmg: 15,
    maxDmg: 20,
    bulletSpeed: 6.5,
    reloadTime: 650, // інтервал між пострілами (мс)
    clipSize: 10, // пострілів до перезарядки
    clipReloadTime: 3000, // перезарядка касети: 3 секунди
    fov: 90,
    bulletPierce: 0,
    ricochet: 0,
    description: 'Універсальна бойова гармата: обойма 10 пострілів, перезарядка 3 с (огляд: 90°).'
  },
  heavy: {
    id: 'heavy',
    name: 'Важка гармата (35-50 шкоди, 1 пробиття, 5 пострілів / 2с, 50° огляд)',
    minDmg: 35,
    maxDmg: 50,
    bulletSpeed: 5.0,
    reloadTime: 1350,
    clipSize: 5, // 5 пострілів до перезарядки
    clipReloadTime: 2000, // перезарядка касети: 2 секунди
    fov: 50,
    bulletPierce: 1, // базово +1 пробиття снаряду
    ricochet: 0,
    description: 'Потужна великокаліберна гармата з +1 пробиттям снарядів: обойма 5 пострілів, перезарядка 2 с (огляд: 50°).'
  },
  rapid: {
    id: 'rapid',
    name: 'Скорострільне дуло (4-9 шкоди, 15 пострілів / 4с, 110° огляд)',
    minDmg: 4,
    maxDmg: 9,
    bulletSpeed: 7.8,
    reloadTime: 280,
    clipSize: 15, // 15 пострілів до перезарядки
    clipReloadTime: 4000, // перезарядка касети: 4 секунди
    fov: 110,
    bulletPierce: 0,
    ricochet: 0,
    description: 'Високошвидкісний скоростріл: обойма 15 пострілів, перезарядка 4 с (огляд: 110°).'
  },
  ricochet: {
    id: 'ricochet',
    name: 'Дуло «Рикошет» (15-20 шкоди, 1 рикошет, 10 пострілів / 3с, 90° огляд)',
    minDmg: 15,
    maxDmg: 20,
    bulletSpeed: 6.5,
    reloadTime: 650,
    clipSize: 10,
    clipReloadTime: 3000,
    fov: 90,
    bulletPierce: 0,
    ricochet: 1, // базово +1 рикошет від стін
    description: 'Тактичне дуло з системою відбиття: снаряди мають +1 рикошет від стін і завдають їм шкоди (обойма 10 пострілів / 3 с, огляд: 90°).'
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
    weight: 5, // Майже не попадається
    borderColor: '#f1c40f', // Золота обводка
    glowColor: 'rgba(241, 196, 15, 0.65)',
    badgeBg: '#5c4308',
    textColor: '#ffeaa7'
  },
  divine: {
    id: 'divine',
    name: 'БОЖЕСТВЕННА',
    label: 'БОЖЕСТВЕННА',
    weight: 2, // Ультрарідкісна (Божественна)
    borderColor: '#ff007f', // Яскрава малиново-неонова обводка
    glowColor: 'rgba(255, 0, 127, 0.75)',
    badgeBg: '#4a0e2e',
    textColor: '#ff7eb3'
  }
};

/**
 * Модифікатори ваги рідкості за кожен рівень здібності «Удача» (luck_plus_1).
 * Затверджені значення: Звичайні -5, Рідкісні -1.5, Легендарні +4, Божественні +1.5.
 */
export const LUCK_WEIGHT_MODIFIERS = {
  common: -5,
  rare: -1.5,
  legendary: 4,
  divine: 1.5
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
    description: '+1 (важке) / +2 (середнє та рикошет) / +3 (швидкісне) снарядів в обойму.'
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
    description: 'Знижує шанс звичайних (-5 ваги) та рідкісних (-1.5 ваги) і збільшує шанс легендарних (+4 ваги) та божественних (+1.5 ваги) здібностей.'
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
    description: 'На ПРОБІЛ випускає дим у зоні 3×3 на 5 секунд. Ворог крізь нього не бачить, а ти бачиш. Перезарядка 30 секунд (та на початку раунду). Перемикання активок: Q / E.'
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
    description: 'На ПРОБІЛ виділяє блок під мишкою, наступний ЛКМ завдає одноразового удару 3×3 (у центр 60 урону та руйнує навіть бетон, навколо 25 урону та руйнує всі інші блоки). Перезарядка 35 с.'
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

export const WIN_SCORE = 5;
export const MIN_WIN_SCORE = 3;
export const MAX_WIN_SCORE = 15;

export default {
  WIN_SCORE,
  MIN_WIN_SCORE,
  MAX_WIN_SCORE,
  MAX_TANK_SPEED,
  HULL_TYPES,
  TURRET_TYPES,
  PERK_RARITIES,
  LUCK_WEIGHT_MODIFIERS,
  getRarityWeightWithLuck,
  PERK_TYPES
};



