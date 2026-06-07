#!/usr/bin/env bash
# Fast, dependency-free smoke test for JMR's BitLife.
#   Usage:  bash tests/check.sh
# Checks: engine + mini-game JS syntax, JSON validity, and data-integrity
# invariants (unique ids, casino house-edge, FALLBACK ribbons in sync with JSON).
# Exits non-zero on any failure so it can gate commits / CI.
set -u
cd "$(dirname "$0")/.." || exit 1
fail=0

# 1) Engine syntax (extract the <script type="module"> from index.html)
L1=$(grep -n '<script type="module">' index.html | tail -1 | cut -d: -f1)
L2=$(grep -n '</script>' index.html | tail -1 | cut -d: -f1)
sed -n "$((L1+1)),$((L2-1))p" index.html > /tmp/bl_engine.mjs
if node --check /tmp/bl_engine.mjs 2>/tmp/bl_err; then echo "✓ engine syntax"; else echo "✗ engine syntax"; cat /tmp/bl_err; fail=1; fi

# 2) Mini-game module syntax
for f in minigames/*.js; do
  if node --check "$f" 2>/tmp/bl_err; then echo "✓ $f"; else echo "✗ $f"; cat /tmp/bl_err; fail=1; fi
done

# 3) JSON valid
if python3 -m json.tool bitlife_data.json > /dev/null 2>/tmp/bl_err; then echo "✓ bitlife_data.json valid"; else echo "✗ bitlife_data.json invalid"; cat /tmp/bl_err; fail=1; fi

# 4) Data-integrity invariants
python3 - <<'PY' || fail=1
import json, re, sys
d = json.load(open('bitlife_data.json')); errs = []
for st, arr in d['EVENTS'].items():
    ids = [e['id'] for e in arr]
    if len(set(ids)) != len(ids): errs.append(f"duplicate event id in stage '{st}'")
for key in ('CAREERS',):
    ids = [c['id'] for c in d[key]]
    if len(set(ids)) != len(ids): errs.append(f"duplicate id in {key}")
# casino gamble-path games must have house edge (EV < 1) or they're a money faucet
for g in d['ACTIVITIES']['casino']:
    if 'winChance' in g and 'payoutMult' in g:
        ev = g['winChance'] * sum(g['payoutMult']) / 2
        if ev >= 1.0: errs.append(f"casino '{g['id']}' EV={ev:.2f} >= 1 (money faucet)")
# FALLBACK_DATA ribbons (index.html) must match bitlife_data.json ribbons
html = open('index.html').read()
fb = set(re.findall(r'(\w+):\s*\{\s*label:', html))          # bareword keys in the JS fallback
js = set(d['ACHIEVEMENTS'].keys())
missing = js - fb
if missing: errs.append(f"FALLBACK_DATA missing ribbons present in JSON: {sorted(missing)}")
# Guard audit: the PLAYER_ACTIONS registry (in index.html) is the single source of
# truth for player actions + their prison rule. Every action marked prison:"block"
# whose guard isn't the relationship whitelist MUST call requireFree() near its top,
# so it refuses while in prison (prevents the 'roommate-in-jail' bug class). Add a new
# free-only action to PLAYER_ACTIONS and this audits it automatically.
pa = re.search(r'const PLAYER_ACTIONS\s*=\s*\[(.*?)\];', html, re.S)
if not pa:
    errs.append("guard audit: PLAYER_ACTIONS registry not found in index.html")
else:
    audited = 0
    for ent in re.findall(r'\{([^}]*)\}', pa.group(1)):
        fnm = re.search(r'fn:\s*"(\w+)"', ent)
        if not fnm: continue
        name = fnm.group(1)
        if not re.search(r'prison:\s*"block"', ent): continue   # allowed in prison
        if re.search(r'guard:', ent): continue                  # gated another way (e.g. rel whitelist)
        m = re.search(r'\n  function '+re.escape(name)+r'\([^)]*\)\s*\{(.{0,200})', html, re.S)
        if not m: errs.append(f"guard audit: PLAYER_ACTIONS lists {name}() but no such function"); continue
        if 'requireFree' not in m.group(1):
            errs.append(f"guard audit: {name}() is prison:'block' in PLAYER_ACTIONS but missing requireFree() — would run in prison")
        else: audited += 1
    if audited == 0: errs.append("guard audit: no free-only actions audited (PLAYER_ACTIONS parse failed?)")
if errs:
    print("✗ data integrity:")
    for e in errs: print("   -", e)
    sys.exit(1)
print("✓ data integrity (unique ids · casino EV<1 · FALLBACK ribbons synced · free-only actions guarded)")
PY

# 5) Headless self-check: boots the real engine under DOM stubs and runs 6 lives +
#    fuzz + the prison audit + an old-save migration test (same checks as
#    index.html#test=selfcheck, but in CI without a browser).
if out=$(node tests/headless.mjs 2>&1); then echo "✓ ${out}"; else echo "✗ headless self-check"; echo "$out"; fail=1; fi

if [ "$fail" -eq 0 ]; then echo "── all checks passed ──"; else echo "── FAILURES above ──"; fi
exit $fail
