import { isVsCode, loadDroppedUris, showHostError } from './host/platform.js';

const uriTypes = ['application/vnd.code.uri-list', 'resourceurls', 'text/uri-list'];
const maxBytes = 64 * 1024 * 1024;
const typesOf = transfer => Array.from(transfer?.types || [], type => type.toLowerCase());

// Explorer/editor drags carry URIs, not browser File objects. Prefer VS Code's
// full list: text/uri-list can contain only the first file in a multi-selection.
export function droppedUris(transfer) {
    const types = typesOf(transfer);
    for (const type of uriTypes) {
        if (!types.includes(type)) continue;
        const value = transfer.getData(type);
        if (value.length > 512 * 1024) throw new Error('The dropped file list is too large.');
        const uris = type === 'resourceurls' ? JSON.parse(value) : value.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
        if (!Array.isArray(uris) || uris.some(uri => typeof uri !== 'string')) throw new Error('Invalid dropped file references.');
        if (uris.length) return uris;
    }
    return [];
}

export function bindCaptureDrop(onFiles, { onActive = () => {}, onError = showHostError } = {}) {
    let depth = 0;
    const accepts = transfer => typesOf(transfer).some(type => type === 'files' || (isVsCode() && uriTypes.includes(type)));
    const reset = () => { depth = 0; onActive(false); };
    // Capture across the entire document, including headers and chart surfaces.
    // Stop propagation before VS Code's outer iframe forwards the drag to the
    // editor-opening overlay. Internal workbench drags still require Shift.
    const claim = event => { event.preventDefault(); event.stopPropagation(); };
    document.addEventListener('dragenter', event => {
        if (!accepts(event.dataTransfer)) return;
        claim(event); depth++; onActive(true);
    }, true);
    document.addEventListener('dragover', event => {
        if (!accepts(event.dataTransfer)) return;
        claim(event); event.dataTransfer.dropEffect = 'copy'; onActive(true);
    }, true);
    document.addEventListener('dragleave', event => {
        if (!depth) return;
        claim(event); depth = Math.max(0, depth - 1);
        if (!depth || !event.relatedTarget) reset();
    }, true);
    document.addEventListener('drop', event => {
        const accepted = accepts(event.dataTransfer);
        reset();
        if (!accepted) return;
        claim(event);
        // DataTransfer becomes protected after this event. Copy it before awaiting.
        try {
            const uris = isVsCode() ? droppedUris(event.dataTransfer) : [];
            const files = Array.from(event.dataTransfer?.files || []);
            if (uris.length) return Promise.resolve(loadDroppedUris(uris)).catch(onError);
            if (!files.length) throw new Error('No readable files were dropped. Use Choose file, or drop onto an analyzer in the JvmScope sidebar.');
            if (files.length > 50) throw new Error('Choose between 1 and 50 capture files.');
            if (files.reduce((size, file) => size + file.size, 0) > maxBytes) throw new Error('Selected captures exceed the 64 MiB import limit.');
            return Promise.resolve(onFiles(files)).catch(onError);
        } catch (error) { onError(error); }
    }, true);
    document.addEventListener('dragend', reset, true);
    window.addEventListener('blur', reset);
}
