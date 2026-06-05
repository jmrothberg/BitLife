# BitLife — local-LLM life simulator

A **BitLife-style life simulator** that runs entirely in your browser. The game engine is **premade
and deterministic** — you live a life by clicking **Age Up** and menu buttons, and it works
**instantly with no AI models loaded at all**. The only two additions over real BitLife:

1. **A local in-browser LLM** (Gemma 4 E4B via Transformers.js / WebGPU) interprets anything you
   **type** in the free-text box into bounded, sanitized game effects + narration.
2. **A local in-browser diffuser** (Stable Diffusion 1.5) paints your character **avatar** and
   **life-event scenes**.

It includes stats, yearly random events, activities, careers/education, crime → prison, casino, a
stock market with **insider trading** (the "Martha" achievement), real estate, pets, fame,
achievements/ribbons, seeded reproducible lives, and multiple save slots.

> **Continuing this project / handing off to another LLM?** Read **[BACKGROUND.md](./background.md)**
> first — it is the full brief: original goals, how real BitLife works (with sources), the two
> advances in detail, the complete code architecture, the roadmap to feature parity, and debugging
> notes. This README is the quick-start + "everything you need to start over."

---

## Quick start (run it)

The in-browser image worker needs the page served over http with COOP/COEP headers — **double-clicking
`index.html` will NOT work** (browsers block modules + workers on `file://`). Use the included server:

```bash
cd <this folder>
python3 serve.py 8080
# then open in Chrome or Edge:
http://localhost:8080/index.html
```
*(In the original monorepo the game is `bitlife/bitlife.html`, served via `python3 scripts/serve-threaded.py 8080`.)*

- **Browser:** Chrome/Edge **113+ with WebGPU** strongly recommended (Safari lacks default WebGPU; WASM fallback works but is slow).
- **First AI load:** ~5 GB of models (Gemma + SD 1.5), cached afterward.
- **Instant mode:** on the start screen tick **"Skip loading AI models"** to play the deterministic
  game with no downloads, no typed AI, no images — the fastest way to test the engine.
- **Ollama option:** tick **"Use local Ollama"** + a model name to route typed actions through a
  local Ollama server instead of in-browser Gemma (set `OLLAMA_ORIGINS` so the browser can reach it).

---

## Everything you need to start over

### Prerequisites
- A modern Chromium browser with WebGPU (Chrome/Edge 113+).
- Python 3 (only to run the static dev server, and optionally `pregen_art.py`).
- No build step, no npm — everything loads from CDN via an importmap.

### The two AI components (exact identifiers)
| Role | Model | Runtime | Notes |
|------|-------|---------|-------|
| Typed-input LLM | `onnx-community/gemma-4-E4B-it-ONNX` | Transformers.js **v4.0.1** + ONNX Runtime Web, `pipeline("text-generation", …, {dtype:"q4", device:"webgpu"\|"wasm"})` | Must fetch `chat_template.jinja` explicitly (Gemma 4 ONNX doesn't put it in tokenizer_config). Sampling temp 1.0 / top_p 0.95 / top_k 64. |
| Image diffuser | `"sd-1.5"` (Stable Diffusion 1.5 WebNN ONNX) | bundled **`vendor/web-txt2img/`** worker (`Txt2ImgWorkerClient`) on WebGPU, in a Web Worker | **Only 512×512**, steps **20**, guidance **7.5**, CLIP truncates at **77 tokens** → keep prompts short. |

### The importmap (CDN pins — copy verbatim if rebuilding)
```html
<script type="importmap">
{ "imports": {
  "onnxruntime-web": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.bundle.min.mjs",
  "onnxruntime-web/webgpu": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.webgpu.bundle.min.mjs",
  "onnxruntime-web/wasm": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.bundle.min.mjs",
  "@huggingface/transformers": "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.1/+esm",
  "@xenova/transformers": "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm"
}}
</script>
```

### Image worker API (the only non-CDN dependency — keep `vendor/web-txt2img/` intact)
```js
import { Txt2ImgWorkerClient } from "./vendor/web-txt2img/index.js";
const client = Txt2ImgWorkerClient.createDefault();
await client.load("sd-1.5", { backendPreference:["webgpu","wasm"],
  wasmPaths:"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/", wasmNumThreads:4, wasmSimd:true }, onProgress);
const { promise } = client.generate({ model:"sd-1.5", prompt, seed, steps:20, guidanceScale:7.5 },
  onProgress, { busyPolicy:"queue", debounceMs:200 });
const res = await promise;            // { ok:true, blob: <PNG Blob> }
```

### Hard design rules (don't break these)
- **Deterministic-first:** the engine never depends on the LLM or diffuser; both are background
  enhancements. The game must be fully playable with "Skip loading AI models."
- **LLM only touches the free-text box.** Buttons run instant local logic.
- **LLM can't break the game:** every effect it returns is clamped via
  `sanitizeLlmEffects → applyEffects → clampStat (0–100)`.
- **Reproducible:** all randomness goes through one seeded `mulberry32` RNG; a seed reproduces a life.
- **Serve from the folder that contains `vendor/`** (so the worker's relative import resolves), over
  http with COOP/COEP (that's what `serve.py` does).

---

## File map
```
index.html          # the ENTIRE game: importmap + CSS + content fallback + engine + LLM + image manager + UI
bitlife_data.json   # premade content: events, activities, careers, market, insider tips, achievements, names
vendor/web-txt2img/ # bundled in-browser Stable Diffusion 1.5 worker (ONNX Runtime Web / WebGPU)
serve.py            # COOP/COEP dev server (serves this folder)
pregen_art.py       # OPTIONAL GPU batch baker -> assets/ + manifest.json (pre-bakes scene art)
assets/             # optional pre-generated PNGs; manifest.json maps scene keys -> files
requirements.txt    # deps for pregen_art.py only (torch + diffusers)
README.md           # this file
background.md       # full handoff brief / spec (read this to continue the project)
```

---

## How it works (at a glance)

- **Content (`bitlife_data.json`)** — all events, activities, careers, market, tips, achievements as
  plain data. A minimal copy is embedded in `index.html` as `FALLBACK_DATA` so the game runs even if
  the fetch fails. **This file is where most BitLife-parity growth should happen.**
- **State (`game` object)** — one source of truth: `character` (stats/money/age/education/job),
  `relationships[]`, `assets[]`/`portfolio[]`, `market`, `prison`, `flags`, `achievements[]`,
  `pendingEvent`, `activeTip`, `log[]`, `seed`/`rngState`. Saved to `localStorage` (multiple slots).
- **Engine** — `ageUp()` advances a year (stat drift, education, markets, salary, relationship aging
  & deaths, maybe an insider tip, a weighted random event that may block on a choice popup, death
  check). `applyEffects()` is the single clamped mutation point. Activities/careers/crime/casino/
  investing/relationships are deterministic functions.
- **Insider trading** — `maybeInsiderTip()` drops a tip from a friend/family member; if you buy then
  sell on it, `runInsiderTip()` rolls an SEC arrest → prison + the "Martha" achievement.
- **Typed input → LLM** — sends a compact state snapshot + your text; the model returns
  `{narration, effects, relationship_changes, set_flags, grant_achievement, event_image}`, which is
  parsed tolerantly and sanitized/clamped before applying.
- **Images + pre-generation** — every image resolves **static asset → IndexedDB cache → live
  generate** (then cache). Once SD loads, an **idle background queue** pre-renders the current + next
  life-stage avatar and common event scenes. `pregen_art.py` bakes the static set ahead of time.

---

## How to extend toward real BitLife

The highest-leverage work is **adding content as data** in `bitlife_data.json`:
- **More random events** per life stage (use the BitLife Fandom wiki for faithful wording) — each is
  `{id, weight, minAge, maxAge, text, choices:[{label, effects, outcome?}]}` or a `noChoice` event.
- **More activities** (`ACTIVITIES.<category>`), **careers** incl. special careers (royalty,
  military, famous, athlete, mafia, politics), degrees, market assets, and insider tips.
- Effects are flat deltas applied through `applyEffects` (auto-clamped). Keep everything
  deterministic; reserve the LLM for free-typed actions only.

See **background.md §6** for the full prioritized roadmap (education/finance/prison/relationships/
fame depth, ribbons, UI polish, avatar-identity consistency).

---

## Debugging

- **Fast loop:** tick "Skip loading AI models" and exercise the engine (age up, every modal, crime →
  jail, insider tip → sell → SEC, death, save/reload). No downloads needed.
- **Debug panel** (bottom of the game): last LLM prompt/response sizes, JSON parse status, applied
  effects, RNG state. Use the **browser console** for worker/model errors.
- **Reproduce bugs deterministically:** note the **seed** (☰ Menu) + your action sequence.
- **Common pitfalls:** `file://` won't work (must serve over http); Safari has no default WebGPU
  (use Chrome/Edge); worker "failed to fetch host.js" means you're not serving from the folder with
  `vendor/`; SD is fixed at 512×512/steps 20 — don't change it; the LLM must emit deltas only.

---

## Pre-generating art (optional, needs a GPU)
```bash
pip install -r requirements.txt
python3 pregen_art.py            # SD 1.5, writes assets/scene_*.png + assets/manifest.json
python3 pregen_art.py --model flux   # FLUX.1-schnell instead (faster/nicer if you have it)
```
The game then loads those scenes **instantly** (priority: static asset → IndexedDB → live gen).

---
*v1.0 — Jonathan Rothberg, 2026. Local-AI stack reused from this repo's `browser_adventure` / `llm_adventure`.*
