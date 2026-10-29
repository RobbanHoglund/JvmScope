const copy = {
    en: { full: 'Full thread block', lines: 'Lines', wrap: 'Wrap lines', expand: 'Expand stack', limit: 'Limit stack height',
        more: 'Next source lines', loading: 'Checking source…', source: 'Original stack for' },
    sv: { full: 'Hela trådblocket', lines: 'Rader', wrap: 'Radbrytning', expand: 'Utöka stacken', limit: 'Begränsa stackhöjden',
        more: 'Nästa källrader', loading: 'Kontrollerar källa…', source: 'Originalstack för' },
};
function el(tag, cls, text) { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; }
export function stackSource({ thread, locale, canRead, onNext, state = {} }) {
    const t = key => copy[locale][key], full = el('details', 'thread-stack');
    full.open = state.open ?? true; full.addEventListener('toggle', () => { state.open = full.open; });
    full.append(el('summary', '', `${t('full')} · ${t('lines')} ${thread.context.range.startLine}–${thread.context.range.endLine}`));
    const controls = el('div', 'stack-controls'), pre = el('pre', 'evidence');
    pre.tabIndex = 0; pre.setAttribute('role', 'region'); pre.setAttribute('aria-label', `${t('source')} ${thread.name}`);
    const paint = () => { pre.textContent = thread.lines.map(l => `${l.line}  ${l.text}`).join('\n'); };
    const wrap = el('button', '', t('wrap')), height = el('button', '', t('expand'));
    wrap.type = height.type = 'button';
    pre.classList.toggle('source-nowrap', state.wrap === false); pre.classList.toggle('source-expanded', !!state.expanded);
    wrap.setAttribute('aria-pressed', String(state.wrap !== false)); height.setAttribute('aria-pressed', String(!!state.expanded));
    height.textContent = t(state.expanded ? 'limit' : 'expand');
    wrap.addEventListener('click', () => {
        const unwrapped = pre.classList.toggle('source-nowrap'); state.wrap = !unwrapped; wrap.setAttribute('aria-pressed', String(!unwrapped));
    });
    height.addEventListener('click', () => {
        const expanded = pre.classList.toggle('source-expanded');
        state.expanded = expanded;
        height.setAttribute('aria-pressed', String(expanded)); height.textContent = t(expanded ? 'limit' : 'expand');
    });
    controls.append(wrap, height); full.append(controls, pre); paint();
    if (thread.nextLine) {
        const more = el('button', 'source-next', t('more')); more.type = 'button'; more.disabled = !canRead;
        more.addEventListener('click', async () => {
            more.disabled = true; more.textContent = t('loading');
            try {
                const result = await onNext(thread);
                thread.lines.push(...result.lines); thread.nextLine = result.nextLine; paint();
                if (!thread.nextLine) more.remove();
            } catch (error) { full.append(el('p', 'error', error.message)); }
            finally { more.disabled = !canRead; more.textContent = t('more'); }
        }); full.append(more);
    }
    return full;
}
