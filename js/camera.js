// @ts-check
import { clamp, lerp } from './config.js';

export function createCamera() {
  const camera = {
    x: 0, y: 0,
    shake: 0, shakeTime: 0,
    reset() { camera.x = 0; camera.y = 0; camera.shake = 0; },
    /** Adds screen shake in world units; it decays on its own. */
    kick(amount) { camera.shake = Math.min(10, Math.max(camera.shake, amount)); },
    /**
     * @param {{ x: number, y: number }} focus
     * @param {{ facing: number, loose: boolean, width: number, height: number, dt: number }} options
     */
    follow(focus, { facing, loose, width, height, dt }) {
      const lead = clamp(width * .3, 95, width / 2);
      const targetX = Math.max(0, loose ? focus.x - width / 2 : focus.x - (facing > 0 ? lead : width - lead));
      const targetY = clamp(focus.y - height * .67, -height * .42, loose ? 500 : 100);
      const smoothing = 1 - Math.exp(-8 * dt);
      camera.x = lerp(camera.x, targetX, smoothing);
      camera.y = lerp(camera.y, targetY, smoothing);
      camera.shakeTime += dt;
      camera.shake = Math.max(0, camera.shake - dt * 28);
    },
    /** The camera position with shake applied. */
    view() {
      let x = camera.x, y = camera.y;
      if (camera.shake > .5) {
        x += Math.sin(camera.shakeTime * 71) * camera.shake;
        y += Math.cos(camera.shakeTime * 53) * camera.shake * .7;
      }
      return { x, y };
    }
  };
  return camera;
}
