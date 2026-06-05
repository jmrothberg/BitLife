import type { Adapter, BackendId, Capabilities, GenerateParams, GenerateResult, LoadOptions, LoadResult } from '../types.js';
export declare class JanusProAdapter implements Adapter {
    readonly id: "janus-pro-1b";
    private loaded;
    private backendUsed;
    private hf;
    private processor;
    private model;
    checkSupport(c: Capabilities): BackendId[];
    load(options: Required<Pick<LoadOptions, 'backendPreference'>> & LoadOptions): Promise<LoadResult>;
    isLoaded(): boolean;
    generate(params: Omit<GenerateParams, 'model'>): Promise<GenerateResult>;
    unload(): Promise<void>;
    purgeCache(): Promise<void>;
}
