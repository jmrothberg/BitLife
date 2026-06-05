import { purgeModelCache } from '../cache.js';
export class JanusProAdapter {
    constructor() {
        this.id = 'janus-pro-1b';
        this.loaded = false;
        this.backendUsed = null;
        // Cached handles to reuse between calls
        this.hf = null;
        this.processor = null;
        this.model = null;
    }
    checkSupport(c) {
        return c.webgpu ? ['webgpu'] : [];
    }
    async load(options) {
        const preferred = options.backendPreference;
        if (!preferred.includes('webgpu')) {
            return { ok: false, reason: 'backend_unavailable', message: 'Janus requires WebGPU' };
        }
        // Dynamic import of Transformers.js (optional peer). Error clearly if missing.
        let hf = null;
        // LLM: Document import maps often do NOT apply inside module workers — bare @huggingface/transformers fails on localhost. Absolute +esm URL works (CORS).
        const HF_TRANSFORMERS_ESM = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.1/+esm';
        try {
            hf = await import(/* webpackIgnore: true */ HF_TRANSFORMERS_ESM).catch(() => null);
        }
        catch { }
        // Bare specifier (Vite bundle or import map on main thread / workers that honor it)
        if (!hf) {
            try {
                hf = await import('@huggingface/transformers').catch(() => null);
            }
            catch { }
        }
        // Try to resolve via bundler if available (Vite: import.meta.resolve)
        if (!hf) {
            try {
                const anyMeta = import.meta;
                const resolved = anyMeta && typeof anyMeta.resolve === 'function'
                    ? anyMeta.resolve('@huggingface/transformers')
                    : null;
                if (resolved) {
                    hf = await import(/* @vite-ignore */ resolved).catch(() => null);
                }
            }
            catch { }
        }
        // Fallback to a global (if the app loaded Transformers.js via a <script> tag)
        if (!hf) {
            const g = globalThis;
            hf = g.transformers || g.HFTransformers || g.HuggingFaceTransformers || null;
        }
        if (!hf) {
            return { ok: false, reason: 'internal_error', message: 'Missing @huggingface/transformers. Install it (npm i @huggingface/transformers) or include it via a <script> to expose global "transformers".' };
        }
        // WebGPU adapter + shader-f16 capability check (for dtype selection)
        let fp16_supported = false;
        try {
            const adapter = await navigator.gpu?.requestAdapter?.();
            fp16_supported = !!adapter?.features?.has?.('shader-f16');
        }
        catch { }
        const model_id = 'onnx-community/Janus-Pro-1B-ONNX';
        // Approximate expected total injected from registry (single source of truth).
        const TOTAL_BYTES_APPROX = typeof options.approxTotalBytes === 'number' ? options.approxTotalBytes : undefined;
        options.onProgress?.({
            phase: 'loading',
            message: 'Loading Janus-Pro-1B (starting downloads)…',
            bytesDownloaded: 0,
            totalBytesExpected: TOTAL_BYTES_APPROX,
            pct: typeof TOTAL_BYTES_APPROX === 'number' ? 0 : undefined,
            accuracy: 'approximate',
        });
        try {
            // Aggregate bytes across multiple underlying downloads from Transformers.js
            const seen = new Map();
            let lastBytes = 0;
            const progress_callback = (x) => {
                try {
                    const name = (x?.file || x?.name || x?.url || 'asset');
                    const loaded = typeof x?.loaded === 'number' ? x.loaded : (typeof x?.progress === 'number' && typeof x?.total === 'number' ? Math.floor(x.progress * x.total) : undefined);
                    if (typeof loaded === 'number' && isFinite(loaded) && loaded >= 0) {
                        const prev = seen.get(name) ?? 0;
                        // Monotonic per-asset
                        const next = Math.max(prev, loaded);
                        seen.set(name, next);
                    }
                    const sum = Array.from(seen.values()).reduce((a, b) => a + b, 0);
                    if (sum > lastBytes)
                        lastBytes = sum;
                    const pct = typeof TOTAL_BYTES_APPROX === 'number'
                        ? Math.max(0, Math.min(100, Math.round((lastBytes / TOTAL_BYTES_APPROX) * 100)))
                        : undefined;
                    options.onProgress?.({
                        phase: 'loading',
                        message: x?.status ?? 'loading…',
                        bytesDownloaded: lastBytes,
                        totalBytesExpected: TOTAL_BYTES_APPROX,
                        pct,
                        asset: typeof name === 'string' ? name : undefined,
                        accuracy: typeof x?.loaded === 'number' ? 'exact' : 'approximate',
                    });
                }
                catch {
                    options.onProgress?.({ phase: 'loading', message: x?.status ?? 'loading…' });
                }
            };
            const processorP = hf.AutoProcessor.from_pretrained(model_id, { progress_callback });
            const dtype = fp16_supported
                ? { prepare_inputs_embeds: 'q4', language_model: 'q4f16', lm_head: 'fp16', gen_head: 'fp16', gen_img_embeds: 'fp16', image_decode: 'fp32' }
                : { prepare_inputs_embeds: 'fp32', language_model: 'q4', lm_head: 'fp32', gen_head: 'fp32', gen_img_embeds: 'fp32', image_decode: 'fp32' };
            const device = {
                // TODO: use 'webgpu' when upstream bug fixed; match example using wasm for this small stage
                prepare_inputs_embeds: 'wasm',
                language_model: 'webgpu',
                lm_head: 'webgpu',
                gen_head: 'webgpu',
                gen_img_embeds: 'webgpu',
                image_decode: 'webgpu',
            };
            options.onProgress?.({ phase: 'loading', message: 'Loading Janus-Pro-1B model…' });
            const modelP = hf.MultiModalityCausalLM.from_pretrained(model_id, { dtype, device, progress_callback });
            const [processor, model] = await Promise.all([processorP, modelP]);
            // Ensure a final 100% event for UIs even if callbacks were cached/quick
            if (typeof TOTAL_BYTES_APPROX === 'number') {
                lastBytes = Math.max(lastBytes, TOTAL_BYTES_APPROX);
            }
            options.onProgress?.({
                phase: 'loading',
                message: 'Janus-Pro-1B ready',
                bytesDownloaded: typeof TOTAL_BYTES_APPROX === 'number' ? TOTAL_BYTES_APPROX : lastBytes,
                totalBytesExpected: TOTAL_BYTES_APPROX,
                pct: 100,
                accuracy: 'approximate',
            });
            this.hf = hf;
            this.processor = processor;
            this.model = model;
            this.backendUsed = 'webgpu';
            this.loaded = true;
            return { ok: true, backendUsed: 'webgpu', bytesDownloaded: lastBytes || undefined };
        }
        catch (e) {
            return { ok: false, reason: 'internal_error', message: e instanceof Error ? e.message : String(e) };
        }
    }
    isLoaded() {
        return this.loaded;
    }
    async generate(params) {
        if (!this.loaded || !this.processor || !this.model) {
            return { ok: false, reason: 'model_not_loaded', message: 'Call loadModel() first' };
        }
        const { prompt, signal, onProgress } = params;
        if (!prompt || !prompt.trim())
            return { ok: false, reason: 'unsupported_option', message: 'Prompt is required' };
        if (signal?.aborted)
            return { ok: false, reason: 'cancelled' };
        const start = performance.now();
        try {
            // Build conversation with text_to_image template
            const conversation = [
                { role: '<|User|>', content: prompt.trim() },
            ];
            const inputs = await this.processor(conversation, { chat_template: 'text_to_image' });
            // Progress streamer — mirrors example semantics
            const num_image_tokens = this.processor.num_image_tokens;
            const thatOnProgress = onProgress;
            const StreamerBase = this.hf.BaseStreamer;
            class ProgressStreamer extends StreamerBase {
                constructor(total, on_progress) { super(); this.total = total; this.on_progress = on_progress; this.count = null; this.start_time = null; }
                put(_value) {
                    // Best-effort mid-run abort: throw sentinel to unwind generate_images
                    if (signal?.aborted) {
                        throw new Error('JANUS_STOP');
                    }
                    if (this.count === null) {
                        this.count = 0;
                        this.start_time = performance.now();
                        return;
                    }
                    const progress = (++this.count) / this.total;
                    this.on_progress({ count: this.count, total: this.total, progress, time: performance.now() - (this.start_time ?? performance.now()) });
                }
                end() { }
            }
            const streamer = new ProgressStreamer(num_image_tokens, (out) => {
                thatOnProgress?.({ phase: 'image_tokens', ...out });
            });
            // Note: No supported interruption API for image generation; we check abort before starting.
            const outputs = await this.model.generate_images({
                ...inputs,
                min_new_tokens: num_image_tokens,
                max_new_tokens: num_image_tokens,
                do_sample: true,
                streamer,
            });
            const blob = await outputs[0].toBlob();
            const timeMs = performance.now() - start;
            onProgress?.({ phase: 'complete', pct: 100, timeMs });
            return { ok: true, blob, timeMs };
        }
        catch (e) {
            if (e instanceof Error && e.message === 'JANUS_STOP') {
                onProgress?.({ phase: 'complete', aborted: true, pct: 0 });
                return { ok: false, reason: 'cancelled' };
            }
            return { ok: false, reason: 'internal_error', message: e instanceof Error ? e.message : String(e) };
        }
    }
    async unload() {
        // Drop references to allow GC of GPU buffers
        this.loaded = false;
        this.backendUsed = null;
        this.model = null;
        this.processor = null;
        this.hf = null;
    }
    async purgeCache() {
        await purgeModelCache(this.id);
    }
}
async function renderInfoImage(text) {
    const width = 512;
    const height = 288;
    const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
    const canvas = hasOffscreen ? new OffscreenCanvas(width, height) : document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error('Canvas 2D context unavailable');
    ctx.fillStyle = '#202a44';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#cfe3ff';
    ctx.font = '18px sans-serif';
    const lines = text.split(/\n/);
    lines.forEach((line, i) => ctx.fillText(line, 12, 28 + i * 24));
    const hasHTMLCanvas = typeof globalThis.HTMLCanvasElement !== 'undefined';
    if (hasHTMLCanvas && canvas instanceof globalThis.HTMLCanvasElement) {
        return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
    }
    return await canvas.convertToBlob({ type: 'image/png' });
}
