import { type GenerateParams } from '../index.js';
import type { GenerateResult, ModelId } from '../types.js';
import type { WorkerBusyPolicy } from '../worker/protocol.js';
type JobParams = Omit<GenerateParams, 'onProgress' | 'signal'>;
export type SchedulerState = 'idle' | 'running' | 'aborting' | 'queued';
interface SchedulerCallbacks {
    onStateChange?: (state: SchedulerState) => void;
}
export declare class InlineScheduler {
    private currentJob;
    private pendingJob;
    private aborting;
    private readonly ABORT_TIMEOUT_MS;
    private abortTimer;
    private debounceTimer;
    private loadedModel;
    private callbacks;
    private state;
    constructor(callbacks?: SchedulerCallbacks);
    private setState;
    getState(): SchedulerState;
    setLoadedModel(model: ModelId | null): void;
    getLoadedModel(): ModelId | null;
    private normPct;
    private runJob;
    private maybeStartNext;
    private startPending;
    private supersedePending;
    private handleAbortTimeout;
    enqueueGenerate(params: JobParams, onProgress?: (e: any) => void, options?: {
        busyPolicy?: WorkerBusyPolicy;
        replaceQueued?: boolean;
        debounceMs?: number;
    }): Promise<GenerateResult>;
    abort(): Promise<void>;
    cleanup(): void;
}
export {};
