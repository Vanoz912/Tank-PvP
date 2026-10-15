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
  BASE_CURSE_CHANCE,
  HULL_TYPES,
  PHANTOM_FORBIDDEN_PERKS,
  PHANTOM_FORBIDDEN_CURSES,
  BABY_FORBIDDEN_PERKS,
  BABY_FORBIDDEN_CURSES,
  SNIPER_FORBIDDEN_PERKS,
  SNIPER_FORBIDDEN_CURSES,
  TURRET_TYPES,
  PERK_RARITIES,
  LUCK_WEIGHT_MODIFIERS,
  getRarityWeightWithLuck,
  PERK_TYPES,
  CURSE_TYPES
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
  SmokeParticle,
  TracerTrail
} from './vfx.js?v=20261011_v17';
import { getEffectiveTileId, isCellEffectiveHighBush, getEffectiveCellTile } from './tiles.js?v=20261011_v17';

export {
  WIN_SCORE,
  MAX_TANK_SPEED,
  BASE_CURSE_CHANCE,
  HULL_TYPES,
  PHANTOM_FORBIDDEN_PERKS,
  PHANTOM_FORBIDDEN_CURSES,
  BABY_FORBIDDEN_PERKS,
  BABY_FORBIDDEN_CURSES,
  SNIPER_FORBIDDEN_PERKS,
  SNIPER_FORBIDDEN_CURSES,
  TURRET_TYPES,
  PERK_RARITIES,
  LUCK_WEIGHT_MODIFIERS,
  getRarityWeightWithLuck,
  PERK_TYPES,
  CURSE_TYPES,
  Explosion,
  TreadMark,
  SmokeCloud,
  DebrisParticle,
  MuzzleFlash,
  SmokeParticle,
  TracerTrail
};

export const DIRS = [
  { dx: 0, dy: -1 }, // 0: Вгору
  { dx: 1, dy: 0 },  // 1: Вправо
  { dx: 0, dy: 1 },  // 2: Вниз
  { dx: -1, dy: 0 }  // 3: Вліво
];

/**
 * Клас бойового танка з незалежним обертанням корпусу та вежі, системою касет та післяраундових бонусів (Perks & Curses)
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
    this.baseSize = options.size || 26;
    this.size = this.baseSize;
    this.sizeScale = 1.0;

    // Кути в радіанах (роздільне керування)
    this.bodyAngle = initialAngle;
    this.turretAngle = initialAngle;

    // Масив отриманих за матч післяраундових бонусів та проклять (скидається при Реванші)
    this.acquiredPerks = [];
    this.acquiredCurses = [];
    this.regenTimer = 0;
    this.proximityTimer = 0;
    this.lingerTimer = 0;
    this.smokeCooldownTimer = 0;
    this.smokeActiveTimer = 0;
    this.artilleryCooldownTimer = 0;
    this.artilleryPendingTimer = 0;
    this.beaconCooldownTimer = 0;
    this.beaconActiveTimer = 0;
    this.beaconHealTickTimer = 0;
    this.beaconStacks = 0;
    this.beaconHealStacks = 0;
    this.spotCooldownTimer = 0;
    this.spotActiveTimer = 0;
    this.guidedCooldownTimer = 0;
    this.guidedBulletArmed = false;
    this.guidedBulletActive = false;
    this.turboCooldownTimer = 0;
    this.turboActiveTimer = 0;
    this.sniperStealthTimer = 0;
    this.blindTimer = 0;
    this.targetingMode = null;
    this.hitInvulnTimer = 0;
    this.roundTimeDmgBonus = 0;
    this.lastMineTime = 0;
    this.lastRepairTime = 0;
    this.selectedActive = 'mines';

    // Конфігурація корпусу та вежі
    this.hullType = options.hull || 'standard';
    this.turretType = options.turret || 'standard';
    this.roundsLost = 0;

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

    // Команда та візуальні кольори (підтримка команд 1, 2, 3, 4)
    this.team = Number(options.team) || id;
    this.isP1 = id === 1;

    const teamColors = {
      1: { base: '#f39c12', light: '#f1c40f', dark: '#b7791f' }, // Команда 1 (Золотий / Жовтий)
      2: { base: '#27ae60', light: '#2ecc71', dark: '#1e824c' }, // Команда 2 (Смарагдовий / Зелений)
      3: { base: '#00cec9', light: '#00d2d3', dark: '#0984e3' }, // Команда 3 (Ціан / Синій)
      4: { base: '#8e44ad', light: '#e056fd', dark: '#6c5ce7' }  // Команда 4 (Фіолетовий)
    };
    const cTheme = teamColors[this.team] || (id === 1 ? teamColors[1] : teamColors[2]);
    this.baseColor = cTheme.base;
    this.lightColor = cTheme.light;
    this.darkColor = cTheme.dark;
  }

  /**
   * Застосування характеристик обраного спорядження з урахуванням усіх накопичених бонусів (acquiredPerks) та проклять (acquiredCurses)
   */
  applyLoadout(hullId, turretId, customRoundsLost = null) {
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
    if (!Array.isArray(this.acquiredCurses)) {
      this.acquiredCurses = [];
    }

    // Якщо обрано корпус з 1 HP та 95% броні (phantom), прибираємо заборонені для нього перки та прокляття на HP/Броню/Реген/Ремкомплект
    if (hullConfig.blockHpAndArmorPerks) {
      if (this.acquiredPerks.length > 0) {
        this.acquiredPerks = this.acquiredPerks.filter(id => !PHANTOM_FORBIDDEN_PERKS.includes(id));
      }
      if (this.acquiredCurses.length > 0) {
        this.acquiredCurses = this.acquiredCurses.filter(id => !PHANTOM_FORBIDDEN_CURSES.includes(id));
      }
    }

    // Якщо обрано корпус «Малюк» (baby), прибираємо перки/прокляття, що впливають на розмір
    if (hullConfig.blockSizePerks) {
      if (this.acquiredPerks.length > 0) {
        this.acquiredPerks = this.acquiredPerks.filter(id => !BABY_FORBIDDEN_PERKS.includes(id));
      }
      if (this.acquiredCurses.length > 0) {
        this.acquiredCurses = this.acquiredCurses.filter(id => !BABY_FORBIDDEN_CURSES.includes(id));
      }
    }

    // Якщо обрано башту «Снайпер» (sniper), прибираємо перки/прокляття на кут огляду та розкид
    if (turretConfig.fixedFov || turretConfig.noSpread) {
      if (this.acquiredPerks.length > 0) {
        this.acquiredPerks = this.acquiredPerks.filter(id => !SNIPER_FORBIDDEN_PERKS.includes(id));
      }
      if (this.acquiredCurses.length > 0) {
        this.acquiredCurses = this.acquiredCurses.filter(id => !SNIPER_FORBIDDEN_CURSES.includes(id));
      }
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
    let bonusSpreadHalfAngle = 0;
    let regenAmount = 0;
    let proximityDmg = 0;
    let ignoreArmor = false;
    let instantBreakObstacles = false;
    let invisibleBullets = false;
    let invisibleTracks = false;
    let hasThorns = false;
    let maxRepairKits = 0;
    let ignoreShallowWater = Boolean(hullConfig.ignoreShallowWater);
    let seeInLowBush = Boolean(hullConfig.seeInLowBush);
    let camoInLowBushAndShallowWater = Boolean(hullConfig.camoInLowBushAndShallowWater);
    let coverArmorBonus = typeof hullConfig.coverArmorBonus === 'number' ? hullConfig.coverArmorBonus : 0;
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
    let hasShrinkTank20 = false;
    let beaconStacks = 0;
    let hasSpotEnemy = false;
    let hasGuidedBullet = false;
    let hasTurboBoost = false;
    let hasVampiricShot = false;
    let hasMagneticBullets = false;
    let blindBulletStacks = 0;
    let curseResistStacks = 0;
    let picksPerRound = 1;
    const customPerkHooks = [];

    const ammoPerStack = (turretConfig.id === 'heavy' || turretConfig.id === 'sniper')
      ? 1
      : (turretConfig.id === 'rapid' ? 3 : 2);

    for (const perkId of this.acquiredPerks) {
      if (perkId === 'hp_plus_10') bonusMaxHp += 10;
      else if (perkId === 'speed_plus_01') bonusSpeed = +(bonusSpeed + 0.1).toFixed(2);
      else if (perkId === 'fov_plus_10') bonusFov += 10;
      else if (perkId === 'ammo_plus') bonusClipSize += ammoPerStack;
      else if (perkId === 'reload_minus_02') bonusReloadReduction += 200;
      else if (perkId === 'fire_rate_plus_02') bonusFireRate = +(bonusFireRate + 0.2).toFixed(2);
      else if (perkId === 'curse_chance_minus_25') curseResistStacks = Math.min(2, curseResistStacks + 1);
      else if (perkId === 'blind_bullet_chance') blindBulletStacks = Math.min(10, blindBulletStacks + 1);
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
      else if (perkId === 'shrink_tank_20') hasShrinkTank20 = true;
      else if (perkId === 'beacon_heal') beaconStacks += 1;
      else if (perkId === 'turbo_boost') hasTurboBoost = true;
      else if (perkId === 'spread_minus_05') bonusSpreadHalfAngle = +(bonusSpreadHalfAngle - 0.5).toFixed(2);
      else if (perkId === 'mines_plus_3') maxMines += 3;
      else if (perkId === 'armor_plus_15') bonusArmor = +(bonusArmor + 0.15).toFixed(2);
      else if (perkId === 'water_camouflage') hasWaterCamo = true;
      else if (perkId === 'smoke_screen') hasSmokeScreen = true;
      else if (perkId === 'artillery_strike') hasArtillery = true;
      else if (perkId === 'spot_enemy_10s') hasSpotEnemy = true;
      else if (perkId === 'guided_bullet') hasGuidedBullet = true;
      else if (perkId === 'magnetic_bullets') hasMagneticBullets = true;
      else if (perkId === 'vampiric_shot') hasVampiricShot = true;
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

    // Підрахунок штрафів від отриманих проклять (acquiredCurses)
    let hasCurseSizePlus10 = false;
    for (const curseId of this.acquiredCurses) {
      if (curseId === 'curse_size_plus_10') hasCurseSizePlus10 = true;
      else if (curseId === 'curse_speed_minus_01') bonusSpeed = +(bonusSpeed - 0.2).toFixed(2);
      else if (curseId === 'curse_fov_minus_10') bonusFov -= 10;
      else if (curseId === 'curse_hp_minus_10') bonusMaxHp -= 10;
      else if (curseId === 'curse_fire_rate_minus_015') bonusFireRate = +(bonusFireRate - 0.15).toFixed(2);
      else if (curseId === 'curse_armor_minus_5') bonusArmor = +(bonusArmor - 0.05).toFixed(2);
      else if (curseId === 'curse_spread_plus_05') bonusSpreadHalfAngle = +(bonusSpreadHalfAngle + 0.5).toFixed(2);
    }

    // Масштабування фізичного та візуального розміру танка (-50% для Малюка, -20% від shrink_tank_20, +10% від curse_size_plus_10)
    let sizeScale = typeof hullConfig.baseSizeScale === 'number' ? hullConfig.baseSizeScale : 1.0;
    if (!hullConfig.blockSizePerks) {
      if (hasShrinkTank20) sizeScale -= 0.20;
      if (hasCurseSizePlus10) sizeScale += 0.10;
    }
    this.sizeScale = +sizeScale.toFixed(2);
    this.hasShrinkTank20 = Boolean(!hullConfig.blockSizePerks && hasShrinkTank20);
    this.hasCurseSizePlus10 = Boolean(!hullConfig.blockSizePerks && hasCurseSizePlus10);
    this.blockSizePerks = Boolean(hullConfig.blockSizePerks);
    const baseTankSize = this.baseSize || 26;
    this.size = Math.max(8, Math.round(baseTankSize * this.sizeScale));

    // Характеристики корпусу + бонуси (максимальна можлива швидкість = MAX_TANK_SPEED = 5)
    this.unpierceableArmor = Boolean(hullConfig.unpierceableArmor);
    this.blockHpAndArmorPerks = Boolean(hullConfig.blockHpAndArmorPerks);
    this.seeInLowBush = seeInLowBush || Boolean(hullConfig.seeInLowBush);
    this.camoInLowBush = Boolean(hullConfig.camoInLowBush);
    this.camoInLowBushAndShallowWater = camoInLowBushAndShallowWater;
    this.coverArmorBonus = coverArmorBonus;
    this.curseResistStacks = curseResistStacks;
    this.curseChanceReduction = +(curseResistStacks * 0.05).toFixed(3);

    if (hullConfig.blockHpAndArmorPerks) {
      this.maxHp = hullConfig.maxHp; // Строго 1 HP
      this.hp = (!hadHp || prevHull !== hullConfig.id || (typeof prevMaxHp === 'number' && this.hp >= prevMaxHp))
        ? this.maxHp
        : Math.min(this.hp, this.maxHp);
      this.armor = typeof hullConfig.armor === 'number' ? hullConfig.armor : 0.95;
    } else {
      let comebackHp = 0;
      if (hullConfig.id === 'wooden') {
        const roundsLost = (typeof customRoundsLost === 'number')
          ? customRoundsLost
          : (typeof this.roundsLost === 'number'
            ? this.roundsLost
            : 0);
        comebackHp = roundsLost * (hullConfig.lostRoundHpBonus || 10);
      }
      this.maxHp = Math.max(10, hullConfig.maxHp + bonusMaxHp + comebackHp);
      if (!hadHp || prevHull !== hullConfig.id || (typeof prevMaxHp === 'number' && this.hp >= prevMaxHp)) {
        this.hp = this.maxHp;
      } else {
        this.hp = Math.min(this.hp, this.maxHp);
      }
      const defaultArmorByHull = hullConfig.id === 'heavy' ? 0.30 : (hullConfig.id === 'light' ? 0.10 : (hullConfig.id === 'baby' ? 0.05 : (hullConfig.id === 'wooden' ? 0.0 : 0.20)));
      const baseArmor = typeof hullConfig.armor === 'number' ? hullConfig.armor : defaultArmorByHull;
      this.armor = Math.max(0, Math.min(0.90, +(baseArmor + bonusArmor).toFixed(2)));
    }
    this.speed = Math.max(0.4, Math.min(MAX_TANK_SPEED, +(hullConfig.speed + bonusSpeed).toFixed(2)));
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
    this.isTracer = Boolean(turretConfig.isTracer);
    if (this.turretType !== 'sniper') {
      this.sniperStealthTimer = 0;
    }

    const baseFireRate = 1000 / (turretConfig.reloadTime || 650);
    const effectiveFireRate = Math.max(0.15, +(baseFireRate + bonusFireRate).toFixed(2));
    this.fireRate = effectiveFireRate;
    this.reloadTime = Math.abs(bonusFireRate) > 0.001
      ? Math.max(50, Math.round(1000 / effectiveFireRate))
      : turretConfig.reloadTime;
    const baseClipSize = turretConfig.clipSize || (turretConfig.id === 'heavy' || turretConfig.id === 'sniper' ? 5 : (turretConfig.id === 'rapid' ? 15 : 10));
    const baseClipReloadTime = turretConfig.clipReloadTime || (turretConfig.id === 'heavy' ? 2000 : (turretConfig.id === 'rapid' || turretConfig.id === 'sniper' ? 4000 : 3000));

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

    this.fixedFov = Boolean(turretConfig.fixedFov);
    this.fov = this.fixedFov
      ? (turretConfig.fov || 35)
      : Math.max(15, Math.min(360, (turretConfig.fov || 90) + bonusFov));
    this.fovDeg = this.fov;

    this.noSpread = Boolean(turretConfig.noSpread);
    const baseSpreadHalf = typeof turretConfig.spreadHalfAngleDeg === 'number' ? turretConfig.spreadHalfAngleDeg : 2.5;
    this.spreadHalfAngleDeg = this.noSpread
      ? 0
      : Math.max(0, +(baseSpreadHalf + bonusSpreadHalfAngle).toFixed(2));
    this.spreadDeg = +(this.spreadHalfAngleDeg * 2).toFixed(2);

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
    this.beaconStacks = beaconStacks;
    this.beaconHealStacks = beaconStacks;
    this.hasBeaconHeal = beaconStacks > 0;
    this.hasSpotEnemy = hasSpotEnemy;
    this.hasGuidedBullet = hasGuidedBullet;
    if (!hasGuidedBullet) {
      this.guidedBulletArmed = false;
      this.guidedBulletActive = false;
    }
    this.hasTurboBoost = hasTurboBoost;
    if (!hasTurboBoost) {
      this.turboActiveTimer = 0;
      this.turboCooldownTimer = 0;
    }
    this.blindBulletStacks = blindBulletStacks;
    this.blindBulletChance = +(blindBulletStacks * 0.02).toFixed(2);
    this.blindChance = this.blindBulletChance;
    this.hasVampiricShot = hasVampiricShot;
    this.hasMagneticBullets = hasMagneticBullets;
    this.picksPerRound = picksPerRound;

    this.ensureValidSelectedActive();

    for (const fn of customPerkHooks) {
      fn(this);
    }
  }

  /**
   * Список доступних активних здібностей на ПРОБІЛ ('mines', 'smoke', 'artillery', 'beacon', 'radar', 'guided', 'turbo')
   */
  getAvailableActives() {
    const list = [];
    if ((this.maxMines || 0) > 0) list.push('mines');
    if (this.hasSmokeScreen) list.push('smoke');
    if (this.hasArtillery) list.push('artillery');
    if (this.hasBeaconHeal) list.push('beacon');
    if (this.hasSpotEnemy) list.push('radar');
    if (this.hasGuidedBullet) list.push('guided');
    if (this.hasTurboBoost) list.push('turbo');
    return list;
  }

  /**
   * Забезпечення коректно обраної активної здібності на ПРОБІЛ
   */
  getEffectiveCurseChance() {
    return Math.max(0, +(BASE_CURSE_CHANCE - (this.curseChanceReduction || 0)).toFixed(3));
  }

  getEffectiveSpeed() {
    const mult = (this.turboActiveTimer || 0) > 0 ? 1.5 : 1;
    return Math.min(MAX_TANK_SPEED, +(this.speed * mult).toFixed(2));
  }

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
   * Прямий вибір активної здібності на ПРОБІЛ ('mines', 'smoke', 'artillery', 'beacon', 'radar', 'guided', 'turbo')
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
    return (this.smokeCooldownTimer || 0) <= 0 && (this.smokeActiveTimer || 0) <= 0;
  }

  /**
   * Активація димової завіси (5 секунд дії = 300 кадрів, після чого перезарядка 30 секунд = 1800 кадрів)
   */
  triggerSmoke() {
    if (!this.canUseSmoke()) return false;
    this.smokeActiveTimer = 300;
    this.smokeCooldownTimer = 0;
    return true;
  }

  /**
   * Перевірка готовності артилерійського удару (artillery_strike)
   */
  canUseArtillery() {
    if (this.isDead) return false;
    if (!this.hasArtillery) return false;
    return (this.artilleryCooldownTimer || 0) <= 0 && (this.artilleryPendingTimer || 0) <= 0;
  }

  /**
   * Запуск 1-секундного очікування перед ударом артилерії після кліку ЛКМ по блоку (60 кадрів)
   */
  triggerArtilleryPending() {
    if (!this.canUseArtillery()) return false;
    this.artilleryPendingTimer = 60;
    this.artilleryCooldownTimer = 0;
    this.targetingMode = null;
    return true;
  }

  /**
   * Завершення артилерійського удару і старт перезарядки (35 секунд = 2100 кадрів при 60 FPS)
   */
  triggerArtillery() {
    if (!this.hasArtillery) return false;
    this.artilleryPendingTimer = 0;
    this.artilleryCooldownTimer = 2100;
    this.targetingMode = null;
    return true;
  }

  /**
   * Перевірка готовності Маяка Регенерації (beacon_heal)
   */
  canUseBeacon() {
    if (this.isDead) return false;
    if (!this.hasBeaconHeal || (this.beaconStacks || 0) <= 0) return false;
    return (this.beaconCooldownTimer || 0) <= 0 && (this.beaconActiveTimer || 0) <= 0;
  }

  /**
   * Активація Маяка Регенерації (7 секунд дії = 420 кадрів, після чого КД 20 секунд = 1200 кадрів)
   */
  triggerBeacon() {
    if (!this.canUseBeacon()) return false;
    this.beaconActiveTimer = 420;
    this.beaconHealTickTimer = 0;
    this.beaconCooldownTimer = 0;
    return true;
  }

  /**
   * Перевірка готовності Радара Розвідки (spot_enemy_10s)
   */
  canUseSpotEnemy() {
    if (this.isDead) return false;
    if (!this.hasSpotEnemy) return false;
    return (this.spotCooldownTimer || 0) <= 0 && (this.spotActiveTimer || 0) <= 0;
  }

  /**
   * Активація Радара Розвідки (10 секунд дії = 600 кадрів, після чого КД 40 секунд = 2400 кадрів)
   */
  triggerSpotEnemy() {
    if (!this.canUseSpotEnemy()) return false;
    this.spotActiveTimer = 600;
    this.spotCooldownTimer = 0;
    return true;
  }

  /**
   * Перевірка готовності Керованого Снаряда (guided_bullet)
   */
  canUseGuidedBullet() {
    if (this.isDead) return false;
    if (!this.hasGuidedBullet) return false;
    return (this.guidedCooldownTimer || 0) <= 0 && !this.guidedBulletActive;
  }

  /**
   * Увімкнення/вимкнення режиму керованого снаряда для наступного пострілу ЛКМ
   */
  toggleGuidedBulletArm() {
    if (this.isDead || !this.canUseGuidedBullet()) {
      this.guidedBulletArmed = false;
      return false;
    }
    this.guidedBulletArmed = !this.guidedBulletArmed;
    return this.guidedBulletArmed;
  }

  /**
   * Споживання бафу керованого снаряда при пострілі ЛКМ (КД 45 секунд = 2700 кадрів почнеться після знищення кулі)
   */
  consumeGuidedBulletOnShot() {
    if (!this.guidedBulletArmed || !this.canUseGuidedBullet()) return false;
    this.guidedBulletArmed = false;
    this.guidedBulletActive = true;
    this.guidedCooldownTimer = 0;
    return true;
  }

  /**
   * Коли керована куля знищується (влучає в стіну/ворога/кулю або вилітає за межі), починається КД 45 секунд (2700 кадрів)
   */
  onGuidedBulletDestroyed() {
    if (this.guidedBulletActive) {
      this.guidedBulletActive = false;
      this.guidedCooldownTimer = 2700;
    }
  }

  /**
   * Перевірка готовності Турбо-прискорення (turbo_boost)
   */
  canUseTurbo() {
    if (this.isDead) return false;
    if (!this.hasTurboBoost) return false;
    return (this.turboCooldownTimer || 0) <= 0 && (this.turboActiveTimer || 0) <= 0;
  }

  /**
   * Активація Турбо (+50% швидкості на 5 секунд = 300 кадрів, після чого КД 25 секунд = 1500 кадрів)
   */
  triggerTurbo() {
    if (!this.canUseTurbo()) return false;
    this.turboActiveTimer = 240; // 4 секунди при 60 FPS
    this.turboCooldownTimer = 0;
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
    const turretConfig = TURRET_TYPES[this.turretType] || TURRET_TYPES.standard;
    if (hullConfig && hullConfig.blockHpAndArmorPerks && PHANTOM_FORBIDDEN_PERKS.includes(perkId)) {
      return false;
    }
    if (hullConfig && hullConfig.blockSizePerks && BABY_FORBIDDEN_PERKS.includes(perkId)) {
      return false;
    }
    if (turretConfig && (turretConfig.fixedFov || turretConfig.noSpread) && SNIPER_FORBIDDEN_PERKS.includes(perkId)) {
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
      this.smokeActiveTimer = 0;
      this.ensureValidSelectedActive();
    }
    if (perkId === 'artillery_strike') {
      this.artilleryCooldownTimer = 0;
      this.artilleryPendingTimer = 0;
      this.ensureValidSelectedActive();
    }
    if (perkId === 'beacon_heal') {
      this.beaconCooldownTimer = 0;
      this.ensureValidSelectedActive();
    }
    if (perkId === 'spot_enemy_10s') {
      this.spotCooldownTimer = 0;
      this.spotActiveTimer = 0;
      this.ensureValidSelectedActive();
    }
    if (perkId === 'guided_bullet') {
      this.guidedCooldownTimer = 0;
      this.guidedBulletActive = false;
      this.ensureValidSelectedActive();
    }
    if (perkId === 'turbo_boost') {
      this.turboCooldownTimer = 0;
      this.turboActiveTimer = 0;
      this.ensureValidSelectedActive();
    }
    return true;
  }

  /**
   * Накладання прокляття (Curse) на танк
   */
  applyCurse(curseId) {
    if (!curseId || !CURSE_TYPES[curseId]) return false;
    const hullConfig = HULL_TYPES[this.hullType] || HULL_TYPES.standard;
    const turretConfig = TURRET_TYPES[this.turretType] || TURRET_TYPES.standard;
    if (hullConfig && hullConfig.blockHpAndArmorPerks && PHANTOM_FORBIDDEN_CURSES.includes(curseId)) {
      return false;
    }
    if (hullConfig && hullConfig.blockSizePerks && BABY_FORBIDDEN_CURSES.includes(curseId)) {
      return false;
    }
    if (turretConfig && (turretConfig.fixedFov || turretConfig.noSpread) && SNIPER_FORBIDDEN_CURSES.includes(curseId)) {
      return false;
    }
    const curseDef = CURSE_TYPES[curseId];
    if (!Array.isArray(this.acquiredCurses)) this.acquiredCurses = [];
    const currentCount = this.acquiredCurses.filter(id => id === curseId).length;
    if (!curseDef.stackable && currentCount >= 1) {
      return false;
    }

    this.acquiredCurses.push(curseId);
    this.applyLoadout(this.hullType, this.turretType);
    this.hp = Math.min(this.hp, this.maxHp);
    return true;
  }

  /**
   * Видалення 1 стаку прокляття (для Зони тестування / Полігону)
   */
  removeCurse(curseId) {
    if (!curseId || !Array.isArray(this.acquiredCurses)) return false;
    const idx = this.acquiredCurses.lastIndexOf(curseId);
    if (idx === -1) return false;

    this.acquiredCurses.splice(idx, 1);
    const prevMaxHp = this.maxHp;
    this.applyLoadout(this.hullType, this.turretType);
    if (this.maxHp > prevMaxHp) {
      this.hp = Math.min(this.maxHp, this.hp + (this.maxHp - prevMaxHp));
    } else {
      this.hp = Math.min(this.hp, this.maxHp);
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
      this.smokeActiveTimer = 0;
    }
    if (!this.hasArtillery) {
      this.artilleryCooldownTimer = 0;
      this.artilleryPendingTimer = 0;
      if (this.targetingMode === 'artillery') {
        this.targetingMode = null;
      }
    }
    if (!this.hasBeaconHeal) {
      this.beaconCooldownTimer = 0;
      this.beaconActiveTimer = 0;
      this.beaconHealTickTimer = 0;
    }
    if (!this.hasSpotEnemy) {
      this.spotCooldownTimer = 0;
      this.spotActiveTimer = 0;
    }
    if (!this.hasGuidedBullet) {
      this.guidedCooldownTimer = 0;
      this.guidedBulletArmed = false;
      this.guidedBulletActive = false;
    }
    if (!this.hasTurboBoost) {
      this.turboCooldownTimer = 0;
      this.turboActiveTimer = 0;
    }
    if (this.localSelectedActive && !this.getAvailableActives().includes(this.localSelectedActive)) {
      this.localSelectedActive = null;
    }
    this.ensureValidSelectedActive();
    return true;
  }

  /**
   * Повне скидання всіх накопичених бонусів та проклять (викликається при натисканні «Реванш» або «Скинути» на полігоні)
   */
  resetPerks() {
    this.acquiredPerks = [];
    this.acquiredCurses = [];
    this.regenTimer = 0;
    this.proximityTimer = 0;
    this.lingerTimer = 0;
    this.smokeCooldownTimer = 0;
    this.smokeActiveTimer = 0;
    this.artilleryCooldownTimer = 0;
    this.artilleryPendingTimer = 0;
    this.targetingMode = null;
    this.beaconCooldownTimer = 0;
    this.beaconActiveTimer = 0;
    this.beaconHealTickTimer = 0;
    this.spotCooldownTimer = 0;
    this.spotActiveTimer = 0;
    this.guidedCooldownTimer = 0;
    this.guidedBulletArmed = false;
    this.guidedBulletActive = false;
    this.turboCooldownTimer = 0;
    this.turboActiveTimer = 0;
    this.sniperStealthTimer = 0;
    this.blindTimer = 0;
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
   * Перевірка, чи знаходиться танк у кущах (високих/низьких) або у воді (мілкій/глибокій)
   * Використовується для пасивки Важкого корпусу (+10% броні в укритті/воді)
   */
  isInCoverOrWater(map, bushes, tileSize, envOptions = null) {
    if (!tileSize) return false;
    const cx = this.x + this.size / 2;
    const cy = this.y + this.size / 2;
    const c = Math.floor(cx / tileSize);
    const r = Math.floor(cy / tileSize);
    const gs = envOptions?.gameState || envOptions;
    if (r < 0 || c < 0) return false;
    if (isCellEffectiveHighBush(r, c, gs)) return true;
    if (map && r < map.length && map[r] && c < map[r].length) {
      const tileId = getEffectiveTileId(map[r][c], gs);
      if (tileId === 9 || tileId === 8 || tileId === 3) return true;
    }
    return false;
  }

  /**
   * Отримання ефективної броні танка з урахуванням пасивки Важкого корпусу (+10% у кущах та воді)
   */
  getEffectiveArmor(map = null, bushes = null, tileSize = 18, envOptions = null) {
    const hullConfig = HULL_TYPES[this.hullType] || HULL_TYPES.standard;
    let eff = typeof this.armor === 'number' ? this.armor : ((hullConfig && hullConfig.armor) || 0.20);
    if ((this.coverArmorBonus || 0) > 0 && this.isInCoverOrWater(map, bushes, tileSize, envOptions)) {
      eff += this.coverArmorBonus;
    }
    return Math.max(0, Math.min(0.99, eff));
  }

  /**
   * Перевірка, чи знаходиться танк на клітинці мілкої (id === 8) або глибокої (id === 3) води
   */
  isOnShallowWater(map, tileSize, envOptions = null) {
    if (!map || !map.length || !tileSize) return false;
    const cx = this.x + this.size / 2;
    const cy = this.y + this.size / 2;
    const c = Math.floor(cx / tileSize);
    const r = Math.floor(cy / tileSize);
    const gs = envOptions?.gameState || envOptions;
    if (r >= 0 && r < map.length && c >= 0 && c < map[0].length) {
      if (gs?.currentMapEvent === 'shuffled_blocks') {
        const effTile = getEffectiveCellTile(r, c, gs);
        return effTile.id === 8 || effTile.id === 3;
      }
      const tileId = map[r][c];
      return tileId === 8 || tileId === 3;
    }
    return false;
  }

  /**
   * Перевірка, чи знаходиться танк на клітинці глибокої води (id === 3)
   */
  isOnDeepWater(map, tileSize, envOptions = null) {
    if (!map || !map.length || !tileSize) return false;
    const cx = this.x + this.size / 2;
    const cy = this.y + this.size / 2;
    const c = Math.floor(cx / tileSize);
    const r = Math.floor(cy / tileSize);
    const gs = envOptions?.gameState || envOptions;
    if (r >= 0 && r < map.length && c >= 0 && c < map[0].length) {
      if (gs?.currentMapEvent === 'shuffled_blocks') {
        const effTile = getEffectiveCellTile(r, c, gs);
        return effTile.id === 3;
      }
      const tileId = map[r][c];
      return tileId === 3;
    }
    return false;
  }

  /**
   * Перевірка, чи знаходиться танк на клітинці снігу (id: 14 або діє подія snow_storm на вільній землі)
   */
  isOnSnow(map, tileSize, currentMapEvent = null, envOptions = null) {
    if (!tileSize) return false;
    const cx = this.x + this.size / 2;
    const cy = this.y + this.size / 2;
    const c = Math.floor(cx / tileSize);
    const r = Math.floor(cy / tileSize);
    const gs = envOptions?.gameState || envOptions;
    const eventName = currentMapEvent || gs?.currentMapEvent || null;
    if (map && r >= 0 && r < map.length && map[r] && c >= 0 && c < map[r].length) {
      if (eventName === 'shuffled_blocks') {
        const effTile = getEffectiveCellTile(r, c, gs);
        return effTile.id === 14;
      }
      const tileId = map[r][c];
      if (tileId === 14) return true;
      if (eventName === 'snow_storm') {
        // Під час снігопаду вся підлога/трава/каміння (окрім стін 1, 2, 5, 6 та води 3, 8) є снігом
        const isWall = tileId === 1 || tileId === 2 || tileId === 5 || tileId === 6;
        const isWater = tileId === 3 || tileId === 8;
        if (!isWall && !isWater) return true;
      }
    }
    return false;
  }

  /**
   * Перевірка, чи знаходиться танк на клітинці льоду (шар iceGrid[r][c] === 1, map[r][c] === 10 або вода під час snow_storm)
   */
  isOnIce(map, tileSize, iceGrid = null, currentMapEvent = null, envOptions = null) {
    if (!tileSize) return false;
    const cx = this.x + this.size / 2;
    const cy = this.y + this.size / 2;
    const c = Math.floor(cx / tileSize);
    const r = Math.floor(cy / tileSize);
    const gs = envOptions?.gameState || envOptions;
    const eventName = currentMapEvent || gs?.currentMapEvent || null;

    if (eventName === 'shuffled_blocks') {
      const effTile = getEffectiveCellTile(r, c, gs);
      return effTile.id === 10;
    }

    if (iceGrid && r >= 0 && r < iceGrid.length && iceGrid[r] && c >= 0 && c < iceGrid[r].length) {
      if (iceGrid[r][c] === 1) return true;
    }
    if (map && r >= 0 && r < map.length && map[r] && c >= 0 && c < map[r].length) {
      const tileId = map[r][c];
      if (tileId === 10) return true;
      // Під час снігопаду мілка та глибока вода стає льодом!
      if (eventName === 'snow_storm' && (tileId === 3 || tileId === 8)) {
        return true;
      }
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
    const curMapEvent = envOptions?.gameState?.currentMapEvent || envOptions?.currentMapEvent || null;
    const isSnowStorm = curMapEvent === 'snow_storm';

    // Якщо діє снігопад — вода замерзла в лід і НЕ сповільнює як вода
    const onDeepWater = !isSnowStorm && this.isOnDeepWater(map, tileSize, envOptions);
    const slowedByWater = onDeepWater || (!isSnowStorm && !this.ignoreShallowWater && this.isOnShallowWater(map, tileSize, envOptions));
    let currentMoveSpeed = slowedByWater ? (this.speed * 0.5) : this.speed;

    // Сповільнення на снігу на 10% (множник 0.90)
    const onSnow = this.isOnSnow(map, tileSize, curMapEvent, envOptions);
    if (onSnow) {
      currentMoveSpeed *= 0.90;
    }

    // Якщо активне Турбо-прискорення (turbo_boost) — швидкість збільшується на +50%
    if ((this.turboActiveTimer || 0) > 0) {
      currentMoveSpeed *= 1.5;
    }

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

    // Перевірка інерції на льоду (вкл. замерзлу воду під час снігопаду, якщо немає перка no_ice_slide)
    const iceGrid = envOptions && envOptions.iceGrid ? envOptions.iceGrid : null;
    const onIce = !this.noIceSlide && this.isOnIce(map, tileSize, iceGrid, curMapEvent, envOptions);

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

    // Оптичний камуфляж башти «Снайпер»: через 1с (60 кадрів) стояння корпусу стає невидимим.
    // Поворот башти та стрільба НЕ скидають таймер! Рух/поворот корпусу миттєво скидає таймер.
    if (this.turretType === 'sniper') {
      if (this.isMoving) {
        this.sniperStealthTimer = 0;
      } else {
        this.sniperStealthTimer = (this.sniperStealthTimer || 0) + 1;
      }
    } else {
      this.sniperStealthTimer = 0;
    }

    // 4. Плавна обробка колізій зі слайдингом (ковзанням вздовж стін)
    if (isSlidingOrDriving) {
      const pad = 2;
      const boxSize = Math.max(4, this.size - pad * 2);

      const checkTankColl = (tx, ty) => {
        if (!otherTank) return false;
        if (Array.isArray(otherTank)) {
          return otherTank.some(t => t && t !== this && !t.isDead && checkTankCollision(this, t, tx, ty));
        }
        return !otherTank.isDead && checkTankCollision(this, otherTank, tx, ty);
      };

      // Спроба повного руху
      let testX = Math.max(0, Math.min(canvasWidth - this.size, this.x + moveX));
      let testY = Math.max(0, Math.min(canvasHeight - this.size, this.y + moveY));

      const collFull = checkMapCollision(testX + pad, testY + pad, boxSize, boxSize, map, this) || checkTankColl(testX, testY);

      if (!collFull) {
        this.x = testX;
        this.y = testY;
      } else {
        // Слайдинг по осі X
        testX = Math.max(0, Math.min(canvasWidth - this.size, this.x + moveX));
        const collX = checkMapCollision(testX + pad, this.y + pad, boxSize, boxSize, map, this) || checkTankColl(testX, this.y);
        if (!collX && moveX !== 0) {
          this.x = testX;
        } else if (onIce) {
          this.vx = 0;
        }

        // Слайдинг по осі Y
        testY = Math.max(0, Math.min(canvasHeight - this.size, this.y + moveY));
        const collY = checkMapCollision(this.x + pad, testY + pad, boxSize, boxSize, map, this) || checkTankColl(this.x, testY);
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

    // Коли відстріляно всі снаряди касети (5 для важкого/снайпера, 10 для середнього/рикошету, 15 для швидкісного) —
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
    } else if (this.turretType === 'sniper') {
      gunLen = Math.max(12, Math.floor(this.size * 0.88));
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
    this.applyLoadout(this.hullType, this.turretType);
    this.hp = this.maxHp;
    this.isOnAcid = false;
    this.acidTimer = 0;
    this.woodenBushRegenTimer = 0;
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
    this.smokeActiveTimer = 0;
    this.artilleryCooldownTimer = 0;
    this.artilleryPendingTimer = 0;
    this.targetingMode = null;
    this.beaconCooldownTimer = 0;
    this.beaconActiveTimer = 0;
    this.beaconHealTickTimer = 0;
    this.spotCooldownTimer = 0;
    this.spotActiveTimer = 0;
    this.guidedCooldownTimer = 0;
    this.guidedBulletArmed = false;
    this.guidedBulletActive = false;
    this.turboCooldownTimer = 0;
    this.turboActiveTimer = 0;
    this.sniperStealthTimer = 0;
    this.blindTimer = 0;
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
    this.beaconActiveTimer = 0;
    this.beaconHealTickTimer = 0;
    this.guidedBulletArmed = false;
    this.turboActiveTimer = 0;
    this.sniperStealthTimer = 0;
    this.blindTimer = 0;
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
    const incomingCurses = Array.isArray(data.curses) ? data.curses : (Array.isArray(data.acquiredCurses) ? data.acquiredCurses : null);
    let needLoadoutUpdate = false;

    if (incomingPerks) {
      const samePerks = this.acquiredPerks.length === incomingPerks.length &&
        this.acquiredPerks.every((p, idx) => p === incomingPerks[idx]);
      if (!samePerks) {
        this.acquiredPerks = [...incomingPerks];
        needLoadoutUpdate = true;
      }
    }
    if (incomingCurses) {
      if (!Array.isArray(this.acquiredCurses)) this.acquiredCurses = [];
      const sameCurses = this.acquiredCurses.length === incomingCurses.length &&
        this.acquiredCurses.every((c, idx) => c === incomingCurses[idx]);
      if (!sameCurses) {
        this.acquiredCurses = [...incomingCurses];
        needLoadoutUpdate = true;
      }
    }
    if ((data.hull && data.hull !== this.hullType) || (data.turret && data.turret !== this.turretType)) {
      needLoadoutUpdate = true;
    }
    if (needLoadoutUpdate) {
      this.applyLoadout(data.hull || this.hullType, data.turret || this.turretType);
    }
    if (typeof data.size === 'number' && data.size > 0) {
      this.size = data.size;
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
    if (typeof data.spreadHalfAngleDeg === 'number') {
      this.spreadHalfAngleDeg = data.spreadHalfAngleDeg;
      this.spreadDeg = +(data.spreadHalfAngleDeg * 2).toFixed(2);
    }
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
    if (typeof data.smokeActiveTimer === 'number') {
      this.smokeActiveTimer = data.smokeActiveTimer;
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
    if (typeof data.artilleryPendingTimer === 'number') {
      this.artilleryPendingTimer = data.artilleryPendingTimer;
    }
    if (typeof data.hasBeaconHeal === 'boolean') {
      this.hasBeaconHeal = data.hasBeaconHeal;
    }
    if (typeof data.beaconStacks === 'number') {
      this.beaconStacks = data.beaconStacks;
      this.beaconHealStacks = data.beaconStacks;
    } else if (typeof data.beaconHealStacks === 'number') {
      this.beaconStacks = data.beaconHealStacks;
      this.beaconHealStacks = data.beaconHealStacks;
    }
    if (typeof data.beaconCooldownTimer === 'number') {
      const recentlyTriggeredBeacon =
        this.lastBeaconLocalTriggerTime && (Date.now() - this.lastBeaconLocalTriggerTime < 600);
      if (!recentlyTriggeredBeacon || data.beaconCooldownTimer > 0) {
        this.beaconCooldownTimer = data.beaconCooldownTimer;
      }
    }
    if (typeof data.beaconActiveTimer === 'number') {
      this.beaconActiveTimer = data.beaconActiveTimer;
    }
    if (typeof data.hasSpotEnemy === 'boolean') {
      this.hasSpotEnemy = data.hasSpotEnemy;
    }
    if (typeof data.spotCooldownTimer === 'number') {
      const recentlyTriggeredSpot =
        this.lastSpotLocalTriggerTime && (Date.now() - this.lastSpotLocalTriggerTime < 600);
      if (!recentlyTriggeredSpot || data.spotCooldownTimer > 0) {
        this.spotCooldownTimer = data.spotCooldownTimer;
      }
    }
    if (typeof data.spotActiveTimer === 'number') {
      this.spotActiveTimer = data.spotActiveTimer;
    }
    if (typeof data.hasGuidedBullet === 'boolean') {
      this.hasGuidedBullet = data.hasGuidedBullet;
    }
    if (typeof data.hasVampiricShot === 'boolean') {
      this.hasVampiricShot = data.hasVampiricShot;
    }
    if (typeof data.hasMagneticBullets === 'boolean') {
      this.hasMagneticBullets = data.hasMagneticBullets;
    }
    if (typeof data.guidedCooldownTimer === 'number') {
      const recentlyTriggeredGuided =
        this.lastGuidedLocalTriggerTime && (Date.now() - this.lastGuidedLocalTriggerTime < 600);
      if (!recentlyTriggeredGuided || data.guidedCooldownTimer > 0) {
        this.guidedCooldownTimer = data.guidedCooldownTimer;
      }
    }
    if (typeof data.guidedBulletArmed === 'boolean') {
      const recentlyTriggeredGuided =
        this.lastGuidedLocalTriggerTime && (Date.now() - this.lastGuidedLocalTriggerTime < 600);
      if (!recentlyTriggeredGuided) {
        this.guidedBulletArmed = data.guidedBulletArmed;
      }
    }
    if (typeof data.guidedBulletActive === 'boolean') {
      this.guidedBulletActive = data.guidedBulletActive;
    }
    if (typeof data.hasTurboBoost === 'boolean') {
      this.hasTurboBoost = data.hasTurboBoost;
    }
    if (typeof data.turboCooldownTimer === 'number') {
      const recentlyTriggeredTurbo =
        this.lastTurboLocalTriggerTime && (Date.now() - this.lastTurboLocalTriggerTime < 600);
      if (!recentlyTriggeredTurbo || data.turboCooldownTimer > 0) {
        this.turboCooldownTimer = data.turboCooldownTimer;
      }
    }
    if (typeof data.turboActiveTimer === 'number') {
      this.turboActiveTimer = data.turboActiveTimer;
    }
    if (typeof data.sniperStealthTimer === 'number') {
      this.sniperStealthTimer = data.sniperStealthTimer;
    }
    if (typeof data.blindTimer === 'number') {
      this.blindTimer = Math.max(this.blindTimer || 0, data.blindTimer);
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
 * Клас снаряда зі швидкістю за вектором turretAngle, шкодою, пробиттям ворожих куль, рикошетами, ігноруванням броні та керованим наведенням
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
   * @param {Object} options - додаткові властивості { pierceLeft, ricochetsLeft, ignoreArmor, instantBreak, invisibleToEnemy, isGuided, isTracer, speed }
   */
  constructor(ownerId, x, y, vx, vy, damage = 20, angle = 0, options = {}) {
    this.ownerId = ownerId;
    this.team = Number(options.team) || ownerId;
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
    this.isGuided = Boolean(options.isGuided);
    this.isTracer = Boolean(options.isTracer);
    this.blindsOnHit = Boolean(options.blindsOnHit);
    this.healsOnHit = Boolean(options.healsOnHit);
    this.isMagnetic = Boolean(options.isMagnetic);
    this.speed = typeof options.speed === 'number' && options.speed > 0 ? options.speed : Math.hypot(vx, vy) || 4;
    this.w = 6;
    this.h = 6;
    this.trail = [];
  }

  update(targetX = null, targetY = null, enemyTank = null) {
    if (this.isGuided && Number.isFinite(targetX) && Number.isFinite(targetY)) {
      const dist = Math.hypot(targetX - this.x, targetY - this.y);
      if (dist > 4) {
        const desiredAngle = Math.atan2(targetY - this.y, targetX - this.x);
        const diff = Math.atan2(Math.sin(desiredAngle - this.angle), Math.cos(desiredAngle - this.angle));
        const turnRate = 0.14;
        if (Math.abs(diff) <= turnRate) {
          this.angle = desiredAngle;
        } else {
          this.angle += Math.sign(diff) * turnRate;
        }
        this.angle = Math.atan2(Math.sin(this.angle), Math.cos(this.angle));
        this.vx = Math.cos(this.angle) * this.speed;
        this.vy = Math.sin(this.angle) * this.speed;
      }
    } else if (this.isMagnetic && !this.isGuided && enemyTank && !enemyTank.isDead) {
      const enemyCx = enemyTank.x + (enemyTank.size || 40) / 2;
      const enemyCy = enemyTank.y + (enemyTank.size || 40) / 2;
      const dist = Math.hypot(enemyCx - this.x, enemyCy - this.y);
      // Магнітне відхилення діє, якщо ворог попереду та у зоні дії (до ~140px)
      if (dist < 140 && dist > 6) {
        const desiredAngle = Math.atan2(enemyCy - this.y, enemyCx - this.x);
        const diff = Math.atan2(Math.sin(desiredAngle - this.angle), Math.cos(desiredAngle - this.angle));
        // Тільки якщо ворог знаходиться у передній півсфері польоту (не розвертатися назад)
        if (Math.cos(diff) > 0.15) {
          const turnRate = 0.018; // Плавне магнітне відхилення траєкторії в бік ворога
          if (Math.abs(diff) <= turnRate) {
            this.angle = desiredAngle;
          } else {
            this.angle += Math.sign(diff) * turnRate;
          }
          this.angle = Math.atan2(Math.sin(this.angle), Math.cos(this.angle));
          this.vx = Math.cos(this.angle) * this.speed;
          this.vy = Math.sin(this.angle) * this.speed;
        }
      }
    }
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

    if (this.isGuided) {
      // Спеціальний ефект керованого снаряда (ракета з неоновим ореолом)
      ctx.fillStyle = this.healsOnHit ? 'rgba(46, 204, 113, 0.45)' : 'rgba(255, 0, 234, 0.35)';
      ctx.beginPath();
      ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-4, -2.5, 9, 5);
      ctx.fillStyle = this.healsOnHit ? '#2ecc71' : '#ff00ea';
      ctx.fillRect(-3, -2, 6, 4);
      ctx.fillStyle = '#00e5ff';
      ctx.fillRect(-5, -1.5, 2, 3);
      ctx.restore();
      return;
    }

    if (this.isTracer) {
      // Подовжений високошвидкісний снайперський снаряд-трасер
      ctx.fillStyle = 'rgba(255, 118, 117, 0.45)';
      ctx.fillRect(-10, -2.5, 16, 5);
      ctx.fillStyle = '#fff9c4';
      ctx.fillRect(-8, -1.5, 13, 3);
      ctx.fillStyle = '#ff7675';
      ctx.fillRect(-11, -1, 4, 2);
      ctx.restore();
      return;
    }

    if (this.isMagnetic) {
      ctx.fillStyle = 'rgba(0, 229, 255, 0.38)';
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.healsOnHit) {
      ctx.fillStyle = 'rgba(46, 204, 113, 0.45)';
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

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
  constructor(ownerId, x, y, minDmg = 40, maxDmg = 60, options = {}) {
    this.ownerId = ownerId;
    this.team = Number(options.team) || ownerId;
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

/**
 * Клас літаючої сфери для події «Аномальні сфери» (chaos_orbs):
 * - Крутиться (анімація обертання)
 * - Літає по карті, відскакує від стін та меж арени
 * - Стріляє в чотири сторони (хрестом) кожні 2 секунди (120 кадрів)
 */
export class FlyingOrb {
  constructor(x, y, vx = null, vy = null, id = 0) {
    this.id = id || Math.floor(Math.random() * 100000) + 1;
    this.x = x;
    this.y = y;
    const speed = 2.4;
    const angle = Math.random() * Math.PI * 2;
    this.vx = typeof vx === 'number' ? vx : Math.cos(angle) * speed;
    this.vy = typeof vy === 'number' ? vy : Math.sin(angle) * speed;
    this.radius = 13;
    this.rotationAngle = 0;
    this.angle = 0;
    this.shootTimer = Math.floor(Math.random() * 60); // невеликий розсинхрон на старті
    this.shootInterval = 120; // 2 секунди (120 кадрів)
  }

  update(canvasWidth, canvasHeight, map, tileSize, onShoot = null) {
    this.x += this.vx;
    this.y += this.vy;
    this.rotationAngle += 0.05;
    this.angle = this.rotationAngle;

    // 1. Відбивання від меж арени
    if (this.x - this.radius <= 0) {
      this.x = this.radius;
      this.vx = Math.abs(this.vx);
    } else if (this.x + this.radius >= canvasWidth) {
      this.x = canvasWidth - this.radius;
      this.vx = -Math.abs(this.vx);
    }
    if (this.y - this.radius <= 0) {
      this.y = this.radius;
      this.vy = Math.abs(this.vy);
    } else if (this.y + this.radius >= canvasHeight) {
      this.y = canvasHeight - this.radius;
      this.vy = -Math.abs(this.vy);
    }

    // 2. Відбивання від твердих блоків карти
    if (map && tileSize > 0) {
      const col = Math.floor(this.x / tileSize);
      const row = Math.floor(this.y / tileSize);
      const nextCol = Math.floor((this.x + Math.sign(this.vx) * (this.radius + 2)) / tileSize);
      const nextRow = Math.floor((this.y + Math.sign(this.vy) * (this.radius + 2)) / tileSize);

      if (row >= 0 && row < map.length && nextCol >= 0 && nextCol < map[0].length) {
        const tileX = map[row][nextCol];
        if (tileX === 1 || tileX === 2 || tileX === 5 || tileX === 6 || tileX === 15 || tileX === 17) {
          this.vx = -this.vx;
        }
      }
      if (nextRow >= 0 && nextRow < map.length && col >= 0 && col < map[0].length) {
        const tileY = map[nextRow][col];
        if (tileY === 1 || tileY === 2 || tileY === 5 || tileY === 6 || tileY === 15 || tileY === 17) {
          this.vy = -this.vy;
        }
      }
    }

    // 3. Стрільба в 4 сторони
    this.shootTimer++;
    if (this.shootTimer >= this.shootInterval) {
      this.shootTimer = 0;
      if (typeof onShoot === 'function') {
        onShoot(this.x, this.y, this.rotationAngle);
      }
    }
  }

  draw(ctx) {
    if (!ctx) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotationAngle);

    // Неоновий ореол навколо кулі
    const grad = ctx.createRadialGradient(0, 0, this.radius * 0.2, 0, 0, this.radius * 1.55);
    grad.addColorStop(0, 'rgba(162, 155, 254, 0.95)');
    grad.addColorStop(0.5, 'rgba(108, 92, 231, 0.65)');
    grad.addColorStop(1, 'rgba(108, 92, 231, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius * 1.55, 0, Math.PI * 2);
    ctx.fill();

    // 4 гарматні сопла (хрест під кутом rotationAngle)
    ctx.fillStyle = '#dfe6e9';
    ctx.strokeStyle = '#6c5ce7';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.save();
      ctx.rotate(a);
      ctx.fillRect(-2, this.radius - 2, 4, 6);
      ctx.strokeRect(-2, this.radius - 2, 4, 6);
      ctx.restore();
    }

    // Центральне ядро кулі
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#a29bfe';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius * 0.72, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#6c5ce7';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }
}

