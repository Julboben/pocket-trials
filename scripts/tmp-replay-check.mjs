// Temporary: which replay diverges, and where.
import { readJson, loadCatalogLevels, repoRoot } from "./lib/levels.mjs";
import { createRide, stepRide } from "../js/ride.js";
import { decodeInputs } from "../js/replay-codec.js";

for (const entry of loadCatalogLevels("official")) {
  const path = "tests/replays/" + entry.file.split("/").pop();
  const replay = readJson(path);
  const inputs = decodeInputs(replay.inputs);
  const ride = createRide(entry.level, { seed: replay.seed });
  let crashedAt = null;
  for (const [i, input] of inputs.entries()) {
    stepRide(ride, input);
    if (ride.status !== "running") {
      crashedAt = { step: i, status: ride.status, cause: ride.crashCause, x: Math.round(ride.rear.x), y: Math.round(ride.rear.y) };
      break;
    }
  }
  const recorded = replay.outcome;
  const ok = ride.status === recorded.status;
  console.log(
    entry.id.padEnd(22),
    "recorded:", String(recorded.status).padEnd(8),
    "got:", String(ride.status).padEnd(8),
    ok ? "ok" : `DIFF at step ${crashedAt.step} cause=${crashedAt.cause} pos=${crashedAt.x},${crashedAt.y}`,
  );
}
