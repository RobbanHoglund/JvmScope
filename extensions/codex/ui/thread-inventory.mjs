const copy = {
    en: { title: 'Threads in this snapshot', records: 'parsed records', java: 'with Java state', vm: 'header-only VM records',
        search: 'Find a thread', placeholder: 'Thread name or top stack frame', filter: 'Java state', all: 'All states', unknown: 'Not recorded',
        nativeOnly: 'Only header-only VM records were parsed. Java states, Java stacks and application lock dependencies are unavailable in these records.',
        scope: 'RUNNABLE is a Java state, not measured CPU use. A thread can be waiting in a native call.',
        single: 'One snapshot: CPU and allocation rates, wait duration and progress cannot be established. Cumulative counters remain in the source.',
        shown: 'Displayed', matching: 'matching records', retained: 'retained', of: 'of', more: 'Show more threads',
        omitted: 'Records beyond the retained source-order subset are not searched. Inspect the original capture for the remaining records.',
        noMatch: 'No matching records in this retained list.', noFrames: 'No stack frames recorded', open: 'Inspect thread',
        unavailable: 'Thread inventory is unavailable in this older report. Analyze the capture again.',
        opening: 'Opening thread…', host: 'This host cannot open thread details. Ask for the named thread in the conversation.' },
    sv: { title: 'Trådar i denna snapshot', records: 'inlästa poster', java: 'med Java-tillstånd', vm: 'VM-poster med enbart trådhuvud',
        search: 'Sök tråd', placeholder: 'Trådnamn eller översta stackram', filter: 'Java-tillstånd', all: 'Alla tillstånd', unknown: 'Ej registrerat',
        nativeOnly: 'Enbart VM-poster med trådhuvuden lästes in. Java-tillstånd, Java-stackar och applikationens låsberoenden saknas i dessa poster.',
        scope: 'RUNNABLE är ett Java-tillstånd, inte uppmätt CPU-användning. Tråden kan vänta i ett native-anrop.',
        single: 'En snapshot: CPU- och allokeringstakt, väntetid och framsteg kan inte fastställas. Ackumulerade räknare finns i källan.',
        shown: 'Visar', matching: 'matchande poster', retained: 'tillgängliga i listan', of: 'av', more: 'Visa fler trådar',
        omitted: 'Poster utanför det sparade urvalet i källordning ingår inte i sökningen. Granska originaldumpen för övriga poster.',
        noMatch: 'Inga matchande poster i denna sparade lista.', noFrames: 'Inga stackramar registrerade', open: 'Granska tråd',
        unavailable: 'Trådlistan saknas i den äldre rapporten. Analysera dumpen igen.',
        opening: 'Öppnar tråd…', host: 'Klienten kan inte öppna tråddetaljer. Be om den namngivna tråden i konversationen.' },
};
function el(tag, className = '', text) { const n = document.createElement(tag); n.className = className; if (text != null) n.textContent = text; return n; }
const states = ['RUNNABLE', 'BLOCKED', 'WAITING', 'TIMED_WAITING', 'NEW', 'TERMINATED', 'UNKNOWN'];
export function threadInventoryView({ snapshot, snapshotCount, locale, canRead, onOpen }) {
    const t = key => copy[locale][key], section = el('section', 'thread-inventory');
    const summary = snapshot.threadSummary, inventory = snapshot.threadInventory;
    section.append(el('h2', '', t('title')));
    if (!inventory) { section.append(el('p', 'note', t('unavailable'))); return section; }
    section.append(el('p', 'inventory-summary', `${summary.total} ${t('records')} · ${summary.withJavaState} ${t('java')} · ${summary.headerOnlyVmThreads} ${t('vm')}`));
    if (summary.total > 0 && summary.headerOnlyVmThreads === summary.total) section.append(el('p', 'note inventory-native-only', t('nativeOnly')));
    const breakdown = el('ul', 'state-breakdown');
    for (const state of states) {
        const count = snapshot.states[state] || 0;
        if (!count) continue;
        const item = el('li', `state-count state-${state.toLowerCase()}`);
        item.append(el('span', 'state-dot'), el('span', '', state === 'UNKNOWN' ? t('unknown') : state), el('strong', '', count));
        breakdown.append(item);
    }
    section.append(breakdown, el('p', 'muted inventory-note', t('scope')));
    if (snapshotCount === 1) section.append(el('p', 'note inventory-limits', t('single')));
    const controls = el('div', 'inventory-controls'), searchLabel = el('label', '', t('search')), stateLabel = el('label', '', t('filter'));
    const search = el('input'); search.type = 'search'; search.placeholder = t('placeholder'); search.maxLength = 200;
    search.setAttribute('aria-label', t('search')); searchLabel.append(search);
    const filter = el('select'); filter.setAttribute('aria-label', t('filter'));
    for (const state of ['', ...states.filter(s => snapshot.states[s])]) {
        const option = el('option', '', !state ? t('all') : state === 'UNKNOWN' ? t('unknown') : state); option.value = state; filter.append(option);
    }
    stateLabel.append(filter); controls.append(searchLabel, stateLabel); section.append(controls);
    const status = el('p', 'muted inventory-status'); status.setAttribute('aria-live', 'polite');
    const list = el('div', 'inventory-list'), more = el('button', '', t('more')); more.type = 'button';
    let limit = 25;
    function draw() {
        const query = search.value.trim().toLocaleLowerCase();
        const matched = inventory.items.filter(row => (!filter.value || (row.state || 'UNKNOWN') === filter.value)
            && (!query || `${row.name}\n${row.topFrame || ''}`.toLocaleLowerCase().includes(query)));
        const rows = matched.slice(0, limit); list.replaceChildren();
        status.textContent = `${t('shown')} ${rows.length} / ${matched.length} ${t('matching')} · ${inventory.items.length} ${t('retained')} ${t('of')} ${inventory.total}`;
        for (const row of rows) {
            const button = el('button', 'inventory-row'); button.type = 'button'; button.dataset.sourceKey = row.sourceKey;
            button.setAttribute('aria-label', `${t('open')}: ${row.name}`); button.disabled = !canRead;
            const identity = el('span', 'inventory-identity');
            identity.append(el('strong', '', row.name), el('code', 'inventory-frame', row.topFrame || t('noFrames')));
            button.append(identity, el('span', 'thread-state', row.state || t('unknown')), el('span', 'inventory-chevron', '›'));
            button.addEventListener('click', async () => {
                button.disabled = true; const notice = el('p', 'muted', t('opening')); button.after(notice);
                try { await onOpen({ snapshotIndex: snapshot.index, sourceKey: row.sourceKey }); notice.remove(); }
                catch (error) { notice.className = 'error'; notice.textContent = error.message; }
                finally { button.disabled = !canRead; }
            });
            list.append(button);
        }
        if (!rows.length) list.append(el('p', 'muted', t('noMatch')));
        more.hidden = rows.length >= matched.length;
    }
    search.addEventListener('input', () => { limit = 25; draw(); });
    filter.addEventListener('change', () => { limit = 25; draw(); });
    more.addEventListener('click', () => { limit += 25; draw(); });
    section.append(status, list, more);
    if (inventory.items.length < inventory.total) section.append(el('p', 'note inventory-omitted', t('omitted')));
    if (!canRead) section.append(el('p', 'note', t('host')));
    draw(); return section;
}
