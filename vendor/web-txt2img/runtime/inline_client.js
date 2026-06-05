// Inline client for web-txt2img — main thread API without workers
// Maintains same API surface as Txt2ImgWorkerClient for compatibility
import { detectCapabilities, listBackends, listSupportedModels, loadModel, unloadModel, purgeModelCache, purgeAllCaches, } from '../index.js';
import { InlineScheduler } from './inline_host.js';
function uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
/**
 * Main thread client for web-txt2img that runs without workers.
 * Provides the same API as Txt2ImgWorkerClient for compatibility.
 */
export class Txt2ImgClient {
    constructor() {
        this.loadInFlight = false;
        this.stateChangeListeners = [];
        this.scheduler = new InlineScheduler({
            onStateChange: (state) => {
                this.stateChangeListeners.forEach(listener => listener(state));
            },
        });
    }
    /**
     * Subscribe to state changes (idle, running, queued, aborting)
     */
    onStateChange(listener) {
        this.stateChangeListeners.push(listener);
        return () => {
            const index = this.stateChangeListeners.indexOf(listener);
            if (index >= 0) {
                this.stateChangeListeners.splice(index, 1);
            }
        };
    }
    /**
     * Detect browser capabilities
     */
    async detect() {
        return await detectCapabilities();
    }
    /**
     * List available models
     */
    async listModels() {
        return listSupportedModels();
    }
    /**
     * List available backends
     */
    async listBackends() {
        return listBackends();
    }
    /**
     * Load a model for generation
     */
    async load(model, options, onProgress) {
        const loadedModel = this.scheduler.getLoadedModel();
        if (loadedModel || this.loadInFlight) {
            const reason = 'busy';
            const message = loadedModel
                ? `Model "${loadedModel}" already loaded. Unload before loading another.`
                : 'Another load is in progress.';
            return { ok: false, reason, message };
        }
        this.loadInFlight = true;
        try {
            const result = await loadModel(model, {
                ...options,
                onProgress: (p) => {
                    onProgress?.({
                        ...p,
                        pct: typeof p.pct === 'number' ? p.pct : undefined,
                    });
                },
            });
            if (result.ok) {
                this.scheduler.setLoadedModel(model);
            }
            return result;
        }
        catch (error) {
            return {
                ok: false,
                reason: 'internal_error',
                message: String(error),
            };
        }
        finally {
            this.loadInFlight = false;
        }
    }
    /**
     * Unload the currently loaded model
     */
    async unload(model) {
        const loadedModel = this.scheduler.getLoadedModel();
        const target = model ?? loadedModel;
        if (!target) {
            throw new Error('No model loaded to unload.');
        }
        if (loadedModel && loadedModel !== target) {
            throw new Error(`Loaded model is "${loadedModel}"; requested unload "${target}".`);
        }
        await unloadModel(target);
        if (loadedModel === target) {
            this.scheduler.setLoadedModel(null);
        }
    }
    /**
     * Purge model cache
     */
    async purge(model) {
        const loadedModel = this.scheduler.getLoadedModel();
        const target = model ?? loadedModel;
        if (!target) {
            throw new Error('No model specified and none loaded; cannot purge.');
        }
        await purgeModelCache(target);
    }
    /**
     * Purge all model caches
     */
    async purgeAll() {
        await purgeAllCaches();
    }
    /**
     * Generate an image from text prompt
     */
    generate(params, onProgress, opts) {
        const id = uid();
        const promise = this.scheduler.enqueueGenerate(params, onProgress, opts);
        const abort = async () => {
            await this.scheduler.abort();
        };
        return { id, promise, abort };
    }
    /**
     * Clean up resources
     */
    terminate() {
        this.scheduler.cleanup();
        this.stateChangeListeners = [];
    }
}
/**
 * Compatibility wrapper for Txt2ImgWorkerClient
 * @deprecated Use Txt2ImgClient instead
 */
export class Txt2ImgWorkerClient extends Txt2ImgClient {
    constructor(worker) {
        super();
        if (worker) {
            console.warn('Txt2ImgWorkerClient: Worker parameter is ignored. ' +
                'This class now runs inline without workers. ' +
                'Consider using Txt2ImgClient directly.');
        }
    }
    static createDefault() {
        console.warn('Txt2ImgWorkerClient.createDefault() is deprecated. ' +
            'Use "new Txt2ImgClient()" instead for better performance.');
        return new Txt2ImgWorkerClient();
    }
}
