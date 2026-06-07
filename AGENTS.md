# AGENTS.md — guide for coding agents/LLMs working on JMR's BitLife

> **Single source of truth for contributors.** Players & the BitLife **comparison table**: see
> [README.md](./README.md). `CLAUDE.md` is a pointer to this file. Keep this current when you add systems.


A practical guide for humans **and LLMs** who want to add content or features fast,
without breaking the game or its core promises. Read [The golden rules](#the-golden-rules)
first — they are short and they are the difference between a clean PR and a broken build.

> **Mental model:** The game is **data-driven**. Most new content is **JSON, not code** —
> you add an object to `bitlife_data.json` and the engine, the menus, the save system, and
> even the art baker pick it up automatically. You only touch `index.html` when you add a
> genuinely new *mechanic* (like a casino mini-game).

---

## The golden rules

1. **It must play offline after first load.** Once the page and `bitlife_data.json` are
   cached, the **deterministic game must run with the network fully disconnected.** Never
   add a *runtime* network call to the core game loop (ageing, events, activities, careers,
   crime, casino, markets, relationships). Bundled/vendored code and local emoji/CSS are
   fine; `fetch()` to a server at play-time is not. (The optional AI is the *only* thing
   allowed to touch the network, it is **off by default**, and everything still works with
   it off.)
2. **Stay deterministic.** All gameplay randomness goes through the seeded RNG
   (`rng`, `rngInt`, `rngChance`, `rngFloat`, `rngPick`, `rngWeighted`) — **never
   `Math.random()` for an outcome.** Same seed ⇒ same life. (`Math.random()` is allowed
   **only** for cosmetic animation that doesn't change the result — e.g. the blur of
   spinning slot reels.)
3. **Effects are clamped deltas.** Stat changes are *relative* (`+5`, `-3`), applied through
   `applyEffects()`, and clamped to `0..100`. Don't set absolute stats or mutate
   `game.character.stats` directly.
4. **Don't break the save format.** Saves are JSON in `localStorage`. Adding new optional
   fields is safe; renaming/removing existing ones breaks every saved life. Guard new reads
   with defaults (`game.flags || {}`).
5. **Keep `bitlife_data.json` and the embedded `FALLBACK_DATA` in sync for anything the
   menus rely on.** See [Why two copies of the data](#why-two-copies-of-the-data).
6. **Don't reveal model identity in artifacts.** No model IDs/marketing names in commits,
   PRs, code comments, or docs.
7. **Verify before you commit.** Syntax-check the script and, for anything with odds,
   simulate it. See [Testing & verification](#testing--verification).

---

## File map

| File | What it is | Touch it when… |
|---|---|---|
| `index.html` | The whole game: CSS, the `<script type="module">` engine, all UI. ~2.6k lines, organised into clearly-bannered sections (`// ENGINE: …`, `// MODALS`, `// LOG / FEED`, …). | You add a new **mechanic** or UI. |
| `bitlife_data.json` | **All premade content** (events, careers, activities, crime, casino, markets, achievements, names, …). Fetched at boot. | You add or tune **content**. This is the main extension surface. |
| `FALLBACK_DATA` (inside `index.html`, search `const FALLBACK_DATA`) | A **minimal** copy of the same shape, used only if the JSON fetch fails (e.g. `file://`). | You change something the **UI hard-codes** against (see rule 5). |
| `coi-serviceworker.js` | Two jobs: (1) sets COOP/COEP so WebGPU works on static hosts; (2) **precaches the app shell and runtime-caches fetches so the game plays offline.** | Rarely. Only if you add a new top-level static file that must be offline on a *very first* short visit — add it to `PRECACHE_URLS`. |
| `pregen_art.py` | **Optional** GPU art baker. Derives its bake list *from `bitlife_data.json`*, so new content needs zero edits here. Writes `assets/scene_*.png` + `assets/manifest.json`. | Almost never — only to bake art for new milestone keys. |
| `serve.py` | Local dev server that sends COOP/COEP headers. `python3 serve.py` → `http://localhost:8080/index.html`. | Never (it just serves). |
| `assets/` | Pre-baked PNGs + `manifest.json` (`"scene:<key>" → file`) for instant art. | When you bake new art. |
| `vendor/web-txt2img/` | Vendored in-browser Stable Diffusion runtime (no install). | Never, unless upgrading the image stack. |
| `README.md` | Player-facing intro + the BitLife **comparison table**. | Bump the version + advance a chart row on release. |

---

## How a turn works (the data flow)

```
Age Up  →  ageUp()  →  pick a weighted EVENT for this life-stage/age (rng)
                    →  applyEffects(deltas)  →  clampStat 0..100
                    →  log("event", text, sceneKey?)  →  feed entry (+ optional art)
                    →  autosave()  →  renderAll()
```

Menus (Activities, Careers, Crime, Casino, Relationships, Assets) open **modals** built by
`openX()` functions that read from `DATA.*` and call engine functions
(`doActivity`, `applyJob`, `commitCrime`, `gamble`/`openSlots`/…, `buyAsset`, …).
Add a row to the JSON and it shows up in the menu automatically.

---

## Keeping the logic correct as it grows

The goal isn't to write a test per bug — it's a **general net** that catches logic errors
in *any* feature, present or future. Three layers do this; you extend the data, not the tests.

### 1. Action guards (state the precondition once)
Menus **don't consume the turn**, and many actions are illegal in some states (e.g. in prison).
Every player action starts with small guards instead of ad-hoc `if`s:

```js
function goTravel(id) {
  if (!requireFree("travel")) return;   // refuses (with a toast) while in prison
  if (!requireMoney(cost)) return;      // refuses if too poor
  …
}
```
- `requireFree(verb)` — blocks while in prison (`jailed()`). **Any action needing freedom
  (travel, casino, fame, business, trading, buying, dating, crime, etc.) must call it.**
- `requireAge(n, verb)` / `requireMoney(n)` — the other common preconditions.
- `oncePerYear(key)` — gate any **repeatable money-positive** action (else it's an infinite
  faucet, since menus don't end the turn). House-edge gambling is exempt.

### 2. Invariants — facts that must hold in *every* valid state (`const INVARIANTS`)
A single registry of truths (stats 0–100, money/age finite, debts ≥ 0, no job while in prison,
granted achievements all exist, net worth finite, …). They're checked after **every** simulated
year, event, and fuzzed action. **Add a feature → add the new truths it introduces here**, and
any code path that ever violates one — no matter which feature added it — fails the tests.

### 3. The action registry — one source of truth (`const PLAYER_ACTIONS`)
Every direct action, with a sample call and its prison rule (`"block"` = must be a no-op while
jailed, `"allow"` = legal in jail). **Add a new action here** and it's automatically:
- **fuzzed** (`runSelfCheck` fires ~200 random actions and re-checks all invariants), and
- **prison-audited** (each `"block"` action must change *nothing* while jailed).

**Enforced, not just documented** — `bash tests/check.sh` reads `PLAYER_ACTIONS` and statically
asserts every `prison:"block"` action's function contains `requireFree()`; `index.html#test=selfcheck`
runs 6 lives + the fuzz pass + the prison audit, reporting `N invariants · M actions`.

So the "roommate-issues-in-jail" bug — and its whole class — fails the tests instead of shipping.
**When you add a feature: add its truths to `INVARIANTS` and its actions to `PLAYER_ACTIONS`. That's it.**

## Recipes

### Add a life event
`EVENTS` is keyed by **life-stage id** (`baby`, `child`, `teen`, `youngAdult`, `adult`,
`middleAge`, `senior`). Append to the relevant array.

**Auto-resolved (no choice):**
```json
{ "id": "spellingBee", "weight": 4, "minAge": 8, "maxAge": 12, "noChoice": true,
  "text": "You won the school spelling bee!", "effects": { "smarts": 4, "happiness": 5 } }
```

**With choices (and a chance-based outcome):**
```json
{ "id": "lostWallet", "weight": 4, "minAge": 10, "maxAge": 17,
  "text": "You find a wallet stuffed with cash on the sidewalk.",
  "choices": [
    { "label": "Return it", "effects": { "happiness": 6 },
      "outcome": { "chance": 0.5, "success": { "money": 200, "happiness": 4 }, "fail": { "happiness": -2 } } },
    { "label": "Keep the cash", "effects": { "money": 300, "happiness": -3 } }
  ] }
```
- `weight` — relative likelihood within the stage (higher = more common).
- `minAge`/`maxAge` — eligibility window.
- A choice's `effects` apply immediately; the optional `outcome` then rolls `chance`
  and applies `success` or `fail`.
- Optional `"art": "a short prompt"` adds a generated scene (key `scene:event_<id>`) and is
  picked up by `pregen_art.py`.

### Add a career
Append to `CAREERS`:
```json
{ "id": "teacher", "title": "Teacher", "baseSalary": 45000,
  "requires": { "degree": "education" },
  "levels": ["Student Teacher", "Teacher", "Senior Teacher", "Department Head"],
  "raisePerLevel": 0.13, "fameGain": 0 }
```
- `requires` — any of `{ "minAge": n }`, `{ "level": "highGrad" }`, `{ "degree": "<id>" }`
  (degree id must exist in `DEGREES`).
- `levels` — promotion ladder; salary scales by `raisePerLevel` per level.
- Optional `fameGain` (per year) and `art` (career hire scene, key `scene:job_<id>`).

### Add an activity (mind/body, doctor, education)
Append to `ACTIVITIES.mindBody` / `.doctor` / `.education`:
```json
{ "id": "yoga", "label": "Yoga class", "minAge": 12, "cost": 60,
  "effects": { "happiness": 4, "health": 3 }, "random": { "happiness": [0, 3] } }
```
- `cost` is money spent; `effects` are deltas; `random` adds `rngInt(lo,hi)` to a stat.
- `requires: { "inSchool": true }` gates education actions; `notable: true` flags it for art.

### Add a crime
Append to `ACTIVITIES.crime`:
```json
{ "id": "fraud", "label": "Wire fraud", "minAge": 18,
  "payout": [2000, 40000], "catchChance": 0.5, "jail": [2, 8] }
```
Higher `payout` ⇒ raise `catchChance`. `killsRelationship: true` makes it a murder-type.

### Add an achievement / ribbon
Add to `ACHIEVEMENTS` (and the same entry in `FALLBACK_DATA.ACHIEVEMENTS` if the UI grants it):
```json
"globetrotter": { "label": "Globetrotter", "icon": "✈️", "desc": "Travelled the world." }
```
Grant it from anywhere with `grantAchievement("globetrotter")`, or declaratively from a
choice via `"effects": { "grantAchievement": "globetrotter" }`.

### Add a market asset (stock / crypto / bond)
Append under `MARKET.stocks` / `.crypto` / `.bonds`:
```json
{ "id": "NOVA", "name": "Nova Energy", "start": 75, "vol": 0.30, "drift": 0.06 }
```
- `vol` = yearly volatility, `drift` = expected yearly trend, `taxable: true` for crypto-style
  gains tax. Insider tips reference assets by `assetType`.

### Add real estate / an insider tip / a country / names / a life stage
- `REAL_ESTATE`: `{ "id", "name", "price", "apprec" }` (yearly appreciation).
- `INSIDER_TIPS`: `{ "id", "source", "assetType", "text" (use `{co}`), "gainMult":[lo,hi],
  "arrestChance", "sentence":[lo,hi], "achievement" }`.
- `COUNTRIES`: just add a string.
- `NAME_POOLS.male|female|nonbinary|surnames`: add strings.
- `LIFE_STAGES`: `{ "id", "min", "max", "label" }` — **if you add a stage id, add an
  `EVENTS["<id>"]` array too**, or the stage will have no events.

### Add scene art for a new milestone
1. Add the key to `SCENE_EVENTS` in the JSON.
2. Add a prompt to `SCENE_PROMPTS` in `index.html` (search `const SCENE_PROMPTS`).
3. (Optional) run `pregen_art.py` on a GPU box to bake `assets/scene_<key>.png`; otherwise
   it generates on the fly (when AI is on) or shows the placeholder (when AI is off).
Reference it from a `log(..., "<key>")` call.

---

## The mini-game pattern (how to add a 4th casino game)

Slots, Blackjack, Roulette and Horse Racing (in `// ENGINE: CRIME / CASINO`) are the
template — all pure CSS/emoji animation (no diffuser, no network). Each is a self-contained,
**offline, deterministic** UI mini-game with the same shape:

1. **Config/odds as data** near the top of the block (e.g. `SLOT_CONFIG`, `ROULETTE_BETS`).
2. **`openX()`** — builds the modal via `modalShell(title, html)`, wires the wager box with
   the shared `wireCasinoWager()` + `CASINO_QUICKBETS`, and a Play/Spin button.
3. **Decide the outcome up front with `rng()`** (so the result is reproducible), then run a
   **cosmetic** animation that merely *reveals* it (cosmetic-only flashing may use
   `Math.random()`).
4. **`finishX()`** — pay out, `grantAchievement("lottery")` on a big win, **log wins to the
   feed** (losses update the panel only, so rapid play doesn't flood the life log), then
   `autosave(); renderAll();`.
5. **Route it**: add a branch in `openCasino()` and (optionally) a keyword in the typed-action
   router (search `Opening the slot machine`). Add the game's `id` to the `casino` arrays in
   **both** the JSON and `FALLBACK_DATA` so it appears in the menu.

**Always design a house edge and prove it** with a Monte Carlo before committing (see below).
Reference numbers in this build: slots ≈ 81% RTP, roulette ≈ 97.3% (single-zero), blackjack
≈ 94–99% depending on play, horse racing ≈ 82% on every horse.

> **Instant-bet games** (the simpler `gamble()` path used by craps/keno/sports betting) pay
> `winChance × rngFloat(payoutMult[0], payoutMult[1])`. The expected return is
> `winChance × (lo+hi)/2` — **this MUST be < 1**, or players grind infinite money. (A real bug:
> keno shipped at `0.25 × 6.5 = 1.625` RTP and someone bankrolled a fortune before it was fixed.)
> Compute the EV by hand for any change to a `gamble()`-path game.

### Richer / 3D mini-games (separate ES modules)

Bigger interactive games don't live inline — they're **self-contained ES modules** in
`minigames/`, lazy-loaded only when launched so they never touch the boot path. Two references:
**Prison Break** (`prison_escape.js`, Three.js / 3D) and **Street Fight** (`street_fight.js`,
Canvas 2D — no engine needed). The contract is tiny:

```js
// minigames/<name>.js
import * as THREE from "three";          // ONLY if you need 3D (vendored at ./vendor/three/)
export function start(host, api) {
  // host: an empty full-screen <div> — render your canvas + HUD into it
  // api.finish(result, payload?): call ONCE with "win"|"lose"|"quit". The
  //   optional payload is forwarded to the host handler, e.g. onWin(payload) —
  //   burglary returns { loot } so the host can pay it out. (Backward compatible.)
  // api.opts: per-launch data the host passed in (e.g. { lootMax, guards, name }).
  // api.difficulty: optional number
  // return cleanup(): stop your RAF loop, dispose GPU objects, remove listeners
}
```

A mini-game can use **Three.js or plain Canvas 2D** — whatever fits. 2D (Street Fight) is lighter
and needs no vendored engine; use it for side-view/sprite games.

To add one:
1. Write `minigames/<name>.js` exporting `start(host, api)` (copy `prison_escape.js`).
2. Register it in the `MINIGAMES` map (search `const MINIGAMES`) in `index.html`.
3. Launch it from anywhere: `launchMiniGame("<id>", { onWin, onLose, onQuit })`. **The host
   decides what win/lose means** — the module is pure UI and must not touch game state.
4. Add the new module file (and any new vendored lib) to `PRECACHE_URLS` in
   `coi-serviceworker.js` and bump `APP_CACHE` (`bitlife-app-vN`) so it's offline + clients refresh.
5. Add it to the `TEST_GAMES` map (search `const TEST_GAMES`) so it's reachable from the test bench.

**Rules that still apply:** the game must work offline (vendor any library locally — never load
it from a CDN at runtime; that's why Three.js lives in `vendor/three/`), and the module must not
call the seeded `rng()` (use `Math.random()` for cosmetic randomness — a skill game's outcome
comes from the player, not the seed).

**Reskinning a mini-game's art.** Keep all drawing behind one config + one function so art is
swappable without touching logic. Street Fight is the model: a `SKIN` object (sprite-sheet URL +
per-state frame rects) and a single `drawFighter()` that uses the sheet when present and falls back
to built-in vector art otherwise. To use real sprites, drop a sheet in `minigames/assets/`, point
`SKIN.sheet` at it, and fill `SKIN.frames` — no logic changes.

### Launching a mini-game from a life event (the `minigame` choice hook)

Any event **choice** can play out as a mini-game instead of a fixed stat roll — that's how
"get in a fight" works. Add `minigame` + `win`/`lose` effects to the choice in `bitlife_data.json`:

```json
{ "label": "Fight back", "minigame": "fight",
  "win":  { "happiness": 10, "health": -2 }, "winText":  "You won the fight!",
  "lose": { "health": -12, "happiness": -7 }, "loseText": "You lost." }
```

`applyChoice()` launches the registered mini-game and applies `win`/`lose` based on the result
(quit counts as a loss; a load failure is treated as neutral so players are never punished for it).
Works with any id in the `MINIGAMES` map. You can also launch from the typed-action router or a menu
(see `startFight()` / `attemptPrisonEscape()`).

### Testing mini-games without playing a whole life

A built-in **test bench** deep-links straight to any mini-game in a sandbox life
(age 30, $1M, in prison):

- `index.html#test` → a menu of every mini-game.
- `index.html#test=<id>` → launch one directly (`slots`, `blackjack`, `roulette`, `horses`, `prison`).

It's driven by the `TEST_GAMES` map and `startTestMode()` in `index.html`; editing the hash after
load switches games too. Register every new mini-game in `TEST_GAMES`.

---

## Why two copies of the data

`bitlife_data.json` is the **source of truth**. `FALLBACK_DATA` (embedded in `index.html`) is
a **minimal subset** used only if the fetch fails (offline `file://`, a bad deploy). The game
prefers the JSON and silently falls back. Practical rule:

- **Content the engine reads generically** (events, most careers/activities) → JSON is enough.
- **Anything the UI hard-codes a branch against** (e.g. a casino game id routed in
  `openCasino()`, or an achievement the code grants by id) → add it to **both**, so the
  feature still works in fallback mode. When unsure, add to both.

---

## Determinism & RNG

- `rng()` advances `game.rngState` and is the basis for all the helpers. It's persisted in the
  save, so a reloaded life continues the same sequence.
- Use `rngInt(lo,hi)` (inclusive), `rngChance(p)`, `rngFloat(lo,hi)`, `rngPick(arr)`,
  `rngWeighted([{weight}, …])`.
- A mini-game should **consume rng() for the result, then animate** — that way closing/reloading
  mid-animation can't desync money or the RNG (resolve + `autosave()` happen together at the end).

---

## Offline & networking rules (don't break this)

- The core game = `index.html` + `bitlife_data.json` + pre-baked `assets/`. All precached by the
  service worker → **fully playable with the network off** after the first load.
- The CDN `importmap` (onnxruntime / transformers) and HF model weights are **only** for the
  optional AI, which is **off by default** since v0.8.1 and never required to play.
- **Therefore:** new core features must not introduce `fetch()`/`import()` of remote resources at
  play-time. Keep new assets local (emoji, CSS, inline SVG, or files added to the repo).
- If you add a must-have static file, add its path to `PRECACHE_URLS` in
  `coi-serviceworker.js` and bump `APP_CACHE` (e.g. `bitlife-app-v2`) so clients refresh.

---

## v0.9.x systems quick-map (where the depth lives)

All added as **JS consts (offline-safe) + one engine fn + one `openX()` modal**, wired into a menu and
ticked yearly in `tickDepth()` (called near the end of `ageUp`). Reuse these patterns:

- **Health/disease:** `DISEASES` const, `game.character.conditions[]`, `addDisease()`/`addCondition()`
  (addictions & STDs), `openClinic()`/`treatCondition()`; untreated severity raises `checkDeath` mortality.
- **Money/assets:** `VEHICLES`/`VALUABLES`/`BUSINESSES` consts; `buyVehicle`/`buyValuable`/`startBusiness`;
  `takeLoan`/`repayLoan`, **mortgages** (`game.mortgageBalance`, `buyRealEstateMortgage`),
  `declareBankruptcy`, `playLottery`, `netWorth()`. Yearly upkeep/interest/appreciation in `tickDepth`.
- **Activities/travel/fame/politics:** `LIFESTYLE`/`DESTINATIONS`/`FAME_ACTIONS` consts +
  `doLifestyle`/`openTravel`/`openFame`/`runForOffice`/`royalDuties` (in the Activities → "More" section).
- **Relationships:** `openFindLove()`/`askOut()` generate datable NPCs; extra `interact()` actions.
- **Crime/justice:** more `crime` rows; bank/jewelry heists reuse `BURGLARY_TARGETS`; `joinGang`/`gangJob`,
  `hireLawyer`/`requestParole`/`appealConviction`/`prisonJob`.
- **Generations / God Mode / Time Machine:** `continueAsHeir()` (death screen), `openGodMode()`,
  `timeMachine()` (pre-`ageUp` snapshot in a module var — never persisted).
- **`oncePerYear(key)`** — gate any repeatable money-positive action (menus don't consume the turn).
  **Use it or you create a faucet.**

## Testing & verification

No build step. Two fast tiers — run both before committing:

1. **CLI smoke test (seconds):** `bash tests/check.sh` — syntax (engine + every `minigames/*.js`),
   JSON validity, and the **invariants** (unique event/career ids, casino `EV<1`, FALLBACK↔JSON ribbon
   parity). Exits non-zero on failure; safe to wire into a SessionStart hook or CI.
2. **In-game self-test:** open `index.html#test=selfcheck` — data asserts + **6 seeded lives simulated
   to death**, checking stats stay clamped, money/age finite, no exceptions, and saves round-trip.
   Shows a green/red PASS/FAIL summary.

Then, for anything risky: **play it** (`python3 serve.py`; AI off by default), **prove the odds** with
a quick Monte Carlo for money mechanics, and do an **offline smoke test** (DevTools → Network → Offline).

---

## Release checklist

- [ ] **`bash tests/check.sh` passes** (covers syntax, JSON, unique ids, casino EV<1, ribbon parity).
- [ ] **`#test=selfcheck` is green** (6 simulated lives, invariants hold).
- [ ] New menu-routed ids exist in **both** the JSON and `FALLBACK_DATA`.
- [ ] No new runtime network calls in the core loop; offline smoke test passes.
- [ ] Odds simulated (for gambling/economy changes).
- [ ] Version bumped in `index.html` (overlay `<h1>`), `README.md`, this file, and the
      `bitlife_data.json` `_comment`.
- [ ] No model identifiers in commits/PRs/comments.

---

## Anti-patterns (don't)

- ❌ `Math.random()` for an outcome (breaks reproducible seeds). Cosmetic only.
- ❌ `fetch()` to a server in the core game loop (breaks offline play).
- ❌ Setting absolute stats / writing `game.character.stats.health = 100` (use clamped deltas).
- ❌ Removing or renaming save fields (breaks existing saved lives).
- ❌ Adding a casino id to only one of the two data copies (vanishes in fallback mode).
- ❌ A repeatable menu action that nets positive money without `oncePerYear()` or a house edge
  (infinite faucet — menus don't consume the turn). `tests/check.sh` catches the casino case.
- ❌ Caching the multi-GB model weights in the service worker (the libraries already do).

---

# Status, content counts & roadmap

## Concrete content counts (v0.13.0)

- Events: **85** — baby 7, child 14, teen 15, youngAdult 15, adult 14, middleAge 10, senior 10
- Activities: **41** — mindBody 13, doctor 7, education 3, crime 11, casino 7
- Careers: **43** (incl. military Army/Navy/Air Force, trades, journalist, scientist, fame paths) · Degrees: **12**
- Market assets: **9** (4 stock / 3 crypto / 2 bond) · Real estate: **4** · Insider tips: **4**
- Ribbons/achievements: **32** · Countries: **30** · Mini-games: **3** (prison escape, street fight, burglary)
- Beyond the v0.9 depth update: **social media** (5 platforms — followers/verified/sponsorships/podcasts,
  v0.10.0) and **friends / coworkers / enemies** (make friends, befriend, prank, block, reconcile, v0.11.0).

## Gap-closure roadmap

**Shipped** (the chart in `README.md` is the live source of truth): relationships/dating/divorce +
friends/coworkers/enemies, health/disease, money/loans/mortgages/taxes/inheritance, activities/travel,
careers/fame/business/social-media, crime/gangs/heists/justice, generations/royalty(stipend)/politics,
God Mode/Time Machine. Most of the old A–H epics are done.

**Remaining gaps — next features (one PR + version bump each, reusing existing seams):**
1. **Friends & social circle** — ✅ shipped v0.11.0.
2. **Military deployments** — add a `deploy` action on top of the existing military careers (medals,
   promotion, injuries via `addCondition`, court-martial); ribbons Veteran / War Hero.
3. **Adoption, IVF & surrogacy** — `adoptChild`/IVF/surrogacy funnelling into `addRelationship({relation:"child"})`.
4. **Business with employees** — migrate `flags.business` → `game.business = {id, employees, value}`; hire/fire.
5. **Pet breeding & shows** — pet `training` stat (train/walk/vet), breed two pets, `petShow` (`oncePerYear`).

**Runners-up:** royalty/throne politics (+ marry-into-royalty), prison depth (riots/contraband),
custody/alimony on divorce, and **content volume** (scale `EVENTS` toward 15–30/stage, `CAREERS` 100+).

Each feature = data tables + one/few engine functions + one modal, reusing the existing seams
(mini-game launcher, the `minigame` event-choice hook, `modalShell`/`optRow` drill-downs, `applyEffects`).
**Every feature must register new actions in `PLAYER_ACTIONS` and new truths in `INVARIANTS`** (see
"Keeping the logic correct as it grows" above), then bump the version and advance the chart row it closes.

> Keep every addition deterministic-first and routed through `applyEffects` (auto-clamped). The LLM is
> only for the free-text box; buttons stay instant local logic; skill mini-games never call `rng()`.
> Vendor any new library locally and precache it (offline rule). The recipes & mini-game contract
> are above in this file.

## How to check status yourself

- **Content counts:** the JSON is the source of truth — `EVENTS`, `ACTIVITIES`, `CAREERS`, etc. Counting
  entries there tells you depth at a glance.
- **Engine coverage:** every system above maps to a function in `index.html` (`fireYearlyEvent`,
  `doActivity`, `applyJob`/`askPromotion`, `commitCrime`/`sendToPrison`, `gamble`, `buyAsset`/`sellAsset`,
  `maybeInsiderTip`/`runInsiderTip`, `interact`, `ageRelationships`, `checkDeath`). If a system has no
  function, it's not implemented yet.
- **Live state while playing:** open the **Debug** panel (or run `bitlifeDebug()` in the console) for a
  one-screen snapshot of stats/job/education/prison/portfolio/achievements + any errors.
