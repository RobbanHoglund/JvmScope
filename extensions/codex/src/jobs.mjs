import { Worker } from 'node:worker_threads';

export function createJobs({ workerUrl = new URL('./worker.mjs', import.meta.url), timeoutMs = 60000 } = {}) {
    const active = new Set();
    return {
        async run(name, args, signal) {
            const started = performance.now();
            if (signal?.aborted) throw new Error('Analysis cancelled.');
            if (active.size >= 2) throw new Error('Two analyses are already running. Wait for one to finish.');
            return new Promise((resolve, reject) => {
                const worker = new Worker(workerUrl, { workerData: { name, args }, resourceLimits: { maxOldGenerationSizeMb: 512 } });
                active.add(worker);
                let settled = false;
                const finish = (error, result) => {
                    if (settled) return;
                    settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
                    void worker.terminate().then(() => {
                        active.delete(worker);
                        if (error) reject(error);
                        else {
                            if (result?.timing) result.timing.workerRoundTripMs = Math.round(performance.now() - started);
                            resolve(result);
                        }
                    }, terminationError => { active.delete(worker); reject(terminationError); });
                };
                const cancel = () => finish(new Error('Analysis cancelled.'));
                const timer = setTimeout(() => finish(new Error('Analysis exceeded 60 seconds. Select fewer snapshots or a smaller interval.')), timeoutMs);
                signal?.addEventListener('abort', cancel, { once: true });
                worker.once('message', message => finish(message.error ? new Error(message.error) : null, message.result));
                worker.once('error', error => finish(error));
                worker.once('exit', () => { if (!settled) finish(new Error('Analysis worker exited before returning a result.')); });
            });
        },
        async close() { await Promise.all([...active].map(worker => worker.terminate())); active.clear(); },
    };
}
