// @ts-check
// In-game DOM: HUD pills, toast, pause screen and the results screen.
import { $, timeText, runTimeText, deltaText } from "../state.js";
import { MEDALS, normalizeAuthor } from "../trail-schema.js";

export function createOverlay() {
  const dialog = /** @type {HTMLDialogElement} */ ($("overlay"));
  const toasts = /** @type {HTMLElement} */ (document.querySelector(".toast-stack"));
  const toastHome = /** @type {HTMLElement} */ (toasts.parentElement);
  const toastNext = toasts.nextSibling;
  // Escape opens the menu (handled by the game), never just the dialog.
  dialog.addEventListener("cancel", (event) => event.preventDefault());

  /** The modal sits in the top layer; toasts move in with it to stay visible. */
  function openDialog() {
    if (!dialog.open) dialog.showModal();
    dialog.append(toasts);
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
    if (toasts.parentElement !== toastHome) toastHome.insertBefore(toasts, toastNext);
  }

  let lastTimer = "",
    toastUntil = 0,
    splitUntil = 0;

  function setTrail(name, marker, total) {
    $("scene-label").textContent = name.toUpperCase();
    $("scene-label").dataset.trailNumber = marker;
    setApples(0, total);
    $("toast").classList.remove("visible");
    toastUntil = 0;
    $("split").hidden = true;
    splitUntil = 0;
    lastTimer = "";
  }

  function setApples(collected, total) {
    $("apple-count").textContent = collected + " / " + total;
  }

  function setTimer(seconds) {
    const text = timeText(seconds);
    if (text !== lastTimer) {
      $("timer").textContent = text;
      lastTimer = text;
    }
  }

  /** @param {string} [icon] a pixel icon shown after the message */
  function toast(message, duration = 2600, icon) {
    $("toast").textContent = message;
    if (icon) $("toast").dataset.iconAfter = icon;
    else delete $("toast").dataset.iconAfter;
    toastUntil =
      duration === Infinity ? Infinity : performance.now() + duration;
    $("toast").classList.add("visible");
  }

  function clearToast() {
    $("toast").classList.remove("visible");
    toastUntil = 0;
  }

  /** Split against the ghost at an apple: negative is ahead. */
  function split(delta) {
    const pill = $("split");
    pill.textContent = deltaText(delta);
    pill.classList.toggle("ahead", delta <= 0);
    pill.classList.toggle("behind", delta > 0);
    pill.hidden = false;
    splitUntil = performance.now() + 2500;
  }

  function tick(now) {
    if (toastUntil && now > toastUntil) clearToast();
    if (splitUntil && now > splitUntil) {
      $("split").hidden = true;
      splitUntil = 0;
    }
  }

  function announce(text) {
    $("announcer").textContent = text;
  }

  function setDirection(facing) {
    const left = $("left-control"),
      right = $("right-control");
    const facingRight = facing > 0;
    /** @type {HTMLElement} */ (left.querySelector(".caption")).textContent =
      facingRight ? "LEAN BACK" : "LEAN FWD";
    /** @type {HTMLElement} */ (right.querySelector(".caption")).textContent =
      facingRight ? "LEAN FWD" : "LEAN BACK";
    left.setAttribute(
      "aria-label",
      (facingRight ? "Lean back" : "Lean forward") + ", left arrow",
    );
    right.setAttribute(
      "aria-label",
      (facingRight ? "Lean forward" : "Lean back") + ", right arrow",
    );
  }

  function showPause(visible) {
    $("pause-overlay").hidden = !visible;
    if (visible) announce("Paused. Press P or Escape to resume.");
  }

  function hide() {
    closeDialog();
    $("pause-overlay").hidden = true;
  }

  /** Shows the results modal again without recomputing it. */
  function reopen() {
    openDialog();
  }

  /**
   * @param {{
   *   official: boolean, bonus?: boolean, time: number, previousBest: number | null, rank: number | null,
   *   medals?: { gold: number, silver: number, bronze: number }, medal: string | null,
   *   flips: number, apples: number, primaryLabel: string, restartKey: string,
   *   author?: string
   * }} result
   */
  function showResults(result) {
    const { time, previousBest, rank, medals, medal } = result;
    const record = previousBest === null || time < previousBest;
    $("overlay-badge").textContent = result.official
      ? "TRAIL COMPLETED"
      : result.bonus
        ? "BONUS TRAIL COMPLETED"
        : "CUSTOM TRAIL COMPLETED";
    const sideNote = result.official
      ? ""
      : (result.bonus ? "Bonus" : "Custom") +
        " trails do not affect career progression.";
    $("overlay-title").textContent =
      record && previousBest !== null ? "New Best!" : "Goal Reached!";
    const author = normalizeAuthor(result.author);
    $("results-credit").textContent = author ? "TRAIL BY " + author.toUpperCase() : "";
    $("results-credit").hidden = !author;
    $("results").hidden = false;
    $("results-time").textContent = runTimeText(time);
    const delta = $("results-delta");
    delta.textContent =
      previousBest === null ? "FIRST FINISH" : deltaText(time - previousBest);
    delta.className =
      "results-delta " +
      (previousBest === null ? "" : time <= previousBest ? "ahead" : "behind");
    const medalLabel = $("results-medal");
    medalLabel.dataset.medal = medals ? medal || "none" : "";
    medalLabel.textContent = medals
      ? medal
        ? medal.toUpperCase() + " MEDAL"
        : "NO MEDAL"
      : "";
    $("results-rank").textContent = rank ? "#" + rank : "—";
    $("results-best").textContent = runTimeText(record ? time : previousBest);
    $("results-flips").textContent = String(result.flips);
    const targets = medals
      ? MEDALS.map((name) => {
          const item = document.createElement("li");
          item.textContent = name.toUpperCase() + " " + timeText(medals[name]);
          item.classList.toggle("reached", time <= medals[name]);
          return item;
        })
      : [];
    $("results-targets").replaceChildren(...targets);
    const next =
      medals && !medal
        ? medals.bronze
        : medals && medal !== "gold"
          ? medals[MEDALS[MEDALS.indexOf(medal) - 1]]
          : null;
    $("overlay-description").textContent = next
      ? "Shave " +
        (Math.ceil((time - next) * 10 - 1e-9) / 10).toFixed(1) +
        "s for the next medal." +
        (sideNote ? " " + sideNote : "")
      : sideNote;
    $("overlay-description").hidden = !$("overlay-description").textContent;
    $("primary").textContent = result.primaryLabel;
    $("secondary").textContent = "Retry Trail";
    $("secondary").hidden = false;
    $("results-hint").textContent =
      "Press " + result.restartKey + " to retry · Enter to continue";
    $("results-hint").hidden = false;
    $("pause-overlay").hidden = true;
    openDialog();
    announce(
      "Trail complete in " +
        runTimeText(time) +
        ". All " +
        result.apples +
        " apples collected." +
        (record ? " New best time." : "") +
        (rank ? " Leaderboard rank " + rank + "." : "") +
        (medal ? " " + medal + " medal." : "") +
        (author ? " Trail by " + author + "." : ""),
    );
  }

  return {
    setTrail,
    setApples,
    setTimer,
    toast,
    clearToast,
    split,
    tick,
    announce,
    setDirection,
    showPause,
    hide,
    reopen,
    showResults,
  };
}
