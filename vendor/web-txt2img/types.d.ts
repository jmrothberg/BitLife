export type BackendId = 'webgpu' | 'wasm';
export type ModelId = 'sd-turbo' | 'janus-pro-1b';
export type ErrorCode = 'webgpu_unsupported' | 'backend_unavailable' | 'model_not_loaded' | 'unsupported_option' | 'cancelled' | 'internal_error';
export interface Capabilities {
    webgpu: boolean;
    shaderF16: boolean;
    wasm: boolean;
}
export interface ModelInfo {
    id: ModelId;
    displayName: string;
    task: 'text-to-image';
    supportedBackends: BackendId[];
    notes?: string;
    sizeBytesApprox?: number;
    sizeGBApprox?: number;
    sizeNotes?: string;
}
export interface LoadOptions {
    backendPreference?: BackendId[];
    onProgress?: (p: LoadProgress) => void;
    ort?: unknown;
    tokenizerProvider?: () => Promise<(text: string, opts?: any) => Promise<{
        input_ids: number[];
    }>>;
    wasmPaths?: string;
    wasmNumThreads?: number;
    wasmSimd?: boolean;
    modelBaseUrl?: string;
    approxTotalBytes?: number;
}
export interface LoadProgress {
    phase: 'loading';
    message?: string;
    pct?: number;
    bytesDownloaded?: number;
    totalBytesExpected?: number;
    asset?: string;
    accuracy?: 'exact' | 'approximate';
}
export type LoadResult = {
    ok: true;
    backendUsed: BackendId;
    bytesDownloaded?: number;
} | {
    ok: false;
    reason: ErrorCode;
    message?: string;
};
export interface GenerateParams {
    model: ModelId;
    prompt: string;
    seed?: number;
    width?: number;
    height?: number;
    signal?: AbortSignal;
    onProgress?: (event: GenerationProgressEvent) => void;
}
export type GenerationProgressPhase = 'loading' | 'tokenizing' | 'encoding' | 'denoising' | 'decoding' | 'image_tokens' | 'complete';
export interface GenerationProgressEvent {
    phase: GenerationProgressPhase;
    pct?: number;
    [key: string]: unknown;
}
export type GenerateResult = {
    ok: true;
    blob: Blob;
    timeMs: number;
} | {
    ok: false;
    reason: ErrorCode;
    message?: string;
};
export interface Adapter {
    readonly id: ModelId;
    checkSupport(capabilities: Capabilities): BackendId[];
    load(options: Required<Pick<LoadOptions, 'backendPreference'>> & LoadOptions): Promise<LoadResult>;
    isLoaded(): boolean;
    generate(params: Omit<GenerateParams, 'model'>): Promise<GenerateResult>;
    unload(): Promise<void>;
    purgeCache(): Promise<void>;
}
export interface RegistryEntry extends ModelInfo {
    createAdapter(): Adapter;
}
