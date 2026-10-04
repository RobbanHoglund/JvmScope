import {
    RAW_DUMP_FILTERS,
    buildRawDumpModel,
    filterRawDumpThreadBlocks,
    sortRawDumpThreadBlocks,
} from './raw-dump-model.js';
import { classifyStackTraceLine } from './thread-modal.js';

const PREFERENCE_KEY = 'tda.rawDumpWorkspace.v1';
const DEFAULT_PREFERENCES = Object.freeze({
    mode: 'annotated',
    filter: 'everything',
    wrap: false,
    lineNumbers: true,
    annotations: true,
    outline: true,
    inspector: true,
});

function element(documentRef, tagName, className = '', text = '') {
    const node = documentRef.createElement(tagName);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function button(documentRef, label, title, onClick, className = 'raw-workspace-button') {
    const node = element(documentRef, 'button', className, label);
    node.type = 'button';
    node.title = title;
    node.setAttribute('aria-label', title);
    node.dataset.focusKey = title;
    node.addEventListener('click', onClick);
    return node;
}

function loadPreferences(storage) {
    try {
        return { ...DEFAULT_PREFERENCES, ...JSON.parse(storage?.getItem(PREFERENCE_KEY) || '{}') };
    } catch {
        return { ...DEFAULT_PREFERENCES };
    }
}

function savePreferences(storage, preferences) {
    try {
        storage?.setItem(PREFERENCE_KEY, JSON.stringify(preferences));
    } catch {}
}

function stateClass(state) {
    return String(state || 'UNKNOWN').toLocaleLowerCase().replaceAll('_', '-');
}

function lockDisplay(lock) {
    return lock.lockType ? `${lock.lockId} · ${lock.lockType}` : lock.lockId;
}

export function createRawDumpWorkspace({
    popup,
    dump,
    snapshotIndex = 0,
    snapshotCount = 1,
    stylesheetUrl,
    onClose = () => popup.close(),
    onOpenThread = () => {},
    onRevealThread = () => false,
    onRevealLock = () => false,
} = {}) {
    if (!popup?.document || !dump?.rawText) return null;
    let destroyed = false;
    let copyResetTimer = null;
    const documentRef = popup.document;
    const model = buildRawDumpModel({ rawText: dump.rawText, threads: dump.threads || [] });
    const preferences = loadPreferences(popup.localStorage);
    if (!['annotated', 'exact'].includes(preferences.mode)) preferences.mode = 'annotated';
    if (!Object.hasOwn(RAW_DUMP_FILTERS, preferences.filter)) preferences.filter = 'everything';
    if (preferences.filter === 'selectedLock') preferences.filter = 'everything';
    const state = {
        selectedSourceKey: null,
        selectedLockId: '',
        matches: [],
        activeMatchIndex: -1,
        expandedSourceKeys: new Set(model.threadBlocks.filter((block) => block.initiallyExpanded).map((block) => block.sourceKey)),
        preferences,
    };

    // Only a constant doctype enters the HTML parser; dump contents are always
    // inserted through textContent. A blank tab otherwise starts in quirks mode.
    documentRef.open();
    documentRef.write('<!doctype html>');
    documentRef.close();
    documentRef.replaceChildren();
    const html = element(documentRef, 'html');
    html.lang = 'en';
    const head = element(documentRef, 'head');
    const title = element(documentRef, 'title', '', `Raw dump evidence - Snapshot ${snapshotIndex + 1}`);
    const viewport = element(documentRef, 'meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width,initial-scale=1';
    const stylesheet = element(documentRef, 'link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = stylesheetUrl;
    head.append(title, viewport, stylesheet);

    const body = element(documentRef, 'body', 'raw-workspace-page');
    const header = element(documentRef, 'header', 'raw-workspace-header');
    const identity = element(documentRef, 'div', 'raw-workspace-identity');
    const identityText = element(documentRef, 'div');
    identityText.append(
        element(documentRef, 'span', 'raw-workspace-kicker', 'Raw dump evidence'),
        element(documentRef, 'h1', '', dump.timestamp || `Snapshot ${snapshotIndex + 1}`),
        element(documentRef, 'p', 'raw-workspace-meta', `Snapshot ${snapshotIndex + 1} of ${snapshotCount} · ${model.counts.all} threads · ${model.sourceLines.length} lines${dump.sourceLabel ? ` · Source: ${dump.sourceLabel}` : ''}`),
    );
    const modeControl = element(documentRef, 'div', 'raw-workspace-segmented');
    modeControl.setAttribute('role', 'group');
    modeControl.setAttribute('aria-label', 'Evidence display');
    const annotatedButton = button(documentRef, 'Annotated', 'Show structured evidence', () => setMode('annotated'), 'raw-workspace-mode');
    const exactButton = button(documentRef, 'Exact', 'Show the canonical raw dump', () => setMode('exact'), 'raw-workspace-mode');

    modeControl.append(annotatedButton, exactButton);
    identity.append(identityText, modeControl);

    const toolbar = element(documentRef, 'div', 'raw-workspace-toolbar');
    const searchGroup = element(documentRef, 'div', 'raw-workspace-search');
    const searchInput = element(documentRef, 'input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search visible evidence';
    searchInput.autocomplete = 'off';
    searchInput.spellcheck = false;
    searchInput.setAttribute('aria-label', 'Search raw dump evidence');
    const searchCount = element(documentRef, 'span', 'raw-workspace-search-count', 'Type to search');
    searchGroup.append(searchInput, searchCount);
    const previousButton = button(documentRef, '↑', 'Previous search match', () => selectMatch(-1));
    const nextButton = button(documentRef, '↓', 'Next search match', () => selectMatch(1));
    const displayButton = button(documentRef, 'Display', 'Display settings', () => setDisplayMenu(displayMenu.hidden));
    const copyButton = button(documentRef, 'Copy', 'Copy complete canonical raw dump', copyRawDump);
    const printButton = button(documentRef, 'Print', 'Print raw dump evidence', () => popup.print());
    const closeButton = button(documentRef, 'Close', 'Close raw dump evidence workspace', onClose);
    toolbar.append(searchGroup, previousButton, nextButton, displayButton, copyButton, printButton, closeButton);

    const displayMenu = element(documentRef, 'div', 'raw-workspace-display-menu');
    displayMenu.hidden = true;
    displayMenu.id = 'rawDisplaySettings';
    displayButton.setAttribute('aria-controls', displayMenu.id);
    displayButton.setAttribute('aria-expanded', 'false');
    displayMenu.append(
        checkbox('wrap', 'Wrap long lines'),
        checkbox('lineNumbers', 'Show line numbers'),
        checkbox('annotations', 'Show evidence labels'),
        checkbox('outline', 'Show outline'),
        checkbox('inspector', 'Show inspector'),
    );
    const actionStatus = element(documentRef, 'div', 'raw-workspace-action-status');
    actionStatus.setAttribute('role', 'status');
    header.append(identity, toolbar, displayMenu, actionStatus);

    const layout = element(documentRef, 'div', 'raw-workspace-layout');
    const outline = element(documentRef, 'aside', 'raw-workspace-outline');
    const evidence = element(documentRef, 'main', 'raw-workspace-evidence');
    const inspector = element(documentRef, 'aside', 'raw-workspace-inspector');
    layout.append(outline, evidence, inspector);
    body.append(header, layout);
    html.append(head, body);
    documentRef.append(documentRef.implementation.createDocumentType('html', '', ''), html);

    function revealInGraph(reveal, value, sourceElement) {
        const shown = reveal(value, sourceElement);
        actionStatus.textContent = shown ? '' : 'No matching node is available in this snapshot’s dependency graph.';
    }

    function setDisplayMenu(open) {
        displayMenu.hidden = !open;
        displayButton.setAttribute('aria-expanded', String(open));
    }

    function checkbox(key, label) {
        const wrapper = element(documentRef, 'label', 'raw-workspace-checkbox');
        const input = element(documentRef, 'input');
        input.type = 'checkbox';
        input.checked = Boolean(preferences[key]);
        input.addEventListener('change', () => {
            preferences[key] = input.checked;
            applyPreferences();
            render();
        });
        wrapper.append(input, element(documentRef, 'span', '', label));
        return wrapper;
    }

    function setMode(mode) {
        preferences.mode = mode;
        state.activeMatchIndex = -1;
        savePreferences(popup.localStorage, preferences);
        render();
    }

    function applyPreferences() {
        body.classList.toggle('is-wrapped', preferences.wrap);
        body.classList.toggle('hide-line-numbers', !preferences.lineNumbers);
        body.classList.toggle('hide-annotations', !preferences.annotations);
        body.classList.toggle('hide-outline', !preferences.outline || preferences.mode === 'exact');
        body.classList.toggle('hide-inspector', !preferences.inspector || preferences.mode === 'exact');
        savePreferences(popup.localStorage, preferences);
    }

    function renderOutline() {
        outline.replaceChildren();
        outline.append(element(documentRef, 'h2', '', 'Evidence outline'));
        const counts = element(documentRef, 'div', 'raw-workspace-counts');
        const countItems = [
            ['Threads', model.counts.all],
            ['Problems', model.counts.problems],
            ['Deadlocks', model.counts.deadlocks],
            ['Class init waits', model.counts.classInitializationWaiters],
            ['Unresolved', model.counts.unresolved],
        ];
        for (const [label, value] of countItems) {
            const item = element(documentRef, 'div', 'raw-workspace-count');
            item.append(element(documentRef, 'strong', '', String(value)), element(documentRef, 'span', '', label));
            counts.appendChild(item);
        }
        outline.appendChild(counts);

        const filterHeading = element(documentRef, 'h3', '', 'Thread filters');
        const filterList = element(documentRef, 'div', 'raw-workspace-filter-list');
        for (const [filterId, label] of Object.entries(RAW_DUMP_FILTERS)) {
            if (filterId === 'selectedLock' && !state.selectedLockId) continue;
            const filterButton = button(documentRef, label, `Filter: ${label}`, () => {
                preferences.filter = filterId;
                savePreferences(popup.localStorage, preferences);
                render();
            }, 'raw-workspace-filter');
            filterButton.classList.toggle('is-active', preferences.filter === filterId);
            filterButton.setAttribute('aria-pressed', String(preferences.filter === filterId));
            filterList.appendChild(filterButton);
        }
        const expansionControls = element(documentRef, 'div', 'raw-workspace-expansion-controls');
        expansionControls.append(
            button(documentRef, 'Expand all', 'Expand all visible thread blocks', () => {
                const blocks = filterRawDumpThreadBlocks(model, preferences.filter, state.selectedLockId);
                blocks.forEach((block) => state.expandedSourceKeys.add(block.sourceKey));
                render();
            }),
            button(documentRef, 'Collapse all', 'Collapse all visible thread blocks', () => {
                const blocks = filterRawDumpThreadBlocks(model, preferences.filter, state.selectedLockId);
                blocks.forEach((block) => state.expandedSourceKeys.delete(block.sourceKey));
                render();
            }),
        );
        outline.append(filterHeading, filterList, element(documentRef, 'h3', '', 'Threads'), expansionControls);

        const visibleBlocks = sortRawDumpThreadBlocks(filterRawDumpThreadBlocks(model, preferences.filter, state.selectedLockId));
        const threadList = element(documentRef, 'div', 'raw-workspace-thread-list');
        for (const block of visibleBlocks) {
            const item = button(documentRef, '', `Go to ${block.thread.threadName}`, () => selectThread(block.sourceKey), 'raw-workspace-thread-link');
            item.dataset.sourceKey = block.sourceKey;
            item.classList.toggle('is-active', state.selectedSourceKey === block.sourceKey);
            item.append(
                element(documentRef, 'span', `raw-workspace-state-dot is-${stateClass(block.thread.javaState)}`),
                element(documentRef, 'span', 'raw-workspace-thread-link-name', block.thread.threadName || 'Unnamed thread'),
                element(documentRef, 'span', 'raw-workspace-thread-link-state', block.thread.javaState || 'UNKNOWN'),
            );
            threadList.appendChild(item);
        }
        outline.appendChild(threadList);
    }

    function appendLine(container, text, lineNumber, occurrence = null) {
        const row = element(documentRef, 'div', `raw-workspace-line is-${classifyStackTraceLine(text)}`);
        row.dataset.lineNumber = String(lineNumber);
        const number = element(documentRef, 'span', 'raw-workspace-line-number', String(lineNumber));
        const content = element(documentRef, 'span', 'raw-workspace-line-content', text || ' ');
        row.append(number, content);
        if (occurrence) {
            const isClassInitialization = occurrence.kind === 'class-initialization-wait';
            const title = isClassInitialization
                ? `Class initialization wait for ${occurrence.className}`
                : `Inspect ${occurrence.lockId}`;
            const onClick = isClassInitialization
                ? () => selectThread(occurrence.sourceKey)
                : () => selectLock(occurrence.lockId);
            const tag = button(documentRef, occurrence.label, title, onClick, `raw-workspace-evidence-tag is-${occurrence.kind}`);
            if (occurrence.normalizedLockId) tag.dataset.lockId = occurrence.normalizedLockId;
            if (occurrence.className) tag.dataset.className = occurrence.className;
            row.appendChild(tag);
        }
        container.appendChild(row);
        return row;
    }

    function renderExact() {
        const exact = element(documentRef, 'section', 'raw-workspace-exact');
        model.sourceLines.forEach((line, index) => appendLine(exact, line, index + 1));
        evidence.appendChild(exact);
    }

    function renderAnnotated() {
        const visibleBlocks = sortRawDumpThreadBlocks(filterRawDumpThreadBlocks(model, preferences.filter, state.selectedLockId));
        const summary = element(documentRef, 'div', 'raw-workspace-results-summary');
        summary.append(
            element(documentRef, 'strong', '', RAW_DUMP_FILTERS[preferences.filter] || RAW_DUMP_FILTERS.everything),
            element(documentRef, 'span', '', `${visibleBlocks.length} of ${model.threadBlocks.length} threads`),
        );
        evidence.appendChild(summary);
        if (preferences.filter === 'everything' && model.rawSections.length) {
            const context = element(documentRef, 'details', 'raw-workspace-source-context');
            const contextSummary = element(documentRef, 'summary', '', `Source context · ${model.rawSections.reduce((total, section) => total + section.lines.length, 0)} lines`);
            const contextLines = element(documentRef, 'div', 'raw-workspace-thread-lines');
            for (const section of model.rawSections) {
                section.lines.forEach((line, index) => appendLine(contextLines, line, section.startLine + index));
            }
            context.append(contextSummary, contextLines);
            evidence.appendChild(context);
        }
        if (!visibleBlocks.length) {
            evidence.appendChild(element(documentRef, 'div', 'raw-workspace-empty', 'No thread evidence matches this filter.'));
            return;
        }
        for (const block of visibleBlocks) evidence.appendChild(renderThreadBlock(block));
    }

    function renderThreadBlock(block) {
        const article = element(documentRef, 'article', 'raw-workspace-thread-block');
        article.dataset.sourceKey = block.sourceKey;
        article.classList.toggle('is-selected', state.selectedSourceKey === block.sourceKey);
        article.classList.toggle('is-problem', block.problem);
        const headerRow = element(documentRef, 'header', 'raw-workspace-thread-header');
        const isExpanded = state.expandedSourceKeys.has(block.sourceKey);
        const disclosure = button(documentRef, isExpanded ? '−' : '+', `${isExpanded ? 'Collapse' : 'Expand'} ${block.thread.threadName}`, () => {
            const collapsed = article.classList.toggle('is-collapsed');
            disclosure.textContent = collapsed ? '+' : '−';
            disclosure.setAttribute('aria-expanded', String(!collapsed));
            disclosure.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${block.thread.threadName}`);
            if (collapsed) state.expandedSourceKeys.delete(block.sourceKey);
            else state.expandedSourceKeys.add(block.sourceKey);
        }, 'raw-workspace-disclosure');
        disclosure.setAttribute('aria-expanded', String(isExpanded));
        const titleGroup = element(documentRef, 'div', 'raw-workspace-thread-title');
        titleGroup.append(
            element(documentRef, 'h2', '', block.thread.threadName || 'Unnamed thread'),
            element(documentRef, 'span', `raw-workspace-state is-${stateClass(block.thread.javaState)}`, block.thread.javaState || 'UNKNOWN'),
        );
        const roles = element(documentRef, 'div', 'raw-workspace-role-list');
        if (block.confirmedDeadlock) roles.appendChild(element(documentRef, 'span', 'raw-workspace-role is-deadlock', 'CONFIRMED DEADLOCK'));
        if (block.classInitializationInitializer) roles.appendChild(element(
            documentRef,
            'span',
            'raw-workspace-role is-class-initializer',
            `CLASS INITIALIZER · ${block.classInitializationBlockedWaiterCount} WAITER${block.classInitializationBlockedWaiterCount === 1 ? '' : 'S'}`,
        ));
        if (block.classInitializationWaits.length) roles.appendChild(element(
            documentRef,
            'span',
            'raw-workspace-role is-class-initialization-wait',
            'CLASS INIT WAIT',
        ));
        if (block.contendedWaits.length) roles.appendChild(element(documentRef, 'span', 'raw-workspace-role is-waiter', `${block.contendedWaits.length} CONTENDED WAIT`));
        if (block.blockedWaiterCount) roles.appendChild(element(documentRef, 'span', 'raw-workspace-role is-holder', `${block.blockedWaiterCount} BLOCKED WAITER`));
        if (block.holdingAndWaiting) roles.appendChild(element(documentRef, 'span', 'raw-workspace-role is-bridge', 'HOLDING + WAITING'));
        if (block.unresolvedWaits.length) roles.appendChild(element(documentRef, 'span', 'raw-workspace-role is-unresolved', 'OWNER NOT OBSERVED'));
        const actions = element(documentRef, 'div', 'raw-workspace-thread-actions');
        actions.append(
            button(documentRef, 'Details', `Open details for ${block.thread.threadName}`, (event) => onOpenThread(block.thread, event.currentTarget)),
            button(documentRef, 'Graph', `Reveal ${block.thread.threadName} in dependency graph`, (event) => revealInGraph(onRevealThread, block.thread, event.currentTarget)),
        );
        headerRow.append(disclosure, titleGroup, roles, actions);
        const lines = element(documentRef, 'div', 'raw-workspace-thread-lines');
        const occurrenceByLine = new Map(block.occurrences.map((item) => [item.lineNumber, item]));
        block.lines.forEach((line, index) => appendLine(lines, line, block.startLine + index, occurrenceByLine.get(block.startLine + index)));
        article.append(headerRow, lines);
        if (!isExpanded) article.classList.add('is-collapsed');
        // Only the header selects the inspector; stack text must remain copyable.
        headerRow.addEventListener('click', (event) => {
            if (event.target.closest('button') || documentRef.getSelection()?.toString()) return;
            state.selectedSourceKey = block.sourceKey;
            state.selectedLockId = '';
            updateSelection();
        });
        return article;
    }

    function updateSelection() {
        body.classList.toggle('has-inspected-target', Boolean(state.selectedSourceKey || state.selectedLockId));
        for (const node of evidence.querySelectorAll('.raw-workspace-thread-block')) {
            node.classList.toggle('is-selected', node.dataset.sourceKey === state.selectedSourceKey);
        }
        for (const node of outline.querySelectorAll('.raw-workspace-thread-link')) {
            node.classList.toggle('is-active', node.dataset.sourceKey === state.selectedSourceKey);
        }
        renderInspector();
    }

    function selectThread(sourceKey) {
        state.selectedSourceKey = sourceKey;
        state.selectedLockId = '';
        if (!filterRawDumpThreadBlocks(model, preferences.filter, state.selectedLockId).some(block => block.sourceKey === sourceKey)) {
            preferences.filter = 'everything';
            render();
        } else {
            updateSelection();
        }
        evidence.querySelector(`[data-source-key="${CSS.escape(sourceKey)}"]`)?.scrollIntoView({ block: 'nearest' });
    }

    function selectLock(lockId) {
        state.selectedLockId = lockId;
        state.selectedSourceKey = null;
        updateSelection();
    }

    function renderInspector() {
        inspector.replaceChildren();
        inspector.appendChild(element(documentRef, 'h2', '', 'Inspector'));
        if (state.selectedLockId) {
            renderLockInspector(model.lockIndex.get(String(state.selectedLockId).toLocaleLowerCase()));
            return;
        }
        const block = model.blockBySourceKey.get(state.selectedSourceKey);
        if (block) {
            renderThreadInspector(block);
            return;
        }
        inspector.appendChild(element(documentRef, 'p', 'raw-workspace-inspector-empty', 'Select a thread block or evidence label to inspect its relationships.'));
    }

    function renderThreadInspector(block) {
        inspector.append(
            element(documentRef, 'span', 'raw-workspace-inspector-kicker', 'Thread'),
            element(documentRef, 'h3', '', block.thread.threadName || 'Unnamed thread'),
        );
        appendFact('State', block.thread.javaState || 'UNKNOWN');
        appendFact('Source', `Lines ${block.startLine}–${block.endLine}`);
        appendFact('Held resources', String(block.heldResources.length));
        appendFact('Contended waits', String(block.contendedWaits.length));
        appendFact('Blocked waiters', String(block.blockedWaiterCount));
        appendFact('Class init waits', String(block.classInitializationWaits.length));
        appendFact('Class init blocked waiters', String(block.classInitializationBlockedWaiterCount));
        const actions = element(documentRef, 'div', 'raw-workspace-inspector-actions');
        actions.append(
            button(documentRef, 'Open details', 'Open full thread details', (event) => onOpenThread(block.thread, event.currentTarget)),
            button(documentRef, 'Reveal in graph', 'Reveal thread dependency neighborhood', (event) => revealInGraph(onRevealThread, block.thread, event.currentTarget)),
        );
        inspector.appendChild(actions);
        appendLockGroup('Holding', block.heldResources);
        appendLockGroup('Waiting', block.contendedWaits);
        appendLockGroup('Notification waits', block.notificationWaits);
        if (block.classInitializationRelations.length) {
            inspector.appendChild(element(documentRef, 'h4', '', 'Class initialization'));
            for (const relation of block.classInitializationRelations) {
                const chain = relation.chain || {};
                inspector.appendChild(element(
                    documentRef,
                    'div',
                    'raw-workspace-related-item',
                    `${relation.role}: ${chain.className || 'Unknown class'} · ${chain.status || 'unknown'}`,
                ));
            }
        }
    }

    function renderLockInspector(lock) {
        if (!lock) return;
        inspector.append(
            element(documentRef, 'span', 'raw-workspace-inspector-kicker', `${lock.resourceCategory} resource`),
            element(documentRef, 'h3', 'raw-workspace-lock-title', lock.lockId),
            element(documentRef, 'p', 'raw-workspace-lock-type', lock.lockType || 'Unknown lock type'),
        );
        appendFact('Observed owners', String(lock.owners.length));
        appendFact('Contended waiters', String(lock.contendedWaiters.length));
        appendFact('Notification waiters', String(lock.notificationWaiters.length));
        appendFact('Resolution', lock.unresolved ? 'Owner not observed' : 'Resolved or notification-only');
        const actions = element(documentRef, 'div', 'raw-workspace-inspector-actions');
        actions.append(
            button(documentRef, 'Filter neighborhood', 'Show threads related to this lock', () => {
                preferences.filter = 'selectedLock';
                render();
            }),
            button(documentRef, 'Reveal in graph', 'Reveal lock dependency neighborhood', (event) => revealInGraph(onRevealLock, lock.lockId, event.currentTarget)),
        );
        inspector.appendChild(actions);
        appendThreadGroup('Owners', lock.owners);
        appendThreadGroup('Contended waiters', lock.contendedWaiters);
        appendThreadGroup('Notification waiters', lock.notificationWaiters);
    }

    function appendFact(label, value) {
        const fact = element(documentRef, 'div', 'raw-workspace-fact');
        fact.append(element(documentRef, 'span', '', label), element(documentRef, 'strong', '', value));
        inspector.appendChild(fact);
    }

    function appendLockGroup(label, occurrences) {
        if (!occurrences.length) return;
        inspector.appendChild(element(documentRef, 'h4', '', label));
        for (const occurrence of occurrences) {
            inspector.appendChild(button(documentRef, lockDisplay(occurrence), `Inspect ${occurrence.lockId}`, () => selectLock(occurrence.lockId), 'raw-workspace-related-item'));
        }
    }

    function appendThreadGroup(label, threads) {
        if (!threads.length) return;
        inspector.appendChild(element(documentRef, 'h4', '', label));
        for (const thread of threads) {
            inspector.appendChild(button(documentRef, thread.threadName || 'Unnamed thread', `Inspect ${thread.threadName}`, () => selectThread(thread.sourceKey), 'raw-workspace-related-item'));
        }
    }

    function updateSearch({ navigate = true } = {}) {
        const query = searchInput.value.toLocaleLowerCase();
        state.matches = [];
        state.activeMatchIndex = -1;
        for (const content of evidence.querySelectorAll('.raw-workspace-line-content')) {
            const line = content.textContent;
            content.replaceChildren();
            if (!query) {
                content.textContent = line;
                continue;
            }
            const normalizedLine = line.toLocaleLowerCase();
            let cursor = 0;
            let index = normalizedLine.indexOf(query);
            while (index >= 0) {
                content.append(line.slice(cursor, index));
                const mark = element(documentRef, 'mark', 'raw-workspace-match', line.slice(index, index + query.length));
                content.appendChild(mark);
                state.matches.push(mark);
                cursor = index + query.length;
                index = normalizedLine.indexOf(query, cursor);
            }
            content.append(line.slice(cursor));
        }
        searchGroup.classList.toggle('has-no-results', Boolean(query) && !state.matches.length);
        previousButton.disabled = !state.matches.length;
        nextButton.disabled = !state.matches.length;
        searchCount.textContent = query ? (state.matches.length ? `${state.matches.length} matches` : 'No matches') : 'Type to search';
        if (state.matches.length && navigate) selectMatch(1);
    }

    function selectMatch(offset) {
        if (!state.matches.length) return;
        state.matches[state.activeMatchIndex]?.classList.remove('is-active');
        state.activeMatchIndex = rawDumpMatchIndex(state.activeMatchIndex, state.matches.length, offset);
        const active = state.matches[state.activeMatchIndex];
        active.classList.add('is-active');
        revealRawDumpMatch(active, state.expandedSourceKeys);
        active.scrollIntoView({ block: 'center', inline: 'nearest' });
        searchCount.textContent = `${state.activeMatchIndex + 1} / ${state.matches.length}`;
    }

    async function copyRawDump() {
        let copied = false;
        try {
            await popup.navigator.clipboard.writeText(model.rawText);
            copied = true;
        } catch {}
        if (destroyed || popup.closed) return;
        copyButton.textContent = copied ? 'Copied' : 'Copy failed';
        popup.clearTimeout(copyResetTimer);
        copyResetTimer = popup.setTimeout(() => (copyButton.textContent = 'Copy'), 1000);
    }

    function render() {
        const focused = documentRef.activeElement;
        const focusKey = focused?.dataset?.focusKey;
        const sourceKey = focused?.closest('[data-source-key]')?.dataset.sourceKey;
        const scrollPositions = [outline, evidence, inspector].map(node => [node.scrollLeft, node.scrollTop]);
        annotatedButton.classList.toggle('is-active', preferences.mode === 'annotated');
        exactButton.classList.toggle('is-active', preferences.mode === 'exact');
        annotatedButton.setAttribute('aria-pressed', String(preferences.mode === 'annotated'));
        exactButton.setAttribute('aria-pressed', String(preferences.mode === 'exact'));
        applyPreferences();
        evidence.replaceChildren();
        if (preferences.mode === 'exact') renderExact();
        else renderAnnotated();
        renderOutline();
        updateSelection();
        updateSearch({ navigate: false });
        [outline, evidence, inspector].forEach((node, index) => {
            [node.scrollLeft, node.scrollTop] = scrollPositions[index];
        });
        if (focusKey && !focused.isConnected) {
            const candidates = [...body.querySelectorAll('[data-focus-key]')];
            const replacement = candidates.find(node => node.dataset.focusKey === focusKey
                && (!sourceKey || node.closest('[data-source-key]')?.dataset.sourceKey === sourceKey));
            (replacement || searchInput).focus({ preventScroll: true });
        }
    }

    searchInput.addEventListener('input', updateSearch);
    searchInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        selectMatch(event.shiftKey ? -1 : 1);
    });
    const onKeyDown = (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'f') {
            event.preventDefault();
            searchInput.focus();
            searchInput.select();
        } else if (event.key === '/' && documentRef.activeElement !== searchInput) {
            event.preventDefault();
            searchInput.focus();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (!displayMenu.hidden) {
                setDisplayMenu(false);
                displayButton.focus();
            } else if (searchInput.value) {
                searchInput.value = '';
                updateSearch();
            } else {
                onClose();
            }
        }
    };
    documentRef.addEventListener('keydown', onKeyDown);
    const onOutsideClick = (event) => {
        if (!displayMenu.contains(event.target) && !displayButton.contains(event.target)) setDisplayMenu(false);
    };
    documentRef.addEventListener('click', onOutsideClick);

    render();
    searchInput.focus();
    return {
        model, render, selectThread, selectLock,
        focus: () => searchInput.focus({ preventScroll: true }),
        destroy: () => {
            destroyed = true;
            if (!popup.closed) popup.clearTimeout(copyResetTimer);
            documentRef.removeEventListener('keydown', onKeyDown);
            documentRef.removeEventListener('click', onOutsideClick);
        },
    };
}

// Search includes collapsed evidence, so every active match must be made visible.
export function revealRawDumpMatch(match, expandedSourceKeys) {
    const block = match.closest('.raw-workspace-thread-block');
    if (block) {
        block.classList.remove('is-collapsed');
        expandedSourceKeys.add(block.dataset.sourceKey);
        const disclosure = block.querySelector('.raw-workspace-disclosure');
        disclosure.textContent = '−';
        disclosure.setAttribute('aria-expanded', 'true');
        disclosure.setAttribute('aria-label', disclosure.getAttribute('aria-label').replace(/^Expand /, 'Collapse '));
    }
    const context = match.closest('details');
    if (context) context.open = true;
}

export function rawDumpMatchIndex(currentIndex, count, direction) {
    if (!count) return -1;
    if (currentIndex < 0) return direction < 0 ? count - 1 : 0;
    return (currentIndex + direction + count) % count;
}
