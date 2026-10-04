// One application server, plus an optional frontend-only Vite development port.
export const HOST = '127.0.0.1';
export const FRONTEND_PORT = 23872;
export const FRONTEND_URL = `http://${HOST}:${FRONTEND_PORT}`;
export const SLIM_PORT = 23873;
export const SLIM_URL = `http://${HOST}:${SLIM_PORT}`;
