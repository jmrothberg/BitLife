import type { BackendId, ModelId, ModelInfo, RegistryEntry } from './types.js';
export declare function listSupportedModels(): ModelInfo[];
export declare function getModelInfo(id: ModelId): ModelInfo;
export declare function getRegistryEntry(id: ModelId): RegistryEntry;
export declare function defaultBackendPreferenceFor(id: ModelId): BackendId[];
