// The Garage behind the rider in the customizer: a quiet, low-contrast room
// (roller door, pegboard, a tyre stack and a concrete floor) so the rider and
// bike stand out. Drawn in world units on the art pixel grid, anchored to the
// bike, so every crop of a preview shows the same room.
import { ART_PIXEL } from './drawing.js';

const COLORS = {
  wall: '#5f716e',
  wallShade: '#556663',
  frame: '#465654',
  door: '#6d807b',
  doorSlat: '#5f706c',
  doorLight: '#7a8c86',
  board: '#6c6656',
  boardHole: '#5a5547',
  tool: '#8d9a95',
  toolDark: '#4a5653',
  tyre: '#2c3534',
  tyreLight: '#3e4a48',
  rim: '#7b8784',
  skirting: '#3a4746',
  floor: '#4a5754',
  floorLight: '#53615d',
  floorLine: '#414d4b',
  spot: '#58665f',
  shadow: 'rgba(16, 26, 26, 0.35)',
};

/**
 * @param {CanvasRenderingContext2D} ctx  in world units
 * @param {{ x: number, y: number, width: number, height: number }} view
 * @param {{ x: number, floor: number }} at  the bike's midpoint and the floor under its wheels
 */
export function drawGarage(ctx, view, { x, floor }) {
  const px = ART_PIXEL;
  const snap = value => Math.round(value / px) * px;
  const rect = (left, top, width, height, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(snap(left), snap(top), Math.max(px, snap(width)), Math.max(px, snap(height)));
  };
  const left = view.x - px, top = view.y - px, right = view.x + view.width + px, bottom = view.y + view.height + px;
  const back = floor - 8;

  // Wall, a shade darker towards the ceiling.
  rect(left, top, right - left, back - top, COLORS.wall);
  rect(left, top, right - left, Math.max(0, floor - 84 - top), COLORS.wallShade);

  // Roller door behind the bike.
  const doorLeft = x - 50, doorRight = x + 50, doorTop = floor - 110;
  rect(doorLeft - 4, doorTop - 4, doorRight - doorLeft + 8, back - doorTop + 4, COLORS.frame);
  rect(doorLeft, doorTop, doorRight - doorLeft, back - doorTop, COLORS.door);
  for (let y = back - 6; y > doorTop; y -= 6) {
    rect(doorLeft, y, doorRight - doorLeft, 2, COLORS.doorSlat);
    rect(doorLeft, y + 2, doorRight - doorLeft, 2, COLORS.doorLight);
  }

  // Pegboard with a few tools, to the left.
  const boardLeft = x - 82, boardTop = floor - 76;
  rect(boardLeft, boardTop, 24, 26, COLORS.board);
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++)
    rect(boardLeft + 4 + column * 8, boardTop + 4 + row * 8, 2, 2, COLORS.boardHole);
  rect(boardLeft + 4, boardTop + 6, 2, 14, COLORS.tool);
  rect(boardLeft + 2, boardTop + 4, 6, 2, COLORS.tool);
  rect(boardLeft + 12, boardTop + 6, 2, 10, COLORS.toolDark);
  rect(boardLeft + 10, boardTop + 16, 6, 4, COLORS.toolDark);
  rect(boardLeft + 18, boardTop + 6, 4, 4, COLORS.tool);
  rect(boardLeft + 19, boardTop + 10, 2, 10, COLORS.tool);

  // A stack of spare tyres, to the right.
  for (let index = 0; index < 2; index++) {
    const tyreLeft = x + 58, tyreTop = floor - 10 - index * 10;
    rect(tyreLeft + 2, tyreTop, 20, 10, COLORS.tyre);
    rect(tyreLeft, tyreTop + 2, 24, 6, COLORS.tyre);
    rect(tyreLeft + 2, tyreTop, 20, 2, COLORS.tyreLight);
    rect(tyreLeft + 8, tyreTop + 4, 8, 2, COLORS.rim);
  }

  // Concrete floor, lit under the bike.
  rect(left, back - 2, right - left, 2, COLORS.skirting);
  rect(left, back, right - left, bottom - back, COLORS.floor);
  rect(x - 60, back + 2, 120, bottom - back - 2, COLORS.floorLight);
  rect(x - 40, floor - 3, 80, bottom - floor + 3, COLORS.spot);
  for (const lineX of [x - 92, x - 52, x + 52, x + 92]) rect(lineX, floor + 4, 2, bottom - floor, COLORS.floorLine);
  rect(left, floor + 4, right - left, 2, COLORS.floorLine);

  // Soft shadow under the bike.
  rect(x - 36, floor - 2, 72, 4, COLORS.shadow);
  rect(x - 26, floor - 1, 52, 2, COLORS.shadow);
}
