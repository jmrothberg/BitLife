import type { BackendId, GenerationProgressEvent, LoadOptions, ModelId } from '../types.js';
export type WorkerBusyPolicy = 'reject' | 'abort_and_queue' | 'queue';
export type WorkerGenerateParams = {
    model?: ModelId;
    prompt: string;
    seed?: number;
    width?: number;
    height?: number;
};
export type WorkerRequest = {
    id: string;
    kind: 'detect';
} | {
    id: string;
    kind: 'listModels';
} | {
    id: string;
    kind: 'listBackends';
} | {
    id: string;
    kind: 'load';
    model: ModelId;
    options?: LoadOptions;
} | {
    id: string;
    kind: 'unload';
    model?: ModelId;
} | {
    id: string;
    kind: 'purge';
    model?: ModelId;
} | {
    id: string;
    kind: 'purgeAll';
} | {
    id: string;
    kind: 'generate';
    params: WorkerGenerateParams;
    busyPolicy?: WorkerBusyPolicy;
    replaceQueued?: boolean;
    debounceMs?: number;
} | {
    id: string;
    kind: 'abort';
};
export type WorkerState = 'idle' | 'running' | 'aborting' | 'queued';
export type WorkerAccepted = {
    id: string;
    type: 'accepted';
};
export type WorkerProgress = {
    id: string;
    type: 'progress';
    event: GenerationProgressEvent & {
        pct?: number;
        bytesDownloaded?: number;
        totalBytesExpected?: number;
        message?: string;
    };
};
export type WorkerGenerateResult = {
    id: string;
    type: 'result';
    ok: true;
    blob: Blob;
    timeMs: number;
} | {
    id: string;
    type: 'result';
    ok: false;
    reason: string;
    message?: string;
};
export type WorkerRpcResult = {
    id: string;
    type: 'result';
    ok: true;
    data?: any;
} | {
    id: string;
    type: 'result';
    ok: false;
    reason: string;
    message?: string;
};
export type WorkerStateMsg = {
    type: 'state';
    value: WorkerState;
};
export type WorkerResponse = WorkerAccepted | WorkerProgress | WorkerGenerateResult | WorkerRpcResult | WorkerStateMsg;
export type { BackendId };
