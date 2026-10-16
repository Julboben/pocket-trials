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
    raiseAchievement();
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
    if (toasts.parentElement !== toastHome) toastHome.insertBefore(toasts, toastNext);
  }


  /** @type {{ gold: number, silver: number, bronze: number } | null} */
  let medalTimes = null;
  let shownMedal = "";
  let lastTimer = "",
    toastUntil = 0,
    splitUntil = 0,
    achievementUntil = 0;
  /** @type {{ name: string, blurb: string, icon: string }[]} achievements waiting for their turn on screen */
  const achievementQueue = [];

  /**
   * @param {{ gold: number, silver: number, bronze: number } | null} [medals]
   *   the trail's medal times; the HUD shows the best one still in reach
   */
  function setTrail(name, marker, total, medals = null) {
    medalTimes = medals;
    shownMedal = "";
    $("scene-label").textContent = name.toUpperCase();
    $("scene-label").dataset.trailNumber = marker;
    setApples(0, total);
    $("toast").classList.remove("visible");
    toastUntil = 0;
    splitUntil = 0;
    syncTimerDetail();
    lastTimer = "";
  }

  /** Marks the HUD while a recorded run plays back; null clears it. */
  function setReplay(name) {
    const label = $("replay-label");
    label.hidden = !name;
    label.textContent = name ? "Replay · " + name : "";
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
    setMedalTarget(seconds);
  }

  function setMedalTarget(seconds) {
    const medal = medalTimes ? MEDALS.find((name) => seconds <= medalTimes[name]) ?? "none" : "none";
    if (medal === shownMedal) return;
    shownMedal = medal;
    if (medal !== "none") {
      const target = $("medal-target");
      const time = timeText(medalTimes[medal]);
      target.dataset.medal = medal;
      target.textContent = time;
      target.setAttribute("aria-label", medal + " medal time " + time);
    }
    syncTimerDetail();
  }

  /**
   * The slot after the timer holds one thing: a fresh split against the ghost,
   * otherwise the next medal in reach. It hides when there is neither.
   */
  function syncTimerDetail() {
    const splitting = splitUntil > 0;
    $("split").hidden = !splitting;
    $("medal-target").hidden = splitting || shownMedal === "none";
    $("timer-detail").hidden = !splitting && shownMedal === "none";
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

  const popover = $("achievement-popover");

  /**
   * Announces an earned achievement on its own card, a popover on the top
   * layer, so it shows over the ride, the results and the menu alike and never
   * hides the game's own messages. Several in a row take turns.
   * @param {{ name: string, blurb: string, icon: string }} earned
   */
  function achievement(earned) {
    achievementQueue.push(earned);
    if (!achievementUntil) nextAchievement(performance.now());
  }

  function nextAchievement(now) {
    const earned = achievementQueue.shift();
    if (earned === undefined) {
      if (popover.matches(":popover-open")) popover.hidePopover();
      achievementUntil = 0;
      return;
    }
    $("achievement-popover-icon").dataset.icon = earned.icon;
    $("achievement-popover-name").textContent = earned.name;
    $("achievement-popover-blurb").textContent = earned.blurb;
    // Shown again for each one, so it slides in again.
    if (popover.matches(":popover-open")) popover.hidePopover();
    placeAchievement();
    popover.showPopover();
    achievementUntil = now + 4000;
    announce("Achievement earned: " + earned.name + ". " + earned.blurb);
  }

  /** The top layer is the whole window, so the card is pinned to the game's corner. */
  function placeAchievement() {
    const game = $("game").getBoundingClientRect();
    popover.style.setProperty("--game-top", game.top + "px");
    popover.style.setProperty("--game-right", window.innerWidth - game.right + "px");
  }

  /** A modal opened after the card goes above it on the top layer; this lifts the card back up. */
  function raiseAchievement() {
    if (!popover.matches(":popover-open")) return;
    popover.hidePopover();
    popover.showPopover();
  }

  /** Split against the ghost at an apple: negative is ahead. */
  function split(delta) {
    const split = $("split");
    split.textContent = deltaText(delta);
    split.classList.toggle("ahead", delta <= 0);
    split.classList.toggle("behind", delta > 0);
    splitUntil = performance.now() + 2500;
    syncTimerDetail();
  }

  function tick(now) {
    if (toastUntil && now > toastUntil) clearToast();
    if (achievementUntil && now > achievementUntil) nextAchievement(now);
    if (splitUntil && now > splitUntil) {
      splitUntil = 0;
      syncTimerDetail();
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
   *   worldPending?: boolean,
   *   medals?: { gold: number, silver: number, bronze: number }, medal: string | null,
   *   apples: number, primaryLabel: string, restartKey: string,
   *   author?: string
   * }} result
   */
  function showResults(result) {
    const { time, previousBest, rank, medals, medal } = result;
    resultsId++;
    localRank = rank;
    const record = previousBest === null || time < previousBest;
    shownBest = record ? null : previousBest;
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
    // A world rank replaces the local one once the server has timed the run.
    if (result.worldPending) showRank("WORLD", "…");
    else showLocalRank();
    // Keeps the rival line's room while the world rank loads, so nothing jumps.
    $("results-rival").textContent = "";
    $("results-rival").hidden = !result.worldPending;
    $("results").dataset.world = result.worldPending ? "loading" : "";
    // One ladder: the medal won is filled in, the others show their target times.
    const targets = medals
      ? MEDALS.map((name) => {
          const item = document.createElement("li");
          item.textContent = name.toUpperCase() + " " + timeText(medals[name]);
          item.classList.toggle("reached", time <= medals[name]);
          if (name === medal) {
            item.dataset.medal = name;
            item.setAttribute("aria-current", "true");
          }
          return item;
        })
      : [];
    $("results-medals").replaceChildren(...targets);
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
    $("primary-label").textContent = result.primaryLabel;
    $("retry-key").textContent = result.restartKey;
    $("pause-overlay").hidden = true;
    openDialog();
    announce(
      "Trail complete in " +
        runTimeText(time) +
        ". All " +
        result.apples +
        " apples collected." +
        (record ? " New best time." : "") +
        (rank && !result.worldPending ? " Leaderboard rank " + rank + "." : "") +
        (medal ? " " + medal + " medal." : "") +
        (author ? " Trail by " + author + "." : ""),
    );
  }

  /** Bumped by every results screen, so a late world rank can't land on the next one. */
  let resultsId = 0;
  /** @type {number | null} */
  let localRank = null;
  /** The player's best when this run didn't beat it, since the rank is that best's. @type {number | null} */
  let shownBest = null;

  /**
   * "LOCAL RANK #1" after a new best, or "YOUR BEST 0:09.500 · LOCAL #1" after a
   * slower run, so the rank reads as the best's and not this run's.
   * @param {string} scope "LOCAL" or "WORLD"
   * @param {string} rank "#1", or "" when there is none
   */
  function showRank(scope, rank) {
    const best = shownBest !== null;
    $("results-best").hidden = !best;
    $("results-best-time").hidden = !best;
    $("results-best-time").textContent = best ? runTimeText(/** @type {number} */ (shownBest)) : "";
    $("results-rank-sep").hidden = !best || !rank;
    $("results-rank-label").textContent = !rank ? "" : best ? scope : scope + " RANK";
    $("results-rank").textContent = rank;
    $("results-rank").parentElement.hidden = !best && !rank;
  }

  // Play-test runs and runs off the local top ten have no rank to show.
  const showLocalRank = () => showRank("LOCAL", localRank ? "#" + localRank : "");

  /** The id of the results screen on show, for showWorldStanding. */
  const currentResults = () => resultsId;

  /**
   * @typedef {{ rank: number, total: number, best: number,
   *   ahead?: { name: string, time: number } | null,
   *   behind?: { name: string, time: number } | null }} WorldStanding
   */

  /**
   * "0.420s TO PASS FREJA", or the leader's margin, from the player's best.
   * @param {WorldStanding} standing
   */
  function rivalText({ rank, best, ahead, behind }) {
    const gap = (/** @type {number} */ other) => Math.abs(other - best).toFixed(3) + "s";
    const name = (/** @type {string} */ value) => value.toUpperCase();
    if (ahead) return gap(ahead.time) + " TO PASS " + name(ahead.name);
    if (rank === 1 && behind) {
      return behind.time === best
        ? "TIED WITH " + name(behind.name) + " FOR #1"
        : "LEADING " + name(behind.name) + " BY " + gap(behind.time);
    }
    return "";
  }

  /**
   * Swaps the local rank for the world one once the server has timed the run,
   * or back to the local rank when it couldn't (`standing` null). Returns
   * false when the player has already left that results screen.
   * @param {number} id from currentResults() when the results were shown
   * @param {WorldStanding | null} standing
   */
  function showWorldStanding(id, standing) {
    if (id !== resultsId) return false;
    $("results").dataset.world = "";
    if (!standing) {
      showLocalRank();
      $("results-rival").hidden = true;
      return dialog.open;
    }
    // The server's best is the one the world rank belongs to.
    if (shownBest !== null) shownBest = standing.best;
    showRank("WORLD", "#" + standing.rank + " / " + standing.total);
    const rival = rivalText(standing);
    $("results-rival").textContent = rival;
    announce("World rank " + standing.rank + " of " + standing.total + "." + (rival ? " " + rival + "." : ""));
    return dialog.open;
  }

  return {
    setTrail,
    setReplay,
    setApples,
    setTimer,
    toast,
    clearToast,
    achievement,
    split,
    tick,
    announce,
    setDirection,
    showPause,
    hide,
    reopen,
    showResults,
    currentResults,
    showWorldStanding,
  };
}
