export declare function noteModelUrl(modelId: string, url: string): void;
export declare function fetchWithCache(input: RequestInfo | URL, modelId?: string): Promise<Response>;
export declare function fetchArrayBufferWithCacheProgress(url: string, modelId?: string, onProgress?: (loadedBytes: number, totalBytes?: number) => void, expectedTotalBytes?: number): Promise<ArrayBuffer>;
export declare function purgeModelCache(modelId: string): Promise<void>;
export declare function purgeAllCaches(): Promise<void>;
