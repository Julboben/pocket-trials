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

  /** @type {{ gold: number, silver: number, bronze: number } | null} */
  let medalTimes = null;
  let shownMedal = "";
  let lastTimer = "",
    toastUntil = 0,
    splitUntil = 0,
    achievementUntil = 0;
  /** @type {string[]} achievement names waiting for their turn on screen */
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
   * The timer's second row holds one thing: a fresh split against the ghost,
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

  /**
   * Announces an earned achievement in its own toast, so it never hides the
   * game's own messages. Several in a row take turns.
   */
  function achievement(name) {
    achievementQueue.push(name);
    if (!achievementUntil) nextAchievement(performance.now());
  }

  function nextAchievement(now) {
    const pill = $("achievement-toast");
    const name = achievementQueue.shift();
    if (name === undefined) {
      pill.classList.remove("visible");
      achievementUntil = 0;
      return;
    }
    pill.textContent = "Achievement · " + name;
    pill.classList.add("visible");
    achievementUntil = now + 3200;
    announce("Achievement earned: " + name + ".");
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
   *   flips: number, apples: number, primaryLabel: string, restartKey: string,
   *   author?: string
   * }} result
   */
  function showResults(result) {
    const { time, previousBest, rank, medals, medal } = result;
    resultsId++;
    localRank = rank;
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
    // A world rank replaces the local one once the server has timed the run.
    if (result.worldPending) {
      $("results-rank-label").textContent = "WORLD RANK";
      $("results-rank").textContent = "…";
    } else showLocalRank();
    $("results-rival").hidden = true;
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
        (rank && !result.worldPending ? " Leaderboard rank " + rank + "." : "") +
        (medal ? " " + medal + " medal." : "") +
        (author ? " Trail by " + author + "." : ""),
    );
  }

  /** Bumped by every results screen, so a late world rank can't land on the next one. */
  let resultsId = 0;
  /** @type {number | null} */
  let localRank = null;

  function showLocalRank() {
    $("results-rank-label").textContent = "LOCAL RANK";
    $("results-rank").textContent = localRank ? "#" + localRank : "—";
  }

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
    if (!standing) {
      showLocalRank();
      return dialog.open;
    }
    $("results-rank-label").textContent = "WORLD RANK";
    $("results-rank").textContent = "#" + standing.rank + " / " + standing.total;
    const rival = rivalText(standing);
    $("results-rival").textContent = rival;
    $("results-rival").hidden = !rival;
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
