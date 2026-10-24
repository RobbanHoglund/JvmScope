import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;

// Explicit files only: no globs, directory scanning, URLs, subprocesses or writes.
export async function readCapture(filename, remaining = MAX_CAPTURE_BYTES) {
    if (!path.isAbsolute(filename) || filename.includes('\0')) throw new Error('Choose an absolute local file path. URLs and relative paths are not accepted.');
    const resolved = await realpath(filename);
    const handle = await open(resolved, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
        const before = await handle.stat();
        if (!before.isFile()) throw new Error('Choose a regular capture file, not a directory or device.');
        if (!before.size) throw new Error('The capture is empty.');
        if (before.size > remaining) throw new Error('Captures exceed the combined 64 MiB limit. Select a smaller interval.');
        const chunks = []; let bytes = 0;
        while (true) {
            const chunk = Buffer.alloc(Math.min(65536, remaining - bytes + 1));
            const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
            if (!bytesRead) break;
            bytes += bytesRead;
            if (bytes > remaining) throw new Error('Captures exceed the combined 64 MiB limit.');
            chunks.push(chunk.subarray(0, bytesRead));
        }
        const after = await handle.stat();
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Capture changed while reading. Analyze a stable copy.');
        const data = Buffer.concat(chunks);
        if (data.includes(0) || (data[0] === 0x1f && data[1] === 0x8b)) throw new Error('Use an uncompressed UTF-8 text capture; binary and gzip input are not supported.');
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
        catch { throw new Error('The capture is not valid UTF-8. Convert a copy before analysis.'); }
        return { path: resolved, name: path.basename(resolved), bytes, sha256: createHash('sha256').update(data).digest('hex'), text };
    } finally { await handle.close(); }
}

export async function readCaptures(paths) {
    const captures = []; let remaining = MAX_CAPTURE_BYTES;
    const seen = new Set();
    for (const filename of paths) {
        const capture = await readCapture(filename, remaining);
        if (seen.has(capture.path)) throw new Error('The same file was selected twice. Duplicate captures can distort series analysis.');
        seen.add(capture.path); remaining -= capture.bytes; captures.push(capture);
    }
    return captures;
}

export function sourceInfo({ text, ...source }) { return source; }

export async function captureLines({ path: filename, startLine, endLine, sha256 }) {
    if (endLine < startLine || endLine - startLine >= 200) throw new Error('Choose an ordered range of at most 200 lines.');
    const capture = await readCapture(filename);
    if (capture.sha256 !== sha256) throw new Error('Capture changed since analysis. Analyze it again before requesting evidence.');
    const lines = capture.text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
    if (startLine > lines.length) throw new Error('Start line is beyond the end of this capture.');
    const selected = lines.slice(startLine - 1, endLine).map((text, index) => ({ line: startLine + index, text }));
    if (JSON.stringify(selected).length > 24000) throw new Error('Selected evidence is too long. Request a smaller line range.');
    return { source: sourceInfo(capture), totalLines: lines.length, lines: selected };
}
