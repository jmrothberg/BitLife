function uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
export class Txt2ImgWorkerClient {
    constructor(worker) {
        this.pending = new Map();
        this.lastGenerateId = null;
        this.worker = worker;
        this.worker.addEventListener('message', (ev) => this.onMessage(ev));
    }
    static createDefault() {
        // Use the canonical Vite-friendly pattern so the worker is bundled in builds.
        // Publish-safe: point to .js; dev uses a shim at src/worker/host.js
        const w = new Worker(new URL('./host.js', import.meta.url), { type: 'module' });
        return new Txt2ImgWorkerClient(w);
    }
    onMessage(ev) {
        const msg = ev.data;
        if (!msg || typeof msg !== 'object')
            return;
        if (msg.type === 'state') {
            // No-op; apps can subscribe on worker directly if needed
            return;
        }
        const id = msg.id;
        const pend = id ? this.pending.get(id) : undefined;
        if (!pend)
            return;
        switch (msg.type) {
            case 'accepted': {
                // ignore; promise resolves on final result
                break;
            }
            case 'progress': {
                pend.onProgress?.(msg.event);
                break;
            }
            case 'result': {
                this.pending.delete(id);
                pend.resolve(msg);
                break;
            }
        }
    }
    send(req, onProgress) {
        return new Promise((resolve, reject) => {
            this.pending.set(req.id, { resolve, reject, onProgress });
            this.worker.postMessage(req);
        });
    }
    async detect() {
        const res = await this.send({ id: uid(), kind: 'detect' });
        return res.data;
    }
    async listModels() {
        const res = await this.send({ id: uid(), kind: 'listModels' });
        return res.data;
    }
    async listBackends() {
        const res = await this.send({ id: uid(), kind: 'listBackends' });
        return res.data;
    }
    async load(model, options, onProgress) {
        const res = await this.send({ id: uid(), kind: 'load', model, options }, onProgress);
        return res.data ?? res; // return LoadResult in data, or whole msg if shaped differently
    }
    async unload(model) {
        await this.send({ id: uid(), kind: 'unload', model });
    }
    async purge(model) {
        await this.send({ id: uid(), kind: 'purge', model });
    }
    async purgeAll() {
        await this.send({ id: uid(), kind: 'purgeAll' });
    }
    generate(params, onProgress, opts) {
        const id = uid();
        this.lastGenerateId = id;
        const promise = this.send({ id, kind: 'generate', params, ...(opts ?? {}) }, onProgress);
        const abort = async () => {
            await this.send({ id: uid(), kind: 'abort' });
        };
        return { id, promise, abort };
    }
    terminate() {
        this.worker.terminate();
        this.pending.clear();
    }
}
export function createTxt2ImgWorker() {
    // Publish-safe: point to .js; dev uses a shim at src/worker/host.js
    return new Worker(new URL('./host.js', import.meta.url), { type: 'module' });
}
