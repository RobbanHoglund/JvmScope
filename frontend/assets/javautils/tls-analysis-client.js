/** One disposable worker per capture. A replacement or Clear releases pending data. */
export function createTlsAnalysisClient(createWorker = () => new Worker(
    new URL('./tls-analysis-worker.js', import.meta.url), { type: 'module' },
)) {
    let pending = null;
    function cancel() {
        const job = pending;
        pending = null;
        if (!job) return;
        job.worker.terminate();
        job.resolve(null);
    }
    function analyze(text) {
        cancel();
        return new Promise((resolve, reject) => {
            let worker;
            try { worker = createWorker(); } catch (error) { reject(error); return; }
            const job = { worker, resolve };
            pending = job;
            function finish(error, result) {
                if (pending !== job) return;
                pending = null;
                worker.terminate();
                if (error) reject(error);
                else resolve(result);
            }
            worker.onmessage = ({ data }) => {
                if (data?.error) finish(new Error(data.error));
                else if (!Array.isArray(data?.result?.analysis?.interactions)
                    || !Array.isArray(data?.result?.analysis?.warnings)
                    || !Array.isArray(data?.result?.entries)) finish(new Error('Invalid TLS analysis worker response.'));
                else finish(null, data.result);
            };
            worker.onerror = event => {
                event.preventDefault?.();
                finish(new Error(event.message || 'The TLS analysis worker failed.'));
            };
            worker.onmessageerror = () => finish(new Error('The TLS analysis worker response could not be read.'));
            try { worker.postMessage({ text }); } catch (error) { finish(error); }
        });
    }
    return Object.freeze({ analyze, cancel });
}
