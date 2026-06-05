export async function detectCapabilities() {
    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu;
    let shaderF16 = false;
    if (hasWebGPU) {
        try {
            const adapter = await navigator.gpu.requestAdapter?.();
            shaderF16 = !!adapter?.features?.has?.('shader-f16');
        }
        catch {
            shaderF16 = false;
        }
    }
    const wasm = true;
    return { webgpu: hasWebGPU, shaderF16, wasm };
}
export function listBackends() {
    return ['webgpu', 'wasm'];
}
