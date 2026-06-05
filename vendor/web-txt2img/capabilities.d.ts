import type { Capabilities } from './types.js';
export declare function detectCapabilities(): Promise<Capabilities>;
export declare function listBackends(): Array<'webgpu' | 'wasm'>;
