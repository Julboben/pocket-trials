# Hjulben – Trails Guide

How the official career is designed: its shape, the rules every trail follows, and what building trails has taught us. For the trails still to build, see [TRAILS_PLAN.md](TRAILS_PLAN.md); for the trail file format, see [TRAIL_FORMAT.md](TRAIL_FORMAT.md); and for making the props a trail is dressed with, see [PROPS_GUIDE.md](PROPS_GUIDE.md).

---

## The shape of the career

- **Seven worlds of five trails each.** Each world has its own backdrop, material, props and sky, so the player can tell they have moved on.
- **Every trail brings one new riding element.** This is something the player has to learn: a skill, a terrain shape or a hazard.
- **Every trail also brings something new to look at.** A prop, a weather type or a time of day, so even easy trails feel fresh.
- **Inside a world:** trail 1 introduces the world gently, trails 2–4 each add one element, and trail 5 is the world's finale, which combines what the world taught.
- **Every finale is a trials event.** Trail 5 of each world is the final test of that kind of trail, so it is staged like a motocross event: spectators along the course and the event props from `PROPS_PLAN.md`, dressed in the world's own setting. See rule 6.

Every trail is closed off at both ends, so the rider can't ride out of it, and each trail does it differently: The Orchard has an overhanging bank and shelf, Apple Valley a brick orchard wall and an overhanging grass bluff, and Windfall a rock outcrop and a stack of hay bales.

---

## Rules for each trail

1. **One new riding element per trail.** Everything else on the route should be something the player has already ridden.
2. **Meet it safely first.** The first time a hazard appears there is a way around it, a floor under it, or plenty of room. Only after that does it sit on the main route.
3. **Never make the trail harder to see and harder to ride at once.** Night, fog, heavy rain, blizzards and storms only come in on trails whose riding element is mild.
4. **Teach with the world.** Signs (`SLOW`, `!`, `→`), warning props and apple placement show the line. An apple floating over a gap tells the player to jump.
5. **Gold times rise through the career.** They can dip on a world's first trail, which is a breather.
6. **Stage every finale as a trials event.** The last trail of each world (5, 10, 15, 20, 25, 30 and 35) is the final test for that world, so it looks like a motocross competition:
   - **Spectators** (`spectators`) where the rider passes close, such as at the start, beside the hardest section and near the finish. They cheer as the rider goes by and duck from a crash.
   - **Marshals** (`marshal-start` at the start, `marshal-finish` waving the checkered flag at the finish).
   - **Course dressing** from the trials-event props: `tyre-wall`, `hay-bales`, `course-tape`, `banner`, `pit-board`, `petrol-can` and `camera-tower`, chosen to fit the world. The Woods might use hay bales and course tape, the City banners and tyre walls, and the Underground lanterns and tape.
   - The props are decoration only and never change the line, so they go on the `back` layer, clear of the route. Keep spectators for the finales where you can, so they mark a world's last test.
7. **Hide the nisse off the line.** A trail can hide one optional nisse (see `TRAIL_FORMAT.md`). Put it where a player only goes on purpose, using a skill the career has already taught: behind the start, reached by turning around; on a ledge that takes a wheelie or a well-timed hop; above a low ceiling or under an overhang; at the end of a side branch; or past the finish, so you have to turn back for it. Never on the route itself, and never behind a skill the player hasn't met yet.

---

## Turning around

Turning around (`Space`, `B` on a gamepad, **Flip** on touch) swaps which wheel drives the bike but keeps its speed. A bike rolling backwards down a slope can therefore turn and drive with that roll, and it can turn in mid-air too. That gives four steps to teach, spread over the career:

1. **Turn to reach a point behind you (3, Windfall).** You start facing east, with the first apple floating high above a slope just ahead, out of reach from the ground. Ride under it, down into a bowl and partway up the long ramp beyond. Let go, and as the bike rolls back, turn and drive down. The speed carries you up a west-facing kicker that throws you up to the apple. Then the trail ends in a dead end at a stack of hay bales with the last apple. The flower hangs over a dip behind a kicker you passed on the way, so you turn once more and hop to it, which repeats the hop from Apple Valley.
2. **Turn to climb (10, Switchback).** The Woods finale stacks several roll-back turns, zig-zagging up between ramps to a tree house.
3. **Turn in the air (19, Boomerang).** Jump off a kicker, turn at the top of the jump, and land facing the other way on a ledge behind and above the takeoff.
4. **Put it all together.** Out and Back (20) needs turns on the ground and in the air. The Shaft (24) is a vertical climb made entirely of switchbacks. Elastic Summit (35) needs a switchback under pressure.

What building Windfall showed, measured in the physics:

- **A steep face doesn't force a turn.** With careful forward lean, the bike wheelies up a 60° face from a standstill, which is how the replay bot first solved it. At 65° it stops standstill climbs, but most riders coming back with speed crash on the face. Don't rely on steepness alone.
- **A floating apple does force it.** Riding straight up Windfall's kicker from the bottom of the bowl lifts the wheels at most about 50 units above the lip. Turning on the ramp and coming back down launches them 80–120 units, further west. With the apple 90 units above the lip, no run tested without a turn reaches it, while about 7 in 12 scripted turn-around runs do. The failures turned too low on the ramp, which teaches the player to go higher first.
- **Land on a downslope.** A long jump onto flat ground lands nose-up and crashes. The slope behind Windfall's kicker falls away at about 25°, and no scripted run crashed after getting the apple.
- **The greedy replay bot can't plan a turn.** It always faces the nearest apple, so it parks under one it can't reach. Windfall's replay was first recorded with a scripted opening (ride up, roll back, turn, launch). When the greedy bot can't finish a trail, `scripts/record-replays.mjs` now hands it to an explorer that finds turn-around, roll-back and launch routes by itself, so later turn trails need no scripted opening.

---

## When each element comes in

| Element | Meet | On the route | Tested |
| --- | --- | --- | --- |
| Momentum | 2 | 3 | 31 |
| Small hops | 2 | 3 | 11 |
| Turning around | 3 | 5 | 20 |
| Switchbacks (turning to climb behind you) | 3 | 10 | 24, 35 |
| Braking | 4 | 8 | 30 |
| Steep climbs | 5 | 7 | 31 |
| Wheelies | 7 | 10 | 24 |
| Drops and step-downs | 9 | 10 | 23 |
| Air control | 11 | 12 | 33 |
| Pits with a floor | 13 | 15 | 23 |
| Open gaps | 14 | 15 | 30, 33 |
| Fords | 16 | 17 | 20 |
| Deep water | 17 | 18 | 35 |
| Turning in the air | 19 | 20 | 33 |
| Low ceilings | 21 | 23 | 28 |
| Step-ups | 26 | 30 | 35 |
| Darkness | 22 | 23 | 29, 34 |
| Loops | 25 | 35 | — |
| Spikes | 27 | 28 | 30 |
| Fog | 32 | 35 | — |

## Difficulty by world

| World | Trails | Length | Widest open gap | Apples | Spikes | Gold |
| --- | --- | --- | --- | --- | --- | --- |
| First Rides | 1–5 | 2000–3800 | None | 3–4, one floating | 0 | 11–32 (out-and-back trails run longer) |
| The Woods | 6–10 | 2800–3400 | None | 4–5 | 0 | 15–21 |
| The Desert | 11–15 | 3000–3600 | 100 | 4–6, some in the air | 0 | 16–23 |
| Lakeland | 16–20 | 3000–3800 | 100 | 4–6, some behind you | 0 | 18–26 |
| Underground | 21–25 | 2400–3600 | 100 | 5–6 | 0 | 18–28 |
| The City | 26–30 | 3200–4000 | 120 | 5–7 | 2–6 | 20–30 |
| The Mountains | 31–35 | 3500–5000 | 160 | 5–8 | 2–8 | 24–40 |

---

## Building a trail

1. **Build in world order.** Finish each world before starting the next, so the difficulty is tuned against what the player has already ridden.
2. **Best times reset.** Best times and leaderboards are keyed by trail id plus a hash of the trail (`trailKey` in `js/state.js`), so rebuilt trails start from zero.
3. **Replays and medals.** Every official trail needs a replay from `node scripts/record-replays.mjs` and a passing `npm test`. Set gold times from the replay bot's times.
4. **Playtest with new players.** Note where a first-time player crashes most. If more than one crash point is something the career hasn't taught yet, the trail brings in too much.
