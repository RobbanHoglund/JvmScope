/** One disposable worker per analysis; cancellation also releases its dump data. */
export function createAnalysisClient(createWorker = () => new Worker(
    new URL('./analysis-worker.js', import.meta.url), { type: 'module' },
)) {
    let pending = null;

    function cancel() {
        const job = pending;
        pending = null;
        if (!job) return;
        job.worker.terminate();
        job.resolve(null);
    }

    function analyze(text, cpuThresholds) {
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
                else if (!data?.result?.parserResult) finish(new Error('Invalid analysis worker response.'));
                else finish(null, data.result);
            };
            worker.onerror = (event) => {
                event.preventDefault?.();
                finish(new Error(event.message || 'The analysis worker failed.'));
            };
            worker.onmessageerror = () => finish(new Error('The analysis worker response could not be read.'));
            try { worker.postMessage({ text, cpuThresholds }); } catch (error) { finish(error); }
        });
    }

    return Object.freeze({ analyze, cancel });
}
