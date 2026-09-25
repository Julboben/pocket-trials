import { curveAt, seatedSurfaceAt } from './terrain.js';

const GROUND_ALIGNED_PROP_SPANS = {
  fence: [-24, 22],
  rock: [-16, 18]
};

export function propAlignmentSlope(level, prop) {
  const span = GROUND_ALIGNED_PROP_SPANS[prop.type];
  if (!span) return 0;
  const surface = seatedSurfaceAt(level, prop.x, prop.y);
  if (!surface) return 0;
  const points = surface.platform?.points || level.points;
  const [left, right] = span;
  return (curveAt(points, prop.x + right).y - curveAt(points, prop.x + left).y) / (right - left);
}

export function propDrawAngle(type, slope = 0) {
  return GROUND_ALIGNED_PROP_SPANS[type] && Number.isFinite(slope) ? Math.atan(slope) : 0;
}

export function sunLight({ width, cameraX = 0, cameraY = 0, weather = {} }) {
  const sunshine = Math.max(0, Math.min(1, weather.sun ?? 1));
  const cloudiness = Math.max(0, Math.min(1, weather.clouds ?? .35));
  return {
    x: width * .77 - cameraX * .015,
    y: 85 - cameraY * .08,
    sunshine,
    strength: sunshine * (1 - cloudiness * .55)
  };
}

export function sunShadowOffset({ bikeX, bikeY, sunX, sunY, height = 0, strength = 1 }) {
  const slant = (sunX - bikeX) / Math.max(Math.abs(sunY - bikeY), 48);
  const reach = 10 + Math.max(0, height) * .05;
  const offset = -slant * strength * reach;
  if (!offset) return 0;
  return Math.max(-14, Math.min(14, offset));
}

export function propGroundOffset(level, prop) {
  const surface = seatedSurfaceAt(level, prop.x, prop.y);
  if (!surface) return () => 0;
  const points = surface.platform?.points || level.points;
  const originY = Number.isFinite(prop.y) ? prop.y : surface.y;
  return localX => curveAt(points, prop.x + localX).y - originY;
}

export function createDrawingTools(ctx) {
  function line(points, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((point, index) => index ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1]));
    ctx.stroke();
  }

  function circle(x, y, radius, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function pixelRect(x, y, width, height, color, pixel = 2) {
    ctx.fillStyle = color;
    ctx.fillRect(
      Math.round(x / pixel) * pixel,
      Math.round(y / pixel) * pixel,
      Math.max(pixel, Math.round(width / pixel) * pixel),
      Math.max(pixel, Math.round(height / pixel) * pixel)
    );
  }

  function pixelPath(points, color, thickness = 1, pixel = 2) {
    ctx.fillStyle = color;
    const radius = Math.floor(thickness / 2);
    for (let segment = 1; segment < points.length; segment++) {
      let x0 = Math.round(points[segment - 1][0] / pixel);
      let y0 = Math.round(points[segment - 1][1] / pixel);
      const x1 = Math.round(points[segment][0] / pixel);
      const y1 = Math.round(points[segment][1] / pixel);
      const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
      const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
      let error = dx + dy;
      while (true) {
        ctx.fillRect((x0 - radius) * pixel, (y0 - radius) * pixel, thickness * pixel, thickness * pixel);
        if (x0 === x1 && y0 === y1) break;
        const twice = 2 * error;
        if (twice >= dy) { error += dy; x0 += sx; }
        if (twice <= dx) { error += dx; y0 += sy; }
      }
    }
  }

  function drawPixelDisc(x, y, radius, color, pixel = 4) {
    ctx.fillStyle = color;
    const cells = Math.ceil(radius / pixel);
    for (let py = -cells; py <= cells; py++) for (let px = -cells; px <= cells; px++) {
      if (px * px + py * py <= cells * cells) ctx.fillRect(x + px * pixel, y + py * pixel, pixel, pixel);
    }
  }

  function drawPixelSpring(x1, y1, x2, y2, color) {
    const dx = x2 - x1, dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length, ny = dx / length;
    const points = [[x1,y1]];
    for (let index = 1; index < 6; index++) {
      const amount = index / 6;
      const offset = (index % 2 ? 1 : -1) * 2.5;
      points.push([x1 + dx * amount + nx * offset, y1 + dy * amount + ny * offset]);
    }
    points.push([x2,y2]);
    pixelPath(points, color, 1);
  }

  return { line, circle, pixelRect, pixelPath, drawPixelDisc, drawPixelSpring };
}

export function createGameArt(ctx) {
  const { line, pixelRect, pixelPath, drawPixelDisc, drawPixelSpring } = createDrawingTools(ctx);
  const TAU = Math.PI * 2;

  function drawApple(x, y, { glow = true } = {}) {
    if (glow) {
      ctx.fillStyle = '#fbf0ce50';
      ctx.beginPath(); ctx.arc(x, y, 15, 0, TAU); ctx.fill();
    }
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#ed774e';
    ctx.beginPath();
    ctx.moveTo(0,-5);
    ctx.bezierCurveTo(-12,-12,-14,6,-4,9);
    ctx.quadraticCurveTo(0,7,4,9);
    ctx.bezierCurveTo(14,6,12,-12,0,-5);
    ctx.fill();
    line([[0,-5],[1,-11]], '#617144', 1.5);
    ctx.fillStyle = '#567a4e';
    ctx.beginPath(); ctx.ellipse(4,-10,4,2,-.5,0,TAU); ctx.fill();
    line([[-6,-2],[-7,1]], '#ffc295', 2);
    ctx.restore();
  }

  function drawFlag(x, y, unlocked, remaining = 0) {
    pixelRect(x-2,y-108,4,108,'#304a42',2); pixelRect(x-4,y-112,8,6,'#ed9150',2);
    const size=8;
    for(let row=0;row<3;row++) for(let col=0;col<4;col++) {
      pixelRect(x+2+col*size,y-104+row*size,size,size,(row+col)%2?(unlocked?'#28483a':'#758477'):'#f2e9cf',2);
    }
    pixelRect(x-24,y-62,48,16,'#f4e9d1',2);
    ctx.fillStyle='#365345'; ctx.font='bold 7px ui-monospace, monospace'; ctx.textAlign='center';
    ctx.fillText(unlocked?'FINISH':`${remaining} APPLE${remaining===1?'':'S'}`,x,y-51);
  }

  function drawWheel(point) {
    ctx.save(); ctx.translate(Math.round(point.x),Math.round(point.y));
    for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
      const distance = Math.hypot(x,y);
      if (distance <= 6.5 && distance >= 4.7) pixelRect(x*2,y*2,2,2,'#203332');
      else if (distance < 4.7 && distance >= 3.5) pixelRect(x*2,y*2,2,2,'#b9c4af');
    }
    const phase = Math.round((point.spin || 0) / (Math.PI / 4)) * Math.PI / 4;
    for (let i = 0; i < 4; i++) {
      const spoke = phase + i * Math.PI / 2;
      pixelPath([[0,0],[Math.cos(spoke)*8,Math.sin(spoke)*8]],'#657a70',1);
    }
    pixelRect(-2,-2,4,4,'#f1cb91');
    ctx.restore();
  }

  function drawBackground({ width, height, palette, cameraX = 0, cameraY = 0, full = true }) {
    const weather = palette.weather || {};
    const rain = Math.max(0, Math.min(1, Number(weather.rain) || 0));
    const lightning = Math.max(0, Math.min(1, Number(weather.lightning) || 0));
    const cloudiness = Math.max(0, Math.min(1, weather.clouds ?? .35));
    const light = sunLight({ width, cameraX, cameraY, weather });
    const storminess = Math.max(rain, lightning);

    ctx.fillStyle = palette.sky; ctx.fillRect(0, 0, width, height);
    if (light.sunshine > 0) {
      ctx.save();
      ctx.globalAlpha = light.strength;
      drawPixelDisc(light.x, light.y, 28 + light.sunshine * 8, palette.sun, 6);
      ctx.restore();
    }
    if (cloudiness > 0) {
      const spacing = 300 - cloudiness * 190;
      const scale = .62 + cloudiness * .65;
      const firstCloud = Math.floor(cameraX * .07 / spacing) - 1;
      for (let index = firstCloud; index < firstCloud + Math.ceil(width / spacing) + 2; index++) {
        const x = index * spacing + 55 - cameraX * .07;
        const y = 64 + Math.sin(index * 4) * 22 - cameraY * .08;
        ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
        ctx.globalAlpha = .42 + cloudiness * .5;
        const cloudColor = storminess > .15 ? '#bdc8c3' : '#f8f7e9';
        pixelRect(0,0,54,6,cloudColor,6);
        pixelRect(12,-6,24,6,cloudColor,6);
        pixelRect(30,6,42,6,cloudColor,6);
        ctx.restore();
      }
    }

    if (full) {
      const layers = [
      { color: palette.mountain, base: 201, amp: 37, frequency: .009, parallax: .16 },
      { color: '#8ea997', base: 247, amp: 24, frequency: .015, parallax: .29 }
    ];
    const mountainY = (worldX, layer) => layer.base + Math.sin(worldX * layer.frequency + 1.7) * layer.amp + Math.sin(worldX * layer.frequency * 2.1) * 10;
    for (const layer of layers) {
      const step = 8;
      const first = Math.floor(cameraX * layer.parallax / step) - 1;
      const count = Math.ceil(width / step) + 3;
      ctx.fillStyle = layer.color; ctx.beginPath();
      let previousY = height, lastX = 0;
      for (let index = first; index < first + count; index++) {
        const worldX = index * step;
        const x = worldX - cameraX * layer.parallax;
        const y = Math.round(mountainY(worldX, layer) / 3) * 3 - cameraY * layer.parallax;
        if (index === first) { ctx.moveTo(x, height); ctx.lineTo(x, y); }
        else { ctx.lineTo(x, previousY); ctx.lineTo(x, y); }
        previousY = y; lastX = x;
      }
      ctx.lineTo(lastX, height); ctx.closePath(); ctx.fill();
    }

      const treeLayer = layers[1];
      const spacing = 100;
      const firstTree = Math.floor(cameraX * treeLayer.parallax / spacing) - 1;
      const treeCount = Math.ceil(width / spacing) + 3;
      for (let index = firstTree; index < firstTree + treeCount; index++) {
        const worldX = index * spacing;
        const x = worldX - cameraX * treeLayer.parallax;
        const y = Math.round(mountainY(worldX, treeLayer) / 3) * 3 - cameraY * treeLayer.parallax;
        ctx.save(); ctx.translate(x, y);
        pixelRect(-2,-28,4,28,'#708b78');
        drawPixelDisc(0,-34,14,'#78977b',4);
        drawPixelDisc(-10,-29,10,'#78977b',4);
        drawPixelDisc(10,-28,10,'#78977b',4);
        ctx.restore();
      }
    }
    if (storminess > 0) {
      ctx.fillStyle = `rgba(38, 55, 62, ${storminess * .2})`;
      ctx.fillRect(0, 0, width, height);
    }
  }

  function rectDownTo(x, top, width, color, pixel, groundOffset) {
    for (let column = 0; column < width; column += pixel) {
      const bottom = groundOffset(x + column + pixel / 2);
      if (bottom <= top) continue;
      pixelRect(x + column, top, pixel, bottom - top, color, pixel);
    }
  }

  function rectAboveGround(x, y, width, height, color, pixel, groundOffset) {
    for (let column = 0; column < width; column += pixel) {
      const bottom = Math.min(y + height, groundOffset(x + column + pixel / 2));
      if (bottom <= y) continue;
      pixelRect(x + column, y, pixel, bottom - y, color, pixel);
    }
  }

  function drawProp(type, x, y, alpha = 1, slope = 0, groundOffset = () => 0) {
    ctx.save(); ctx.translate(Math.round(x/2)*2,Math.round(y/2)*2); ctx.rotate(propDrawAngle(type, slope));
    ctx.globalAlpha=alpha;
    if(type==='tree'){
      rectDownTo(-4,-44,8,'#66543f',2,groundOffset);
      drawPixelDisc(-8,-52,14,'#477158',4); drawPixelDisc(8,-56,16,'#568061',4); drawPixelDisc(0,-70,12,'#618b66',4);
    } else if(type==='fence'){
      pixelRect(-22,-26,4,26,'#856d4f',2); pixelRect(18,-26,4,26,'#856d4f',2);
      pixelRect(-24,-20,46,4,'#aa8a60',2); pixelRect(-24,-10,46,4,'#aa8a60',2);
    } else if(type==='rock'){
      pixelRect(-16,-8,34,8,'#697872',2); pixelRect(-10,-14,22,6,'#7f8d83',2); pixelRect(-4,-18,10,4,'#aeb5a7',2);
    } else if(type==='flowers'){
      for(let index=-2;index<=2;index++){
        const offset=index*6, height=8+(Math.abs(index)%2)*4, drop=groundOffset(offset+1);
        pixelRect(offset,-height+drop,2,height,'#58784d',2);
        pixelRect(offset-2,-height-4+drop,6,4,index%2?'#f1b95d':'#e8755b',2);
      }
    } else if(type==='stump'){
      rectDownTo(-10,-14,20,'#806244',2,groundOffset);
      rectAboveGround(-10,-16,20,4,'#c39664',2,groundOffset);
      rectAboveGround(-4,-16,8,2,'#76573d',2,groundOffset);
    } else if(type==='crystal'){
      pixelPath([[-14,groundOffset(-14)],[-8,-28],[0,-40],[8,-24],[14,groundOffset(14)]],'#83d1ce',3);
      pixelPath([[0,-36],[0,-4]],'#d9ffff',1);
    }
    ctx.restore();
  }

  function drawBike({ rear, front, mx, my, angle, length, flipVisual = 1, facing = 1, brakePressure = 0, state = 'ready', leanVisual = 0, rider = 'max' }) {
    drawWheel(rear); drawWheel(front);
    const pixelAngle = Math.round(angle / (TAU / 32)) * (TAU / 32);
    ctx.save(); ctx.translate(Math.round(mx),Math.round(my)); ctx.rotate(pixelAngle); ctx.scale(flipVisual,1);
    const half = length / 2;
    const backCompression = facing > 0 ? rear.compression || 0 : front.compression || 0;
    const frontCompression = facing > 0 ? front.compression || 0 : rear.compression || 0;
    const bodyDrop = (backCompression + frontCompression) * .4;
    const bodyPitch = (frontCompression - backCompression) * .0096;
    const pc = Math.cos(bodyPitch), ps = Math.sin(bodyPitch);
    const bodyPoint = (x,y) => [x*pc-y*ps,x*ps+y*pc+bodyDrop];
    const backMount = bodyPoint(-9,-15), frontMount = bodyPoint(12,-23);
    const crank = bodyPoint(-3,-1);

    pixelPath([[-half,0],bodyPoint(-7,-18),bodyPoint(13,-17),[half,0]],'#d95832',2);
    pixelPath([[-half,0],crank,[half,0]],'#ed7842',2);
    pixelPath([[-half,0],backMount],'#819084',1);
    pixelPath([[half,0],frontMount],'#b9c4af',2);
    drawPixelSpring(-half,0,backMount[0],backMount[1],'#f0b45f');
    drawPixelSpring(half,0,frontMount[0],frontMount[1],'#f0b45f');

    ctx.save(); ctx.translate(0,Math.round(bodyDrop/2)*2); ctx.rotate(bodyPitch);
    pixelRect(-9,-20,24,4,'#ee6f3f');
    pixelRect(-17,-24,14,4,'#263a35');
    pixelRect(-20,-27,5,5,brakePressure > .08 ? '#ff6045' : '#713c35',2);
    if (brakePressure > .6) pixelRect(-19,-26,3,3,'#ffd0a2',1);
    pixelPath([[10,-23],[18,-26],[24,-26]],'#263a35',2);
    pixelRect(-9,-8,12,10,'#435a52');
    pixelRect(-5,-4,10,6,'#2f463d');
    pixelRect(-3,-2,6,6,'#edb466');

    if(state!=='ragdoll'){
      const shift = Math.round(leanVisual * 4.5) * 2;
      const isMaxine = rider === 'Maxine';
      const jacket = isMaxine ? '#d86f82' : '#e8e5d9';
      const jacketLight = isMaxine ? '#ef9aa8' : '#fff8e7';
      const trousers = isMaxine ? '#39435d' : '#29464e';
      const helmet = isMaxine ? '#63aa98' : '#f4a442';
      const helmetLight = isMaxine ? '#a8dfcf' : '#ffd078';
      const skin = '#bd7954';

      pixelPath([[-8+shift,-24],[4+shift*.45,-14],[-2,-3]],trousers,3);
      pixelRect(-5,-6,10,4,'#233630');
      pixelPath([[-8+shift,-25],[1+shift,-37]],'#263b36',5);
      pixelPath([[-7+shift,-25],[2+shift,-37]],jacket,3);
      pixelRect(-6+shift,-38,14,12,jacket);
      pixelRect(-4+shift,-38,10,4,jacketLight);
      pixelPath([[3+shift,-35],[11+shift*.45,-30],[20,-25]],skin,2);
      pixelPath([[2+shift,-36],[10+shift*.45,-31]],jacketLight,2);

      pixelRect(0+shift,-46,8,8,skin);
      pixelRect(-4+shift,-52,14,12,'#263b36');
      pixelRect(-2+shift,-52,12,10,helmet);
      pixelRect(0+shift,-52,8,4,helmetLight);
      pixelRect(6+shift,-48,8,4,'#234844');
      pixelRect(8+shift,-42,6,2,'#efb36b');
    }
    ctx.restore();
    ctx.restore();
  }

  return { drawApple, drawFlag, drawBike, drawProp, drawBackground };
}
