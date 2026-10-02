// Street and building-site props. Like every prop they sit on the 2-unit art
// grid, have no outlines, and are lit from the right: shaded on the left and
// underneath. Static parts are drawn once into sprites by drawing.js; the parts
// that move, light up or follow the ground are drawn live from the constants
// exported here.

// Galvanised steel, from the rock greys.
export const STEEL = {
  dark: "#4a524d",
  base: "#697872",
  mid: "#8b978c",
  light: "#aeb5a7",
};
const RUBBER = { dark: "#3a403d", base: "#4a524d", light: "#5b645e" };
const PAINT = { dark: "#3f6f78", base: "#568f98", light: "#83d1ce" };
// Traffic-cone orange is the collectible apple's, but a cone is large, striped
// and never glows, so the two don't get confused.
const CONE = { shade: "#c9573a", base: "#ed774e", light: "#ffc295" };
const WHITE = { shade: "#f4e9d1", base: "#fffdf4" };
const YELLOW = { dark: "#d9953a", base: "#f1b95d", light: "#ffe39a" };
const CONCRETE = { dark: "#697872", base: "#8b978c", light: "#aeb5a7" };
const WOOD = { dark: "#4d3f2f", base: "#66543f", plank: "#806244", light: "#856d4f", tip: "#aa8a60", cut: "#c39664" };
const BRICK = { dark: "#71392f", base: "#8d493d", light: "#a65a49" };
// The light a lamp throws after dark.
export const LAMP_LIGHT = { glass: "#fff3be", core: "#fffdf4", beam: "#ffe39a" };

// A horizontal tube: lit top, shaded underside.
function tube({ pixelRect }, x, y, width, c = STEEL) {
  pixelRect(x, y, width, 2, c.light, 2);
  pixelRect(x, y + 2, width, 2, c.base, 2);
}

// 20 × 24, a striped traffic cone on a square rubber foot.
export function drawCone({ pixelRect }) {
  const halfWidths = [2, 2, 4, 4, 4, 6, 6, 6, 8, 8];
  halfWidths.forEach((half, row) => {
    const y = -24 + row * 2;
    const striped = row === 3 || row === 4 || row === 7;
    const c = striped
      ? { shade: WHITE.shade, base: WHITE.base, light: WHITE.base }
      : CONE;
    pixelRect(-half, y, half * 2, 2, c.base, 2);
    pixelRect(-half, y, half >= 6 ? 4 : 2, 2, c.shade, 2);
    if (half >= 4) pixelRect(half - 4, y, 2, 2, c.light, 2);
  });
  pixelRect(-10, -4, 20, 4, RUBBER.base, 2);
  pixelRect(-10, -4, 2, 4, RUBBER.dark, 2);
  pixelRect(-2, -4, 10, 2, RUBBER.light, 2);
  pixelRect(-10, -2, 20, 2, RUBBER.dark, 2);
}

// 84 × 46, a steel crowd-control barrier on two flat feet.
export function drawBarrier(tools) {
  const { pixelRect } = tools;
  // Infill bars first, so the rails cover their ends.
  for (let x = -30; x <= 28; x += 6) {
    pixelRect(x, -40, 2, 30, STEEL.base, 2);
    pixelRect(x, -40, 2, 2, STEEL.mid, 2);
  }
  tube(tools, -36, -44, 72);
  tube(tools, -36, -14, 72);
  pixelRect(-36, -10, 72, 2, STEEL.base, 2);
  // End frames: shaded left tube, lit right tube.
  pixelRect(-38, -44, 4, 40, STEEL.base, 2);
  pixelRect(-38, -44, 2, 40, STEEL.dark, 2);
  pixelRect(34, -44, 4, 40, STEEL.mid, 2);
  pixelRect(36, -44, 2, 40, STEEL.light, 2);
  // Hook that links it to the next barrier.
  pixelRect(38, -38, 4, 2, STEEL.light, 2);
  pixelRect(40, -36, 2, 4, STEEL.mid, 2);
  // Flat feet.
  for (const x of [-44, 26]) {
    pixelRect(x, -4, 18, 4, STEEL.base, 2);
    pixelRect(x, -4, 18, 2, STEEL.mid, 2);
    pixelRect(x, -2, 2, 2, STEEL.dark, 2);
    pixelRect(x + 16, -4, 2, 2, STEEL.light, 2);
  }
}

// 92 × 64, a painted skip bin on casters, its lid propped open by the rubbish.
export function drawDumpster(tools) {
  const { pixelRect, drawPixelDisc } = tools;
  // Rubbish poking out under the raised lid, drawn first.
  pixelRect(-36, -56, 10, 10, WOOD.cut, 2);
  pixelRect(-36, -56, 2, 10, WOOD.tip, 2);
  pixelRect(-34, -56, 8, 2, "#d9b884", 2);
  drawPixelDisc(-18, -48, 8, RUBBER.dark, 2);
  pixelRect(-14, -54, 2, 2, RUBBER.light, 2);
  pixelRect(-12, -52, 2, 2, RUBBER.base, 2);
  // Body.
  pixelRect(-42, -46, 84, 36, PAINT.base, 2);
  pixelRect(-42, -46, 6, 36, PAINT.dark, 2);
  pixelRect(38, -46, 2, 34, PAINT.light, 2);
  pixelRect(-42, -12, 84, 4, PAINT.dark, 2);
  // Stiffening ribs: lit top, shaded underside.
  for (const y of [-38, -24]) {
    pixelRect(-36, y, 76, 2, PAINT.light, 2);
    pixelRect(-36, y + 2, 76, 2, PAINT.dark, 2);
  }
  // Rim along the top edge.
  pixelRect(-44, -48, 88, 2, PAINT.light, 2);
  pixelRect(-44, -46, 2, 4, PAINT.dark, 2);
  // Fork pockets and a hazard plate.
  pixelRect(-30, -20, 12, 4, PAINT.dark, 2);
  pixelRect(14, -20, 12, 4, PAINT.dark, 2);
  pixelRect(0, -34, 14, 8, WHITE.shade, 2);
  pixelRect(2, -32, 2, 4, CONE.base, 2);
  pixelRect(6, -32, 2, 4, CONE.base, 2);
  pixelRect(10, -32, 2, 4, CONE.base, 2);
  // Lid: closed over the right half, stepping up to the left.
  pixelRect(0, -52, 46, 4, RUBBER.base, 2);
  pixelRect(16, -52, 30, 2, RUBBER.light, 2);
  [-52, -54, -56, -58, -60].forEach((top, step) => {
    const x = -8 - step * 8;
    pixelRect(x, top - 2, 8, 4, RUBBER.base, 2);
    pixelRect(x, top + 2, 8, 2, RUBBER.dark, 2);
  });
  pixelRect(-48, -64, 8, 4, RUBBER.base, 2);
  pixelRect(-48, -60, 8, 2, RUBBER.dark, 2);
  // Casters.
  for (const x of [-32, 28]) {
    pixelRect(x - 2, -10, 8, 2, STEEL.base, 2);
    drawPixelDisc(x + 2, -4, 4, RUBBER.dark, 2);
    pixelRect(x + 2, -6, 2, 2, STEEL.light, 2);
  }
}

// Street lamp: post at x = 0, lamp head over to the right.
export const LAMP_HEAD = { x: 22, y: -114 };
export const LAMP_BODY_BOTTOM = -10;
export function drawLamp({ pixelRect }) {
  // Plinth, down to where the live base takes over.
  pixelRect(-4, -16, 8, 6, RUBBER.base, 2);
  pixelRect(-4, -16, 2, 6, RUBBER.dark, 2);
  pixelRect(2, -16, 2, 6, STEEL.base, 2);
  // Post with a collar halfway up.
  pixelRect(-2, -112, 4, 96, RUBBER.base, 2);
  pixelRect(0, -112, 2, 96, STEEL.base, 2);
  pixelRect(-4, -64, 8, 4, RUBBER.base, 2);
  pixelRect(-4, -64, 2, 4, RUBBER.dark, 2);
  pixelRect(2, -64, 2, 2, STEEL.mid, 2);
  // Swan-neck arm.
  pixelRect(-2, -118, 4, 6, RUBBER.base, 2);
  pixelRect(0, -122, 6, 4, RUBBER.base, 2);
  pixelRect(4, -124, 14, 4, RUBBER.base, 2);
  pixelRect(4, -124, 14, 2, STEEL.base, 2);
  // Head: hood over the glass, with a finial on top.
  pixelRect(14, -122, 16, 4, RUBBER.base, 2);
  pixelRect(14, -122, 4, 4, RUBBER.dark, 2);
  pixelRect(22, -122, 8, 2, STEEL.base, 2);
  pixelRect(20, -126, 4, 4, RUBBER.base, 2);
  pixelRect(22, -126, 2, 2, STEEL.base, 2);
  pixelRect(16, -118, 12, 4, STEEL.light, 2);
  pixelRect(16, -118, 2, 4, STEEL.mid, 2);
  pixelRect(16, -114, 12, 2, RUBBER.dark, 2);
}
// Glass, lit, drawn over the sprite after dark.
export function drawLampGlass({ pixelRect }) {
  pixelRect(16, -118, 12, 4, LAMP_LIGHT.glass, 2);
  pixelRect(20, -116, 4, 2, LAMP_LIGHT.core, 2);
}

// A sparrow, 20 units long. Its feet are at y = 0 and it faces right.
const SPARROW = { wing: "#66543f", body: "#856d4f", head: "#806244", belly: "#c39664", beak: "#f1b95d", eye: RUBBER.dark, leg: "#d9953a" };
export function drawBirdPerched({ pixelRect }, peck = false) {
  const c = SPARROW;
  pixelRect(-2, -2, 2, 2, c.leg, 2);
  pixelRect(2, -2, 2, 2, c.leg, 2);
  pixelRect(-10, -8, 4, 2, c.wing, 2);
  pixelRect(-6, -8, 10, 6, c.body, 2);
  pixelRect(0, -6, 4, 4, c.belly, 2);
  pixelRect(-6, -8, 6, 4, c.wing, 2);
  pixelRect(-4, -8, 2, 2, c.body, 2);
  const hx = peck ? 4 : 2;
  const hy = peck ? -8 : -12;
  pixelRect(hx, hy, 6, 4, c.head, 2);
  pixelRect(hx + 2, hy, 4, 2, c.body, 2);
  pixelRect(hx + 4, hy + 2, 2, 2, c.eye, 2);
  pixelRect(hx + 6, hy + 2, 2, 2, c.beak, 2);
}
export function drawBirdFlying({ pixelRect }, wingsUp) {
  const c = SPARROW;
  pixelRect(-10, -6, 4, 2, c.wing, 2);
  pixelRect(-6, -8, 10, 4, c.body, 2);
  pixelRect(-2, -6, 6, 2, c.belly, 2);
  pixelRect(4, -10, 4, 4, c.head, 2);
  pixelRect(6, -10, 2, 2, c.eye, 2);
  pixelRect(8, -8, 2, 2, c.beak, 2);
  if (wingsUp) {
    pixelRect(-4, -14, 6, 6, c.wing, 2);
    pixelRect(-2, -18, 4, 4, c.wing, 2);
    pixelRect(0, -14, 2, 4, c.body, 2);
  } else {
    pixelRect(-4, -4, 6, 4, c.wing, 2);
    pixelRect(-2, 0, 4, 2, c.wing, 2);
  }
}

// Tower crane. The mast stands on x = 0, the jib reaches right.
export const CRANE_BODY_BOTTOM = -8;
// Where its warning lights sit, for after dark: mast top, jib tip, counter-jib end.
export const CRANE_LIGHTS = [
  [0, -276],
  [170, -248],
  [-70, -248],
];
export function drawCrane(tools) {
  const { pixelRect, pixelPath } = tools;
  const c = YELLOW;
  // Mast: two chords with a zigzag of bracing between them.
  const mastTop = -232;
  const mastHeight = CRANE_BODY_BOTTOM - mastTop;
  for (let y = CRANE_BODY_BOTTOM; y > mastTop; y -= 16) {
    pixelRect(-4, y - 2, 8, 2, c.dark, 2);
    const flip = ((CRANE_BODY_BOTTOM - y) / 16) % 2;
    pixelPath(
      [
        [flip ? 2 : -4, y - 2],
        [flip ? -4 : 2, y - 16],
      ],
      c.base,
      1,
      2,
    );
  }
  pixelRect(-8, mastTop, 2, mastHeight, c.dark, 2);
  pixelRect(-6, mastTop, 2, mastHeight, c.base, 2);
  pixelRect(4, mastTop, 2, mastHeight, c.base, 2);
  pixelRect(6, mastTop, 2, mastHeight, c.light, 2);

  // Pendant ties from the apex out to the jib and counter-jib.
  pixelPath([[0, -270], [110, -246]], RUBBER.base, 1, 2);
  pixelPath([[0, -270], [-62, -246]], RUBBER.base, 1, 2);
  // Apex.
  for (let row = 0; row < 7; row++) {
    const half = 2 + row;
    const y = -274 + row * 4;
    pixelRect(-half, y, half * 2, 4, c.base, 2);
    pixelRect(-half, y, 2, 4, c.dark, 2);
    if (half > 3) pixelRect(half - 2, y, 2, 4, c.light, 2);
  }

  // Jib: top and bottom chords with zigzag bracing, lit along the top.
  pixelRect(-10, -248, 182, 2, c.light, 2);
  pixelRect(-10, -246, 182, 2, c.base, 2);
  pixelRect(-10, -238, 182, 2, c.dark, 2);
  for (let x = -8; x < 170; x += 8) {
    pixelPath([[x, -244], [x + 4, -240]], c.base, 1, 2);
    pixelPath([[x + 4, -240], [x + 8, -244]], c.dark, 1, 2);
  }
  pixelRect(170, -248, 2, 12, c.base, 2);
  // Counter-jib with its stack of concrete weights.
  pixelRect(-72, -248, 62, 2, c.light, 2);
  pixelRect(-72, -246, 62, 4, c.base, 2);
  pixelRect(-72, -242, 62, 2, c.dark, 2);
  pixelRect(-70, -240, 22, 18, CONCRETE.base, 2);
  pixelRect(-70, -240, 4, 18, CONCRETE.dark, 2);
  pixelRect(-66, -240, 18, 2, CONCRETE.light, 2);
  pixelRect(-70, -232, 22, 2, CONCRETE.dark, 2);
  // Slewing ring and the driver's cab beside the mast.
  pixelRect(-10, -236, 20, 4, RUBBER.base, 2);
  pixelRect(4, -236, 6, 2, RUBBER.light, 2);
  pixelRect(10, -236, 14, 16, c.base, 2);
  pixelRect(10, -236, 2, 16, c.dark, 2);
  pixelRect(16, -232, 8, 6, PAINT.light, 2);
  pixelRect(16, -232, 2, 6, PAINT.base, 2);
  pixelRect(10, -222, 14, 2, c.dark, 2);

  // Trolley, cable, hook block and a steel beam on slings.
  pixelRect(118, -236, 10, 4, RUBBER.base, 2);
  pixelRect(124, -236, 4, 2, RUBBER.light, 2);
  pixelRect(122, -232, 2, 80, RUBBER.dark, 2);
  pixelRect(118, -152, 10, 8, c.base, 2);
  pixelRect(118, -152, 2, 8, c.dark, 2);
  pixelRect(124, -152, 4, 2, c.light, 2);
  pixelRect(122, -144, 2, 6, STEEL.base, 2);
  pixelRect(120, -140, 2, 2, STEEL.base, 2);
  pixelPath([[122, -138], [104, -122]], RUBBER.dark, 1, 2);
  pixelPath([[122, -138], [140, -122]], RUBBER.dark, 1, 2);
  pixelRect(96, -122, 54, 6, "#d63b2c", 2);
  pixelRect(96, -122, 54, 2, "#e8755b", 2);
  pixelRect(96, -118, 54, 2, "#a8322a", 2);
  pixelRect(96, -122, 2, 6, "#a8322a", 2);
}
// Concrete footing below the mast, drawn live so it follows the ground.
export const CRANE_FOOTING = CONCRETE;

// Scaffolding: three standards and two lifts of plank decking.
export const SCAFFOLD_STANDARDS = [-44, -2, 40];
export const SCAFFOLD_TOP = -142;
export function drawScaffoldDecks(tools) {
  const { pixelRect, pixelPath } = tools;
  // Braces first, behind the tubes.
  pixelPath([[-40, -8], [-6, -56]], STEEL.base, 1, 2);
  pixelPath([[2, -64], [36, -112]], STEEL.base, 1, 2);
  for (const deck of [-62, -118]) {
    // Ledger tube under the deck, guard rail above it.
    tube(tools, -48, deck + 6, 96);
    tube(tools, -48, deck - 20, 96);
    // Planks: lit top, shaded underside, with butt joints.
    pixelRect(-50, deck, 100, 6, WOOD.light, 2);
    pixelRect(-50, deck, 100, 2, WOOD.tip, 2);
    pixelRect(-50, deck + 4, 100, 2, WOOD.base, 2);
    pixelRect(-50, deck, 2, 6, WOOD.base, 2);
    for (const joint of [-18, 16]) pixelRect(joint, deck, 2, 6, WOOD.dark, 2);
  }
  // Bricks stacked on the lower lift.
  for (const [x, y] of [[-34, -70], [-24, -70], [-14, -70], [-29, -78], [-19, -78]]) {
    pixelRect(x, y, 10, 8, BRICK.base, 2);
    pixelRect(x, y, 10, 2, BRICK.light, 2);
    pixelRect(x, y, 2, 8, BRICK.dark, 2);
  }
  // A paint bucket on the upper lift.
  pixelRect(18, -130, 12, 12, WHITE.base, 2);
  pixelRect(18, -130, 4, 12, WHITE.shade, 2);
  pixelRect(18, -132, 12, 2, STEEL.mid, 2);
  pixelRect(24, -126, 2, 6, PAINT.base, 2);
  pixelRect(22, -136, 8, 2, STEEL.base, 2);
}
// Couplers where the tubes clamp to the standards, drawn over them.
export function drawScaffoldCouplers({ pixelRect }) {
  for (const x of SCAFFOLD_STANDARDS)
    for (const y of [-56, -82, -112, -138])
      pixelRect(x, y, 4, 4, STEEL.dark, 2);
}

// Graffiti piece reading "R⊙LL", the O being the Hjulben wheel.
const GRAFFITI_R = [
  "#######...",
  "########..",
  "###...###.",
  "###...###.",
  "###...###.",
  "########..",
  "#######...",
  "###.###...",
  "###..###..",
  "###..###..",
  "###...###.",
  "###...###.",
  "###....###",
  "###....###",
];
const GRAFFITI_L = [
  "###.....",
  "###.....",
  "###.....",
  "###.....",
  "###.....",
  "###.....",
  "###.....",
  "###.....",
  "###.....",
  "###.....",
  "###.....",
  "########",
  "########",
  "########",
];
export const GRAFFITI_BOUNDS = [-58, -26, 58, 36];
const GRAFFITI_COLORS = {
  bubble: PAINT.base,
  bubbleShade: PAINT.dark,
  top: CONE.base,
  bottom: YELLOW.base,
  shine: YELLOW.light,
  block: WOOD.dark,
  star: WHITE.base,
};

function drawGlyph({ pixelRect }, glyph, left, top) {
  const g = GRAFFITI_COLORS;
  const filled = (col, row) => glyph[row]?.[col] === "#";
  // 3D block, falling down and to the left, away from the light.
  glyph.forEach((line, row) => {
    for (let col = 0; col < line.length; col++)
      if (filled(col, row))
        pixelRect(left + col * 2 - 4, top + row * 2 + 4, 2, 2, g.block, 2);
  });
  glyph.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      if (!filled(col, row)) continue;
      let color = row < glyph.length / 2 ? g.top : g.bottom;
      if (!filled(col + 1, row) || !filled(col, row - 1)) color = g.shine;
      pixelRect(left + col * 2, top + row * 2, 2, 2, color, 2);
    }
  });
}

export function drawGraffiti(tools) {
  const { pixelRect, pixelPath, drawPixelDisc } = tools;
  const g = GRAFFITI_COLORS;
  // Sprayed cloud behind the letters, with drips running down.
  for (const [x, y, r] of [[-38, -2, 16], [-14, -6, 18], [12, -4, 18], [36, 0, 16], [-26, 8, 14], [24, 10, 14]])
    drawPixelDisc(x, y, r, g.bubble, 2);
  for (const [x, length] of [[-40, 6], [-22, 12], [6, 8], [30, 14], [44, 4]]) {
    pixelRect(x, 12, 2, 8 + length, g.bubble, 2);
    pixelRect(x, 18 + length, 2, 2, g.bubbleShade, 2);
  }
  pixelRect(-52, 2, 4, 8, g.bubbleShade, 2);
  pixelRect(-50, 10, 8, 2, g.bubbleShade, 2);

  drawGlyph(tools, GRAFFITI_R, -46, -16);
  // The O: the Hjulben wheel, knobbly tyre and orange rim, spokes and hub.
  const cx = -10, cy = -2;
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    pixelRect(cx + Math.round(Math.cos(angle) * 8) * 2 - 1, cy + Math.round(Math.sin(angle) * 8) * 2 - 1, 2, 2, RUBBER.dark, 2);
  }
  drawPixelDisc(cx - 2, cy + 2, 14, g.block, 2);
  drawPixelDisc(cx, cy, 14, RUBBER.dark, 2);
  pixelRect(cx + 10, cy - 6, 2, 8, RUBBER.light, 2);
  drawPixelDisc(cx, cy, 10, CONE.base, 2);
  drawPixelDisc(cx, cy, 8, g.bubble, 2);
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI;
    const dx = Math.cos(angle) * 8, dy = Math.sin(angle) * 8;
    pixelPath([[cx - dx, cy - dy], [cx + dx, cy + dy]], STEEL.light, 1, 2);
  }
  pixelRect(cx - 2, cy - 2, 6, 6, CONE.base, 2);
  pixelRect(cx, cy, 2, 2, RUBBER.dark, 2);
  drawGlyph(tools, GRAFFITI_L, 10, -18);
  drawGlyph(tools, GRAFFITI_L, 30, -14);
  // Glints, on the sunny side.
  for (const [x, y] of [[6, -20], [50, -20]]) {
    pixelRect(x - 2, y, 6, 2, g.star, 2);
    pixelRect(x, y - 2, 2, 6, g.star, 2);
  }
}
