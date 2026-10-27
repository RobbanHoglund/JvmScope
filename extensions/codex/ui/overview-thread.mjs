const copy = {
    en: { selected: 'Selected thread', observed: 'Main thread · stack observation', state: 'Java state', unknown: 'Not recorded',
        http: 'Parked in CompletableFuture.get inside HttpClient.send at capture time.',
        limits: 'This observation does not establish the wait duration or cause.',
        next: 'Next check: inspect the request timeout and response handling; compare another capture if the wait persists.',
        frame: 'Recorded frame', frameNote: 'Frame selected by package name; may belong to application or library code.',
        neutral: 'Selection is for inspection; it does not add a rule finding.', stack: 'Inspect stack', opening: 'Opening thread…',
        source: 'Source lines', noFrames: 'No stack frames recorded.', noTools: 'Ask for this thread in the conversation to inspect its stack.' },
    sv: { selected: 'Vald tråd', observed: 'Huvudtråd · stackobservation', state: 'Java-tillstånd', unknown: 'Ej registrerat',
        http: 'Parkerad i CompletableFuture.get under HttpClient.send vid fångsttillfället.',
        limits: 'Observationen fastställer inte väntans längd eller orsak.',
        next: 'Nästa kontroll: granska anropets timeout och svarshantering; jämför en ny dump om väntan kvarstår.',
        frame: 'Registrerad stackram', frameNote: 'Ramen väljs utifrån paketnamnet och kan tillhöra applikationen eller ett bibliotek.',
        neutral: 'Tråden är vald för granskning; det tillför inget regelfynd.', stack: 'Granska stack', opening: 'Öppnar tråd…',
        source: 'Källrader', noFrames: 'Inga stackramar registrerade.', noTools: 'Be om denna tråd i konversationen för att granska stacken.' },
};
function el(tag, cls, text) { const n = document.createElement(tag); n.className = cls || ''; if (text != null) n.textContent = text; return n; }
export function overviewThreadView({ focus, locale, canRead, onOpen }) {
    const t = key => copy[locale][key], { thread, reason } = focus, box = el('section', 'overview-thread');
    box.dataset.sourceKey = thread.sourceKey;
    box.append(el('span', 'overview-thread-label', t(reason === 'selected' ? 'selected' : 'observed')));
    const head = el('div', 'overview-thread-head');
    head.append(el('h3', '', thread.name), el('span', 'thread-state', `${t('state')}: ${thread.state || t('unknown')}`)); box.append(head);
    if (thread.stackContext?.observation === 'jdk-http-send-wait') {
        box.append(el('p', 'thread-observation', t('http')), el('p', 'muted', t('limits')));
    } else box.append(el('p', 'muted', t('neutral')));
    const frame = thread.stackContext?.frame || thread.topFrame;
    if (frame) {
        const line = el('p', 'overview-frame'); line.title = t('frameNote');
        line.append(el('span', 'muted', `${t('frame')}: `), el('code', '', frame)); box.append(line);
    } else box.append(el('p', 'muted', t('noFrames')));
    if (thread.stackContext?.observation === 'jdk-http-send-wait') box.append(el('p', 'overview-next', t('next')));
    const open = el('button', '', t('stack')); open.type = 'button'; open.disabled = !canRead;
    const actions = el('div', 'overview-thread-actions'); actions.append(open);
    if (thread.range) actions.append(el('span', 'muted', `${t('source')} ${thread.range.startLine}–${thread.range.endLine}`));
    open.addEventListener('click', async () => {
        open.disabled = true; open.textContent = t('opening');
        try { await onOpen(thread.sourceKey); }
        catch (e) { box.append(el('p', 'error', e.message)); }
        finally { open.disabled = !canRead; open.textContent = t('stack'); }
    });
    box.append(actions);
    if (!canRead) box.append(el('p', 'muted', t('noTools')));
    return box;
}
