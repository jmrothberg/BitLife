import { SDTurboAdapter } from './adapters/sd-turbo.js';
import { JanusProAdapter } from './adapters/janus-pro.js';
import { SD15Adapter } from './adapters/sd15.js';
const REGISTRY = [
    {
        id: 'sd-turbo',
        displayName: 'SD-Turbo (ONNX Runtime Web)',
        task: 'text-to-image',
        supportedBackends: ['webgpu', 'wasm'],
        notes: 'Image size 512×512; seed supported.',
        sizeBytesApprox: 2398 * 1024 * 1024,
        sizeGBApprox: 2.34,
        sizeNotes: 'UNet ~640MB, text_encoder ~1700MB, vae_decoder ~95MB',
        createAdapter: () => new SDTurboAdapter(),
    },
    {
        id: 'janus-pro-1b',
        displayName: 'Janus-Pro-1B (Transformers.js)',
        task: 'text-to-image',
        supportedBackends: ['webgpu'],
        notes: 'Seed unsupported.',
        sizeBytesApprox: 2305 * 1024 * 1024,
        sizeGBApprox: 2.25,
        sizeNotes: 'Mixed-precision ONNX; varies slightly by device/dtype',
        createAdapter: () => new JanusProAdapter(),
    },
    {
        id: 'sd-1.5',
        displayName: 'SD 1.5 multi-step (MS WebNN ONNX)',
        task: 'text-to-image',
        supportedBackends: ['webgpu', 'wasm'],
        notes: '512×512, 25 steps, much better quality than turbo. Seed supported.',
        sizeBytesApprox: 1970 * 1024 * 1024,
        sizeGBApprox: 1.92,
        sizeNotes: 'text_encoder 235MB, unet 1640MB, vae_decoder 95MB (FP16)',
        createAdapter: () => new SD15Adapter(),
    },
];
export function listSupportedModels() {
    return REGISTRY.map(({ createAdapter, ...info }) => info);
}
export function getModelInfo(id) {
    const found = REGISTRY.find((m) => m.id === id);
    if (!found)
        throw new Error(`Unknown model id: ${id}`);
    const { createAdapter, ...info } = found;
    return info;
}
export function getRegistryEntry(id) {
    const found = REGISTRY.find((m) => m.id === id);
    if (!found)
        throw new Error(`Unknown model id: ${id}`);
    return found;
}
export function defaultBackendPreferenceFor(id) {
    switch (id) {
        case 'sd-turbo':
            return ['webgpu', 'wasm'];
        case 'janus-pro-1b':
            return ['webgpu'];
        case 'sd-1.5':
            return ['webgpu', 'wasm'];
    }
}
