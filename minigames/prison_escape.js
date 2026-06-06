// ─────────────────────────────────────────────────────────────────────────
// Prison Break — a Three.js mini-game for JMR's BitLife
// ─────────────────────────────────────────────────────────────────────────
// Sneak across a floodlit prison yard to the gate without getting caught in a
// sweeping searchlight. Skill-based: a good player who times the gaps gets out.
//
// This file is also the TEMPLATE for adding richer (e.g. 3D) mini-games. The
// contract the host (index.html) expects is tiny:
//
//     import * as THREE from "three";          // vendored locally → runs offline
//     export function start(host, api) { ... return cleanup; }
//
//   • host  — an empty full-screen <div>; render your canvas + HUD into it.
//   • api.finish(result) — call exactly once with "win" | "lose" | "quit".
//   • api.difficulty — optional number (1 = normal).
//   • return a cleanup() — stop your loop, dispose GPU resources, remove
//     listeners. The host calls it right after finish().
//
// Keep mini-games self-contained: no game-state access, no network. The host
// decides what winning/losing means (here: escape vs. extra prison years).
// ─────────────────────────────────────────────────────────────────────────
import * as THREE from "three";

export function start(host, api) {
  const difficulty = api.difficulty || 1;

  // ── Yard layout (x = left/right, z = depth; player starts near, gate is far) ──
  const X = 10.5;            // half-width of the playable yard
  const START_Z = 15;        // where the prisoner begins (cell block)
  const GATE_Z = -15;        // the far wall / gate
  const GATE_HALF = 3.3;     // how wide the gate opening is
  const PLAYER_R = 0.6;
  const SPEED = 8;           // units / second
  const TIME_LIMIT = 42;     // seconds

  // ── Renderer ──
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x05060c, 1);
  const canvas = renderer.domElement;
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none";
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05060c, 26, 52);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  camera.position.set(0, 21, 25);
  camera.lookAt(0, 0, -1);

  // ── Lights (ambience only; searchlights are geometric, see below) ──
  scene.add(new THREE.AmbientLight(0x2a3358, 0.9));
  const moon = new THREE.DirectionalLight(0x9fb6ff, 0.6);
  moon.position.set(-8, 16, 6);
  scene.add(moon);

  // ── Ground ──
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 48),
    new THREE.MeshStandardMaterial({ color: 0x1c2a1e, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // ── Perimeter walls ──
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3a46, roughness: 0.9 });
  const addWall = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z); scene.add(m); return m;
  };
  addWall(2 * X + 4, 3, 1, 0, 1.5, START_Z + 1.5);            // near wall (cell block)
  addWall(1, 3, 2 * (START_Z - GATE_Z) + 4, -X - 1.5, 1.5, 0); // left wall
  addWall(1, 3, 2 * (START_Z - GATE_Z) + 4, X + 1.5, 1.5, 0);  // right wall
  // far wall with a gate gap in the middle
  const farLen = (X - GATE_HALF);
  addWall(farLen, 4, 1, -(GATE_HALF + farLen / 2), 2, GATE_Z - 1.5);
  addWall(farLen, 4, 1, (GATE_HALF + farLen / 2), 2, GATE_Z - 1.5);

  // ── The gate (glowing goal) ──
  const gate = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * GATE_HALF, 4),
    new THREE.MeshBasicMaterial({ color: 0x35e06a, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  gate.position.set(0, 2, GATE_Z - 1.4);
  scene.add(gate);
  const gateGlow = new THREE.Mesh(
    new THREE.CircleGeometry(GATE_HALF, 24),
    new THREE.MeshBasicMaterial({ color: 0x35e06a, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  gateGlow.rotation.x = -Math.PI / 2; gateGlow.position.set(0, 0.05, GATE_Z + 0.5);
  scene.add(gateGlow);

  // ── Guard towers (decor) ──
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x2a2a34, roughness: 0.9 });
  for (const sx of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 7, 8), towerMat);
    t.position.set(sx * (X + 1.2), 3.5, GATE_Z - 1); scene.add(t);
  }

  // ── Searchlights: a moving ground pool + a translucent beam from the sky. ──
  // Collision is purely geometric (distance to the pool centre), so it's crisp
  // and deterministic-feeling; the beam mesh is just for looks.
  function makeLight(z, x, dir, speed, radius) {
    const grp = new THREE.Group();
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.06; grp.add(pool);
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(radius, 14, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.position.y = 7; grp.add(beam);
    grp.position.set(x, 0, z);
    scene.add(grp);
    return { grp, z, x, dir, speed: speed * (0.85 + 0.3 * difficulty), radius };
  }
  const lights = [
    makeLight(9.5, -6, 1, 6.0, 3.0),
    makeLight(4.0, 5, -1, 7.2, 3.0),
    makeLight(-1.5, -4, 1, 6.6, 3.2),
    makeLight(-7.5, 6, -1, 8.0, 3.0)
  ];

  // ── Player ──
  const player = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER_R, 1.0, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xff8c1a, emissive: 0xc24a00, emissiveIntensity: 0.6, roughness: 0.6 })
  );
  player.position.set(0, 1.1, START_Z);
  scene.add(player);

  // ── HUD (plain DOM over the canvas) ──
  const hud = document.createElement("div");
  hud.style.cssText = "position:absolute;inset:0;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#fff;user-select:none";
  hud.innerHTML = `
    <div style="position:absolute;top:10px;left:0;right:0;text-align:center;text-shadow:0 1px 4px #000">
      <div style="font-size:20px;font-weight:800" id="pe-timer">${TIME_LIMIT.toFixed(1)}</div>
      <div style="font-size:12px;opacity:.85">Reach the green gate — don't get caught in the light</div>
    </div>
    <div style="position:absolute;bottom:12px;left:0;right:0;text-align:center;font-size:11px;opacity:.7;text-shadow:0 1px 3px #000">
      Drag to move · or WASD / arrow keys
    </div>
    <button id="pe-quit" style="position:absolute;top:10px;right:10px;pointer-events:auto;background:rgba(0,0,0,.45);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:6px 10px;font-size:12px">Give up</button>
    <div id="pe-stick" style="position:absolute;width:84px;height:84px;border-radius:50%;border:2px solid rgba(255,255,255,.35);display:none;pointer-events:none">
      <div id="pe-nub" style="position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(255,255,255,.55)"></div>
    </div>
    <div id="pe-end" style="position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.6);pointer-events:auto">
      <div id="pe-end-title" style="font-size:30px;font-weight:900;text-shadow:0 2px 8px #000"></div>
      <div id="pe-end-sub" style="font-size:14px;opacity:.9;margin-top:6px"></div>
      <button id="pe-cont" style="margin-top:18px;background:#c9a550;color:#1a1405;border:none;border-radius:10px;padding:11px 24px;font-size:16px;font-weight:700">Continue</button>
    </div>`;
  host.appendChild(hud);

  // ── Input: keyboard + drag joystick, both feed a single move vector ──
  const dir = new THREE.Vector2(0, 0);
  const keys = {};
  const onKey = (e, down) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(k)) {
      keys[k] = down; e.preventDefault();
    }
  };
  const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);

  const stick = hud.querySelector("#pe-stick"), nub = hud.querySelector("#pe-nub");
  let dragId = null, dragOX = 0, dragOY = 0;
  const onDown = (e) => {
    if (ended) return;
    if (e.target.id === "pe-quit" || e.target.id === "pe-cont") return;
    dragId = e.pointerId; dragOX = e.clientX; dragOY = e.clientY;
    stick.style.display = "block";
    stick.style.left = (e.clientX - 42) + "px"; stick.style.top = (e.clientY - 42) + "px";
    nub.style.left = "50%"; nub.style.top = "50%";
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    if (dragId !== e.pointerId) return;
    let dx = e.clientX - dragOX, dy = e.clientY - dragOY;
    const len = Math.hypot(dx, dy) || 1;
    const cl = Math.min(len, 38);
    nub.style.left = (50 + (dx / len) * cl / 0.84) + "%"; // visual nub
    nub.style.top = (50 + (dy / len) * cl / 0.84) + "%";
    const mag = Math.min(len / 38, 1);
    dir.set((dx / len) * mag, (dy / len) * mag);  // screen x→world x, screen y→world z
  };
  const onUp = (e) => {
    if (dragId !== e.pointerId) return;
    dragId = null; dir.set(0, 0); stick.style.display = "none";
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);

  hud.querySelector("#pe-quit").addEventListener("click", () => endGame("quit"));

  // ── Resize ──
  const resize = () => {
    const w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  // ── Game loop ──
  const clock = new THREE.Clock();
  let timeLeft = TIME_LIMIT, ended = false, raf = 0, finished = false;
  const timerEl = hud.querySelector("#pe-timer");

  function keyboardDir(out) {
    let kx = 0, kz = 0;
    if (keys["arrowleft"] || keys["a"]) kx -= 1;
    if (keys["arrowright"] || keys["d"]) kx += 1;
    if (keys["arrowup"] || keys["w"]) kz -= 1;     // up = toward the gate (-z)
    if (keys["arrowdown"] || keys["s"]) kz += 1;
    if (kx || kz) { const l = Math.hypot(kx, kz); out.set(kx / l, kz / l); return true; }
    return false;
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!ended) {
      // move (keyboard takes priority when pressed, else joystick)
      const kd2 = keyboardDir(_tmp);
      const mv = kd2 ? _tmp : dir;
      player.position.x = clamp(player.position.x + mv.x * SPEED * dt, -X + PLAYER_R, X - PLAYER_R);
      player.position.z = clamp(player.position.z + mv.y * SPEED * dt, GATE_Z - 0.5, START_Z);
      const moving = (mv.x * mv.x + mv.y * mv.y) > 0.01;          // little running bob
      player.position.y = 1.1 + (moving ? Math.abs(Math.sin(clock.elapsedTime * 12)) * 0.18 : 0);

      // sweep searchlights + collision
      let caught = false;
      for (const L of lights) {
        L.x += L.dir * L.speed * dt;
        if (L.x > X - 1) { L.x = X - 1; L.dir = -1; }
        if (L.x < -X + 1) { L.x = -X + 1; L.dir = 1; }
        L.grp.position.x = L.x;
        const dx = player.position.x - L.x, dz = player.position.z - L.z;
        if (dx * dx + dz * dz < (L.radius * 0.8 + PLAYER_R * 0.5) ** 2) caught = true;
      }

      // timer
      timeLeft -= dt;
      if (timerEl) timerEl.textContent = Math.max(0, timeLeft).toFixed(1);

      // win / lose checks
      if (player.position.z <= GATE_Z + 0.4 && Math.abs(player.position.x) <= GATE_HALF) endGame("win");
      else if (caught) endGame("lose");
      else if (timeLeft <= 0) endGame("lose");
    }
    renderer.render(scene, camera);
  }
  const _tmp = new THREE.Vector2();
  raf = requestAnimationFrame(frame);

  function endGame(result) {
    if (ended) return;
    ended = true;
    const title = hud.querySelector("#pe-end-title"), sub = hud.querySelector("#pe-end-sub"), end = hud.querySelector("#pe-end");
    if (result === "win") {
      title.textContent = "FREE! 🪜"; title.style.color = "#35e06a";
      sub.textContent = "You went over the wall and vanished into the night.";
      player.material.emissive.setHex(0x35e06a);
    } else if (result === "lose") {
      title.textContent = "CAUGHT! 🚨"; title.style.color = "#ff5a5a";
      sub.textContent = "A searchlight pinned you at the wall. Back to your cell.";
      player.material.emissive.setHex(0xff2a2a);
    } else {
      title.textContent = "Gave up"; title.style.color = "#ccc";
      sub.textContent = "You slipped back to your bunk.";
    }
    end.style.display = "flex";
    const cont = hud.querySelector("#pe-cont");
    cont.textContent = result === "win" ? "Continue" : (result === "lose" ? "Continue" : "Back");
    cont.addEventListener("click", () => { if (!finished) { finished = true; api.finish(result); } });
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ── Cleanup (called by the host right after finish) ──
  return function cleanup() {
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", kd);
    window.removeEventListener("keyup", ku);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("resize", resize);
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); } });
    renderer.dispose();
    if (hud.parentNode) hud.remove();
    if (canvas.parentNode) canvas.remove();
  };
}
