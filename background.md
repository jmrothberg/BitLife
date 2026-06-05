# BACKGROUND.md — everything a new LLM needs to improve & debug this BitLife clone

> **Read this first.** It is the single source of truth for the project's intent, the original
> BitLife mechanics we are cloning, the two (and only two) advances we add, the exact architecture
> of this codebase, the known gaps to reach feature parity, and how to run/debug it.

---

## 0. The one-sentence goal

Build a game that plays **exactly like BitLife by Candywriter, LLC** — a text/button life
simulator — and make it **as complete and faithful to the original as possible**, adding **only two
advances**:

1. **A LOCAL LLM that runs in the browser** so the player can *type free-form actions* and have them
   interpreted into game effects + narration (real BitLife is buttons-only).
2. **A LOCAL image diffuser that runs in the browser** to illustrate the character (avatar) and life
   events (real BitLife uses fixed emoji/clip-art).

Everything else should converge toward real BitLife. The core game must remain **premade and
deterministic** — it is a real simulation engine with buttons, *not* an "LLM pretends to be a game."
The LLM and the diffuser are **enhancements layered on top**, and the game must stay fully playable
with both turned off.

### Hard design rules (do not violate)
- **Deterministic-first.** The engine never depends on the LLM or the diffuser. Buttons run instant
  local logic. Both AIs load in the background and only *enhance*. The game must be 100% playable
  with "Skip loading AI models" checked.
- **The LLM only touches the free-text input box.** Buttons never call the LLM.
- **The LLM can flavor but never break the game.** Every effect it proposes is clamped/sanitized.
- **Reproducibility.** All engine randomness flows through one seeded RNG (mulberry32). A given seed
  reproduces a life.
- **Faithfulness over novelty.** When in doubt, do what BitLife does. The only intentional
  divergences are the two advances above.

---

## 1. The original ask (verbatim intent)

The user wants a game "just like BitLife by Candywriter": you have buttons to push, you age up year
by year, random things happen, you can do crime, gamble, work, have relationships, and **do insider
trading**. It should be a **fully working HTML version**. The two differences from real BitLife:
you can **type** to it (interpreted by a **small local LLM**), and it has **graphics from the same
local diffuser** used in this repo's "local LLM adventure" game. As much art as practical should be
**pre-generated** (ahead of time and/or on first run) so play is smooth.

---

## 2. How real BitLife works (the spec we are cloning)

BitLife is a turn-based life simulator. You are born, then press **Age** to advance one year at a
time until death. Each year, random events pop up with multiple-choice responses, and between
years you open menus to take actions. Keep this section as the feature checklist.

### 2.1 Core stats (0–100 bars, shown at the bottom)
- **Happiness**, **Health**, **Smarts**, **Looks** — the four pillars.
- Later unlockable bars: **Fame** (if you become famous) and **Approval** (politics).
- Stats drift up/down a few points each age-up. Higher stats → longer, more successful life.
  Health reaching 0 (or old age) → death. **Money** is a number (can go negative); **Age** increments.

### 2.2 The Age button & random events
- Press **Age** → one year passes → 0+ random life events appear as popups needing a decision.
- **Childhood events differ from adult events.** Examples: a bully teases you (do nothing / report /
  talk / fight back / ask older sibling) with success/fail outcomes; a classmate acts up (ignore /
  report / laugh / assault); adopt a stray pet; catch a disease; school club invitations; first
  crush; underage party; speeding ticket; health scare; etc.

### 2.3 Activities menu (grouped categories, age/requirement-gated)
- **Mind & Body:** Gym (health/looks), Library (smarts), Meditate (happiness/health), Spa, Walk.
- **Doctor:** checkups, therapy, plastic surgery (looks), dentist; treat diseases.
- **School / Work:** attend school, study harder, apply for jobs, work harder, ask for promotion, quit.
- **Love / Relationships:** interact with parents, siblings, friends, partners, children:
  Compliment, Conversation, Give Money, Gift, Spend Time, Movie/Activity, Insult; date → propose →
  marry → have kids; people age and die.
- **Crime:** petty theft/shoplift, pickpocket, burglary, grand theft auto, assault, murder — each a
  payoff vs. a chance of getting caught → **jail** (sentence; can plead, riot, or attempt escape).
- **Casino:** blackjack, slots, roulette, horse races, etc. — gamble money.
- (Also: Activities for tattoos, gym memberships, witch doctor, prostitution, emigrate, surrender to
  death, mind & body, etc. — see the wiki for the full list.)

### 2.4 Jobs / careers
- Apply with requirements (age, education, sometimes specific degree). Get a salary; **work harder**
  raises performance; **ask for promotion** climbs the ladder and raises pay.
- **Education** raises Smarts and unlocks high-paying careers: Doctor (medicine degree), Lawyer (law),
  Engineer, Pilot, Actor (fame), CEO, etc. School → graduate high school → college (pick a major) →
  optionally graduate/professional school.
- **Special careers:** royalty, military, famous (actor/musician/influencer), athlete, mafia.

### 2.5 Assets & Investments (the stock-market update + insider trading)
- **Assets → Investments** screen. Buy/sell **stocks, crypto, bonds, penny stocks, funds**, plus
  **real estate**, cars, etc. Stocks/bonds indicate market health; crypto/funds show trends.
- Prices fluctuate over time. **Crypto is the only taxable asset** when sold.
- **Financial advisor** can manage investments (and can be dated/married — they're rich).
- **INSIDER TRADING:** after the expansion, you get popups from friends/family with stock tips. If
  you buy and then sell based on that information, you may be **arrested for insider trading**. Being
  found guilty grants the **"Martha"** achievement (a Martha Stewart reference). The sentence is
  ~20 years; pleading guilty roughly halves it.

### 2.6 Other systems (extras to converge toward)
- **Achievements / Ribbons** awarded for life outcomes (e.g., Rich, Scholar, Married, Jailbird,
  Centenarian, Famous, Martha). A life ends with a summary ribbon.
- **Real estate**, **vehicles**, **pets**.
- **Prison:** sentences, parole, riots, escape attempts, contraband.
- **Relationships depth:** friends, coworkers, exes, in-laws, family tree, custody, wills/inheritance.
- **Fame** path: go viral, write books, music, movies, social media.
- **God Mode / Bitizen** (paid in original): edit stats, surrender, time machine, generations
  (continue as your child after death).

### 2.7 Sources (verify mechanics & expand content here)
- BitLife Wiki — Stats: https://bitlife-life-simulator.fandom.com/wiki/Stats
- BitLife Wiki — Activities: https://bitlife-life-simulator.fandom.com/wiki/Activities
- BitLife Wiki — Events: https://bitlife-life-simulator.fandom.com/wiki/Events
- BitLife Wiki — Childhood events: https://bitlife-life-simulator.fandom.com/wiki/Events/Childhood_events
- Stock market / insider trading: https://www.gameskinny.com/tips/bitlife-how-to-use-the-stock-market/
- Stock update guide: https://www.levelwinner.com/bitlife-stock-market-update-guide-everything-you-need-to-know-about-the-stock-market-update/
- Stock update (Prima): https://primagames.com/tips/everything-added-in-the-bitlife-stock-market-update
- General guide/tips: https://www.mrguider.org/cheats/bitlife-life-simulator-guide-tips-cheats-strategies/
- Increase stats: https://thenerdstash.com/bitlife-how-to-increase-all-stats-looks-smarts-health-happiness/
- Live long / mortality: https://gamerant.com/bitlife-live-long-old-age-how-diet-health-geriatric-100-years/

> When adding content, prefer the Fandom wiki for exact event text, choice wording, and category
> structure so it feels like the real game.

---

## 3. The two advances (how they work technically)

Both reuse this repo's proven in-browser stack from `browser_adventure/adventure.html` and
`llm_adventure/vendor/web-txt2img/`. **Do not reinvent these — copy the working patterns.**

### 3.1 Advance #1 — LOCAL in-browser LLM (typed input only)
- **Model:** `onnx-community/gemma-4-E4B-it-ONNX` (Gemma 4 E4B, ~4B params).
- **Runtime:** **Transformers.js v4.0.1** (`pipeline("text-generation", …, {dtype:"q4", device})`)
  on **ONNX Runtime Web**, device `webgpu` with `wasm` fallback. Loaded from jsDelivr via an
  importmap. ~3 GB download, cached by the browser.
- **Critical gotcha:** Gemma 4 ONNX ships its chat template in `chat_template.jinja`, NOT in
  `tokenizer_config.json`. Transformers.js leaves `tokenizer.chat_template` empty → `apply_chat_template`
  throws on a fresh load. We fetch the `.jinja` explicitly (`ensureLlmChatTemplate`). Keep this.
- **Sampling:** temp 1.0, top_p 0.95, top_k 64 (Google's recommended Gemma settings).
- **Role in the game:** ONLY the free-text box. The model receives a compact JSON state snapshot +
  the player's typed action and must return a small JSON directive (see §4.4). Output is parsed
  tolerantly and **sanitized/clamped** before applying. A parse failure → narration only.
- **Optional Ollama backend:** the same typed path can POST to a local Ollama server
  (`/api/chat`, `format:"json"`) instead of in-browser Gemma.
- KV-cache reuse across turns exists in the adventure but is **disabled** there due to regressions;
  we don't use it. Streaming via `TextStreamer` is used to accumulate text.

### 3.2 Advance #2 — LOCAL in-browser diffuser (avatar + event scenes)
- **Model:** **Stable Diffusion 1.5** (id `"sd-1.5"`, the Microsoft WebNN ONNX build).
- **Runtime:** the vendored **`web-txt2img`** worker (`vendor/web-txt2img/index.js` →
  `Txt2ImgWorkerClient`), ONNX Runtime Web on WebGPU, run in a Web Worker so the UI never freezes.
- **API:** `client = Txt2ImgWorkerClient.createDefault()`; `await client.load("sd-1.5", opts, onProgress)`;
  `client.generate({model:"sd-1.5", prompt, seed, steps, guidanceScale}, onProgress, {busyPolicy:"queue", debounceMs:200})`
  → `{promise}` → `{ok, blob}`.
- **Hard constraints (from `vendor/web-txt2img/adapters/sd15.js`):** **only 512×512**; steps fixed
  (we use **20**); guidance **7.5**; CLIP truncates at **77 tokens** → keep prompts short
  (we cap ~195 chars, subject-first).
- **Roles:** (a) **avatar** portrait, regenerated when the character's `appearanceHash` changes
  (life stage / job / looks bucket / wealth bucket); (b) **event scenes** for notable moments
  (birth, graduation, new job, wedding, baby, prison, lottery, death, promotion, home purchase).

### 3.3 Why it must be served over http from the repo root
- The worker resolves `./host.js` relative to the `index.js` import URL, and ES modules + Web Workers
  + SharedArrayBuffer don't work on `file://`. Use the included `serve.py` (sends **COOP/COEP**
  headers for `crossOriginIsolated`, enabling threaded WASM). Open `http://localhost:8080/index.html`.
- Requires **Chrome/Edge 113+ with WebGPU** for good performance (WASM fallback works, slow).

---

## 4. Architecture of THIS codebase

Two equivalent layouts exist:
- **Standalone repo (what the user is running):** `index.html` (the game), `bitlife_data.json`,
  `vendor/web-txt2img/` (bundled worker), `serve.py`, `pregen_art.py`, `assets/`, `README.md`.
- **In the original monorepo:** `bitlife/bitlife.html` (imports the worker from
  `../llm_adventure/vendor/web-txt2img/`), `bitlife/bitlife_data.json`, etc., served by
  `scripts/serve-threaded.py`. (The only difference is the image-worker import path.)

`index.html` / `bitlife.html` is ONE self-contained file: importmap + CSS + content `FALLBACK_DATA`
+ engine + LLM integration + image manager + UI + boot. Sections are marked with banner comments.

### 4.1 Content data (`bitlife_data.json` + in-HTML `FALLBACK_DATA`)
Premade, deterministic content so the game plays like BitLife with no AI. Loaded at boot via
`fetch("./bitlife_data.json")`; if that fails (offline/file://), the embedded `FALLBACK_DATA`
(a smaller subset) is used. Keys:
- `LIFE_STAGES`, `COUNTRIES`, `NAME_POOLS`, `ACHIEVEMENTS`
- `EVENTS` keyed by life stage → weighted entries `{id, weight, minAge, maxAge, text, choices[]}`
  where each choice has `effects` (flat deltas) and optional `outcome{chance, success, fail}`;
  `noChoice:true` events auto-apply.
- `ACTIVITIES` per category (`mindBody, doctor, education, crime, casino`)
- `CAREERS` (ladder), `DEGREES`, `MARKET` (stocks/crypto/bonds), `REAL_ESTATE`, `INSIDER_TIPS`,
  `SCENE_EVENTS`.

> **To make it more like BitLife: this file is where most growth happens.** Add events (faithful
> wording from the wiki), activities, careers (incl. special careers), assets, and tips.

### 4.2 Game state (`game` object, one source of truth)
Created by `createNewLife()`. Fields: `seed`, `rngState`, `character{name,gender,country,birthYear,
age,lifeStage,alive,causeOfDeath, stats{health,happiness,smarts,looks}, fame, money,
education{level,inSchool,degree,major}, job, appearanceHash}`, `relationships[]`, `assets[]`,
`portfolio[]`, `market{year,prices,history}`, `crimeRecord`, `prison`, `flags`, `achievements[]`,
`pendingEvent`, `activeTip`, `log[]`. Persisted to `localStorage` (multiple save slots) via
`autosave()`/`loadLife()`; blob image URLs are stripped before serialization and regenerated lazily.

### 4.3 Engine functions (deterministic; all RNG via seeded `rng()`)
- `ageUp()` — the core loop: age++, recompute life stage (→ avatar regen + milestone), education
  auto-advance, stat drift, `advanceMarkets()`, accrue salary, prison time, age relationships +
  roll their deaths, `maybeInsiderTip()`, fire a weighted yearly event (choice events set
  `pendingEvent` and BLOCK age-up until resolved), `checkDeath()`, autosave, re-render.
- `applyEffects(effects)` — **the single mutation choke point**; clamps stats 0–100, applies money/
  fame/flags/relationship/achievement changes. Both the engine and the LLM path go through it.
- `applyChoice`, `doActivity`, `applyJob/workHarder/askPromotion/quitJob`, `applyCollege`,
  `commitCrime/sendToPrison`, `gamble`, `advanceMarkets/buyAsset/sellAsset/buyRealEstate`,
  `maybeInsiderTip/runInsiderTip` (the SEC arrest roll → prison + "Martha"), `interact` (relationship
  actions), `ageRelationships`, `checkDeath`, `grantAchievement`.

### 4.4 LLM directive contract (typed input)
`BITLIFE_SYSTEM` instructs Gemma to return ONE narration paragraph + one ```json``` block:
```json
{ "narration":"…", "effects":{"health":0,"happiness":0,"smarts":0,"looks":0,"money":0,"fame":0},
  "relationship_changes":[{"name":"Mom","bar":0}], "set_flags":{}, "grant_achievement":null,
  "event_image":"short visual phrase or null" }
```
`extractFirstJson()` parses tolerantly; **`sanitizeLlmEffects()`** clamps stat deltas to ±20, money
to a wealth-band, relationship bars to ±25, whitelists flags/achievements, and event_image to a
short string. Then `applyEffects()` applies it. This is the safety boundary — keep it strict.

### 4.5 Image manager + art pre-generation (the "make art in advance" part)
Every image request goes through `getImage(key, prompt)` with priority:
1. **Static asset** — if `assets/manifest.json` maps the key → a shipped PNG, use it **instantly**.
2. **IndexedDB cache** — persistent across reloads/sessions (DB `bitlife-art`, store `img`), keyed by
   prompt/scene hash. Second run is instant.
3. **Live generate** via the SD worker, then store the blob in IndexedDB.
Plus an **idle background pre-render queue** (`enqueuePregen`/`runPregen`, driven by
`requestIdleCallback`) that, once SD loads, pre-renders the current + next life-stage avatar and the
common life-event scenes during idle time — pausing while the player's typed action needs the GPU.
`pregen_art.py` is an **optional GPU batch baker** that writes `assets/scene_<key>.png` +
`manifest.json` ahead of time (covers priority #1).

### 4.6 UI (single-column, mobile-ish, dark theme)
Header card (avatar + name/age/stage + 4 stat bars + money + ribbons) · scrollable **feed** (the life
log; entries can carry an inline scene image) · big **Age Up** button (disabled during a pending
event / prison-only / death) · **free-text input** (the only LLM path) · bottom **tab bar** opening
**modals** (Activities, Careers, Crime, Casino, Relationships, Assets/Investments, Achievements,
Menu) · collapsible **Debug** panel (last LLM prompt/response sizes, JSON parse status, effects) ·
event-choice popup · death screen. Reuses the adventure's CSS tokens and overlay/debug patterns.

### 4.7 Boot flow
`loadData()` → picker (New Life / Load Slot / AI options incl. Ollama + "Skip models") →
`detectLocalModels()` (uses `/local_models/...` on localhost if present) → `createNewLife()` or
`loadLife()` → show game immediately → `startModelsBackground()` loads LLM + SD in the background and
kicks off avatar render + idle pre-gen when SD is ready.

---

## 5. Reference implementations to copy from (in the original monorepo)
- `browser_adventure/adventure.html` — the proven Transformers.js + web-txt2img integration:
  `loadLlm`, `ensureLlmChatTemplate`, `generateLlmResponse`, `runOllamaGeneration`,
  `loadImageModel`, `generateSceneImage`, JSON parsing (`tryParseJson`/`extractJsonFromText`),
  save/load, picker/Ollama UI, dark-theme CSS, OOM-aware error handling.
- `llm_adventure/vendor/web-txt2img/` — the image worker (and `adapters/sd15.js` for the 512×512 /
  steps / CLIP-77 / `mulberry32` constraints).
- `scripts/serve-threaded.py` — COOP/COEP server.
- `mini_flux_MTS_CUDA_8_1_25.py`, `zimageturbo.py` — GPU diffusion scripts that `pregen_art.py` mirrors.

---

## 6. Known gaps & roadmap to reach BitLife parity
This v1 is a faithful skeleton. To get closer to the real game, prioritize (roughly in order):

1. **Much more content in `bitlife_data.json`** — dozens more random events per life stage with
   faithful wiki wording; more activities; more careers incl. **special careers** (royalty, military,
   famous/influencer, athlete, mafia, politics); diseases + doctor treatments; addictions.
2. **Education depth** — elementary→middle→high→community college / university with majors, GPA,
   grad/professional school, student loans, dropping out, scholarships.
3. **Finance depth** — bank accounts, loans/mortgages, taxes (esp. crypto), bankruptcy, lawsuits,
   wills & **inheritance**, the **financial advisor** NPC.
4. **Investments parity** — penny stocks, funds; a richer price model and market-health indicators;
   the insider-tip popup flow polished (buy window, spike, sell, SEC probe, plead guilty halves sentence).
5. **Prison parity** — parole hearings, riots, escape attempts (lockpick minigame analog), contraband,
   reduced sentence for good behavior.
6. **Relationships parity** — friends/coworkers/exes/in-laws, a **family tree**, custody, cheating,
   divorce + assets split, emancipation, **generations** (continue as your child after death).
7. **Fame path** — social media, books, music, movies, going viral; the Fame bar; famous-only events.
8. **Ribbons/achievements system** — a proper end-of-life ribbon and a fuller achievement set.
9. **UI polish** — closer to BitLife's look; per-relationship screens; assets dashboard; settings.
10. **Image quality** — better avatar prompts (consistent identity across ages is hard with SD 1.5;
    consider seeding by character, or an optional FLUX/Z-Image path via `pregen_art.py`); more scene keys.

> Keep every addition deterministic-first and run it through `applyEffects`. Add events as **data**,
> not code, wherever possible.

---

## 7. How to run & debug

### Run
```bash
python3 serve.py 8080            # (monorepo: python3 scripts/serve-threaded.py 8080)
# open http://localhost:8080/index.html   in Chrome/Edge (WebGPU)
```

### Fast debug loop (no model downloads)
- Tick **"Skip loading AI models"** → the deterministic engine runs instantly. Age up repeatedly;
  open every modal; verify stats clamp, events fire, crime jails you, insider tip → sell → SEC roll,
  death screen, save/reload. This is the right way to test engine logic.

### Debugging the AI paths
- Open the **Debug** panel (bottom of the game) for last prompt/response sizes, JSON parse status,
  and the sanitized effects actually applied. Use the **browser console** for worker/model errors.
- **Typed input issues:** the model may emit prose around the JSON or malformed JSON — `extractFirstJson`
  handles most; if effects look wrong, check `sanitizeLlmEffects`. Test an absurd input
  ("set health to 9999") and confirm it's clamped.
- **Image issues:** confirm "SD 1.5 loaded" pill; the worker import path must resolve (served from
  the folder containing `vendor/`). SD only accepts 512×512 / steps 20 — don't change that. Watch for
  WebGPU OOM on low-VRAM machines (handled with a friendly message; fall back to WASM is slow).
- **Worker path errors** ("failed to fetch host.js / module") almost always mean you opened the file
  directly or aren't serving from the right root. Use `serve.py` and the `http://localhost` URL.
- **Reproduce a bug deterministically:** note the **seed** (☰ Menu) and the action sequence; the same
  seed + actions reproduce the life.

### Common pitfalls (quick reference)
- `file://` won't work — must serve over http.
- Safari lacks default WebGPU — use Chrome/Edge.
- First load downloads ~5 GB (Gemma + SD 1.5), cached afterward; shared with `browser_adventure`.
- Don't let the LLM set absolute stats — deltas only, always clamped.
- Don't block gameplay on the LLM or images — both are optional enhancements.

---

## 8. File map (standalone repo)
```
index.html          # the entire game (engine + UI + LLM + image manager)
bitlife_data.json   # premade content (events, activities, careers, market, tips, achievements)
vendor/web-txt2img/ # bundled in-browser Stable Diffusion 1.5 worker (do not edit lightly)
serve.py            # COOP/COEP dev server (serves this folder)
pregen_art.py       # OPTIONAL GPU batch baker -> assets/ + manifest.json
assets/             # optional pre-generated PNGs (manifest.json maps scene keys -> files)
requirements.txt    # deps for pregen_art.py only
README.md           # quick start
BACKGROUND.md       # this document
```

*Maintainer: Jonathan Rothberg, 2026. The local-AI stack is reused from this repo's
`browser_adventure` / `llm_adventure`.*
