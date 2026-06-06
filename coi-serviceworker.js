/*! coi-serviceworker + offline app-shell cache — for JMR's BitLife.

   Two jobs in one service worker:

   1) Cross-origin isolation. Enables crossOriginIsolated (COOP/COEP) on static
      hosts (e.g. GitHub Pages) that can't set headers, so SharedArrayBuffer /
      WASM threads work for onnxruntime-web (Transformers.js, web-txt2img).
      (Header-injection logic from coi-serviceworker v0.1.7, MIT — G. Zuidhof et al.)

   2) Download-once / play-offline. Precaches the app shell on install and
      runtime-caches everything fetched (network-first for our own files so
      updates land; cache-first for immutable CDN assets), then falls back to
      cache when offline. So after the first full load the game runs with NO
      network connection.

      IMPORTANT: the big model weights are deliberately NOT cached here. The
      libraries already persist them in their own Cache Storage buckets and
      serve them from there on reload (Transformers.js → "transformers-cache";
      web-txt2img → "web-txt2img-v1"). Caching them again would duplicate ~4 GB.
      We skip URLs ending in .onnx/.onnx_data/.bin/.safetensors/.data/etc.
*/
const APP_CACHE = "bitlife-app-v3";

// Files worth precaching so even a very short first visit is offline-capable for
// the deterministic game + pre-baked art. Missing entries are ignored (best effort).
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./bitlife_data.json",
  "./coi-serviceworker.js",
  "./assets/manifest.json",
  "./assets/og.png",
  "./assets/scene_birth.png", "./assets/scene_firstDay.png", "./assets/scene_graduation.png",
  "./assets/scene_newJob.png", "./assets/scene_promotion.png", "./assets/scene_wedding.png",
  "./assets/scene_baby.png", "./assets/scene_prison.png", "./assets/scene_lottery.png",
  "./assets/scene_death.png", "./assets/scene_homeowner.png", "./assets/scene_activity.png",
  // image worker (small; lets SD boot offline even if first visit didn't paint)
  "./vendor/web-txt2img/index.js", "./vendor/web-txt2img/registry.js", "./vendor/web-txt2img/types.js",
  "./vendor/web-txt2img/cache.js", "./vendor/web-txt2img/capabilities.js",
  "./vendor/web-txt2img/runtime/inline_client.js", "./vendor/web-txt2img/runtime/inline_host.js",
  "./vendor/web-txt2img/worker/protocol.js", "./vendor/web-txt2img/worker/client.js", "./vendor/web-txt2img/worker/host.js",
  "./vendor/web-txt2img/adapters/sd15.js", "./vendor/web-txt2img/adapters/sd-turbo.js", "./vendor/web-txt2img/adapters/janus-pro.js",
  // Three.js engine + mini-game modules (lazy-loaded, but precached so the
  // prison-break game still works fully offline once the app shell is cached).
  "./vendor/three/three.module.min.js",
  "./minigames/prison_escape.js",
  "./minigames/street_fight.js",
];

// Large model weights handled by the libraries' own caches — don't double-store.
const WEIGHT_RE = /\.(onnx|onnx_data|ort|bin|safetensors|data|gguf|pb|msgpack)(\?.*)?$/i;
// CDN assets are immutable+versioned → cache-first is safe and fast.
const IMMUTABLE_CDN_RE = /^https:\/\/cdn\.jsdelivr\.net\//i;

let coepCredentialless = false;

if (typeof window === "undefined") {
  // ── Service-worker side ──
  self.addEventListener("install", (event) => {
    self.skipWaiting();
    event.waitUntil((async () => {
      const cache = await caches.open(APP_CACHE);
      // add individually so one 404 doesn't abort the whole precache
      await Promise.all(PRECACHE_URLS.map((u) =>
        cache.add(new Request(u, { cache: "reload" })).catch(() => {})));
    })());
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
      // drop stale app-shell caches from older versions
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("bitlife-app-") && k !== APP_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })());
  });

  self.addEventListener("message", (ev) => {
    if (!ev.data) return;
    if (ev.data.type === "deregister") {
      self.registration.unregister()
        .then(() => self.clients.matchAll())
        .then((clients) => { clients.forEach((client) => client.navigate(client.url)); });
    } else if (ev.data.type === "coepCredentialless") {
      coepCredentialless = ev.data.value;
    }
  });

  // Re-stamp a response with the COOP/COEP/CORP headers crossOriginIsolated needs.
  // Returns the response unchanged if its body/headers can't be read (opaque).
  function withCoiHeaders(response) {
    if (!response || response.status === 0) return response; // opaque — pass through
    const h = new Headers(response.headers);
    h.set("Cross-Origin-Embedder-Policy", coepCredentialless ? "credentialless" : "require-corp");
    if (!coepCredentialless) h.set("Cross-Origin-Resource-Policy", "cross-origin");
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
  }

  function isCacheable(request, response) {
    if (request.method !== "GET") return false;
    if (!response || response.status !== 200) return false; // skip opaque(0), errors, 206 partials
    if ((response.headers.get("cache-control") || "").includes("no-store")) return false;
    if (WEIGHT_RE.test(request.url)) return false; // libraries own the big weights
    return true;
  }

  async function networkThenCache(event, request) {
    try {
      const res = await fetch(request);
      if (isCacheable(request, res)) {
        const copy = res.clone();
        event.waitUntil(caches.open(APP_CACHE).then((c) => c.put(request, copy)).catch(() => {}));
      }
      return withCoiHeaders(res);
    } catch (e) {
      const cached = await caches.match(request, { ignoreSearch: false });
      if (cached) return withCoiHeaders(cached);
      throw e;
    }
  }

  async function cacheThenNetwork(event, request) {
    const cached = await caches.match(request);
    if (cached) return withCoiHeaders(cached);
    return networkThenCache(event, request);
  }

  self.addEventListener("fetch", (event) => {
    const r = event.request;
    if (r.cache === "only-if-cached" && r.mode !== "same-origin") return;

    // Apply credentialless rewrite to no-cors cross-origin requests (COI requirement).
    const request = (coepCredentialless && r.mode === "no-cors")
      ? new Request(r, { credentials: "omit" })
      : r;

    // Non-GET (or weight files): just pass through with header stamping, no caching.
    if (r.method !== "GET" || WEIGHT_RE.test(r.url)) {
      event.respondWith(fetch(request).then(withCoiHeaders).catch((e) => { throw e; }));
      return;
    }

    // Immutable CDN → cache-first; our own app shell → network-first (so updates land).
    event.respondWith(
      IMMUTABLE_CDN_RE.test(r.url)
        ? cacheThenNetwork(event, request)
        : networkThenCache(event, request)
    );
  });
} else {
  // ── Page side: register the worker and (once) reload so it takes control ──
  (() => {
    const reloadedBySelf = window.sessionStorage.getItem("coiReloadedBySelf");
    window.sessionStorage.removeItem("coiReloadedBySelf");
    const coepDegrading = (reloadedBySelf == "coepdegrade");

    const coi = {
      shouldRegister: () => !reloadedBySelf,
      shouldDeregister: () => false,
      coepCredentialless: () => true,
      coepDegrade: () => true,
      doReload: () => window.location.reload(),
      quiet: false,
      ...window.coi,
    };

    const n = navigator;
    const controlling = n.serviceWorker && n.serviceWorker.controller;

    if (controlling && !window.crossOriginIsolated) {
      window.sessionStorage.setItem("coiCoepHasFailed", "true");
    }
    const coepHasFailed = window.sessionStorage.getItem("coiCoepHasFailed");

    if (controlling) {
      const reloadToDegrade = coi.coepDegrade() && !(coepDegrading || window.crossOriginIsolated);
      n.serviceWorker.controller.postMessage({
        type: "coepCredentialless",
        value: (reloadToDegrade || (coepHasFailed && coi.coepDegrade()))
          ? false
          : coi.coepCredentialless(),
      });
      if (reloadToDegrade) {
        !coi.quiet && console.log("Reloading page to degrade COEP.");
        window.sessionStorage.setItem("coiReloadedBySelf", "coepdegrade");
        coi.doReload("coepdegrade");
      }
      if (coi.shouldDeregister()) {
        n.serviceWorker.controller.postMessage({ type: "deregister" });
      }
    }

    if (window.crossOriginIsolated !== false || !coi.shouldRegister()) return;

    if (!window.isSecureContext) {
      !coi.quiet && console.log("COOP/COEP Service Worker not registered, a secure context is required.");
      return;
    }

    n.serviceWorker.register(window.document.currentScript.src).then(
      (registration) => {
        !coi.quiet && console.log("COOP/COEP + offline Service Worker registered", registration.scope);
        registration.addEventListener("updatefound", () => {
          !coi.quiet && console.log("Reloading page to make use of updated Service Worker.");
          window.sessionStorage.setItem("coiReloadedBySelf", "updatefound");
          coi.doReload();
        });
        if (registration.active && !n.serviceWorker.controller) {
          !coi.quiet && console.log("Reloading page to make use of Service Worker.");
          window.sessionStorage.setItem("coiReloadedBySelf", "notcontrolling");
          coi.doReload();
        }
      },
      (err) => { !coi.quiet && console.error("COOP/COEP Service Worker failed to register:", err); }
    );
  })();
}
