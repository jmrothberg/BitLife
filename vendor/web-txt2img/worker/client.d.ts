import type { BackendId, GenerateResult, LoadOptions, ModelId } from '../types.js';
import type { WorkerBusyPolicy, WorkerGenerateParams } from './protocol.js';
export type ProgressHandler = (e: any) => void;
export declare class Txt2ImgWorkerClient {
    private worker;
    private pending;
    private lastGenerateId;
    constructor(worker: Worker);
    static createDefault(): Txt2ImgWorkerClient;
    private onMessage;
    private send;
    detect(): Promise<{
        webgpu: boolean;
        shaderF16: boolean;
        wasm: boolean;
    }>;
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
    listBackends(): Promise<BackendId[]>;
    load(model: ModelId, options?: LoadOptions, onProgress?: ProgressHandler): Promise<any>;
    unload(model?: ModelId): Promise<void>;
    purge(model?: ModelId): Promise<void>;
    purgeAll(): Promise<void>;
    generate(params: WorkerGenerateParams, onProgress?: ProgressHandler, opts?: {
        busyPolicy?: WorkerBusyPolicy;
        replaceQueued?: boolean;
        debounceMs?: number;
    }): {
        id: string;
        promise: Promise<GenerateResult | any>;
        abort: () => Promise<void>;
    };
    terminate(): void;
}
export declare function createTxt2ImgWorker(): Worker;
