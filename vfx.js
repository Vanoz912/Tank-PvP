/**
 * vfx.js — Система візуальних ефектів (VFX), частинок та тряски камери (Screen Shake)
 *
 * Відповідає за:
 * - Класи ефектів: Explosion, TreadMark, SmokeCloud, DebrisParticle, MuzzleFlash, SmokeParticle
 * - Колекції активних частинок (trackMarks, debrisParticles, muzzleFlashes, smokeParticles)
 * - Функції генерації, оновлення та очищення ефектів і тряски екрана
 */

/**
 * Клас вибуху
 */
export class Explosion {
  constructor(x, y, radius, isTank = false) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.isTank = isTank;
    this.life = 0;
    this.maxLife = isTank ? 26 : 14;
  }

  update() {
    this.life++;
    return this.life >= this.maxLife;
  }

  draw(ctx) {
    const progress = this.life / this.maxLife;
    const currentRadius = this.radius * (0.4 + 0.9 * progress);

    ctx.save();
    ctx.translate(this.x, this.y);

    if (this.isTank) {
      // Багатошаровий вибух танка
      ctx.fillStyle = (this.life % 4 < 2) ? '#ffffff' : '#f1c40f';
      ctx.beginPath();
      ctx.arc(0, 0, currentRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.arc(0, 0, currentRadius * 0.65, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#2c3e50';
      ctx.beginPath();
      ctx.arc(0, 0, currentRadius * 0.35, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = (this.life % 4 < 2) ? '#ffffff' : '#e67e22';
      ctx.beginPath();
      ctx.arc(0, 0, currentRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.arc(0, 0, currentRadius * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

/**
 * Статичний відбиток гусениці на землі (Tracks)
 * Чіткий, контрастний слід протектора та втисненої колії від гусениць танка
 */
export class TreadMark {
  constructor(x, y, angle, width = 6, length = 5.5, ownerId = 0, invisibleToEnemy = false, bonusLifeFrames = 0, slowsEnemy = false, options = {}) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.width = width;
    this.length = length;
    this.ownerId = ownerId;
    this.invisibleToEnemy = Boolean(options && options.forceVisible ? false : invisibleToEnemy);
    this.bonusLifeFrames = Math.max(0, Number(bonusLifeFrames) || 0);
    this.slowsEnemy = Boolean(slowsEnemy);
    this.isPermanent = Boolean(options && options.permanent);
    if (this.isPermanent) {
      this.life = Infinity;
      this.maxLife = Infinity;
    } else if (options && options.isSnow) {
      this.life = (240 + this.bonusLifeFrames) * 2; // на снігу сліди тримаються в 2 рази довше
      this.maxLife = this.life;
    } else {
      this.life = 240 + this.bonusLifeFrames; // ~4 секунди + бонус
      this.maxLife = this.life;
    }
  }

  update() {
    if (this.isPermanent) return false;
    this.life--;
    return this.life <= 0;
  }

  draw(ctx) {
    const progress = this.isPermanent ? 1 : (this.life / this.maxLife);
    // Плавне згасання з високою видимою початковою яскравістю
    const alpha = this.isPermanent ? 0.90 : Math.min(1, progress * 1.35);
    if (alpha <= 0.01) return;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    const w = this.length; // вздовж руху (довжина відбитка)
    const h = this.width;  // поперек руху (ширина траку)

    // 1. Зовнішній відбиток придавленого ґрунту / пороху (створює чіткий контраст з темною підлогою)
    ctx.fillStyle = this.slowsEnemy
      ? `rgba(45, 95, 125, ${alpha * 0.65})`
      : `rgba(55, 72, 94, ${alpha * 0.58})`;
    ctx.fillRect(-w / 2 - 0.75, -h / 2 - 0.75, w + 1.5, h + 1.5);

    // 2. Глибока темна втиснена колія від сталевого траку
    ctx.fillStyle = `rgba(2, 4, 7, ${alpha * 0.92})`;
    ctx.fillRect(-w / 2, -h / 2, w, h);

    // 3. Сегментовані ребра протектора (ґрунтозачепи гусениці)
    ctx.fillStyle = `rgba(38, 48, 64, ${alpha * 0.75})`;
    ctx.fillRect(-w / 2 + 1, -h / 2, 1.2, h);
    if (w >= 4.5) {
      ctx.fillRect(w / 2 - 2, -h / 2, 1.2, h);
    }

    // 4. Тонка світліша лінія металевого відбитку по центру траку
    ctx.fillStyle = this.slowsEnemy
      ? `rgba(116, 185, 255, ${alpha * 0.55})`
      : `rgba(85, 108, 138, ${alpha * 0.45})`;
    ctx.fillRect(-w / 2 + 0.5, -0.5, w - 1, 1);

    ctx.restore();
  }
}

/**
 * Димова завіса 3x3 блоки (активна здібність smoke_screen):
 * - Триває 5 секунд (300 кадрів при 60 FPS)
 * - Закриває огляд ворогу (ворог не бачить крізь дим та всередині диму)
 * - Власник бачить крізь свій дим вільно
 */
export class SmokeCloud {
  constructor(ownerId, centerCol, centerRow, tileSize = 40, durationFrames = 300, maxLifeFrames = 300) {
    this.ownerId = ownerId;
    this.centerCol = centerCol;
    this.centerRow = centerRow;
    this.tileSize = tileSize;
    this.x = (centerCol - 1) * tileSize;
    this.y = (centerRow - 1) * tileSize;
    this.width = tileSize * 3;
    this.height = tileSize * 3;
    this.life = typeof durationFrames === 'number' ? durationFrames : 300;
    this.maxLife = Math.max(typeof maxLifeFrames === 'number' ? maxLifeFrames : 300, this.life, 300);
  }

  update() {
    this.life--;
    return this.life <= 0;
  }

  containsPoint(px, py) {
    return (
      px >= this.x &&
      px <= this.x + this.width &&
      py >= this.y &&
      py <= this.y + this.height
    );
  }

  intersectsSegment(x1, y1, x2, y2) {
    if (this.containsPoint(x1, y1) || this.containsPoint(x2, y2)) return true;
    const steps = 20;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const sx = x1 + (x2 - x1) * t;
      const sy = y1 + (y2 - y1) * t;
      if (this.containsPoint(sx, sy)) return true;
    }
    return false;
  }

  draw(ctx, isOwnSmoke = false) {
    if (!ctx || this.life <= 0) return;
    const fadeIn = Math.min(1, (this.maxLife - this.life + 1) / 15);
    const fadeOut = Math.min(1, this.life / 30);
    const baseVisibility = Math.min(fadeIn, fadeOut);
    // Однаковий густий дим для обох гравців (підсвітка танків під димом малюється окремо як у кущах)
    const alpha = 0.92 * baseVisibility;

    ctx.save();

    // Базова підкладка зони 3x3
    ctx.fillStyle = `rgba(99, 110, 114, ${alpha * 0.78})`;
    ctx.fillRect(this.x, this.y, this.width, this.height);

    // Об'ємні клуби диму по 3x3 сітці
    const puffOffsets = [
      [0.22, 0.22, 0.28], [0.50, 0.20, 0.32], [0.78, 0.24, 0.27],
      [0.20, 0.50, 0.31], [0.50, 0.50, 0.38], [0.80, 0.52, 0.30],
      [0.24, 0.78, 0.28], [0.52, 0.80, 0.32], [0.78, 0.76, 0.29]
    ];
    const animShift = ((this.maxLife - this.life) * 0.03);

    for (let i = 0; i < puffOffsets.length; i++) {
      const [rx, ry, rr] = puffOffsets[i];
      const wobbleX = Math.sin(animShift + i * 1.3) * 3;
      const wobbleY = Math.cos(animShift + i * 1.7) * 3;
      const px = this.x + this.width * rx + wobbleX;
      const py = this.y + this.height * ry + wobbleY;
      const pr = this.width * rr;

      const grad = ctx.createRadialGradient(px, py, pr * 0.15, px, py, pr);
      grad.addColorStop(0, `rgba(223, 230, 233, ${alpha * 0.95})`);
      grad.addColorStop(0.6, `rgba(178, 190, 195, ${alpha * 0.85})`);
      grad.addColorStop(1, `rgba(99, 110, 114, 0)`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = `rgba(178, 190, 195, ${0.5 * baseVisibility})`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(this.x + 1, this.y + 1, this.width - 2, this.height - 2);

    ctx.restore();
  }
}

/**
 * Уламки цегли при руйнуванні блоків (Debris)
 */
export class DebrisParticle {
  constructor(x, y, color = '#b84418') {
    this.x = x;
    this.y = y;
    const speed = 1.2 + Math.random() * 3.6;
    const angle = Math.random() * Math.PI * 2;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.size = 2 + Math.floor(Math.random() * 3);
    this.color = color;
    this.life = 25 + Math.floor(Math.random() * 15);
    this.maxLife = this.life;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vx *= 0.91;
    this.vy *= 0.91;
    this.life--;
    return this.life <= 0;
  }

  draw(ctx) {
    const alpha = this.life / this.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.size, this.size);
    ctx.restore();
  }
}

/**
 * Спалах на кінчику ствола при пострілі (Muzzle Flash)
 */
export class MuzzleFlash {
  constructor(x, y, angle, ownerId = 0, hiddenFromEnemy = false) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.ownerId = ownerId;
    this.hiddenFromEnemy = Boolean(hiddenFromEnemy);
    this.life = 5;
    this.maxLife = 5;
  }

  update() {
    this.life--;
    return this.life <= 0;
  }

  draw(ctx) {
    const progress = 1 - (this.life / this.maxLife);
    const radius = 6 + progress * 6;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, radius);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.4, '#f1c40f');
    grad.addColorStop(1, 'rgba(230, 126, 34, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

/**
 * Клубок диму при пострілі (Smoke)
 */
export class SmokeParticle {
  constructor(x, y, angle, ownerId = 0, hiddenFromEnemy = false) {
    this.x = x;
    this.y = y;
    this.ownerId = ownerId;
    this.hiddenFromEnemy = Boolean(hiddenFromEnemy);
    const spread = (Math.random() - 0.5) * 0.45;
    const speed = 0.8 + Math.random() * 1.8;
    this.vx = Math.cos(angle + spread) * speed;
    this.vy = Math.sin(angle + spread) * speed;
    this.radius = 2.5 + Math.random() * 2;
    this.maxRadius = 7 + Math.random() * 4;
    this.life = 22 + Math.floor(Math.random() * 12);
    this.maxLife = this.life;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vx *= 0.92;
    this.vy *= 0.92;
    this.life--;
    return this.life <= 0;
  }

  draw(ctx) {
    const progress = 1 - (this.life / this.maxLife);
    const currentRadius = this.radius + (this.maxRadius - this.radius) * progress;
    const alpha = (this.life / this.maxLife) * 0.38;

    ctx.save();
    ctx.fillStyle = `rgba(189, 195, 199, ${alpha})`;
    ctx.beginPath();
    ctx.arc(this.x, this.y, currentRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Трасуючий слід снайперської кулі (TracerTrail)
 * Залишає яскраву лінію трасера від дула до точки влучання, яка поступово зникає
 */
export class TracerTrail {
  constructor(x1, y1, x2, y2, ownerId = 0, hiddenFromEnemy = false) {
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
    this.ownerId = ownerId;
    this.hiddenFromEnemy = Boolean(hiddenFromEnemy);
    this.life = 72; // подвоєний час існування трасера (~1.2с плавного згасання)
    this.maxLife = 72;
  }

  update() {
    this.life--;
    return this.life <= 0;
  }

  draw(ctx) {
    const progress = Math.max(0, this.life / this.maxLife);
    if (progress <= 0.01) return;

    ctx.save();
    ctx.lineCap = 'round';

    // Зовнішнє світіння трасера
    ctx.strokeStyle = `rgba(255, 118, 117, ${progress * 0.48})`;
    ctx.lineWidth = 4.5 * progress + 1;
    ctx.beginPath();
    ctx.moveTo(this.x1, this.y1);
    ctx.lineTo(this.x2, this.y2);
    ctx.stroke();

    // Яскраве ядро трасера
    ctx.strokeStyle = `rgba(255, 234, 167, ${Math.min(1, progress * 1.15)})`;
    ctx.lineWidth = Math.max(1, 2.2 * progress);
    ctx.beginPath();
    ctx.moveTo(this.x1, this.y1);
    ctx.lineTo(this.x2, this.y2);
    ctx.stroke();

    ctx.restore();
  }
}

// =========================================================================
// МЕНЕДЖЕР ЧАСТИНОК ТА ТРЯСКИ ЕКРАНА (PARTICLE SYSTEM & SCREEN SHAKE)
// =========================================================================
export let trackMarks = [];
export let debrisParticles = [];
export let muzzleFlashes = [];
export let smokeParticles = [];
export let tracerTrails = [];

export let screenShakeTime = 0;
export let screenShakeIntensity = 0;

export let lastP1Pos = { x: 0, y: 0, angle: 0 };
export let lastP2Pos = { x: 0, y: 0, angle: 0 }; export let lastP3Pos = { x: 0, y: 0, angle: 0 }; export let lastP4Pos = { x: 0, y: 0, angle: 0 };

export function setLastTankPos(playerId, x, y, angle) {
  if (playerId === 1) {
    lastP1Pos.x = x;
    lastP1Pos.y = y;
    lastP1Pos.angle = angle;
  } else if (playerId === 3) { lastP3Pos.x = x; lastP3Pos.y = y; lastP3Pos.angle = angle; } else if (playerId === 4) { lastP4Pos.x = x; lastP4Pos.y = y; lastP4Pos.angle = angle; } else if (playerId === 2) {
    lastP2Pos.x = x;
    lastP2Pos.y = y;
    lastP2Pos.angle = angle;
  }
}

export function clearVfxState() {
  trackMarks.length = 0;
  debrisParticles.length = 0;
  muzzleFlashes.length = 0;
  smokeParticles.length = 0;
  tracerTrails.length = 0;
}

export function triggerScreenShake(intensity = 6, duration = 12) {
  screenShakeIntensity = Math.max(screenShakeIntensity, intensity);
  screenShakeTime = Math.max(screenShakeTime, duration);
}

export function consumeScreenShake(ctx) {
  if (screenShakeTime > 0 && ctx) {
    const shakeX = (Math.random() - 0.5) * screenShakeIntensity;
    const shakeY = (Math.random() - 0.5) * screenShakeIntensity;
    ctx.translate(shakeX, shakeY);
    screenShakeTime--;
    screenShakeIntensity *= 0.88;
  }
}

export function spawnTrackMarks(tank, mapGrid = null, tileSize = 40, currentMapEvent = null) {
  if (!tank || tank.isDead) return;

  // Точна ширина та відступ гусениць за типом корпусу
  let treadW = 6;
  if (tank.hullType === 'heavy') treadW = 8;
  else if (tank.hullType === 'light') treadW = 5;
  else if (tank.hullType === 'baby') treadW = 3.5;

  const treadSpacing = (tank.size - treadW) * 0.42;
  const cx = tank.x + tank.size / 2;
  const cy = tank.y + tank.size / 2;
  const perpX = -Math.sin(tank.bodyAngle);
  const perpY = Math.cos(tank.bodyAngle);
  const invTracks = Boolean(tank.invisibleTracks);
  const bonusFrames = Number(tank.trackLifeBonusFrames) || 0;
  const slowsEnemy = Boolean(tank.hasSlowingTracks);

  const col = Math.floor(cx / Math.max(1, tileSize));
  const row = Math.floor(cy / Math.max(1, tileSize));
  const tileId = (mapGrid && mapGrid[row]) ? mapGrid[row][col] : 0;
  const isSnowStorm = currentMapEvent === 'snow_storm';
  const isSnowTile = tileId === 14;
  const isWaterTile = (tileId === 3 || tileId === 8);
  if (isWaterTile && !isSnowStorm) {
    return;
  }

  const markOpts = {
    permanent: isSnowStorm,
    forceVisible: isSnowStorm, // невидимі сліди не працюють при сніговому штормі
    isSnow: isSnowStorm || isSnowTile
  };

  const leftX = cx + perpX * treadSpacing;
  const leftY = cy + perpY * treadSpacing;
  const rightX = cx - perpX * treadSpacing;
  const rightY = cy - perpY * treadSpacing;

  const leftCol = Math.floor(leftX / Math.max(1, tileSize));
  const leftRow = Math.floor(leftY / Math.max(1, tileSize));
  const leftTileId = (mapGrid && mapGrid[leftRow]) ? mapGrid[leftRow][leftCol] : 0;
  const isLeftWater = (leftTileId === 3 || leftTileId === 8) && !isSnowStorm;

  const rightCol = Math.floor(rightX / Math.max(1, tileSize));
  const rightRow = Math.floor(rightY / Math.max(1, tileSize));
  const rightTileId = (mapGrid && mapGrid[rightRow]) ? mapGrid[rightRow][rightCol] : 0;
  const isRightWater = (rightTileId === 3 || rightTileId === 8) && !isSnowStorm;

  // Слід лівої та правої гусениці (у воді сліди НЕ залишаються!)
  const treadLen = tank.hullType === 'baby' ? 3.5 : 5.5;
  if (!isLeftWater) {
    trackMarks.push(new TreadMark(leftX, leftY, tank.bodyAngle, treadW, treadLen, tank.id, invTracks, bonusFrames, slowsEnemy, markOpts));
  }
  if (!isRightWater) {
    trackMarks.push(new TreadMark(rightX, rightY, tank.bodyAngle, treadW, treadLen, tank.id, invTracks, bonusFrames, slowsEnemy, markOpts));
  }

  // Оптимальний буфер слідів гусениць (до 3000 при сніговому штормі для збереження до кінця раунду)
  const maxTracks = isSnowStorm ? 3000 : 800;
  if (trackMarks.length > maxTracks) {
    trackMarks.splice(0, trackMarks.length - maxTracks);
  }
}

/**
 * Перевірка, чи наїхав танк на ворожі сповільнюючі сліди (slowing_tracks: -30% швидкості)
 */
export function isTankOnEnemySlowingTrack(tank, tracks = trackMarks) {
  if (!tank || tank.isDead || !Array.isArray(tracks) || tracks.length === 0) return false;
  const cx = tank.x + tank.size / 2;
  const cy = tank.y + tank.size / 2;
  const hitRadius = Math.max(10, tank.size * 0.58);

  for (let i = tracks.length - 1; i >= 0; i--) {
    const t = tracks[i];
    if (!t || !t.slowsEnemy || !t.ownerId || t.ownerId === tank.id || t.life <= 0) continue;
    const dx = cx - t.x;
    const dy = cy - t.y;
    if (dx * dx + dy * dy <= hitRadius * hitRadius) {
      return true;
    }
  }
  return false;
}

export function updateTankTrackSpawning(p1Tank, p2Tank, gameState = null) {
  const mapGrid = gameState?.map || null;
  const tSize = gameState?.tileSize || 40;
  const curEvent = gameState?.currentMapEvent || null;

  if (p1Tank && !p1Tank.isDead) {
    const distP1 = Math.hypot(p1Tank.x - lastP1Pos.x, p1Tank.y - lastP1Pos.y);
    const dAngleP1 = Math.abs(p1Tank.bodyAngle - lastP1Pos.angle);
    if (distP1 >= 3.4 || dAngleP1 >= 0.075) {
      spawnTrackMarks(p1Tank, mapGrid, tSize, curEvent);
      lastP1Pos.x = p1Tank.x;
      lastP1Pos.y = p1Tank.y;
      lastP1Pos.angle = p1Tank.bodyAngle;
    }
  }

  if (p2Tank && !p2Tank.isDead) {
    const distP2 = Math.hypot(p2Tank.x - lastP2Pos.x, p2Tank.y - lastP2Pos.y);
    const dAngleP2 = Math.abs(p2Tank.bodyAngle - lastP2Pos.angle);
    if (distP2 >= 3.4 || dAngleP2 >= 0.075) {
      spawnTrackMarks(p2Tank, mapGrid, tSize, curEvent);
      lastP2Pos.x = p2Tank.x;
      lastP2Pos.y = p2Tank.y;
      lastP2Pos.angle = p2Tank.bodyAngle;
    }
  }
}

export function spawnDebris(x, y, count = 8, color = '#b84418') {
  for (let i = 0; i < count; i++) {
    debrisParticles.push(new DebrisParticle(x, y, color));
  }
}

export function spawnMuzzleFlash(x, y, angle, ownerId = 0, hiddenFromEnemy = false) {
  muzzleFlashes.push(new MuzzleFlash(x, y, angle, ownerId, hiddenFromEnemy));
}

export function spawnSmoke(x, y, angle, ownerId = 0, hiddenFromEnemy = false) {
  for (let i = 0; i < 3; i++) {
    smokeParticles.push(new SmokeParticle(x, y, angle, ownerId, hiddenFromEnemy));
  }
}

export function spawnTracerTrail(x1, y1, x2, y2, ownerId = 0, hiddenFromEnemy = false) {
  tracerTrails.push(new TracerTrail(x1, y1, x2, y2, ownerId, hiddenFromEnemy));
}

export function addExplosion(gameState, x, y, radius, isTankExplosion = false) {
  if (gameState && Array.isArray(gameState.explosions)) {
    gameState.explosions.push(new Explosion(x, y, radius, isTankExplosion));
  }
}

export function updateParticles(p1Tank, p2Tank, gameState) {
  updateTankTrackSpawning(p1Tank, p2Tank, gameState);

  for (let i = trackMarks.length - 1; i >= 0; i--) {
    if (trackMarks[i].update()) trackMarks.splice(i, 1);
  }
  for (let i = debrisParticles.length - 1; i >= 0; i--) {
    if (debrisParticles[i].update()) debrisParticles.splice(i, 1);
  }
  for (let i = muzzleFlashes.length - 1; i >= 0; i--) {
    if (muzzleFlashes[i].update()) muzzleFlashes.splice(i, 1);
  }
  for (let i = smokeParticles.length - 1; i >= 0; i--) {
    if (smokeParticles[i].update()) smokeParticles.splice(i, 1);
  }
  for (let i = tracerTrails.length - 1; i >= 0; i--) {
    if (tracerTrails[i].update()) tracerTrails.splice(i, 1);
  }
  if (gameState && Array.isArray(gameState.smokeClouds)) {
    for (let i = gameState.smokeClouds.length - 1; i >= 0; i--) {
      if (gameState.smokeClouds[i].update()) gameState.smokeClouds.splice(i, 1);
    }
  }

  updateWeatherParticles(gameState, gameState?.canvasWidth || 640, gameState?.canvasHeight || 640);
}

export let weatherParticles = [];

export function updateWeatherParticles(gameState, width = 640, height = 640) {
  if (!gameState || !gameState.currentMapEvent) {
    if (weatherParticles.length > 0) weatherParticles.length = 0;
    return;
  }
  const event = gameState.currentMapEvent;
  if (event !== 'acid_rain' && event !== 'snow_storm') {
    if (weatherParticles.length > 0) weatherParticles.length = 0;
    return;
  }

  const targetCount = event === 'acid_rain' ? 70 : 85;
  while (weatherParticles.length < targetCount) {
    weatherParticles.push({
      x: Math.random() * (width + 100) - 50,
      y: Math.random() * height - 20,
      speed: event === 'acid_rain' ? (7 + Math.random() * 5) : (1.2 + Math.random() * 1.8),
      size: event === 'acid_rain' ? (10 + Math.random() * 8) : (1.8 + Math.random() * 2.2),
      drift: event === 'acid_rain' ? (1.4 + Math.random() * 1.0) : (Math.random() * 0.8 - 0.4),
      alpha: 0.35 + Math.random() * 0.45
    });
  }

  for (let i = weatherParticles.length - 1; i >= 0; i--) {
    const p = weatherParticles[i];
    p.y += p.speed;
    p.x += p.drift;
    if (p.y > height + 20 || p.x > width + 60 || p.x < -60) {
      p.y = -15;
      p.x = Math.random() * (width + 100) - 50;
    }
  }
}

export function drawWeatherEffects(ctx, gameState, width = 640, height = 640) {
  if (!ctx || !gameState || !gameState.currentMapEvent) return;
  const event = gameState.currentMapEvent;
  if (event === 'acid_rain') {
    ctx.save();
    ctx.strokeStyle = '#2ecc71';
    ctx.lineWidth = 1.4;
    for (const p of weatherParticles) {
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.drift * 2, p.y + p.size);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(46, 204, 113, 0.05)';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  } else if (event === 'snow_storm') {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (const p of weatherParticles) {
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(223, 249, 251, 0.04)';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}

export function updateExplosions(gameState) {
  if (!gameState || !Array.isArray(gameState.explosions)) return;
  for (let i = gameState.explosions.length - 1; i >= 0; i--) {
    const exp = gameState.explosions[i];
    const finished = exp.update();
    if (finished) {
      gameState.explosions.splice(i, 1);
    }
  }
}
