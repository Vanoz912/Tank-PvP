/**
 * entities.js — Класи ігрових сутностей (Tank, Bullet, Explosion, Ефекти)
 * 
 * Модульна архітектура:
 * - Роздільне керування корпусом (bodyAngle) та вежею (turretAngle).
 * - Налаштування спорядження (HULL_TYPES та TURRET_TYPES).
 * - Система частинок (сліди гусениць, спалах, дим, уламки цегли).
 */

import {
  WIN_SCORE,
  MAX_TANK_SPEED,
  HULL_TYPES,
  PHANTOM_FORBIDDEN_PERKS,
  TURRET_TYPES,
  PERK_RARITIES,
  LUCK_WEIGHT_MODIFIERS,
  getRarityWeightWithLuck,
  PERK_TYPES
} from './config.js?v=20261011_v17';
import {
  drawSingleTread,
  drawTankModel,
  drawTankReloadIndicator
} from './tankRenderer.js?v=20261011_v17';
import {
  Explosion,
  TreadMark,
  SmokeCloud,
  DebrisParticle,
  MuzzleFlash,
  SmokeParticle
} from './vfx.js?v=20261011_v17';

export {
  WIN_SCORE,
  MAX_TANK_SPEED,
  HULL_TYPES,
  PHANTOM_FORBIDDEN_PERKS,
  TURRET_TYPES,
  PERK_RARITIES,
  LUCK_WEIGHT_MODIFIERS,
  getRarityWeightWithLuck,
  PERK_TYPES,
  Explosion,
  TreadMark,
  SmokeCloud,
  DebrisParticle,
  MuzzleFlash,
  SmokeParticle
};

export const DIRS = [
  { dx: 0, dy: -1 }, // 0: Вгору
  { dx: 1, dy: 0 },  // 1: Вправо
  { dx: 0, dy: 1 },  // 2: Вниз
  { dx: -1, dy: 0 }  // 3: Вліво
];

/**
 * Клас бойового танка з незалежним обертанням корпусу та вежі, системою касет та післяраундових бонусів (Perks)
 */
export class Tank {
  /**
   * @param {number} id - 1 (P1, жовтий) або 2 (P2, зелений)
   * @param {number} x - координата X
   * @param {number} y - координата Y
   * @param {number} initialAngle - початковий кут у радіанах
   * @param {Object} options - loadout: { hull, turret, size }
   */
  constructor(id, x, y, initialAngle = 0, options = {}) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.size = options.size || 26;

    // Кути в радіанах (роздільне керування)
    this.bodyAngle = initialAngle;
    this.turretAngle = initialAngle;

    // Масив отриманих за матч післяраундових бонусів (скидається при Реванші)
    this.acquiredPerks = [];
    this.regenTimer = 0;
    this.proximityTimer = 0;
    this.lingerTimer = 0;
    this.smokeCooldownTimer = 0;
    this.artilleryCooldownTimer = 0;
    this.targetingMode = null;
    this.hitInvulnTimer = 0;
    this.roundTimeDmgBonus = 0;
    this.lastMineTime = 0;
    this.lastRepairTime = 0;
    this.selectedActive = 'mines';

    // Конфігурація корпусу та вежі
    this.hullType = options.hull || 'standard';
    this.turretType = options.turret || 'standard';

    this.applyLoadout(this.hullType, this.turretType);

    this.spawnX = x;
    this.spawnY = y;
    this.spawnAngle = initialAngle;

    this.isDead = false;
    this.respawnTimer = 0;
    this.spawnShieldTimer = 150;
    this.lastShootTime = 0;
    this.ammo = this.clipSize;
    this.minesLeft = this.maxMines || 0;
    this.repairKitsLeft = this.maxRepairKits || 0;
    this.rebirthsLeft = this.maxRebirths || 0;
    this.rerollsLeft = this.maxRerolls || 0;
    this.isReloadingClip = false;
    this.clipReloadStartTime = 0;
    this.reloadProgress = 1;
    this.animFrame = 0;
    this.isMoving = false;
    this.trackTimer = 0;

    // Візуальні кольори
    this.isP1 = id === 1;
    this.baseColor = this.isP1 ? '#f39c12' : '#2ecc71';
    this.lightColor = this.isP1 ? '#f1c40f' : '#27ae60';
    this.darkColor = this.isP1 ? '#b7791f' : '#1e824c';
  }

  /**
   * Застосування характеристик обраного спорядження з урахуванням усіх накопичених бонусів (acquiredPerks)
   */
  applyLoadout(hullId, turretId) {
    const hullConfig = HULL_TYPES[hullId] || HULL_TYPES.standard;
    const turretConfig = TURRET_TYPES[turretId] || TURRET_TYPES.standard;

    const prevHull = this.hullType;
    const prevTurret = this.turretType;
    const prevMaxHp = this.maxHp;
    const hadHp = typeof this.hp === 'number';
    const hadAmmo = typeof this.ammo === 'number';

    this.hullType = hullConfig.id;
    this.turretType = turretConfig.id;

    if (!Array.isArray(this.acquiredPerks)) {
      this.acquiredPerks = [];
    }

    // Якщо обрано корпус з 1 HP та 99% броні (phantom), прибираємо заборонені для нього перки на HP/Броню/Реген/Ремкомплект
    if (hullConfig.blockHpAndArmorPerks && Array.isArray(this.acquiredPerks) && this.acquiredPerks.length > 0) {
      this.acquiredPerks = this.acquiredPerks.filter(id => !PHANTOM_FORBIDDEN_PERKS.includes(id));
    }

    // Підрахунок бонусів від обраних здібностей (Perks)
    let bonusMaxHp = 0;
    let bonusSpeed = 0;
    let bonusFov = 0;
    let bonusClipSize = 0;
    let bonusReloadReduction = 0;
    let bonusFireRate = 0;
    let bonusMinDmg = 0;
    let bonusMaxDmg = 0;
    let bonusBulletSpeed = 0;
    let bonusBulletPierce = 0;
    let bonusRicochet = 0;
    let bonusArmor = 0;
    let regenAmount = 0;
    let proximityDmg = 0;
    let ignoreArmor = false;
    let instantBreakObstacles = false;
    let invisibleBullets = false;
    let invisibleTracks = false;
    let hasThorns = false;
    let maxRepairKits = 0;
    let ignoreShallowWater = false;
    let hasLingerVision = false;
    let maxMines = 0;
    let hasWaterCamo = false;
    let canWalkDeepWater = false;
    let maxRebirths = 0;
    let hasWallhack = false;
    let extraChoiceCount = 0;
    let maxRerolls = 0;
    let noIceSlide = false;
    let luckStacks = 0;
    let hasSlowingTracks = false;
    let trackLifeBonusFrames = 0;
    let hasSmokeScreen = false;
    let hasTimeScalingMaxDmg = false;
    let hasArtillery = false;
    let picksPerRound = 1;
    const customPerkHooks = [];

    const ammoPerStack = turretConfig.id === 'heavy' ? 1 : (turretConfig.id === 'rapid' ? 3 : 2);

    for (const perkId of this.acquiredPerks) {
      if (perkId === 'hp_plus_10') bonusMaxHp += 10;
      else if (perkId === 'speed_plus_01') bonusSpeed = +(bonusSpeed + 0.1).toFixed(2);
      else if (perkId === 'fov_plus_10') bonusFov += 10;
      else if (perkId === 'ammo_plus') bonusClipSize += ammoPerStack;
      else if (perkId === 'reload_minus_02') bonusReloadReduction += 200;
      else if (perkId === 'fire_rate_plus_02') bonusFireRate = +(bonusFireRate + 0.2).toFixed(2);
      else if (perkId === 'max_dmg_plus_7') bonusMaxDmg += 7;
      else if (perkId === 'instant_break_obstacles') instantBreakObstacles = true;
      else if (perkId === 'invisible_bullets') invisibleBullets = true;
      else if (perkId === 'invisible_tracks') invisibleTracks = true;
      else if (perkId === 'thorns_50') hasThorns = true;
      else if (perkId === 'repair_kit_plus_1') maxRepairKits += 1;
      else if (perkId === 'bullet_speed_plus_01') bonusBulletSpeed = +(bonusBulletSpeed + 2).toFixed(2);
      else if (perkId === 'extra_choice_plus_1') extraChoiceCount += 1;
      else if (perkId === 'reroll_plus_1') maxRerolls = Math.min(3, maxRerolls + 1);
      else if (perkId === 'no_ice_slide') noIceSlide = true;
      else if (perkId === 'bullet_pierce') bonusBulletPierce += 1;
      else if (perkId === 'regen_3_per_5s') regenAmount += 1;
      else if (perkId === 'proximity_burn') proximityDmg += 10;
      else if (perkId === 'ignore_armor') ignoreArmor = true;
      else if (perkId === 'dmg_plus_5') { bonusMinDmg += 5; bonusMaxDmg += 5; }
      else if (perkId === 'ignore_shallow_water') ignoreShallowWater = true;
      else if (perkId === 'ricochet_plus_1') bonusRicochet += 1;
      else if (perkId === 'linger_vision_1s') hasLingerVision = true;
      else if (perkId === 'luck_plus_1') luckStacks += 1;
      else if (perkId === 'slowing_tracks') { hasSlowingTracks = true; trackLifeBonusFrames += 15; }
      else if (perkId === 'time_scaling_max_dmg') hasTimeScalingMaxDmg = true;
      else if (perkId === 'mines_plus_3') maxMines += 3;
      else if (perkId === 'armor_plus_15') bonusArmor = +(bonusArmor + 0.15).toFixed(2);
      else if (perkId === 'water_camouflage') hasWaterCamo = true;
      else if (perkId === 'smoke_screen') hasSmokeScreen = true;
      else if (perkId === 'artillery_strike') hasArtillery = true;
      else if (perkId === 'walk_deep_water') canWalkDeepWater = true;
      else if (perkId === 'rebirth_plus_1') maxRebirths += 1;
      else if (perkId === 'wallhack_vision') hasWallhack = true;
      else if (perkId === 'double_pick_perk') picksPerRound = 2;

      const perkDef = PERK_TYPES[perkId];
      if (perkDef && perkDef.effects) {
        if (typeof perkDef.effects.maxHp === 'number') bonusMaxHp += perkDef.effects.maxHp;
        if (typeof perkDef.effects.speed === 'number') bonusSpeed = +(bonusSpeed + perkDef.effects.speed).toFixed(2);
        if (typeof perkDef.effects.fov === 'number') bonusFov += perkDef.effects.fov;
        if (typeof perkDef.effects.clipSize === 'number') bonusClipSize += perkDef.effects.clipSize;
        if (typeof perkDef.effects.reloadReduction === 'number') bonusReloadReduction += perkDef.effects.reloadReduction;
        if (typeof perkDef.effects.fireRateBonus === 'number') bonusFireRate = +(bonusFireRate + perkDef.effects.fireRateBonus).toFixed(2);
        if (typeof perkDef.effects.minDmg === 'number') bonusMinDmg += perkDef.effects.minDmg;
        if (typeof perkDef.effects.maxDmg === 'number') bonusMaxDmg += perkDef.effects.maxDmg;
        if (typeof perkDef.effects.bulletSpeed === 'number') bonusBulletSpeed = +(bonusBulletSpeed + perkDef.effects.bulletSpeed).toFixed(2);
        if (typeof perkDef.effects.bulletPierce === 'number') bonusBulletPierce += perkDef.effects.bulletPierce;
        if (typeof perkDef.effects.ricochet === 'number') bonusRicochet += perkDef.effects.ricochet;
        if (typeof perkDef.effects.armor === 'number') bonusArmor = +(bonusArmor + perkDef.effects.armor).toFixed(2);
        if (typeof perkDef.effects.regenAmount === 'number') regenAmount += perkDef.effects.regenAmount;
        else if (perkDef.effects.hasRegen) regenAmount += 1;
        if (typeof perkDef.effects.proximityDmg === 'number') proximityDmg += perkDef.effects.proximityDmg;
        if (perkDef.effects.ignoreArmor) ignoreArmor = true;
        if (perkDef.effects.instantBreakObstacles) instantBreakObstacles = true;
        if (perkDef.effects.invisibleBullets) invisibleBullets = true;
        if (perkDef.effects.invisibleTracks) invisibleTracks = true;
        if (perkDef.effects.hasThorns) hasThorns = true;
        if (typeof perkDef.effects.maxRepairKits === 'number') maxRepairKits += perkDef.effects.maxRepairKits;
        if (perkDef.effects.ignoreShallowWater) ignoreShallowWater = true;
        if (perkDef.effects.hasLingerVision) hasLingerVision = true;
        if (typeof perkDef.effects.maxMines === 'number') maxMines += perkDef.effects.maxMines;
        if (perkDef.effects.hasWaterCamo) hasWaterCamo = true;
        if (perkDef.effects.canWalkDeepWater) canWalkDeepWater = true;
        if (typeof perkDef.effects.maxRebirths === 'number') maxRebirths += perkDef.effects.maxRebirths;
        if (perkDef.effects.hasWallhack) hasWallhack = true;
        if (typeof perkDef.effects.extraChoiceCount === 'number') extraChoiceCount += perkDef.effects.extraChoiceCount;
        if (typeof perkDef.effects.maxRerolls === 'number') maxRerolls = Math.min(3, maxRerolls + perkDef.effects.maxRerolls);
        if (perkDef.effects.noIceSlide) noIceSlide = true;
        if (typeof perkDef.effects.luckStacks === 'number') luckStacks += perkDef.effects.luckStacks;
        if (perkDef.effects.hasSlowingTracks) hasSlowingTracks = true;
        if (typeof perkDef.effects.trackLifeBonusFrames === 'number') trackLifeBonusFrames += perkDef.effects.trackLifeBonusFrames;
        if (perkDef.effects.hasSmokeScreen) hasSmokeScreen = true;
        if (perkDef.effects.hasTimeScalingMaxDmg) hasTimeScalingMaxDmg = true;
        if (perkDef.effects.hasArtillery) hasArtillery = true;
        if (typeof perkDef.effects.picksPerRound === 'number') picksPerRound = Math.max(picksPerRound, perkDef.effects.picksPerRound);
      }
      if (perkDef && typeof perkDef.apply === 'function') {
        customPerkHooks.push(perkDef.apply);
      }
    }

    // Характеристики корпусу + бонуси (максимальна можлива швидкість = MAX_TANK_SPEED = 5)
    this.unpierceableArmor = Boolean(hullConfig.unpierceableArmor);
    this.blockHpAndArmorPerks = Boolean(hullConfig.blockHpAndArmorPerks);

    if (hullConfig.blockHpAndArmorPerks) {
      this.maxHp = hullConfig.maxHp; // Строго 1 HP
      this.hp = (!hadHp || prevHull !== hullConfig.id || (typeof prevMaxHp === 'number' && this.hp >= prevMaxHp))
        ? this.maxHp
        : Math.min(this.hp, this.maxHp);
      this.armor = typeof hullConfig.armor === 'number' ? hullConfig.armor : 0.99; // 99% броні
    } else {
      this.maxHp = hullConfig.maxHp + bonusMaxHp;
      if (!hadHp || prevHull !== hullConfig.id || (typeof prevMaxHp === 'number' && this.hp >= prevMaxHp)) {
        this.hp = this.maxHp;
      } else {
        this.hp = Math.min(this.hp, this.maxHp);
      }
      const defaultArmorByHull = hullConfig.id === 'heavy' ? 0.30 : (hullConfig.id === 'light' ? 0.10 : 0.20);
      const baseArmor = typeof hullConfig.armor === 'number' ? hullConfig.armor : defaultArmorByHull;
      this.armor = Math.min(0.90, +(baseArmor + bonusArmor).toFixed(2));
    }
    this.speed = Math.min(MAX_TANK_SPEED, +(hullConfig.speed + bonusSpeed).toFixed(2));
    this.rotateSpeed = hullConfig.rotateSpeed;

    // Характеристики дула та касети + бонуси
    this.minDmg = turretConfig.minDmg + bonusMinDmg;
    this.baseMaxDmg = turretConfig.maxDmg + bonusMaxDmg;
    this.hasTimeScalingMaxDmg = hasTimeScalingMaxDmg;
    if (!hasTimeScalingMaxDmg) {
      this.roundTimeDmgBonus = 0;
    }
    this.maxDmg = this.baseMaxDmg + (hasTimeScalingMaxDmg ? (this.roundTimeDmgBonus || 0) : 0);
    this.bulletSpeed = +(turretConfig.bulletSpeed + bonusBulletSpeed).toFixed(2);

    const baseFireRate = 1000 / (turretConfig.reloadTime || 650);
    const effectiveFireRate = +(baseFireRate + bonusFireRate).toFixed(2);
    this.fireRate = effectiveFireRate;
    this.reloadTime = bonusFireRate > 0
      ? Math.max(50, Math.round(1000 / effectiveFireRate))
      : turretConfig.reloadTime;
    const baseClipSize = turretConfig.clipSize || (turretConfig.id === 'heavy' ? 5 : (turretConfig.id === 'rapid' ? 15 : 10));
    const baseClipReloadTime = turretConfig.clipReloadTime || (turretConfig.id === 'heavy' ? 2000 : (turretConfig.id === 'rapid' ? 4000 : 3000));

    this.clipSize = baseClipSize + bonusClipSize;
    this.clipReloadTime = Math.max(1000, baseClipReloadTime - bonusReloadReduction);

    if (!hadAmmo || prevTurret !== turretConfig.id) {
      this.ammo = this.clipSize;
      this.isReloadingClip = false;
      this.clipReloadStartTime = 0;
      this.reloadProgress = 1;
    } else {
      this.ammo = Math.min(this.ammo, this.clipSize);
    }
    this.fov = Math.min(360, (turretConfig.fov || 90) + bonusFov);

    // Бонусні бойові властивості (враховуючи базове пробиття важкого дула та базовий рикошет дула «Рикошет»)
    this.bulletPierce = (turretConfig.bulletPierce || 0) + bonusBulletPierce;
    this.bulletRicochet = (turretConfig.ricochet || 0) + bonusRicochet;
    this.regenAmount = regenAmount;
    this.hasRegen = regenAmount > 0;
    this.proximityDmg = proximityDmg;
    this.ignoreArmor = ignoreArmor;
    this.instantBreakObstacles = instantBreakObstacles;
    this.invisibleBullets = invisibleBullets;
    this.invisibleTracks = invisibleTracks;
    this.hasThorns = hasThorns;
    this.maxRepairKits = maxRepairKits;
    if (typeof this.repairKitsLeft !== 'number') {
      this.repairKitsLeft = maxRepairKits;
    }
    this.ignoreShallowWater = ignoreShallowWater;
    this.hasLingerVision = hasLingerVision;
    this.maxMines = maxMines;
    this.hasMines = maxMines > 0;
    if (typeof this.minesLeft !== 'number') {
      this.minesLeft = maxMines;
    }
    this.hasWaterCamo = hasWaterCamo;
    this.canWalkDeepWater = canWalkDeepWater;
    this.maxRebirths = maxRebirths;
    if (typeof this.rebirthsLeft !== 'number') {
      this.rebirthsLeft = maxRebirths;
    }
    this.hasWallhack = hasWallhack;
    this.choiceCount = 3 + extraChoiceCount;
    this.maxRerolls = Math.min(3, maxRerolls);
    if (typeof this.rerollsLeft !== 'number') {
      this.rerollsLeft = this.maxRerolls;
    }
    this.noIceSlide = noIceSlide;
    this.luckStacks = luckStacks;
    this.hasSlowingTracks = hasSlowingTracks;
    this.trackLifeBonusFrames = trackLifeBonusFrames;
    this.hasSmokeScreen = hasSmokeScreen;
    this.hasSmoke = hasSmokeScreen;
    this.hasArtillery = hasArtillery;
    if (!hasArtillery && this.targetingMode === 'artillery') {
      this.targetingMode = null;
    }
    this.picksPerRound = picksPerRound;

    this.ensureValidSelectedActive();

    for (const fn of customPerkHooks) {
      fn(this);
    }
  }

  /**
   * Список доступних активних здібностей на ПРОБІЛ ('mines', 'smoke', 'artillery')
   */
  getAvailableActives() {
    const list = [];
    if ((this.maxMines || 0) > 0) list.push('mines');
    if (this.hasSmokeScreen) list.push('smoke');
    if (this.hasArtillery) list.push('artillery');
    return list;
  }

  /**
   * Забезпечення коректно обраної активної здібності на ПРОБІЛ
   */
  ensureValidSelectedActive() {
    const avail = this.getAvailableActives();
    if (avail.length === 0) {
      this.selectedActive = 'mines';
    } else if (this.localSelectedActive && avail.includes(this.localSelectedActive)) {
      this.selectedActive = this.localSelectedActive;
    } else if (!avail.includes(this.selectedActive)) {
      this.selectedActive = avail[0];
    }
    if (this.selectedActive !== 'artillery' && this.targetingMode === 'artillery') {
      this.targetingMode = null;
    }
    return this.selectedActive;
  }

  /**
   * Перемикання активної здібності на ПРОБІЛ клавішами Q (dir = -1) або E (dir = 1)
   */
  cycleActiveAbility(dir = 1) {
    const avail = this.getAvailableActives();
    if (avail.length <= 1) {
      const valid = this.ensureValidSelectedActive();
      this.localSelectedActive = valid;
      return valid;
    }
    const currIdx = Math.max(0, avail.indexOf(this.selectedActive));
    const nextIdx = (currIdx + dir + avail.length) % avail.length;
    this.selectedActive = avail[nextIdx];
    this.localSelectedActive = this.selectedActive;
    if (this.selectedActive !== 'artillery' && this.targetingMode === 'artillery') {
      this.targetingMode = null;
    }
    return this.selectedActive;
  }

  /**
   * Прямий вибір активної здібності на ПРОБІЛ ('mines', 'smoke' або 'artillery')
   */
  setSelectedActive(activeKey) {
    const avail = this.getAvailableActives();
    if (avail.includes(activeKey)) {
      this.selectedActive = activeKey;
      this.localSelectedActive = activeKey;
    } else {
      this.ensureValidSelectedActive();
    }
    if (this.selectedActive !== 'artillery' && this.targetingMode === 'artillery') {
      this.targetingMode = null;
    }
    return this.selectedActive;
  }

  /**
   * Перевірка готовності димової завіси (smoke_screen)
   */
  canUseSmoke() {
    if (this.isDead) return false;
    if (!this.hasSmokeScreen) return false;
    return (this.smokeCooldownTimer || 0) <= 0;
  }

  /**
   * Активація димової завіси (перезарядка 30 секунд = 1800 кадрів при 60 FPS)
   */
  triggerSmoke() {
    if (!this.canUseSmoke()) return false;
    this.smokeCooldownTimer = 1800;
    return true;
  }

  /**
   * Перевірка готовності артилерійського удару (artillery_strike)
   */
  canUseArtillery() {
    if (this.isDead) return false;
    if (!this.hasArtillery) return false;
    return (this.artilleryCooldownTimer || 0) <= 0;
  }

  /**
   * Активація перезарядки артилерії (35 секунд = 2100 кадрів при 60 FPS)
   */
  triggerArtillery() {
    if (!this.canUseArtillery()) return false;
    this.artilleryCooldownTimer = 2100;
    this.targetingMode = null;
    return true;
  }

  /**
   * Універсальний перемикач режиму вибору блоку на арені (для Артилерії та майбутніх механік блоків)
   */
  toggleBlockTargeting(mode = 'artillery') {
    if (this.isDead) {
      this.targetingMode = null;
      return null;
    }
    if (mode === 'artillery' && !this.canUseArtillery()) {
      this.targetingMode = null;
      return null;
    }
    this.targetingMode = (this.targetingMode === mode) ? null : mode;
    return this.targetingMode;
  }

  /**
   * Перевірка, чи розблоковано камбек-пасивку Фантомного корпусу (після 50% програних раундів або в Полігоні)
   */
  isPhantomComebackActive(gameState) {
    if (this.hullType !== 'phantom') return false;
    if (!gameState) return false;
    if (gameState.isTestMode) return true;
    const targetScore = Number(gameState.targetScore) || WIN_SCORE || 6;
    const roundsLost = this.id === 1
      ? (Number(gameState.score2 ?? gameState.p2Score) || 0)
      : (Number(gameState.score1 ?? gameState.p1Score) || 0);
    return roundsLost >= targetScore * 0.5;
  }

  /**
   * Додавання післяраундового бонусу (Perk) танку.
   * Рероли НЕ оновлюються посеред фази вибору (вони оновлюються лише щораунду у startPerkSelection / respawn),
   * якщо не передано options.refreshRerolls = true (наприклад, у зоні тестування).
   */
  applyPerk(perkId, options = {}) {
    if (!perkId || !PERK_TYPES[perkId]) return false;
    const hullConfig = HULL_TYPES[this.hullType] || HULL_TYPES.standard;
    if (hullConfig && hullConfig.blockHpAndArmorPerks && PHANTOM_FORBIDDEN_PERKS.includes(perkId)) {
      return false;
    }
    const perkDef = PERK_TYPES[perkId];
    const currentCount = this.acquiredPerks.filter(id => id === perkId).length;
    if (!perkDef.stackable && currentCount >= 1) {
      return false;
    }
    if (typeof perkDef.maxStacks === 'number' && currentCount >= perkDef.maxStacks) {
      return false;
    }

    this.acquiredPerks.push(perkId);
    const prevMaxHp = this.maxHp;
    const prevClipSize = this.clipSize;
    const prevMaxMines = this.maxMines || 0;
    const prevMaxRepairKits = this.maxRepairKits || 0;
    const prevMaxRebirths = this.maxRebirths || 0;
    const prevMaxRerolls = this.maxRerolls || 0;

    this.applyLoadout(this.hullType, this.turretType);

    if (this.maxHp > prevMaxHp) {
      this.hp = Math.min(this.maxHp, this.hp + (this.maxHp - prevMaxHp));
    }
    if (this.clipSize > prevClipSize) {
      this.ammo = this.clipSize;
    }
    if (this.maxMines > prevMaxMines) {
      this.minesLeft = this.maxMines;
    }
    if (this.maxRepairKits > prevMaxRepairKits) {
      this.repairKitsLeft = this.maxRepairKits;
    }
    if (this.maxRebirths > prevMaxRebirths) {
      this.rebirthsLeft = this.maxRebirths;
    }
    if (options && options.refreshRerolls && this.maxRerolls > prevMaxRerolls) {
      this.rerollsLeft = this.maxRerolls;
    }
    if (perkId === 'smoke_screen') {
      this.smokeCooldownTimer = 0;
      this.ensureValidSelectedActive();
    }
    if (perkId === 'artillery_strike') {
      this.artilleryCooldownTimer = 0;
      this.ensureValidSelectedActive();
    }
    return true;
  }

  /**
   * Видалення 1 стаку здібності (для Зони тестування / Полігону)
   */
  removePerk(perkId) {
    if (!perkId || !Array.isArray(this.acquiredPerks)) return false;
    const idx = this.acquiredPerks.lastIndexOf(perkId);
    if (idx === -1) return false;

    this.acquiredPerks.splice(idx, 1);
    this.applyLoadout(this.hullType, this.turretType);

    this.hp = Math.min(this.hp, this.maxHp);
    this.ammo = Math.min(this.ammo, this.clipSize);
    this.minesLeft = Math.min(this.minesLeft || 0, this.maxMines || 0);
    this.repairKitsLeft = Math.min(this.repairKitsLeft || 0, this.maxRepairKits || 0);
    this.rebirthsLeft = Math.min(this.rebirthsLeft || 0, this.maxRebirths || 0);
    this.rerollsLeft = Math.min(this.rerollsLeft || 0, this.maxRerolls || 0);
    if (!this.hasSmokeScreen) {
      this.smokeCooldownTimer = 0;
    }
    if (!this.hasArtillery) {
      this.artilleryCooldownTimer = 0;
      if (this.targetingMode === 'artillery') {
        this.targetingMode = null;
      }
    }
    if (this.localSelectedActive && !this.getAvailableActives().includes(this.localSelectedActive)) {
      this.localSelectedActive = null;
    }
    this.ensureValidSelectedActive();
    return true;
  }

  /**
   * Повне скидання всіх накопичених бонусів (викликається при натисканні «Реванш» або «Скинути» на полігоні)
   */
  resetPerks() {
    this.acquiredPerks = [];
    this.regenTimer = 0;
    this.proximityTimer = 0;
    this.lingerTimer = 0;
    this.smokeCooldownTimer = 0;
    this.artilleryCooldownTimer = 0;
    this.targetingMode = null;
    this.hitInvulnTimer = 0;
    this.roundTimeDmgBonus = 0;
    this.lastMineTime = 0;
    this.lastRepairTime = 0;
    this.minesLeft = 0;
    this.maxMines = 0;
    this.repairKitsLeft = 0;
    this.maxRepairKits = 0;
    this.rebirthsLeft = 0;
    this.maxRebirths = 0;
    this.rerollsLeft = 0;
    this.maxRerolls = 0;
    this.selectedActive = 'mines';
    this.localSelectedActive = null;
    this.vx = 0;
    this.vy = 0;
    this.applyLoadout(this.hullType, this.turretType);
    this.hp = this.maxHp;
    this.ammo = this.clipSize;
  }

  /**
   * Перевірка можливості встановити міну (на ПРОБІЛ)
   */
  canPlaceMine(now = Date.now()) {
    if (this.isDead) return false;
    if (!this.maxMines || this.minesLeft <= 0) return false;
    return (now - (this.lastMineTime || 0)) >= 350;
  }

  /**
   * Фіксація встановлення міни
   */
  recordMinePlaced(now = Date.now()) {
    this.lastMineTime = now;
    this.minesLeft = Math.max(0, (this.minesLeft || 0) - 1);
  }

  /**
   * Перевірка можливості використати ремонтний комплект (на англійську клавішу H)
   */
  canUseRepairKit(now = Date.now()) {
    if (this.isDead) return false;
    if (!this.maxRepairKits || this.repairKitsLeft <= 0) return false;
    if (this.hp >= this.maxHp) return false;
    return (now - (this.lastRepairTime || 0)) >= 300;
  }

  /**
   * Використання ремонтного комплекту (відновлює 20% від максимального HP)
   */
  useRepairKit(now = Date.now()) {
    if (!this.canUseRepairKit(now)) return false;
    this.lastRepairTime = now;
    this.repairKitsLeft = Math.max(0, (this.repairKitsLeft || 0) - 1);
    const healAmount = Math.max(1, Math.round(this.maxHp * 0.20));
    this.hp = Math.min(this.maxHp, this.hp + healAmount);
    return true;
  }

  /**
   * Примусова перезарядка касети на клавішу "R" (навіть якщо в касеті ще є кулі)
   */
  startManualReload(now = Date.now()) {
    if (this.isDead) return false;
    if (this.isReloadingClip) return false;
    if (this.ammo >= this.clipSize) return false;
    this.ammo = 0;
    this.isReloadingClip = true;
    this.clipReloadStartTime = now;
    this.reloadProgress = 0;
    return true;
  }

  /**
   * Перевірка, чи знаходиться танк на клітинці мілкої (id === 8) або глибокої (id === 3) води
   */
  isOnShallowWater(map, tileSize) {
    if (!map || !map.length || !tileSize) return false;
    const cx = this.x + this.size / 2;
    const cy = this.y + this.size / 2;
    const c = Math.floor(cx / tileSize);
    const r = Math.floor(cy / tileSize);
    if (r >= 0 && r < map.length && c >= 0 && c < map[0].length) {
      return map[r][c] === 8 || map[r][c] === 3;
    }
    return false;
  }

  /**
   * Перевірка, чи знаходиться танк на клітинці глибокої води (id === 3)
   */
  isOnDeepWater(map, tileSize) {
    if (!map || !map.length || !tileSize) return false;
    const cx = this.x + this.size / 2;
    const cy = this.y + this.size / 2;
    const c = Math.floor(cx / tileSize);
    const r = Math.floor(cy / tileSize);
    if (r >= 0 && r < map.length && c >= 0 && c < map[0].length) {
      return map[r][c] === 3;
    }
    return false;
  }

  /**
   * Перевірка, чи знаходиться танк на клітинці льоду (шар iceGrid[r][c] === 1 або map[r][c] === 10)
   */
  isOnIce(map, tileSize, iceGrid = null) {
    if (!tileSize) return false;
    const cx = this.x + this.size / 2;
    const cy = this.y + this.size / 2;
    const c = Math.floor(cx / tileSize);
    const r = Math.floor(cy / tileSize);
    if (iceGrid && r >= 0 && r < iceGrid.length && iceGrid[r] && c >= 0 && c < iceGrid[r].length) {
      if (iceGrid[r][c] === 1) return true;
    }
    if (map && r >= 0 && r < map.length && map[r] && c >= 0 && c < map[r].length) {
      if (map[r][c] === 10) return true;
    }
    return false;
  }

  /**
   * Оновлення фізики, повороту корпусу, переміщення (вкл. інерцію на льоду та сповільнення від слідів) та вежі
   */
  update(input, otherTank, map, canvasWidth, canvasHeight, tileSize, checkMapCollision, checkTankCollision, envOptions = null) {
    if (this.isDead) {
      if (this.respawnTimer > 0) this.respawnTimer--;
      return;
    }

    if (this.spawnShieldTimer > 0) this.spawnShieldTimer--;
    if (this.hitInvulnTimer > 0) this.hitInvulnTimer--;

    // 1. Оновлення напрямку вежі (прив'язка до миші)
    if (input && Number.isFinite(input.turretAngle)) {
      this.turretAngle = input.turretAngle;
    }

    // 2. Обертання корпусу навколо своєї осі (A / D)
    let isRotating = false;
    if (input.left) {
      this.bodyAngle -= this.rotateSpeed;
      isRotating = true;
    }
    if (input.right) {
      this.bodyAngle += this.rotateSpeed;
      isRotating = true;
    }

    // Нормалізація кута корпусу [-PI, PI]
    this.bodyAngle = Math.atan2(Math.sin(this.bodyAngle), Math.cos(this.bodyAngle));

    // 3. Рух корпусу вперед / назад за напрямком bodyAngle (W / S)
    // Якщо танк на глибокій воді (id: 3) або на мілкій воді (id: 8, без перка ignore_shallow_water) — швидкість сповільнюється на 50%!
    const onDeepWater = this.isOnDeepWater(map, tileSize);
    const slowedByWater = onDeepWater || (!this.ignoreShallowWater && this.isOnShallowWater(map, tileSize));
    let currentMoveSpeed = slowedByWater ? (this.speed * 0.5) : this.speed;

    // Якщо ворог наїхав на наші сповільнюючі сліди (slowing_tracks) — сповільнюється на 30% (множник 0.70)
    const slowedByTrack = Boolean((envOptions && envOptions.enemyTrackSlow) || this.slowedByEnemyTrack);
    if (slowedByTrack) {
      currentMoveSpeed *= 0.70;
    }

    let driveX = 0;
    let driveY = 0;
    let isDriving = false;

    if (input.up) {
      // Рух уперед
      driveX += Math.cos(this.bodyAngle) * currentMoveSpeed;
      driveY += Math.sin(this.bodyAngle) * currentMoveSpeed;
      isDriving = true;
    }
    if (input.down) {
      // Рух назад (трохи повільніший реверс)
      driveX -= Math.cos(this.bodyAngle) * (currentMoveSpeed * 0.65);
      driveY -= Math.sin(this.bodyAngle) * (currentMoveSpeed * 0.65);
      isDriving = true;
    }

    // Перевірка інерції на льоду (якщо немає перка no_ice_slide)
    const iceGrid = envOptions && envOptions.iceGrid ? envOptions.iceGrid : null;
    const onIce = !this.noIceSlide && this.isOnIce(map, tileSize, iceGrid);

    let moveX = 0;
    let moveY = 0;

    if (onIce) {
      if (isDriving) {
        this.vx += (driveX - this.vx) * 0.12;
        this.vy += (driveY - this.vy) * 0.12;
      } else {
        this.vx *= 0.965;
        this.vy *= 0.965;
        if (Math.hypot(this.vx, this.vy) < 0.025) {
          this.vx = 0;
          this.vy = 0;
        }
      }
      moveX = this.vx;
      moveY = this.vy;
    } else {
      this.vx = driveX;
      this.vy = driveY;
      moveX = driveX;
      moveY = driveY;
    }

    const isSlidingOrDriving = Math.hypot(moveX, moveY) > 0.01;
    this.isMoving = isDriving || isRotating || isSlidingOrDriving;
    if (this.isMoving) {
      this.animFrame = (this.animFrame + 1) % 20;
      this.trackTimer++;
    }

    // 4. Плавна обробка колізій зі слайдингом (ковзанням вздовж стін)
    if (isSlidingOrDriving) {
      const pad = 2;
      const boxSize = this.size - pad * 2;

      // Спроба повного руху
      let testX = Math.max(0, Math.min(canvasWidth - this.size, this.x + moveX));
      let testY = Math.max(0, Math.min(canvasHeight - this.size, this.y + moveY));

      const collFull = checkMapCollision(testX + pad, testY + pad, boxSize, boxSize, map, this) ||
                       (otherTank && checkTankCollision(this, otherTank, testX, testY));

      if (!collFull) {
        this.x = testX;
        this.y = testY;
      } else {
        // Слайдинг по осі X
        testX = Math.max(0, Math.min(canvasWidth - this.size, this.x + moveX));
        const collX = checkMapCollision(testX + pad, this.y + pad, boxSize, boxSize, map, this) ||
                      (otherTank && checkTankCollision(this, otherTank, testX, this.y));
        if (!collX && moveX !== 0) {
          this.x = testX;
        } else if (onIce) {
          this.vx = 0;
        }

        // Слайдинг по осі Y
        testY = Math.max(0, Math.min(canvasHeight - this.size, this.y + moveY));
        const collY = checkMapCollision(this.x + pad, testY + pad, boxSize, boxSize, map, this) ||
                      (otherTank && checkTankCollision(this, otherTank, this.x, testY));
        if (!collY && moveY !== 0) {
          this.y = testY;
        } else if (onIce) {
          this.vy = 0;
        }
      }
    }
  }

  /**
   * Чи готовий танк зробити постріл (перевірка касети 5/10/15 пострілів, перезарядки 2с/3с/4с та темпу вогню)
   */
  canShoot(now = Date.now()) {
    if (this.isDead) return false;

    // 1. Якщо триває перезарядка касети (після 5 / 10 / 15 пострілів або на R)
    if (this.isReloadingClip) {
      if ((now - this.clipReloadStartTime) >= this.clipReloadTime) {
        this.isReloadingClip = false;
        this.ammo = this.clipSize;
        this.reloadProgress = 1;
      } else {
        return false;
      }
    }

    // 2. Якщо набої в касеті вичерпано — запускаємо перезарядку касети
    if (this.ammo <= 0) {
      this.isReloadingClip = true;
      this.clipReloadStartTime = now;
      this.reloadProgress = 0;
      return false;
    }

    // 3. Звичайна швидкострільність між пострілами всередині касети
    return (now - this.lastShootTime) >= this.reloadTime;
  }

  /**
   * Фіксація пострілу: зменшує лічильник снарядів у касеті та вмикає перезарядку тільки після 5 / 10 / 15 пострілів
   */
  recordShot(now = Date.now()) {
    if (this.isReloadingClip && (now - this.clipReloadStartTime) >= this.clipReloadTime) {
      this.isReloadingClip = false;
      this.ammo = this.clipSize;
      this.reloadProgress = 1;
    }

    this.lastShootTime = now;
    if (this.turretType === 'rapid') {
      this.rapidBarrelIndex = (this.rapidBarrelIndex === 1) ? 0 : 1;
    }

    const currentAmmo = typeof this.ammo === 'number' ? this.ammo : this.clipSize;
    this.ammo = Math.max(0, currentAmmo - 1);

    // Коли відстріляно всі снаряди касети (5 для важкого, 10 для середнього, 15 для швидкісного) —
    // вмикається перезарядка касети (2с / 3с / 4с)
    if (this.ammo <= 0) {
      this.isReloadingClip = true;
      this.clipReloadStartTime = now;
      this.reloadProgress = 0;
    } else {
      this.isReloadingClip = false;
      this.reloadProgress = 1;
    }
  }

  /**
   * Отримання поточного прогресу перезарядки касети [0..1] (1 = касета заряджена, <1 = триває перезарядка 2с/3с/4с)
   */
  getReloadProgress(now = Date.now()) {
    if (!this.isReloadingClip) {
      if (typeof this.reloadProgress === 'number' && this.reloadProgress < 1 && this.clipReloadStartTime === 0) {
        return Math.max(0, Math.min(1, this.reloadProgress));
      }
      this.reloadProgress = 1;
      return 1;
    }

    if (!this.clipReloadTime || this.clipReloadTime <= 0) {
      this.isReloadingClip = false;
      this.ammo = this.clipSize;
      this.reloadProgress = 1;
      return 1;
    }

    const elapsed = Math.max(0, now - this.clipReloadStartTime);
    if (elapsed < this.clipReloadTime) {
      this.reloadProgress = Math.max(0, Math.min(1, elapsed / this.clipReloadTime));
      return this.reloadProgress;
    }

    // Перезарядка касети щойно завершилася — поповнюємо боєкомплект до максимуму (5 / 10 / 15)
    this.isReloadingClip = false;
    this.ammo = this.clipSize;
    this.reloadProgress = 1;
    return 1;
  }

  /**
   * Отримання кінчика ствола для спавну снаряда та спалаху
   */
  getMuzzlePosition() {
    const cx = this.x + this.size / 2;
    const cy = this.y + this.size / 2;
    let gunLen = Math.floor(this.size * 0.62);
    let localOffsetPerp = 0;

    if (this.turretType === 'heavy') {
      gunLen = Math.floor(this.size * 0.72);
    } else if (this.turretType === 'rapid') {
      gunLen = Math.floor(this.size * 0.58);
      const barrelSpacing = Math.max(3.5, Math.floor(this.size * 0.13));
      // Чергування пострілів між лівим та правим стволом
      localOffsetPerp = (this.rapidBarrelIndex === 1) ? barrelSpacing : -barrelSpacing;
    }

    // Вектор вперед за кутом вежі
    const fwdX = Math.cos(this.turretAngle);
    const fwdY = Math.sin(this.turretAngle);

    // Перпендикулярний вектор (вправо в просторі Canvas)
    const perpX = -Math.sin(this.turretAngle);
    const perpY = Math.cos(this.turretAngle);

    return {
      x: cx + fwdX * gunLen + perpX * localOffsetPerp,
      y: cy + fwdY * gunLen + perpY * localOffsetPerp,
      angle: this.turretAngle
    };
  }

  /**
   * Відродження танка на точці спавну з повним HP, повною касетою снарядів та оновленим запасом мін, ремкомплектів, реролів, диму й артилерії на раунд
   */
  respawn(options = {}) {
    this.isDead = false;
    this.x = this.spawnX;
    this.y = this.spawnY;
    this.vx = 0;
    this.vy = 0;
    this.bodyAngle = this.spawnAngle;
    this.turretAngle = this.spawnAngle;
    this.hp = this.maxHp;
    this.spawnShieldTimer = 150;
    this.hitInvulnTimer = 0;
    this.lastShootTime = 0;
    this.ammo = this.clipSize;
    this.minesLeft = this.maxMines || 0;
    this.repairKitsLeft = this.maxRepairKits || 0;
    this.rebirthsLeft = this.maxRebirths || 0;
    if (!options || !options.preserveRerolls) {
      this.rerollsLeft = this.maxRerolls || 0;
    }
    this.smokeCooldownTimer = 0;
    this.artilleryCooldownTimer = 0;
    this.targetingMode = null;
    this.roundTimeDmgBonus = 0;
    if (typeof this.baseMaxDmg === 'number') {
      this.maxDmg = this.baseMaxDmg;
    }
    this.regenTimer = 0;
    this.proximityTimer = 0;
    this.lingerTimer = 0;
    this.isReloadingClip = false;
    this.clipReloadStartTime = 0;
    this.reloadProgress = 1;
    this.ensureValidSelectedActive();
  }

  /**
   * Переродження танка (Божественна здібність rebirth_plus_1):
   * танк миттєво відроджується з повним HP на своїй точці спавну, а раунд не скінчується!
   */
  triggerRebirth() {
    if (!this.rebirthsLeft || this.rebirthsLeft <= 0) return false;
    this.rebirthsLeft = Math.max(0, this.rebirthsLeft - 1);
    this.isDead = false;
    this.x = this.spawnX;
    this.y = this.spawnY;
    this.vx = 0;
    this.vy = 0;
    this.bodyAngle = this.spawnAngle;
    this.turretAngle = this.spawnAngle;
    this.hp = this.maxHp;
    this.spawnShieldTimer = 120;
    this.hitInvulnTimer = 0;
    this.ammo = this.clipSize;
    this.isReloadingClip = false;
    this.clipReloadStartTime = 0;
    this.reloadProgress = 1;
    this.proximityTimer = 0;
    this.targetingMode = null;
    return true;
  }

  /**
   * Центр танка
   */
  getCenter() {
    return {
      x: this.x + this.size / 2,
      y: this.y + this.size / 2
    };
  }

  /**
   * Синхронізація стану танка з мережевого пакета (Host -> Guest)
   */
  syncFrom(data) {
    if (!data) return;
    this.x = data.x;
    this.y = data.y;
    if (Number.isFinite(data.bodyAngle)) this.bodyAngle = data.bodyAngle;
    if (Number.isFinite(data.turretAngle)) this.turretAngle = data.turretAngle;
    const incomingPerks = Array.isArray(data.perks) ? data.perks : (Array.isArray(data.acquiredPerks) ? data.acquiredPerks : null);
    if (incomingPerks) {
      const samePerks = this.acquiredPerks.length === incomingPerks.length &&
        this.acquiredPerks.every((p, idx) => p === incomingPerks[idx]);
      if (!samePerks) {
        this.acquiredPerks = [...incomingPerks];
        this.applyLoadout(data.hull || this.hullType, data.turret || this.turretType);
      }
    }
    if ((data.hull && data.hull !== this.hullType) || (data.turret && data.turret !== this.turretType)) {
      this.applyLoadout(data.hull || this.hullType, data.turret || this.turretType);
    }
    if (typeof data.maxHp === 'number' && data.maxHp > 0) this.maxHp = data.maxHp;
    if (typeof data.hp === 'number') this.hp = data.hp;
    this.isDead = data.isDead;
    this.respawnTimer = data.respawnTimer;
    this.spawnShieldTimer = data.spawnShieldTimer;
    if (typeof data.hitInvulnTimer === 'number') {
      this.hitInvulnTimer = data.hitInvulnTimer;
    }
    this.animFrame = data.animFrame;
    if (typeof data.fov === 'number') this.fov = data.fov;
    if (typeof data.minDmg === 'number') this.minDmg = data.minDmg;
    if (typeof data.maxDmg === 'number') this.maxDmg = data.maxDmg;
    if (typeof data.roundTimeDmgBonus === 'number') this.roundTimeDmgBonus = data.roundTimeDmgBonus;
    if (typeof data.reloadTime === 'number' && data.reloadTime > 0) {
      this.reloadTime = data.reloadTime;
    }
    if (typeof data.fireRate === 'number' && data.fireRate > 0) {
      this.fireRate = data.fireRate;
    }
    if (typeof data.armor === 'number') {
      this.armor = data.armor;
    } else if (HULL_TYPES[this.hullType] && typeof HULL_TYPES[this.hullType].armor === 'number') {
      this.armor = HULL_TYPES[this.hullType].armor;
    }
    if (typeof data.ammo === 'number') {
      this.ammo = data.ammo;
    }
    if (typeof data.minesLeft === 'number') {
      this.minesLeft = data.minesLeft;
    }
    if (typeof data.maxMines === 'number') {
      this.maxMines = data.maxMines;
    }
    if (typeof data.repairKitsLeft === 'number') {
      this.repairKitsLeft = data.repairKitsLeft;
    }
    if (typeof data.maxRepairKits === 'number') {
      this.maxRepairKits = data.maxRepairKits;
    }
    if (typeof data.rebirthsLeft === 'number') {
      this.rebirthsLeft = data.rebirthsLeft;
    }
    if (typeof data.maxRebirths === 'number') {
      this.maxRebirths = data.maxRebirths;
    }
    if (typeof data.rerollsLeft === 'number') {
      this.rerollsLeft = data.rerollsLeft;
    }
    if (typeof data.maxRerolls === 'number') {
      this.maxRerolls = data.maxRerolls;
    }
    if (typeof data.hasSmokeScreen === 'boolean') {
      this.hasSmokeScreen = data.hasSmokeScreen;
    }
    if (typeof data.smokeCooldownTimer === 'number') {
      const recentlyTriggeredLocally =
        this.lastSmokeLocalTriggerTime && (Date.now() - this.lastSmokeLocalTriggerTime < 600);
      if (!recentlyTriggeredLocally || data.smokeCooldownTimer > 0) {
        this.smokeCooldownTimer = data.smokeCooldownTimer;
      }
    }
    if (typeof data.hasArtillery === 'boolean') {
      this.hasArtillery = data.hasArtillery;
    }
    if (typeof data.artilleryCooldownTimer === 'number') {
      const recentlyTriggeredArtillery =
        this.lastArtilleryLocalTriggerTime && (Date.now() - this.lastArtilleryLocalTriggerTime < 600);
      if (!recentlyTriggeredArtillery || data.artilleryCooldownTimer > 0) {
        this.artilleryCooldownTimer = data.artilleryCooldownTimer;
      }
    }
    if (this.localSelectedActive) {
      this.selectedActive = this.localSelectedActive;
      this.ensureValidSelectedActive();
    } else if (typeof data.selectedActive === 'string') {
      this.selectedActive = data.selectedActive;
    }
    if (typeof data.proximityDmg === 'number') {
      this.proximityDmg = data.proximityDmg;
    }
    if (typeof data.isReloadingClip === 'boolean') {
      const wasReloading = this.isReloadingClip;
      this.isReloadingClip = data.isReloadingClip;
      if (data.isReloadingClip && !wasReloading) {
        const prog = typeof data.reloadProgress === 'number' ? data.reloadProgress : 0;
        this.clipReloadStartTime = Date.now() - Math.round(prog * (this.clipReloadTime || 3000));
      } else if (!data.isReloadingClip) {
        this.reloadProgress = 1;
      }
    }
    if (typeof data.reloadProgress === 'number') {
      this.reloadProgress = data.reloadProgress;
      if (data.reloadProgress < 0.99 && this.clipReloadTime > 0) {
        this.isReloadingClip = true;
        const now = Date.now();
        const localElapsed = now - (this.clipReloadStartTime || 0);
        if (!this.clipReloadStartTime || localElapsed >= this.clipReloadTime) {
          this.clipReloadStartTime = now - Math.round(data.reloadProgress * this.clipReloadTime);
        }
      }
    }
  }

  /**
   * Рендеринг гусениці зі специфічним стилем (standard / heavy / light)
   */
  drawSingleTread(ctx, x, y, w, h, isGhost, treadStyle = 'standard') {
    drawSingleTread(this, ctx, x, y, w, h, isGhost, treadStyle);
  }

  /**
   * Рендеринг тільки корпусу танка (Шар 1 — під низькими кущами)
   */
  drawHull(ctx, renderPos, isGhost = false, ghostAlpha = 1) {
    this.draw(ctx, renderPos, isGhost, ghostAlpha, 'hull');
  }

  /**
   * Рендеринг тільки башти та дула танка (Шар 2 — поверх низьких кущів!)
   */
  drawTurret(ctx, renderPos, isGhost = false, ghostAlpha = 1) {
    this.draw(ctx, renderPos, isGhost, ghostAlpha, 'turret');
  }

  /**
   * Рендеринг танка з роздільними шарами: Корпус (bodyAngle) та Вежа (turretAngle)
   * Підтримує параметр layer: 'all' (за замовчуванням), 'hull' (тільки корпус), 'turret' (тільки вежа та дуло)
   */
  draw(ctx, renderPos, isGhost = false, ghostAlpha = 1, layer = 'all') {
    drawTankModel(this, ctx, renderPos, isGhost, ghostAlpha, layer);
  }

  /**
   * Рендеринг індикатора перезарядки касети безпосередньо над ВЛАСНИМ танком (ворог перезарядку не бачить)
   */
  drawReloadIndicator(ctx, renderPos, now = Date.now()) {
    return drawTankReloadIndicator(this, ctx, renderPos, now);
  }
}

/**
 * Клас снаряда зі швидкістю за вектором turretAngle, шкодою, пробиттям ворожих куль, рикошетами та ігноруванням броні
 */
export class Bullet {
  /**
   * @param {number} ownerId - 1 або 2
   * @param {number} x - координата X
   * @param {number} y - координата Y
   * @param {number} vx - вектор швидкості по X
   * @param {number} vy - вектор швидкості по Y
   * @param {number} damage - нанесена шкода при влучанні
   * @param {number} angle - кут траєкторії
   * @param {Object} options - додаткові властивості { pierceLeft, ricochetsLeft, ignoreArmor, instantBreak, invisibleToEnemy }
   */
  constructor(ownerId, x, y, vx, vy, damage = 20, angle = 0, options = {}) {
    this.ownerId = ownerId;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.damage = damage;
    this.angle = angle;
    this.pierceLeft = typeof options.pierceLeft === 'number' ? options.pierceLeft : 0;
    this.ricochetsLeft = typeof options.ricochetsLeft === 'number' ? options.ricochetsLeft : 0;
    this.ignoreArmor = Boolean(options.ignoreArmor);
    this.instantBreak = Boolean(options.instantBreak);
    this.invisibleToEnemy = Boolean(options.invisibleToEnemy);
    this.w = 6;
    this.h = 6;
    this.trail = [];
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
  }

  isOutOfBounds(canvasWidth, canvasHeight) {
    return this.x < 0 || this.x > canvasWidth || this.y < 0 || this.y > canvasHeight;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // Яскравий снаряд високої контрастності
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-3, -2, 7, 4);

    ctx.fillStyle = this.ignoreArmor
      ? '#00e5ff'
      : (this.ricochetsLeft > 0 ? '#00d8d6' : (this.pierceLeft > 0 ? '#a55eea' : '#f39c12'));
    ctx.fillRect(-2, -1.5, 4, 3);

    ctx.fillStyle = this.instantBreak ? '#ff3f34' : '#e74c3c';
    ctx.fillRect(-4, -1, 2, 2);

    ctx.restore();
  }
}

/**
 * Клас протитанкової міни:
 * - Залишається на ПРОБІЛ
 * - Видно власнику завжди, а ворогу — ТІЛЬКИ при прямому погляді
 * - Снаряди вільно пролітають над мінами
 * - Власника не чіпає, ворогу наносить 40–60 HP шкоди
 */
export class Mine {
  /**
   * @param {number} ownerId - 1 або 2
   * @param {number} x - центр міни по X
   * @param {number} y - центр міни по Y
   * @param {number} minDmg - мінімальна шкода (40)
   * @param {number} maxDmg - максимальна шкода (60)
   */
  constructor(ownerId, x, y, minDmg = 40, maxDmg = 60) {
    this.ownerId = ownerId;
    this.x = x;
    this.y = y;
    this.radius = 10;
    this.minDmg = minDmg;
    this.maxDmg = maxDmg;
  }

  rollDamage() {
    return Math.floor(Math.random() * (this.maxDmg - this.minDmg + 1)) + this.minDmg;
  }

  draw(ctx, isOwnMine = false) {
    if (!ctx) return;
    ctx.save();
    ctx.translate(this.x, this.y);

    // Контур безпеки для власних мін
    if (isOwnMine) {
      ctx.strokeStyle = this.ownerId === 1 ? 'rgba(241, 196, 15, 0.55)' : 'rgba(46, 204, 113, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 4 бічні контакти детонатора
    ctx.fillStyle = '#1e272e';
    ctx.fillRect(-this.radius, -2, this.radius * 2, 4);
    ctx.fillRect(-2, -this.radius, 4, this.radius * 2);

    // Металевий корпус міни
    ctx.fillStyle = '#2f3640';
    ctx.strokeStyle = '#0a0d12';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Внутрішня натискна пластина
    ctx.fillStyle = '#485460';
    ctx.beginPath();
    ctx.arc(0, 0, this.radius * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Центральний індикатор (пульсуючий вогник)
    const blink = Math.floor(Date.now() / 280) % 2 === 0;
    if (isOwnMine) {
      ctx.fillStyle = blink ? (this.ownerId === 1 ? '#f1c40f' : '#2ecc71') : '#fff375';
    } else {
      ctx.fillStyle = blink ? '#ff4757' : '#ffa502';
    }
    ctx.beginPath();
    ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

