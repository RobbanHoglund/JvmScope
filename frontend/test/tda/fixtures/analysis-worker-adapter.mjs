// Exercise the browser worker entry using Node's actual worker/structured-clone boundary.
import { parentPort } from 'node:worker_threads';
globalThis.self = { postMessage: data => parentPort.postMessage(data) };
await import('../../../assets/javautils/tda/analysis-worker.js');
parentPort.on('message', data => self.onmessage({ data }));
