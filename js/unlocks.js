// What wins each reward in the game: the bonus trails and rider items that
// aren't everyone's from the start. Shared by the game, the editor and the
// server, so it stays free of the DOM.
//
// Rewards are keyed 'trail:<catalog id>' or 'look:<slot>:<item id>', and
// anything not listed is open to everyone. A rule asks for any of:
//   trails       official trails finished
//   golds        gold medals won on official trails
//   trail        a trail (by catalog id) finished
//   achievement  an achievement (see achievements.js) earned
// Every part given must be met. Keeping every rule here shows the whole
// progression in one place; scripts/test-achievements.mjs checks that each
// key and rule points at something that exists.
import { achievement } from './achievements.js';

export const UNLOCKS = Object.freeze({
  'trail:bonus:01-the-bonny-tyler': { golds: 2 },
  'trail:bonus:02-the-mining-cave': { golds: 4 },
  'look:helmet:mx': { trail: 'bonus:01-the-bonny-tyler' },
  'look:bike:classic': { golds: 8 },
});

/**
 * @typedef {{ trails?: number, golds?: number, trail?: string, achievement?: string }} UnlockRule
 * @typedef {{
 *   trails: number, golds: number,
 *   finished: (trailId: string) => boolean,
 *   has: (achievementId: string) => boolean
 * }} UnlockProgress what a career has done: official trails finished, gold
 *   medals won on them, whether a trail (by catalog id) has been finished,
 *   and whether an achievement has been earned
 */

/** @returns {UnlockRule | null} what opens a bonus or official trail, by catalog id */
export const trailUnlock = trailId => UNLOCKS['trail:' + trailId] ?? null;

/** @returns {UnlockRule | null} what wins a rider item */
export const lookUnlock = (slot, id) => UNLOCKS[`look:${slot}:${id}`] ?? null;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 'S'}`;

/**
 * Whether a career with `progress` has met `rule`, and what the rule asks
 * for in the words the menus use. No rule is open to everyone, even without
 * a career (null); any rule keeps it shut.
 * @param {UnlockRule | null} rule
 * @param {UnlockProgress | null} progress
 * @param {(trailId: string) => string} [trailName] a trail's name, for hints
 * @returns {{ open: boolean, hint: string }}
 */
export function unlockStatus(rule, progress, trailName = () => 'a trail') {
  if (!rule) return { open: true, hint: '' };
  const parts = [];
  if (rule.trails) parts.push('FINISH ' + plural(rule.trails, 'TRAIL'));
  if (rule.golds) parts.push('WIN ' + plural(rule.golds, 'GOLD MEDAL'));
  if (rule.trail) parts.push('FINISH ' + trailName(rule.trail).toUpperCase());
  if (rule.achievement) {
    const wanted = achievement(rule.achievement);
    parts.push(wanted && !wanted.secret ? `EARN “${wanted.name.toUpperCase()}”` : 'EARN A SECRET ACHIEVEMENT');
  }
  const open = Boolean(progress
    && progress.trails >= (rule.trails || 0)
    && progress.golds >= (rule.golds || 0)
    && (!rule.trail || progress.finished(rule.trail))
    && (!rule.achievement || progress.has(rule.achievement)));
  return { open, hint: parts.join(' & ') + ' TO UNLOCK' };
}
