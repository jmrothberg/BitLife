import { fetchArrayBufferWithCacheProgress, purgeModelCache } from '../cache.js';

/**
 * SD 1.5 multi-step adapter for ORT Web + WebGPU.
 * ONNX weights from microsoft/stable-diffusion-v1.5-webnn (~2.0 GB).
 * EulerA scheduler (25 steps default), classifier-free guidance (scale 7.5).
 * Based on sd-turbo.js structure + scheduler math from scribbler-webnn/sd.js.
 */

// Precomputed EulerA sigma / timestep schedules for SD 1.5
// beta schedule: linspace(sqrt(0.00085), sqrt(0.012), 1000)^2
const SCHEDULES = {
    20: {
        sigmas: [
            14.614641, 10.746721, 8.0814910, 6.2049076, 4.8556332, 3.8653735, 3.1237518, 2.5571647, 2.1156539, 1.7648208,
            1.4805796, 1.2458125, 1.0481420, 0.87842847, 0.72971897, 0.59643457, 0.47358605, 0.35554688, 0.23217032, 0.029167158,
            0.0,
        ],
        timesteps: [
            999.0, 946.421, 893.842, 841.263, 788.684, 736.105, 683.526, 630.947, 578.368, 525.789,
            473.211, 420.632, 368.053, 315.474, 262.895, 210.316, 157.737, 105.158, 52.579, 0.0,
        ],
    },
    25: {
        sigmas: [
            14.614647, 11.435942, 9.076809, 7.3019943, 5.9489183, 4.903778, 4.0860896, 3.4381795, 2.9183085, 2.495972,
            2.1485956, 1.8593576, 1.6155834, 1.407623, 1.2280698, 1.0711612, 0.9323583, 0.80802417, 0.695151, 0.5911423,
            0.49355352, 0.3997028, 0.30577788, 0.20348993, 0.02916753, 0.0,
        ],
        timesteps: [
            999.0, 957.375, 915.75, 874.125, 832.5, 790.875, 749.25, 707.625, 666.0, 624.375, 582.75, 541.125, 499.5, 457.875,
            416.25, 374.625, 333.0, 291.375, 249.75, 208.125, 166.5, 124.875, 83.25, 41.625, 0.0,
        ],
    },
};

const VAE_SCALING_FACTOR = 0.18215;
const DEFAULT_GUIDANCE_SCALE = 7.5;
const DEFAULT_STEPS = 25;

export class SD15Adapter {
    constructor() {
        this.id = 'sd-1.5';
        this.loaded = false;
        this.backendUsed = null;
        this.ort = null;
        this.sessions = {};
        this.tokenizerFn = null;
        this.tokenizerProvider = null;
        this.modelBase = 'https://huggingface.co/microsoft/stable-diffusion-v1.5-webnn/resolve/main';
    }

    checkSupport(c) {
        const backends = [];
        if (c.webgpu) backends.push('webgpu');
        backends.push('wasm');
        return backends;
    }

    async load(options) {
        const preferred = options.backendPreference;
        const supported = ['webgpu', 'wasm'];
        let chosen = preferred.find((b) => supported.includes(b));
        if (!chosen)
            return { ok: false, reason: 'backend_unavailable', message: 'No viable backend for SD 1.5' };

        if (options.modelBaseUrl) this.modelBase = options.modelBaseUrl;
        if (options.tokenizerProvider) this.tokenizerProvider = options.tokenizerProvider;

        // Resolve ORT runtime (same pattern as sd-turbo — absolute URLs for worker compat)
        try {
            let ort = options.ort ?? null;
            if (!ort) {
                let ortMod = null;
                const ORT_VER = '1.22.0';
                const ORT_WEBGPU_ESM = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/ort.webgpu.bundle.min.mjs`;
                const ORT_MAIN_ESM = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/ort.bundle.min.mjs`;
                if (chosen === 'webgpu') {
                    ortMod = await import(/* webpackIgnore: true */ ORT_WEBGPU_ESM).catch(() => null);
                    if (!ortMod) ortMod = await import('onnxruntime-web/webgpu').catch(() => null);
                } else {
                    ortMod = await import(/* webpackIgnore: true */ ORT_MAIN_ESM).catch(() => null);
                    if (!ortMod) ortMod = await import('onnxruntime-web').catch(() => null);
                }
                ort = ortMod && (ortMod.default ?? ortMod);
            }
            if (!ort) {
                const gOrt = globalThis.ort;
                if (gOrt) ort = gOrt;
            }
            if (!ort) {
                return { ok: false, reason: 'internal_error', message: 'onnxruntime-web not available.' };
            }
            this.ort = ort;
        } catch (e) {
            return { ok: false, reason: 'internal_error', message: `Failed to load onnxruntime-web: ${e instanceof Error ? e.message : String(e)}` };
        }

        try {
            options.onProgress?.({ phase: 'loading', message: 'Preparing SD 1.5 model...' });
            this.backendUsed = chosen;
            const ort = this.ort;

            const baseOpt = {
                executionProviders: [chosen],
                enableMemPattern: false,
                enableCpuMemArena: false,
                extra: {
                    session: {
                        disable_prepacking: '1',
                        use_device_allocator_for_initializers: '1',
                        use_ort_model_bytes_directly: '1',
                        use_ort_model_bytes_for_initializers: '1',
                    },
                },
            };

            try {
                if (options.wasmPaths) ort.env.wasm.wasmPaths = options.wasmPaths;
                if (typeof options.wasmNumThreads === 'number') ort.env.wasm.numThreads = options.wasmNumThreads;
                if (typeof options.wasmSimd === 'boolean') ort.env.wasm.simd = options.wasmSimd;
            } catch { }

            // MS WebNN ONNX files — batch=2 for CFG (uncond + cond)
            const models = {
                text_encoder: {
                    url: 'text-encoder.onnx',
                    sizeMB: 235,
                    opt: { freeDimensionOverrides: { batch: 2, sequence: 77 } },
                },
                unet: {
                    url: 'sd-unet-v1.5-model-b2c4h64w64s77-float16-compute-and-inputs-layernorm.onnx',
                    sizeMB: 1640,
                    opt: {
                        freeDimensionOverrides: {
                            batch: 2, channels: 4, height: 64, width: 64, sequence: 77,
                            unet_sample_batch: 2, unet_sample_channels: 4,
                            unet_sample_height: 64, unet_sample_width: 64,
                            unet_time_batch: 2, unet_hidden_batch: 2, unet_hidden_sequence: 77,
                        },
                    },
                },
                vae_decoder: {
                    url: 'Stable-Diffusion-v1.5-vae-decoder-float16-fp32-instancenorm.onnx',
                    sizeMB: 95,
                    opt: { freeDimensionOverrides: { batch: 1, channels: 4, height: 64, width: 64 } },
                },
            };

            const base = this.modelBase;
            let bytesDownloaded = 0;
            const fallbackTotal = Object.values(models).reduce((acc, m) => acc + m.sizeMB * 1024 * 1024, 0);
            const GRAND_APPROX = (typeof options.approxTotalBytes === 'number' ? options.approxTotalBytes : fallbackTotal);

            options.onProgress?.({
                phase: 'loading',
                message: `starting downloads (~${Math.round(GRAND_APPROX / 1024 / 1024)}MB total)...`,
                bytesDownloaded: 0, totalBytesExpected: GRAND_APPROX, pct: 0, accuracy: 'exact',
            });

            for (const key of Object.keys(models)) {
                const model = models[key];
                options.onProgress?.({ phase: 'loading', message: `downloading ${model.url}...`, bytesDownloaded });
                const expectedTotal = model.sizeMB * 1024 * 1024;
                const buf = await fetchArrayBufferWithCacheProgress(`${base}/${model.url}`, this.id, (loaded, total) => {
                    const pct = Math.min(100, Math.round(((bytesDownloaded + loaded) / GRAND_APPROX) * 100));
                    options.onProgress?.({
                        phase: 'loading', message: `downloading ${model.url}...`, pct,
                        bytesDownloaded: bytesDownloaded + loaded, totalBytesExpected: GRAND_APPROX,
                        asset: model.url, accuracy: 'exact',
                    });
                }, expectedTotal);
                bytesDownloaded += buf.byteLength;

                const t0 = performance.now();
                const sess = await ort.InferenceSession.create(buf, { ...baseOpt, ...model.opt });
                const ms = performance.now() - t0;
                options.onProgress?.({
                    phase: 'loading', message: `${key} ready in ${ms.toFixed(0)}ms`,
                    bytesDownloaded, totalBytesExpected: GRAND_APPROX, asset: model.url, accuracy: 'exact',
                });
                this.sessions[key] = sess;
            }

            this.loaded = true;
            return { ok: true, backendUsed: chosen, bytesDownloaded };
        } catch (e) {
            console.error('[sd-1.5] load error', e);
            return { ok: false, reason: 'internal_error', message: e instanceof Error ? e.message : String(e) };
        }
    }

    isLoaded() { return this.loaded; }

    async generate(params) {
        if (!this.loaded)
            return { ok: false, reason: 'model_not_loaded', message: 'Call loadModel() first' };

        const { prompt, width = 512, height = 512, signal, onProgress, seed, steps: reqSteps, guidanceScale } = params;
        if (!prompt || !prompt.trim())
            return { ok: false, reason: 'unsupported_option', message: 'Prompt is required' };
        if (width !== 512 || height !== 512)
            return { ok: false, reason: 'unsupported_option', message: 'Only 512x512 is supported' };

        const numSteps = (reqSteps === 20 || reqSteps === 25) ? reqSteps : DEFAULT_STEPS;
        const cfg = typeof guidanceScale === 'number' ? guidanceScale : DEFAULT_GUIDANCE_SCALE;
        const schedule = SCHEDULES[numSteps];
        const { sigmas, timesteps } = schedule;

        const start = performance.now();
        const ort = this.ort;

        try {
            // ── Tokenize ──────────────────────────────────────────────────────
            onProgress?.({ phase: 'tokenizing', pct: 2 });
            if (!this.tokenizerFn) {
                if (this.tokenizerProvider) this.tokenizerFn = await this.tokenizerProvider();
                else this.tokenizerFn = await getTokenizer();
            }
            if (signal?.aborted) return { ok: false, reason: 'cancelled' };

            const tok = this.tokenizerFn;
            const CLIP_SEQ = 77;
            const promptIds = await tokenize(tok, prompt, CLIP_SEQ);
            const uncondIds = await tokenize(tok, '', CLIP_SEQ);

            // batch=2: [uncond, cond]
            const batchIds = new Int32Array(2 * CLIP_SEQ);
            batchIds.set(uncondIds, 0);
            batchIds.set(promptIds, CLIP_SEQ);

            // ── Text Encoder ──────────────────────────────────────────────────
            onProgress?.({ phase: 'encoding', pct: 5 });
            let encOut;
            try {
                encOut = await this.sessions.text_encoder.run({
                    input_ids: new ort.Tensor('int32', batchIds, [2, CLIP_SEQ]),
                });
            } catch (e) {
                throw new Error(`text_encoder.run failed: ${e instanceof Error ? e.message : String(e)}`);
            }
            const teOutput = encOut.last_hidden_state ?? Object.values(encOut)[0] ?? encOut;
            // ORT output tensors may not be reusable as inputs — copy raw bits to a fresh tensor
            // asUint16 handles Float16Array (view same buffer as Uint16Array for raw bits)
            const teData = teOutput.data;
            const teBits = (teData instanceof Float32Array)
                ? new Float32Array(teData)
                : asUint16(teData).slice();
            const hiddenStates = new ort.Tensor(
                (teData instanceof Float32Array) ? 'float32' : 'float16',
                teBits,
                teOutput.dims,
            );
            if (signal?.aborted) return { ok: false, reason: 'cancelled' };

            // ── Initial latents (pure noise * sigma_0) ────────────────────────
            const latentSize = 1 * 4 * 64 * 64;
            const noise = randn(latentSize, seed);
            let latents = new Float32Array(latentSize);
            for (let i = 0; i < latentSize; i++) latents[i] = noise[i] * sigmas[0];

            // ── Euler denoising loop (matches sd.js reference) ────────────────
            for (let step = 0; step < numSteps; step++) {
                if (signal?.aborted) return { ok: false, reason: 'cancelled' };

                const pct = Math.round(10 + (step / numSteps) * 80);
                onProgress?.({ phase: 'denoising', pct, count: step + 1, total: numSteps });

                const sigma = sigmas[step];
                const sigmaNext = sigmas[step + 1];
                const t = timesteps[step];

                // Scale model input: latent / sqrt(sigma^2 + 1)
                const scale = Math.sqrt(sigma * sigma + 1);
                const scaledF16 = new Uint16Array(2 * latentSize);
                const oneSlice = f32ToF16FromScaled(latents, 1.0 / scale);
                scaledF16.set(oneSlice, 0);
                scaledF16.set(oneSlice, latentSize);

                const tVal = BigInt(Math.round(t));
                const feed = {
                    sample: new ort.Tensor('float16', scaledF16, [2, 4, 64, 64]),
                    timestep: new ort.Tensor('int64', [tVal, tVal], [2]),
                    encoder_hidden_states: hiddenStates,
                };

                let unetOut;
                try {
                    unetOut = await this.sessions.unet.run(feed);
                    unetOut = unetOut.out_sample ?? Object.values(unetOut)[0] ?? unetOut;
                } catch (e) {
                    throw new Error(`unet.run step ${step} failed: ${e instanceof Error ? e.message : String(e)}`);
                }

                // UNet output is float16 batch=2: [uncond, cond]
                const noiseData = unetOut.data;
                const half = noiseData.length / 2;
                const dt = sigmaNext - sigma;

                // CFG + simple Euler step in one pass (matches sd.js)
                // readF16 handles both Float16Array (direct read) and Uint16Array (bit conversion)
                for (let i = 0; i < latentSize; i++) {
                    const uncondN = readF16(noiseData, i);
                    const condN = readF16(noiseData, half + i);
                    const noisePred = uncondN + cfg * (condN - uncondN);
                    latents[i] += noisePred * dt;
                }
            }

            if (typeof hiddenStates.dispose === 'function') hiddenStates.dispose();

            // ── VAE decode ────────────────────────────────────────────────────
            onProgress?.({ phase: 'decoding', pct: 95 });
            if (signal?.aborted) return { ok: false, reason: 'cancelled' };

            const scaledForVae = new Float32Array(latentSize);
            for (let i = 0; i < latentSize; i++) scaledForVae[i] = latents[i] / VAE_SCALING_FACTOR;

            // VAE decoder is also float16 input
            let vaeOut;
            try {
                vaeOut = await this.sessions.vae_decoder.run({
                    latent_sample: new ort.Tensor('float16', f32ToF16(scaledForVae), [1, 4, 64, 64]),
                });
            } catch (e) {
                throw new Error(`vae_decoder.run failed: ${e instanceof Error ? e.message : String(e)}`);
            }
            let sample = vaeOut.sample ?? Object.values(vaeOut)[0] ?? vaeOut;
            if (signal?.aborted) return { ok: false, reason: 'cancelled' };

            // VAE output may be float16 (Float16Array or Uint16Array) — convert to float32
            if (sample.data && !(sample.data instanceof Float32Array)) {
                const len = sample.data.length;
                const f32data = new Float32Array(len);
                for (let i = 0; i < len; i++) f32data[i] = readF16(sample.data, i);
                sample = { dims: sample.dims, data: f32data };
            }
            const blob = await tensorToPngBlob(sample);
            const timeMs = performance.now() - start;
            onProgress?.({ phase: 'complete', pct: 100, timeMs });
            return { ok: true, blob, timeMs };
        } catch (e) {
            console.error('[sd-1.5] generate error', e);
            return { ok: false, reason: 'internal_error', message: e instanceof Error ? e.message : String(e) };
        }
    }

    async unload() {
        try {
            try { this.sessions.unet?.release?.(); } catch { }
            try { this.sessions.text_encoder?.release?.(); } catch { }
            try { this.sessions.vae_decoder?.release?.(); } catch { }
        } finally {
            this.sessions = {};
            this.ort = null;
            this.loaded = false;
            this.backendUsed = null;
        }
    }

    async purgeCache() { await purgeModelCache(this.id); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── FP16 helpers (handles both Float16Array and Uint16Array) ──────────────────
const _hasFloat16 = typeof Float16Array !== 'undefined';

// Get raw uint16 bit-pattern view (handles Float16Array by viewing same buffer)
function asUint16(data) {
    if (data instanceof Uint16Array) return data;
    return new Uint16Array(data.buffer, data.byteOffset, data.length);
}

// Read a single float value from fp16 tensor data (handles Float16Array, Uint16Array, Float32Array)
function readF16(data, i) {
    if (data instanceof Float32Array) return data[i];
    if (_hasFloat16 && data instanceof Float16Array) return data[i];
    return f16ScalarToF32(data[i]);
}

function f32ToF16(f32) {
    const len = f32.length;
    const u16 = new Uint16Array(len);
    const buf = new ArrayBuffer(4);
    const f32v = new Float32Array(buf);
    const u32v = new Uint32Array(buf);
    for (let i = 0; i < len; i++) {
        f32v[0] = f32[i];
        const bits = u32v[0];
        const sign = (bits >> 31) & 1;
        const exp = (bits >> 23) & 0xff;
        const frac = bits & 0x7fffff;
        if (exp === 0) {
            u16[i] = sign << 15;
        } else if (exp === 0xff) {
            u16[i] = (sign << 15) | 0x7c00 | (frac ? 0x200 : 0);
        } else {
            const e = exp - 127 + 15;
            if (e >= 31) u16[i] = (sign << 15) | 0x7c00;
            else if (e <= 0) u16[i] = sign << 15;
            else u16[i] = (sign << 15) | (e << 10) | (frac >> 13);
        }
    }
    return u16;
}

function f16ToF32(u16) {
    const len = u16.length;
    const f32 = new Float32Array(len);
    for (let i = 0; i < len; i++) f32[i] = f16ScalarToF32(u16[i]);
    return f32;
}

// Convert single fp16 uint16 bit pattern to float32
function f16ScalarToF32(bits) {
    const sign = (bits >> 15) & 1;
    const exp = (bits >> 10) & 0x1f;
    const frac = bits & 0x3ff;
    if (exp === 0) return (sign ? -1 : 1) * 5.9604644775390625e-8 * frac;
    if (exp === 31) return frac ? NaN : (sign ? -Infinity : Infinity);
    return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

// Convert Float32Array to fp16 Uint16Array with a pre-multiply scale factor
function f32ToF16FromScaled(f32, scale) {
    const len = f32.length;
    const scaled = new Float32Array(len);
    for (let i = 0; i < len; i++) scaled[i] = f32[i] * scale;
    return f32ToF16(scaled);
}

function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function randn(size, seed) {
    const rand = seed !== undefined ? mulberry32(seed) : Math.random;
    function boxMuller() {
        const u = rand();
        const v = rand();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    const data = new Float32Array(size);
    for (let i = 0; i < size; i++) data[i] = boxMuller();
    return data;
}

async function tokenize(tok, text, seqLen) {
    const tokOut = await tok(text, { padding: 'max_length', max_length: seqLen, truncation: true, return_tensor: false });
    let raw = tokOut.input_ids;
    if (raw && typeof raw === 'object' && raw.data) raw = raw.data;
    const flat = Array.isArray(raw) ? raw : Array.from(raw);
    const padId = typeof tok.pad_token_id === 'number' ? tok.pad_token_id : 0;
    const ids = new Int32Array(seqLen);
    const n = Math.min(flat.length, seqLen);
    for (let i = 0; i < n; i++) ids[i] = Number(flat[i]);
    for (let i = n; i < seqLen; i++) ids[i] = padId;
    return ids;
}

async function tensorToPngBlob(t) {
    const [n, c, h, w] = t.dims;
    const data = t.data;
    const out = new Uint8ClampedArray(w * h * 4);
    let idx = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const r = data[0 * h * w + y * w + x];
            const g = data[1 * h * w + y * w + x];
            const b = data[2 * h * w + y * w + x];
            const clamp = (v) => { let p = v / 2 + 0.5; return Math.round(Math.min(1, Math.max(0, p)) * 255); };
            out[idx++] = clamp(r);
            out[idx++] = clamp(g);
            out[idx++] = clamp(b);
            out[idx++] = 255;
        }
    }
    const imageData = new ImageData(out, w, h);
    const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
    const canvas = hasOffscreen ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.putImageData(imageData, 0, 0);
    const hasHTMLCanvas = typeof globalThis.HTMLCanvasElement !== 'undefined';
    if (hasHTMLCanvas && canvas instanceof globalThis.HTMLCanvasElement) {
        return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
    }
    return await canvas.convertToBlob({ type: 'image/png' });
}

let _tokInstance = null;
async function getTokenizer() {
    if (_tokInstance) return (text, opts) => _tokInstance(text, opts);
    const g = globalThis;
    if (g.AutoTokenizer && typeof g.AutoTokenizer.from_pretrained === 'function') {
        if (g.env) {
            g.env.allowLocalModels = false;
            g.env.allowRemoteModels = true;
            g.env.remoteHost = 'https://huggingface.co/';
            g.env.remotePathTemplate = '{model}/resolve/{revision}/';
        }
        _tokInstance = await g.AutoTokenizer.from_pretrained('Xenova/clip-vit-base-patch16');
        _tokInstance.pad_token_id = 0;
        return (text, opts) => _tokInstance(text, opts);
    }
    let AutoTokenizerMod = null;
    let env = null;
    const XENOVA_ESM = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm';
    const HF_ESM = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.1/+esm';
    try {
        const mod = await import(/* webpackIgnore: true */ XENOVA_ESM);
        AutoTokenizerMod = mod.AutoTokenizer; env = mod.env;
    } catch {
        try { const mod = await import('@xenova/transformers'); AutoTokenizerMod = mod.AutoTokenizer; env = mod.env; }
        catch {
            try { const mod2 = await import(/* webpackIgnore: true */ HF_ESM); AutoTokenizerMod = mod2.AutoTokenizer; env = mod2.env; }
            catch {
                try { const mod2 = await import('@huggingface/transformers'); AutoTokenizerMod = mod2.AutoTokenizer; env = mod2.env; }
                catch { throw new Error('Failed to load a tokenizer.'); }
            }
        }
    }
    if (env) {
        env.allowLocalModels = false;
        env.allowRemoteModels = true;
        env.remoteHost = 'https://huggingface.co/';
        env.remotePathTemplate = '{model}/resolve/{revision}/';
    }
    _tokInstance = await AutoTokenizerMod.from_pretrained('Xenova/clip-vit-base-patch16', { local_files_only: false, revision: 'main' });
    _tokInstance.pad_token_id = 0;
    return (text, opts) => _tokInstance(text, opts);
}
