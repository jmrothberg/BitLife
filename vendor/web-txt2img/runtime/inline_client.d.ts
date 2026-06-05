import type { BackendId, GenerateResult, LoadOptions, ModelId } from '../types.js';
import type { WorkerBusyPolicy, WorkerGenerateParams } from '../worker/protocol.js';
import { type SchedulerState } from './inline_host.js';
export type ProgressHandler = (e: any) => void;
/**
 * Main thread client for web-txt2img that runs without workers.
 * Provides the same API as Txt2ImgWorkerClient for compatibility.
 */
export declare class Txt2ImgClient {
    private scheduler;
    private loadInFlight;
    private stateChangeListeners;
    constructor();
    /**
     * Subscribe to state changes (idle, running, queued, aborting)
     */
    onStateChange(listener: (state: SchedulerState) => void): () => void;
    /**
     * Detect browser capabilities
     */
    detect(): Promise<{
        webgpu: boolean;
        shaderF16: boolean;
        wasm: boolean;
    }>;
    /**
     * List available models
     */
    listModels(): Promise<Array<{
        id: ModelId;
        displayName: string;
        task: 'text-to-image';
        supportedBackends: BackendId[];
        notes?: string;
        sizeBytesApprox?: number;
        sizeGBApprox?: number;
        sizeNotes?: string;
    }>>;
    /**
     * List available backends
     */
    listBackends(): Promise<BackendId[]>;
    /**
     * Load a model for generation
     */
    load(model: ModelId, options?: LoadOptions, onProgress?: ProgressHandler): Promise<any>;
    /**
     * Unload the currently loaded model
     */
    unload(model?: ModelId): Promise<void>;
    /**
     * Purge model cache
     */
    purge(model?: ModelId): Promise<void>;
    /**
     * Purge all model caches
     */
    purgeAll(): Promise<void>;
    /**
     * Generate an image from text prompt
     */
    generate(params: WorkerGenerateParams, onProgress?: ProgressHandler, opts?: {
        busyPolicy?: WorkerBusyPolicy;
        replaceQueued?: boolean;
        debounceMs?: number;
    }): {
        id: string;
        promise: Promise<GenerateResult>;
        abort: () => Promise<void>;
    };
    /**
     * Clean up resources
     */
    terminate(): void;
}
/**
 * Compatibility wrapper for Txt2ImgWorkerClient
 * @deprecated Use Txt2ImgClient instead
 */
export declare class Txt2ImgWorkerClient extends Txt2ImgClient {
    constructor(worker?: Worker);
    static createDefault(): Txt2ImgWorkerClient;
}
