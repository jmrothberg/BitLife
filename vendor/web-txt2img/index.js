import { detectCapabilities as _detectCapabilities, listBackends as _listBackends } from './capabilities.js';
import { getModelInfo, listSupportedModels as _listSupportedModels, getRegistryEntry, defaultBackendPreferenceFor } from './registry.js';
import * as cache from './cache.js';
// Adapter instances
const adapters = new Map();
let cachedCapabilities = null;
export async function detectCapabilities() {
    if (!cachedCapabilities)
        cachedCapabilities = await _detectCapabilities();
    return cachedCapabilities;
}
export function listBackends() {
    return _listBackends();
}
export function listSupportedModels() {
    return _listSupportedModels();
}
export { getModelInfo };
function adapterFor(id) {
    let a = adapters.get(id);
    if (!a) {
        a = getRegistryEntry(id).createAdapter();
        adapters.set(id, a);
    }
    return a;
}
export async function loadModel(id, options = {}) {
    const caps = await detectCapabilities();
    const a = adapterFor(id);
    const supported = a.checkSupport(caps);
    if (supported.length === 0) {
        return { ok: false, reason: id === 'janus-pro-1b' ? 'webgpu_unsupported' : 'backend_unavailable', message: 'No supported backend detected' };
    }
    const backendPreference = options.backendPreference ?? defaultBackendPreferenceFor(id);
    const chosen = backendPreference.find((b) => supported.includes(b));
    if (!chosen)
        return { ok: false, reason: 'backend_unavailable', message: 'No backend available matching preference' };
    // Inject approx size from registry as the single source of truth
    const info = getModelInfo(id);
    const approxTotalBytes = typeof options.approxTotalBytes === 'number' ? options.approxTotalBytes : info.sizeBytesApprox;
    return a.load({ ...options, backendPreference, approxTotalBytes });
}
export function isModelLoaded(id) {
    return adapterFor(id).isLoaded();
}
export async function unloadModel(id) {
    await adapterFor(id).unload();
}
export async function purgeModelCache(id) {
    await adapterFor(id).purgeCache();
}
export async function purgeAllCaches() {
    await cache.purgeAllCaches();
}
export async function generateImage(params) {
    const a = adapterFor(params.model);
    if (!a.isLoaded())
        return { ok: false, reason: 'model_not_loaded', message: 'Call loadModel() first' };
    const { model, ...rest } = params;
    return a.generate(rest);
}
// Optional worker client exports for convenience
export { Txt2ImgWorkerClient, createTxt2ImgWorker } from './worker/client.js';
