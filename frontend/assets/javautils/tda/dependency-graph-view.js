import { buildThreadDependencyGraph } from './dependency-graph.js';
import {
    DEFAULT_DEPENDENCY_GRAPH_OPTIONS,
    projectionDensity,
    selectSmartLabelNodeIds,
} from './dependency-graph-density.js';
import {
    buildContentionVisibility,
    buildThreadLockRoleIndex,
    contentionDensityProfile,
    resourceKindVisible,
    threadMatchesHighlightMode,
} from './dependency-graph-visibility.js';

const EXPORT_STYLES = `
  .hidden{display:none!important}
.dependency-graph-svg.labels-none .dependency-graph-node-label,
.dependency-graph-svg.labels-none .dependency-graph-node-sub-label,
.dependency-graph-svg.zoom-far .dependency-graph-node-label,
.dependency-graph-svg.zoom-far .dependency-graph-node-sub-label,
.dependency-graph-svg.zoom-far .dependency-graph-edge-label {
  display: none;
}

.dependency-graph-svg.labels-smart .dependency-graph-node:not(.is-important):not(.is-selected):not(.is-hovered):not(.is-search-match):not(.is-role-highlight):not(.is-role-context) .dependency-graph-node-label,
.dependency-graph-svg.labels-smart .dependency-graph-node:not(.is-important):not(.is-selected):not(.is-hovered):not(.is-search-match):not(.is-role-highlight):not(.is-role-context) .dependency-graph-node-sub-label {
  opacity: 0;
}

.dependency-graph-svg:not(.show-edge-labels) .dependency-graph-edge-label {
  display: none;
}


  .dependency-graph-lane{fill:rgba(255,255,255,.016);stroke:rgba(133,170,220,.10);stroke-width:1}
  .dependency-graph-lane.is-resource{fill:rgba(156,94,255,.025)}
  .dependency-graph-lane.is-isolated{fill:rgba(111,136,174,.018);stroke-dasharray:5 8}
  .dependency-graph-lane-label{fill:rgba(173,198,232,.36);font:900 11px system-ui;letter-spacing:.17em;text-anchor:middle}
  .dependency-graph-constellation-ring{fill:none;stroke:rgba(111,153,208,.10);stroke-width:1;stroke-dasharray:3 9}
  .dependency-graph-edge{fill:none;stroke-linecap:round;stroke-opacity:.78}
  .dependency-graph-edge-wait,.dependency-graph-edge-park{stroke:#ffad4a;stroke-width:1.8}
  .dependency-graph-edge-class-init-wait{stroke:#ffd15c;stroke-width:2.05}
  .dependency-graph-edge-initialize{stroke:#52d8ff;stroke-width:1.7;stroke-dasharray:5 3}
  .dependency-graph-edge-await{stroke:#a98cff;stroke-width:1.45;stroke-dasharray:3 5}
  .dependency-graph-edge-hold{stroke:#52d8ff;stroke-width:1.55}
  .dependency-graph-edge-dependency{stroke:#61b5ff;stroke-width:2.1}
  .dependency-graph-edge-mount{stroke:#44e2c2;stroke-width:1.4;stroke-dasharray:5 4}
  .dependency-graph-edge.is-confirmed-deadlock{stroke:#df7682;stroke-width:2.4;stroke-opacity:1}
  .dependency-graph-edge.is-observed-cycle:not(.is-confirmed-deadlock){stroke:#ff78dc;stroke-width:2.45}
  .dependency-graph-edge-label{fill:#dbeafe;stroke:#050912;stroke-width:3;paint-order:stroke;font:800 8.5px ui-monospace,monospace;text-anchor:middle}
  .dependency-graph-node-halo{fill:rgba(87,161,255,.08);stroke:rgba(129,184,255,.24);stroke-width:1}
  .dependency-graph-node-core{fill:#4c78b7;stroke:rgba(235,244,255,.82);stroke-width:1.25}
  .dependency-graph-node-thread.state-runnable .dependency-graph-node-core{fill:#325e4e;stroke:#79d6ad}
  .dependency-graph-node-thread.state-blocked .dependency-graph-node-core{fill:#744047;stroke:#f0a6a6}
  .dependency-graph-node-thread.state-waiting .dependency-graph-node-core{fill:#6e6038;stroke:#e8cb80}
  .dependency-graph-node-thread.state-timed-waiting .dependency-graph-node-core{fill:#5c507a;stroke:#bdb0e8}
  .dependency-graph-node-thread.state-new .dependency-graph-node-core{fill:#456885;stroke:#9fc9ed}
  .dependency-graph-node-thread.state-terminated .dependency-graph-node-core,.dependency-graph-node-thread.state-unknown .dependency-graph-node-core{fill:#526176;stroke:#c3cfdf}
  .dependency-graph-node-lock.resource-monitor .dependency-graph-node-core{fill:#c9872d;stroke:#ffe4aa}
  .dependency-graph-node-lock.resource-synchronizer .dependency-graph-node-core{fill:#a04ad1;stroke:#edc3ff}
  .dependency-graph-node-lock.resource-mixed .dependency-graph-node-core{fill:#d45b9b;stroke:#ffd0e9}
  .dependency-graph-node-lock.resource-class-initialization .dependency-graph-node-core{fill:#b97916;stroke:#fff0a8}
  .dependency-graph-node-virtual-thread .dependency-graph-node-core{fill:#199b86;stroke:#a4ffed}
  .dependency-graph-node-symbol{fill:#fff;font:950 8px system-ui;text-anchor:middle;dominant-baseline:central}
  .dependency-graph-node-label{fill:#eef5ff;stroke:#050912;stroke-width:3;paint-order:stroke;font:600 13px system-ui;dominant-baseline:middle}
  .dependency-graph-node-sub-label{fill:#bdd3f0;stroke:#050912;stroke-width:3;paint-order:stroke;font:500 11px system-ui;dominant-baseline:middle}
  .dependency-graph-node-deadlock-ring{fill:none;stroke:#df7682;stroke-width:2.4}
  .dependency-graph-node-cycle-ring{fill:none;stroke:#ff78dc;stroke-width:2.1;stroke-dasharray:3 3}
  .dependency-graph-node-pinned-ring{fill:none;stroke:#4de4c7;stroke-width:2;stroke-dasharray:2 3}
  .dependency-graph-node.is-role-highlight .dependency-graph-node-halo{fill:rgba(255,208,91,.24);stroke:#ffe08a;stroke-width:2.8;filter:drop-shadow(0 0 11px rgba(255,190,62,.72))}
  .dependency-graph-node.is-role-highlight .dependency-graph-node-core{stroke:#fff3c0;stroke-width:2.2}
  .dependency-graph-node.is-role-context .dependency-graph-node-halo{fill:rgba(91,202,255,.14);stroke:rgba(118,215,255,.76);stroke-width:1.8}
  .dependency-graph-edge.is-role-active{stroke-opacity:1;stroke-width:2.7;filter:drop-shadow(0 0 4px rgba(255,199,83,.55))}
  .dependency-graph-node.is-muted,.dependency-graph-edge.is-muted,.dependency-graph-edge-label.is-muted{opacity:.075}
`;

function text(value) {
    return value == null ? '' : String(value).trim();
}

function finiteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function stateClass(value) {
    return `state-${text(value || 'UNKNOWN').toLowerCase().replaceAll('_', '-')}`;
}

function truncate(value, max = 30) {
    const normalized = text(value);
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, Math.max(1, max - 1))}…`;
}

function shortLockId(value) {
    const lockId = text(value);
    if (lockId.length <= 14) return lockId;
    return `${lockId.slice(0, 4)}…${lockId.slice(-8)}`;
}

function compactLockId(value) {
    const lockId = text(value);
    if (lockId.length <= 9) return lockId;
    return `…${lockId.slice(-7)}`;
}

function endpointId(endpoint) {
    return typeof endpoint === 'object' && endpoint ? endpoint.id : endpoint;
}

export function formatLockCount(node, kind = 'held') {
    if (node.lockDataAvailable === false) return '—';
    return String((kind === 'held' ? node.heldLockIds : node.waitingLockIds).length);
}

export function formatCpu(ms) {
    const value = finiteNumber(ms);
    if (value == null) return '—';
    if (value < 1) return `${value.toFixed(2)} ms`;
    if (value < 1000) return `${value.toFixed(1)} ms`;
    return `${(value / 1000).toFixed(2)} s`;
}

export function formatRate(percent) {
    const value = finiteNumber(percent);
    if (value == null) return '—';
    if (value > 0 && value < 0.01) return '<0.01%';
    return `${value.toFixed(2)}%`;
}

export function formatElapsed(seconds) {
    const value = finiteNumber(seconds);
    if (value == null) return '—';
    if (value < 1) return `${(value * 1000).toFixed(0)} ms`;
    if (value < 60) return `${value.toFixed(1)} s`;
    if (value < 3600) return `${Math.floor(value / 60)}m ${(value % 60).toFixed(0)}s`;
    return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
}

export function formatBytes(bytes) {
    const value = finiteNumber(bytes);
    if (value == null) return '—';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let amount = value;
    let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) {
        amount /= 1024;
        unit += 1;
    }
    return `${amount.toFixed(unit === 0 ? 0 : amount >= 10 ? 1 : 2)} ${units[unit]}`;
}

function roleLabel(role) {
    if (role === 'waiter') return 'Dependent / waiter';
    if (role === 'owner') return 'Owner / blocker';
    if (role === 'waiter-owner') return 'Waiter and owner';
    if (role === 'carrier') return 'Virtual-thread carrier';
    if (role === 'virtual') return 'Mounted virtual thread';
    if (role === 'resource') return 'Lock resource';
    return 'Isolated in this snapshot';
}

function resourceRoleLabel(role, kind) {
    if (!role) return 'None observed';
    const waiter = kind === 'monitor' ? role.monitorWaiter : role.synchronizerWaiter;
    const holder = kind === 'monitor' ? role.monitorHolder : role.synchronizerHolder;
    if (waiter && holder) return 'Holding and waiting';
    if (waiter) return kind === 'monitor' ? 'Waiting to enter synchronized' : 'Waiting for synchronizer';
    if (holder) return kind === 'monitor' ? 'Holding synchronized' : 'Holding synchronizer';
    return 'None observed';
}

function threadRoleChips(role) {
    if (!role) return [];
    return [
        role.monitorWaiter ? { label: 'Waits for synchronized', className: 'is-warn', mode: 'monitor-waiter' } : null,
        role.monitorHolder ? { label: 'Holds synchronized', className: 'is-cyan', mode: 'monitor-holder' } : null,
        role.synchronizerWaiter ? { label: 'Waits for synchronizer', className: 'is-purple', mode: 'synchronizer-waiter' } : null,
        role.synchronizerHolder ? { label: 'Holds synchronizer', className: 'is-purple', mode: 'synchronizer-holder' } : null,
    ].filter(Boolean);
}

function relationLabel(type) {
    if (type === 'wait') return 'waits to enter';
    if (type === 'park') return 'parks for';
    if (type === 'await') return 'awaits notification on';
    if (type === 'hold') return 'is held by';
    if (type === 'class-init-wait') return 'waits for class initialization';
    if (type === 'initialize') return 'is initialized by';
    if (type === 'mount') return 'is mounted on';
    if (type === 'dependency') return 'depends on';
    return type;
}

function createElement(tagName, className, content = null) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (content != null) element.textContent = String(content);
    return element;
}

function appendFact(list, label, value) {
    if (value == null || value === '') return;
    list.append(
        createElement('dt', '', label),
        createElement('dd', '', value),
    );
}

function appendChip(row, label, className = '') {
    const chip = createElement('span', `dependency-graph-chip ${className}`.trim(), label);
    row.appendChild(chip);
    return chip;
}

function hashString(value) {
    let hash = 2166136261;
    for (const character of String(value || '')) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function deterministicFraction(value, salt = 0) {
    return ((hashString(`${value}:${salt}`) % 10000) + 0.5) / 10000;
}

function nodeShapePath(node, radius) {
    if (node.type === 'lock') {
        return `M0,${-radius} L${radius},0 L0,${radius} L${-radius},0 Z`;
    }
    if (node.type === 'virtual-thread') {
        const points = [];
        for (let index = 0; index < 6; index += 1) {
            const angle = (-Math.PI / 2) + (index * Math.PI / 3);
            points.push(`${Math.cos(angle) * radius},${Math.sin(angle) * radius}`);
        }
        return `M${points.join(' L')} Z`;
    }
    return `M0,${-radius} A${radius},${radius} 0 1,1 0,${radius} A${radius},${radius} 0 1,1 0,${-radius} Z`;
}

function nodeSymbol(node) {
    if (node.type === 'lock') {
        if (node.resourceKind === 'class-initialization') return 'C';
        if (node.resourceKind === 'synchronizer') return 'S';
        if (node.resourceKind === 'mixed') return 'X';
        return 'M';
    }
    if (node.type === 'virtual-thread') return 'V';
    return 'T';
}

function nodeLabel(node) {
    if (node.type === 'lock') {
        return node.resourceKind === 'class-initialization'
            ? truncate(node.className || node.label, 31)
            : shortLockId(node.lockId);
    }
    return truncate(node.label, 31);
}

function nodeSubLabel(node) {
    if (node.type === 'lock') {
        if (node.resourceKind === 'class-initialization') {
            const totalWaiters = node.waiterIds?.length || 0;
            const visibleWaiters = node._visibleWaiterCount ?? totalWaiters;
            return `CLASS INIT${totalWaiters ? ` · ${visibleWaiters}/${totalWaiters} W` : ''}`;
        }
        const kind = node.resourceKind === 'synchronizer'
            ? 'SYNC'
            : node.resourceKind === 'mixed'
                ? 'MIXED'
                : 'MONITOR';
        const totalWaiters = node.waiterIds?.length || 0;
        const visibleWaiters = node._visibleWaiterCount ?? totalWaiters;
        const waiterLabel = totalWaiters
            ? node._hiddenWaiterCount > 0
                ? `${visibleWaiters}/${totalWaiters} W`
                : `${totalWaiters} W`
            : '';
        return [kind, waiterLabel].filter(Boolean).join(' · ');
    }
    if (node.type === 'virtual-thread') return 'MOUNTED';
    return text(node.state || 'UNKNOWN').replaceAll('_', ' ');
}

function nodeRadius(node) {
    if (node.type === 'virtual-thread') return 9;
    if (node.type === 'lock') {
        return 12 + Math.min(11, Math.sqrt((node.waiterIds?.length || 0) + (node.ownerIds?.length || 0)) * 2.8) + (node.deadlocked ? 2 : 0);
    }
    const degree = (node.resourceDegree || 0) + (node.dependencyDegree || 0);
    const severityBoost = node.deadlocked ? 3 : node.state === 'BLOCKED' ? 1.5 : 0;
    return 11.5 + Math.min(8, Math.sqrt(degree) * 2.2) + severityBoost;
}

function edgeLabel(edge) {
    if (edge.type === 'dependency') {
        if (edge.confirmedDeadlock) return edge.locks?.length === 1 ? `DEADLOCK · ${compactLockId(edge.locks[0].lockId)}` : 'DEADLOCK';
        if (edge.className) return 'CLASS INIT';
        if (edge.locks?.length === 1) return shortLockId(edge.locks[0].lockId);
        return edge.locks?.length ? `${edge.locks.length} locks` : 'depends on';
    }
    if (edge.type === 'hold') return 'HELD BY';
    if (edge.type === 'class-init-wait') return 'CLASS INIT';
    if (edge.type === 'initialize') return 'INITIALIZED BY';
    if (edge.type === 'mount') return 'MOUNTED ON';
    if (edge.type === 'await') return 'NOTIFY';
    return edge.lockId ? shortLockId(edge.lockId) : relationLabel(edge.type).toUpperCase();
}

function markerColor(type, confirmedDeadlock) {
    if (confirmedDeadlock) return '#ff4f62';
    if (type === 'wait' || type === 'park') return '#ffad4a';
    if (type === 'class-init-wait') return '#ffd15c';
    if (type === 'initialize') return '#52d8ff';
    if (type === 'await') return '#a98cff';
    if (type === 'hold') return '#52d8ff';
    if (type === 'mount') return '#44e2c2';
    return '#61b5ff';
}

function cssSafeId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

class ThreadDependencyGraphView {
    constructor({ root, onOpenThread } = {}) {
        this.root = root || null;
        this.onOpenThread = typeof onOpenThread === 'function' ? onOpenThread : () => {};
        this.d3 = globalThis.d3 || null;
        this.instanceId = `dependency-graph-${Math.random().toString(36).slice(2, 9)}`;
        this.model = buildThreadDependencyGraph([]);
        this.snapshotLabel = '';
        this.threadsReference = null;
        this.deadlocksReference = null;
        this.visibleNodes = [];
        this.visibleEdges = [];
        this.visibleNodeById = new Map();
        this.fullNodeById = new Map();
        this.hasVisibleIsolatedThreads = false;
        this.threadLockRoleIndex = new Map();
        this.projectionMeta = this.emptyProjectionMeta();
        this.adjacency = new Map();
        this.positionCache = new Map();
        this.pinnedNodeIds = new Set();
        this.selectedNodeId = null;
        this.hoveredNodeId = null;
        this.focusNodeId = null;
        this.searchTerm = '';
        this.searchMatches = [];
        this.width = 1100;
        this.height = 680;
        this.zoomTransform = this.d3?.zoomIdentity || null;
        this.fitTimer = null;
        this.minimapFrame = null;
        this.fallbackExpanded = false;
        this.options = { ...DEFAULT_DEPENDENCY_GRAPH_OPTIONS };
        this.elements = this.root ? this.collectElements() : {};
        this.bindControls();
        this.observeSize();
        this.renderEmptyInspector();
    }

    emptyProjectionMeta() {
        return {
            densityProfile: contentionDensityProfile(this.options?.density || 'compact'),
            selectedLockIds: new Set(),
            hiddenWaiterCountByLock: new Map(),
            visibleWaiterIdsByLock: new Map(),
            hiddenWaiterObservationCount: 0,
            hiddenLockCount: 0,
            filteredByTypeCount: 0,
            filteredUnresolvedCount: 0,
            eligibleLockCount: 0,
            highlightMatchCount: 0,
        };
    }

    collectElements() {
        const byId = (id) => this.root.querySelector(`#${id}`);
        return {
            details: byId('dependencyGraphDetails'),
            subtitle: byId('dependencyGraphSubtitle'),
            viewMode: byId('dependencyGraphViewMode'),
            scope: byId('dependencyGraphScope'),
            density: byId('dependencyGraphDensity'),
            layout: byId('dependencyGraphLayout'),
            labels: byId('dependencyGraphLabels'),
            highlight: byId('dependencyGraphHighlight'),
            highlightCount: byId('dependencyGraphHighlightCount'),
            resourceControls: byId('dependencyGraphResourceControls'),
            relationControls: byId('dependencyGraphRelationControls'),
            showMonitors: byId('dependencyGraphShowMonitors'),
            showSynchronizers: byId('dependencyGraphShowSynchronizers'),
            showUnresolved: byId('dependencyGraphShowUnresolved'),
            showWaits: byId('dependencyGraphShowWaits'),
            showHolds: byId('dependencyGraphShowHolds'),
            showAwaits: byId('dependencyGraphShowAwaits'),
            showMounts: byId('dependencyGraphShowMounts'),
            showEdgeLabels: byId('dependencyGraphShowEdgeLabels'),
            search: byId('dependencyGraphSearch'),
            searchCount: byId('dependencyGraphSearchCount'),
            searchClear: byId('dependencyGraphSearchClear'),
            zoomOut: byId('dependencyGraphZoomOut'),
            zoomIn: byId('dependencyGraphZoomIn'),
            focusSelected: byId('dependencyGraphFocusSelected'),
            fit: byId('dependencyGraphFit'),
            reheat: byId('dependencyGraphReheat'),
            export: byId('dependencyGraphExport'),
            fullscreen: byId('dependencyGraphFullscreen'),
            focusBar: byId('dependencyGraphFocusBar'),
            focusText: byId('dependencyGraphFocusText'),
            focusClear: byId('dependencyGraphFocusClear'),
            densityNotice: byId('dependencyGraphDensityNotice'),
            densityText: byId('dependencyGraphDensityText'),
            densityContention: byId('dependencyGraphDensityContention'),
            densityDependencies: byId('dependencyGraphDensityDependencies'),
            metrics: byId('dependencyGraphMetrics'),
            stage: byId('dependencyGraphStage'),
            svg: byId('dependencyGraphSvg'),
            empty: byId('dependencyGraphEmpty'),
            zoomReadout: byId('dependencyGraphZoomReadout'),
            minimap: byId('dependencyGraphMinimap'),
            minimapSvg: byId('dependencyGraphMinimapSvg'),
            tooltip: byId('dependencyGraphTooltip'),
            inspector: byId('dependencyGraphInspector'),
        };
    }

    bindControls() {
        if (!this.root) return;
        const rebuildOnChange = (element, optionKey) => {
            element?.addEventListener('change', () => {
                this.options[optionKey] = element.type === 'checkbox' ? Boolean(element.checked) : element.value;
                if (optionKey === 'view' || optionKey === 'scope') this.focusNodeId = null;
                if (['view', 'scope', 'density', 'layout', 'showMonitors', 'showSynchronizers', 'showUnresolved'].includes(optionKey)) {
                    this.positionCache.clear();
                    this.pinnedNodeIds.clear();
                }
                this.syncControlState();
                this.rebuildProjection({ fit: true });
            });
        };

        rebuildOnChange(this.elements.viewMode, 'view');
        rebuildOnChange(this.elements.scope, 'scope');
        rebuildOnChange(this.elements.density, 'density');
        rebuildOnChange(this.elements.layout, 'layout');
        rebuildOnChange(this.elements.showMonitors, 'showMonitors');
        rebuildOnChange(this.elements.showSynchronizers, 'showSynchronizers');
        rebuildOnChange(this.elements.showUnresolved, 'showUnresolved');
        rebuildOnChange(this.elements.showWaits, 'showWaits');
        rebuildOnChange(this.elements.showHolds, 'showHolds');
        rebuildOnChange(this.elements.showAwaits, 'showAwaits');
        rebuildOnChange(this.elements.showMounts, 'showMounts');

        this.elements.labels?.addEventListener('change', () => {
            this.options.labels = this.elements.labels.value;
            this.updateSvgClasses();
        });
        this.elements.highlight?.addEventListener('change', () => {
            this.setHighlightMode(this.elements.highlight.value, { ensureResourceVisible: true });
        });
        this.elements.showEdgeLabels?.addEventListener('change', () => {
            this.options.showEdgeLabels = Boolean(this.elements.showEdgeLabels.checked);
            this.updateSvgClasses();
        });

        this.elements.search?.addEventListener('input', () => {
            this.searchTerm = text(this.elements.search.value).toLowerCase();
            this.updateSearchState();
        });
        this.elements.search?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && this.searchMatches.length) {
                event.preventDefault();
                const firstVisibleMatch = this.searchMatches.find((node) => this.visibleNodeById.has(node.id));
                this.selectNode((firstVisibleMatch || this.searchMatches[0]).id, { center: true, reveal: true });
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                this.clearSearch();
                this.elements.stage?.focus();
            }
        });
        this.elements.searchClear?.addEventListener('click', () => this.clearSearch());
        this.elements.zoomOut?.addEventListener('click', () => this.zoomBy(0.72));
        this.elements.zoomIn?.addEventListener('click', () => this.zoomBy(1.38));
        this.elements.focusSelected?.addEventListener('click', () => {
            if (this.selectedNodeId) this.focusNeighborhood(this.selectedNodeId);
        });
        this.elements.fit?.addEventListener('click', () => this.fitToGraph());
        this.elements.reheat?.addEventListener('click', () => this.reheat());
        this.elements.export?.addEventListener('click', () => this.exportPng());
        this.elements.fullscreen?.addEventListener('click', () => this.toggleFullscreen());
        this.elements.focusClear?.addEventListener('click', () => {
            this.focusNodeId = null;
            this.rebuildProjection({ fit: true });
        });
        this.elements.densityContention?.addEventListener('click', () => {
            this.focusNodeId = null;
            this.options.view = 'resource';
            this.options.scope = 'contention';
            this.options.density = 'compact';
            this.options.showAwaits = false;
            this.options.showMounts = false;
            this.options.showEdgeLabels = false;
            this.rebuildProjection({ fit: true });
        });
        this.elements.densityDependencies?.addEventListener('click', () => {
            if (!this.model.metrics.dependencyCount) return;
            this.focusNodeId = null;
            this.options.view = 'dependency';
            this.options.scope = 'connected';
            this.options.showMounts = false;
            this.options.showEdgeLabels = false;
            this.rebuildProjection({ fit: true });
        });
        this.elements.details?.addEventListener('toggle', () => {
            if (!this.elements.details.open) return;
            requestAnimationFrame(() => {
                this.resize();
                this.reheat(0.35);
                this.scheduleFit();
            });
        });
        this.elements.stage?.addEventListener('keydown', (event) => this.handleStageKeydown(event));
        document.addEventListener('fullscreenchange', () => this.handleFullscreenChange());
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.fallbackExpanded) {
                this.setFallbackExpanded(false);
            }
        });
        this.syncControlState();
    }

    observeSize() {
        if (!this.elements.stage || typeof ResizeObserver === 'undefined') return;
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.elements.stage);
    }

    setData({ threads = [], deadlocks = [], snapshotLabel = '', incidentSourceKeys = null } = {}) {
        const incidentKey = incidentSourceKeys == null ? null : [...incidentSourceKeys].sort().join('|');
        const incidentChanged = incidentKey !== this.incidentKey;
        this.incidentKey = incidentKey;
        this.incidentSourceKeys = incidentSourceKeys;
        if (!this.root) return;
        const hasThreads = Array.isArray(threads) && threads.length > 0;
        this.root.classList.toggle('hidden', !hasThreads);
        this.snapshotLabel = text(snapshotLabel);

        if (!hasThreads) {
            this.threadsReference = threads;
            this.deadlocksReference = deadlocks;
            this.model = buildThreadDependencyGraph([]);
            this.fullNodeById.clear();
            this.threadLockRoleIndex.clear();
            this.projectionMeta = this.emptyProjectionMeta();
            this.clearGraph();
            this.renderMetrics();
            this.renderEmptyInspector();
            return;
        }

        const dataChanged = incidentChanged || this.threadsReference !== threads || this.deadlocksReference !== deadlocks;
        this.threadsReference = threads;
        this.deadlocksReference = deadlocks;
        if (!dataChanged) {
            this.renderSubtitle();
            return;
        }

        this.model = buildThreadDependencyGraph(threads, deadlocks);
        this.fullNodeById = new Map(this.model.nodes.map((node) => [node.id, node]));
        this.threadLockRoleIndex = buildThreadLockRoleIndex(this.model);
        this.projectionMeta = this.emptyProjectionMeta();
        if (this.selectedNodeId && !this.fullNodeById.has(this.selectedNodeId)) this.selectedNodeId = null;
        if (this.focusNodeId && !this.fullNodeById.has(this.focusNodeId)) this.focusNodeId = null;
        this.pinnedNodeIds = new Set([...this.pinnedNodeIds].filter((id) => this.fullNodeById.has(id)));
        this.renderSubtitle();
        this.rebuildProjection({ fit: true });
    }

    clearGraph({ resetProjectionMeta = true } = {}) {
        if (this.simulation) this.simulation.stop();
        clearTimeout(this.fitTimer);
        this.visibleNodes = [];
        this.visibleEdges = [];
        this.hasVisibleIsolatedThreads = false;
        if (resetProjectionMeta) this.projectionMeta = this.emptyProjectionMeta();
        this.visibleNodeById.clear();
        this.adjacency.clear();
        if (this.elements.svg) this.elements.svg.replaceChildren();
        if (this.elements.minimapSvg) this.elements.minimapSvg.replaceChildren();
        this.elements.densityNotice?.classList.add('hidden');
        this.hideTooltip();
    }

    renderSubtitle() {
        if (!this.elements.subtitle) return;
        const metrics = this.model.metrics;
        const prefix = this.snapshotLabel ? `${this.snapshotLabel} · ` : '';
        this.elements.subtitle.textContent = `${prefix}${metrics.threadCount} threads · ${metrics.lockCount} JVM resources · ${metrics.dependencyCount} observed wait-for dependencies`;
    }

    syncControlState() {
        if (!this.root) return;
        if (this.elements.viewMode) this.elements.viewMode.value = this.options.view;
        if (this.elements.scope) this.elements.scope.value = this.options.scope;
        if (this.elements.density) {
            this.elements.density.value = this.options.density;
            this.elements.density.disabled = this.options.scope !== 'contention' || Boolean(this.focusNodeId);
        }
        if (this.elements.layout) this.elements.layout.value = this.options.layout;
        if (this.elements.labels) this.elements.labels.value = this.options.labels;
        if (this.elements.highlight) this.elements.highlight.value = this.options.highlight;
        if (this.elements.showMonitors) this.elements.showMonitors.checked = this.options.showMonitors;
        if (this.elements.showSynchronizers) this.elements.showSynchronizers.checked = this.options.showSynchronizers;
        if (this.elements.showUnresolved) this.elements.showUnresolved.checked = this.options.showUnresolved;
        if (this.elements.showWaits) this.elements.showWaits.checked = this.options.showWaits;
        if (this.elements.showHolds) this.elements.showHolds.checked = this.options.showHolds;
        if (this.elements.showAwaits) this.elements.showAwaits.checked = this.options.showAwaits;
        if (this.elements.showMounts) this.elements.showMounts.checked = this.options.showMounts;
        if (this.elements.showEdgeLabels) this.elements.showEdgeLabels.checked = this.options.showEdgeLabels;

        const resourceView = this.options.view === 'resource';
        this.elements.relationControls?.classList.toggle('is-inactive', !resourceView);
        [this.elements.showWaits, this.elements.showHolds, this.elements.showAwaits].forEach((element) => {
            if (element) element.disabled = !resourceView;
        });
        if (this.elements.focusSelected) {
            this.elements.focusSelected.disabled = !this.selectedNodeId;
            this.elements.focusSelected.classList.toggle('is-active', Boolean(this.focusNodeId && this.focusNodeId === this.selectedNodeId));
        }
        this.renderHighlightSummary();
    }

    projectionData() {
        const resourceView = this.options.view === 'resource';
        const lockNodeById = new Map(this.model.lockNodes.map((node) => [node.id, node]));
        const lockNodeIdForReference = (lock) => {
            const lockId = text(lock?.lockId).toLowerCase();
            return lockId ? `lock:${lockId}` : null;
        };
        const allowedLockIds = new Set(
            this.model.lockNodes
                .filter((node) => resourceKindVisible(node.resourceKind, this.options))
                .filter((node) => this.options.showUnresolved || node.deadlocked || !node.waiterIds.length || node.ownerIds.length > 0)
                .map((node) => node.id),
        );
        const resourceEdgeLockId = (edge) => {
            const source = endpointId(edge.source);
            const target = endpointId(edge.target);
            if (lockNodeById.has(source)) return source;
            if (lockNodeById.has(target)) return target;
            return null;
        };

        const mountEdges = this.model.resourceEdges.filter((edge) => edge.type === 'mount');
        let edges;
        if (resourceView) {
            edges = this.model.resourceEdges.filter((edge) => {
                if (edge.type === 'mount') return this.options.showMounts;
                const lockNodeId = resourceEdgeLockId(edge);
                if (lockNodeId && !allowedLockIds.has(lockNodeId)) return false;
                if (edge.type === 'wait' || edge.type === 'park' || edge.type === 'class-init-wait') return this.options.showWaits;
                if (edge.type === 'hold' || edge.type === 'initialize') return this.options.showHolds;
                if (edge.type === 'await') return this.options.showAwaits;
                return true;
            });
        } else {
            const dependencyEdges = this.model.dependencyEdges.flatMap((edge) => {
                const originalLocks = Array.isArray(edge.locks) ? edge.locks : [];
                const locks = originalLocks.filter((lock) => {
                    const lockNodeId = lockNodeIdForReference(lock);
                    return lockNodeId && allowedLockIds.has(lockNodeId);
                });
                if (originalLocks.length && !locks.length) return [];
                return [{
                    ...edge,
                    locks,
                    label: locks.length === 1 ? locks[0].lockId : locks.length ? `${locks.length} locks` : edge.label,
                }];
            });
            edges = [
                ...dependencyEdges,
                ...(this.options.showMounts ? mountEdges : []),
            ];
        }

        let candidates = resourceView
            ? [
                ...this.model.threadNodes,
                ...this.model.lockNodes.filter((node) => allowedLockIds.has(node.id)),
                ...(this.options.showMounts ? this.model.virtualThreadNodes : []),
            ]
            : [
                ...this.model.threadNodes,
                ...(this.options.showMounts ? this.model.virtualThreadNodes : []),
            ];

        // A lock without any currently enabled relation is not useful in the
        // projection. Thread nodes stay available so search/focus can reveal an
        // otherwise isolated thread without switching to the raw all-node map.
        const baseEdgeNodeIds = new Set(edges.flatMap((edge) => [endpointId(edge.source), endpointId(edge.target)]));
        if (resourceView) {
            candidates = candidates.filter((node) => node.type !== 'lock' || baseEdgeNodeIds.has(node.id));
        }

        let meta = this.emptyProjectionMeta();
        if (this.incidentSourceKeys != null) {
            // Use the existing renderer for this snapshot's complete dependency
            // neighborhood, including chains longer than the manual two hops.
            const keep = new Set(this.incidentSourceKeys.map(key => `thread:${key}`));
            for (const edge of this.model.resourceEdges) {
                if (keep.has(edge.source) || keep.has(edge.target)) {
                    for (const id of [edge.source, edge.target]) if (this.fullNodeById.get(id)?.type === 'lock') keep.add(id);
                }
            }
            candidates = this.model.nodes.filter(node => keep.has(node.id));
            edges = this.model.resourceEdges.filter(edge => keep.has(edge.source) && keep.has(edge.target));
        } else if (this.focusNodeId) {
            // Neighborhood focus intentionally overrides the selected scope and
            // density profile. The full model remains available, but only two
            // relationship hops around the selected node are rendered.
            const graphAdjacency = new Map(candidates.map((node) => [node.id, new Set()]));
            for (const edge of edges) {
                const source = endpointId(edge.source);
                const target = endpointId(edge.target);
                if (!graphAdjacency.has(source) || !graphAdjacency.has(target)) continue;
                graphAdjacency.get(source).add(target);
                graphAdjacency.get(target).add(source);
            }
            const keep = new Set([this.focusNodeId]);
            let frontier = [this.focusNodeId];
            for (let depth = 0; depth < 2; depth += 1) {
                const next = [];
                for (const nodeId of frontier) {
                    for (const neighborId of graphAdjacency.get(nodeId) || []) {
                        if (keep.has(neighborId)) continue;
                        keep.add(neighborId);
                        next.push(neighborId);
                    }
                }
                frontier = next;
            }
            candidates = candidates.filter((node) => keep.has(node.id));
            edges = edges.filter((edge) => keep.has(endpointId(edge.source)) && keep.has(endpointId(edge.target)));
        } else if (this.options.scope === 'connected') {
            const connectedIds = new Set(edges.flatMap((edge) => [endpointId(edge.source), endpointId(edge.target)]));
            candidates = candidates.filter((node) => connectedIds.has(node.id));
        } else if (this.options.scope === 'contention') {
            const visibility = buildContentionVisibility({
                lockNodes: this.model.lockNodes,
                threadNodes: this.model.threadNodes,
                density: this.options.density,
                showMonitors: this.options.showMonitors,
                showSynchronizers: this.options.showSynchronizers,
                showUnresolved: this.options.showUnresolved,
            });
            meta = {
                ...meta,
                densityProfile: visibility.profile,
                selectedLockIds: visibility.selectedLockIds,
                hiddenWaiterCountByLock: visibility.hiddenWaiterCountByLock,
                visibleWaiterIdsByLock: visibility.visibleWaiterIdsByLock,
                hiddenWaiterObservationCount: visibility.hiddenWaiterObservationCount,
                hiddenLockCount: visibility.hiddenLockCount,
                filteredByTypeCount: visibility.filteredByTypeCount,
                filteredUnresolvedCount: visibility.filteredUnresolvedCount,
                eligibleLockCount: visibility.eligibleLockCount,
            };

            if (resourceView) {
                const awaiterIdsByLock = new Map();
                for (const lockNode of visibility.selectedLocks) {
                    const awaiterIds = [...new Set(lockNode.awaiterIds || [])]
                        .sort()
                        .slice(0, visibility.profile.maxWaitersPerLock);
                    awaiterIdsByLock.set(lockNode.id, new Set(awaiterIds));
                }
                edges = edges.filter((edge) => {
                    const lockNodeId = resourceEdgeLockId(edge);
                    if (!lockNodeId || !visibility.selectedLockIds.has(lockNodeId)) return false;
                    if (edge.type === 'wait' || edge.type === 'park' || edge.type === 'class-init-wait') {
                        return visibility.visibleWaiterIdsByLock.get(lockNodeId)?.has(endpointId(edge.source)) || false;
                    }
                    if (edge.type === 'await') {
                        return awaiterIdsByLock.get(lockNodeId)?.has(endpointId(edge.source)) || false;
                    }
                    return true;
                });
            } else {
                edges = edges.flatMap((edge) => {
                    if (edge.type === 'mount') return [];
                    const locks = (edge.locks || []).filter((lock) => {
                        const lockNodeId = lockNodeIdForReference(lock);
                        if (!lockNodeId || !visibility.selectedLockIds.has(lockNodeId)) return false;
                        return visibility.visibleWaiterIdsByLock.get(lockNodeId)?.has(endpointId(edge.source)) || false;
                    });
                    if (!locks.length) return [];
                    return [{
                        ...edge,
                        locks,
                        label: locks.length === 1 ? locks[0].lockId : `${locks.length} locks`,
                    }];
                });
            }
            const visibleIds = new Set(edges.flatMap((edge) => [endpointId(edge.source), endpointId(edge.target)]));
            candidates = candidates.filter((node) => visibleIds.has(node.id));
        } else if (this.options.scope === 'deadlock') {
            edges = edges.filter((edge) => edge.confirmedDeadlock || edge.deadlocked);
            const deadlockIds = new Set([
                ...edges.flatMap((edge) => [endpointId(edge.source), endpointId(edge.target)]),
                ...candidates.filter((node) => node.deadlocked).map((node) => node.id),
            ]);
            candidates = candidates.filter((node) => deadlockIds.has(node.id));
        }

        const candidateIds = new Set(candidates.map((node) => node.id));
        edges = edges.filter((edge) => candidateIds.has(endpointId(edge.source)) && candidateIds.has(endpointId(edge.target)));

        const incidence = new Map(candidates.map((node) => [node.id, {
            degree: 0,
            outgoing: 0,
            incoming: 0,
            waits: 0,
            holds: 0,
            waiterCount: 0,
            ownerCount: 0,
        }]));
        for (const edge of edges) {
            const source = endpointId(edge.source);
            const target = endpointId(edge.target);
            const sourceStats = incidence.get(source);
            const targetStats = incidence.get(target);
            if (sourceStats) {
                sourceStats.degree += 1;
                sourceStats.outgoing += 1;
                if (edge.type === 'wait' || edge.type === 'park' || edge.type === 'class-init-wait' || edge.type === 'await' || edge.type === 'dependency') sourceStats.waits += 1;
                if (edge.type === 'hold' || edge.type === 'initialize') sourceStats.ownerCount += 1;
            }
            if (targetStats) {
                targetStats.degree += 1;
                targetStats.incoming += 1;
                if (edge.type === 'hold' || edge.type === 'initialize' || edge.type === 'dependency') targetStats.holds += 1;
                if (edge.type === 'wait' || edge.type === 'park' || edge.type === 'class-init-wait') targetStats.waiterCount += 1;
                if (edge.type === 'hold' || edge.type === 'initialize') targetStats.ownerCount += 1;
            }
        }

        const selectedLockRank = new Map([...meta.selectedLockIds].map((nodeId, index) => [nodeId, index]));
        const nodes = candidates.map((node) => {
            const cached = this.positionCache.get(node.id);
            const stats = incidence.get(node.id) || {
                degree: 0,
                outgoing: 0,
                incoming: 0,
                waits: 0,
                holds: 0,
                waiterCount: 0,
                ownerCount: 0,
            };
            return {
                ...node,
                _visibleDegree: stats.degree,
                _visibleOutgoing: stats.outgoing,
                _visibleIncoming: stats.incoming,
                _visibleWaits: stats.waits,
                _visibleHolds: stats.holds,
                _visibleWaiterCount: stats.waiterCount,
                _visibleOwnerCount: stats.ownerCount,
                _hiddenWaiterCount: meta.hiddenWaiterCountByLock.get(node.id) || 0,
                _hotspotRank: selectedLockRank.has(node.id) ? selectedLockRank.get(node.id) : null,
                x: cached?.x,
                y: cached?.y,
                vx: cached?.vx || 0,
                vy: cached?.vy || 0,
                fx: this.pinnedNodeIds.has(node.id) ? cached?.x : null,
                fy: this.pinnedNodeIds.has(node.id) ? cached?.y : null,
            };
        });
        const smartLabelIds = selectSmartLabelNodeIds(nodes);
        nodes.forEach((node) => {
            node._smartLabel = smartLabelIds.has(node.id);
        });

        const copiedEdges = edges.map((edge, index) => ({
            ...edge,
            source: endpointId(edge.source),
            target: endpointId(edge.target),
            _projectionIndex: index,
        }));
        const directedPairs = new Set(copiedEdges.map((edge) => JSON.stringify([edge.source, edge.target])));
        copiedEdges.forEach((edge) => {
            edge._hasReverse = edge.source !== edge.target && directedPairs.has(JSON.stringify([edge.target, edge.source]));
            edge._selfLoop = edge.source === edge.target;
        });
        this.decorateFlowLayout(nodes, copiedEdges);
        return { nodes, edges: copiedEdges, meta };
    }

    decorateFlowLayout(nodes, edges) {
        if (this.options.view !== 'resource') return;
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const lockNodes = nodes
            .filter((node) => node.type === 'lock' && node._visibleDegree > 0)
            .sort((left, right) => {
                const leftRank = Number.isInteger(left._hotspotRank) ? left._hotspotRank : Number.POSITIVE_INFINITY;
                const rightRank = Number.isInteger(right._hotspotRank) ? right._hotspotRank : Number.POSITIVE_INFINITY;
                if (leftRank !== rightRank) return leftRank - rightRank;
                if (left.deadlocked !== right.deadlocked) return left.deadlocked ? -1 : 1;
                const waiterDelta = (right._visibleWaiterCount || 0) - (left._visibleWaiterCount || 0);
                if (waiterDelta) return waiterDelta;
                return String(left.id).localeCompare(String(right.id));
            });
        const lockFractionById = new Map();
        lockNodes.forEach((node, index) => {
            node._flowOrder = index;
            node._flowCount = lockNodes.length;
            node._flowFraction = (index + 1) / (lockNodes.length + 1);
            lockFractionById.set(node.id, node._flowFraction);
        });

        const threadRelations = new Map();
        const relationFor = (threadId) => {
            if (!threadRelations.has(threadId)) {
                threadRelations.set(threadId, { waiterLocks: [], ownerLocks: [] });
            }
            return threadRelations.get(threadId);
        };
        for (const edge of edges) {
            if (edge.type === 'wait' || edge.type === 'park' || edge.type === 'class-init-wait' || edge.type === 'await') {
                if (lockFractionById.has(edge.target) && nodeById.get(edge.source)?.type === 'thread') {
                    relationFor(edge.source).waiterLocks.push(edge.target);
                }
            } else if (edge.type === 'hold' || edge.type === 'initialize') {
                if (lockFractionById.has(edge.source) && nodeById.get(edge.target)?.type === 'thread') {
                    relationFor(edge.target).ownerLocks.push(edge.source);
                }
            }
        }

        const groups = new Map();
        const addToGroup = (key, threadId) => {
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(threadId);
        };

        for (const node of nodes) {
            if (node.type !== 'thread') continue;
            const relations = threadRelations.get(node.id) || { waiterLocks: [], ownerLocks: [] };
            const allLocks = [...new Set([...relations.waiterLocks, ...relations.ownerLocks])];
            if (!allLocks.length) continue;
            const primaryLockId = relations.waiterLocks[0] || relations.ownerLocks[0] || allLocks[0];
            const fractions = allLocks.map((lockId) => lockFractionById.get(lockId)).filter(Number.isFinite);
            node._flowFraction = fractions.reduce((sum, value) => sum + value, 0) / Math.max(1, fractions.length);
            node._flowRole = relations.waiterLocks.length && relations.ownerLocks.length
                ? 'both'
                : relations.waiterLocks.length
                    ? 'waiter'
                    : 'owner';
            node._flowPrimaryLockId = primaryLockId;
            node._flowCount = lockNodes.length;
            addToGroup(`${primaryLockId}:${node._flowRole}`, node.id);
        }

        for (const threadIds of groups.values()) {
            threadIds.sort((leftId, rightId) => {
                const left = nodeById.get(leftId);
                const right = nodeById.get(rightId);
                if (left?.deadlocked !== right?.deadlocked) return left?.deadlocked ? -1 : 1;
                if (left?.state !== right?.state) {
                    const order = { BLOCKED: 0, WAITING: 1, TIMED_WAITING: 2, RUNNABLE: 3, UNKNOWN: 4 };
                    return (order[left?.state] ?? 5) - (order[right?.state] ?? 5);
                }
                return String(left?.label || leftId).localeCompare(String(right?.label || rightId));
            });

            const role = nodeById.get(threadIds[0])?._flowRole || 'waiter';
            const columnCount = role === 'waiter'
                ? threadIds.length > 8 ? 3 : threadIds.length > 3 ? 2 : 1
                : role === 'owner' && threadIds.length > 4
                    ? 2
                    : 1;
            const rowCount = Math.ceil(threadIds.length / columnCount);
            threadIds.forEach((threadId, index) => {
                const node = nodeById.get(threadId);
                if (!node) return;
                const columnIndex = Math.floor(index / rowCount);
                const rowIndex = index % rowCount;
                node._flowSlotIndex = index;
                node._flowSlotCount = threadIds.length;
                node._flowColumnIndex = columnIndex;
                node._flowColumnCount = columnCount;
                node._flowRowIndex = rowIndex;
                node._flowRowCount = rowCount;
            });
        }
    }

    rebuildProjection({ fit = false } = {}) {
        if (!this.root || this.root.classList.contains('hidden')) return;
        // Rebuilding replaces the SVG nodes. A pointerleave event is therefore
        // not guaranteed for the node that owned an open tooltip.
        this.hideTooltip();
        this.hoveredNodeId = null;
        if (!this.d3) {
            this.showEmpty('D3 could not be loaded, so the dependency graph cannot be rendered.');
            return;
        }
        this.syncControlState();
        this.resize();
        const projection = this.projectionData();
        this.visibleNodes = projection.nodes;
        this.visibleEdges = projection.edges;
        this.projectionMeta = projection.meta || this.emptyProjectionMeta();
        this.hasVisibleIsolatedThreads = this.visibleNodes.some((node) => node.type === 'thread' && node._visibleDegree === 0);
        this.visibleNodeById = new Map(this.visibleNodes.map((node) => [node.id, node]));
        if (this.selectedNodeId && !this.visibleNodeById.has(this.selectedNodeId)) this.selectedNodeId = null;
        if (this.hoveredNodeId && !this.visibleNodeById.has(this.hoveredNodeId)) this.hoveredNodeId = null;
        this.buildAdjacency();
        this.renderMetrics();
        this.renderDensityNotice();
        this.renderFocusBar();
        this.renderHighlightSummary();

        if (!this.visibleNodes.length) {
            this.clearGraph({ resetProjectionMeta: false });
            let scopeLabel = this.options.scope === 'deadlock'
                ? 'No confirmed deadlock nodes exist in this snapshot.'
                : 'No nodes match the selected graph scope and relation filters.';
            if (this.options.view === 'dependency' && !this.model.metrics.dependencyCount) {
                scopeLabel = this.model.metrics.unresolvedWaitCount
                    ? `No owner-resolved thread dependencies were observed. ${this.model.metrics.unresolvedWaitCount} waits have no owner in this snapshot; use Resource map → Contention overview to inspect them.`
                    : 'No owner-resolved thread dependencies were observed in this snapshot.';
            }
            this.showEmpty(scopeLabel);
            this.renderInspector();
            this.syncControlState();
            return;
        }
        this.hideEmpty();
        this.initializeGraph();
        this.updateSearchState();
        this.renderInspector();
        if (fit) {
            this.scheduleFit();
        }
    }

    buildAdjacency() {
        this.adjacency = new Map(this.visibleNodes.map((node) => [node.id, new Set()]));
        for (const edge of this.visibleEdges) {
            const source = endpointId(edge.source);
            const target = endpointId(edge.target);
            this.adjacency.get(source)?.add(target);
            this.adjacency.get(target)?.add(source);
        }
    }

    initializeGraph() {
        const d3 = this.d3;
        if (this.simulation) this.simulation.stop();
        const svg = d3.select(this.elements.svg);
        svg.selectAll('*').remove();
        this.updateSvgClasses();
        this.createDefinitions(svg);

        this.viewportLayer = svg.append('g').attr('class', 'dependency-graph-viewport');
        this.laneLayer = this.viewportLayer.append('g').attr('class', 'dependency-graph-lanes');
        this.edgeLayer = this.viewportLayer.append('g').attr('class', 'dependency-graph-edges');
        this.edgeLabelLayer = this.viewportLayer.append('g').attr('class', 'dependency-graph-edge-labels');
        this.nodeLayer = this.viewportLayer.append('g').attr('class', 'dependency-graph-nodes');

        this.renderLanes();

        this.edgeSelection = this.edgeLayer
            .selectAll('path')
            .data(this.visibleEdges, (edge) => edge.id)
            .join('path')
            .attr('class', (edge) => [
                'dependency-graph-edge',
                `dependency-graph-edge-${edge.type}`,
                edge.ambiguousOwner ? 'is-ambiguous' : '',
                edge.observedCycle ? 'is-observed-cycle' : '',
                edge.confirmedDeadlock ? 'is-confirmed-deadlock' : '',
            ].filter(Boolean).join(' '))
            .attr('marker-end', (edge) => `url(#${this.markerId(edge)})`)
            .on('pointerenter', (event, edge) => this.showEdgeTooltip(edge, event))
            .on('pointermove', (event) => this.positionTooltip(event))
            .on('pointerleave', () => this.hideTooltip())
            .on('click', (event, edge) => {
                event.stopPropagation();
                const targetId = endpointId(edge.target);
                this.selectNode(targetId, { center: false, reveal: false });
            });

        this.edgeLabelSelection = this.edgeLabelLayer
            .selectAll('text')
            .data(this.visibleEdges, (edge) => edge.id)
            .join('text')
            .attr('class', (edge) => `dependency-graph-edge-label ${edge.confirmedDeadlock ? 'is-confirmed-deadlock' : ''}`)
            .text((edge) => edgeLabel(edge));

        this.nodeSelection = this.nodeLayer
            .selectAll('g')
            .data(this.visibleNodes, (node) => node.id)
            .join((enter) => {
                const group = enter.append('g');
                group.append('circle').attr('class', 'dependency-graph-node-halo');
                group.append('path').attr('class', 'dependency-graph-node-core');
                group.append('circle').attr('class', 'dependency-graph-node-cycle-ring');
                group.append('circle').attr('class', 'dependency-graph-node-deadlock-ring');
                group.append('circle').attr('class', 'dependency-graph-node-pinned-ring');
                group.append('text').attr('class', 'dependency-graph-node-symbol');
                group.append('text').attr('class', 'dependency-graph-node-label');
                group.append('text').attr('class', 'dependency-graph-node-sub-label');
                return group;
            })
            .attr('class', (node) => this.nodeClassName(node))
            .attr('role', 'button')
            .attr('tabindex', 0)
            .attr('aria-label', (node) => this.nodeAriaLabel(node))
            .on('pointerenter', (event, node) => {
                this.hoveredNodeId = node.id;
                this.updateHighlights();
                this.showNodeTooltip(node, event);
            })
            .on('pointermove', (event) => this.positionTooltip(event))
            .on('pointerleave', () => {
                this.hoveredNodeId = null;
                this.updateHighlights();
                this.hideTooltip();
            })
            .on('click', (event, node) => {
                // D3 may flag the synthetic click as prevented after a drag. Stop
                // propagation first so the SVG background handler never clears a
                // valid selection (or the selection that existed before dragging).
                event.stopPropagation();
                if (event.defaultPrevented) return;
                this.selectNode(node.id, { center: false, reveal: false });
            })
            .on('dblclick', (event, node) => {
                event.preventDefault();
                event.stopPropagation();
                if (node.type === 'thread') this.onOpenThread(node.rawThread);
                else this.focusNeighborhood(node.id);
            })
            .on('keydown', (event, node) => this.handleNodeKeydown(event, node));

        this.nodeSelection.select('.dependency-graph-node-halo')
            .attr('r', (node) => nodeRadius(node) + 6);
        this.nodeSelection.select('.dependency-graph-node-core')
            .attr('d', (node) => nodeShapePath(node, nodeRadius(node)));
        this.nodeSelection.select('.dependency-graph-node-cycle-ring')
            .attr('r', (node) => nodeRadius(node) + 4)
            .classed('hidden', (node) => !node.observedCycleId || node.deadlocked);
        this.nodeSelection.select('.dependency-graph-node-deadlock-ring')
            .attr('r', (node) => nodeRadius(node) + 5)
            .classed('hidden', (node) => !node.deadlocked);
        this.nodeSelection.select('.dependency-graph-node-pinned-ring')
            .attr('r', (node) => nodeRadius(node) + 3)
            .classed('hidden', (node) => !this.pinnedNodeIds.has(node.id));
        this.nodeSelection.select('.dependency-graph-node-symbol')
            .text((node) => nodeSymbol(node));
        this.nodeSelection.select('.dependency-graph-node-label')
            .attr('x', (node) => nodeRadius(node) + 7)
            .attr('y', -5)
            .text((node) => nodeLabel(node));
        this.nodeSelection.select('.dependency-graph-node-sub-label')
            .attr('x', (node) => nodeRadius(node) + 7)
            .attr('y', 11)
            .text((node) => nodeSubLabel(node));

        this.nodeSelection.call(this.createDragBehavior());
        svg.on('click', () => {
            this.selectedNodeId = null;
            this.renderInspector();
            this.syncControlState();
            this.updateHighlights();
        });

        this.zoomBehavior = d3.zoom()
            .scaleExtent([0.08, 8])
            .filter((event) => !event.button && !event.ctrlKey)
            .on('zoom', (event) => {
                this.zoomTransform = event.transform;
                this.viewportLayer.attr('transform', event.transform);
                this.updateZoomReadout();
                this.updateSvgClasses();
                this.scheduleMinimapUpdate();
            });
        svg.call(this.zoomBehavior).on('dblclick.zoom', null);
        const previousTransform = this.zoomTransform || d3.zoomIdentity;
        svg.call(this.zoomBehavior.transform, previousTransform);

        this.initializePositions();
        this.simulation = d3.forceSimulation(this.visibleNodes)
            .alpha(0.95)
            .alphaDecay(this.visibleNodes.length > 500 ? 0.055 : 0.042)
            .velocityDecay(0.35)
            .force('link', d3.forceLink(this.visibleEdges)
                .id((node) => node.id)
                .distance((edge) => this.linkDistance(edge))
                .strength((edge) => this.linkStrength(edge)))
            .force('charge', d3.forceManyBody()
                .strength((node) => this.chargeStrength(node))
                .distanceMax(Math.max(this.width, this.height) * 0.9)
                .theta(0.9))
            .force('collision', d3.forceCollide()
                .radius((node) => nodeRadius(node) + (this.visibleNodes.length > 450 ? 6 : this.visibleNodes.length > 180 ? 10 : 16))
                .strength(0.96)
                .iterations(this.visibleNodes.length > 500 ? 1 : this.visibleNodes.length > 180 ? 2 : 3));
        this.configureLayoutForces();
        this.simulation.on('tick', () => this.tick());
        this.simulation.on('end', () => this.scheduleMinimapUpdate());
        this.initializeMinimap();
        this.updateHighlights();
    }

    createDefinitions(svg) {
        const defs = svg.append('defs');
        const gradient = defs.append('radialGradient')
            .attr('id', `${this.instanceId}-node-glow`)
            .attr('cx', '50%')
            .attr('cy', '50%')
            .attr('r', '50%');
        gradient.append('stop').attr('offset', '0%').attr('stop-color', '#7bc7ff').attr('stop-opacity', 0.28);
        gradient.append('stop').attr('offset', '100%').attr('stop-color', '#7bc7ff').attr('stop-opacity', 0);

        const markerTypes = ['wait', 'park', 'await', 'hold', 'dependency', 'mount', 'deadlock'];
        for (const type of markerTypes) {
            defs.append('marker')
                .attr('id', `${this.instanceId}-arrow-${type}`)
                .attr('viewBox', '0 -5 10 10')
                .attr('refX', 8.5)
                .attr('refY', 0)
                .attr('markerWidth', 6)
                .attr('markerHeight', 6)
                .attr('orient', 'auto')
                .attr('markerUnits', 'userSpaceOnUse')
                .append('path')
                .attr('d', 'M0,-4L9,0L0,4Z')
                .attr('fill', markerColor(type, type === 'deadlock'));
        }
    }

    markerId(edge) {
        const type = edge.confirmedDeadlock ? 'deadlock' : edge.type;
        return `${this.instanceId}-arrow-${type}`;
    }

    nodeClassName(node) {
        const classes = [
            'dependency-graph-node',
            `dependency-graph-node-${node.type}`,
            stateClass(node.state),
        ];
        if (node.type === 'lock') classes.push(`resource-${node.resourceKind || 'monitor'}`);
        if (node.deadlocked) classes.push('is-deadlocked', 'is-important');
        if (node.observedCycleId) classes.push('is-cycle', 'is-important');
        if (node._smartLabel) classes.push('is-important');
        if (this.pinnedNodeIds.has(node.id)) classes.push('is-pinned');
        return classes.join(' ');
    }

    nodeAriaLabel(node) {
        if (node.type === 'lock') {
            const visibleWaiters = node._visibleWaiterCount ?? node.waiterIds.length;
            const compactedWaiters = node._hiddenWaiterCount || 0;
            const waiterText = compactedWaiters
                ? `${visibleWaiters} of ${node.waiterIds.length} waiters visible`
                : `${node.waiterIds.length} waiters`;
            return node.resourceKind === 'class-initialization'
                ? `Class initialization for ${node.className || node.label}; ${node.ownerIds.length} initializer; ${waiterText}`
                : `${node.resourceKind} lock ${node.lockId}; ${node.ownerIds.length} owners; ${waiterText}`;
        }
        if (node.type === 'virtual-thread') return `${node.label}, mounted virtual thread`;
        return `${node.threadName}; state ${node.state}; ${roleLabel(node.role)}`;
    }

    renderLanes() {
        if (!this.laneLayer) return;
        this.laneLayer.selectAll('*').remove();
        if (this.options.layout === 'constellation') {
            const rings = [0.18, 0.31, 0.44].map((factor) => factor * Math.min(this.width, this.height));
            this.laneLayer.selectAll('circle')
                .data(rings)
                .join('circle')
                .attr('class', 'dependency-graph-constellation-ring')
                .attr('cx', this.width / 2)
                .attr('cy', this.height / 2)
                .attr('r', (radius) => radius);
            return;
        }

        const hasIsolatedThreads = this.hasVisibleIsolatedThreads;
        const contentBottom = hasIsolatedThreads ? this.height * 0.77 : this.height - 4;
        const resourceLaneLabel = this.options.showMonitors && this.options.showSynchronizers
            ? this.options.scope === 'contention'
                ? `${this.projectionMeta.densityProfile.label.toUpperCase()} JVM RESOURCE HOTSPOTS`
                : 'MONITORS / CLASS INIT / SYNCHRONIZERS'
            : this.options.showMonitors
                ? 'MONITORS · synchronized / class init'
                : this.options.showSynchronizers
                    ? 'SYNCHRONIZERS · Lock / AQS'
                    : 'NO RESOURCE TYPES ENABLED';
        const lanes = this.options.view === 'resource'
            ? [
                { x: 0, width: this.width * 0.33, label: 'WAITING / DEPENDENT THREADS', className: '' },
                { x: this.width * 0.33, width: this.width * 0.34, label: resourceLaneLabel, className: 'is-resource' },
                { x: this.width * 0.67, width: this.width * 0.33, label: 'OBSERVED OWNERS / BLOCKERS', className: '' },
            ]
            : [
                { x: 0, width: this.width * 0.42, label: 'DEPENDENT THREADS', className: '' },
                { x: this.width * 0.42, width: this.width * 0.16, label: 'WAIT-FOR FLOW', className: 'is-resource' },
                { x: this.width * 0.58, width: this.width * 0.42, label: 'BLOCKING THREADS', className: '' },
            ];

        const laneGroups = this.laneLayer.selectAll('g.dependency-graph-lane-group')
            .data(lanes)
            .join('g')
            .attr('class', 'dependency-graph-lane-group');
        laneGroups.append('rect')
            .attr('class', (lane) => `dependency-graph-lane ${lane.className}`.trim())
            .attr('x', (lane) => lane.x + 4)
            .attr('y', 4)
            .attr('width', (lane) => Math.max(0, lane.width - 8))
            .attr('height', Math.max(0, contentBottom - 10))
            .attr('rx', 16);
        laneGroups.append('text')
            .attr('class', 'dependency-graph-lane-label')
            .attr('x', (lane) => lane.x + lane.width / 2)
            .attr('y', 24)
            .text((lane) => lane.label);

        if (!hasIsolatedThreads) return;
        const isolatedStart = this.height * 0.77;
        this.laneLayer.append('rect')
            .attr('class', 'dependency-graph-lane is-isolated')
            .attr('x', 4)
            .attr('y', isolatedStart)
            .attr('width', Math.max(0, this.width - 8))
            .attr('height', Math.max(0, this.height - isolatedStart - 4))
            .attr('rx', 14);
        this.laneLayer.append('text')
            .attr('class', 'dependency-graph-lane-label')
            .attr('x', this.width / 2)
            .attr('y', isolatedStart + 20)
            .text('THREADS WITHOUT A PARSED LOCK RELATIONSHIP IN THIS SNAPSHOT');
    }

    initializePositions() {
        const flowLayout = this.options.layout !== 'constellation';
        for (const node of this.visibleNodes) {
            if (Number.isFinite(node.x) && Number.isFinite(node.y)) continue;
            const target = this.layoutTarget(node);
            const jitterX = (deterministicFraction(node.id, 1) - 0.5) * (flowLayout ? Math.min(52, this.width * 0.045) : Math.min(150, this.width * 0.16));
            const jitterY = (deterministicFraction(node.id, 2) - 0.5) * (flowLayout ? Math.min(24, this.height * 0.035) : Math.min(150, this.height * 0.18));
            node.x = target.x + jitterX;
            node.y = target.y + jitterY;
        }
    }

    configureLayoutForces() {
        if (!this.simulation || !this.d3) return;
        const xForce = this.d3.forceX((node) => this.layoutTarget(node).x)
            .strength((node) => this.layoutStrength(node).x);
        const yForce = this.d3.forceY((node) => this.layoutTarget(node).y)
            .strength((node) => this.layoutStrength(node).y);
        this.simulation.force('x', xForce).force('y', yForce);
        if (this.options.layout === 'constellation') {
            this.simulation.force('center', this.d3.forceCenter(this.width / 2, this.height / 2).strength(0.035));
        } else {
            this.simulation.force('center', null);
        }
    }

    layoutTarget(node) {
        const width = this.width;
        const height = this.height;
        if (this.options.layout === 'constellation') {
            const centers = {
                BLOCKED: [0.22, 0.25],
                WAITING: [0.22, 0.67],
                TIMED_WAITING: [0.76, 0.70],
                RUNNABLE: [0.78, 0.28],
                MOUNTED: [0.50, 0.86],
                UNKNOWN: [0.50, 0.18],
            };
            if (node.type === 'lock') {
                const angle = (node._flowFraction ?? deterministicFraction(node.id, 5)) * Math.PI * 2;
                const radius = Math.min(width, height) * 0.16;
                return {
                    x: width * 0.50 + Math.cos(angle) * radius,
                    y: height * 0.50 + Math.sin(angle) * radius,
                };
            }
            const center = centers[node.state] || centers.UNKNOWN;
            return { x: width * center[0], y: height * center[1] };
        }

        const hasIsolatedThreads = this.hasVisibleIsolatedThreads;
        const isolatedY = height * 0.86;
        if (node._visibleDegree === 0) {
            const stateOffset = {
                BLOCKED: 0.15,
                WAITING: 0.33,
                TIMED_WAITING: 0.52,
                RUNNABLE: 0.72,
                UNKNOWN: 0.88,
            }[node.state] ?? 0.5;
            return { x: width * stateOffset, y: isolatedY };
        }
        if (node.type === 'virtual-thread') {
            return { x: width * 0.08, y: height * (0.18 + deterministicFraction(node.id, 4) * 0.64) };
        }

        if (this.options.view === 'resource' && Number.isFinite(node._flowFraction)) {
            const top = 0.065;
            const span = hasIsolatedThreads ? 0.64 : 0.87;
            const baseY = height * (top + node._flowFraction * span);
            if (node.type === 'lock') return { x: width * 0.50, y: baseY };

            const lockCount = Math.max(1, Number(node._flowCount) || 1);
            const rowBand = height * (span / (lockCount + 1)) * 0.78;
            const rowCount = Math.max(1, Number(node._flowRowCount) || 1);
            const rowIndex = Math.max(0, Number(node._flowRowIndex) || 0);
            const rowSpacing = rowCount <= 1
                ? 0
                : Math.min(34, Math.max(20, rowBand / Math.max(1, rowCount - 0.25)));
            const offset = (rowIndex - ((rowCount - 1) / 2)) * rowSpacing;
            const columnCount = Math.max(1, Number(node._flowColumnCount) || 1);
            const columnIndex = Math.max(0, Number(node._flowColumnIndex) || 0);
            const columnFraction = columnCount <= 1 ? 0.5 : columnIndex / (columnCount - 1);
            let x;
            if (node._flowRole === 'waiter') {
                x = width * (columnCount <= 1 ? 0.145 : 0.075 + columnFraction * 0.17);
            } else if (node._flowRole === 'owner') {
                x = width * (columnCount <= 1 ? 0.855 : 0.77 + columnFraction * 0.15);
            } else {
                x = width * 0.74;
            }
            return { x, y: baseY + offset };
        }
        if (this.options.view === 'resource' && node.type === 'lock') {
            return { x: width * 0.50, y: height * (0.12 + deterministicFraction(node.id, 5) * 0.76) };
        }

        const isDependent = node._visibleWaits > 0 || node._visibleOutgoing > node._visibleIncoming;
        const isBlocker = node._visibleHolds > 0 || node._visibleIncoming > node._visibleOutgoing;
        let x = width * 0.50;
        if (isDependent && !isBlocker) x = width * (this.options.view === 'resource' ? 0.15 : 0.18);
        else if (isBlocker && !isDependent) x = width * (this.options.view === 'resource' ? 0.85 : 0.82);
        const deadlockBand = node.deadlocked ? 0.12 : 0.16;
        return { x, y: height * (deadlockBand + deterministicFraction(node.id, 6) * (node.deadlocked ? 0.26 : 0.70)) };
    }

    layoutStrength(node) {
        if (this.options.layout === 'constellation') {
            return { x: node.type === 'lock' ? 0.18 : 0.10, y: node.type === 'lock' ? 0.18 : 0.10 };
        }
        if (node._visibleDegree === 0) return { x: 0.14, y: 0.24 };
        if (this.options.view === 'resource' && Number.isFinite(node._flowFraction)) {
            return node.type === 'lock'
                ? { x: 0.76, y: 0.48 }
                : { x: 0.64, y: 0.42 };
        }
        if (node.type === 'lock') return { x: 0.38, y: 0.12 };
        return { x: 0.22, y: 0.09 };
    }

    linkDistance(edge) {
        if (edge.confirmedDeadlock) return Math.max(150, Math.min(360, this.width * 0.22));
        if (edge.type === 'dependency') return Math.max(280, Math.min(920, this.width * 0.54));
        if (edge.type === 'mount') return 110;
        return Math.max(240, Math.min(760, this.width * 0.34));
    }

    linkStrength(edge) {
        if (edge.confirmedDeadlock) return 0.66;
        if (edge.type === 'dependency') return 0.16;
        if (edge.type === 'mount') return 0.40;
        if (edge.type === 'hold' || edge.type === 'initialize') return 0.16;
        return 0.14;
    }

    chargeStrength(node) {
        const base = this.visibleNodes.length > 600
            ? -58
            : this.visibleNodes.length > 300
                ? -90
                : this.visibleNodes.length > 100
                    ? -125
                    : -170;
        if (node.type === 'lock') return base * 1.28;
        if (node._visibleDegree === 0) return base * 0.52;
        return base * (1 + Math.min(1.15, node._visibleDegree * 0.07));
    }

    createDragBehavior() {
        const dragStateByNodeId = new Map();
        const movementThreshold = 7;

        return this.d3.drag()
            .on('start', (event, node) => {
                if (!event.active) this.simulation?.alphaTarget(0.22).restart();
                dragStateByNodeId.set(node.id, {
                    startX: event.x,
                    startY: event.y,
                    startClientX: finiteNumber(event.sourceEvent?.clientX),
                    startClientY: finiteNumber(event.sourceEvent?.clientY),
                    moved: false,
                    wasPinned: this.pinnedNodeIds.has(node.id),
                });

                // Hold the node still while D3 decides whether this is a click or
                // a real drag. A plain click is released again in the end handler.
                node.fx = node.x;
                node.fy = node.y;
                this.nodeSelection
                    ?.filter((candidate) => candidate.id === node.id)
                    .classed('is-dragging', true);
            })
            .on('drag', (event, node) => {
                const dragState = dragStateByNodeId.get(node.id);
                if (dragState && !dragState.moved) {
                    const clientX = finiteNumber(event.sourceEvent?.clientX);
                    const clientY = finiteNumber(event.sourceEvent?.clientY);
                    const pointerDistance = clientX != null && clientY != null &&
                        dragState.startClientX != null && dragState.startClientY != null
                        ? Math.hypot(clientX - dragState.startClientX, clientY - dragState.startClientY)
                        : Math.hypot(event.x - dragState.startX, event.y - dragState.startY);
                    dragState.moved = pointerDistance >= movementThreshold;
                }
                node.fx = event.x;
                node.fy = event.y;
            })
            .on('end', (event, node) => {
                if (!event.active) this.simulation?.alphaTarget(0);
                const dragState = dragStateByNodeId.get(node.id);
                const shouldRemainPinned = Boolean(dragState?.wasPinned || dragState?.moved);
                dragStateByNodeId.delete(node.id);

                if (shouldRemainPinned) {
                    this.pinnedNodeIds.add(node.id);
                    this.positionCache.set(node.id, { x: node.x, y: node.y, vx: node.vx, vy: node.vy });
                } else {
                    this.pinnedNodeIds.delete(node.id);
                    node.fx = null;
                    node.fy = null;
                }

                const nodeElement = this.nodeSelection
                    ?.filter((candidate) => candidate.id === node.id)
                    .classed('is-dragging', false)
                    .classed('is-pinned', shouldRemainPinned);
                nodeElement
                    ?.select('.dependency-graph-node-pinned-ring')
                    .classed('hidden', !shouldRemainPinned);
                this.renderInspector();
            });
    }

    tick() {
        if (!this.nodeSelection || !this.edgeSelection) return;
        this.nodeSelection.attr('transform', (node) => {
            node.x = Math.max(-this.width * 0.5, Math.min(this.width * 1.5, node.x));
            node.y = Math.max(-this.height * 0.5, Math.min(this.height * 1.5, node.y));
            this.positionCache.set(node.id, { x: node.x, y: node.y, vx: node.vx, vy: node.vy });
            return `translate(${node.x},${node.y})`;
        });
        this.edgeSelection.attr('d', (edge) => this.edgePath(edge));
        this.edgeLabelSelection
            .attr('x', (edge) => this.edgeLabelPosition(edge).x)
            .attr('y', (edge) => this.edgeLabelPosition(edge).y);
        this.scheduleMinimapUpdate();
    }

    edgeGeometry(edge) {
        const source = edge.source;
        const target = edge.target;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(0.001, Math.hypot(dx, dy));
        const ux = dx / distance;
        const uy = dy / distance;
        const sourceRadius = nodeRadius(source) + 2;
        const targetRadius = nodeRadius(target) + 7;
        const sx = source.x + ux * sourceRadius;
        const sy = source.y + uy * sourceRadius;
        const tx = target.x - ux * targetRadius;
        const ty = target.y - uy * targetRadius;
        let curve = 0;
        if (edge.type === 'hold' || edge.type === 'initialize') curve = -0.12;
        else if (edge.type === 'wait' || edge.type === 'park' || edge.type === 'class-init-wait') curve = 0.12;
        else if (edge.type === 'await') curve = 0.18;
        else if (edge.type === 'dependency') {
            // Opposite-direction dependencies share the same curve sign because
            // their perpendicular vectors are reversed. This places each arrow
            // on a different side of the pair and keeps deadlock labels apart.
            curve = edge._hasReverse
                ? 0.34
                : (deterministicFraction(edge.id, 7) > 0.5 ? 1 : -1) * 0.08;
        }
        const mx = (sx + tx) / 2;
        const my = (sy + ty) / 2;
        const perpendicularX = -uy;
        const perpendicularY = ux;
        const bend = distance * curve;
        const cx = mx + perpendicularX * bend;
        const cy = my + perpendicularY * bend;
        return { sx, sy, tx, ty, cx, cy };
    }

    edgePath(edge) {
        if (endpointId(edge.source) === endpointId(edge.target)) {
            const node = edge.source;
            const radius = nodeRadius(node) + 14;
            return [
                `M${node.x + radius * 0.68},${node.y - radius * 0.68}`,
                `C${node.x + radius * 2.25},${node.y - radius * 2.40}`,
                `${node.x - radius * 2.25},${node.y - radius * 2.40}`,
                `${node.x - radius * 0.68},${node.y - radius * 0.68}`,
            ].join(' ');
        }
        const geometry = this.edgeGeometry(edge);
        return `M${geometry.sx},${geometry.sy} Q${geometry.cx},${geometry.cy} ${geometry.tx},${geometry.ty}`;
    }

    edgeLabelPosition(edge) {
        if (endpointId(edge.source) === endpointId(edge.target)) {
            const node = edge.source;
            const radius = nodeRadius(node) + 14;
            return { x: node.x, y: node.y - radius * 2.25 };
        }
        const geometry = this.edgeGeometry(edge);
        let x = (geometry.sx + 2 * geometry.cx + geometry.tx) / 4;
        let y = ((geometry.sy + 2 * geometry.cy + geometry.ty) / 4) - 4;

        // A two-thread cycle produces two opposite arrows. Their path midpoints
        // can still be close enough for long lock labels to collide, so place
        // each label farther out on its own side of the pair. Reversing the edge
        // also reverses the perpendicular vector, which naturally separates the
        // two labels without relying on DOM order.
        if (edge._hasReverse) {
            const dx = geometry.tx - geometry.sx;
            const dy = geometry.ty - geometry.sy;
            const distance = Math.max(0.001, Math.hypot(dx, dy));
            const offset = edge.confirmedDeadlock ? 48 : 34;
            x += (-dy / distance) * offset;
            y += (dx / distance) * offset;
        }
        return { x, y };
    }

    renderMetrics() {
        if (!this.elements.metrics) return;
        const metrics = this.model.metrics;
        const visibleThreadCount = this.visibleNodes.filter((node) => node.type === 'thread').length;
        const visibleResourceCount = this.visibleNodes.filter((node) => node.type === 'lock').length;
        const values = [
            ['Shown', `${this.visibleNodes.length} nodes · ${visibleThreadCount}/${this.model.threadNodes.length} threads · ${visibleResourceCount}/${this.model.lockNodes.length} resources · ${this.visibleEdges.length} links`],
            ['Snapshot', `${metrics.contendedLockCount} contended resources · ${metrics.classInitializationResourceCount} class init · ${metrics.unresolvedWaitCount} unresolved waits · ${metrics.confirmedDeadlockCycleCount} confirmed deadlock cycles`],
        ];
        if (this.projectionMeta.hiddenLockCount || this.projectionMeta.hiddenWaiterObservationCount) {
            values.push(['Compacted', `${this.projectionMeta.hiddenLockCount || 0} resources · ${this.projectionMeta.hiddenWaiterObservationCount || 0} waiter observations`]);
        }
        this.elements.metrics.replaceChildren();
        values.forEach(([label, value]) => {
            const group = createElement('span', 'dependency-graph-stat-group');
            group.append(createElement('strong', '', `${label}: `), createElement('span', '', value));
            this.elements.metrics.appendChild(group);
        });
    }

    renderDensityNotice() {
        if (!this.elements.densityNotice) return;
        const visibleResourceCount = this.visibleNodes.filter((node) => node.type === 'lock').length;
        const density = projectionDensity({
            nodeCount: this.visibleNodes.length,
            resourceCount: visibleResourceCount,
            edgeCount: this.visibleEdges.length,
        });
        const rawScope = this.options.scope === 'all' || this.options.scope === 'connected';
        const show = density.dense && rawScope && !this.focusNodeId;
        this.elements.densityNotice.classList.toggle('hidden', !show);
        if (!show) return;

        if (this.elements.densityText) {
            const adjective = density.extreme ? 'Extremely dense raw map' : 'Dense raw map';
            this.elements.densityText.textContent = `${adjective}: ${density.nodeCount} nodes, ${density.resourceCount} JVM resources, and ${density.edgeCount} links. Smart labels are capped automatically; use the contention overview for the actionable subset.`;
        }
        if (this.elements.densityDependencies) {
            const dependencyCount = this.model.metrics.dependencyCount;
            this.elements.densityDependencies.disabled = dependencyCount === 0;
            this.elements.densityDependencies.textContent = dependencyCount
                ? `Thread dependencies (${dependencyCount})`
                : 'No resolved dependencies';
        }
    }

    renderFocusBar() {
        if (!this.elements.focusBar) return;
        const node = this.fullNodeById.get(this.focusNodeId);
        const active = Boolean(node);
        this.elements.focusBar.classList.toggle('hidden', !active);
        if (active && this.elements.focusText) {
            this.elements.focusText.textContent = `Neighborhood focus: ${node.label}. Showing the selected node and up to two relationship hops; the normal scope filter is temporarily bypassed.`;
        }
    }

    updateSvgClasses() {
        if (!this.elements.svg) return;
        this.elements.svg.classList.remove('labels-smart', 'labels-all', 'labels-none');
        this.elements.svg.classList.add(`labels-${this.options.labels}`);
        this.elements.svg.classList.toggle('show-edge-labels', this.options.showEdgeLabels);
        const scale = this.zoomTransform?.k || 1;
        this.elements.svg.classList.toggle('zoom-far', scale < 0.34);
    }

    updateSearchState() {
        const query = this.searchTerm;
        this.searchMatches = query
            ? [...this.fullNodeById.values()].filter((node) => this.nodeSearchText(node).includes(query))
            : [];
        if (this.elements.searchCount) {
            const visibleMatchCount = this.searchMatches.filter((node) => this.visibleNodeById.has(node.id)).length;
            this.elements.searchCount.textContent = query
                ? visibleMatchCount === this.searchMatches.length
                    ? `${this.searchMatches.length} match${this.searchMatches.length === 1 ? '' : 'es'}`
                    : `${visibleMatchCount}/${this.searchMatches.length} visible`
                : '';
        }
        this.elements.searchClear?.classList.toggle('hidden', !query);
        this.updateHighlights();
    }

    nodeSearchText(node) {
        if (node.type === 'lock') {
            return [node.lockId, node.lockType, node.resourceKind, ...(node.observedKinds || [])]
                .filter(Boolean).join('\n').toLowerCase();
        }
        return [
            node.label,
            node.state,
            node.stateDetail,
            node.topFrame,
            node.tid,
            node.nid,
            node.sourceKey,
            node.scenarioLabel,
            node.role,
        ].filter(Boolean).join('\n').toLowerCase();
    }

    clearSearch() {
        this.searchTerm = '';
        if (this.elements.search) this.elements.search.value = '';
        this.updateSearchState();
    }

    setHighlightMode(mode, { ensureResourceVisible = true } = {}) {
        const normalizedMode = mode || 'none';
        let projectionChanged = false;
        if (ensureResourceVisible && normalizedMode.startsWith('monitor-') && !this.options.showMonitors) {
            this.options.showMonitors = true;
            projectionChanged = true;
        }
        if (ensureResourceVisible && normalizedMode.startsWith('synchronizer-') && !this.options.showSynchronizers) {
            this.options.showSynchronizers = true;
            projectionChanged = true;
        }
        this.options.highlight = normalizedMode;
        this.syncControlState();
        if (projectionChanged) {
            this.positionCache.clear();
            this.pinnedNodeIds.clear();
            this.rebuildProjection({ fit: true });
            return;
        }
        this.updateHighlights();
        this.renderInspector();
    }

    setResourceVisibilityPreset(preset) {
        if (preset === 'monitors') {
            this.options.showMonitors = true;
            this.options.showSynchronizers = false;
        } else if (preset === 'synchronizers') {
            this.options.showMonitors = false;
            this.options.showSynchronizers = true;
        } else {
            this.options.showMonitors = true;
            this.options.showSynchronizers = true;
        }
        this.focusNodeId = null;
        this.positionCache.clear();
        this.pinnedNodeIds.clear();
        this.rebuildProjection({ fit: true });
    }

    setDensityProfile(density) {
        this.options.density = contentionDensityProfile(density).id;
        this.options.scope = 'contention';
        this.focusNodeId = null;
        this.positionCache.clear();
        this.pinnedNodeIds.clear();
        this.rebuildProjection({ fit: true });
    }

    matchingHighlightThreadIds({ visibleOnly = false } = {}) {
        if (this.options.highlight === 'none') return new Set();
        const nodes = visibleOnly ? this.visibleNodes : this.model.threadNodes;
        return new Set(
            nodes
                .filter((node) => node.type === 'thread')
                .filter((node) => threadMatchesHighlightMode(
                    node,
                    this.threadLockRoleIndex.get(node.id),
                    this.options.highlight,
                ))
                .map((node) => node.id),
        );
    }

    renderHighlightSummary() {
        if (!this.elements.highlightCount) return;
        const mode = this.options.highlight;
        if (!mode || mode === 'none') {
            this.elements.highlightCount.textContent = '';
            this.elements.highlightCount.classList.remove('is-empty');
            return;
        }
        const allMatches = this.matchingHighlightThreadIds();
        const visibleMatches = this.matchingHighlightThreadIds({ visibleOnly: true });
        this.projectionMeta.highlightMatchCount = visibleMatches.size;
        this.elements.highlightCount.textContent = allMatches.size === visibleMatches.size
            ? `${allMatches.size} highlighted`
            : `${visibleMatches.size}/${allMatches.size} visible`;
        this.elements.highlightCount.classList.toggle('is-empty', allMatches.size === 0);
    }

    updateHighlights() {
        if (!this.nodeSelection) {
            this.renderHighlightSummary();
            return;
        }
        const activeId = this.hoveredNodeId || this.selectedNodeId;
        const activeSet = new Set();
        if (activeId) {
            activeSet.add(activeId);
            for (const neighbor of this.adjacency.get(activeId) || []) activeSet.add(neighbor);
        }
        const searchIds = new Set(this.searchMatches.map((node) => node.id));
        const hasSearch = Boolean(this.searchTerm);

        const roleMatchIds = this.matchingHighlightThreadIds({ visibleOnly: true });
        const roleContextIds = new Set(roleMatchIds);
        const firstHopLocks = new Set();
        for (const threadId of roleMatchIds) {
            for (const neighborId of this.adjacency.get(threadId) || []) {
                roleContextIds.add(neighborId);
                if (this.visibleNodeById.get(neighborId)?.type === 'lock') firstHopLocks.add(neighborId);
            }
        }
        for (const lockId of firstHopLocks) {
            for (const neighborId of this.adjacency.get(lockId) || []) roleContextIds.add(neighborId);
        }
        const hasEffectiveRoleHighlight = this.options.highlight !== 'none' && roleMatchIds.size > 0;

        const activeOrRoleIds = new Set(activeSet);
        if (hasEffectiveRoleHighlight) {
            for (const nodeId of roleContextIds) activeOrRoleIds.add(nodeId);
        }

        this.nodeSelection
            .classed('is-selected', (node) => node.id === this.selectedNodeId)
            .classed('is-hovered', (node) => node.id === this.hoveredNodeId)
            .classed('is-neighbor', (node) => activeId && node.id !== activeId && activeSet.has(node.id))
            .classed('is-search-match', (node) => hasSearch && searchIds.has(node.id))
            .classed('is-role-highlight', (node) => roleMatchIds.has(node.id))
            .classed('is-role-context', (node) => !roleMatchIds.has(node.id) && roleContextIds.has(node.id))
            .classed('is-muted', (node) => {
                if (activeId) return !activeOrRoleIds.has(node.id);
                if (hasSearch) return !searchIds.has(node.id);
                if (hasEffectiveRoleHighlight) return !roleContextIds.has(node.id);
                return false;
            });

        const edgeIsActive = (edge) => {
            const source = endpointId(edge.source);
            const target = endpointId(edge.target);
            return activeId && (source === activeId || target === activeId);
        };
        const edgeSearchMatch = (edge) => searchIds.has(endpointId(edge.source)) || searchIds.has(endpointId(edge.target));
        const edgeRoleMatch = (edge) => {
            const source = endpointId(edge.source);
            const target = endpointId(edge.target);
            return roleContextIds.has(source) && roleContextIds.has(target) &&
                (roleMatchIds.has(source) || roleMatchIds.has(target) || firstHopLocks.has(source) || firstHopLocks.has(target));
        };
        this.edgeSelection
            ?.classed('is-active', edgeIsActive)
            .classed('is-role-active', (edge) => hasEffectiveRoleHighlight && edgeRoleMatch(edge))
            .classed('is-muted', (edge) => {
                if (activeId) return !edgeIsActive(edge) && !(hasEffectiveRoleHighlight && edgeRoleMatch(edge));
                if (hasSearch) return !edgeSearchMatch(edge);
                if (hasEffectiveRoleHighlight) return !edgeRoleMatch(edge);
                return false;
            });
        this.edgeLabelSelection
            ?.classed('is-muted', (edge) => {
                if (activeId) return !edgeIsActive(edge) && !(hasEffectiveRoleHighlight && edgeRoleMatch(edge));
                if (hasSearch) return !edgeSearchMatch(edge);
                if (hasEffectiveRoleHighlight) return !edgeRoleMatch(edge);
                return false;
            });
        this.renderHighlightSummary();
    }

    selectNode(nodeId, { center = false, reveal = true } = {}) {
        if (!nodeId) return;
        const fullNode = this.fullNodeById.get(nodeId);
        if (!this.visibleNodeById.has(nodeId) && reveal && fullNode) {
            if (fullNode.type === 'lock') {
                this.options.view = 'resource';
                if (fullNode.resourceKind === 'monitor') this.options.showMonitors = true;
                else if (fullNode.resourceKind === 'synchronizer') this.options.showSynchronizers = true;
                else if (fullNode.resourceKind === 'mixed') {
                    this.options.showMonitors = true;
                    this.options.showSynchronizers = true;
                }
                if (fullNode.waiterIds?.length && !fullNode.ownerIds?.length) this.options.showUnresolved = true;
                if (fullNode.awaiterIds?.length && !fullNode.waiterIds?.length && !fullNode.ownerIds?.length) {
                    this.options.showAwaits = true;
                }
            }
            if (fullNode.type === 'virtual-thread') this.options.showMounts = true;
            this.focusNodeId = nodeId;
            this.rebuildProjection({ fit: false });
        }
        if (!this.visibleNodeById.has(nodeId)) return;
        this.selectedNodeId = nodeId;
        this.renderInspector();
        this.syncControlState();
        this.updateHighlights();
        if (center) this.centerOnNode(nodeId);
    }

    focusNeighborhood(nodeId) {
        if (!nodeId || !this.fullNodeById.has(nodeId)) return;
        this.focusNodeId = nodeId;
        this.selectedNodeId = nodeId;
        this.positionCache.clear();
        this.rebuildProjection({ fit: true });
    }

    revealThread(thread, { focus = true, center = true } = {}) {
        const sourceKey = text(thread?.sourceKey);
        if (!sourceKey) return false;
        const node = [...this.fullNodeById.values()].find((candidate) =>
            candidate.type === 'thread' && candidate.sourceKey === sourceKey);
        return this.revealNode(node, { focus, center });
    }

    revealLock(lockId, { focus = true, center = true } = {}) {
        const normalizedLockId = text(lockId).toLocaleLowerCase();
        if (!normalizedLockId) return false;
        const node = [...this.fullNodeById.values()].find((candidate) =>
            candidate.type === 'lock' && text(candidate.lockId).toLocaleLowerCase() === normalizedLockId);
        return this.revealNode(node, { focus, center });
    }

    revealNode(node, { focus, center }) {
        if (!node) return false;
        this.selectNode(node.id, { center: false, reveal: true });
        if (focus) this.focusNeighborhood(node.id);
        if (center) requestAnimationFrame(() => this.centerOnNode(node.id));
        return true;
    }

    togglePin(nodeId) {
        const node = this.visibleNodeById.get(nodeId);
        if (!node) return;
        if (this.pinnedNodeIds.has(nodeId)) {
            this.pinnedNodeIds.delete(nodeId);
            node.fx = null;
            node.fy = null;
        } else {
            this.pinnedNodeIds.add(nodeId);
            node.fx = node.x;
            node.fy = node.y;
        }
        this.positionCache.set(node.id, { x: node.x, y: node.y, vx: node.vx, vy: node.vy });
        this.nodeSelection
            ?.filter((candidate) => candidate.id === nodeId)
            .classed('is-pinned', this.pinnedNodeIds.has(nodeId))
            .select('.dependency-graph-node-pinned-ring')
            .classed('hidden', !this.pinnedNodeIds.has(nodeId));
        this.renderInspector();
        this.reheat(0.18);
    }

    renderInspector() {
        if (!this.elements.inspector) return;
        const node = this.fullNodeById.get(this.selectedNodeId);
        if (!node) {
            this.renderEmptyInspector();
            return;
        }
        this.elements.inspector.hidden = false;
        this.elements.inspector.replaceChildren();
        const closeButton = createElement('button', 'dependency-graph-action-btn dependency-graph-inspector-close', 'Close inspector');
        closeButton.type = 'button';
        closeButton.addEventListener('click', () => {
            this.selectedNodeId = null;
            this.renderEmptyInspector();
            this.syncControlState();
            this.updateHighlights();
            this.elements.stage?.focus();
        });
        this.elements.inspector.appendChild(closeButton);
        const header = createElement('div', 'dependency-graph-inspector-header');
        header.append(
            createElement('div', 'dependency-graph-inspector-kicker', node.type === 'lock'
                ? node.resourceKind === 'class-initialization' ? 'Class initialization resource' : 'Lock resource'
                : node.type === 'virtual-thread' ? 'Virtual thread mount' : 'Thread node'),
            createElement('div', 'dependency-graph-inspector-title', node.label),
        );
        const chips = createElement('div', 'dependency-graph-chip-row');
        if (node.type === 'thread') {
            const stateChip = createElement('span', 'badge tda-state-badge', node.state || 'UNKNOWN');
            stateChip.dataset.javaState = node.state || 'UNKNOWN';
            chips.appendChild(stateChip);
            appendChip(chips, roleLabel(node.role));
            threadRoleChips(this.threadLockRoleIndex.get(node.id)).forEach((chip) => appendChip(chips, chip.label, chip.className));
            if (node.daemon) appendChip(chips, 'Daemon');
            if (node.carrier) appendChip(chips, 'Carrier', 'is-cyan');
        } else if (node.type === 'lock') {
            appendChip(chips, node.resourceKind, node.resourceKind === 'synchronizer' ? 'is-purple' : 'is-warn');
            appendChip(chips, `${node.ownerIds.length} owner${node.ownerIds.length === 1 ? '' : 's'}`);
            appendChip(chips, `${node.waiterIds.length} waiter${node.waiterIds.length === 1 ? '' : 's'}`);
        } else {
            appendChip(chips, 'Mounted', 'is-cyan');
        }
        if (node.deadlocked) appendChip(chips, `Deadlock${node.deadlockCycleId ? ` ${node.deadlockCycleId}` : ''}`, 'is-danger');
        else if (node.observedCycleId) appendChip(chips, `Observed cycle ${node.observedCycleId}`, 'is-purple');
        if (this.pinnedNodeIds.has(node.id)) appendChip(chips, 'Pinned', 'is-cyan');
        header.appendChild(chips);
        this.elements.inspector.appendChild(header);

        const actions = createElement('div', 'dependency-graph-inspector-actions');
        if (node.type === 'thread') {
            const detailsButton = createElement('button', '', 'Open full details');
            detailsButton.type = 'button';
            detailsButton.addEventListener('click', () => this.onOpenThread(node.rawThread));
            actions.appendChild(detailsButton);
        }
        const focusButton = createElement('button', '', this.focusNodeId === node.id ? 'Focused neighborhood' : 'Focus neighborhood');
        focusButton.type = 'button';
        focusButton.disabled = this.focusNodeId === node.id;
        focusButton.addEventListener('click', () => this.focusNeighborhood(node.id));
        actions.appendChild(focusButton);
        const pinButton = createElement('button', '', this.pinnedNodeIds.has(node.id) ? 'Release pin' : 'Pin position');
        pinButton.type = 'button';
        pinButton.addEventListener('click', () => this.togglePin(node.id));
        actions.appendChild(pinButton);
        const centerButton = createElement('button', '', 'Center node');
        centerButton.type = 'button';
        centerButton.addEventListener('click', () => this.centerOnNode(node.id));
        actions.appendChild(centerButton);
        this.elements.inspector.appendChild(actions);

        if (node.type === 'thread') this.renderThreadInspector(node);
        else if (node.type === 'lock') this.renderLockInspector(node);
        else this.renderVirtualThreadInspector(node);
    }

    renderEmptyInspector() {
        if (!this.elements.inspector) return;
        this.elements.inspector.hidden = true;
        this.elements.inspector.replaceChildren();
    }

    addInspectorSection(title) {
        const section = createElement('section', 'dependency-graph-inspector-section');
        section.appendChild(createElement('div', 'dependency-graph-inspector-section-title', title));
        this.elements.inspector.appendChild(section);
        return section;
    }

    renderThreadInspector(node) {
        const factsSection = this.addInspectorSection('Thread facts');
        const facts = createElement('dl', 'dependency-graph-inspector-facts');
        appendFact(facts, 'State', `${node.state}${node.stateDetail ? ` (${node.stateDetail})` : ''}`);
        appendFact(facts, 'Role', roleLabel(node.role));
        appendFact(facts, 'CPU total', formatCpu(node.cpuMs));
        appendFact(facts, 'CPU rate', `${node.cpuIntervalQuality === 'estimated' ? '≈ ' : ''}${formatRate(node.cpuRatePercent)}`);
        if (node.cpuIntervalReason) appendFact(facts, 'CPU interval', node.cpuIntervalReason);
        appendFact(facts, 'Elapsed', formatElapsed(node.elapsedS));
        appendFact(facts, 'Allocated', formatBytes(node.allocatedBytes));
        appendFact(facts, 'Held locks', formatLockCount(node));
        appendFact(facts, 'Waiting locks', formatLockCount(node, 'waiting'));
        if (node.isVirtualThread != null) appendFact(facts, 'Thread kind', node.isVirtualThread ? 'Virtual' : 'Platform');
        if (node.carrierId) appendFact(facts, 'Carrier', this.fullNodeById.get(node.carrierId)?.label || 'Not resolved');
        appendFact(facts, 'JVM id', node.jvmId ?? '—');
        appendFact(facts, 'Native id', node.nativeIdDec ?? node.nid ?? '—');
        appendFact(facts, 'tid', node.tid || '—');
        const lockRole = this.threadLockRoleIndex.get(node.id);
        appendFact(facts, 'synchronized', resourceRoleLabel(lockRole, 'monitor'));
        appendFact(facts, 'Synchronizers', resourceRoleLabel(lockRole, 'synchronizer'));
        factsSection.appendChild(facts);

        const roleActions = threadRoleChips(lockRole);
        if (roleActions.length) {
            const roleSection = this.addInspectorSection('Highlight matching threads');
            const roleGrid = createElement('div', 'dependency-graph-preset-grid dependency-graph-preset-grid-roles');
            roleActions.forEach((roleAction) => {
                const active = this.options.highlight === roleAction.mode;
                const button = createElement('button', `dependency-graph-preset-btn ${active ? 'is-active' : ''}`.trim(), roleAction.label);
                button.type = 'button';
                button.addEventListener('click', () => this.setHighlightMode(active ? 'none' : roleAction.mode));
                roleGrid.appendChild(button);
            });
            roleSection.appendChild(roleGrid);
        }

        if (node.topFrame) {
            const stackSection = this.addInspectorSection('Top stack frame');
            stackSection.appendChild(createElement('code', 'dependency-graph-inspector-code', node.topFrame));
        }

        this.renderRelationshipSection('Waits for resources', node.waitingLockIds, 'resource');
        this.renderRelationshipSection('Holds resources', node.heldLockIds, 'resource');
        this.renderRelationshipSection('Depends on threads', node.dependencyTargetIds, 'dependency-target');
        this.renderRelationshipSection('Blocks / owns for threads', node.dependencySourceIds, 'dependency-source');

        const noteSection = this.addInspectorSection('Evidence boundary');
        noteSection.appendChild(createElement(
            'div',
            'dependency-graph-inspector-note',
            node.deadlocked
                ? 'This thread is backed by the JVM Java-level deadlock section. The cycle is a confirmed snapshot fact.'
                : 'Wait-for and owner links are matched from lock identifiers observed in the same snapshot. They do not prove wait duration, root cause, or uninterrupted ownership.',
        ));
    }

    renderLockInspector(node) {
        const classInitialization = node.resourceKind === 'class-initialization';
        const typeSection = this.addInspectorSection(classInitialization ? 'Class initialization identity' : 'Lock identity');
        typeSection.appendChild(createElement('code', 'dependency-graph-inspector-code', node.className || node.lockId));
        typeSection.appendChild(createElement('div', 'dependency-graph-inspector-note', node.lockType));

        const factsSection = this.addInspectorSection('Resource facts');
        const facts = createElement('dl', 'dependency-graph-inspector-facts');
        appendFact(facts, 'Kind', node.resourceKind);
        appendFact(facts, 'Observed as', node.observedKinds.join(', ') || '—');
        appendFact(facts, 'Owners', node.ownerIds.length);
        appendFact(facts, 'Contended waiters', node.waiterIds.length);
        const visibleNode = this.visibleNodeById.get(node.id);
        if (visibleNode) {
            appendFact(facts, 'Visible waiters', visibleNode._visibleWaiterCount ?? node.waiterIds.length);
            if (visibleNode._hiddenWaiterCount) appendFact(facts, 'Compacted waiters', visibleNode._hiddenWaiterCount);
        }
        appendFact(facts, 'Notification waiters', node.awaiterIds.length);
        appendFact(facts, 'Deadlock cycles', node.deadlockCycleIds.length ? node.deadlockCycleIds.join(', ') : '—');
        factsSection.appendChild(facts);

        if (classInitialization) {
            const boundary = this.addInspectorSection('Evidence boundary');
            boundary.appendChild(createElement(
                'div',
                'dependency-graph-inspector-note',
                'Waiters are explicitly reported by HotSpot and the initializer is matched by an exact <clinit> frame. This does not establish duration, a hang, or a deadlock.',
            ));
        }

        this.renderRelationshipSection('Observed owners', node.ownerIds, 'owner');
        this.renderRelationshipSection('Contended waiters', node.waiterIds, 'waiter');
        this.renderRelationshipSection('Notification waiters', node.awaiterIds, 'awaiter');

        const noteSection = this.addInspectorSection('Evidence boundary');
        noteSection.appendChild(createElement(
            'div',
            'dependency-graph-inspector-note',
            node.deadlocked
                ? 'At least one edge on this resource is part of a JVM-confirmed deadlock cycle.'
                : 'Owners and waiters are endpoint observations from one dump. A missing owner means it was not listed as holding this lock in the parsed snapshot; it does not prove that no owner exists.',
        ));
    }

    renderVirtualThreadInspector(node) {
        const factsSection = this.addInspectorSection('Mount relationship');
        const facts = createElement('dl', 'dependency-graph-inspector-facts');
        appendFact(facts, 'Virtual thread', `#${node.virtualThreadId}`);
        const carrier = this.fullNodeById.get(node.carrierId);
        appendFact(facts, 'Carrier', carrier?.label || '—');
        factsSection.appendChild(facts);
        if (carrier) this.renderRelationshipSection('Mounted on carrier', [carrier.id], 'carrier');
    }

    renderRelationshipSection(title, nodeIds, relationKind) {
        const uniqueIds = [...new Set((nodeIds || []).filter(Boolean))];
        if (!uniqueIds.length) return;
        const section = this.addInspectorSection(title);
        const list = createElement('div', 'dependency-graph-relation-list');
        uniqueIds.slice(0, 18).forEach((nodeId) => {
            const related = this.fullNodeById.get(nodeId);
            if (!related) return;
            const button = createElement('button', 'dependency-graph-relation-item');
            button.type = 'button';
            const main = createElement('span', 'dependency-graph-relation-item-main', related.label);
            const meta = createElement(
                'span',
                'dependency-graph-relation-item-meta',
                related.type === 'lock' ? related.resourceKind : related.state || relationKind,
            );
            button.append(main, meta);
            button.addEventListener('click', () => this.selectNode(related.id, { center: true, reveal: true }));
            list.appendChild(button);
        });
        if (uniqueIds.length > 18) {
            list.appendChild(createElement('div', 'dependency-graph-inspector-note', `+${uniqueIds.length - 18} more related nodes`));
        }
        section.appendChild(list);
    }

    showNodeTooltip(node, event) {
        const tooltip = this.elements.tooltip;
        if (!tooltip) return;
        tooltip.replaceChildren();
        const header = createElement('div', 'dependency-graph-tooltip-header');
        header.append(
            createElement('div', 'dependency-graph-tooltip-kicker', node.type === 'lock' ? `${node.resourceKind} resource` : node.type === 'virtual-thread' ? 'Virtual thread' : roleLabel(node.role)),
            createElement('div', 'dependency-graph-tooltip-title', node.label),
        );
        tooltip.appendChild(header);
        const body = createElement('div', 'dependency-graph-tooltip-body');
        const facts = createElement('dl', 'dependency-graph-tooltip-facts');
        if (node.type === 'thread') {
            appendFact(facts, 'State', node.state);
            appendFact(facts, 'CPU', formatCpu(node.cpuMs));
            appendFact(facts, 'CPU rate', `${node.cpuIntervalQuality === 'estimated' ? '≈ ' : ''}${formatRate(node.cpuRatePercent)}`);
            if (node.cpuIntervalReason) appendFact(facts, 'CPU interval', node.cpuIntervalReason);
            appendFact(facts, 'Locks', `${formatLockCount(node)} held · ${formatLockCount(node, 'waiting')} waiting`);
            appendFact(facts, 'Relations', `${node.dependencyTargetIds.length} dependencies · ${node.dependencySourceIds.length} blocked`);
            const lockRole = this.threadLockRoleIndex.get(node.id);
            appendFact(facts, 'synchronized', resourceRoleLabel(lockRole, 'monitor'));
            appendFact(facts, 'Synchronizers', resourceRoleLabel(lockRole, 'synchronizer'));
        } else if (node.type === 'lock') {
            appendFact(facts, 'Type', node.lockType);
            if (node.className) appendFact(facts, 'Class', node.className);
            appendFact(facts, 'Owners', node.ownerIds.length);
            const visibleWaiters = node._visibleWaiterCount ?? node.waiterIds.length;
            appendFact(facts, 'Waiters', node._hiddenWaiterCount ? `${visibleWaiters}/${node.waiterIds.length} visible` : node.waiterIds.length);
            if (node._hiddenWaiterCount) appendFact(facts, 'Compacted', node._hiddenWaiterCount);
            appendFact(facts, 'Notification waits', node.awaiterIds.length);
        } else {
            appendFact(facts, 'Virtual thread', `#${node.virtualThreadId}`);
            appendFact(facts, 'Relationship', 'Mounted on carrier thread');
        }
        body.appendChild(facts);
        if (node.topFrame) body.appendChild(createElement('code', 'dependency-graph-tooltip-code', node.topFrame));
        if (node.type === 'lock') body.appendChild(createElement('code', 'dependency-graph-tooltip-code', node.className || node.lockId));
        body.appendChild(createElement(
            'div',
            'dependency-graph-tooltip-note',
            node.deadlocked
                ? 'JVM-confirmed deadlock evidence · click to inspect the path'
                : 'Click to inspect · drag to pin · double-click a thread for full details',
        ));
        tooltip.appendChild(body);
        tooltip.classList.remove('hidden');
        tooltip.setAttribute('aria-hidden', 'false');
        this.positionTooltip(event);
    }

    showEdgeTooltip(edge, event) {
        const tooltip = this.elements.tooltip;
        if (!tooltip) return;
        const source = this.fullNodeById.get(endpointId(edge.source));
        const target = this.fullNodeById.get(endpointId(edge.target));
        tooltip.replaceChildren();
        const header = createElement('div', 'dependency-graph-tooltip-header');
        header.append(
            createElement('div', 'dependency-graph-tooltip-kicker', edge.confirmedDeadlock ? 'JVM-confirmed deadlock edge' : 'Observed snapshot relationship'),
            createElement('div', 'dependency-graph-tooltip-title', `${source?.label || 'Unknown'} ${relationLabel(edge.type)} ${target?.label || 'Unknown'}`),
        );
        tooltip.appendChild(header);
        const body = createElement('div', 'dependency-graph-tooltip-body');
        const facts = createElement('dl', 'dependency-graph-tooltip-facts');
        appendFact(facts, 'Relation', relationLabel(edge.type));
        if (edge.lockId) appendFact(facts, 'Lock', edge.lockId);
        if (edge.lockType) appendFact(facts, 'Lock type', edge.lockType);
        if (edge.className) appendFact(facts, 'Class', edge.className);
        if (edge.locks?.length) appendFact(facts, 'Locks', edge.locks.map((lock) => lock.lockId).join(', '));
        if (edge.ambiguousOwner) appendFact(facts, 'Owner match', 'Multiple observed owners');
        if (edge.observedCycle && !edge.confirmedDeadlock) appendFact(facts, 'Cycle signal', `Observed wait-for cycle ${edge.observedCycleId}`);
        body.appendChild(facts);
        body.appendChild(createElement(
            'div',
            'dependency-graph-tooltip-note',
            edge.confirmedDeadlock
                ? 'The JVM deadlock section explicitly reports this cycle.'
                : edge.className
                    ? 'HotSpot reports the class-initialization waiter, and the initializer is matched by an exact <clinit> frame in this snapshot. Duration and loss of progress are not established.'
                : 'Matched from same-snapshot wait and held-lock identifiers. This does not establish duration or application-level causality.',
        ));
        tooltip.appendChild(body);
        tooltip.classList.remove('hidden');
        tooltip.setAttribute('aria-hidden', 'false');
        this.positionTooltip(event);
    }

    positionTooltip(event) {
        const tooltip = this.elements.tooltip;
        if (!tooltip || tooltip.classList.contains('hidden') || !event) return;
        const margin = 12;
        const offset = 14;
        const rect = tooltip.getBoundingClientRect();
        let left = event.clientX + offset;
        let top = event.clientY + offset;
        if (left + rect.width > window.innerWidth - margin) left = event.clientX - rect.width - offset;
        if (top + rect.height > window.innerHeight - margin) top = event.clientY - rect.height - offset;
        tooltip.style.left = `${Math.max(margin, left)}px`;
        tooltip.style.top = `${Math.max(margin, top)}px`;
    }

    hideTooltip() {
        if (!this.elements.tooltip) return;
        this.elements.tooltip.classList.add('hidden');
        this.elements.tooltip.setAttribute('aria-hidden', 'true');
    }

    resize() {
        const rect = this.elements.stage?.getBoundingClientRect();
        if (!rect || rect.width < 20 || rect.height < 20) return;
        const previousWidth = this.width;
        const previousHeight = this.height;
        this.width = Math.max(320, rect.width);
        this.height = Math.max(320, rect.height);
        this.elements.svg?.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
        this.elements.svg?.setAttribute('width', String(this.width));
        this.elements.svg?.setAttribute('height', String(this.height));
        if (Math.abs(previousWidth - this.width) < 2 && Math.abs(previousHeight - this.height) < 2) return;
        this.renderLanes();
        this.configureLayoutForces();
        this.simulation?.alpha(0.22).restart();
        this.scheduleMinimapUpdate();
        this.scheduleFit();
    }

    zoomBy(factor) {
        if (!this.zoomBehavior || !this.elements.svg) return;
        this.d3.select(this.elements.svg)
            .transition()
            .duration(220)
            .call(this.zoomBehavior.scaleBy, factor);
    }

    scheduleFit() {
        clearTimeout(this.fitTimer);
        this.fitTimer = setTimeout(() => {
            if (this.elements.details?.open) this.fitToGraph(250);
        }, 420);
    }

    fitToGraph(duration = 420) {
        if (!this.zoomBehavior || !this.elements.svg || !this.visibleNodes.length) return;
        const bounds = this.graphBounds(true);
        const dx = Math.max(1, bounds.x1 - bounds.x0);
        const dy = Math.max(1, bounds.y1 - bounds.y0);
        const maxScale = this.visibleNodes.length <= 4 ? 1.55 : this.visibleNodes.length <= 12 ? 2.2 : 3.2;
        const scale = Math.max(0.08, Math.min(maxScale, 0.88 / Math.max(dx / this.width, dy / this.height)));
        const translateX = (this.width / 2) - scale * ((bounds.x0 + bounds.x1) / 2);
        const translateY = (this.height / 2) - scale * ((bounds.y0 + bounds.y1) / 2);
        const transform = this.d3.zoomIdentity.translate(translateX, translateY).scale(scale);
        const selection = this.d3.select(this.elements.svg);
        if (duration > 0) selection.transition().duration(duration).call(this.zoomBehavior.transform, transform);
        else selection.call(this.zoomBehavior.transform, transform);
    }

    centerOnNode(nodeId) {
        const node = this.visibleNodeById.get(nodeId);
        if (!node || !this.zoomBehavior || !this.elements.svg) return;
        const currentScale = Math.max(0.9, Math.min(2.4, this.zoomTransform?.k || 1));
        const transform = this.d3.zoomIdentity
            .translate(this.width / 2 - node.x * currentScale, this.height / 2 - node.y * currentScale)
            .scale(currentScale);
        this.d3.select(this.elements.svg)
            .transition()
            .duration(360)
            .call(this.zoomBehavior.transform, transform);
    }

    graphBounds(includeLabels = false) {
        const nodes = this.visibleNodes.filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y));
        if (!nodes.length) return { x0: 0, y0: 0, x1: this.width, y1: this.height };
        const boxes = new Map();
        if (includeLabels) this.nodeSelection?.each(function(node) {
            // SVG text bounds include the actual rendered labels, including long names.
            try { boxes.set(node.id, this.getBBox()); } catch { /* Detached SVG: use a conservative fallback. */ }
        });
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const node of nodes) {
            const radius = nodeRadius(node) + 8;
            const box = boxes.get(node.id);
            const validBox = box && [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;
            const labelReserve = includeLabels && this.options.labels !== 'none' && (!validBox || box.width <= radius * 2)
                ? Math.max(260, nodeLabel(node).length * 13) : 0;
            x0 = Math.min(x0, node.x + (validBox ? Math.min(-radius, box.x) : -radius));
            y0 = Math.min(y0, node.y + (validBox ? Math.min(-radius, box.y) : -radius));
            x1 = Math.max(x1, node.x + (validBox ? Math.max(radius + labelReserve, box.x + box.width) : radius + Math.max(260, labelReserve)));
            y1 = Math.max(y1, node.y + (validBox ? Math.max(radius, box.y + box.height) : radius));
        }
        return { x0: x0 - 24, y0: y0 - 24, x1: x1 + 24, y1: y1 + 24 };
    }

    reheat(alpha = 0.78) {
        if (!this.simulation) return;
        this.simulation.alpha(Math.max(this.simulation.alpha(), alpha)).restart();
    }

    updateZoomReadout() {
        if (this.elements.zoomReadout) {
            this.elements.zoomReadout.textContent = `${Math.round((this.zoomTransform?.k || 1) * 100)}%`;
        }
    }

    initializeMinimap() {
        if (!this.elements.minimapSvg || !this.d3) return;
        const svg = this.d3.select(this.elements.minimapSvg);
        svg.selectAll('*').remove();
        this.minimapEdgeSelection = svg.append('g')
            .selectAll('line')
            .data(this.visibleEdges.slice(0, 1800), (edge) => edge.id)
            .join('line')
            .attr('class', 'dependency-graph-minimap-edge');
        this.minimapNodeSelection = svg.append('g')
            .selectAll('circle')
            .data(this.visibleNodes, (node) => node.id)
            .join('circle')
            .attr('class', (node) => [
                'dependency-graph-minimap-node',
                node.type === 'lock' ? 'is-lock' : '',
                node.deadlocked ? 'is-deadlocked' : '',
            ].filter(Boolean).join(' '))
            .attr('r', (node) => node.deadlocked ? 2.8 : node.type === 'lock' ? 2.1 : 1.6);
        this.minimapViewport = svg.append('rect').attr('class', 'dependency-graph-minimap-viewport');
        this.updateMinimap();
    }

    scheduleMinimapUpdate() {
        if (this.minimapFrame != null) return;
        this.minimapFrame = requestAnimationFrame(() => {
            this.minimapFrame = null;
            this.updateMinimap();
        });
    }

    updateMinimap() {
        if (!this.minimapNodeSelection || !this.minimapViewport || !this.zoomTransform) return;
        const bounds = this.graphBounds();
        const width = Math.max(1, bounds.x1 - bounds.x0);
        const height = Math.max(1, bounds.y1 - bounds.y0);
        this.d3.select(this.elements.minimapSvg).attr('viewBox', `${bounds.x0} ${bounds.y0} ${width} ${height}`);
        this.minimapEdgeSelection
            ?.attr('x1', (edge) => edge.source.x)
            .attr('y1', (edge) => edge.source.y)
            .attr('x2', (edge) => edge.target.x)
            .attr('y2', (edge) => edge.target.y);
        this.minimapNodeSelection
            .attr('cx', (node) => node.x)
            .attr('cy', (node) => node.y);
        const topLeft = this.zoomTransform.invert([0, 0]);
        const bottomRight = this.zoomTransform.invert([this.width, this.height]);
        this.minimapViewport
            .attr('x', topLeft[0])
            .attr('y', topLeft[1])
            .attr('width', Math.max(1, bottomRight[0] - topLeft[0]))
            .attr('height', Math.max(1, bottomRight[1] - topLeft[1]));
    }

    showEmpty(message) {
        if (!this.elements.empty) return;
        this.elements.empty.textContent = message;
        this.elements.empty.classList.remove('hidden');
    }

    hideEmpty() {
        this.elements.empty?.classList.add('hidden');
    }

    handleStageKeydown(event) {
        const tagName = event.target?.tagName?.toLowerCase();
        if (tagName === 'input' || tagName === 'select' || tagName === 'button') return;
        if (event.key === '/' || event.key.toLowerCase() === 's') {
            event.preventDefault();
            this.elements.search?.focus();
        } else if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            this.zoomBy(1.3);
        } else if (event.key === '-') {
            event.preventDefault();
            this.zoomBy(0.76);
        } else if (event.key.toLowerCase() === 'f') {
            event.preventDefault();
            this.fitToGraph();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            if (this.focusNodeId) {
                this.focusNodeId = null;
                this.rebuildProjection({ fit: true });
            } else {
                this.selectedNodeId = null;
                this.renderInspector();
                this.updateHighlights();
            }
        }
    }

    handleNodeKeydown(event, node) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.selectNode(node.id, { center: false, reveal: false });
        } else if (event.key.toLowerCase() === 'd' && node.type === 'thread') {
            event.preventDefault();
            this.onOpenThread(node.rawThread);
        } else if (event.key.toLowerCase() === 'p') {
            event.preventDefault();
            this.togglePin(node.id);
        }
    }

    async toggleFullscreen() {
        if (!this.root) return;
        if (this.fallbackExpanded) {
            this.setFallbackExpanded(false);
            return;
        }
        try {
            if (document.fullscreenElement === this.root) {
                await document.exitFullscreen();
            } else {
                if (this.elements.details) this.elements.details.open = true;
                if (this.root.requestFullscreen) {
                    await this.root.requestFullscreen();
                } else {
                    this.setFallbackExpanded(true);
                }
            }
        } catch (error) {
            console.warn('Dependency graph fullscreen failed; using expanded overlay.', error);
            if (this.elements.details) this.elements.details.open = true;
            this.setFallbackExpanded(true);
        }
    }

    handleFullscreenChange() {
        const active = document.fullscreenElement === this.root;
        if (active && this.fallbackExpanded) this.setFallbackExpanded(false);
        if (this.elements.fullscreen) this.elements.fullscreen.textContent = active ? '⛶ Exit fullscreen' : '⛶ Fullscreen';
        requestAnimationFrame(() => {
            this.resize();
            this.fitToGraph(0);
        });
    }

    setFallbackExpanded(active) {
        this.fallbackExpanded = Boolean(active);
        this.root?.classList.toggle('dependency-graph-expanded', this.fallbackExpanded);
        document.body.classList.toggle('dependency-graph-body-locked', this.fallbackExpanded);
        if (this.elements.fullscreen) this.elements.fullscreen.textContent = this.fallbackExpanded ? '⛶ Exit fullscreen' : '⛶ Fullscreen';
        requestAnimationFrame(() => {
            this.resize();
            this.fitToGraph(0);
        });
    }

    async exportPng() {
        if (!this.elements.svg || !this.visibleNodes.length) return;
        const button = this.elements.export;
        const previousLabel = button?.textContent;
        if (button) {
            button.disabled = true;
            button.textContent = 'Rendering…';
        }
        try {
            const clone = this.elements.svg.cloneNode(true);
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            clone.setAttribute('width', String(Math.round(this.width * 2)));
            clone.setAttribute('height', String(Math.round(this.height * 2)));
            clone.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
            const defs = clone.querySelector('defs') || clone.insertBefore(document.createElementNS('http://www.w3.org/2000/svg', 'defs'), clone.firstChild);
            const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
            style.textContent = EXPORT_STYLES;
            defs.appendChild(style);

            const exportBounds = this.graphBounds(true);
            const exportDx = Math.max(1, exportBounds.x1 - exportBounds.x0);
            const exportDy = Math.max(1, exportBounds.y1 - exportBounds.y0);
            const exportMaxScale = this.visibleNodes.length <= 4 ? 1.55 : this.visibleNodes.length <= 12 ? 2.2 : 3.2;
            const exportScale = Math.max(0.08, Math.min(
                exportMaxScale,
                0.86 / Math.max(exportDx / this.width, exportDy / this.height),
            ));
            const exportTranslateX = (this.width / 2) - exportScale * ((exportBounds.x0 + exportBounds.x1) / 2);
            const exportTranslateY = (this.height / 2) - exportScale * ((exportBounds.y0 + exportBounds.y1) / 2);
            clone.querySelector('.dependency-graph-viewport')?.setAttribute(
                'transform',
                `translate(${exportTranslateX},${exportTranslateY}) scale(${exportScale})`,
            );

            const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            background.setAttribute('x', '0');
            background.setAttribute('y', '0');
            background.setAttribute('width', String(this.width));
            background.setAttribute('height', String(this.height));
            background.setAttribute('fill', '#070c16');
            clone.insertBefore(background, clone.firstChild.nextSibling);

            const serialized = new XMLSerializer().serializeToString(clone);
            const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const image = new Image();
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = reject;
                image.src = url;
            });
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(this.width * 2);
            canvas.height = Math.round(this.height * 2);
            const context = canvas.getContext('2d');
            context.fillStyle = '#070c16';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
            if (!pngBlob) throw new Error('Could not encode PNG.');
            const pngUrl = URL.createObjectURL(pngBlob);
            const anchor = document.createElement('a');
            anchor.href = pngUrl;
            anchor.download = `thread-dependency-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
        } catch (error) {
            console.error('Dependency graph PNG export failed:', error);
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = previousLabel || '⇩ PNG';
            }
        }
    }
}

export function createThreadDependencyGraphView(options = {}) {
    return new ThreadDependencyGraphView(options);
}
