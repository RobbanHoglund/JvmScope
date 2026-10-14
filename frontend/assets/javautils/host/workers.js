// Browser delivery uses same-origin worker files. The VS Code build substitutes
// vscode-workers.js because webviews can start workers only from blob/data URIs.
export const createTdaWorker = () => new Worker(new URL('../tda/analysis-worker.js', import.meta.url), { type: 'module' });
export const createTlsWorker = () => new Worker(new URL('../tls-analysis-worker.js', import.meta.url), { type: 'module' });
