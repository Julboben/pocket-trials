# Hjulben – Story Plan

A plan for a light story running through the career: **Rookie Season**. It is told in short paddock scenes between trails and doesn't touch the physics, the trails' riding lines, replays or leaderboards. Once it is built, this plan can go.

---

## 🏁 The premise

You are a rookie in your first season of the national MX series. **Holm Racing has one rookie seat for next year**, and two rookies are in the running for it: you and your rival. The career is that season: six worlds are six rounds, and each round ends in a **final** where you race your rival. The last final is on **Elastic Summit**.

You always start as a rookie. The story is the same length and has the same stakes whatever rider you make; your gender decides who your rival is.

**Tone:** dry and warm. The humour comes from the people and the situation, not from gags. The rider is competent; the jokes are never on them for who they are.

---

## 👥 Cast

- **You**: your rider name, racing as **#212** (rookies get whatever number is left).
- **Dad**: your mechanic, van driver and cook. He raced one season in 1994 and crashed out of the final on Elastic Summit, and he has never talked about it. Dry, patient, proud of you and never says so. He built your bike in the garage.
- **Henrik Holm**: the Holm Racing team manager. Says very little and writes everything down. When he turns up, it matters.
- **Speaker-Steen**: the announcer. Gets your name wrong until round 3, then never again.
- **Your rival**: the opposite gender to the rider you made, like in Pokémon (see below).
- **Other contenders**: three recurring names on the final results, one line each at most (see below).

### 🆚 The rival

Always rivals, never romance: teasing and mocking that slowly turns into respect.

- **Rider is male → Freja Krogh.** The daughter of a three-time champion, raised in the team paddock. Perfect lines, perfect bike, and she has never once fixed it herself. She envies your van-and-umbrella season more than she'll admit.
  > **Freja:** "Nice bike. Did your dad build it, or is he still building it?"
  > **Freja** *(after you beat her)*: "Enjoy it. I'll have the seat back by round three."
- **Rider is female → Mads Dahl.** 200,000 followers, films every lap, narrates his own warm-up, and is genuinely fast. In the mine there's no signal and no camera, and he's quietly terrified of the dark.
  > **Mads** *(to camera)*: "This is my rival. Say hi." *(you don't)* "She's shy. Or slow. We'll find out."
  > **Mads** *(after you beat him)*: "That's not going in the vlog."

Dad, Henrik and Steen are the same in both stories; a few of their lines change to fit the rival's thread.

### 🏍️ Other contenders

They fill out the results of each final and give Steen something to say. They can finish ahead of you or behind you, but never decide the seat.

- **#7 Bo "Bulldozer" Bak**: a veteran who has finished 4th in the series for eleven years. *Steen: "Fourth again for Bo. A man who knows what he likes."*
- **#33 Yasmin Ali**: silent and very fast. Her pit board just says "OK."
- **#91 the Lindqvist twins**: nobody, including Steen, knows which one is racing today.

---

## 🗺️ The season

The trails before each final are **practice days** and carry the paddock scenes. The **final** is the last trail of each world, dressed as a race day.

| Round | Practice | Final | Beat |
|---|---|---|---|
| 1. Countryside | 1–9 | 10 Switchback | Your first race. Henrik is "only here for the sausages". Dad: "He doesn't eat sausages." |
| 2. Desert | 11–14 | 15 Mirage | You meet your rival properly. Their team has a tent. You have an umbrella. |
| 3. Water | 16–20 | 21 Low Bridge | Steen gets your name right. Dad pretends he didn't hear it. |
| 4. Mine | 22–23 | 24 The Shaft | An underground final: lanterns and a small crowd. No cameras, no signal, and your rival needs you. |
| 5. City | 25–29 | 30 Rooftops | Night race. Henrik speaks to you for the first time: "Ride like that at the Summit." |
| 6. Mountain | 31–34 | 35 Elastic Summit | Dad's mountain. Before the start he tells you about 1994, and your rival gives you one honest line. |

### 🏆 Winning a round

- Your rival has a set time in each final, between silver and gold, getting tighter round by round. **Beat it and you win the round.**
- Your rival rides the final as a **ghost**, from an authored run, so you're actually racing them.
- After the final, the results show a short race result: you, your rival and the three other contenders, then Steen's line and a paddock scene.
- A lost final can be re-raced; the round counts your best result. The season moves on once you've finished the final, won or lost.

### 🎬 Endings

After the Summit, one paddock scene decided by how many finals you won:

- **4 or more:** Henrik offers you the seat. *Dad: "Well. Somebody in this family had to."*
- **3:** the seat goes to your rival, and Holm Racing offers you a test day. Your rival's last line depends on how the rounds went between you.
- **2 or fewer:** no seat. Dad loads the van. *"Next year."*

In every ending, finishing the Summit closes Dad's 1994 story; the emotional payoff never depends on winning.

**Reward:** Holm Racing team colours (outfit and bike colours) if you win the seat, otherwise Dad's 1994 jersey.

---

## 🛠️ Building it

- [ ] **Story data** (`js/story.js`): every line, keyed by round, scene (practice / before final / after final / ending), rival and outcome. Free of the DOM, like `nisse.js`.
- [ ] **Paddock card**: a dialogue overlay with a pixel portrait per character, shown before a trail starts and on the results screen. Skippable, and never shown in replays, ghost runs or custom trails.
- [ ] **Race result**: a short finishing order after each final, with the contenders' times placed around yours and your rival's.
- [ ] **Rival ghosts**: one authored run per final for each rival, recorded at the target time.
- [ ] **Race dressing** for the finals that don't have it: 10 Switchback, 15 Mirage, 21 Low Bridge, 24 The Shaft and 35 Elastic Summit, using the event props (spectators, banners, hay bales, start marshal, pit boards, camera towers). 30 Rooftops is already dressed and is the template. Decoration only, off the riding line.
- [ ] **Save**: per rider, which finals were won and how far the story has got.
- [ ] **Rewards**: the Holm Racing colours and the 1994 jersey in `cosmetics.js`, unlocked through `unlocks.js`.
- [ ] **Portraits**: The Player, Dad, Henrik, Steen, Freja and Mads.

---

## ❓ Open questions

- Should the story be optional, with a setting to turn the scenes off, for players who only want the trails?
- Exact rival target times per final, to be tuned once the ghosts are recorded.
- Does a lost final re-race count fully, or should the first attempt be the one that counts, for real stakes?
