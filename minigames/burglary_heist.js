// ─────────────────────────────────────────────────────────────────────────
// Burglary — a top-down sneak-and-grab mini-game for JMR's BitLife
// ─────────────────────────────────────────────────────────────────────────
// Creep through a house grabbing valuables while a homeowner patrols with a
// flashlight cone. Stay out of the light (or break line of sight behind
// furniture) — if the ALERT meter fills you're caught. Reach the 🚪 to escape
// with whatever you've grabbed. A careful player gets out rich.
//
// Same mini-game contract as the others (see ./street_fight.js):
//     export function start(host, api) { ... return cleanup; }
//     api.finish(result, payload?) — call ONCE. Burglary returns the loot:
//         api.finish("win",  { loot })   // escaped with $loot
//         api.finish("lose", { loot })   // caught (loot is forfeited by the host)
//     api.difficulty : 1..3  (scales guard speed / vision / alert)
//     api.opts       : { lootMax, guards, name }  (set by the chosen target)
//
// Canvas 2D, no engine. Skill-based — never calls the game's seeded rng()
// (cosmetic randomness uses Math.random). Reskin via SKIN.
// ─────────────────────────────────────────────────────────────────────────

// ── SKIN — swap to reskin tiles / actors with real art ─────────────────────
// To use sprites: set SKIN.sheet and provide draw overrides; otherwise the
// built-in vector art (floor, furniture, emoji loot, flashlight cone) is used.
const SKIN = {
  floor: "#171a26", wall: "#39405e", wallEdge: "#525c82",
  player: "#3fe0c5", guard: "#ff5a4a", cone: "rgba(255,238,150,0.16)", exit: "#35e06a"
};

export function start(host, api) {
  const D = Math.max(1, Math.min(3, api.difficulty || 1));
  const opts = api.opts || {};
  const LOOT_MAX = opts.lootMax || 6000;
  const GUARDS = Math.max(1, opts.guards || 1);

  // ── Canvas ──
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;background:#0a0c14";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1, M = 16;            // M = outer margin (the house walls)
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = host.clientWidth || window.innerWidth;
    H = host.clientHeight || window.innerHeight;
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    M = Math.max(14, Math.min(W, H) * 0.05);
    rebuild();
  }

  // ── House layout (built relative to canvas size) ──
  let walls = [], loot = [], guards = [], exitZone = null, player = null, U = 40;
  function rebuild() {
    U = Math.max(22, Math.min(W, H) * 0.07);    // unit size (player radius ~ U*0.4)
    const ax0 = M, ay0 = M, ax1 = W - M, ay1 = H - M; // inner play bounds
    // interior furniture / dividers (kept clear of the entry & exit lanes)
    const iw = ax1 - ax0, ih = ay1 - ay0;
    walls = [
      r(ax0 + iw * 0.30, ay0 + ih * 0.00, iw * 0.06, ih * 0.42),   // upper vertical divider (gap at bottom)
      r(ax0 + iw * 0.62, ay0 + ih * 0.30, iw * 0.06, ih * 0.70),   // lower vertical divider (gap at top)
      r(ax0 + iw * 0.00, ay0 + ih * 0.55, iw * 0.42, ih * 0.06),   // mid horizontal (gap at right)
      r(ax0 + iw * 0.12, ay0 + ih * 0.16, iw * 0.12, ih * 0.10),   // furniture block
      r(ax0 + iw * 0.74, ay0 + ih * 0.10, iw * 0.14, ih * 0.09),   // furniture block
      r(ax0 + iw * 0.40, ay0 + ih * 0.72, iw * 0.14, ih * 0.10)    // furniture block
    ];
    // entry (player start) bottom-left, exit door top-right
    player = player || { x: 0, y: 0, r: U * 0.4 };
    player.x = ax0 + iw * 0.08; player.y = ay1 - ih * 0.08; player.r = U * 0.4;
    exitZone = r(ax1 - iw * 0.16, ay0 + ih * 0.005, iw * 0.16, ih * 0.07);
    // loot — spread across open floor; values sum to ~LOOT_MAX
    const defs = [["💵", 0.16], ["📺", 0.12], ["⌚", 0.10], ["💍", 0.18], ["🖼️", 0.18], ["💎", 0.26]];
    loot = [];
    for (const [emoji, wgt] of defs) {
      const p = openSpot(ax0, ay0, ax1, ay1);
      loot.push({ x: p.x, y: p.y, value: Math.round(LOOT_MAX * wgt), emoji, taken: false });
    }
    // guards — patrol loops of open waypoints
    guards = [];
    const loops = [
      [[0.50, 0.18], [0.85, 0.18], [0.85, 0.78], [0.50, 0.78]],
      [[0.12, 0.40], [0.12, 0.85], [0.45, 0.85], [0.45, 0.40]]
    ];
    for (let i = 0; i < GUARDS; i++) {
      const wp = loops[i % loops.length].map(([fx, fy]) => ({ x: ax0 + iw * fx, y: ay0 + ih * fy }));
      guards.push({ x: wp[0].x, y: wp[0].y, wp, wi: 1, facing: 0, speed: U * (1.5 + 0.55 * D), range: U * (3.2 + 0.7 * D), half: 0.46 + 0.05 * D });
    }
  }
  function r(x, y, w, h) { return { x, y, w, h }; }
  function openSpot(ax0, ay0, ax1, ay1) {
    for (let t = 0; t < 200; t++) {
      const x = ax0 + Math.random() * (ax1 - ax0), y = ay0 + Math.random() * (ay1 - ay0);
      if (circleHitsWall(x, y, U * 0.5)) continue;
      if (Math.hypot(x - (ax0 + (ax1 - ax0) * 0.08), y - (ay1 - (ay1 - ay0) * 0.08)) < U * 2) continue; // not on start
      return { x, y };
    }
    return { x: (ax0 + ax1) / 2, y: (ay0 + ay1) / 2 };
  }

  // ── Geometry helpers ──
  function circleHitsWall(x, y, rad) {
    for (const wl of walls) {
      const cx = Math.max(wl.x, Math.min(x, wl.x + wl.w)), cy = Math.max(wl.y, Math.min(y, wl.y + wl.h));
      if ((x - cx) ** 2 + (y - cy) ** 2 < rad * rad) return true;
    }
    return x < M + rad || x > W - M - rad || y < M + rad || y > H - M - rad;
  }
  function pointInWall(x, y) { for (const wl of walls) if (x >= wl.x && x <= wl.x + wl.w && y >= wl.y && y <= wl.y + wl.h) return true; return false; }
  function losClear(ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay), steps = Math.ceil(d / (U * 0.3));
    for (let i = 1; i < steps; i++) { const t = i / steps; if (pointInWall(ax + (bx - ax) * t, ay + (by - ay) * t)) return false; }
    return true;
  }

  // ── Input (drag joystick + keyboard) ──
  const dir = { x: 0, y: 0 }; const keys = {};
  const onKey = (e, v) => { const k = e.key.toLowerCase(); if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(k)) { keys[k] = v; e.preventDefault(); } };
  const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
  window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
  let dragId = null, ox = 0, oy = 0;
  const pdown = (e) => { if (ended || e.target.id === "bg-quit" || e.target.id === "bg-cont") return; dragId = e.pointerId; ox = e.clientX; oy = e.clientY; stick.style.display = "block"; stick.style.left = (e.clientX - 42) + "px"; stick.style.top = (e.clientY - 42) + "px"; nub.style.left = "50%"; nub.style.top = "50%"; };
  const pmove = (e) => { if (dragId !== e.pointerId) return; const dx = e.clientX - ox, dy = e.clientY - oy, len = Math.hypot(dx, dy) || 1, cl = Math.min(len, 38), mag = Math.min(len / 38, 1); nub.style.left = (50 + (dx / len) * cl / 0.84) + "%"; nub.style.top = (50 + (dy / len) * cl / 0.84) + "%"; dir.x = (dx / len) * mag; dir.y = (dy / len) * mag; };
  const pup = (e) => { if (dragId !== e.pointerId) return; dragId = null; dir.x = dir.y = 0; stick.style.display = "none"; };
  canvas.addEventListener("pointerdown", pdown); canvas.addEventListener("pointermove", pmove);
  window.addEventListener("pointerup", pup); window.addEventListener("pointercancel", pup);

  // ── HUD ──
  const hud = document.createElement("div");
  hud.style.cssText = "position:absolute;inset:0;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#fff;user-select:none";
  hud.innerHTML = `
    <div style="position:absolute;top:10px;left:0;right:0;padding:0 12px;text-align:center;text-shadow:0 1px 3px #000">
      <div style="font-size:17px;font-weight:800"><span id="bg-loot">$0</span> grabbed</div>
      <div style="font-size:11px;opacity:.85">${opts.name ? opts.name + " · " : ""}sneak to the 🚪 with the loot — stay out of the light</div>
      <div style="max-width:240px;margin:6px auto 0;height:11px;background:#0008;border:1px solid #fff4;border-radius:5px;overflow:hidden"><div id="bg-alert" style="height:100%;width:0%;background:linear-gradient(90deg,#ffd14a,#ff5a4a)"></div></div>
      <div id="bg-spot" style="height:15px;margin-top:3px;color:#ff5a5a;font-weight:800;font-size:12px;text-shadow:0 1px 3px #000"></div>
    </div>
    <button id="bg-quit" style="position:absolute;top:10px;right:10px;pointer-events:auto;background:#0007;color:#fff;border:1px solid #fff4;border-radius:8px;padding:5px 9px;font-size:11px">Bail out</button>
    <div id="bg-stick" style="position:absolute;width:84px;height:84px;border-radius:50%;border:2px solid #fff5;display:none;pointer-events:none"><div id="bg-nub" style="position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:#fff8"></div></div>
    <div id="bg-end" style="position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;background:#000a;pointer-events:auto">
      <div id="bg-end-title" style="font-size:30px;font-weight:900;text-shadow:0 2px 8px #000"></div>
      <div id="bg-end-sub" style="font-size:14px;opacity:.9;margin-top:6px"></div>
      <button id="bg-cont" style="margin-top:18px;background:#c9a550;color:#1a1405;border:none;border-radius:10px;padding:11px 24px;font-size:16px;font-weight:700">Continue</button>
    </div>`;
  host.appendChild(hud);
  const stick = hud.querySelector("#bg-stick"), nub = hud.querySelector("#bg-nub");
  hud.querySelector("#bg-quit").addEventListener("click", () => endHeist(true));   // bail = escape with current loot

  window.addEventListener("resize", resize);
  resize();

  // ── State / loop ──
  let alert = 0, lootGot = 0, ended = false, finished = false, raf = 0, timeLeft = 85, _seen = false;
  let last = performance.now();
  function step() {
    raf = requestAnimationFrame(step);
    const now = performance.now(); const dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (!ended) { update(dt); }
    render();
  }
  function update(dt) {
    // player movement (keyboard overrides joystick)
    let mx = 0, my = 0;
    if (keys.arrowleft || keys.a) mx -= 1; if (keys.arrowright || keys.d) mx += 1;
    if (keys.arrowup || keys.w) my -= 1; if (keys.arrowdown || keys.s) my += 1;
    if (mx || my) { const l = Math.hypot(mx, my); mx /= l; my /= l; } else { mx = dir.x; my = dir.y; }
    const sp = U * 4.2 * dt;
    const nx = player.x + mx * sp, ny = player.y + my * sp;
    if (!circleHitsWall(nx, player.y, player.r)) player.x = nx;
    if (!circleHitsWall(player.x, ny, player.r)) player.y = ny;

    // loot pickup
    for (const it of loot) if (!it.taken && Math.hypot(player.x - it.x, player.y - it.y) < player.r + U * 0.4) { it.taken = true; lootGot += it.value; alert = Math.min(100, alert + 6); }

    // guards patrol + detection. A spotted guard turns to face the intruder and
    // closes in, so the cone is hard to escape — being seen really matters.
    let seen = false;
    for (const g of guards) {
      const pdx = player.x - g.x, pdy = player.y - g.y, pd = Math.hypot(pdx, pdy) || 1;
      const ang = Math.abs(angDiff(Math.atan2(pdy, pdx), g.facing));
      const detects = (pd < g.range && ang < g.half && losClear(g.x, g.y, player.x, player.y)) || pd < U * 1.2;
      g.alarmed = detects;
      if (detects) {
        seen = true;
        g.facing = Math.atan2(pdy, pdx);                                  // snap to face you (alarm!)
        if (pd > U * 1.0) { g.x += (pdx / pd) * g.speed * 1.15 * dt; g.y += (pdy / pd) * g.speed * 1.15 * dt; } // give chase
      } else {
        const tgt = g.wp[g.wi];
        const dx = tgt.x - g.x, dy = tgt.y - g.y, d = Math.hypot(dx, dy) || 1;
        if (d < U * 0.3) g.wi = (g.wi + 1) % g.wp.length;
        else { g.facing = Math.atan2(dy, dx); g.x += (dx / d) * g.speed * dt; g.y += (dy / d) * g.speed * dt; }
      }
    }
    // Sting the meter the instant you're first spotted, ramp it fast while in
    // the light, and let it cool only slowly — so a few exposures add up to a bust.
    if (seen && !_seen) alert = Math.min(100, alert + 18);
    _seen = seen;
    alert += (seen ? (44 + 14 * D) : -15) * dt;
    alert = Math.max(0, Math.min(100, alert));
    if (alert >= 100) return endHeist(false);

    // escape
    if (inRect(player.x, player.y, exitZone)) return endHeist(true);

    timeLeft -= dt;
    if (timeLeft <= 0) return endHeist(false);

    const le = hud.querySelector("#bg-loot"), ae = hud.querySelector("#bg-alert"), se = hud.querySelector("#bg-spot");
    if (le) le.textContent = "$" + lootGot.toLocaleString();
    if (ae) ae.style.width = alert + "%";
    if (se) se.textContent = _seen ? "👁 SPOTTED — break line of sight!" : "";
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    // floor
    ctx.fillStyle = SKIN.floor; ctx.fillRect(M, M, W - 2 * M, H - 2 * M);
    // outer wall frame
    ctx.lineWidth = M; ctx.strokeStyle = SKIN.wall; ctx.strokeRect(M / 2, M / 2, W - M, H - M);
    // exit door
    ctx.fillStyle = SKIN.exit; ctx.globalAlpha = 0.85; ctx.fillRect(exitZone.x, exitZone.y, exitZone.w, exitZone.h); ctx.globalAlpha = 1;
    ctx.fillStyle = "#0a2a16"; ctx.font = `${U * 0.6}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🚪", exitZone.x + exitZone.w / 2, exitZone.y + exitZone.h / 2);
    // furniture / walls
    for (const wl of walls) { ctx.fillStyle = SKIN.wall; ctx.fillRect(wl.x, wl.y, wl.w, wl.h); ctx.fillStyle = SKIN.wallEdge; ctx.fillRect(wl.x, wl.y, wl.w, 3); }
    // loot
    ctx.font = `${U * 0.62}px sans-serif`;
    for (const it of loot) if (!it.taken) ctx.fillText(it.emoji, it.x, it.y);
    // guards + flashlight cones (cone turns red & an "!" pops when they spot you)
    for (const g of guards) {
      ctx.fillStyle = g.alarmed ? "rgba(255,60,50,0.30)" : SKIN.cone; ctx.beginPath(); ctx.moveTo(g.x, g.y);
      ctx.arc(g.x, g.y, g.range, g.facing - g.half, g.facing + g.half); ctx.closePath(); ctx.fill();
      ctx.fillStyle = g.alarmed ? "#ff2a2a" : SKIN.guard; ctx.beginPath(); ctx.arc(g.x, g.y, U * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(g.x + Math.cos(g.facing) * U * 0.2, g.y + Math.sin(g.facing) * U * 0.2, U * 0.1, 0, Math.PI * 2); ctx.fill();
      if (g.alarmed) { ctx.fillStyle = "#ffe14a"; ctx.font = `bold ${U * 0.6}px sans-serif`; ctx.fillText("!", g.x, g.y - U * 0.7); }
    }
    // player
    ctx.fillStyle = SKIN.player; ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#0a2a26"; ctx.font = `${U * 0.5}px sans-serif`; ctx.fillText("🦝", player.x, player.y);
    // spotted! — pulsing red border so you can't miss that the meter is filling
    if (_seen) { ctx.strokeStyle = `rgba(255,40,40,${0.45 + 0.35 * Math.abs(Math.sin(performance.now() / 120))})`; ctx.lineWidth = 7; ctx.strokeRect(3.5, 3.5, W - 7, H - 7); }
  }

  function endHeist(escaped) {
    if (ended) return; ended = true;
    const title = hud.querySelector("#bg-end-title"), sub = hud.querySelector("#bg-end-sub"), end = hud.querySelector("#bg-end");
    if (escaped) { title.textContent = "CLEAN GETAWAY 💰"; title.style.color = "#35e06a"; sub.textContent = `You slipped out with $${lootGot.toLocaleString()}.`; }
    else { title.textContent = "BUSTED 🚨"; title.style.color = "#ff5a5a"; sub.textContent = "The homeowner caught you red-handed."; }
    end.style.display = "flex";
    hud.querySelector("#bg-cont").addEventListener("click", () => { if (!finished) { finished = true; api.finish(escaped ? "win" : "lose", { loot: lootGot }); } });
  }

  function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
  function inRect(x, y, q) { return x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h; }

  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  raf = requestAnimationFrame(step);

  return function cleanup() {
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku);
    window.removeEventListener("pointerup", pup); window.removeEventListener("pointercancel", pup);
    window.removeEventListener("resize", resize);
    if (hud.parentNode) hud.remove();
    if (canvas.parentNode) canvas.remove();
  };
}
