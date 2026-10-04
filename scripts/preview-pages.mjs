import { createServer } from 'node:http';
import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultPagesBase, pagesOutput, validatePagesBase, verifyPagesArtifact } from './build-pages.mjs';

const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
    '.json':'application/json; charset=utf-8', '.txt':'text/plain; charset=utf-8', '.md':'text/plain; charset=utf-8', '.svg':'image/svg+xml' };

// Strict static delivery, with exact case even on Windows. No redirects, API,
// proxy, Vite middleware or SPA fallback. The server binds only to loopback.
export async function startPagesServer(directory = pagesOutput, { base = defaultPagesBase, port = 0 } = {}) {
    validatePagesBase(base);
    const root = await realpath(directory);
    const server = createServer(async (request, response) => {
        const fail = status => { response.writeHead(status, {'Content-Type':'text/plain; charset=utf-8'}); response.end(request.method === 'HEAD' ? undefined : 'Not found\n'); };
        try {
            if (!['GET','HEAD'].includes(request.method)) { request.resume(); response.setHeader('Allow','GET, HEAD'); fail(405); return; }
            const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
            if (!path.startsWith(base) || path.includes('\\')) { fail(404); return; }
            const segments = path.slice(base.length).split('/');
            if (segments.at(-1) === '') segments.pop();
            if (segments.some(part => !part || part === '.' || part === '..')) { fail(404); return; }
            let file = root;
            for (const part of segments) {
                if (!(await readdir(file)).includes(part)) { fail(404); return; }
                file = join(file, part);
                if ((await lstat(file)).isSymbolicLink()) { fail(404); return; }
            }
            if ((await lstat(file)).isDirectory()) file = join(file,'index.html');
            if ((await lstat(file)).isSymbolicLink()) { fail(404); return; }
            const target = await realpath(file);
            if (!target.startsWith(root+sep)) { fail(404); return; }
            const bytes = await readFile(file);
            response.writeHead(200, {'Content-Type':mime[extname(file)] || 'application/octet-stream', 'Content-Length':bytes.length});
            response.end(request.method === 'HEAD' ? undefined : bytes);
        } catch { if (!response.headersSent) fail(404); else response.destroy(); }
    });
    await new Promise((accept, reject) => { server.once('error',reject); server.listen(port,'127.0.0.1',accept); });
    return { url:`http://127.0.0.1:${server.address().port}`, base,
        async stop() { await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept())); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    verifyPagesArtifact();
    const server = await startPagesServer(pagesOutput, {port:23874});
    console.log(`JvmScope Pages preview: ${server.url}${server.base}`);
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => { await server.stop(); process.exit(); });
}
