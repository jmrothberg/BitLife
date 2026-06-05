import type { Adapter, BackendId, Capabilities, GenerateParams, GenerateResult, LoadOptions, LoadResult } from '../types.js';
export declare class SDTurboAdapter implements Adapter {
    readonly id: "sd-turbo";
    private loaded;
    private backendUsed;
    private ort;
    private sessions;
    private tokenizerFn;
    private tokenizerProvider;
    private modelBase;
    checkSupport(c: Capabilities): BackendId[];
    load(options: Required<Pick<LoadOptions, 'backendPreference'>> & LoadOptions): Promise<LoadResult>;
    isLoaded(): boolean;
    generate(params: Omit<GenerateParams, 'model'>): Promise<GenerateResult>;
    unload(): Promise<void>;
    purgeCache(): Promise<void>;
}
