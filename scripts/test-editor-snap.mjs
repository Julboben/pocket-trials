import { gridSpacing, snapToAngleAndGrid } from '../js/editor-snap.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` ${detail}` : ''}`);
  if (!ok) failures++;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const onGrid = (value, spacing) => near(value / spacing, Math.round(value / spacing), 1e-9);
const degrees = (from, to) => Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;

check('the grid matches the one the editor draws', gridSpacing(1) === 50 && gridSpacing(.5) === 100);

// Without an anchor a point snaps to the nearest grid intersection.
{
  const s = snapToAngleAndGrid({ x: 123, y: -78 }, [], 50);
  check('no anchor: nearest grid intersection', s.x === 100 && s.y === -100 && s.anchor === null);
}

// Horizontal and vertical stay perfectly straight.
{
  const anchor = { x: 13, y: 27 };
  const h = snapToAngleAndGrid({ x: 171, y: 31 }, [anchor], 50);
  check('near-horizontal locks to 0 degrees', h.y === anchor.y && onGrid(h.x, 50) && h.angle === 0, `(${h.x}, ${h.y})`);
  const v = snapToAngleAndGrid({ x: 16, y: -140 }, [anchor], 50);
  check('near-vertical locks to -90 degrees', v.x === anchor.x && onGrid(v.y, 50) && v.angle === -90, `(${v.x}, ${v.y})`);
}

// A 45 degree drag from a grid point lands on a grid intersection.
{
  const s = snapToAngleAndGrid({ x: 152, y: 141 }, [{ x: 0, y: 0 }], 50);
  check('diagonal lands on the grid', near(s.x, 150) && near(s.y, 150) && near(s.angle, 45) && near(s.length, Math.hypot(150, 150)));
}

// Any snapped result is on a multiple of the angle step and on a grid line.
{
  let bad = 0, count = 0;
  for (let x = -400; x <= 400; x += 23) for (let y = -400; y <= 400; y += 29) {
    const anchor = { x: 17.5, y: -8.25 };
    if (Math.hypot(x - anchor.x, y - anchor.y) < 30) continue;
    count++;
    const s = snapToAngleAndGrid({ x, y }, [anchor], 50);
    const angle = degrees(anchor, s);
    const stepped = near(angle / 15, Math.round(angle / 15), 1e-6);
    if (!stepped || !(onGrid(s.x, 50) || onGrid(s.y, 50)) || s.length <= 0) bad++;
  }
  check('every result is on a 15 degree ray and a grid line', bad === 0, `(${bad} of ${count} bad)`);
}

// It never folds back through the anchor, nor collapses onto it.
{
  const anchor = { x: 10, y: 0 };
  const s = snapToAngleAndGrid({ x: 20, y: 1 }, [anchor], 50);
  check('a tiny drag still moves away from the anchor', s.x > anchor.x && s.length > 0, `(${s.x})`);
  const back = snapToAngleAndGrid({ x: 0, y: 1 }, [anchor], 50);
  check('and in the direction of the pointer', back.x < anchor.x, `(${back.x})`);
}

// With two anchors the nearer result wins.
{
  const s = snapToAngleAndGrid({ x: 500, y: 20 }, [{ x: 0, y: 0 }, { x: 500, y: 400 }], 50);
  check('the anchor giving the nearest result is used', s.anchor.x === 0 && s.y === 0 && s.x === 500);
}

// The pointer sitting exactly on an anchor is harmless.
{
  const s = snapToAngleAndGrid({ x: 5, y: 5 }, [{ x: 5, y: 5 }], 50);
  check('pointer on the anchor falls back to the grid', s.x === 0 && s.y === 0 && s.anchor === null);
}

console.log(failures ? `\n${failures} failing` : '\nEditor snap tests passed.');
process.exit(failures ? 1 : 0);
