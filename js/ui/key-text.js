// @ts-check
// Text that names keys, such as ["Press ", { key: "R" }, " to retry"]: shown
// with each key in a <kbd> badge, and read out as plain words.

/** @typedef {string | (string | { key: string })[]} KeyText */

/**
 * The text's nodes, for replaceChildren.
 * @param {KeyText} text
 * @returns {(string | HTMLElement)[]}
 */
export function keyTextNodes(text) {
  return [text].flat().map(part => {
    if (typeof part === 'string') return part;
    const badge = document.createElement('kbd');
    badge.textContent = part.key;
    return badge;
  });
}

/**
 * The text as words, for announcements and labels.
 * @param {KeyText} text
 */
export function keyTextWords(text) {
  return [text].flat().map(part => typeof part === 'string' ? part : part.key).join('');
}

/**
 * Keys as alternatives: [{ key: "P" }, " or ", { key: "Esc" }].
 * @param {string[]} keys
 * @returns {(string | { key: string })[]}
 */
export function keyChoices(keys) {
  return keys.flatMap((key, index) => index ? [' or ', { key }] : [{ key }]);
}
