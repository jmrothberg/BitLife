<p align="center">
  <a href="https://jmrothberg.github.io/BitLife/">
    <img src="assets/og.png" alt="JMR's BitLife — play in your browser" width="640" />
  </a>
</p>

<h1 align="center">▶ <a href="https://jmrothberg.github.io/BitLife/">Play JMR's BitLife in your browser</a></h1>

<p align="center">
  <b>https://jmrothberg.github.io/BitLife/</b><br/>
  No install. No login. Click the link, the game loads, everything runs locally in your browser.
</p>

---

# BitLife — local-LLM life simulator

A **BitLife-style life simulator** that runs entirely in your browser. The game engine is
**premade and deterministic** — you live a life by clicking **Age Up** and menu buttons, and it
works **instantly with no AI models loaded at all**. Type any free-form action and a small
**local LLM** (Gemma 4 E4B via Transformers.js / WebGPU) interprets it into bounded, sanitized
game effects. A **local diffuser** (Stable Diffusion 1.5, bundled in `vendor/web-txt2img/`) paints
your character avatar and life-event scenes.

Includes a stock market with stocks, crypto and bonds that move every year, plus **insider trading**
— act on a tip for a big gain, but the SEC may investigate and send you to prison (the "Martha"
achievement). Plus real estate, pets, fame, achievements/ribbons, multiple save slots, and seeded
reproducible lives.

## Play it from GitHub

The repo is set up to be served as a static site straight from GitHub Pages — no install, no
server. Anyone with the link opens it, the page loads, and from then on everything runs in their
browser (models stream from the Hugging Face CDN on first load, then live in IndexedDB).

**Live URL (after enabling Pages):** `https://jmrothberg.github.io/BitLife/`

**One-time setup on GitHub:**

1. Push this repo to GitHub.
2. Repo → **Settings → Pages**.
3. *Source:* **Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
4. Wait ~1 min for the first deploy. Drop a 1200×630 PNG at `assets/og.png` for the link-preview
   card when the URL is pasted into Slack / iMessage / Twitter etc.

**How cross-origin isolation works on Pages.** The in-browser image worker (Stable Diffusion 1.5
via `onnxruntime-web`) needs `crossOriginIsolated` for SharedArrayBuffer / WASM threads. GitHub
Pages can't set COOP/COEP headers, so the page registers `coi-serviceworker.js` on first visit —
it installs a service worker that re-injects those headers, then auto-reloads once. After that,
WebGPU + threaded WASM both work as if you were running `serve.py` locally. (Requires HTTPS,
which Pages provides automatically. `.nojekyll` is included so Pages serves every file as-is.)

## Run it locally

For local development you can also use the included server, which sets the same COOP/COEP
headers directly (no service-worker reload step):

```bash
cd ~/BitLife
python3 serve.py 8080
# then open:
http://localhost:8080/index.html
```

- **Browser:** Chrome/Edge 113+ with **WebGPU** strongly recommended (WASM fallback works, slower).
- **First load:** downloads ~5 GB of models (Gemma + SD 1.5), cached afterward.
- **No-AI mode:** tick *"Skip loading AI models"* on the start screen to play the deterministic game
  only (no typed AI, no images) — instant.
- **Ollama option:** tick *"Use local Ollama"* and give a model name to route typed actions through
  a local Ollama server instead of in-browser Gemma (set `OLLAMA_ORIGINS` so the browser can reach it).

## Layout

| Path | What it is |
|------|------------|
| `index.html` | The entire self-contained game (engine + UI + LLM/image integration). |
| `bitlife_data.json` | Premade content tables (events, activities, careers, market, insider tips, achievements). A minimal copy is embedded in `index.html` as `FALLBACK_DATA` so it still runs if this file can't be fetched. |
| `vendor/web-txt2img/` | Bundled in-browser Stable Diffusion 1.5 worker (ONNX Runtime Web / WebGPU). |
| `serve.py` | Dev server that sends the COOP/COEP headers the worker needs. |
| `pregen_art.py` | **Optional** GPU batch baker for life-event scene art (writes `assets/` + `manifest.json`). |
| `assets/` | Optional pre-generated PNGs used **instantly** when present. |

## Art is "made in advance" where practical

Every image resolves **static asset → IndexedDB cache → live generate**:

1. **Static assets (instant):** if `assets/manifest.json` exists, matching scenes load with no
   generation. Bake them with `python3 pregen_art.py` on a machine with a GPU.
2. **Persistent cache:** everything generated in-browser is stored in **IndexedDB**, so replays and
   later sessions are instant.
3. **Idle background pre-render:** once SD 1.5 loads, the game pre-renders the current + next
   life-stage avatar and common event scenes during idle time — without blocking play.

## Safety of typed actions

Typed actions go to the LLM, which must return a small JSON directive. All proposed effects are
clamped (`sanitizeLlmEffects` → `applyEffects` → 0–100), so the AI flavors the story but can't break
the game. A parse failure just shows narration; gameplay never blocks on the model.

---
*v1.0 — Jonathan Rothberg, 2026.*
