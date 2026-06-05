const CACHE_NAME = 'web-txt2img-v1';
// Simple in-memory URL tracker per model for purge; re-created on reload.
const urlTracker = new Map();
export function noteModelUrl(modelId, url) {
    if (!urlTracker.has(modelId))
        urlTracker.set(modelId, new Set());
    urlTracker.get(modelId).add(url);
}
export async function fetchWithCache(input, modelId) {
    if (typeof caches === 'undefined')
        return fetch(input);
    const cache = await caches.open(CACHE_NAME);
    const req = new Request(input);
    const cached = await cache.match(req);
    if (cached)
        return cached.clone();
    const res = await fetch(req);
    if (res.ok) {
        await cache.put(req, res.clone());
        if (modelId)
            noteModelUrl(modelId, req.url);
    }
    return res;
}
export async function fetchArrayBufferWithCacheProgress(url, modelId, onProgress, expectedTotalBytes) {
    const req = new Request(url);
    if (typeof caches !== 'undefined') {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        if (cached) {
            const buf = await cached.arrayBuffer();
            onProgress?.(buf.byteLength, buf.byteLength);
            if (modelId)
                noteModelUrl(modelId, req.url);
            return buf;
        }
        const res = await fetch(req);
        if (!res.ok || !res.body) {
            // Simulate coarse progress when streaming is unavailable
            const total = Number(res.headers.get('content-length') ?? expectedTotalBytes ?? 0) || undefined;
            let timer;
            let fakeLoaded = 0;
            if (total) {
                const start = performance.now();
                const etaMs = Math.max(5000, Math.min(20000, total / (256 * 1024) * 1000)); // 256KB/s to 20s cap
                timer = setInterval(() => {
                    const elapsed = performance.now() - start;
                    const est = Math.min(total * 0.95, (elapsed / etaMs) * total);
                    if (est > fakeLoaded) {
                        fakeLoaded = est;
                        onProgress?.(fakeLoaded, total);
                    }
                }, 200);
            }
            const buf = await res.arrayBuffer();
            if (timer)
                clearInterval(timer);
            onProgress?.(total ?? buf.byteLength, total ?? buf.byteLength);
            return buf;
        }
        const total = Number(res.headers.get('content-length') ?? '0') || undefined;
        const reader = res.body.getReader();
        const chunks = [];
        let received = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (value) {
                chunks.push(value);
                received += value.byteLength;
                onProgress?.(received, total);
            }
        }
        const merged = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
        }
        const respToCache = new Response(merged, { headers: res.headers });
        try {
            await cache.put(req, respToCache);
        }
        catch { }
        if (modelId)
            noteModelUrl(modelId, req.url);
        return merged.buffer;
    }
    else {
        const res = await fetch(req);
        const total = Number(res.headers.get('content-length') ?? expectedTotalBytes ?? 0) || undefined;
        // Simulate coarse progress without Cache Storage
        let timer;
        if (total) {
            const start = performance.now();
            const etaMs = Math.max(5000, Math.min(20000, total / (256 * 1024) * 1000));
            timer = setInterval(() => {
                const elapsed = performance.now() - start;
                const est = Math.min(total * 0.95, (elapsed / etaMs) * total);
                onProgress?.(est, total);
            }, 200);
        }
        const buf = await res.arrayBuffer();
        if (timer)
            clearInterval(timer);
        onProgress?.(total ?? buf.byteLength, total ?? buf.byteLength);
        return buf;
    }
}
export async function purgeModelCache(modelId) {
    if (typeof caches === 'undefined')
        return;
    const cache = await caches.open(CACHE_NAME);
    const urls = Array.from(urlTracker.get(modelId) ?? []);
    await Promise.all(urls.map((u) => cache.delete(u)));
    urlTracker.delete(modelId);
}
export async function purgeAllCaches() {
    if (typeof caches === 'undefined')
        return;
    await caches.delete(CACHE_NAME);
    urlTracker.clear();
}
