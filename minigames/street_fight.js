// ─────────────────────────────────────────────────────────────────────────
// Street Fight — a side-view fighting mini-game for JMR's BitLife
// ─────────────────────────────────────────────────────────────────────────
// Punch, kick, jump and duck your way through a one-on-one brawl. Beat the
// opponent's health to zero (or be ahead when time runs out) to win the fight.
//
// Same mini-game contract as the others (see ./prison_escape.js):
//     export function start(host, api) { ... return cleanup; }
//     api.finish("win" | "lose" | "quit")  — called once when the bout ends.
//
// This one is pure Canvas 2D (no Three.js) so it's light and trivially
// reskinnable. It draws built-in VECTOR fighters that visibly punch/kick/jump/
// duck — but everything visual is funnelled through `drawFighter()` and a SKIN
// config, so swapping in real sprite art later is a one-place change (see SKIN).
// Gameplay rock-paper-scissors: duck dodges punches, jump dodges kicks, block
// soaks both. Outcome is pure player skill — it never calls the game's rng().
// ─────────────────────────────────────────────────────────────────────────

// ── SKIN — swap this to reskin the fighters with real sprite art ───────────
// To use a sprite sheet instead of the built-in vector fighters:
//   1. Drop an image in ./minigames/assets/ (e.g. fighter.png), one row of
//      frames per state.
//   2. Set SKIN.sheet to its URL and fill SKIN.frames[state] = [{x,y,w,h}, …].
//   3. Done — drawFighter() draws from the sheet when it has loaded, and uses
//      the vector fighter until then (or whenever a state has no frames).
const SKIN = {
  sheet: null,                 // e.g. new URL("./assets/fighter.png", import.meta.url).href
  frames: {                    // state -> array of {x,y,w,h} source rects
    // idle: [], walk: [], punch: [], kick: [], jump: [], duck: [], hit: [], ko: []
  },
  drawH: 0.34,                 // fighter height as a fraction of canvas height
  fps: 8,
  // Per-side tint applied to the vector fighter (ignored when a sheet is used).
  playerColor: "#4aa3ff",
  enemyColor: "#ff5a4a"
};

export function start(host, api) {
  const difficulty = api.difficulty || 1;

  // ── Canvas ──
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;background:linear-gradient(180deg,#161a2e 0%,#26213a 55%,#3a2f44 100%)";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  let W = 0, H = 0, dpr = 1, GROUND = 0, FH = 120; // FH = fighter height (px)
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = host.clientWidth || window.innerWidth;
    H = host.clientHeight || window.innerHeight;
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    GROUND = H * 0.82;
    FH = Math.max(90, Math.min(210, H * SKIN.drawH));
  }
  resize();
  window.addEventListener("resize", resize);

  // ── Optional sprite sheet (loads async; vector fighter shows meanwhile) ──
  let sheetImg = null;
  if (SKIN.sheet) { const im = new Image(); im.onload = () => { sheetImg = im; }; im.src = SKIN.sheet; }

  // ── Fighter model ──
  function makeFighter(x, isPlayer, color) {
    return {
      x, y: 0, vx: 0, vy: 0, onGround: true, facing: isPlayer ? 1 : -1, isPlayer, color,
      health: 100, state: "idle", anim: 0, stateTimer: 0,
      attackType: null, attackTimer: 0, hitDone: false, cooldown: 0, hitFlash: 0, ko: false,
      input: { left: false, right: false, duck: false, block: false, jump: false, punch: false, kick: false },
      // AI scratch
      think: 0
    };
  }
  const player = makeFighter(W * 0.30, true, SKIN.playerColor);
  const enemy = makeFighter(W * 0.70, false, SKIN.enemyColor);

  // ── Tunables ──
  const GRAV = 2400, JUMP_V = 880, MOVE = () => FH * 1.7;
  const PUNCH = { dur: 0.26, cd: 0.34, dmg: 7, range: () => FH * 0.80 };
  const KICK = { dur: 0.40, cd: 0.55, dmg: 12, range: () => FH * 1.02 };
  const ROUND_TIME = 75;
  let timeLeft = ROUND_TIME, over = false, finished = false;

  // ── Input: keyboard ──
  const keymap = {
    arrowleft: "left", a: "left", arrowright: "right", d: "right",
    arrowup: "jump", w: "jump", arrowdown: "duck", s: "duck",
    j: "punch", z: "punch", k: "kick", x: "kick", l: "block", shift: "block"
  };
  function setKey(e, down) {
    const m = keymap[e.key.toLowerCase()];
    if (!m) return;
    e.preventDefault();
    if (m === "jump" || m === "punch" || m === "kick") { if (down) player.input[m] = true; } // edge
    else player.input[m] = down;                                                              // held
  }
  const kd = (e) => setKey(e, true), ku = (e) => setKey(e, false);
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);

  // ── Input: on-screen buttons (touch + mouse) ──
  const hud = document.createElement("div");
  hud.style.cssText = "position:absolute;inset:0;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#fff;user-select:none;-webkit-user-select:none";
  hud.innerHTML = `
    <div id="sf-bars" style="position:absolute;top:10px;left:0;right:0;padding:0 12px;display:flex;align-items:center;gap:10px">
      <div style="flex:1">
        <div style="font-size:11px;font-weight:700;text-shadow:0 1px 2px #000">YOU</div>
        <div style="height:12px;background:#0008;border:1px solid #fff5;border-radius:6px;overflow:hidden"><div id="sf-hp-p" style="height:100%;width:100%;background:linear-gradient(90deg,#35e06a,#a6ff7a)"></div></div>
      </div>
      <div id="sf-timer" style="font-size:20px;font-weight:900;text-shadow:0 1px 3px #000;min-width:34px;text-align:center">${ROUND_TIME}</div>
      <div style="flex:1">
        <div style="font-size:11px;font-weight:700;text-align:right;text-shadow:0 1px 2px #000">RIVAL</div>
        <div style="height:12px;background:#0008;border:1px solid #fff5;border-radius:6px;overflow:hidden"><div id="sf-hp-e" style="height:100%;width:100%;margin-left:auto;background:linear-gradient(90deg,#ffb14a,#ff5a4a)"></div></div>
      </div>
    </div>
    <button id="sf-quit" style="position:absolute;top:38px;right:10px;pointer-events:auto;background:#0007;color:#fff;border:1px solid #fff4;border-radius:8px;padding:5px 9px;font-size:11px">Give up</button>
    <div style="position:absolute;left:10px;bottom:14px;display:flex;gap:10px;pointer-events:auto">
      ${padBtn("left", "◀")} ${padBtn("right", "▶")}
    </div>
    <div style="position:absolute;right:10px;bottom:14px;display:grid;grid-template-columns:auto auto;gap:8px;pointer-events:auto">
      ${padBtn("jump", "⤒")} ${padBtn("duck", "⤓")}
      ${padBtn("punch", "👊")} ${padBtn("kick", "🦵")}
      ${padBtn("block", "🛡")} <span></span>
    </div>
    <div id="sf-hint" style="position:absolute;left:0;right:0;bottom:96px;text-align:center;font-size:11px;opacity:.8;text-shadow:0 1px 3px #000">Duck dodges punches · jump dodges kicks · 🛡 blocks both</div>
    <div id="sf-end" style="position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;background:#000a;pointer-events:auto">
      <div id="sf-end-title" style="font-size:32px;font-weight:900;text-shadow:0 2px 8px #000"></div>
      <button id="sf-cont" style="margin-top:18px;background:#c9a550;color:#1a1405;border:none;border-radius:10px;padding:11px 24px;font-size:16px;font-weight:700">Continue</button>
    </div>`;
  host.appendChild(hud);

  function padBtn(name, label) {
    return `<button data-btn="${name}" style="width:54px;height:54px;border-radius:50%;background:#ffffff22;border:1px solid #fff6;color:#fff;font-size:20px;line-height:1">${label}</button>`;
  }
  const pressed = {};
  for (const b of hud.querySelectorAll("[data-btn]")) {
    const name = b.dataset.btn;
    const press = (e) => {
      e.preventDefault();
      if (over) return;
      if (name === "jump" || name === "punch" || name === "kick") player.input[name] = true; // edge
      else { player.input[name] = true; pressed[name] = true; }
      b.style.background = "#ffffff55";
    };
    const release = (e) => {
      e && e.preventDefault();
      if (name !== "jump" && name !== "punch" && name !== "kick") player.input[name] = false;
      b.style.background = "#ffffff22";
    };
    b.addEventListener("pointerdown", press);
    b.addEventListener("pointerup", release);
    b.addEventListener("pointerleave", release);
    b.addEventListener("pointercancel", release);
  }
  hud.querySelector("#sf-quit").addEventListener("click", () => endBout("quit"));

  // ── AI ──
  function aiThink(ai, foe, dt) {
    ai.input.left = ai.input.right = ai.input.duck = ai.input.block = false;
    if (ai.ko || ai.state === "hit" || over) return;
    const dist = Math.abs(ai.x - foe.x);
    const aggro = 0.5 + 0.35 * difficulty;
    ai.think -= dt;
    // spacing
    if (dist > KICK.range() * 0.95) ai.input[foe.x > ai.x ? "right" : "left"] = true;
    else if (dist < FH * 0.45) ai.input[foe.x > ai.x ? "left" : "right"] = true;
    // react to the player's attacks: block, or hop/duck to dodge
    if ((foe.state === "punch" || foe.state === "kick") && Math.abs(foe.x - ai.x) < KICK.range()) {
      const r = Math.random();
      if (r < 0.30 * difficulty) ai.input.block = true;
      else if (foe.state === "kick" && r < 0.45 * difficulty && ai.onGround) ai.input.jump = true;
      else if (foe.state === "punch" && r < 0.45 * difficulty) ai.input.duck = true;
    }
    // attack when close and off cooldown
    if (ai.onGround && ai.cooldown <= 0 && ai.think <= 0 && dist < KICK.range() * 1.04 && Math.random() < aggro) {
      ai.input[dist < PUNCH.range() ? "punch" : "kick"] = true;
      ai.think = (0.55 - 0.18 * difficulty) + Math.random() * 0.5;
    }
  }

  // ── Per-fighter update ──
  function update(f, foe, dt) {
    f.facing = foe.x >= f.x ? 1 : -1;
    f.cooldown = Math.max(0, f.cooldown - dt);
    f.hitFlash = Math.max(0, f.hitFlash - dt);
    f.anim += dt;

    if (f.ko) { applyGravity(f, dt); f.state = "ko"; return; }

    // hitstun
    if (f.state === "hit") {
      f.stateTimer -= dt; f.x += f.vx * dt; f.vx *= 0.86;
      applyGravity(f, dt); clampX(f);
      if (f.stateTimer <= 0) f.state = "idle";
      return;
    }

    const onGround = f.onGround;
    const ducking = f.input.duck && onGround && f.attackTimer <= 0;
    const blocking = f.input.block && onGround && f.attackTimer <= 0 && !ducking;

    // jump (edge)
    if (f.input.jump && onGround) { f.vy = -JUMP_V; f.onGround = false; }
    f.input.jump = false;

    // attacks (edge) — only from the ground, when free
    if (f.attackTimer <= 0 && f.cooldown <= 0 && onGround && !ducking) {
      if (f.input.punch) { startAttack(f, "punch"); }
      else if (f.input.kick) { startAttack(f, "kick"); }
    }
    f.input.punch = false; f.input.kick = false;

    // horizontal movement (not while attacking on the ground)
    let vx = 0;
    if (f.attackTimer <= 0 && !ducking) {
      if (f.input.left) vx -= MOVE();
      if (f.input.right) vx += MOVE();
      if (blocking) vx *= 0.35;
    }
    f.x += vx * dt;
    clampX(f);
    applyGravity(f, dt);

    // resolve attack window + state label
    if (f.attackTimer > 0) {
      f.attackTimer -= dt;
      tryHit(f, foe);
      if (f.attackTimer <= 0) { f.cooldown = (f.attackType === "kick" ? KICK.cd : PUNCH.cd); f.attackType = null; }
    }

    f.ducking = ducking; f.blocking = blocking;
    f.state = !onGround ? "jump" : f.attackTimer > 0 ? f.attackType : ducking ? "duck" : blocking ? "block" : vx ? "walk" : "idle";
  }

  function applyGravity(f, dt) {
    if (!f.onGround || f.vy < 0) {
      f.vy += GRAV * dt; f.y += f.vy * dt;
      if (f.y >= 0) { f.y = 0; f.vy = 0; f.onGround = true; }
    }
  }
  function clampX(f) { f.x = Math.max(FH * 0.5, Math.min(W - FH * 0.5, f.x)); }
  function startAttack(f, type) { f.attackType = type; f.attackTimer = (type === "kick" ? KICK.dur : PUNCH.dur); f.hitDone = false; }

  function tryHit(att, def) {
    if (att.hitDone || def.ko) return;
    const spec = att.attackType === "kick" ? KICK : PUNCH;
    // active in the middle of the swing
    if (att.attackTimer > spec.dur * 0.62 || att.attackTimer < spec.dur * 0.26) return;
    if (Math.sign(def.x - att.x) !== att.facing) return;          // must face the target
    if (Math.abs(att.x - def.x) > spec.range()) return;           // in range?
    att.hitDone = true;
    // dodges: duck under punches, jump over kicks
    if (att.attackType === "punch" && def.ducking && def.onGround) return;
    if (att.attackType === "kick" && !def.onGround && def.y < -FH * 0.25) return;
    let dmg = spec.dmg;
    if (def.blocking) { dmg *= 0.2; def.hitFlash = 0.1; }
    else { def.state = "hit"; def.stateTimer = 0.24; def.vx = att.facing * FH * 1.4; def.hitFlash = 0.18; }
    def.health = Math.max(0, def.health - dmg);
    if (def.health <= 0) { def.ko = true; def.vy = -420; def.onGround = false; }
  }

  // ── Rendering ──
  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock(), 0.05);
    if (!over) {
      aiThink(enemy, player, dt);
      update(player, enemy, dt);
      update(enemy, player, dt);
      timeLeft -= dt;
      const hpP = hud.querySelector("#sf-hp-p"), hpE = hud.querySelector("#sf-hp-e"), tEl = hud.querySelector("#sf-timer");
      if (hpP) hpP.style.width = player.health + "%";
      if (hpE) hpE.style.width = enemy.health + "%";
      if (tEl) tEl.textContent = Math.max(0, Math.ceil(timeLeft));
      if (player.ko || enemy.ko || timeLeft <= 0) {
        const win = enemy.ko || (!player.ko && player.health >= enemy.health);
        endBout(win ? "win" : "lose");
      }
    }
    render();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    // floor
    ctx.fillStyle = "#1a1426"; ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = "#2a2336"; ctx.fillRect(0, GROUND, W, 4);
    // crowd dots
    ctx.fillStyle = "#ffffff10";
    for (let i = 0; i < W; i += 26) ctx.fillRect(i + ((i / 26) % 2) * 6, GROUND - 26 - ((i * 7) % 10), 10, 10);
    // fighters (draw the far one first)
    const order = player.x <= enemy.x ? [enemy, player] : [player, enemy];
    for (const f of order) drawFighter(ctx, f);
  }

  // The single visual funnel. Uses the sprite sheet if SKIN provides frames for
  // the state; otherwise draws the built-in vector fighter. Reskin = fill SKIN.
  function drawFighter(ctx, f) {
    const baseX = f.x, baseY = GROUND - f.y;
    // shadow
    ctx.save();
    ctx.globalAlpha = 0.35; ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.ellipse(baseX, GROUND + 2, FH * 0.32, FH * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    const frames = SKIN.frames[f.state];
    if (sheetImg && frames && frames.length) {
      const fr = frames[Math.floor(f.anim * SKIN.fps) % frames.length];
      const h = FH, w = h * (fr.w / fr.h), dx = baseX - w / 2 * f.facing;
      ctx.save(); ctx.translate(baseX, baseY); ctx.scale(f.facing, 1); ctx.translate(-baseX, -baseY);
      ctx.drawImage(sheetImg, fr.x, fr.y, fr.w, fr.h, baseX - w / 2, baseY - h, w, h);
      ctx.restore();
      return;
    }
    drawVectorFighter(ctx, f, baseX, baseY);
  }

  // Built-in placeholder fighter — a blocky humanoid that punches/kicks/jumps/
  // ducks/blocks. Expressive enough to read clearly; swap for sprites via SKIN.
  function drawVectorFighter(ctx, f, cx, footY) {
    const s = FH / 100;                         // scale unit
    const dir = f.facing;
    const flash = f.hitFlash > 0;
    const body = flash ? "#ffffff" : f.color;
    const dark = flash ? "#ffd0d0" : shade(f.color, -28);
    const lw = 9 * s;
    ctx.save();
    ctx.translate(cx, footY);
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    if (f.state === "ko") { ctx.rotate(dir * Math.PI / 2.1); ctx.translate(0, -FH * 0.28); }

    let crouch = f.state === "duck" ? 0.45 : 0;  // 0..1 compresses the figure
    const hipY = -FH * (0.42 - crouch * 0.18);
    const headY = -FH * (0.86 - crouch * 0.34);
    const headR = FH * 0.13;

    // legs
    ctx.strokeStyle = dark; ctx.lineWidth = lw;
    const stance = f.state === "walk" ? Math.sin(f.anim * 12) * FH * 0.13 : FH * 0.10;
    if (f.state === "kick") {
      // back leg planted, front leg extended forward
      line(ctx, 0, hipY, -dir * FH * 0.10, 0);
      line(ctx, 0, hipY, dir * FH * 0.62, hipY - FH * 0.02);                 // extended kicking leg
      ctx.fillStyle = dark; dot(ctx, dir * FH * 0.62, hipY - FH * 0.02, FH * 0.08);
    } else if (f.state === "jump") {
      line(ctx, 0, hipY, -dir * FH * 0.16, FH * 0.04 - FH * 0.30);           // tucked
      line(ctx, 0, hipY, dir * FH * 0.20, FH * 0.02 - FH * 0.30);
    } else {
      line(ctx, 0, hipY, -dir * (FH * 0.04) - stance * 0.4, 0);
      line(ctx, 0, hipY, dir * (FH * 0.04) + stance * 0.4, 0);
    }

    // torso
    ctx.strokeStyle = body; ctx.lineWidth = lw * 1.25;
    line(ctx, 0, hipY, 0, headY + headR * 0.6);

    // arms
    ctx.strokeStyle = body; ctx.lineWidth = lw;
    const shoulderY = headY + headR * 0.9;
    if (f.state === "punch") {
      line(ctx, 0, shoulderY, dir * FH * 0.50, shoulderY + FH * 0.02);       // extended punch
      ctx.fillStyle = body; dot(ctx, dir * FH * 0.50, shoulderY + FH * 0.02, FH * 0.11); // fist
      line(ctx, 0, shoulderY, -dir * FH * 0.14, shoulderY + FH * 0.16);      // other arm
    } else if (f.state === "block") {
      line(ctx, 0, shoulderY, dir * FH * 0.16, shoulderY - FH * 0.10);
      line(ctx, 0, shoulderY, dir * FH * 0.18, shoulderY + FH * 0.06);
      ctx.fillStyle = shade(f.color, 18); roundRect(ctx, dir * FH * 0.10, shoulderY - FH * 0.16, dir * FH * 0.18, FH * 0.30); // guard
    } else if (f.state === "jump") {
      line(ctx, 0, shoulderY, dir * FH * 0.20, shoulderY - FH * 0.18);
      line(ctx, 0, shoulderY, -dir * FH * 0.18, shoulderY - FH * 0.18);
    } else {
      const swing = f.state === "walk" ? Math.sin(f.anim * 12) * FH * 0.10 : 0;
      line(ctx, 0, shoulderY, dir * FH * 0.14, shoulderY + FH * 0.18 - swing);
      line(ctx, 0, shoulderY, -dir * FH * 0.12, shoulderY + FH * 0.18 + swing);
    }

    // head
    ctx.fillStyle = flash ? "#ffffff" : shade(f.color, 30);
    dot(ctx, dir * FH * (f.state === "duck" ? 0.04 : 0.02), headY, headR);
    // headband tail (a little flair, faces backward)
    ctx.strokeStyle = shade(f.color, -10); ctx.lineWidth = lw * 0.5;
    line(ctx, -dir * headR * 0.8, headY - headR * 0.3, -dir * headR * 1.9, headY - headR * 0.1);

    ctx.restore();
  }

  // tiny canvas helpers
  function line(c, x1, y1, x2, y2) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
  function dot(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
  function roundRect(c, x, y, w, h) { c.beginPath(); c.rect(Math.min(x, x + w), y, Math.abs(w), h); c.fill(); }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp8((n >> 16) + amt), g = clamp8(((n >> 8) & 255) + amt), b = clamp8((n & 255) + amt);
    return `rgb(${r},${g},${b})`;
  }
  function clamp8(v) { return Math.max(0, Math.min(255, v | 0)); }

  // ── Bout end ──
  function endBout(result) {
    if (over) return;
    over = true;
    const title = hud.querySelector("#sf-end-title"), end = hud.querySelector("#sf-end"), hint = hud.querySelector("#sf-hint");
    if (hint) hint.style.display = "none";
    if (result === "win") { title.textContent = "YOU WIN! 🏆"; title.style.color = "#35e06a"; }
    else if (result === "lose") { title.textContent = "K.O. 💫"; title.style.color = "#ff5a5a"; }
    else { title.textContent = "Walked away"; title.style.color = "#ccc"; }
    end.style.display = "flex";
    hud.querySelector("#sf-cont").addEventListener("click", () => { if (!finished) { finished = true; api.finish(result); } });
  }

  // ── Loop ──
  let last = performance.now();
  function clock() { const now = performance.now(); const dt = (now - last) / 1000; last = now; return dt; }
  let raf = requestAnimationFrame(frame);

  // ── Cleanup ──
  return function cleanup() {
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", kd);
    window.removeEventListener("keyup", ku);
    window.removeEventListener("resize", resize);
    if (hud.parentNode) hud.remove();
    if (canvas.parentNode) canvas.remove();
  };
}
