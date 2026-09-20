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
