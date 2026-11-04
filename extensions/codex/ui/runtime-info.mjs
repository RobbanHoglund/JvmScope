import { runtimeInfoMarkup } from '../../../frontend/assets/javautils/tda/runtime-info.js';

export function runtimeInfoView(info, locale) {
    const box = document.createElement('div');
    // Shared renderer escapes every value recorded in the capture.
    box.innerHTML = runtimeInfoMarkup(info, locale);
    return box;
}
