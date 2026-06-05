#!/usr/bin/env python3
"""
pregen_art.py — OPTIONAL ahead-of-time art baker for JMR's BitLife.

The browser game (bitlife.html) paints the avatar and life-event scenes with
in-browser Stable Diffusion 1.5. That's slow on first use, so the game also:
  1) uses any pre-baked PNGs found in bitlife/assets/ (via manifest.json) INSTANTLY,
  2) caches everything it generates in IndexedDB (second run is instant),
  3) pre-renders likely-needed images in the background while you play.

This script covers layer (1): on a machine with a GPU (the same kind used by
mini_flux_MTS_CUDA_8_1_25.py / zimageturbo.py), it batch-generates the curated
life-event scene set and writes:
    bitlife/assets/scene_<key>.png
    bitlife/assets/manifest.json   ->  { "scene:<key>": "scene_<key>.png", ... }

The game looks up exactly those manifest keys, so dropping these files in makes
those moments appear with zero in-browser generation.

Usage:
    python3 bitlife/pregen_art.py                 # SD 1.5, auto device
    python3 bitlife/pregen_art.py --model flux    # FLUX.1-schnell (faster, nicer)
    python3 bitlife/pregen_art.py --steps 25

Requires: torch + diffusers (+ the chosen model weights). See requirements.txt.
"""

import os
import sys
import json
import argparse

# Keys MUST match SCENE_PROMPTS / SCENE_EVENTS in bitlife.html.
SCENE_PROMPTS = {
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
SCENE_STYLE = "cinematic illustration, dramatic lighting"

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")


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
    args = ap.parse_args()

    os.makedirs(ASSETS, exist_ok=True)
    device = pick_device()
    print(f"[pregen] device={device} model={args.model}")

    if args.model == "flux":
        pipe, extra = load_flux(device)
        steps = args.steps if args.steps is not None else 4
    else:
        pipe, extra = load_sd15(device)
        steps = args.steps if args.steps is not None else 20

    keys = args.only if args.only else list(SCENE_PROMPTS.keys())
    manifest = {}
    # keep any existing manifest entries (e.g. hand-made avatars)
    mpath = os.path.join(ASSETS, "manifest.json")
    if os.path.exists(mpath):
        try:
            manifest = json.load(open(mpath))
        except Exception:
            manifest = {}

    for key in keys:
        prompt = f"{SCENE_PROMPTS[key]}, {SCENE_STYLE}"
        print(f"[pregen] scene:{key}  -> {prompt}")
        image = pipe(prompt=prompt, num_inference_steps=steps, **extra).images[0]
        fname = f"scene_{key}.png"
        image.save(os.path.join(ASSETS, fname))
        manifest[f"scene:{key}"] = fname

    json.dump(manifest, open(mpath, "w"), indent=2)
    print(f"[pregen] wrote {len(keys)} images + manifest.json with {len(manifest)} entries to {ASSETS}")
    print("[pregen] Done. The game will now use these instantly (priority: static asset > IndexedDB cache > live gen).")


if __name__ == "__main__":
    main()
