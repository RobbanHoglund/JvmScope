import {
    RAW_DUMP_FILTERS,
    buildRawDumpModel,
    findRawDumpMatches,
    filterRawDumpThreadBlocks,
} from './raw-dump-model.js';
import { classifyStackTraceLine } from './thread-modal.js';
import { createRawDumpLineRenderer } from './raw-dump-lines.js';

const MAX_RENDERED_MATCHES = 500;

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
    const rawText = String(dump.rawText);
    const sourceLines = rawText.split('\n');
    let model = null;
    const getModel = () => model ||= buildRawDumpModel({ rawText, threads: dump.threads || [] });
    const preferences = loadPreferences(popup.localStorage);
    if (!['annotated', 'exact'].includes(preferences.mode)) preferences.mode = 'annotated';
    if (!Object.hasOwn(RAW_DUMP_FILTERS, preferences.filter)) preferences.filter = 'everything';
    if (preferences.filter === 'selectedLock') preferences.filter = 'everything';
    const state = {
        selectedSourceKey: null,
        selectedLockId: '',
        matches: [],
        matchesByLine: new Map(),
        renderedMatches: new Map(),
        activeMatchIndex: -1,
        expandedSourceKeys: new Set(),
        preferences,
    };
    let visibleBlocks = [];
    let lineRenderer = null;
    const threadViews = new Map();
    let sourceContext = null;
    let populateSourceContext = () => {};
    let printSource = null;

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
    stylesheet.addEventListener('load', () => lineRenderer?.activate());
    head.append(title, viewport, stylesheet);

    const body = element(documentRef, 'body', 'raw-workspace-page');
    const header = element(documentRef, 'header', 'raw-workspace-header');
    const identity = element(documentRef, 'div', 'raw-workspace-identity');
    const identityText = element(documentRef, 'div');
    identityText.append(
        element(documentRef, 'span', 'raw-workspace-kicker', 'Raw dump evidence'),
        element(documentRef, 'h1', '', dump.timestamp || `Snapshot ${snapshotIndex + 1}`),
        element(documentRef, 'p', 'raw-workspace-meta', `Snapshot ${snapshotIndex + 1} of ${snapshotCount} · ${(dump.threads || []).length} threads · ${sourceLines.length} lines${dump.sourceLabel ? ` · Source: ${dump.sourceLabel}` : ''}`),
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
    searchInput.maxLength = 512;
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
            lineRenderer?.resetHeights();
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

    function removeMatches(container) {
        for (const mark of container.querySelectorAll('.raw-workspace-match')) {
            state.renderedMatches.delete(Number(mark.dataset.matchIndex));
        }
    }

    function paintLineContent(content, text, lineNumber) {
        removeMatches(content);
        const indices = state.matchesByLine.get(lineNumber) || [];
        const available = Math.max(0, MAX_RENDERED_MATCHES - state.renderedMatches.size);
        const selected = indices.slice(0, available);
        if (state.matches[state.activeMatchIndex]?.lineNumber === lineNumber && !selected.includes(state.activeMatchIndex)) {
            selected.push(state.activeMatchIndex);
            selected.sort((a, b) => a - b);
        }
        if (!selected.length) { content.textContent = text || ' '; return; }
        content.replaceChildren();
        let cursor = 0;
        for (const index of selected) {
            const match = state.matches[index];
            content.append(text.slice(cursor, match.start));
            const mark = element(documentRef, 'mark', 'raw-workspace-match', text.slice(match.start, match.end));
            mark.dataset.matchIndex = String(index);
            mark.classList.toggle('is-active', index === state.activeMatchIndex);
            content.appendChild(mark);
            state.renderedMatches.set(index, mark);
            cursor = match.end;
        }
        content.append(text.slice(cursor));
    }

    function appendLine(container, text, lineNumber, occurrence = null, decorate = true) {
        const row = element(documentRef, 'div', `raw-workspace-line is-${decorate ? classifyStackTraceLine(text) : 'detail'}`);
        row.dataset.lineNumber = String(lineNumber);
        const number = element(documentRef, 'span', 'raw-workspace-line-number', String(lineNumber));
        const content = element(documentRef, 'span', 'raw-workspace-line-content', text || ' ');
        if (state.matches.length) paintLineContent(content, text, lineNumber);
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
        lineRenderer.append(exact, { startLine: 1, endLine: sourceLines.length, decorate: false });
        evidence.appendChild(exact);
    }

    function renderAnnotated() {
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
            sourceContext = context;
            populateSourceContext = () => {
                if (contextLines.childNodes.length || destroyed) return;
                for (const section of model.rawSections) lineRenderer.append(contextLines, section);
            };
            context.addEventListener('toggle', () => {
                if (!context.isConnected || destroyed) return;
                if (context.open) populateSourceContext();
                else lineRenderer.remove(contextLines);
            });
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
            if (collapsed) lineRenderer.remove(lines);
            else populate();
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
        const populate = () => {
            if (lines.childNodes.length || destroyed) return;
            lineRenderer.append(lines, { startLine: block.startLine, endLine: block.endLine,
                occurrences: new Map(block.occurrences.map(item => [item.lineNumber, item])) });
        };
        threadViews.set(block.sourceKey, { article, populate });
        if (isExpanded) populate();
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
        getModel();
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
        getModel();
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
        const query = searchInput.value;
        const hadHighlights = state.renderedMatches.size > 0;
        const ranges = preferences.mode === 'exact' ? undefined : [
            ...(preferences.filter === 'everything' ? model.rawSections : []),
            ...visibleBlocks.map(block => ({ startLine: block.startLine, endLine: block.endLine, sourceKey: block.sourceKey })),
        ];
        state.matches = findRawDumpMatches(sourceLines, query, ranges);
        state.matchesByLine = new Map();
        state.matches.forEach((match, index) => {
            if (!state.matchesByLine.has(match.lineNumber)) state.matchesByLine.set(match.lineNumber, []);
            state.matchesByLine.get(match.lineNumber).push(index);
        });
        state.activeMatchIndex = -1;
        if (query || hadHighlights) {
            for (const row of evidence.querySelectorAll('.raw-workspace-line')) {
                const lineNumber = Number(row.dataset.lineNumber);
                paintLineContent(row.querySelector('.raw-workspace-line-content'), sourceLines[lineNumber - 1], lineNumber);
            }
        }
        searchGroup.classList.toggle('has-no-results', Boolean(query) && !state.matches.length);
        previousButton.disabled = !state.matches.length;
        nextButton.disabled = !state.matches.length;
        searchCount.textContent = query ? (state.matches.length ? `${state.matches.length} matches` : 'No matches') : 'Type to search';
        if (state.matches.length && navigate) selectMatch(1);
    }

    function selectMatch(offset) {
        if (!state.matches.length) return;
        state.renderedMatches.get(state.activeMatchIndex)?.classList.remove('is-active');
        state.activeMatchIndex = rawDumpMatchIndex(state.activeMatchIndex, state.matches.length, offset);
        const match = state.matches[state.activeMatchIndex];
        if (preferences.mode === 'annotated') {
            const view = threadViews.get(match.sourceKey);
            if (view) {
                view.populate();
                revealRawDumpMatch({ closest: selector => selector === '.raw-workspace-thread-block' ? view.article : null }, state.expandedSourceKeys);
            } else if (sourceContext) {
                sourceContext.open = true;
                populateSourceContext();
            }
        }
        const row = lineRenderer.reveal(match.lineNumber);
        if (row) {
            paintLineContent(row.querySelector('.raw-workspace-line-content'), sourceLines[match.lineNumber - 1], match.lineNumber);
            state.renderedMatches.get(state.activeMatchIndex)?.scrollIntoView({ block: 'center', inline: 'nearest' });
        }
        searchCount.textContent = `${state.activeMatchIndex + 1} / ${state.matches.length}`;
    }

    async function copyRawDump() {
        let copied = false;
        try {
            await popup.navigator.clipboard.writeText(rawText);
            copied = true;
        } catch {}
        if (destroyed || popup.closed) return;
        copyButton.textContent = copied ? 'Copied' : 'Copy failed';
        popup.clearTimeout(copyResetTimer);
        copyResetTimer = popup.setTimeout(() => (copyButton.textContent = 'Copy'), 1000);
    }

    function render() {
        if (destroyed) return;
        const focused = documentRef.activeElement;
        const focusKey = focused?.dataset?.focusKey;
        const sourceKey = focused?.closest('[data-source-key]')?.dataset.sourceKey;
        const scrollPositions = [outline, evidence, inspector].map(node => [node.scrollLeft, node.scrollTop]);
        annotatedButton.classList.toggle('is-active', preferences.mode === 'annotated');
        exactButton.classList.toggle('is-active', preferences.mode === 'exact');
        annotatedButton.setAttribute('aria-pressed', String(preferences.mode === 'annotated'));
        exactButton.setAttribute('aria-pressed', String(preferences.mode === 'exact'));
        applyPreferences();
        lineRenderer?.destroy();
        state.renderedMatches.clear();
        threadViews.clear();
        sourceContext = null;
        populateSourceContext = () => {};
        lineRenderer = createRawDumpLineRenderer({ popup, root: evidence, sourceLines, appendLine, removeMatches,
            ready: Boolean(stylesheet.sheet) });
        evidence.replaceChildren();
        if (preferences.mode === 'exact') {
            renderExact();
            outline.replaceChildren();
            inspector.replaceChildren();
        } else {
            getModel();
            const included = new Set(filterRawDumpThreadBlocks(model, preferences.filter, state.selectedLockId).map(block => block.sourceKey));
            visibleBlocks = model.sortedThreadBlocks.filter(block => included.has(block.sourceKey));
            renderAnnotated();
            renderOutline();
            updateSelection();
        }
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

    // Print from the source instead of materializing decorated rows. Exact mode
    // includes the complete capture; annotated mode retains filters/expansion.
    const onBeforePrint = () => {
        if (destroyed || printSource) return;
        printSource = element(documentRef, 'section', 'raw-workspace-print-source');
        if (preferences.mode === 'exact') {
            printSource.appendChild(element(documentRef, 'pre', '', rawText));
        } else {
            printSource.appendChild(element(documentRef, 'p', '', `${RAW_DUMP_FILTERS[preferences.filter]} · ${visibleBlocks.length} threads`));
            if (sourceContext?.open) printSource.appendChild(element(documentRef, 'pre', '',
                model.rawSections.map(section => section.lines.join('\n')).join('\n')));
            for (const block of visibleBlocks) {
                printSource.appendChild(element(documentRef, 'h2', '', `${block.thread.threadName} · ${block.thread.javaState || 'UNKNOWN'}`));
                if (state.expandedSourceKeys.has(block.sourceKey)) {
                    printSource.appendChild(element(documentRef, 'pre', '', block.lines.join('\n')));
                }
            }
        }
        body.appendChild(printSource);
    };
    const onAfterPrint = () => { printSource?.remove(); printSource = null; };
    popup.addEventListener('beforeprint', onBeforePrint);
    popup.addEventListener('afterprint', onAfterPrint);

    render();
    searchInput.focus();
    return {
        get model() { return getModel(); }, render, selectThread, selectLock,
        focus: () => searchInput.focus({ preventScroll: true }),
        destroy: () => {
            destroyed = true;
            lineRenderer?.destroy();
            state.renderedMatches.clear();
            onAfterPrint();
            if (!popup.closed) popup.clearTimeout(copyResetTimer);
            documentRef.removeEventListener('keydown', onKeyDown);
            documentRef.removeEventListener('click', onOutsideClick);
            popup.removeEventListener('beforeprint', onBeforePrint);
            popup.removeEventListener('afterprint', onAfterPrint);
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
