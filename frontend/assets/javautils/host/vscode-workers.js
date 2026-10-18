import TdaWorker from '../tda/analysis-worker.js?worker&inline';
import TlsWorker from '../tls-analysis-worker.js?worker&inline';
import GcWorker from '../gc/gc-worker.js?worker&inline';
export const createTdaWorker = () => new TdaWorker();
export const createTlsWorker = () => new TlsWorker();
export const createGcWorker = () => new GcWorker();
