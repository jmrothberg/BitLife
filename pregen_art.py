#!/usr/bin/env python3
"""
pregen_art.py — OPTIONAL ahead-of-time art baker for JMR's BitLife.

The browser game (index.html) paints the avatar and life-event scenes with
in-browser Stable Diffusion 1.5. That's slow on first use, so the game also:
  1) uses any pre-baked PNGs found in assets/ (via manifest.json) INSTANTLY,
  2) caches everything it generates in IndexedDB (second run is instant),
  3) pre-renders likely-needed images in the background while you play.

This script covers layer (1): on a machine with a GPU, it batch-generates the
life-event scene set and writes:
    assets/scene_<key>.png
    assets/manifest.json   ->  { "scene:<key>": "scene_<key>.png", ... }

The whole bake list is DERIVED FROM bitlife_data.json, so when you expand the
game the baker stays in sync with zero edits here:
    • milestones   SCENE_EVENTS         -> scene_<key>.png      (manifest "scene:<key>")
    • every career CAREERS[].id          -> scene_job_<id>.png   (manifest "scene:job_<id>")
    • events w/art EVENTS[][].art        -> scene_event_<id>.png (manifest "scene:event_<id>")
Milestone prompt text is read from index.html SCENE_PROMPTS; career prompts come
from each job's title (or an optional CAREERS[].art); event prompts from the
event's `art`. Add a career or an `art` field to bitlife_data.json, re-run, and
the new scene is baked. Scenes already in manifest.json + assets/ are skipped.

Usage:
    python3 pregen_art.py                 # bake only new/missing scenes (SD 1.5)
    python3 pregen_art.py --model flux    # FLUX.1-schnell instead
    python3 pregen_art.py --force         # rebake everything from scratch
    python3 pregen_art.py --only job_actor event_prom   # specific keys only

Requires: torch + diffusers (+ the chosen model weights). See requirements.txt.
"""

import os
import re
import json
import argparse

# Fallback if bitlife_data.json / index.html can't be read (keep in sync with index.html).
FALLBACK_SCENE_PROMPTS = {
    "birth":      "a newborn baby in a hospital, joyful parents",
    "firstDay":   "a child on their first day of school with a backpack",
    "graduation": "a graduate in cap and gown holding a diploma",
    "newJob":     "a person in work uniform on their first day at a new job",
    "promotion":  "a happy professional celebrating a promotion in an office",
    "wedding":    "a couple getting married at a wedding ceremony",
    "baby":       "happy parents holding a newborn baby",
    "prison":     "a person in an orange jumpsuit behind prison bars",
    "lottery":    "a person celebrating with a shower of money, jackpot",
    "death":      "a quiet graveyard with a single tombstone at dusk",
    "homeowner":  "a person holding keys in front of a new house",
    "activity":   "a person engaged in a life activity",
}
FALLBACK_SCENE_EVENTS = list(FALLBACK_SCENE_PROMPTS.keys())
SCENE_STYLE = "cinematic illustration, dramatic lighting"

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
DATA_JSON = os.path.join(HERE, "bitlife_data.json")
INDEX_HTML = os.path.join(HERE, "index.html")


def load_data():
    """The whole bitlife_data.json (the single source of truth for content)."""
    try:
        with open(DATA_JSON, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[pregen] warn: could not read {DATA_JSON}: {e}")
        return {}


def load_scene_prompts():
    """Prompt strings — parsed from index.html SCENE_PROMPTS (same object the game uses)."""
    try:
        with open(INDEX_HTML, encoding="utf-8") as f:
            text = f.read()
        m = re.search(r"const SCENE_PROMPTS\s*=\s*\{([^}]+)\}", text, re.DOTALL)
        if m:
            prompts = dict(re.findall(r"(\w+)\s*:\s*\"([^\"]*)\"", m.group(1)))
            if prompts:
                return prompts
    except Exception as e:
        print(f"[pregen] warn: could not parse SCENE_PROMPTS from {INDEX_HTML}: {e}")
    return dict(FALLBACK_SCENE_PROMPTS)


def build_bake_map(data, scene_prompts):
    """Every scene key the game can look up -> its prompt, derived from the data.

    Keys match the game's `scene:<key>` lookups (see index.html scenePromptFor):
      milestones -> "<key>"            (birth, wedding, …)  + "activity"
      careers    -> "job_<careerId>"   for every CAREERS entry
      events     -> "event_<eventId>"  for every EVENT that has an `art` field
    """
    bake = {}
    # 1) milestones (SCENE_EVENTS) + generic activity fallback
    for k in (data.get("SCENE_EVENTS") or FALLBACK_SCENE_EVENTS):
        bake[k] = scene_prompts.get(k) or FALLBACK_SCENE_PROMPTS.get(k) or k
    bake.setdefault("activity", scene_prompts.get("activity") or FALLBACK_SCENE_PROMPTS["activity"])
    # forward-compat: any extra SCENE_PROMPTS keys
    for k, v in scene_prompts.items():
        bake.setdefault(k, v)
    # 2) per-career hire art (job title, or an optional CAREERS[].art override)
    for c in (data.get("CAREERS") or []):
        cid, title = c.get("id"), c.get("title", "")
        if cid:
            bake[f"job_{cid}"] = c.get("art") or f"a {title.lower()} at work, on the job"
    # 3) per-event art for any event that opts in with an `art` field
    for events in (data.get("EVENTS") or {}).values():
        for e in events:
            if e.get("art") and e.get("id"):
                bake[f"event_{e['id']}"] = e["art"]
    return bake


def is_scene_baked(key, manifest):
    """True if manifest + PNG already cover this scene key."""
    fname = f"scene_{key}.png"
    return manifest.get(f"scene:{key}") == fname and os.path.isfile(os.path.join(ASSETS, fname))


def pick_device():
    import torch
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load_sd15(device):
    import torch
    from diffusers import StableDiffusionPipeline
    dtype = torch.float16 if device == "cuda" else torch.float32
    pipe = StableDiffusionPipeline.from_pretrained(
        "runwayml/stable-diffusion-v1-5", torch_dtype=dtype, safety_checker=None
    )
    pipe = pipe.to(device)
    return pipe, dict(height=512, width=512, guidance_scale=7.5)


def load_flux(device):
    import torch
    from diffusers import FluxPipeline
    dtype = torch.float16 if device == "cuda" else torch.float32
    pipe = FluxPipeline.from_pretrained(
        "black-forest-labs/FLUX.1-schnell", torch_dtype=dtype
    )
    pipe = pipe.to(device)
    return pipe, dict(height=512, width=512, guidance_scale=0.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["sd15", "flux"], default="sd15")
    ap.add_argument("--steps", type=int, default=None, help="inference steps (default 20 SD / 4 FLUX)")
    ap.add_argument("--only", nargs="*", help="only these scene keys")
    ap.add_argument("--force", action="store_true", help="rebake all scenes even if already present")
    args = ap.parse_args()

    os.makedirs(ASSETS, exist_ok=True)

    data = load_data()
    scene_prompts = load_scene_prompts()
    bake_map = build_bake_map(data, scene_prompts)
    keys = args.only if args.only else list(bake_map.keys())

    manifest = {}
    mpath = os.path.join(ASSETS, "manifest.json")
    if os.path.exists(mpath):
        try:
            manifest = json.load(open(mpath, encoding="utf-8"))
        except Exception:
            manifest = {}

    # Default: skip scenes already baked; only generate what the expanded game added.
    to_bake = keys if args.force else [k for k in keys if not is_scene_baked(k, manifest)]
    skipped = len(keys) - len(to_bake)

    print(f"[pregen] game wants {len(keys)} scene(s); {skipped} already baked, {len(to_bake)} to generate")
    if not to_bake:
        print("[pregen] nothing new to bake — done.")
        return

    device = pick_device()
    print(f"[pregen] device={device} model={args.model}")

    if args.model == "flux":
        pipe, extra = load_flux(device)
        steps = args.steps if args.steps is not None else 4
    else:
        pipe, extra = load_sd15(device)
        steps = args.steps if args.steps is not None else 20

    generated = 0
    for key in to_bake:
        manifest_key = f"scene:{key}"
        fname = f"scene_{key}.png"
        fpath = os.path.join(ASSETS, fname)

        prompt = f"{bake_map.get(key) or FALLBACK_SCENE_PROMPTS.get(key) or key}, {SCENE_STYLE}"
        print(f"[pregen] scene:{key}  -> {prompt}")
        image = pipe(prompt=prompt, num_inference_steps=steps, **extra).images[0]
        image.save(fpath)
        manifest[manifest_key] = fname
        generated += 1

    json.dump(manifest, open(mpath, "w", encoding="utf-8"), indent=2)
    print(f"[pregen] generated {generated}, skipped {skipped}; manifest has {len(manifest)} entries in {ASSETS}")
    print("[pregen] Done. The game will now use these instantly (priority: static asset > IndexedDB cache > live gen).")


if __name__ == "__main__":
    main()
