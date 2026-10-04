import { existsSync, readFileSync } from 'node:fs';

// Existence is insufficient: PrintWriter creates the file before writing its line.
// Require the terminator too, so a partial decimal prefix cannot be used as a port.
export function readReadyPort(path) {
    if (!existsSync(path)) return null;
    const text = readFileSync(path, 'utf8');
    if (!/^\d+\r?\n$/.test(text)) return null;
    const port = Number(text.trim());
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}
