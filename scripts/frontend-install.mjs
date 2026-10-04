import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Launch/build callers share node_modules. Serialize checks and npm ci.
export async function withFrontendInstallLock(directory, token, isStopping, action) {
    await mkdir(directory, { recursive: true });
    const path = join(directory, 'frontend-install.lock');
    const recoveryPath = `${path}.recovery`;
    const deadline = Date.now() + 120_000;
    while (true) {
        if (isStopping()) throw new Error('Startup was cancelled.');
        let handle;
        try { handle = await open(path, 'wx', 0o600); }
        catch (error) {
            if (error.code !== 'EEXIST') throw error;
            let state, serialized;
            try { serialized = await readFile(path, 'utf8'); state = JSON.parse(serialized); }
            catch (readError) {
                if (readError.code !== 'ENOENT' && !(readError instanceof SyntaxError)) throw readError;
            }
            if (state) {
                if (!Number.isSafeInteger(state.pid) || state.pid <= 0 || !/^[a-f0-9-]{36}$/.test(state.token)) throw new Error(`Invalid dependency lock: ${path}`);
                let alive = true;
                try { process.kill(state.pid, 0); } catch (probeError) { alive = probeError.code !== 'ESRCH'; }
                if (!alive) {
                    // Serialize stale-lock recovery as well. Otherwise two
                    // recoverers could unlink a new owner's lock after an old read.
                    let recovery;
                    try { recovery = await open(recoveryPath, 'wx', 0o600); }
                    catch (recoveryError) { if (recoveryError.code !== 'EEXIST') throw recoveryError; }
                    if (recovery) {
                        try {
                            await recovery.writeFile(JSON.stringify({ pid: process.pid, token }));
                            const current = await readFile(path, 'utf8').catch(readError => { if (readError.code !== 'ENOENT') throw readError; return null; });
                            let stillDead = false;
                            try { process.kill(state.pid, 0); } catch (probeError) { stillDead = probeError.code === 'ESRCH'; }
                            if (current === serialized && stillDead) await unlink(path);
                        } finally { await recovery.close(); await unlink(recoveryPath); }
                    }
                }
            }
            if (Date.now() >= deadline) throw new Error(`Frontend dependency preparation is locked: ${path} (check ${recoveryPath} too). No process was stopped.`);
            await delay(100);
            continue;
        }
        try {
            await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
            await handle.close();
            return await action();
        } finally {
            await handle.close();
            const state = JSON.parse(await readFile(path, 'utf8'));
            if (state.token === token) await unlink(path);
        }
    }
}
