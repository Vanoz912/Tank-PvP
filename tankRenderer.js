/**
 * tankRenderer.js — Візуальний рендеринг моделей танків на Canvas 2D
 *
 * Відповідає виключно за малювання гусениць, корпусів (standard, heavy, light, phantom),
 * башт/гармат (standard, heavy, rapid, ricochet), щитів спавну, аур та індикатора перезарядки касети.
 */

/**
 * Рендеринг гусениці зі специфічним стилем (standard / heavy / light)
 */
export function drawSingleTread(tank, ctx, x, y, w, h, isGhost, treadStyle = 'standard') {
  const baseColor = isGhost ? '#3a3a3a' : '#2d3436';
  const highlightColor = isGhost ? '#555555' : (treadStyle === 'heavy' ? '#636e72' : '#747d8c');
  const borderColor = isGhost ? '#222222' : '#000000';

  ctx.fillStyle = baseColor;
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const numRungs = treadStyle === 'light' ? Math.max(5, Math.floor(h / 4.5)) : Math.max(3, Math.floor(h / 6));
  const rungH = treadStyle === 'heavy' ? Math.max(2, Math.floor(h / 10)) : Math.max(1.5, Math.floor(h / 12));
  const step = h / numRungs;
  const offset = (Math.floor((tank.animFrame || 0) / 4) * 2) % step;

  ctx.fillStyle = highlightColor;
  for (let i = -1; i <= numRungs; i++) {
    const ry = y + ((i * step + offset) % h);
    if (ry >= y + 1 && ry + rungH <= y + h - 1) {
      ctx.fillRect(x + 1, ry, w - 2, rungH);
      if (treadStyle === 'heavy') {
        ctx.fillStyle = '#2d3436';
        ctx.fillRect(x + Math.floor(w / 2) - 1, ry, 2, rungH);
        ctx.fillStyle = highlightColor;
      }
    }
  }
}

/**
 * Рендеринг танка з роздільними шарами: Корпус (bodyAngle) та Вежа (turretAngle)
 * Підтримує параметр layer: 'all' (за замовчуванням), 'hull' (тільки корпус), 'turret' (тільки вежа та дуло)
 * УВАГА: над танками смужки здоров'я НЕ малюються (тактичний туман)!
 */
export function drawTankModel(tank, ctx, renderPos, isGhost = false, ghostAlpha = 1, layer = 'all') {
  if (!tank || (tank.isDead && !isGhost)) return;
  renderPos = renderPos || tank;

  const cx = renderPos.x + tank.size / 2;
  const cy = renderPos.y + tank.size / 2;
  const half = tank.size / 2;
  const borderColor = '#000000';
  const hullType = tank.hullType || 'standard';
  const turretType = tank.turretType || 'standard';

  ctx.save();
  if (ghostAlpha !== 1 || isGhost) ctx.globalAlpha = ghostAlpha;

  if (layer === 'all' || layer === 'hull') {
    // ==========================================
    // ШАР 1: КОРПУС ТАНКА (орієнтований за bodyAngle)
    // УВАГА: -Y це ПЕРЕД (фари, скошений бронелист), +Y це КОРМА (вихлопи, решітки, стоп-сигнали)!
    // ==========================================
    const bAngle = Number.isFinite(renderPos.bodyAngle) ? renderPos.bodyAngle : (Number.isFinite(tank.bodyAngle) ? tank.bodyAngle : 0);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(bAngle + Math.PI / 2);

    if (hullType === 'heavy') {
      // ----------------------------------------
      // ВАЖКИЙ КОРПУС: Широкий, масивний, важкі гусениці з бортовими екранами (Schürzen)
      // ----------------------------------------
      const treadW = Math.max(6, Math.floor(tank.size * 0.25));
      drawSingleTread(tank, ctx, -half, -half, treadW, tank.size, isGhost, 'heavy');
      drawSingleTread(tank, ctx, half - treadW, -half, treadW, tank.size, isGhost, 'heavy');

      // Бортові бронелисти (Schürzen) поверх зовнішньої частини гусениць
      const skirtW = Math.max(2, Math.floor(treadW * 0.45));
      ctx.fillStyle = isGhost ? '#444' : tank.darkColor;
      ctx.fillRect(-half - 0.5, -half + 3, skirtW, tank.size - 6);
      ctx.fillRect(half - skirtW + 0.5, -half + 3, skirtW, tank.size - 6);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(-half - 0.5, -half + 3, skirtW, tank.size - 6);
      ctx.strokeRect(half - skirtW + 0.5, -half + 3, skirtW, tank.size - 6);

      // Заклепки на екранах
      ctx.fillStyle = '#111';
      [-half + 6, 0, half - 6].forEach(ry => {
        ctx.fillRect(-half + 0.5, ry - 1, 1.5, 1.5);
        ctx.fillRect(half - 2, ry - 1, 1.5, 1.5);
      });

      // Основний масивний корпус
      const hullX = -half + treadW + 0.5;
      const hullY = -half + 2;
      const hullW = tank.size - (treadW * 2) - 1;
      const hullH = tank.size - 4;

      ctx.fillStyle = isGhost ? '#555555' : tank.baseColor;
      ctx.fillRect(hullX, hullY, hullW, hullH);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(hullX + 0.5, hullY + 0.5, hullW - 1, hullH - 1);

      // Передній таранний скос броні (Chevron Sloped Glacis) - ПЕРЕД (-Y)
      ctx.fillStyle = isGhost ? '#777777' : tank.lightColor;
      ctx.beginPath();
      ctx.moveTo(hullX + 1, hullY + 5);
      ctx.lineTo(0, hullY + 1);
      ctx.lineTo(hullX + hullW - 1, hullY + 5);
      ctx.lineTo(hullX + hullW - 1, hullY + 2);
      ctx.lineTo(hullX + 1, hullY + 2);
      ctx.closePath();
      ctx.fill();

      // Посилена бронеплита по центру передка
      ctx.strokeStyle = borderColor;
      ctx.beginPath();
      ctx.moveTo(hullX + 2, hullY + 5);
      ctx.lineTo(0, hullY + 2);
      ctx.lineTo(hullX + hullW - 2, hullY + 5);
      ctx.stroke();

      // Важкі передні захищені фари (Яскраві прожектори) - ПЕРЕД (-Y)
      const lightY = -half + 0.5;
      [-half + 1, half - treadW + 1].forEach(lx => {
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(lx, lightY, treadW - 2, 3);
        ctx.fillStyle = isGhost ? '#888' : '#fff375';
        ctx.fillRect(lx + 1, lightY, treadW - 4, 2);
      });

      // Оглядова щілина мехвода по центру передка
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(-2.5, hullY + 4, 5, 2);
      ctx.fillStyle = '#00d2d3';
      ctx.fillRect(-1.5, hullY + 4.5, 3, 1);

      // Кормові вентиляційні решітки двигуна (4 секції) - КОРМА (+Y)
      const ventY = hullY + hullH - 7;
      ctx.fillStyle = '#111';
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(hullX + 2, ventY + i * 1.5, hullW - 4, 1);
      }

      // Подвійні важкі вихлопні патрубки ззаду - КОРМА (+Y)
      ctx.fillStyle = '#2d3436';
      ctx.fillRect(-half + treadW + 1, hullY + hullH - 1, 2.5, 3);
      ctx.fillRect(half - treadW - 3.5, hullY + hullH - 1, 2.5, 3);
      ctx.fillStyle = '#000';
      ctx.fillRect(-half + treadW + 1.5, hullY + hullH + 1, 1.5, 1);
      ctx.fillRect(half - treadW - 3, hullY + hullH + 1, 1.5, 1);

      // Задні червоні габаритні вогні - КОРМА (+Y)
      ctx.fillStyle = isGhost ? '#555' : '#c0392b';
      ctx.fillRect(-half + 1, half - 2.5, treadW - 2, 2);
      ctx.fillRect(half - treadW + 1, half - 2.5, treadW - 2, 2);

    } else if (hullType === 'light') {
      // ----------------------------------------
      // ЛЕГКИЙ КОРПУС: Стрімкий, клиноподібний (Arrowhead Nose), швидкі вузькі гусениці
      // ----------------------------------------
      const treadW = Math.max(4, Math.floor(tank.size * 0.18));
      drawSingleTread(tank, ctx, -half, -half, treadW, tank.size, isGhost, 'light');
      drawSingleTread(tank, ctx, half - treadW, -half, treadW, tank.size, isGhost, 'light');

      const hullX = -half + treadW + 0.5;
      const hullY = -half + 2;
      const hullW = tank.size - (treadW * 2) - 1;
      const hullH = tank.size - 4;

      // Клиноподібний ніс (стрімка форма носової частини, загострена вперед до -Y)
      ctx.fillStyle = isGhost ? '#555555' : tank.baseColor;
      ctx.beginPath();
      ctx.moveTo(hullX, hullY + 6);
      ctx.lineTo(0, -half - 0.5); // Гострий клин спереду!
      ctx.lineTo(hullX + hullW, hullY + 6);
      ctx.lineTo(hullX + hullW, hullY + hullH);
      ctx.lineTo(hullX, hullY + hullH);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Відблиск верхньої площини клина
      ctx.fillStyle = isGhost ? '#777777' : tank.lightColor;
      ctx.beginPath();
      ctx.moveTo(hullX + 1.5, hullY + 5.5);
      ctx.lineTo(0, -half + 1);
      ctx.lineTo(hullX + hullW - 1.5, hullY + 5.5);
      ctx.lineTo(0, hullY + 3);
      ctx.closePath();
      ctx.fill();

      // Спортивні вузькі LED фари спереду - ПЕРЕД (-Y)
      ctx.fillStyle = isGhost ? '#777' : '#ffeaa7';
      ctx.fillRect(-half + 0.5, -half + 1, treadW - 1, 2);
      ctx.fillRect(half - treadW + 0.5, -half + 1, treadW - 1, 2);

      // Спортивний центральний подвійний дифузор/вихлоп ззаду - КОРМА (+Y)
      const ventY = hullY + hullH - 5;
      ctx.fillStyle = '#111';
      ctx.fillRect(hullX + 2, ventY, hullW - 4, 3);
      ctx.fillStyle = '#747d8c';
      ctx.fillRect(-2, hullY + hullH - 1, 4, 2);
      ctx.fillStyle = '#000';
      ctx.fillRect(-1.5, hullY + hullH, 1.2, 1);
      ctx.fillRect(0.3, hullY + hullH, 1.2, 1);

      // Задні вузькі червоні стоп-сигнали - КОРМА (+Y)
      ctx.fillStyle = isGhost ? '#555' : '#ff4757';
      ctx.fillRect(-half + 0.5, half - 2, treadW - 1, 1.5);
      ctx.fillRect(half - treadW + 0.5, half - 2, treadW - 1, 1.5);

    } else if (hullType === 'phantom') {
      // ----------------------------------------
      // ФАНТОМНИЙ КОРПУС (1 HP, 99% БРОНЯ): Футуристичний енергетичний щитовий корпус з неоновими гранями
      // ----------------------------------------
      const treadW = Math.max(5, Math.floor(tank.size * 0.21));
      drawSingleTread(tank, ctx, -half, -half, treadW, tank.size, isGhost, 'light');
      drawSingleTread(tank, ctx, half - treadW, -half, treadW, tank.size, isGhost, 'light');

      const hullX = -half + treadW + 0.5;
      const hullY = -half + 1.5;
      const hullW = tank.size - (treadW * 2) - 1;
      const hullH = tank.size - 3;

      // Призматична бронекапсула з бірюзовим енергетичним контуром
      ctx.fillStyle = isGhost ? '#444444' : '#1e272e';
      ctx.fillRect(hullX, hullY, hullW, hullH);

      // Внутрішні пластини кольору гравця
      ctx.fillStyle = isGhost ? '#555555' : tank.baseColor;
      ctx.fillRect(hullX + 1.5, hullY + 2, hullW - 3, hullH - 4);

      // Неоновий енергетичний контур непробивної броні (99%)
      ctx.strokeStyle = isGhost ? '#777777' : '#00e5ff';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(hullX + 0.5, hullY + 0.5, hullW - 1, hullH - 1);

      // Передній V-подібний енергетичний дефлектор - ПЕРЕД (-Y)
      ctx.fillStyle = isGhost ? '#888888' : '#00e5ff';
      ctx.beginPath();
      ctx.moveTo(hullX + 1.5, hullY + 5);
      ctx.lineTo(0, hullY + 1);
      ctx.lineTo(hullX + hullW - 1.5, hullY + 5);
      ctx.lineTo(0, hullY + 3.2);
      ctx.closePath();
      ctx.fill();

      // Кристалічний реактор броні в центрі корпусу
      ctx.fillStyle = isGhost ? '#777' : '#81ecec';
      ctx.fillRect(-2, -2, 4, 4);

      // Передні плазмові фари - ПЕРЕД (-Y)
      ctx.fillStyle = isGhost ? '#888' : '#00e5ff';
      ctx.fillRect(-half + 1, -half + 0.8, treadW - 2, 2);
      ctx.fillRect(half - treadW + 1, -half + 0.8, treadW - 2, 2);

      // Кормові іонні дюзи - КОРМА (+Y)
      ctx.fillStyle = isGhost ? '#555' : '#ff4757';
      ctx.fillRect(-half + 1, half - 2.2, treadW - 2, 1.8);
      ctx.fillRect(half - treadW + 1, half - 2.2, treadW - 2, 1.8);

    } else {
      // ----------------------------------------
      // СТАНДАРТНИЙ КОРПУС: Збалансований класичний танк, скошений лобовий лист, подвійні фари
      // ----------------------------------------
      const treadW = Math.max(5, Math.floor(tank.size * 0.22));
      drawSingleTread(tank, ctx, -half, -half, treadW, tank.size, isGhost, 'standard');
      drawSingleTread(tank, ctx, half - treadW, -half, treadW, tank.size, isGhost, 'standard');

      const hullX = -half + treadW + 0.5;
      const hullY = -half + 2;
      const hullW = tank.size - (treadW * 2) - 1;
      const hullH = tank.size - 4;

      ctx.fillStyle = isGhost ? '#555555' : tank.baseColor;
      ctx.fillRect(hullX, hullY, hullW, hullH);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(hullX + 0.5, hullY + 0.5, hullW - 1, hullH - 1);

      // Скошений лобовий бронелист (Front Sloped Glacis) - ПЕРЕД (-Y)
      ctx.fillStyle = isGhost ? '#777777' : tank.lightColor;
      ctx.beginPath();
      ctx.moveTo(hullX + 1, hullY + 4);
      ctx.lineTo(0, hullY + 1);
      ctx.lineTo(hullX + hullW - 1, hullY + 4);
      ctx.lineTo(hullX + hullW - 1, hullY + 1);
      ctx.lineTo(hullX + 1, hullY + 1);
      ctx.closePath();
      ctx.fill();

      // Яскраві передні круглі фари на надгусеничних полицях - ПЕРЕД (-Y)
      const lightY = -half + 1;
      [-half + 1, half - treadW + 1].forEach(lx => {
        ctx.fillStyle = '#222';
        ctx.fillRect(lx, lightY, treadW - 2, 2.5);
        ctx.fillStyle = isGhost ? '#888' : '#fffab0';
        ctx.fillRect(lx + 0.5, lightY, treadW - 3, 1.8);
      });

      // Люк та перископ водія-механіка
      ctx.fillStyle = '#1e272e';
      ctx.fillRect(-2, hullY + 3.5, 4, 1.8);
      ctx.fillStyle = '#00d2d3';
      ctx.fillRect(-1.2, hullY + 4, 2.4, 0.8);

      // Кормові вентиляційні решітки двигуна (3 смужки) - КОРМА (+Y)
      const ventY = hullY + hullH - 5.5;
      ctx.fillStyle = isGhost ? '#333333' : '#111111';
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(hullX + 2, ventY + i * 1.6, hullW - 4, 1);
      }

      // Вихлопні труби ззаду
      ctx.fillStyle = '#2d3436';
      ctx.fillRect(-half + treadW + 1, hullY + hullH - 1, 2, 2.5);
      ctx.fillRect(half - treadW - 3, hullY + hullH - 1, 2, 2.5);
      ctx.fillStyle = '#000';
      ctx.fillRect(-half + treadW + 1, hullY + hullH + 1, 2, 0.5);
      ctx.fillRect(half - treadW - 3, hullY + hullH + 1, 2, 0.5);

      // Задні червоні габаритні відбивачі - КОРМА (+Y)
      ctx.fillStyle = isGhost ? '#555' : '#e74c3c';
      ctx.fillRect(-half + 1, half - 2.5, treadW - 2, 1.8);
      ctx.fillRect(half - treadW + 1, half - 2.5, treadW - 2, 1.8);
    }

    ctx.restore();
  } // end if (layer === 'all' || layer === 'hull')

  if (layer === 'all' || layer === 'turret') {
    // ==========================================
    // ШАР 2: ВЕЖА ТА ДУЛО (орієнтовані за turretAngle)
    // УВАГА: -Y це НАПРЯМОК ПРИЦІЛЮВАННЯ ТА ПОСТРІЛУ!
    // Гармата починається ВІД ЦЕНТРУ ВЕЖІ (y = 2) і йде вперед до -gunLen!
    // ==========================================
    const tAngle = Number.isFinite(renderPos.turretAngle) ? renderPos.turretAngle : (Number.isFinite(tank.turretAngle) ? tank.turretAngle : 0);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tAngle + Math.PI / 2);

    if (turretType === 'heavy') {
      // ----------------------------------------
      // ВАЖКА ГАРМАТА: Товстий довгий ствол, потужне дульне гальмо, броньована кутаста вежа
      // ----------------------------------------
      const gunW = Math.max(5, Math.floor(tank.size * 0.20));
      const gunLen = Math.floor(tank.size * 0.72);

      // 1. Масивний ствол гармати (починається з центру y = 2 і тягнеться вперед до -gunLen)
      ctx.fillStyle = isGhost ? '#aaaaaa' : '#dfe6e9';
      ctx.fillRect(-gunW / 2, -gunLen, gunW, gunLen + 2);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(-gunW / 2, -gunLen, gunW, gunLen + 2);

      // Посилена теплоізоляційна муфта посередині ствола
      const sleeveY = -Math.floor(gunLen * 0.55);
      ctx.fillStyle = isGhost ? '#888' : '#b2bec3';
      ctx.fillRect(-gunW / 2 - 1, sleeveY, gunW + 2, 5);
      ctx.strokeRect(-gunW / 2 - 1, sleeveY, gunW + 2, 5);

      // Потужне двокамерне дульне гальмо (Double-Baffle Muzzle Brake) на кінчику
      const brakeW = gunW + 5;
      const brakeH = 5;
      ctx.fillStyle = isGhost ? '#666' : '#636e72';
      ctx.fillRect(-brakeW / 2, -gunLen, brakeW, brakeH);
      ctx.strokeRect(-brakeW / 2, -gunLen, brakeW, brakeH);
      // Прорізи скидання порохових газів
      ctx.fillStyle = '#000';
      ctx.fillRect(-brakeW / 2, -gunLen + 1.5, 1.5, 2);
      ctx.fillRect(brakeW / 2 - 1.5, -gunLen + 1.5, 1.5, 2);

      // 2. Кутаста зварна важка башта (Faceted Bunker Turret)
      const tw = Math.max(6, Math.floor(tank.size * 0.29));
      const th = Math.max(6, Math.floor(tank.size * 0.29));

      ctx.fillStyle = isGhost ? '#666666' : tank.lightColor;
      ctx.beginPath();
      ctx.moveTo(-tw + 3, -th);
      ctx.lineTo(tw - 3, -th);
      ctx.lineTo(tw, -th + 3);
      ctx.lineTo(tw, th - 2);
      ctx.lineTo(tw - 3, th);
      ctx.lineTo(-tw + 3, th);
      ctx.lineTo(-tw, th - 2);
      ctx.lineTo(-tw, -th + 3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Броньована маска гармати (Gun Mantlet Box) над основою ствола
      const mantletW = gunW + 4;
      ctx.fillStyle = isGhost ? '#555' : tank.darkColor;
      ctx.fillRect(-mantletW / 2, -th - 2, mantletW, 6);
      ctx.strokeRect(-mantletW / 2, -th - 2, mantletW, 6);

      // Командирська башточка з бронепризмами
      ctx.fillStyle = isGhost ? '#444444' : tank.darkColor;
      ctx.beginPath();
      ctx.arc(0, 2, Math.max(3, th * 0.42), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.stroke();

    } else if (turretType === 'rapid') {
      // ----------------------------------------
      // СКОРОСТРІЛЬНЕ ДУЛО (Twin Autocannon): Два паралельні стволи, радіатори охолодження
      // ----------------------------------------
      const gunW = Math.max(2, Math.floor(tank.size * 0.08));
      const gunLen = Math.floor(tank.size * 0.58);
      const barrelSpacing = Math.max(3.5, Math.floor(tank.size * 0.13));

      // 1. Два паралельні стволи (лівий та правий), що починаються з центру y = 2
      [-barrelSpacing, barrelSpacing].forEach(bx => {
        ctx.fillStyle = isGhost ? '#aaaaaa' : '#dfe6e9';
        ctx.fillRect(bx - gunW / 2, -gunLen, gunW, gunLen + 2);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx - gunW / 2, -gunLen, gunW, gunLen + 2);

        // Полум'ягасники на кінчиках
        ctx.fillStyle = isGhost ? '#777' : '#747d8c';
        ctx.fillRect(bx - gunW / 2 - 1, -gunLen, gunW + 2, 3);
        ctx.strokeRect(bx - gunW / 2 - 1, -gunLen, gunW + 2, 3);
      });

      // 2. Компактна швидкісна купольна башта з ребрами охолодження
      const radius = Math.max(4, Math.floor(tank.size * 0.23));

      // Бічні радіаторні ребра / патронні ящики
      ctx.fillStyle = isGhost ? '#555' : '#2d3436';
      ctx.fillRect(-radius - 3, -2, 2.5, 6);
      ctx.fillRect(radius + 0.5, -2, 2.5, 6);
      ctx.strokeRect(-radius - 3, -2, 2.5, 6);
      ctx.strokeRect(radius + 0.5, -2, 2.5, 6);

      // Основа башти
      ctx.fillStyle = isGhost ? '#666666' : tank.lightColor;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Подвійна маска спареної установки стволів
      ctx.fillStyle = isGhost ? '#555' : tank.darkColor;
      ctx.fillRect(-barrelSpacing - gunW / 2 - 1, -radius - 1, barrelSpacing * 2 + gunW + 2, 4);
      ctx.strokeRect(-barrelSpacing - gunW / 2 - 1, -radius - 1, barrelSpacing * 2 + gunW + 2, 4);

      // Люк та датчики швидкої вежі
      ctx.fillStyle = isGhost ? '#444444' : tank.darkColor;
      ctx.beginPath();
      ctx.arc(0, 1.5, Math.max(2, radius * 0.45), 0, Math.PI * 2);
      ctx.fill();

    } else if (turretType === 'ricochet') {
      // ----------------------------------------
      // ДУЛО "РИКОШЕТ": Призматична скошена башта з дефлекторними кільцями та блакитною індикацією
      // ----------------------------------------
      const gunW = Math.max(3.5, Math.floor(tank.size * 0.14));
      const gunLen = Math.floor(tank.size * 0.64);

      // 1. Ствол з дефлекторними кільцями рикошету
      ctx.fillStyle = isGhost ? '#999999' : '#d2dae2';
      ctx.fillRect(-gunW / 2, -gunLen, gunW, gunLen + 2);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(-gunW / 2, -gunLen, gunW, gunLen + 2);

      // Блакитні енергетичні кільця-дефлектори вздовж ствола
      ctx.fillStyle = isGhost ? '#777777' : '#00d8d6';
      ctx.fillRect(-gunW / 2 - 1, -Math.floor(gunLen * 0.45), gunW + 2, 2.5);
      ctx.fillRect(-gunW / 2 - 1, -Math.floor(gunLen * 0.72), gunW + 2, 2.5);

      // Скошене V-подібне дульне гальмо рикошету
      ctx.fillStyle = isGhost ? '#666666' : '#0fbcf9';
      ctx.beginPath();
      ctx.moveTo(-gunW / 2 - 2, -gunLen + 3);
      ctx.lineTo(0, -gunLen - 1.5);
      ctx.lineTo(gunW / 2 + 2, -gunLen + 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 2. Ромбоподібна призматична вежа
      const tr = Math.max(5.5, Math.floor(tank.size * 0.26));
      ctx.fillStyle = isGhost ? '#666666' : tank.lightColor;
      ctx.beginPath();
      ctx.moveTo(0, -tr - 2);
      ctx.lineTo(tr + 1, -1);
      ctx.lineTo(tr - 2, tr);
      ctx.lineTo(-tr + 2, tr);
      ctx.lineTo(-tr - 1, -1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Центральний призматичний візор
      ctx.fillStyle = isGhost ? '#555555' : '#00d8d6';
      ctx.beginPath();
      ctx.arc(0, 1, Math.max(2, tr * 0.36), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

    } else {
      // ----------------------------------------
      // СТАНДАРТНЕ ДУЛО: Класична башта, одиночний ствол, надійна маска, дульне гальмо
      // ----------------------------------------
      const gunW = Math.max(3, Math.floor(tank.size * 0.13));
      const gunLen = Math.floor(tank.size * 0.62);

      // 1. Ствол гармати: виходить із центру (y = 2) до -gunLen
      ctx.fillStyle = isGhost ? '#aaaaaa' : '#ecf0f1';
      ctx.fillRect(-gunW / 2, -gunLen, gunW, gunLen + 2);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(-gunW / 2, -gunLen, gunW, gunLen + 2);

      // Посилена основа ствола
      const baseLen = Math.floor(gunLen * 0.35);
      ctx.fillStyle = isGhost ? '#888' : '#bdc3c7';
      ctx.fillRect(-gunW / 2 - 0.8, -baseLen, gunW + 1.6, baseLen + 2);
      ctx.strokeRect(-gunW / 2 - 0.8, -baseLen, gunW + 1.6, baseLen + 2);

      // Дульне гальмо на кінчику
      ctx.fillStyle = isGhost ? '#777777' : '#95a5a6';
      ctx.fillRect(-gunW / 2 - 1.5, -gunLen, gunW + 3, 3);
      ctx.strokeRect(-gunW / 2 - 1.5, -gunLen, gunW + 3, 3);

      // 2. Башта (Turret Ring & Mantlet)
      const turretRadius = Math.max(5, Math.floor(tank.size * 0.25));
      ctx.fillStyle = isGhost ? '#666666' : tank.lightColor;
      ctx.beginPath();
      ctx.arc(0, 0, turretRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Округла маска гармати на передній частині вежі
      ctx.fillStyle = isGhost ? '#555' : tank.darkColor;
      ctx.beginPath();
      ctx.arc(0, -turretRadius * 0.4, gunW + 1.5, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Люк командира
      ctx.fillStyle = isGhost ? '#444444' : tank.darkColor;
      ctx.beginPath();
      ctx.arc(0, 1.5, Math.max(2, turretRadius * 0.42), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // ==========================================
    // ШАР 3: СПАВН-ЩИТ, ІМПУЛЬСНИЙ ЩИТ ФАНТОМА ТА АУРА БЛИЖНЬОГО БОЮ
    // ==========================================
    if (!isGhost && (tank.spawnShieldTimer > 0 || tank.hitInvulnTimer > 0)) {
      ctx.save();
      if (tank.hitInvulnTimer > 0 && tank.spawnShieldTimer <= 0) {
        ctx.strokeStyle = (tank.hitInvulnTimer % 2 === 0) ? '#00e5ff' : '#81ecec';
        ctx.fillStyle = 'rgba(0, 229, 255, 0.16)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(cx, cy, tank.size / 2 + 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.strokeStyle = (Math.floor(tank.spawnShieldTimer / 4) % 2 === 0) ? '#00e5ff' : '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, tank.size / 2 + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (!isGhost && tank.proximityDmg > 0) {
      ctx.save();
      const auraRadius = Math.round(tank.size * 2.65);
      ctx.strokeStyle = 'rgba(255, 107, 107, 0.38)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, auraRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  } // end if (layer === 'all' || layer === 'turret')

  ctx.restore();
}

/**
 * Рендеринг індикатора перезарядки касети безпосередньо над ВЛАСНИМ танком (ворог перезарядку не бачить)
 */
export function drawTankReloadIndicator(tank, ctx, renderPos, now = Date.now()) {
  if (!tank || !ctx || tank.isDead) return false;

  const progress = tank.getReloadProgress(now);
  const reloadDur = tank.clipReloadTime || 3000;
  const elapsed = tank.clipReloadStartTime > 0 ? Math.max(0, now - tank.clipReloadStartTime) : Infinity;
  const justFinished = tank.clipReloadStartTime > 0 && elapsed >= reloadDur && elapsed < (reloadDur + 200);

  if (progress >= 1 && !justFinished) return false;

  const pos = renderPos || { x: tank.x, y: tank.y };
  const cx = pos.x + tank.size / 2;
  const barW = Math.max(24, Math.round(tank.size * 0.92));
  const barH = 4;
  const barX = Math.round(cx - barW / 2);
  const barY = Math.round(pos.y - 9);

  ctx.save();

  // 1. Темна контрастна рамка індикатора
  ctx.fillStyle = '#070a0e';
  ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);

  // 2. Внутрішня доріжка (фон перезарядки)
  ctx.fillStyle = '#18202c';
  ctx.fillRect(barX, barY, barW, barH);

  // 3. Заповнення прогресу перезарядки касети (2с / 3с / 4с)
  const clampedProg = Math.max(0, Math.min(1, progress));
  const fillW = Math.max(1, Math.round(barW * clampedProg));
  if (clampedProg >= 1) {
    ctx.fillStyle = '#2ecc71'; // Касету заряджено (зелений спалах)
  } else if (clampedProg >= 0.65) {
    ctx.fillStyle = '#f1c40f'; // Майже заряджено (жовтий)
  } else {
    ctx.fillStyle = '#e67e22'; // Перезарядка триває (помаранчевий)
  }
  ctx.fillRect(barX, barY, fillW, barH);

  // 4. Верхній піксельний блік для чіткості
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.fillRect(barX, barY, fillW, 1);

  ctx.restore();
  return true;
}
