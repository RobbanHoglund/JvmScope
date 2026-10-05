import { scoreRunnableStackSimilarityDetailed, normalizeRunnableCompareLine } from './tda/analysis.js';
import { createAnalysisClient } from './tda/analysis-client.js';
import { bindAnalyzerStart, renderAnalyzerStart, bindAnalyzerDropZones } from './analyzer-start.js';
import { createHelpSearch } from './help-search.js';
import { THREAD_EXAMPLES, readExample } from './example-catalog.js';
import { createExamplePicker } from './example-picker.js';
// JvmScope · Java Thread Dump Analyzer

import { observedVirtualThreadIds } from './tda/dump-to-file.js';
import { getChartFilterView, getChartLegendItemView } from './tda/chart-filter-view.js';
import { renderContentionTable } from './tda/contention-view.js';
import { buildCpuTimelineModel, buildSnapshotTickIndexes } from './tda/cpu-timeline.js';
import { getRunnableCpuThresholdProfile, runnableCpuThresholdProfileFromSearch, resolveRunnableCpuThresholdProfileId, updateRunnableCpuThresholdProfileSearch } from './tda/classification.js';
import { diagnosticEvidenceFor, hasThreadDiagnostic } from './tda/diagnostics.js';
import { resetDatasetScopedUi } from './tda/dataset-ui-state.js';
import { createThreadDependencyGraphView } from './tda/dependency-graph-view.js';
import { createFocusedTableState, emptyFocusedTableState, focusedThreadIndexSet, getFocusedTableView, isFocusedTableActive } from './tda/focused-table.js';
import { getDumpNavigationView, keyboardDumpNavigationAction, resolveDumpIndex } from './tda/dump-navigation.js';
import { getInputFeedback, getInputDialogFeedback, inputSourceLabel } from './tda/input-feedback.js';
import { createInputFeedbackDialog } from './tda/input-feedback-dialog.js';
import { createLatestInputRequestGate } from './tda/input-request.js';
import { createSessionInputQueue } from './tda/session.js';
import { createRawDumpWorkspace } from './tda/raw-dump-view.js';
import { renderSmartAnalysisThreadButtons, renderSmartAnalysisResources } from './tda/smart-analysis-view.js';
import { groupRunnableClusterMembersByStack } from './tda/runnable-stack.js';
import { filterThreads } from './tda/thread-filters.js';
import { formatSnapshotTime } from './tda/time-quality.js';
import { buildThreadDetailsViewModel, getThreadDetailsTabOrder } from './tda/thread-modal.js';
import { bindThreadStackControls } from './tda/thread-stack-view.js';
import { escapeAttr, escapeHtml } from './tda/ui-safety.js';
import { renderBlockingPatternView } from './tda/blocking-pattern-view.js';
import './tda/blocking-patterns.css';
import { patternSnapshot } from './tda/blocking-patterns.js';
import { createBlockingFinding, inputDigest } from './findings-report.js';
import { createFindingsReportView } from './findings-report-view.js';
const findingsReport = createFindingsReportView(document.getElementById('findingReportHost'));
let reportDatasetRevision = 0;

let blockingPatterns = [];
let blockingPatternSummary = null;
let selectedBlockingPatternKey = '';


const UI = {

    dumpNavigator: document.getElementById('dumpNavigator'),
    dumpCountLabel: document.getElementById('dumpCountLabel'),
    prevDumpBtn: document.getElementById('prevDumpBtn'),
    nextDumpBtn: document.getElementById('nextDumpBtn'),
    dumpSelect: document.getElementById('dumpSelect'),
    dumpDeltaSummary: document.getElementById('dumpDeltaSummary'),
    dumpNavigationAnnouncement: document.getElementById('dumpNavigationAnnouncement'),

    fileInput: document.getElementById('fileInput'),
    inputMode: document.getElementById('sessionInputMode'),
    sessionInputStatus: document.getElementById('sessionInputStatus'),
    fileName: document.getElementById('fileName'),
    searchInput: document.getElementById('searchInput'),
    refreshBtn: document.getElementById('refreshBtn'),
    loadSampleBtn: document.getElementById('loadSampleBtn'),
    pasteClipboardBtn: document.getElementById('pasteClipboardBtn'),
    clearBtn: document.getElementById('clearBtn'),
    openRawDumpBtn: document.getElementById('openRawDumpBtn'),
    howToUseBtn: document.getElementById('howToUseBtn'),
    cpuThresholdProfile: document.getElementById('cpuThresholdProfile'),

    onlyDaemonToggle: document.getElementById('onlyDaemonToggle'),
    onlyBlockedToggle: document.getElementById('onlyBlockedToggle'),
    onlyWaitingToggle: document.getElementById('onlyWaitingToggle'),
    onlyDeadlockedToggle: document.getElementById('onlyDeadlockedToggle'),

    smartAnalysisPanel: document.getElementById('smartAnalysisPanel'),
    smartAnalysisPanelBody: document.getElementById('smartAnalysisPanelBody'),

    deadlockPanel: document.getElementById('deadlockPanel'),
    deadlockPanelBody: document.getElementById('deadlockPanelBody'),

    classInitializationPanel: document.getElementById('classInitializationPanel'),
    classInitializationPanelBody: document.getElementById('classInitializationPanelBody'),

    contentionPanel: document.getElementById('contentionPanel'),
    contentionPanelBody: document.getElementById('contentionPanelBody'),

    dependencyGraphPanel: document.getElementById('dependencyGraphPanel'),

    runnableClusterPanel: document.getElementById('runnableClusterPanel'),
    runnableClusterPanelBody: document.getElementById('runnableClusterPanelBody'),

    onlyCarrierToggle: document.getElementById('onlyCarrierToggle'),

    statsSummary: document.getElementById('statsSummary'),
    lastUpdated: document.getElementById('lastUpdated'),

    tbody: document.getElementById('threadTableBody'),
    threadTable: document.getElementById('threadTable'),
    rowCount: document.getElementById('rowCount'),
    pager: document.getElementById('pager'),
    loadingState: document.getElementById('loadingState'),
    errorState: document.getElementById('errorState'),

    chartFilterBar: document.getElementById('chartFilterBar'),
    chartFilterSummary: document.getElementById('chartFilterSummary'),
    clearChartFilterBtn: document.getElementById('clearChartFilterBtn'),
    chartFilterAnnouncement: document.getElementById('chartFilterAnnouncement'),
    focusFilterBar: document.getElementById('focusFilterBar'),
    focusFilterSummary: document.getElementById('focusFilterSummary'),
    clearFocusFilterBtn: document.getElementById('clearFocusFilterBtn'),
    focusFilterAnnouncement: document.getElementById('focusFilterAnnouncement'),

    // Modal
    modal: document.getElementById('threadModal'),
    modalTitle: document.getElementById('threadModalTitle'),
    modalBody: document.getElementById('threadModalBody'),
    modalClose: document.getElementById('threadModalClose'),
    modalClose2: document.getElementById('threadModalClose2'),
    modalCopyBtn: document.getElementById('threadModalCopyBtn'),

    howToUseModal: document.getElementById('howToUseModal'),
    howToUseModalClose: document.getElementById('howToUseModalClose'),
    howToUseModalClose2: document.getElementById('howToUseModalClose2'),

    // Drag & drop
    dropZone: document.getElementById('tableContainer'),
    dropOverlay: document.getElementById('dropOverlay'),


    threadStateChartPanel: document.getElementById('threadStateChartPanel'),
    threadStateChart: document.getElementById('threadStateChart'),
    threadStateLegend: document.getElementById('threadStateLegend'),
    openThreadStateChartBtn: document.getElementById('openThreadStateChartBtn'),
    cpuTimeChart: document.getElementById('cpuTimeChart'),
    cpuTimeLegend: document.getElementById('cpuTimeLegend'),
    cpuTimelineChart: document.getElementById('cpuTimelineChart'),
    cpuTimelineLegend: document.getElementById('cpuTimelineLegend'),
    cpuTimelineSummary: document.getElementById('cpuTimelineSummary'),
    cpuTimelineSearch: document.getElementById('cpuTimelineSearch'),
    cpuTimelineLimit: document.getElementById('cpuTimelineLimit'),

    elapsedChart: document.getElementById('elapsedChart'),
    elapsedLegend: document.getElementById('elapsedLegend'),

    allocatedChart: document.getElementById('allocatedChart'),
    allocatedLegend: document.getElementById('allocatedLegend'),
    allocationRateChart: document.getElementById('allocationRateChart'),
    allocationRateLegend: document.getElementById('allocationRateLegend'),


    threadStateChartModal: document.getElementById('threadStateChartModal'),
    threadStateChartModalCloseBtn: document.getElementById('threadStateChartModalCloseBtn'),
    threadStateChartLarge: document.getElementById('threadStateChartLarge'),
    threadStateLegendLarge: document.getElementById('threadStateLegendLarge'),


    deadlockedThreadsModal: document.getElementById('deadlockedThreadsModal'),
    deadlockedThreadsModalTitle: document.getElementById('deadlockedThreadsModalTitle'),
    deadlockedThreadsModalBody: document.getElementById('deadlockedThreadsModalBody'),
    deadlockedThreadsModalClose: document.getElementById('deadlockedThreadsModalClose'),
    deadlockedThreadsModalClose2: document.getElementById('deadlockedThreadsModalClose2'),

    runnableClusterCompareModal: document.getElementById('runnableClusterCompareModal'),
    runnableClusterCompareModalTitle: document.getElementById('runnableClusterCompareModalTitle'),
    runnableClusterCompareModalBody: document.getElementById('runnableClusterCompareModalBody'),
    runnableClusterCompareModalClose: document.getElementById('runnableClusterCompareModalClose'),
    runnableClusterCompareModalClose2: document.getElementById('runnableClusterCompareModalClose2'),
	
	dumpPointInTime: document.getElementById('dumpPointInTime'),

};

const dependencyGraphView = createThreadDependencyGraphView({
    root: UI.dependencyGraphPanel,
    onOpenThread: (thread, sourceElement) => openThreadModal(thread, sourceElement),
});

let runnableClusterUiState = {
    panelOpen: false,
    clusterOpenById: new Map(),
    stackGroupOpenByKey: new Map()
};

function resetRunnableClusterUiState() {
    runnableClusterUiState = {
        panelOpen: false,
        clusterOpenById: new Map(),
        stackGroupOpenByKey: new Map()
    };
}
let runnableClusterTableFocusState = emptyFocusedTableState();

function clearRunnableClusterTableFocus() {
    runnableClusterTableFocusState = emptyFocusedTableState();
}

function isRunnableClusterOpen(clusterId) {
    return runnableClusterUiState.clusterOpenById.get(String(clusterId)) === true;
}

function isRunnableStackGroupOpen(groupKey) {
    return runnableClusterUiState.stackGroupOpenByKey.get(String(groupKey)) === true;
}

function captureRunnableClusterUiStateFromDom() {
    if (!UI.runnableClusterPanelBody) return;

    const panel = UI.runnableClusterPanelBody.querySelector('.runnable-cluster-panel-details');
    if (panel instanceof HTMLDetailsElement) {
        runnableClusterUiState.panelOpen = panel.open;
    }

    UI.runnableClusterPanelBody
        .querySelectorAll('.runnable-cluster-card[data-cluster-id]')
        .forEach((el) => {
            if (el instanceof HTMLDetailsElement) {
                const clusterId = el.getAttribute('data-cluster-id');
                if (clusterId) {
                    runnableClusterUiState.clusterOpenById.set(String(clusterId), el.open);
                }
            }
        });

    UI.runnableClusterPanelBody
        .querySelectorAll('.runnable-cluster-stack-group-details[data-stack-group-key]')
        .forEach((el) => {
            if (el instanceof HTMLDetailsElement) {
                const key = el.getAttribute('data-stack-group-key');
                if (key) {
                    runnableClusterUiState.stackGroupOpenByKey.set(String(key), el.open);
                }
            }
        });
}

function makeRunnableStackGroupStateKey(cluster, group, groupIndex) {
    return [
        cluster?.id || 'cluster',
        group?.key || group?.topFrame || `group-${groupIndex}`
    ].join('::');
}

function fmtCpu(ms) {
    if (ms == null) return '—';
    if (ms < 1) return `${ms.toFixed(2)} ms`;
    if (ms < 1000) return `${ms.toFixed(2)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
}

function fmtCpuRate(percent) {
    if (percent == null) return '—';
    if (percent > 0 && percent < 0.01) return '<0.01%';
    return `${percent.toFixed(2)}%`;
}

function fmtBytes(bytes) {
    if (bytes == null || !Number.isFinite(bytes)) return '—';
    if (bytes < 1024) return `${bytes.toFixed(0)} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KiB`;
    if (bytes < 1024 ** 3) return `${(bytes / (1024 ** 2)).toFixed(2)} MiB`;
    return `${(bytes / (1024 ** 3)).toFixed(2)} GiB`;
}

function fmtAllocationRate(bytesPerSecond) {
    const formatted = fmtBytes(bytesPerSecond);
    return formatted === '—' ? formatted : `${formatted}/s`;
}

function cpuRateBasisLabel(basis) {
    if (basis === 'snapshot-time') return 'Snapshot timestamps';
    if (basis === 'thread-elapsed') return 'Thread elapsed counters';
    return 'Unavailable';
}

function cpuDeltaStatusLabel(status) {
    const labels = {
        computed: 'Computed from previous snapshot',
        'first-occurrence': 'No previous correlated occurrence',
        'identity-ambiguous': 'Thread identity is ambiguous',
        'identity-unavailable': 'No exact thread match in previous snapshot',
        'snapshot-gap': 'Previous adjacent snapshot unavailable',
        'counter-missing': 'CPU counter unavailable',
        'counter-reset': 'CPU counter decreased or reset',
        'interval-unavailable': 'Time interval unavailable; CPU delta only',
        'interval-conflict': 'Snapshot and elapsed clocks disagree; CPU delta only',
    };
    return labels[status] || 'Unavailable';
}

function allocationDeltaStatusLabel(status) {
    const labels = {
        computed: 'Computed from previous snapshot',
        'first-occurrence': 'No previous correlated occurrence',
        'identity-ambiguous': 'Thread identity is ambiguous',
        'identity-unavailable': 'No exact thread match in previous snapshot',
        'snapshot-gap': 'Previous adjacent snapshot unavailable',
        'counter-missing': 'Allocated-byte counter unavailable',
        'counter-reset': 'Allocated-byte counter decreased or reset',
        'interval-unavailable': 'Time interval unavailable; allocation delta only',
        'interval-conflict': 'Snapshot and elapsed clocks disagree; allocation delta only',
    };
    return labels[status] || 'Unavailable';
}

function lockTransitionStatusLabel(status) {
    const labels = {
        compared: 'Compared with previous snapshot',
        'first-occurrence': 'No previous correlated occurrence',
        'identity-unavailable': 'No exact thread match in previous snapshot',
        'snapshot-gap': 'Previous adjacent snapshot unavailable',
        'observation-unavailable': 'Snapshots not comparable or lock information unavailable',
    };
    return Object.hasOwn(labels, status) ? labels[status] : (status || 'Unavailable');
}

function fmtElapsed(s) {
    if (s == null) return '—';

    if (s < 1) {
        return `${(s * 1000).toFixed(0)} ms`;
    }

    if (s < 60) {
        return `${s.toFixed(2)} s`;
    }

    const totalSeconds = s;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours === 0) {
        return `${minutes}m ${seconds.toFixed(2)}s`;
    }

    return `${hours}h ${minutes}m ${seconds.toFixed(2)}s`;
}
function getThreadStateDistribution(threads) {
    const counts = new Map();

    for (const t of threads || []) {
        const state = (t.javaState || 'UNKNOWN').trim() || 'UNKNOWN';
        counts.set(state, (counts.get(state) || 0) + 1);
    }

    return Array.from(counts.entries())
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count);
}

function getThreadStateColor(state) {
    switch (state) {
        case 'RUNNABLE':
            return '#79d6ad';
        case 'BLOCKED':
            return '#f0a6a6';
        case 'WAITING':
            return '#e8cb80';
        case 'TIMED_WAITING':
            return '#bdb0e8';
        case 'NEW':
            return '#9fc9ed';
        case 'TERMINATED':
            return '#adb8c8';
        default:
            return '#94a3b8';
    }
}

function hasReadClipboardParam() {
    const params = new URLSearchParams(window.location.search);
    return params.has('readclipboard');
}

function getBucketDistribution(values, bucketDefs) {
    const counts = bucketDefs.map((b) => ({
        label: b.label,
        color: b.color,
        count: 0
    }));

    for (const value of values) {
        if (value == null || !Number.isFinite(value)) continue;

        const bucket = bucketDefs.find((b) => b.test(value));
        if (bucket) {
            const idx = bucketDefs.indexOf(bucket);
            counts[idx].count += 1;
        }
    }

    return counts.filter((x) => x.count > 0);
}

function getCpuDistribution(threads) {
    return getBucketDistribution(
        (threads || []).map((t) => t.cpuMs),
        [
            { label: '0 ms', color: '#94a3b8', test: (v) => v === 0 },
            { label: '0–1 ms', color: '#7dd3fc', test: (v) => v > 0 && v < 1 },
            { label: '1–10 ms', color: '#4fc3f7', test: (v) => v >= 1 && v < 10 },
            { label: '10–100 ms', color: '#ffd666', test: (v) => v >= 10 && v < 100 },
            { label: '100+ ms', color: '#ff6b6b', test: (v) => v >= 100 }
        ]
    );
}

function getElapsedDistribution(threads) {
    return getBucketDistribution(
        (threads || []).map((t) => t.elapsedS),
        [
            { label: '<1s', color: '#7dd3fc', test: (v) => v < 1 },
            { label: '1–10s', color: '#4fc3f7', test: (v) => v >= 1 && v < 10 },
            { label: '10–60s', color: '#c792ea', test: (v) => v >= 10 && v < 60 },
            { label: '1–10m', color: '#ffd666', test: (v) => v >= 60 && v < 600 },
            { label: '10m+', color: '#ff6b6b', test: (v) => v >= 600 }
        ]
    );
}

function getAllocatedDistribution(threads) {
    return getBucketDistribution(
        (threads || []).map((t) => t.allocatedBytes),
        [
            { label: '0 B', color: '#94a3b8', test: (v) => v === 0 },
            { label: '1–4 KB', color: '#7dd3fc', test: (v) => v > 0 && v < 4096 },
            { label: '4–64 KB', color: '#4fc3f7', test: (v) => v >= 4096 && v < 65536 },
            { label: '64 KB–1 MB', color: '#ffd666', test: (v) => v >= 65536 && v < 1048576 },
            { label: '1–64 MB', color: '#f59e0b', test: (v) => v >= 1048576 && v < 64 * 1048576 },
            { label: '64 MB–1 GB', color: '#fb7185', test: (v) => v >= 64 * 1048576 && v < 1024 * 1048576 },
            { label: '1 GB+', color: '#ff6b6b', test: (v) => v >= 1024 * 1048576 }
        ]
    );
}

function getAllocationRateDistribution(threads) {
    return getBucketDistribution(
        (threads || []).map((t) => t.allocationRateBytesPerSecond),
        [
            { label: '0 B/s', color: '#94a3b8', test: (v) => v === 0 },
            { label: '<1 MiB/s', color: '#7dd3fc', test: (v) => v > 0 && v < 1048576 },
            { label: '1–10 MiB/s', color: '#4fc3f7', test: (v) => v >= 1048576 && v < 10 * 1048576 },
            { label: '10–64 MiB/s', color: '#ffd666', test: (v) => v >= 10 * 1048576 && v < 64 * 1048576 },
            { label: '64 MiB/s+', color: '#ff6b6b', test: (v) => v >= 64 * 1048576 }
        ]
    );
}

function normalizeLockId(lockId) {
    return String(lockId || '').trim().toLowerCase();
}


function clearDeadlockLockHover() {
    if (!UI.deadlockedThreadsModalBody) return;

    UI.deadlockedThreadsModalBody
        .querySelectorAll('.deadlock-lock-ref.is-lock-hover')
        .forEach((el) => el.classList.remove('is-lock-hover'));
}

function setDeadlockLockHover(lockId) {
    if (!UI.deadlockedThreadsModalBody) return;

    const norm = normalizeLockId(lockId);
    clearDeadlockLockHover();
    if (!norm) return;

    UI.deadlockedThreadsModalBody
        .querySelectorAll(`.deadlock-lock-ref[data-lock-id="${CSS.escape(norm)}"]`)
        .forEach((el) => el.classList.add('is-lock-hover'));
}

function renderHighlightedStackLine(line, thread) {
    const waitingId = normalizeLockId(thread?.deadlockWaitingLockId);
    const holdingId = normalizeLockId(thread?.deadlockHoldingLockId);
    const raw = String(line || '');

    if (!raw.trim()) {
        return '';
    }

    const norm = raw.toLowerCase();
    const escaped = escapeHtml(raw);

    if (waitingId && norm.includes(`waiting to lock <${waitingId}>`)) {
        return `
          <div class="deadlock-stack-line deadlock-stack-line-waiting deadlock-lock-ref"
               data-lock-id="${escapeAttr(waitingId)}">
            <span class="deadlock-inline-badge deadlock-inline-badge-waiting">WAITING FOR</span>
            <span class="mono-wrap">${escaped}</span>
          </div>
        `;
    }

    if (holdingId && norm.includes(`- locked <${holdingId}>`)) {
        return `
          <div class="deadlock-stack-line deadlock-stack-line-holding deadlock-lock-ref"
               data-lock-id="${escapeAttr(holdingId)}">
            <span class="deadlock-inline-badge deadlock-inline-badge-holding">HOLDING</span>
            <span class="mono-wrap">${escaped}</span>
          </div>
        `;
    }

    return `<div class="deadlock-stack-line"><span class="mono-wrap">${escaped}</span></div>`;
}
function tooltipAttr(value) {
    if (value == null) return '';
    const text = String(value).trim();
    if (!text) return '';
    return ` data-tooltip="${escapeAttr(text)}"`;
}

// ---- model/state ----
let parsedDumps = [];
let threadSeries = [];
let selectedDumpIndex = 0;

let allThreads = [];
let filtered = [];
let sessionSources = [];
let nextSessionSourceId = 0;
let parserResult = null;
let deadlocks = [];
let classInitializationChains = [];
let contentionChains = [];
let smartAnalysis = null;
let runnableStackClusters = [];
let runnableClusterPage = 1;
const RUNNABLE_CLUSTER_PAGE_SIZE = 25;
let sortState = { key: 'cpuMs', dir: 'desc' };
let pageState = { page: 1, pageSize: 50 };
let chartFilterState = null;
let cpuTimelineState = { query: '', limit: 10, selectedSeriesKey: '' };
let cpuTimelineModelCache = null;
const inputFeedbackDialog = createInputFeedbackDialog(document.getElementById('inputFeedbackModal'), {
    chooseFiles: () => UI.fileInput?.click(),
    fallbackFocus: () => UI.fileInput,
});
const inputRequestGate = createLatestInputRequestGate();
let exampleReadController = null;
const analysisClient = createAnalysisClient();
const sessionInputQueue = createSessionInputQueue(busy => {
    setInputBusy(busy);
    if (UI.cpuThresholdProfile) UI.cpuThresholdProfile.disabled = busy;
});
let cpuThresholdProfileId = runnableCpuThresholdProfileFromSearch(window.location.search);
let cpuThresholdProfile = getRunnableCpuThresholdProfile(cpuThresholdProfileId);
let runnableClusterFilterState = {
    persistentOnly: false,
    growingOnly: false,
    minDumpsSeen: 2
};

// ---- filtering/sorting/paging ----
function normalize(s) {
    return String(s || '').toLowerCase();
}

function applyFilters() {
    const stateGroups = [];
    if (UI.onlyBlockedToggle.checked) stateGroups.push('BLOCKED');
    if (UI.onlyWaitingToggle.checked) stateGroups.push('WAITING');
    const focusedIndexes = isRunnableClusterTableFilteredToFocus()
        ? getRunnableClusterFocusThreadIndexSet()
        : null;

    filtered = filterThreads(allThreads, {
        searchTerm: UI.searchInput.value,
        onlyDaemon: UI.onlyDaemonToggle.checked,
        stateGroups,
        onlyDeadlocked: UI.onlyDeadlockedToggle.checked,
        onlyCarrier: UI.onlyCarrierToggle.checked,
        chartFilter: chartFilterState,
    }, focusedIndexes);

    filtered.forEach((t, i) => (t._displayIndex = i + 1));

    applySort();
}




function getRunnableCompareBaselineMatch(group, baselineGroup) {
    const currentMember = group?.members?.[0] || null;
    const baselineMember = baselineGroup?.members?.[0] || null;

    if (!currentMember || !baselineMember) {
        return {
            method: 'variant-merge',
            score: 0,
            summary: 'No baseline match data'
        };
    }

    if (currentMember === baselineMember) {
        return {
            method: 'normalized-exact',
            score: 1,
            summary: 'Reference stack'
        };
    }

    return scoreRunnableStackSimilarityDetailed(currentMember, baselineMember);
}

function getBaselineSimilarityScoreTooltip(method, score) {
    const pct = Math.round(Number(score || 0) * 100);
    const methodLabel = getSimilarityMethodLabel(method);
    const methodExplanation = getSimilarityMethodTooltip(method);

    return `${methodLabel} • baseline similarity ${pct}%.

This score is calculated against stack shape 1 in the side-by-side comparison view.
100% means this stack shape is effectively identical to stack shape 1 after normalization.
Lower values mean it is still related, but differs more from the reference stack.

${methodExplanation}`;
}








function getSimilarityMethodLabel(method) {
    switch (String(method || '')) {
        case 'normalized-exact': return 'Normalized exact';
        case 'common-tail': return 'Common tail';
        case 'shifted-subsequence': return 'Shifted subsequence';
        case 'near-sequence': return 'Near sequence';
        case 'frame-overlap': return 'Frame overlap';
        case 'variant-merge': return 'Variant merge';
        default: return 'Similarity match';
    }
}


function getClusterSeenTooltip(cluster) {
    const seen = Number(cluster?.dumpCountSeen || 0);
    const total = Number(parsedDumps?.length || 0);

    return compactTooltip(
        `Seen in ${seen} of ${total} snapshots. This tells you how widespread this stack shape is across the loaded thread dumps.`
    );
}

function getClusterTotalTooltip(cluster) {
    const totalOccurrences = Number(cluster?.totalOccurrences || 0);

    return compactTooltip(
        `Total number of matching thread occurrences across all snapshots: ${totalOccurrences}. If the same stack shape appears multiple times in the same snapshot, each occurrence is counted.`
    );
}

function getClusterRunTooltip(cluster) {
    const run = Number(cluster?.longestConsecutiveRun || 0);

    return compactTooltip(
        `Longest consecutive snapshot streak: ${run}. This shows for how many snapshots in a row this stack shape kept appearing without a gap.`
    );
}

function getClusterSimilarityTooltip(cluster) {
    const avg = Number(cluster?.quality?.averageSimilarity || 0);
    const pct = Math.round(avg * 100);

    return compactTooltip(
        `Average similarity inside this cluster: ${pct}%. Higher means the grouped stacks are more alike. Lower means the cluster contains more variation.`
    );
}

function getClusterPrimaryGroupingTooltip(cluster) {
    const primaryMethod = String(cluster?.primaryMethod || 'variant-merge');
    const methodLabel = getSimilarityMethodLabel(primaryMethod);
    const methodExplanation = getSimilarityMethodTooltip(primaryMethod);

    return compactTooltip(
        `Primary grouping: ${methodLabel}. ${methodExplanation}`
    );
}
function compactTooltip(text) {
    return String(text || '')
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function getSimilarityMethodTooltip(method) {
    switch (String(method || '')) {
        case 'normalized-exact':
            return 'Threads in this cluster have the same normalized top stack signature. Volatile parts such as thread-specific headers are ignored, and the normalized stack frames are compared directly.';
        case 'common-tail':
            return 'Threads are grouped because they share the same execution tail. This usually means they converge into the same downstream call path even if upper frames differ.';
        case 'shifted-subsequence':
            return 'Threads are grouped because they contain the same contiguous frame sequence, but that sequence appears at a different stack depth.';
        case 'near-sequence':
            return 'Threads are grouped because many normalized frames appear in the same relative order, even though the stacks are not identical.';
        case 'frame-overlap':
            return 'Threads are grouped because they share a meaningful overlap of normalized frames, even if ordering and depth are less exact.';
        case 'variant-merge':
            return 'Threads were merged into the same broader cluster heuristically because they are similar enough to an existing representative stack.';
        default:
            return 'This shows the dominant similarity method used when matching threads into this recurring runnable cluster.';
    }
}











function renderFocusFilterBar() {
    if (!UI.focusFilterBar || !UI.focusFilterSummary || !UI.clearFocusFilterBtn) return;
    const visibleFocused = getFocusedThreadsInFilteredOrder().length;
    const dumpLabel = parsedDumps?.[selectedDumpIndex]?.timestamp || `Dump ${selectedDumpIndex + 1}`;
    const view = getFocusedTableView(
        runnableClusterTableFocusState,
        selectedDumpIndex,
        visibleFocused,
        dumpLabel,
    );

    if (!view.isActive) {
        UI.focusFilterBar.classList.add('hidden');
        UI.focusFilterSummary.innerHTML = '';
        UI.clearFocusFilterBtn.classList.add('hidden');
        return;
    }

    UI.focusFilterBar.classList.remove('hidden');
    UI.focusFilterSummary.innerHTML = `
      <span class="chart-filter-chip">Focused table</span>
      <strong>${escapeHtml(view.clusterId)}</strong>
      <span>${escapeHtml(view.dumpLabel)}</span>
      <span class="chart-filter-count">${escapeHtml(view.countText)}</span>
    `;
    UI.clearFocusFilterBtn.classList.remove('hidden');
}
function hasRunnableClusterTableFocus() {
    return isFocusedTableActive(runnableClusterTableFocusState, selectedDumpIndex);
}

function isRunnableClusterTableFilteredToFocus() {
    return hasRunnableClusterTableFocus() &&
        runnableClusterTableFocusState.filterTableToFocus === true;
}

function getRunnableClusterFocusThreadIndexSet() {
    return focusedThreadIndexSet(runnableClusterTableFocusState, selectedDumpIndex);
}

function resetRunnableClusterTableFocusAndRender() {
    clearRunnableClusterTableFocus();
    pageState.page = 1;
    applyFilters();
    render();
    if (UI.focusFilterAnnouncement) {
        UI.focusFilterAnnouncement.textContent = `Table focus cleared. Showing ${filtered.length} of ${allThreads.length} threads after remaining filters.`;
    }
    UI.searchInput?.focus();
}
function isRunnableClusterThreadFocused(thread) {
    if (!runnableClusterTableFocusState?.active) return false;
    if (runnableClusterTableFocusState.dumpIndex !== selectedDumpIndex) return false;

    return runnableClusterTableFocusState.threadIndexes.includes(thread.index);
}
function getRunnableClusterFocusVisibilitySummary() {
    if (!runnableClusterTableFocusState?.active) {
        return null;
    }

    const totalFocused = (runnableClusterTableFocusState.threadIndexes || []).length;
    const visibleFocused = getFocusedThreadsInFilteredOrder().length;

    return {
        totalFocused,
        visibleFocused,
        hiddenFocused: Math.max(0, totalFocused - visibleFocused)
    };
}
function scrollToFocusedThreadRow() {
    requestAnimationFrame(() => {
        const row = UI.tbody?.querySelector('tr.thread-row-focused');
        if (!row) return;

        row.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
    });
}


function getFocusedThreadsInFilteredOrder() {
    if (!isRunnableClusterTableFilteredToFocus()) return [];

    const focusedIndexes = new Set(
        (runnableClusterTableFocusState.threadIndexes || []).map(Number)
    );

    return filtered.filter((t) => focusedIndexes.has(Number(t.index)));
}

function syncPageToRunnableClusterFocus() {
    if (!runnableClusterTableFocusState?.active) return;

    const focusedThreads = getFocusedThreadsInFilteredOrder();
    if (!focusedThreads.length) return;

    const firstFocused = focusedThreads[0];
    const filteredIndex = filtered.findIndex((t) => t.index === firstFocused.index);
    if (filteredIndex < 0) return;

    const pageSize = Number(pageState.pageSize || 50);
    pageState.page = Math.floor(filteredIndex / pageSize) + 1;
}
function focusRunnableClusterInDump(clusterId, dumpIndex) {
    const cluster = getClusterById(clusterId);
    if (!cluster) {
        clearRunnableClusterTableFocus();
        return;
    }
    runnableClusterTableFocusState = createFocusedTableState(clusterId, dumpIndex, cluster.members);
}
















function isChartFilterActive(kind, value) {
    return getChartLegendItemView(kind, value, chartFilterState).isActive;
}

function getChartSliceOpacity(kind, value) {
    return getChartLegendItemView(kind, value, chartFilterState).opacity;
}

function toggleChartFilter(kind, value, label) {
    if (isChartFilterActive(kind, value)) {
        chartFilterState = null;
    } else {
        chartFilterState = { kind, value, label };
    }

    pageState.page = 1;
    applyFilters();
    render();
}

function clearChartFilter() {
    if (!chartFilterState) return;

    chartFilterState = null;
    pageState.page = 1;
    applyFilters();
    render();
    if (UI.chartFilterAnnouncement) {
        UI.chartFilterAnnouncement.textContent = `Chart filter cleared. Showing ${filtered.length} of ${allThreads.length} threads after remaining table filters.`;
    }
    UI.searchInput?.focus();
}








function getSimilarityScoreTooltip(method, score) {
    const pct = Math.round(Number(score || 0) * 100);
    const methodLabel = getSimilarityMethodLabel(method);
    const methodExplanation = getSimilarityMethodTooltip(method);

    return `${methodLabel} • similarity score ${pct}%.

This is the relative similarity between this stack shape and the cluster representative.
100% means effectively identical after normalization.
Lower values mean the stack was grouped heuristically because it still looked close enough to belong to the same recurring pattern.

${methodExplanation}`;
}


function getRunnableClusterTrendTooltip(trendRaw) {
    const trend = String(trendRaw || '').trim().toLowerCase();

    switch (trend) {
        case 'growing':
            return compactTooltip(
                'Growing compares observed thread counts: the last endpoint has more threads with this stack shape than the first. ' +
                'Intermediate counts may fluctuate. This does not measure CPU load or continuous execution.'
            );

        case 'persistent':
            return compactTooltip(
                'Persistent means this stack shape is present in every snapshot with equal first and last counts. ' +
                'Intermediate counts may vary; repeated observations do not prove continuous activity.'
            );

        case 'fading':
            return compactTooltip(
                'Fading compares observed thread counts: the last endpoint has fewer threads with this stack shape than the first. ' +
                'This does not prove that work slowed down or finished.'
            );

        case 'bursty':
            return compactTooltip(
                'Bursty means this stack shape was observed in at most two snapshots and absent from others. ' +
                'It does not measure how long a burst lasted.'
            );

        case 'intermittent':
            return compactTooltip(
                'Intermittent means this stack shape was observed in at least three snapshots with an absent snapshot between observations. ' +
                'The gaps describe captured counts, not proven periods of inactivity.'
            );

        case 'stable':
            return compactTooltip(
                'Stable means a consecutive observed run has equal first and last counts, while the shape is absent from some other snapshots. ' +
                'It does not imply stable CPU usage or application health.'
            );

        case 'unavailable':
            return compactTooltip('Trend unavailable: snapshots are incomplete or have different processes or collection coverage. Counts in incomplete snapshots are lower bounds, not evidence of reduced activity.');

        case 'none':
            return compactTooltip(
                'No clear trend could be determined for this stack shape.'
            );

        default:
            return compactTooltip(
                'This badge summarizes how the presence of this runnable stack shape changes across snapshots.'
            );
    }
}

function getRunnableClusterMixedMethodsTooltip(cluster) {
    const breakdown = Array.isArray(cluster?.methodBreakdown) ? cluster.methodBreakdown : [];

    if (!breakdown.length) {
        return compactTooltip(
            'Mixed methods means the cluster was grouped using more than one similarity rule.'
        );
    }

    const methodsText = breakdown
        .map((entry) => `${getSimilarityMethodLabel(entry.method)}: ${entry.count}`)
        .join(', ');

    return compactTooltip(
        'Mixed methods means the threads in this cluster were not all grouped in exactly the same way. ' +
        'Some matched by exact or very close stack similarity, while others matched by looser similarity rules. ' +
        `Breakdown: ${methodsText}.`
    );
}



function renderChartFilterBar() {
    if (!UI.chartFilterSummary) return;
    const view = getChartFilterView(chartFilterState, allThreads.length, filtered.length);

    if (!view.isActive) {
        if (UI.chartFilterBar) {
            UI.chartFilterBar.classList.add('hidden');
        }

        UI.chartFilterSummary.innerHTML = '';

        if (UI.clearChartFilterBtn) {
            UI.clearChartFilterBtn.classList.add('hidden');
        }
        return;
    }

    if (UI.chartFilterBar) {
        UI.chartFilterBar.classList.remove('hidden');
    }

    UI.chartFilterSummary.innerHTML = `
            <span class="chart-filter-chip">Chart filter</span>
            <strong>${escapeHtml(view.label)}</strong>
            <span class="chart-filter-count">${escapeHtml(view.countText)}</span>
    `;

    if (UI.clearChartFilterBtn) {
        UI.clearChartFilterBtn.classList.remove('hidden');
    }
}

function getSortValue(t, key) {
    const v = t[key];
    if (v == null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (key === 'carrierVirtualThreadId') return Number(v) || 0;
    if (key === 'locksHeldCount') return Number(v) || 0;
    return v;
}

function applySort() {
    const { key, dir } = sortState;
    const mul = dir === 'asc' ? 1 : -1;

    filtered.sort((a, b) => {
        const av = getSortValue(a, key);
        const bv = getSortValue(b, key);

        // numbers
        if (typeof av === 'number' || typeof bv === 'number') {
            const an = typeof av === 'number' ? av : Number.NEGATIVE_INFINITY;
            const bn = typeof bv === 'number' ? bv : Number.NEGATIVE_INFINITY;
            if (an !== bn) return (an - bn) * mul;
            return (a.index - b.index) * 0.0001;
        }

        const as = normalize(av);
        const bs = normalize(bv);
        if (as < bs) return -1 * mul;
        if (as > bs) return 1 * mul;
        return (a.index - b.index) * 0.0001;
    });

    // reset to first page when resorting
    pageState.page = 1;
    render();
}

function getPageSlice(list) {
    const { page, pageSize } = pageState;
    const start = (page - 1) * pageSize;
    return list.slice(start, start + pageSize);
}

function renderPager(total) {
    const { page, pageSize } = pageState;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const clamp = (n) => Math.max(1, Math.min(pages, n));

    const parts = [];
    const mkBtn = (label, target, disabled = false, tooltip = '') =>
        `<button class="btn btn-sm has-tooltip" type="button" data-page="${target}" ${disabled ? 'disabled' : ''} ${tooltip ? `data-tooltip="${escapeAttr(tooltip)}"` : ''}>${label}</button>`;

    parts.push(mkBtn('⏮', 1, page === 1, 'First page'));
    parts.push(mkBtn('◀', clamp(page - 1), page === 1, 'Previous page'));

    // compact page window
    const windowSize = 7;
    const half = Math.floor(windowSize / 2);
    let from = Math.max(1, page - half);
    let to = Math.min(pages, from + windowSize - 1);
    from = Math.max(1, to - windowSize + 1);

    if (from > 1) parts.push(`<span class="muted" style="padding:0 6px;">…</span>`);
    for (let p = from;p <= to;p++) {
        parts.push(mkBtn(String(p), p, p === page, `Page ${p}`));
    }
    if (to < pages) parts.push(`<span class="muted" style="padding:0 6px;">…</span>`);

    parts.push(mkBtn('▶', clamp(page + 1), page === pages, 'Next page'));
    parts.push(mkBtn('⏭', pages, page === pages, 'Last page'));

    UI.pager.innerHTML = parts.join(' ');
}

function badgeYesNo(v) {
    return `<span class="tda-value-neutral">${v ? 'Yes' : 'No'}</span>`;
}

function carrierBadge(thread) {
    const ids = observedVirtualThreadIds(thread);
    if (thread?.isCarrierThread && ids.length) {
        const label = ids.map(id => `#${id}`).join(', ');
        return `<span class="badge badge-carrier has-tooltip" data-tooltip="Observed carrying virtual thread(s) ${escapeAttr(label)}">VT ${escapeHtml(label)}</span>`;
    }
    return `<span class="tda-value-neutral">—</span>`;
}
function deadlockBadge(v) {
    if (v) {
        return `<span class="badge badge-failure has-tooltip" data-tooltip="Confirmed Java deadlock">DEADLOCK</span>`;
    }
    return `<span class="tda-value-neutral">—</span>`;
}

function diagnosticEvidenceMarker(evidence) {
    if (!evidence) return '';
    return `<span class="evidence-marker evidence-marker-${escapeAttr(evidence.level)}">${escapeHtml(evidence.label)}</span>`;
}

function diagnosticTooltipAttributes({
    title,
    reason,
    confidence,
    evidence,
    patternScore = null,
    signals = [],
    matchedFrames = [],
}) {
    const payload = {
        title: String(title || 'Diagnostic'),
        reason: String(reason || ''),
        confidence: String(confidence || 'low'),
        evidence: evidence ? {
            level: String(evidence.level || 'unclassified'),
            label: String(evidence.label || 'UNCLASSIFIED'),
            basis: String(evidence.basis || ''),
            qualification: String(evidence.qualification || ''),
        } : null,
        patternScore: Number.isFinite(patternScore) ? patternScore : null,
        signals: (signals || []).slice(0, 6).map((signal) => ({
            label: String(signal?.label || signal?.id || 'Signal'),
            points: Number.isFinite(signal?.points) ? signal.points : null,
        })),
        matchedFrames: (matchedFrames || []).slice(0, 3).map((frame) => String(frame || '')),
        omittedFrameCount: Math.max(0, (matchedFrames || []).length - 3),
    };
    return `data-tooltip="${escapeAttr(payload.reason || payload.title)}" ` +
        `data-tooltip-format="diagnostic" data-tooltip-data="${escapeAttr(JSON.stringify(payload))}"`;
}

function scenarioBadge(thread) {
    if (!thread?.scenarioLabel) {
        return '';
    }

    const severity = String(thread.scenarioSeverity || 'info');
    const confidence = String(thread.scenarioConfidence || 'low');
    const tooltipAttributes = diagnosticTooltipAttributes({
        title: thread.scenarioLabel,
        reason: thread.scenarioReason,
        confidence,
        evidence: thread.scenarioEvidence,
        patternScore: thread.scenarioPatternScore,
        signals: thread.scenarioPatternSignals,
        matchedFrames: thread.scenarioMatchedFrames,
    });

    const emoji =
        thread.scenarioKey === 'cpu-hot' ? '🔥 ' :
            thread.scenarioKey === 'allocation-hot' ? '📦 ' :
            thread.scenarioKey === 'hot-selector-event-loop' ? '🛰️ ' :
                thread.scenarioKey === 'selector-event-loop' ? '🧭 ' :
                    thread.scenarioKey === 'deadlock' ? '💀 ' :
                        thread.scenarioKey === 'class-initialization-stall' ? '⚠️ ' :
                            thread.scenarioKey === 'class-initialization-wait' ? '🧩 ' :
                                thread.scenarioKey === 'class-initializer-with-waiters' ? '🧩 ' :
                        thread.scenarioKey === 'possible-starvation' ? '⏳ ' :
                            thread.scenarioKey === 'possible-livelock' ? '🔁 ' :
                                '';

    return `
        <span class="diagnostic-label has-tooltip" ${tooltipAttributes}>
          <span class="scenario-badge scenario-badge-${escapeAttr(severity)}">${emoji}${escapeHtml(thread.scenarioLabel)}</span>
          ${diagnosticEvidenceMarker(thread.scenarioEvidence)}
          ${Number.isFinite(thread.scenarioPatternScore)
                ? `<span class="pattern-score-marker">${escapeHtml(`${thread.scenarioPatternScore}/100`)}</span>`
                : ''}
        </span>
    `;
}
function findingBadges(thread) {
    if (!Array.isArray(thread?.findings) || !thread.findings.length) {
        return '';
    }

    const visibleFindings = thread.findings.filter((f) => f.key !== thread.scenarioKey);

    if (!visibleFindings.length) {
        return '';
    }

    return `
        <div class="thread-findings">
            ${visibleFindings.map((f) => {
                const tooltipAttributes = diagnosticTooltipAttributes({
                    title: f.label,
                    reason: f.reason,
                    confidence: f.confidence,
                    evidence: f.evidence,
                });
                return `
                <span class="diagnostic-label has-tooltip" ${tooltipAttributes}>
                <span
                    class="scenario-badge ${f.key === 'cpu-hot'
            ? 'scenario-badge-cpu'
            : 'scenario-badge-' + escapeAttr(f.severity || 'info')
        } scenario-badge-subtle">
                    ${f.key === 'cpu-hot' ? '🔥 ' : f.key === 'allocation-hot' ? '📦 ' : f.key === 'possible-livelock' ? '🔁 ' : ''}${escapeHtml(f.label)}
                </span>
                ${diagnosticEvidenceMarker(f.evidence)}
                </span>
            `;
            }).join('')}
        </div>
    `;
}

function seriesTrendPresentation(trend) {
    const presentations = {
        growing: { icon: '↗', label: 'Growing' },
        shrinking: { icon: '↘', label: 'Shrinking' },
        stable: { icon: '→', label: 'Stable' },
        'insufficient-data': { icon: '…', label: 'Insufficient data' },
    };
    return presentations[trend] || presentations['insufficient-data'];
}

function seriesStatusLabel(status) {
    const labels = {
        available: 'Exact adjacent series',
        'insufficient-data': 'Insufficient data',
        'identity-unavailable': 'Identity unavailable',
        'snapshot-gap': 'Snapshot gap',
    };
    return labels[status] || 'Unavailable';
}

function currentScenarioSeriesDiagnostic(thread) {
    const scenarioKey = String(thread?.scenarioKey || '');
    if (!scenarioKey) return null;
    return (thread?.crossSnapshotDiagnostics?.diagnostics || [])
        .find((diagnostic) => diagnostic.key === scenarioKey) || null;
}

function seriesDiagnosticBadge(thread) {
    const summary = thread?.crossSnapshotDiagnostics;
    const diagnostic = currentScenarioSeriesDiagnostic(thread);
    if (!summary || summary.occurrenceCount < 2 || !diagnostic) return '';

    const presentation = seriesTrendPresentation(diagnostic.trend);
    const reason = `${diagnostic.reason} Observed in ${diagnostic.count} of ` +
        `${diagnostic.totalOccurrences} exact series endpoints. ${summary.qualification}`;
    const tooltipAttributes = diagnosticTooltipAttributes({
        title: `${diagnostic.label} cross-snapshot trend`,
        reason,
        confidence: diagnostic.confidence,
        evidence: diagnostic.evidence,
    });

    return `
        <span class="series-diagnostic-badge series-trend-${escapeAttr(diagnostic.trend)} has-tooltip"
              ${tooltipAttributes}>
          ${presentation.icon} ${escapeHtml(`${diagnostic.count}/${diagnostic.totalOccurrences}`)} snapshots
        </span>
    `;
}

function snapshotChangeStatusLabel(status) {
    const labels = {
        baseline: 'Baseline snapshot',
        new: 'New since previous snapshot',
        continued: 'Exactly matched to previous snapshot',
        unresolved: 'Previous identity could not be resolved safely',
    };
    return labels[status] || 'Unavailable';
}

function snapshotChangeSummary(thread) {
    const change = thread?.snapshotChange;
    if (!change) return 'Unavailable';
    if (!change.changes?.length) return snapshotChangeStatusLabel(change.status);
    return change.changes.map((entry) => entry.label).join(', ');
}

function boundedTooltipLines(items, emptyMessage, limit = 20) {
    const lines = (items || []).map((item) => String(item || '')).filter(Boolean);
    if (!lines.length) return emptyMessage;
    const visible = lines.slice(0, limit);
    if (lines.length > limit) visible.push(`…and ${lines.length - limit} more`);
    return visible.join('\n');
}

function threadChangeBadge(thread) {
    const change = thread?.snapshotChange;
    if (!change || change.status === 'baseline') return '';

    if (change.status === 'new') {
        return '<span class="badge badge-success has-tooltip" data-tooltip="New thread identity since the previous snapshot">NEW</span>';
    }
    if (change.status === 'unresolved') {
        return '<span class="badge has-tooltip" data-tooltip="Previous thread identity could not be resolved safely">IDENTITY?</span>';
    }
    if (!change.changes?.length) return '';

    const tooltip = `Changed since previous snapshot: ${snapshotChangeSummary(thread)}`;
    return `<span class="badge has-tooltip" data-tooltip="${escapeAttr(tooltip)}">Δ ${change.changes.length}</span>`;
}

function locksHeldBadge(thread) {
    const locks = Array.isArray(thread?.heldLocks) ? thread.heldLocks : [];
    const count = locks.length;

    if (count === 0) {
        return `<span class="tda-value-neutral">—</span>`;
    }

    const tooltip = locks
        .map((l) => `${l.lockId || '—'}${l.lockType ? ` (${l.lockType})` : ''}`)
        .join('\n');

    return `<span class="badge badge-locks has-tooltip" data-tooltip="${escapeAttr(tooltip)}">${escapeHtml(String(count))} lock${count === 1 ? '' : 's'}</span>`;
}
function stateBadge(state) {
    const st = String(state || '').trim();
    if (!st) return `<span class="tda-value-neutral">—</span>`;
    return `<span class="badge tda-state-badge" data-java-state="${escapeAttr(st.split(' \u00b7 ')[0].toUpperCase())}">${escapeHtml(st)}</span>`;
}

function renderTableRows() {
    const view = getPageSlice(filtered);

    UI.tbody.innerHTML = view
        .map((t) => {
            const cpu = fmtCpu(t.cpuMs);
            const cpuDelta = fmtCpu(t.cpuDeltaMs);
            const cpuRate = `${t.cpuIntervalQuality === 'estimated' ? '≈ ' : ''}${fmtCpuRate(t.cpuRatePercent)}`;
            const elapsed = fmtElapsed(t.elapsedS);
            const displayIndex = t._displayIndex ?? t.index ?? '—';
            const threadName = t.threadName ?? '—';
            const stateText = t.stateText || '—';
            const topFrameText = t.topFrame || '—';
            const stackFrames = t.stackFrames ?? 0;
            const allocated = t.allocated ?? '—';
            const allocationRate = `${t.allocationIntervalQuality === 'estimated' ? '≈ ' : ''}${fmtAllocationRate(t.allocationRateBytesPerSecond)}`;
            const definedClasses = t.definedClasses ?? '—';
            const nativeIdDec = t.nativeIdDec ?? '—';
            const prio = t.prio ?? '—';
            const osPrio = t.osPrio ?? '—';

            const threadTooltipParts = [
                threadName,
                t.javaState ? `State: ${t.javaState}` : null,
                t.nativeIdDec != null ? `nid: ${t.nativeIdDec}` : null,
                t.topFrame ? `Top: ${t.topFrame}` : null
            ].filter(Boolean);

            const threadTooltip = threadTooltipParts.join('\n');
            const cpuTooltip = [
                `Cumulative CPU: ${cpu}`,
                `CPU delta: ${cpuDelta}`,
                `CPU rate: ${cpuRate}`,
                `Rate basis: ${cpuRateBasisLabel(t.cpuRateBasis)}`,
                `Delta status: ${cpuDeltaStatusLabel(t.cpuDeltaStatus)}`,
                ...(t.cpuIntervalReason ? [t.cpuIntervalReason] : []),
            ].join('\n');
            const allocationTooltip = [
                `Cumulative allocated: ${allocated}`,
                `Allocation delta: ${fmtBytes(t.allocatedDeltaBytes)}`,
                `Allocation rate: ${allocationRate}`,
                `Rate basis: ${cpuRateBasisLabel(t.allocationRateBasis)}`,
                `Delta status: ${allocationDeltaStatusLabel(t.allocationDeltaStatus)}`,
                ...(t.allocationIntervalReason ? [t.allocationIntervalReason] : []),
                'Allocated bytes are cumulative heap allocation, not retained/live heap.',
            ].join('\n');

            const top = t.topFrame
                ? `<span class="mono-small has-tooltip"${tooltipAttr(t.topFrame)}>${escapeHtml(t.topFrame)}</span>`
                : '—';

				const isFocused = isRunnableClusterThreadFocused(t);
				const rowClass = isFocused ? 'thread-row-focused' : '';
				
            return `
                <tr class="thread-details-row ${rowClass}"
                    data-source-key="${escapeAttr(t.sourceKey)}" tabindex="0"
                    aria-label="${escapeAttr(`Open details for ${threadName}`)}">
                  <td class="right thread-metadata"${tooltipAttr(displayIndex)}>${escapeHtml(displayIndex)}</td>

				  <td>
				    <div class="thread-cell">
				      <span class="mono thread-cell-name has-tooltip"${tooltipAttr(threadTooltip)}>${escapeHtml(threadName)}</span>
                                            ${threadChangeBadge(t)}
                      <div class="thread-diagnostic-summary">
                        ${scenarioBadge(t)}
                        ${seriesDiagnosticBadge(t)}
                      </div>
                      ${findingBadges(t)}
                    </div>
                  </td>

                  <td${tooltipAttr(t.javaState || '—')}>${stateBadge(t.javaState)}</td>
                  <td${tooltipAttr(Array.isArray(t.heldLocks) ? t.heldLocks.map((l) => `${l.lockId || '—'}${l.lockType ? ` (${l.lockType})` : ''}`).join('\n') : '—')}>${locksHeldBadge(t)}</td>
                  <td${tooltipAttr(t.isDeadlocked ? 'Confirmed Java deadlock' : '—')}>${deadlockBadge(t.isDeadlocked)}</td>
                  <td${tooltipAttr(t.daemon == null ? 'Daemon status not provided by this dump format' : t.daemon ? 'Daemon thread' : 'Not daemon')}>${t.daemon == null ? '—' : badgeYesNo(t.daemon)}</td>

                  <td class="right thread-metadata"${tooltipAttr(prio)}>${escapeHtml(prio)}</td>
                  <td class="right thread-metadata"${tooltipAttr(osPrio)}>${escapeHtml(osPrio)}</td>
                  <td class="right"${tooltipAttr(cpuTooltip)}>${escapeHtml(cpu)}</td>
                  <td class="right"${tooltipAttr(elapsed)}>${escapeHtml(elapsed)}</td>
                  <td class="right"${tooltipAttr(allocationTooltip)}>${escapeHtml(allocated)}</td>
                  <td class="right"${tooltipAttr(allocationTooltip)}>${escapeHtml(allocationRate)}</td>
                  <td class="right thread-metadata"${tooltipAttr(definedClasses)}>${escapeHtml(definedClasses)}</td>
                  <td class="right thread-metadata"${tooltipAttr(nativeIdDec)}>${escapeHtml(nativeIdDec)}</td>
                  <td${tooltipAttr(stateText)}>${escapeHtml(stateText)}</td>
                  <td${tooltipAttr(topFrameText)}>${top}</td>
                  <td class="right thread-metadata"${tooltipAttr(stackFrames)}>${escapeHtml(stackFrames)}</td>
                  <td>${carrierBadge(t)}</td>

                  <td>
                    <button
                     class="btn btn-sm details-btn has-tooltip"
                      type="button"
                      data-source-key="${escapeAttr(t.sourceKey)}"
                      data-tooltip="Open thread details">
                      Details
                    </button>
                  </td>
                </tr>
            `;
        })
        .join('');

    const total = filtered.length;
    const { page, pageSize } = pageState;
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(total, (page - 1) * pageSize + pageSize);

	if (total === 0) {
	    UI.rowCount.textContent = '0 threads';
	} else if (isRunnableClusterTableFilteredToFocus()) {
	    UI.rowCount.textContent = `${start}–${end} of ${total} focused thread${total === 1 ? '' : 's'}`;
	} else {
	    UI.rowCount.textContent = `${start}–${end} of ${total} threads`;
	}

	
	const selectedDump = parsedDumps?.[selectedDumpIndex] || null;
	if (UI.dumpPointInTime) {
        const timePresentation = selectedDump ? formatSnapshotTime(selectedDump) : null;
        UI.dumpPointInTime.textContent = timePresentation
            ? `• ${timePresentation.headline} • ${timePresentation.qualityLabel}`
            : '';
        UI.dumpPointInTime.title = timePresentation?.tooltip || '';
        UI.dumpPointInTime.dataset.timeStatus = timePresentation?.severity || '';
	}
	
    renderPager(total);
}

function renderStats() {
    const total = allThreads.length;
    const visibleTableText = filtered.length === total
        ? ''
        : ` • VISIBLE TABLE: ${filtered.length}/${total}`;
    const runnable = allThreads.filter((t) => t.javaState === 'RUNNABLE').length;
    const blocked = allThreads.filter((t) => t.javaState === 'BLOCKED').length;
    const waiting = allThreads.filter((t) => t.javaState === 'WAITING' || t.javaState === 'TIMED_WAITING').length;
    const daemon = allThreads.filter((t) => t.daemon).length;
    const deadlocked = allThreads.filter((t) => t.isDeadlocked).length;
    const carriers = allThreads.filter((t) => t.isCarrierThread).length;

    const cpuHot = allThreads.filter((thread) => hasThreadDiagnostic(thread, 'cpu-hot')).length;
    const allocationHot = allThreads.filter((thread) => hasThreadDiagnostic(thread, 'allocation-hot')).length;
    const idleExecutors = allThreads.filter((t) => t.scenarioKey === 'executor-idle').length;
    const starvations = allThreads.filter((t) => t.scenarioKey === 'possible-starvation').length;
    const livelocks = allThreads.filter((thread) => hasThreadDiagnostic(thread, 'possible-livelock')).length;
    const classInitializationWaiters = allThreads
        .filter((thread) => Array.isArray(thread.classInitializationWaits)
            && thread.classInitializationWaits.length > 0).length;
    const classInitializationStalls = classInitializationChains
        .filter((chain) => chain.stallCandidate).length;

    const selected = parsedDumps[selectedDumpIndex] || null;
    const selectedTime = selected ? formatSnapshotTime(selected) : null;
    const snapshotPrefix = selected
        ? `Snapshot ${selectedDumpIndex + 1}/${parsedDumps.length} • ${selectedTime.headline} • `
        : '';

		const focusSummary = getRunnableClusterFocusVisibilitySummary();
        let focusText = '';
        if (isRunnableClusterTableFilteredToFocus() && focusSummary) {
            const hiddenText = focusSummary.hiddenFocused > 0
                ? ` (${focusSummary.hiddenFocused} hidden by other filters)`
                : '';
            focusText = ` • TABLE FOCUS: ${focusSummary.visibleFocused}/${focusSummary.totalFocused}${hiddenText}`;
        }

		UI.statsSummary.textContent =
		    snapshotPrefix +
            `Snapshot totals • Threads: ${total} • RUNNABLE: ${runnable} • BLOCKED: ${blocked} • WAITING: ${waiting} • Daemon: ${daemon} • DEADLOCKED: ${deadlocked} • CLASS INIT WAITERS: ${classInitializationWaiters} • CLASS INIT STALL?: ${classInitializationStalls} • CARRYING VT: ${carriers} • CPU HOT: ${cpuHot} • ALLOCATION HOT: ${allocationHot} • CPU PROFILE: ${cpuThresholdProfile.label} • IDLE EXECUTORS: ${idleExecutors} • STARVATION?: ${starvations} • LIVELOCK?: ${livelocks}` +
            visibleTableText +
		    focusText;
			
    UI.lastUpdated.textContent = total === 0 ? '' : `Updated: ${new Date().toLocaleString()}`;
	

}


function getClusterById(clusterId) {
    return (runnableStackClusters || []).find((c) => String(c.id) === String(clusterId)) || null;
}

function closeRunnableClusterCompareModal() {
    if (!UI.runnableClusterCompareModal) return;
    UI.runnableClusterCompareModal.classList.add('hidden');
    UI.runnableClusterCompareModal.setAttribute('aria-hidden', 'true');
    UI.runnableClusterCompareModal.close?.();
}

function openRunnableClusterCompareModal(clusterId) {
    const cluster = getClusterById(clusterId);
    if (!cluster || !UI.runnableClusterCompareModal || !UI.runnableClusterCompareModalBody) return;

    const groupedMembers = groupRunnableClusterMembersByStack(cluster.members || []);
    const trendRaw = String(cluster.trend || 'Stable');
    const similarityPct = Math.round(Number(cluster.quality?.averageSimilarity || 0) * 100);
    const title =
        (cluster.representativeFrames && cluster.representativeFrames[0]) ||
        cluster.representative?.topFrame ||
        'Recurring RUNNABLE stack comparison';

    UI.runnableClusterCompareModalTitle.textContent =
        `Recurring RUNNABLE stack comparison • ${title}`;
		const baselineGroup = groupedMembers[0] || null;
		const baselineStackText = String(baselineGroup?.stackText || '');

		const cardsHtml = groupedMembers.map((group, groupIndex) => {
		    const groupMembers = group.members || [];
		    const firstMember = groupMembers[0] || null;
		    const stackText = String(group.stackText || '(No stack available)');
		    const pathSummary = summarizeRunnableStackShape(group) || group.topFrame || 'Stack shape';
		    const dumpSummary = summarizeDumpIndexes(groupMembers);
		    const occurrenceSummary = summarizeDumpOccurrences(groupMembers);

		    const baselineMatch = getRunnableCompareBaselineMatch(group, baselineGroup);
		    const baselineMethodLabel = groupIndex === 0
		        ? 'Reference stack'
		        : getSimilarityMethodLabel(baselineMatch.method);
		    const baselineScorePct = groupIndex === 0
		        ? 100
		        : Math.round(Number(baselineMatch.score || 0) * 100);

		    const internalMethodLabel = getSimilarityMethodLabel(firstMember?.clusterMatchMethod || 'variant-merge');
		    const internalScorePct = Math.round(Number(firstMember?.clusterMatchScore || 0) * 100);

		    const isBaseline = groupIndex === 0;
        const diffLabel = getRunnableCompareDiffLabel(groupIndex);
        const renderedStackHtml = renderRunnableCompareDiffStack(
            stackText,
            baselineStackText,
            isBaseline
        );


        const previewThreads = groupMembers
            .slice(0, 8)
            .map((member) => {
                const dumpLabel = parsedDumps?.[member.dumpIndex]?.timestamp || `Dump ${Number(member.dumpIndex) + 1}`;
                return `
                  <div class="runnable-compare-thread-pill">
                    <strong>${escapeHtml(member.threadName || '(unnamed thread)')}</strong>
                    <span>${escapeHtml(dumpLabel)}</span>
                  </div>
                `;
            })
            .join('');

        return `
          <section class="runnable-compare-card">
            <div class="runnable-compare-card-header">
              <div>
                <div class="runnable-compare-card-title">Stack shape ${groupIndex + 1}</div>
                <div class="runnable-compare-card-subtitle">${escapeHtml(pathSummary)}</div>
              </div>

			        <div class="runnable-compare-card-badges">
			          <span class="runnable-cluster-match-method has-tooltip"
			                data-tooltip="${escapeAttr(
			      groupIndex === 0
			          ? 'This is the reference stack used as the baseline for the side-by-side comparison.'
			          : getSimilarityMethodTooltip(baselineMatch.method)
			  )}">
			            ${escapeHtml(baselineMethodLabel)}
			          </span>

			          <span class="runnable-cluster-match-score has-tooltip"
			                data-tooltip="${escapeAttr(
			      groupIndex === 0
			          ? 'Reference stack: all other stack shapes in this modal are compared against this one.'
			          : getBaselineSimilarityScoreTooltip(baselineMatch.method, baselineMatch.score)
			  )}">
			            ${baselineScorePct}%
			          </span>
			        </div>
            </div>

			        <div class="runnable-compare-meta-grid">
			          <div class="runnable-compare-meta-item">
			            <label>Occurrences</label>
			            <strong>${groupMembers.length}</strong>
			          </div>
			          <div class="runnable-compare-meta-item">
			            <label>Snapshots</label>
			            <strong>${new Set(groupMembers.map((m) => Number(m.dumpIndex))).size}</strong>
			          </div>
			          <div class="runnable-compare-meta-item">
			            <label>Dumps</label>
			            <strong>${escapeHtml(dumpSummary)}</strong>
			          </div>
			          <div class="runnable-compare-meta-item">
			            <label>Distribution</label>
			            <strong>${escapeHtml(occurrenceSummary)}</strong>
			          </div>
			        </div>

			        <div class="runnable-cluster-match-summary">
			          ${groupIndex === 0
			    ? 'Reference stack for baseline comparison'
			    : `Compared to stack shape 1 • ${escapeHtml(baselineMatch.summary)}`
			}
			        </div>

			        <div class="runnable-cluster-match-summary" style="opacity:0.82;">
			          Internal subgroup match • ${escapeHtml(internalMethodLabel)} • ${internalScorePct}%
			        </div>

			<div class="runnable-compare-stack-wrap">
			  <div class="runnable-compare-stack-header">
			    <span class="runnable-compare-stack-header-label">${escapeHtml(diffLabel)}</span>
			  </div>
			  <div class="runnable-compare-stack">
			    ${renderedStackHtml}
			  </div>
			</div>
            <div class="runnable-compare-preview">
              <div class="runnable-compare-preview-title">Example threads</div>
              <div class="runnable-compare-thread-list">
                ${previewThreads || '<div class="hint-muted">No thread examples</div>'}
              </div>
            </div>


          </section>
        `;
    }).join('');

    UI.runnableClusterCompareModalBody.innerHTML = `
      <div class="runnable-compare-summary-bar">
        <div class="runnable-compare-summary-title">${escapeHtml(title)}</div>
        <div class="runnable-compare-summary-subtitle">
          ${groupedMembers.length} stack shape${groupedMembers.length === 1 ? '' : 's'} •
          ${Number(cluster.totalOccurrences || 0)} total occurrence${Number(cluster.totalOccurrences || 0) === 1 ? '' : 's'} •
          trend: ${escapeHtml(trendRaw)} •
          avg similarity: ${similarityPct}%
        </div>
      </div>

	  <div class="runnable-compare-grid ${groupedMembers.length === 1 ? 'runnable-compare-grid-single' : ''}">
	    ${cardsHtml}
	  </div>
    `;

    UI.runnableClusterCompareModal.classList.remove('hidden');
    UI.runnableClusterCompareModal.setAttribute('aria-hidden', 'false');
    UI.runnableClusterCompareModal.showModal?.();
}

function openDeadlockedThreadsModal(cycle) {
    if (!cycle || !UI.deadlockedThreadsModal || !UI.deadlockedThreadsModalBody) return;

    const threads = (cycle.threads || [])
        .map((item) => item.sourceKey ? allThreads.find((t) => t.sourceKey === item.sourceKey) : null)
        .filter(Boolean);

    const cardsHtml = threads.map((thread) => {
        const rawLines = Array.isArray(thread.rawBlock) ? thread.rawBlock : [];
        const stackHtml = rawLines.map((line) => renderHighlightedStackLine(line, thread)).join('');

        return `
          <section class="deadlocked-thread-stack-card">
            <div class="deadlocked-thread-stack-header">
              <div>
                <div class="deadlocked-thread-stack-title">${escapeHtml(thread.threadName || 'Unknown thread')}</div>
                <div class="deadlocked-thread-stack-subtitle">
                  #${escapeHtml(thread.jvmId ?? '—')} • nid=${escapeHtml(thread.nid ?? '—')} • ${stateBadge(thread.javaState)}
                </div>
              </div>

              <div class="deadlocked-thread-lock-summary">
			  <span class="deadlock-lock-pill deadlock-lock-pill-waiting deadlock-lock-ref has-tooltip"
			  data-lock-id="${escapeAttr(normalizeLockId(thread.deadlockWaitingLockId || ''))}"
			       data-tooltip="${escapeAttr(thread.deadlockWaitingLockType || '')}">
			    waiting: ${escapeHtml(thread.deadlockWaitingLockId || '—')}
			  </span>
			  <span class="deadlock-lock-pill deadlock-lock-pill-holding deadlock-lock-ref"
			  data-lock-id="${escapeAttr(normalizeLockId(thread.deadlockHoldingLockId || ''))}"
			  data-tooltip="${escapeAttr(thread.deadlockHoldingLockType || '')}">
			    holding: ${escapeHtml(thread.deadlockHoldingLockId || '—')}
			  </span>
              </div>
            </div>

            <div class="deadlocked-thread-stack-body">
              ${stackHtml || '<div class="hint-muted">(No stack found)</div>'}
            </div>

          </section>
        `;
    }).join('');

    UI.deadlockedThreadsModalTitle.textContent =
        `Deadlocked threads • Cycle ${cycle.id}`;

    UI.deadlockedThreadsModalBody.innerHTML = `
      <div class="deadlocked-threads-grid">
        ${cardsHtml}
      </div>
    `;

    UI.deadlockedThreadsModal.classList.remove('hidden');
    UI.deadlockedThreadsModal.setAttribute('aria-hidden', 'false');
    UI.deadlockedThreadsModal.showModal?.();
}

function smartAnalysisSeverityLabel(severity) {
    if (severity === 'critical') return 'CRITICAL';
    if (severity === 'high') return 'HIGH';
    if (severity === 'medium') return 'MEDIUM';
    return 'INFO';
}

function renderSmartAnalysisFinding(finding) {
    const severity = String(finding?.severity || 'info');
    const evidence = finding?.evidence || {};
    const facts = (finding?.facts || []).map((fact) => `
      <div class="smart-analysis-fact">
        <dt>${escapeHtml(fact.label)}</dt>
        <dd>${escapeHtml(fact.value)}</dd>
      </div>
    `).join('');
    const resourceText = renderSmartAnalysisResources(finding);
    const affectedCount = Array.isArray(finding?.threads) ? finding.threads.length : 0;

    return `
      <article class="smart-analysis-card smart-analysis-card-${escapeAttr(severity)}"
               data-smart-finding-id="${escapeAttr(finding.id)}">
        <header class="smart-analysis-card-header">
          <div class="smart-analysis-card-heading">
            <h3>${escapeHtml(finding.title)}</h3>
            <div class="smart-analysis-card-kickers">
              <span class="smart-analysis-severity smart-analysis-severity-${escapeAttr(severity)}">${escapeHtml(smartAnalysisSeverityLabel(severity))}</span>
              <span class="smart-analysis-evidence smart-analysis-evidence-${escapeAttr(evidence.level || 'unclassified')}">${escapeHtml(evidence.label || 'UNCLASSIFIED')}</span>
              <span class="smart-analysis-confidence">${escapeHtml(String(finding.confidence || 'low').toUpperCase())} CONFIDENCE</span>
            </div>
          </div>
          ${affectedCount ? `
            <button type="button" class="btn btn-sm smart-analysis-focus-btn"
                    data-smart-finding-id="${escapeAttr(finding.id)}">
              Focus ${escapeHtml(String(affectedCount))} thread${affectedCount === 1 ? '' : 's'}
            </button>
          ` : ''}
        </header>
        <p class="smart-analysis-card-summary">${escapeHtml(finding.summary)}</p>
        <details class="tda-detail-disclosure">
          <summary><span class="tda-detail-show">Show details</span><span class="tda-detail-hide">Hide details</span><span class="sr-only">: ${escapeHtml(finding.title)}</span></summary>
          <div class="tda-detail-content">
        ${facts ? `<dl class="smart-analysis-facts">${facts}</dl>` : ''}
        ${resourceText}
        ${renderSmartAnalysisThreadButtons(finding)}
        <div class="smart-analysis-guidance">
          <div><strong>Next check</strong><span>${escapeHtml(finding.recommendation || '')}</span></div>
          <div><strong>Qualification</strong><span>${escapeHtml(finding.qualification || '')}</span></div>
        </div>
          </div>
        </details>
      </article>
    `;
}

function renderSmartAnalysisPanel() {
    if (!UI.smartAnalysisPanel || !UI.smartAnalysisPanelBody) return;
    if (!smartAnalysis || !allThreads.length) {
        UI.smartAnalysisPanel.classList.add('hidden');
        UI.smartAnalysisPanelBody.innerHTML = '';
        return;
    }

    UI.smartAnalysisPanel.classList.remove('hidden');
    const counts = smartAnalysis.counts || {};
    const countPills = ['critical', 'high', 'medium', 'info']
        .filter((severity) => Number(counts[severity] || 0) > 0)
        .map((severity) => `
          <span class="smart-analysis-count smart-analysis-count-${escapeAttr(severity)}">
            ${escapeHtml(String(counts[severity]))} ${escapeHtml(severity.toUpperCase())}
          </span>
        `).join('');
    const coverage = smartAnalysis.coverage || {};
    const limitations = (smartAnalysis.limitations || []).map((limitation) =>
        `<li>${escapeHtml(limitation)}</li>`).join('');
    const findings = (smartAnalysis.findings || []).map(renderSmartAnalysisFinding).join('');
    const hasMaterialFindings = Number(counts.total || 0) > 0;

    UI.smartAnalysisPanelBody.innerHTML = `
      <details class="smart-analysis-details">
        <summary class="smart-analysis-summary app-section-summary">
          <div class="app-section-summary-inner">
            <div class="app-section-summary-title">Smart analysis</div>
            <div class="app-section-summary-subtitle">${escapeHtml(smartAnalysis.headline)}</div>
          </div>
          <div class="smart-analysis-counts">${countPills || '<span class="smart-analysis-count smart-analysis-count-clear">NO MATERIAL FINDINGS</span>'}</div>
        </summary>
        <div class="smart-analysis-body">
          <div class="smart-analysis-overview ${hasMaterialFindings ? 'has-findings' : 'is-clear'}">
            <div>
              <p>${escapeHtml(smartAnalysis.summary)}</p>
            </div>
            <div class="smart-analysis-coverage" aria-label="Analysis coverage">
              <span>${escapeHtml(String(coverage.threads || 0))} threads</span>
              <span>${escapeHtml(String(coverage.snapshots || 0))} snapshot${Number(coverage.snapshots) === 1 ? '' : 's'}</span>
              <span>${escapeHtml(String(coverage.measuredCpuRates || 0))} CPU rates</span>
              <span>${escapeHtml(String(coverage.measuredAllocationRates || 0))} allocation rates</span>
            </div>
          </div>
          ${findings ? `<div class="smart-analysis-grid">${findings}</div>` : `
            <div class="smart-analysis-empty">
              No configured material problem is supported by the available evidence in this snapshot.
            </div>
          `}
          ${limitations ? `
            <details class="smart-analysis-limitations">
              <summary>Analysis limitations (${escapeHtml(String(smartAnalysis.limitations.length))})</summary>
              <ul>${limitations}</ul>
            </details>
          ` : ''}
        </div>
      </details>
    `;
}

function renderDeadlockPanel() {
    if (!UI.deadlockPanel || !UI.deadlockPanelBody) return;

    if (!deadlocks.length) {
        UI.deadlockPanel.classList.add('hidden');
        UI.deadlockPanelBody.innerHTML = '';
        return;
    }

    UI.deadlockPanel.classList.remove('hidden');

    const deadlockedThreadCount = allThreads.filter((t) => t.isDeadlocked).length;

    UI.deadlockPanelBody.innerHTML = `
	  <details class="deadlock-panel-details">
	    <summary class="deadlock-panel-summary app-section-summary">
	      <div class="app-section-summary-inner">
	        <div class="app-section-summary-title">Java Deadlock Detected</div>
	        <div class="app-section-summary-subtitle">
	          Found ${deadlocks.length} deadlock cycle${deadlocks.length === 1 ? '' : 's'} involving ${deadlockedThreadCount} thread${deadlockedThreadCount === 1 ? '' : 's'}.
	        </div>
	      </div>
	    </summary>

	    <div style="display:flex;flex-direction:column;gap:14px;margin-top:14px;margin-bottom:14px;">
	      ${deadlocks.map(renderDeadlockCard).join('')}
	    </div>
	  </details>
	`;
}

function renderDeadlockCard(cycle) {
    const items = cycle.threads || [];

    const nodesHtml = items.map((item, idx) => {
        const thread = item.sourceKey ? allThreads.find((t) => t.sourceKey === item.sourceKey) : null;
        const buttonAttrs = thread
            ? `type="button" class="btn btn-sm deadlock-thread-btn" data-source-key="${escapeAttr(thread.sourceKey)}"`
            : `type="button" class="btn btn-sm" disabled`;

        const arrow = idx < items.length - 1
            ? `<div style="align-self:center;font-size:22px;opacity:0.9;">→</div>`
            : `<div style="align-self:center;font-size:22px;opacity:0.9;">↺</div>`;

        return `
      <div style="display:contents;">
        <div style="
		min-width:250px;
		     padding:14px;
          border-radius:14px;
          border:1px solid var(--tda-panel-border, rgba(255,107,107,0.22));
          background:var(--tda-surface-raised, rgba(255,255,255,0.04));
          display:flex;
          flex-direction:column;
          gap:8px;
        ">
		<div style="font-weight:800;">${escapeHtml(item.threadName)}</div>

		<div class="deadlock-lock-lines">
		  <div class="deadlock-lock-line">
		    <span class="deadlock-lock-label">waiting for</span>
		    <span class="deadlock-lock-pill deadlock-lock-pill-waiting"
		          title="${escapeAttr(thread?.deadlockWaitingLockType || item.waitingLockType || '')}">
		      ${escapeHtml(item.waitingLockId || '—')}
		    </span>
		  </div>

		  <div class="deadlock-lock-line">
		    <span class="deadlock-lock-label">holding</span>
		    <span class="deadlock-lock-pill deadlock-lock-pill-holding"
		          title="${escapeAttr(thread?.deadlockHoldingLockType || '')}">
		      ${escapeHtml(thread?.deadlockHoldingLockId || '—')}
		    </span>
		  </div>

		  <div class="deadlock-lock-line">
		    <span class="deadlock-lock-label">blocked by</span>
		    <span class="deadlock-thread-pill">
		      ${escapeHtml(item.heldBy || '—')}
		    </span>
		  </div>
		</div>

		<div>
		  <button ${buttonAttrs}>Details</button>
		</div>
        </div>
        ${arrow}
      </div>
    `;
    }).join('');

    const cycleBtn = `
	  <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
	    <button
	      type="button"
	      class="btn btn-sm show-deadlocked-threads-btn"
	      data-cycle-id="${escapeAttr(String(cycle.id))}">
	      Show deadlocked threads
	    </button>
	  </div>
	`;

    return `
	  <div style="
	    padding:14px 16px;
	    border-radius:16px;
	    border:1px solid var(--tda-panel-border, rgba(255,255,255,0.10));
	    background:var(--tda-surface, rgba(255,255,255,0.03));
	  ">
	    <div style="font-size:16px;font-weight:800;margin-bottom:10px;">
	      Cycle ${cycle.id} • ${items.length} thread${items.length === 1 ? '' : 's'}
	    </div>

	    ${cycleBtn}

	    <div style="
	      display:grid;
	      grid-template-columns:repeat(${Math.max(1, items.length * 2)}, max-content);
	      gap:10px;
	      align-items:stretch;
	      overflow:auto;
	      padding-bottom:4px;
	    ">
	      ${nodesHtml}
	    </div>
	  </div>
	`;
}

function classInitializationStatusLabel(chain) {
    if (chain?.status === 'stall-candidate') return 'STALL CANDIDATE';
    if (chain?.status === 'initializer-not-observed') return 'INITIALIZER NOT OBSERVED';
    if (chain?.status === 'ambiguous-initializer') return 'AMBIGUOUS INITIALIZER';
    return 'INITIALIZATION IN PROGRESS';
}

function classInitializationResourceText(resource) {
    if (!resource) return 'No parsed JVM wait resource';
    const identity = [resource.lockId, resource.lockType].filter(Boolean).join(' · ');
    return identity || 'JVM wait resource';
}

function renderClassInitializationThreadButton(thread, roleClass = '') {
    if (!thread) return '<span class="class-initialization-missing">Not observed</span>';
    return `
      <button type="button"
              class="btn btn-sm class-initialization-thread-btn ${escapeAttr(roleClass)}"
              data-source-key="${escapeAttr(thread.sourceKey)}">
        ${escapeHtml(thread.threadName || 'unknown')}
      </button>
    `;
}

function renderClassInitializationCard(chain) {
    const initializerHtml = chain.initializer
        ? renderClassInitializationThreadButton(chain.initializer, 'class-initialization-initializer-btn')
        : (chain.initializers || []).length
            ? chain.initializers.map((thread) => renderClassInitializationThreadButton(
                thread,
                'class-initialization-initializer-btn',
            )).join('')
            : '<span class="class-initialization-missing">Initializer not present in this dump</span>';
    const waitersHtml = (chain.waiters || [])
        .map((thread) => renderClassInitializationThreadButton(thread, 'class-initialization-waiter-btn'))
        .join('');
    const waitingResources = chain.initializerWaitingResources || [];
    const currentWait = `${chain.initializerState || 'UNKNOWN'}; no JVM wait resource parsed`;

    return `
      <article class="class-initialization-card ${chain.stallCandidate ? 'is-stall-candidate' : ''}">
        <header class="class-initialization-card-header">
          <div>
            <div class="class-initialization-class-name">${escapeHtml(chain.className)}</div>
            <div class="class-initialization-card-subtitle">
              ${escapeHtml(`${chain.waiterCount} class-initialization waiter${chain.waiterCount === 1 ? '' : 's'}`)}
            </div>
          </div>
          <div class="class-initialization-status-list">
            <span class="class-initialization-status ${chain.stallCandidate ? 'is-warning' : 'is-observed'}">
              ${escapeHtml(classInitializationStatusLabel(chain))}
            </span>
            <span class="class-initialization-status is-snapshot">SNAPSHOT ONLY</span>
          </div>
        </header>
        <div class="class-initialization-chain-grid">
          <section class="class-initialization-chain-node">
            <div class="class-initialization-chain-label">Initializer via &lt;clinit&gt;</div>
            <div class="class-initialization-chip-wrap">${initializerHtml}</div>
            <dl class="class-initialization-facts">
              <dt>Java state</dt><dd>${chain.initializerState ? stateBadge(chain.initializerState) : 'Not observed'}</dd>
              <dt>Current wait</dt><dd class="mono-small">${waitingResources.length ? waitingResources.map((resource) => escapeHtml(classInitializationResourceText(resource))).join('<br>') : escapeHtml(currentWait)}</dd>
            </dl>
          </section>
          <div class="class-initialization-chain-arrow" aria-hidden="true">⟵</div>
          <section class="class-initialization-chain-node">
            <div class="class-initialization-chain-label">Waiting for class initialization</div>
            <div class="class-initialization-chip-wrap">${waitersHtml}</div>
          </section>
        </div>
        <p class="class-initialization-qualification">${escapeHtml(chain.qualification)}</p>
      </article>
    `;
}

function renderClassInitializationPanel() {
    if (!UI.classInitializationPanel || !UI.classInitializationPanelBody) return;
    if (!classInitializationChains.length) {
        UI.classInitializationPanel.classList.add('hidden');
        UI.classInitializationPanelBody.innerHTML = '';
        return;
    }

    UI.classInitializationPanel.classList.remove('hidden');
    const waiterCount = classInitializationChains
        .reduce((total, chain) => total + Number(chain.waiterCount || 0), 0);
    const stallCandidateCount = classInitializationChains.filter((chain) => chain.stallCandidate).length;
    UI.classInitializationPanelBody.innerHTML = `
      <details class="class-initialization-panel-details">
        <summary class="class-initialization-panel-summary app-section-summary">
          <div class="app-section-summary-inner">
            <div class="app-section-summary-title">Class initialization dependencies</div>
            <div class="app-section-summary-subtitle">
              ${escapeHtml(`${waiterCount} thread${waiterCount === 1 ? '' : 's'} waiting across ${classInitializationChains.length} class${classInitializationChains.length === 1 ? '' : 'es'}`)}${stallCandidateCount ? escapeHtml(` · ${stallCandidateCount} initializer stall candidate${stallCandidateCount === 1 ? '' : 's'}`) : ''}. Not a confirmed deadlock.
            </div>
          </div>
        </summary>
        <div class="class-initialization-panel-body">
          ${classInitializationChains.map(renderClassInitializationCard).join('')}
        </div>
      </details>
    `;
}

let contentionGraphOrigin = null;
const contentionGraphReturn = document.getElementById('contentionGraphReturn');

function renderContentionPanel() {
    contentionGraphOrigin = null;
    contentionGraphReturn.hidden = true;
    if (!UI.contentionPanel || !UI.contentionPanelBody) return;

    if (!contentionChains.length) {
        UI.contentionPanel.classList.add('hidden');
        UI.contentionPanelBody.innerHTML = '';
        return;
    }

    UI.contentionPanel.classList.remove('hidden');

    const waiterCount = contentionChains.reduce((sum, c) => sum + (c.waiters?.length || 0), 0);

    UI.contentionPanelBody.innerHTML = `
	  <details class="contention-panel-details">
	    <summary class="contention-panel-summary app-section-summary">
	      <div class="app-section-summary-inner">
	        <div class="app-section-summary-title">Lock contention chains</div>
	        <div class="app-section-summary-subtitle">
	          ${contentionChains.length} contended lock${contentionChains.length === 1 ? '' : 's'} · ${waiterCount} waiting thread–lock relationships · most waiters first.
	        </div>
	      </div>
	    </summary>

        ${renderContentionTable(contentionChains, deadlocks)}
        <div class="contention-action-status" role="status"></div>
	  </details>
	`;
}

function render() {
    renderAnalyzerStart(parsedDumps.length > 0);
    renderStats();
    renderSmartAnalysisPanel();
    renderThreadStateCharts();
    renderDeadlockPanel();
    renderClassInitializationPanel();
    renderContentionPanel();
    renderDependencyGraph();
    renderChartFilterBar();
    renderFocusFilterBar();
    renderTableRows();
    updateSortIndicators();
    renderRunnableClusterPanel();
    document.getElementById('threadEmptyState').hidden = !parsedDumps.length || filtered.length > 0;
}
function renderDependencyGraph() {
    const selected = parsedDumps[selectedDumpIndex] || null;
    const snapshotLabel = selected
        ? `Snapshot ${selectedDumpIndex + 1}/${parsedDumps.length}${selected.timestamp ? ` · ${selected.timestamp}` : ''}`
        : '';

    const pattern = blockingPatterns.find(p => p.key === selectedBlockingPatternKey);
    renderBlockingPatternView(document.getElementById('blockingPatternView'), {
        patterns: blockingPatterns, summary: blockingPatternSummary, selectedKey: selectedBlockingPatternKey, dumps: parsedDumps,
        snapshotIndex: selected?.index, onSelect: key => { selectedBlockingPatternKey = key; renderDependencyGraph(); },
        onSnapshot: index => navigateToDump('direct', index),
        onThread: (key, element) => { const thread = allThreads.find(t => t.sourceKey === key); if (thread) openThreadModal(thread, element); },
        onReport: addBlockingFinding,
    });
    dependencyGraphView.setData({
        threads: allThreads,
        deadlocks,
        snapshotLabel,
        incidentSourceKeys: pattern ? patternSnapshot(pattern, parsedDumps, selected?.index).observation?.sourceKeys ?? [] : null,
    });
}

function renderThreadStateCharts() {
    UI.threadStateChartPanel?.classList.toggle('hidden', allThreads.length === 0);
    renderCpuTimelineChart();
    renderThreadStatePieChart(UI.threadStateChart, UI.threadStateLegend, 190);
    renderThreadStatePieChart(UI.threadStateChartLarge, UI.threadStateLegendLarge, 320);

    const cpuData = getCpuDistribution(allThreads);
    renderDistributionPie(
        UI.cpuTimeChart,
        UI.cpuTimeLegend,
        cpuData,
        cpuData.reduce((sum, x) => sum + x.count, 0),
        'threads',
        190,
        'cpu',
        'CPU time = '
    );
    const elapsedData = getElapsedDistribution(allThreads);
    renderDistributionPie(
        UI.elapsedChart,
        UI.elapsedLegend,
        elapsedData,
        elapsedData.reduce((sum, x) => sum + x.count, 0),
        'threads',
        190,
        'elapsed',
        'Elapsed = '
    );

    const allocatedData = getAllocatedDistribution(allThreads);
    renderDistributionPie(
        UI.allocatedChart,
        UI.allocatedLegend,
        allocatedData,
        allocatedData.reduce((sum, x) => sum + x.count, 0),
        'threads',
        190,
        'allocated',
        'Allocated = '
    );

    const allocationRateData = getAllocationRateDistribution(allThreads);
    renderDistributionPie(
        UI.allocationRateChart,
        UI.allocationRateLegend,
        allocationRateData,
        allocationRateData.reduce((sum, x) => sum + x.count, 0),
        'threads',
        190,
        'allocation-rate',
        'Allocation rate = '
    );
    const grid = UI.threadStateChart?.closest('.thread-state-chart-grid');
    if (grid) {
        const count = grid.querySelectorAll('.thread-state-chart-card:not(.hidden)').length;
        grid.style.setProperty('--chart-columns', String(Math.max(1, Math.min(4, count))));
        grid.style.setProperty('--chart-columns-laptop', String(Math.max(1, Math.min(2, count))));
    }
}

function renderCpuTimelineChart() {
    const container = UI.cpuTimelineChart;
    const legend = UI.cpuTimelineLegend;
    const summary = UI.cpuTimelineSummary;
    if (!container || !legend || !summary) return;
    if (activeTooltipTarget && container.contains(activeTooltipTarget)) hideAppTooltip();
    if (typeof d3 === 'undefined') return;

    const cached = cpuTimelineModelCache;
    const cacheMatches = cached?.dumps === parsedDumps
        && cached.series === threadSeries
        && cached.query === cpuTimelineState.query
        && cached.limit === cpuTimelineState.limit
        && cached.selectedSeriesKey === cpuTimelineState.selectedSeriesKey;
    const model = cacheMatches ? cached.model : buildCpuTimelineModel({
        dumps: parsedDumps,
        series: threadSeries,
        query: cpuTimelineState.query,
        limit: cpuTimelineState.limit,
        selectedSeriesKey: cpuTimelineState.selectedSeriesKey,
    });
    if (!cacheMatches) {
        cpuTimelineModelCache = {
            dumps: parsedDumps,
            series: threadSeries,
            query: cpuTimelineState.query,
            limit: cpuTimelineState.limit,
            selectedSeriesKey: cpuTimelineState.selectedSeriesKey,
            model,
        };
    }
    container.innerHTML = '';
    legend.innerHTML = '';
    container.closest('.cpu-timeline-card')?.classList.toggle('hidden', model.measuredSeriesCount === 0);
    const hasTimelineFilter = Boolean(model.query);
    let summaryText = 'No measured CPU series are available';
    if (model.availableSeriesCount) {
        summaryText = `${model.visibleSeriesCount} of ${model.availableSeriesCount} measured thread series`;
    } else if (hasTimelineFilter) {
        summaryText = 'No measured CPU series match the current filter';
    }
    summary.textContent = summaryText;

    if (model.snapshots.length < 2) {
        container.innerHTML = '<div class="thread-state-empty">At least two correlated snapshots with CPU counters are required.</div>';
        return;
    }
    if (!model.series.length) {
        container.innerHTML = hasTimelineFilter
            ? '<div class="thread-state-empty">No measured CPU series match the current filter.</div>'
            : '<div class="thread-state-empty">No exact adjacent thread snapshots have reliable CPU rates. Coarse estimates remain in thread details.</div>';
        return;
    }

    const width = Math.max(720, container.clientWidth || 1100);
    const height = 280;
    const margin = { top: 18, right: 26, bottom: 48, left: 62 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const yMaximum = Math.max(10, Math.ceil(Number(model.maximumRatePercent || 0) / 10) * 10);
    const x = d3.scalePoint()
        .domain(model.intervals.map(interval => interval.dumpIndex))
        .range([0, plotWidth]).padding(0.06);
    const y = d3.scaleLinear().domain([0, yMaximum]).nice().range([plotHeight, 0]);
    const colors = [
        '#55c2ff', '#ffb454', '#65d6a6', '#ff6f91', '#c7a6ff',
        '#f2dd5c', '#40d9d0', '#ff8f5c', '#8fb8ff', '#d8e06f',
        '#ef9fff', '#67e8f9', '#fca5a5', '#86efac', '#fde68a',
        '#a5b4fc', '#f9a8d4', '#5eead4', '#fdba74', '#93c5fd',
    ];
    const dashPatterns = [null, '8 3', '2 3', '10 3 2 3'];

    const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('role', 'group')
        .attr('aria-label', `CPU usage timeline for ${model.visibleSeriesCount} thread series across ${model.snapshots.length} snapshots`);
    const plot = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    plot.append('g')
        .attr('class', 'cpu-timeline-grid')
        .call(d3.axisLeft(y).ticks(5).tickSize(-plotWidth).tickFormat(''));
    plot.append('g')
        .attr('class', 'cpu-timeline-axis')
        .call(d3.axisLeft(y).ticks(5).tickFormat((value) => `${value}%`));
    const tickIndexes = buildSnapshotTickIndexes(model.intervals.length)
        .map(index => model.intervals[index].dumpIndex);
    const intervalLabels = new Map(model.intervals.map(interval => [interval.dumpIndex, interval.shortLabel]));
    plot.append('g')
        .attr('class', 'cpu-timeline-axis')
        .attr('transform', `translate(0,${plotHeight})`)
        .call(d3.axisBottom(x)
            .tickValues(tickIndexes)
            .tickFormat((value) => intervalLabels.get(value)));

    if (intervalLabels.has(selectedDumpIndex)) {
        plot.append('line')
            .attr('class', 'cpu-timeline-selected')
            .attr('x1', x(selectedDumpIndex))
            .attr('x2', x(selectedDumpIndex))
            .attr('y1', 0)
            .attr('y2', plotHeight);
    }

    const line = d3.line()
        .defined((point) => point != null)
        .x((point) => x(point.dumpIndex))
        .y((point) => y(point.ratePercent));
    const visiblePoints = model.series.flatMap((item) => item.points);
    const initialFocusPoint = visiblePoints.find((point) => point.dumpIndex === selectedDumpIndex)
        || visiblePoints[0];

    model.series.forEach((item, seriesIndex) => {
        const color = colors[seriesIndex];
        const dashPattern = dashPatterns[seriesIndex % dashPatterns.length];
        const pointsByDump = new Map(item.points.map((point) => [point.dumpIndex, point]));
        const values = model.intervals.map((interval) => pointsByDump.get(interval.dumpIndex) || null);
        const seriesGroup = plot.append('g').attr('class', 'cpu-timeline-series')
            .attr('data-timeline-series-key', item.seriesKey)
            .attr('data-timeline-series-order', seriesIndex)
            .on('pointerenter', () => updateCpuTimelineEmphasis(item.seriesKey))
            .on('pointerleave', () => updateCpuTimelineEmphasis())
            .on('focusin', () => updateCpuTimelineEmphasis(item.seriesKey))
            .on('focusout', () => updateCpuTimelineEmphasis());
        seriesGroup.append('path')
            .datum(values)
            .attr('class', 'cpu-timeline-line')
            .attr('stroke', color)
            .attr('stroke-dasharray', dashPattern)
            .attr('d', line);
        const pointGroups = seriesGroup.selectAll('g.cpu-timeline-point')
            .data(item.points)
            .join('g')
            .attr('class', 'cpu-timeline-point')
            .attr('transform', (point) => `translate(${x(point.dumpIndex)},${y(point.ratePercent)})`)
            .attr('tabindex', (point) => point === initialFocusPoint ? 0 : -1)
            .attr('role', 'button')
            .attr('aria-label', (point) => `${item.name}, interval ${intervalLabels.get(point.dumpIndex)}, ${point.ratePercent.toFixed(1)} percent CPU. Open ending snapshot.`)
            .attr('aria-describedby', 'appTooltip')
            .attr('data-timeline-series-key', item.seriesKey)
            .attr('data-timeline-dump-index', (point) => point.dumpIndex)
            .attr('data-tooltip-format', 'cpu-timeline')
            .attr('data-tooltip', (point) => `${point.threadName} · ${intervalLabels.get(point.dumpIndex)} · ${point.ratePercent.toFixed(1)}% CPU`)
            .on('click', (event, point) => activateCpuTimelinePoint(container, item.seriesKey, point.dumpIndex))
            .on('keydown', (event, point) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activateCpuTimelinePoint(container, item.seriesKey, point.dumpIndex);
                    return;
                }
                moveCpuTimelinePointFocus(container, event);
            });
        pointGroups.append('circle')
            .attr('class', 'cpu-timeline-point-hit')
            .attr('r', 12);
        pointGroups.append('circle')
            .attr('class', 'cpu-timeline-point-mark')
            .attr('r', (point) => point.dumpIndex === selectedDumpIndex ? 5 : 3.5)
            .attr('fill', color);

        legend.insertAdjacentHTML('beforeend', `
            <button type="button" class="cpu-timeline-legend-item"
                data-timeline-series-key="${escapeAttr(item.seriesKey)}"
                data-timeline-thread-name="${escapeAttr(item.name)}"
                aria-pressed="false"
                title="Highlight ${escapeAttr(item.name)}; click again to clear. Peak CPU ${escapeAttr(item.maximumRatePercent.toFixed(1))}%">
                <span class="cpu-timeline-legend-swatch" style="background:${escapeAttr(color)}"></span>
                <span class="cpu-timeline-legend-name">${escapeHtml(item.name)}</span>
                <span class="cpu-timeline-legend-peak">Peak ${escapeHtml(item.maximumRatePercent.toFixed(1))}%</span>
            </button>`);
    });
    updateCpuTimelineEmphasis();
}

function updateCpuTimelineEmphasis(previewKey = '') {
    const groups = [...(UI.cpuTimelineChart?.querySelectorAll('.cpu-timeline-series') || [])];
    const requestedKey = previewKey || cpuTimelineState.selectedSeriesKey;
    const key = groups.some(group => group.dataset.timelineSeriesKey === requestedKey) ? requestedKey : '';
    let highlightedGroup = null;
    groups.forEach(group => {
        group.classList.toggle('is-muted', Boolean(key) && group.dataset.timelineSeriesKey !== key);
        group.classList.toggle('is-highlighted', Boolean(key) && group.dataset.timelineSeriesKey === key);
        if (key && group.dataset.timelineSeriesKey === key) highlightedGroup = group;
    });
    // Keep the highlighted points clickable when several series overlap.
    if (highlightedGroup && highlightedGroup !== highlightedGroup.parentElement.lastElementChild) {
        highlightedGroup.parentElement.appendChild(highlightedGroup);
    }
    UI.cpuTimelineLegend?.querySelectorAll('.cpu-timeline-legend-item').forEach(button => {
        button.classList.toggle('is-highlighted', Boolean(key) && button.dataset.timelineSeriesKey === key);
        button.setAttribute('aria-pressed', String(button.dataset.timelineSeriesKey === cpuTimelineState.selectedSeriesKey));
    });
}

function activateCpuTimelinePoint(container, seriesKey, dumpIndex) {
    cpuTimelineState.selectedSeriesKey = seriesKey;
    updateCpuTimelineEmphasis();
    if (!navigateToDump('direct', dumpIndex)) return;

    const points = [...container.querySelectorAll('.cpu-timeline-point')];
    const replacement = points.find((point) => (
        point.dataset.timelineSeriesKey === seriesKey
        && Number(point.dataset.timelineDumpIndex) === dumpIndex
    ));
    if (!replacement) return;

    points.forEach((point) => point.setAttribute('tabindex', '-1'));
    replacement.setAttribute('tabindex', '0');
    replacement.focus();
}

function moveCpuTimelinePointFocus(container, event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;

    // SVG paint order changes on highlight; keyboard order must remain stable.
    const points = [...container.querySelectorAll('.cpu-timeline-point')].sort((left, right) =>
        Number(left.parentElement.dataset.timelineSeriesOrder) - Number(right.parentElement.dataset.timelineSeriesOrder)
        || Number(left.dataset.timelineDumpIndex) - Number(right.dataset.timelineDumpIndex));
    const currentIndex = points.indexOf(event.currentTarget);
    if (currentIndex < 0 || !points.length) return;

    let nextIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = points.length - 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = Math.max(0, currentIndex - 1);
    } else {
        nextIndex = Math.min(points.length - 1, currentIndex + 1);
    }
    if (nextIndex === currentIndex) return;

    event.preventDefault();
    points.forEach((point) => point.setAttribute('tabindex', '-1'));
    points[nextIndex].setAttribute('tabindex', '0');
    points[nextIndex].focus();
}

function handleChartLegendClick(event) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('.chart-legend-button');
    if (!button) return;

    const kind = button.dataset.chartFilterKind;
    const value = button.dataset.chartFilterValue;
    const label = button.dataset.chartFilterLabel;
    if (!kind || !value || !label) return;
    toggleChartFilter(kind, value, label);
}

function renderThreadStatePieChart(containerEl, legendEl, size = 180) {
    if (!containerEl || !legendEl || typeof d3 === 'undefined') return;

    const data = getThreadStateDistribution(allThreads);
    containerEl.innerHTML = '';
    legendEl.innerHTML = '';
    containerEl.closest('.thread-state-chart-card')?.classList.toggle('hidden', data.length === 0);

    if (!data.length) {
        containerEl.innerHTML = '<div class="thread-state-empty">No thread data loaded</div>';
        return;
    }

    const width = size;
    const height = size;
    const radius = Math.min(width, height) / 2;

    const svg = d3
        .select(containerEl)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .attr('viewBox', `0 0 ${width} ${height}`);

    const root = svg
        .append('g')
        .attr('transform', `translate(${width / 2}, ${height / 2})`);

    const pie = d3
        .pie()
        .sort(null)
        .value((d) => d.count);

    const arc = d3
        .arc()
        .innerRadius(radius * 0.45)
        .outerRadius(radius * 0.88);

    const arcHover = d3
        .arc()
        .innerRadius(radius * 0.42)
        .outerRadius(radius * 0.92);

		const arcs = root
		    .selectAll('path')
		    .data(pie(data))
		    .enter()
		    .append('path')
		    .attr('d', arc)
		    .attr('fill', (d) => getThreadStateColor(d.data.state))
		    .attr('stroke', 'rgba(15,17,22,0.9)')
		    .attr('stroke-width', 2)
		    .attr('opacity', (d) => getChartSliceOpacity('state', d.data.state))
		    .style('cursor', 'pointer');

		arcs.append('title')
		    .text((d) => `${d.data.state}: ${d.data.count}`);

		arcs
		    .on('mouseenter', function(event, d) {
		        d3.select(this).transition().duration(120).attr('d', arcHover);
		    })
		    .on('mouseleave', function(event, d) {
		        d3.select(this).transition().duration(120).attr('d', arc);
		    })
		    .on('click', function(event, d) {
		        event.preventDefault();
		        event.stopPropagation();
		        toggleChartFilter('state', d.data.state, `Thread state = ${d.data.state}`);
		    });

    root
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '-0.1em')
        .attr('fill', '#f3f6ff')
        .style('font-size', size >= 260 ? '18px' : '14px')
        .style('font-weight', '800')
        .text(allThreads.length);

    root
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '1.2em')
        .attr('fill', 'rgba(233,238,247,0.72)')
        .style('font-size', size >= 260 ? '12px' : '10px')
        .text('threads');

        legendEl.innerHTML = data.map((item) => {
            const view = getChartLegendItemView('state', item.state, chartFilterState);
            return `
          <button type="button"
            class="thread-state-legend-item chart-legend-button ${view.isActive ? 'is-active' : ''}"
            aria-pressed="${view.ariaPressed}"
            aria-label="Filter thread table by state ${escapeAttr(item.state)}; ${escapeAttr(String(item.count))} threads"
		    data-chart-filter-kind="state"
		    data-chart-filter-value="${escapeAttr(item.state)}"
		    data-chart-filter-label="${escapeAttr(`Thread state = ${item.state}`)}">
		    <span class="thread-state-legend-swatch" style="background:${escapeAttr(getThreadStateColor(item.state))}"></span>
		    <span class="thread-state-legend-label">${escapeHtml(item.state)}</span>
		    <span class="thread-state-legend-value">${escapeHtml(String(item.count))}</span>
          </button>
        `;
        }).join('');
        legendEl.onclick = handleChartLegendClick;


}


function renderDistributionPie(
    containerEl,
    legendEl,
    data,
    totalCount,
    centerLabel,
    size = 190,
    filterKind = null,
    filterLabelPrefix = ''
) {
    if (!containerEl || !legendEl) return;

    containerEl.innerHTML = '';
    legendEl.innerHTML = '';
    const isEmpty = !data || data.length === 0 || totalCount === 0;
    containerEl.closest('.thread-state-chart-card')?.classList.toggle('hidden', isEmpty);

    if (isEmpty) return;

    const width = size;
    const height = size;
    const radius = Math.min(width, height) / 2;
    const innerRadius = radius * 0.52;

    const svg = d3
        .select(containerEl)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .attr('viewBox', `0 0 ${width} ${height}`);

    const root = svg
        .append('g')
        .attr('transform', `translate(${width / 2}, ${height / 2})`);

    const pie = d3
        .pie()
        .sort(null)
        .value((d) => d.count);

    const arc = d3
        .arc()
        .innerRadius(innerRadius)
        .outerRadius(radius - 2);

    const arcHover = d3
        .arc()
        .innerRadius(innerRadius)
        .outerRadius(radius + 4);

		const slices = root
		    .selectAll('path')
		    .data(pie(data))
		    .join('path')
		    .attr('d', arc)
		    .attr('fill', (d) => d.data.color)
		    .attr('stroke', '#0f1116')
		    .attr('stroke-width', 2)
		    .attr('opacity', (d) => filterKind ? getChartSliceOpacity(filterKind, d.data.label) : 1)
		    .style('cursor', filterKind ? 'pointer' : 'default')
		    .on('mouseenter', function(event, d) {
		        d3.select(this).transition().duration(120).attr('d', arcHover);
		    })
		    .on('mouseleave', function(event, d) {
		        d3.select(this).transition().duration(120).attr('d', arc);
		    });

		if (filterKind) {
		    slices.on('click', function(event, d) {
		        event.preventDefault();
		        event.stopPropagation();
		        toggleChartFilter(filterKind, d.data.label, `${filterLabelPrefix}${d.data.label}`);
		    });
		}

    root
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '-0.1em')
        .attr('fill', '#f3f6ff')
        .style('font-size', size >= 260 ? '18px' : '14px')
        .style('font-weight', '800')
        .text(totalCount);

    root
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '1.2em')
        .attr('fill', 'rgba(233,238,247,0.72)')
        .style('font-size', size >= 260 ? '12px' : '10px')
        .text(centerLabel);

        legendEl.innerHTML = data.map((item) => {
            const view = getChartLegendItemView(filterKind, item.label, chartFilterState);
            const content = `
            <span class="thread-state-legend-swatch" style="background:${escapeAttr(item.color)}"></span>
            <span class="thread-state-legend-label">${escapeHtml(item.label)}</span>
            <span class="thread-state-legend-value">${escapeHtml(String(item.count))}</span>`;
            if (!filterKind) return `<div class="thread-state-legend-item">${content}</div>`;
            const label = `${filterLabelPrefix}${item.label}`;
            return `
          <button type="button"
            class="thread-state-legend-item chart-legend-button ${view.isActive ? 'is-active' : ''}"
            aria-pressed="${view.ariaPressed}"
            aria-label="Filter thread table by ${escapeAttr(label)}; ${escapeAttr(String(item.count))} threads"
            data-chart-filter-kind="${escapeAttr(filterKind)}"
            data-chart-filter-value="${escapeAttr(item.label)}"
            data-chart-filter-label="${escapeAttr(label)}">${content}
          </button>`;
        }).join('');


        legendEl.onclick = filterKind ? handleChartLegendClick : null;
}


function getRunnableTimelineCellClass(count) {
    const n = Number(count) || 0;
    if (n <= 0) return 'is-zero';
    if (n === 1) return 'is-low';
    if (n <= 3) return 'is-medium';
    return 'is-high';
}

function renderRunnableClusterTimeline(cluster) {
    const entries = new Map((cluster.timeline || []).map(entry => [entry.dumpIndex, entry]));
    const maxCount = Math.max(0, ...(cluster.timeline || []).map(entry => entry.count ?? 0));
    const cellsHtml = parsedDumps.map((dump, dumpIndex) => {
        const entry = entries.get(dumpIndex);
        const count = entry?.count ?? null;
        const observed = entry?.observedCount ?? 0;
        let levelClass = 'is-zero';
        if (count > 0 && maxCount > 0) {
            const ratio = count / maxCount;
            levelClass = ratio >= 0.75 ? 'is-high' : ratio >= 0.35 ? 'is-medium' : 'is-low';
        }
        const isActive = dumpIndex === selectedDumpIndex ? ' is-active' : '';
        const isFocused = Boolean(isRunnableClusterTableFilteredToFocus()
            && String(runnableClusterTableFocusState.clusterId) === String(cluster.id)
            && Number(runnableClusterTableFocusState.dumpIndex) === dumpIndex);
        const countLabel = count == null ? (observed > 0 ? '≥' + observed : '?') : String(count);
        const observation = count == null
            ? 'Incomplete snapshot: ' + observed + ' matching threads observed; total and absence are unknown'
            : count + ' matching thread' + (count === 1 ? '' : 's');
        const title = (dump.timestamp || 'Dump ' + (dumpIndex + 1)) + ' · ' + observation;
        const actionLabel = observed > 0
            ? 'Focus thread table on ' + observed + ' observed matching threads in dump ' + (dumpIndex + 1)
            : 'Open dump ' + (dumpIndex + 1) + '; ' + observation;
        const pressed = observed > 0 ? 'aria-pressed="' + (isFocused ? 'true' : 'false') + '"' : '';
        return '<button type="button" class="runnable-cluster-timeline-cell ' + levelClass + isActive
            + (isFocused ? ' is-focused' : '') + ' has-tooltip" aria-label="' + escapeAttr(actionLabel)
            + '" ' + pressed + ' data-dump-idx="' + dumpIndex + '" data-tooltip="' + escapeAttr(title) + '">'
            + '<span class="runnable-cluster-timeline-label">D' + (dumpIndex + 1) + '</span>'
            + '<span class="runnable-cluster-timeline-value">' + escapeHtml(countLabel) + '</span></button>';
    }).join('');
    return '<div class="runnable-cluster-timeline">' + cellsHtml + '</div>';
}


function renderRunnableClusterFilterBar() {
    const persistentChecked = runnableClusterFilterState?.persistentOnly ? 'checked' : '';
    const growingChecked = runnableClusterFilterState?.growingOnly ? 'checked' : '';
    const minSeen = Number(runnableClusterFilterState?.minDumpsSeen || 2);

    return `
      <div class="runnable-cluster-filterbar">
        <label class="toggle has-tooltip" data-tooltip="Only show clusters that appear in more than one dump">
          <input
            id="runnablePersistentOnlyToggle"
            type="checkbox"
            ${persistentChecked}
          />
          Persistent only
        </label>

        <label class="toggle has-tooltip" data-tooltip="Only show clusters whose presence grows over time">
          <input
            id="runnableGrowingOnlyToggle"
            type="checkbox"
            ${growingChecked}
          />
          Growing only
        </label>

        <label class="dump-select-wrap" for="runnableMinDumpsSeenSelect">
          <span class="dump-select-label">Min dumps seen</span>
          <select id="runnableMinDumpsSeenSelect" class="dump-select">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
                .map((value) => `
                    <option value="${value}" ${value === minSeen ? 'selected' : ''}>
                      ${value}+
                    </option>
                `)
                .join('')}
          </select>
        </label>

      </div>
    `;
}
function renderRunnableClusterPanel() {
    if (!UI.runnableClusterPanel || !UI.runnableClusterPanelBody) {
        return;
    }

    const clusters = Array.isArray(runnableStackClusters) ? runnableStackClusters : [];
    if (!clusters.length) {
        UI.runnableClusterPanel.classList.add('hidden');
        UI.runnableClusterPanelBody.innerHTML = '';
        return;
    }

    const totalDumps = Array.isArray(parsedDumps) ? parsedDumps.length : 0;

    let visibleClusters = clusters.filter((cluster) => {
        const dumpCountSeen = Number(cluster.dumpCountSeen || 0);

        if (dumpCountSeen < Number(runnableClusterFilterState?.minDumpsSeen || 2)) {
            return false;
        }

        if (runnableClusterFilterState?.persistentOnly) {
            const trend = String(cluster.trend || '').toLowerCase();
            if (trend !== 'persistent') {
                return false;
            }
        }

        if (runnableClusterFilterState?.growingOnly) {
            const trend = String(cluster.trend || '').toLowerCase();
            if (trend !== 'growing') {
                return false;
            }
        }

        return true;
    });

    visibleClusters = visibleClusters
        .slice()
        .sort((a, b) => {
            const aSeen = Number(a.dumpCountSeen || 0);
            const bSeen = Number(b.dumpCountSeen || 0);
            if (bSeen !== aSeen) return bSeen - aSeen;

            const aTotal = Number(a.totalOccurrences || 0);
            const bTotal = Number(b.totalOccurrences || 0);
            if (bTotal !== aTotal) return bTotal - aTotal;

            const aRun = Number(a.longestConsecutiveRun || 0);
            const bRun = Number(b.longestConsecutiveRun || 0);
            return bRun - aRun;
        });

    const clusterPages = Math.max(1, Math.ceil(visibleClusters.length / RUNNABLE_CLUSTER_PAGE_SIZE));
    runnableClusterPage = Math.min(Math.max(1, runnableClusterPage), clusterPages);
    const clusterStart = (runnableClusterPage - 1) * RUNNABLE_CLUSTER_PAGE_SIZE;
    const pageClusters = visibleClusters.slice(clusterStart, clusterStart + RUNNABLE_CLUSTER_PAGE_SIZE);
    const paging = clusterPages > 1 ? `<nav class="pager" aria-label="Cluster pages">
        <button type="button" class="btn btn-sm" data-cluster-page="${runnableClusterPage - 1}" ${runnableClusterPage === 1 ? 'disabled' : ''}>Previous clusters</button>
        <span>${clusterStart + 1}–${clusterStart + pageClusters.length} of ${visibleClusters.length} clusters</span>
        <button type="button" class="btn btn-sm" data-cluster-page="${runnableClusterPage + 1}" ${runnableClusterPage === clusterPages ? 'disabled' : ''}>Next clusters</button>
    </nav>` : '';
    const summary = `${visibleClusters.length} stack cluster${visibleClusters.length === 1 ? '' : 's'} shown across ${totalDumps} snapshot${totalDumps === 1 ? '' : 's'}.`;

    UI.runnableClusterPanel.classList.remove('hidden');
    UI.runnableClusterPanelBody.innerHTML = `
	  <details class="runnable-cluster-panel-details" ${runnableClusterUiState.panelOpen ? 'open' : ''}>
	  <summary class="runnable-cluster-panel-summary app-section-summary">
	    <div class="app-section-summary-inner">
	      <div class="app-section-summary-title">Recurring RUNNABLE stack shapes</div>
		  <div class="app-section-summary-subtitle">
		    ${escapeHtml(summary)}
		  </div>
	    </div>
	  </summary>

	    <section class="runnable-cluster-panel-shell">
	      ${renderRunnableClusterFilterBar()}

	      ${paging}
	      <div class="runnable-cluster-list">
	        ${visibleClusters.length
            ? pageClusters.map(renderRunnableClusterCard).join('')
            : '<div class="hint-muted">No clusters match the current cluster filters.</div>'
        }
	      </div>
	    </section>
	  </details>
	`;

}



function jumpToRunnableDump(dumpIndex) {
    if (!Number.isFinite(dumpIndex) || dumpIndex < 0 || dumpIndex >= parsedDumps.length) {
        return;
    }

    clearRunnableClusterTableFocus();
    selectedDumpIndex = dumpIndex;

    if (UI.dumpSelect) {
        UI.dumpSelect.value = String(dumpIndex);
    }

    activateSelectedDump();
    renderDumpNavigator();
    render();
}
function openRunnableClusterThreadDetails(dumpIndex, threadIndex) {
    const dump = parsedDumps?.[dumpIndex];
    const thread = dump?.threads?.find((t) => t.index === threadIndex);

    if (!thread) {
        return;
    }

    openThreadModal(thread);
}

function groupRunnableOccurrencesByDump(members) {
    const groups = new Map();

    for (const member of members || []) {
        const dumpIndex = Number(member?.dumpIndex);
        const key = Number.isFinite(dumpIndex) ? dumpIndex : -1;

        if (!groups.has(key)) {
            groups.set(key, {
                dumpIndex: key,
                dumpLabel:
                    key >= 0
                        ? (parsedDumps?.[key]?.timestamp || `Dump ${key + 1}`)
                        : 'Unknown snapshot',
                members: []
            });
        }

        groups.get(key).members.push(member);
    }

    return Array.from(groups.values()).sort((a, b) => a.dumpIndex - b.dumpIndex);
}

function renderRunnableOccurrenceGroups(members) {
    const dumpGroups = groupRunnableOccurrencesByDump(members);

    return dumpGroups.map((group) => `
      <div class="runnable-cluster-occurrence-group">
        <div class="runnable-cluster-occurrence-group-title">
          ${escapeHtml(group.dumpLabel)}
        </div>

        <div class="runnable-cluster-occurrence-group-list">
          ${group.members.map((member) => `
            <div class="runnable-cluster-member-preview">
              <strong>${escapeHtml(member.threadName || '(unnamed thread)')}</strong>
              <span>#${escapeHtml(String(member.index ?? '—'))}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
}



function summarizeRunnableStackShape(group) {
    const stackText = String(group?.stackText || '').trim();
    if (!stackText) {
        return '';
    }

    const frames = stackText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('at '))
        .map((line) => line.replace(/^at\s+/, '').replace(/:\d+\)/g, ')'));

    if (!frames.length) {
        return '';
    }

    const concise = frames
        .slice(0, 4)
        .map((frame) => frame.replace(/\(.*?\)/g, '').trim());

    return concise.join(' → ');
}

function splitRunnableCompareStackLines(stackText) {
    return String(stackText || '')
        .split('\n')
        .map((rawLine) => {
            const raw = rawLine.replace(/\r/g, '');
            return {
                raw,
                normalized: normalizeRunnableCompareLine(raw)
            };
        })
        .filter((entry) => entry.normalized !== '');
}
function buildLcsMatrix(a, b) {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            if (a[i].normalized === b[j].normalized) {
                dp[i][j] = dp[i + 1][j + 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }

    return dp;
}
function diffRunnableCompareStackLines(baseLines, currentLines) {
    const a = Array.isArray(baseLines) ? baseLines : [];
    const b = Array.isArray(currentLines) ? currentLines : [];
    const dp = buildLcsMatrix(a, b);

    const rows = [];
    let i = 0;
    let j = 0;

    while (i < a.length && j < b.length) {
        if (a[i].normalized === b[j].normalized) {
            rows.push({
                type: 'same',
                baseLine: a[i].raw,
                currentLine: b[j].raw
            });
            i += 1;
            j += 1;
            continue;
        }

        if (dp[i + 1][j] >= dp[i][j + 1]) {
            rows.push({
                type: 'removed',
                baseLine: a[i].raw,
                currentLine: ''
            });
            i += 1;
        } else {
            rows.push({
                type: 'added',
                baseLine: '',
                currentLine: b[j].raw
            });
            j += 1;
        }
    }

    while (i < a.length) {
        rows.push({
            type: 'removed',
            baseLine: a[i].raw,
            currentLine: ''
        });
        i += 1;
    }

    while (j < b.length) {
        rows.push({
            type: 'added',
            baseLine: '',
            currentLine: b[j].raw
        });
        j += 1;
    }

    return rows;
}

function getRenderableDiffLine(line) {
    if (typeof line === 'string') return line;
    if (line && typeof line === 'object') {
        return line.raw ?? line.text ?? line.display ?? '';
    }
    return '';
}

function renderRunnableCompareDiffStack(stackText, baselineStackText, isBaseline = false) {
    const currentLines = splitRunnableCompareStackLines(stackText);
    const baseLines = splitRunnableCompareStackLines(baselineStackText);

    if (isBaseline) {
        return `
          <div class="runnable-compare-diff runnable-compare-diff-single">
            ${currentLines.map((line, idx) => {
                const renderLine = getRenderableDiffLine(line);
                return `
                  <div class="runnable-compare-diff-row runnable-compare-diff-row-same">
                    <div class="runnable-compare-diff-gutter">${idx + 1}</div>
                    <div class="runnable-compare-diff-code">${escapeHtml(renderLine)}</div>
                  </div>
                `;
            }).join('')}
          </div>
        `;
    }

    const diffRows = diffRunnableCompareStackLines(baseLines, currentLines);

    return `
      <div class="runnable-compare-diff">
        ${diffRows.map((row, idx) => {
            const currentLine = getRenderableDiffLine(row.currentLine);
            const baseLine = getRenderableDiffLine(row.baseLine);

            let content = '';
            if (row.type === 'same') {
                content = escapeHtml(currentLine);
            } else if (row.type === 'added') {
                content = `<span class="runnable-compare-diff-marker">+</span>${escapeHtml(currentLine)}`;
            } else {
                content = `<span class="runnable-compare-diff-marker">−</span>${escapeHtml(baseLine)}`;
            }

            return `
              <div class="runnable-compare-diff-row runnable-compare-diff-row-${escapeAttr(row.type)}">
                <div class="runnable-compare-diff-gutter">${idx + 1}</div>
                <div class="runnable-compare-diff-code">${content}</div>
              </div>
            `;
        }).join('')}
      </div>
    `;
}

function getRunnableCompareDiffLabel(groupIndex) {
    return groupIndex === 0 ? 'Reference stack' : 'Diff vs stack shape 1';
}

function summarizeDumpIndexes(groupMembers) {
    const dumpIndexes = [...new Set(
        groupMembers
            .map((member) => Number(member.dumpIndex))
            .filter((value) => Number.isInteger(value) && value >= 0)
    )].sort((a, b) => a - b);

    if (!dumpIndexes.length) {
        return 'No dumps';
    }

    return dumpIndexes.map((idx) => `D${idx + 1}`).join(', ');
}

function summarizeDumpOccurrences(groupMembers) {
    const dumpGroups = groupRunnableOccurrencesByDump(groupMembers);

    if (!dumpGroups.length) {
        return 'Not found in any dump';
    }

    return dumpGroups
        .map((group) => {
            const dumpNo = Number.isFinite(group.dumpIndex) && group.dumpIndex >= 0
                ? `D${group.dumpIndex + 1}`
                : 'Unknown';
            const count = group.members?.length || 0;
            return `${dumpNo} (${count})`;
        })
        .join(', ');
}

function renderRunnableClusterCard(cluster) {
    const representativeFrames = Array.isArray(cluster.representativeFrames)
        ? cluster.representativeFrames.filter(Boolean).slice(0, 3)
        : [];

    const fallbackTopFrame =
        cluster.representative?.topFrame ||
        cluster.topFrame ||
        'RUNNABLE stack';

    const title = representativeFrames[0] || fallbackTopFrame;

    const averageSimilarity = Number(cluster.quality?.averageSimilarity || 0);
    const similarityPct = Number.isFinite(averageSimilarity)
        ? Math.round(averageSimilarity * 100)
        : 0;

    const primaryMethod = String(cluster.primaryMethod || 'Unknown');
    const methodBreakdown = Array.isArray(cluster.methodBreakdown) ? cluster.methodBreakdown : [];
    const hasMixedMethods = methodBreakdown.length > 1;
    const dumpCountSeen = Number(cluster.dumpCountSeen || 0);
    const totalOccurrences = Number(cluster.totalOccurrences || 0);
    const longestConsecutiveRun = Number(cluster.longestConsecutiveRun || 0);
    const trendRaw = String(cluster.trend || 'stable').trim();
    const trendKey = trendRaw === 'Unavailable' ? 'neutral' : trendRaw.toLowerCase();




    const members = Array.isArray(cluster.members) ? cluster.members : [];
    

    const signatureText = representativeFrames.length
        ? representativeFrames.join(' → ')
        : fallbackTopFrame;

    const breakdownHtml = methodBreakdown.length
        ? methodBreakdown.map((entry) => {
            const methodLabel = getSimilarityMethodLabel(entry.method);
            const tooltip = compactTooltip(
                `${methodLabel}: ${getSimilarityMethodTooltip(entry.method)} Used for ${entry.count} thread${entry.count === 1 ? '' : 's'} in this cluster.`
            );

            return `
		          <span
		            class="runnable-cluster-method-chip has-tooltip"
		            data-tooltip="${escapeAttr(tooltip)}"
		          >
		            ${escapeHtml(methodLabel)}
		            <strong>${escapeHtml(String(entry.count))}</strong>
		          </span>
		        `;
        }).join('')
        : '<span class="hint-muted">No similarity breakdown available.</span>';



    const detailsLoaded = isRunnableClusterOpen(cluster.id);
    const groupedMembers = detailsLoaded ? groupRunnableClusterMembersByStack(members) : [];

    const allMembersHtml = groupedMembers.length
        ? groupedMembers.map((group, groupIndex) => {
            const groupMembers = group.members || [];
            const uniqueDumpIndexes = Array.from(
                new Set(groupMembers.map((m) => Number(m.dumpIndex)))
            ).filter(Number.isFinite);
            const stackGroupStateKey = makeRunnableStackGroupStateKey(cluster, group, groupIndex);
            const dumpSummary = summarizeDumpIndexes(groupMembers);
            const dumpOccurrenceSummary = summarizeDumpOccurrences(groupMembers);
            const showVariantTitle = groupedMembers.length > 1;
            const groupTitle = showVariantTitle
                ? `Stack shape ${groupIndex + 1}`
                : 'Grouped stack shape';

            const groupPathSummary = summarizeRunnableStackShape(group);

            const stackText = String(group.stackText || '').trim();

            return `
				  <div class="runnable-cluster-stack-group">
				    <div class="runnable-cluster-stack-group-head">
				      <div>
				        <div class="runnable-cluster-stack-group-title">
				          ${escapeHtml(groupTitle)}
				        </div>
				        ${groupPathSummary
                    ? `
				              <div class="runnable-cluster-stack-group-signature">
				                ${escapeHtml(groupPathSummary)}
				              </div>
				            `
                    : ''
                }
				        <div class="runnable-cluster-stack-group-dumps">
				          Found in dumps: ${escapeHtml(dumpSummary)}
				        </div>
				        <div class="runnable-cluster-stack-group-dumps">
				          Occurrences by dump: ${escapeHtml(dumpOccurrenceSummary)}
				        </div>
				      </div>

				      <div class="runnable-cluster-stack-group-meta">
				        ${groupMembers.length} occurrence${groupMembers.length === 1 ? '' : 's'}
				        <span>·</span>
				        ${uniqueDumpIndexes.length} snapshot${uniqueDumpIndexes.length === 1 ? '' : 's'}
				      </div>
				    </div>

				    ${group.topFrame
                    ? `
				          <div class="runnable-cluster-member-frame">
				            ${escapeHtml(group.topFrame)}
				          </div>
				        `
                    : ''
                }

					<div class="runnable-cluster-member-meta-row">
					  <span
					    class="runnable-cluster-match-method has-tooltip"
					    data-tooltip="${escapeAttr(getSimilarityMethodTooltip(groupMembers[0]?.clusterMatchMethod || 'variant-merge'))}"
					  >
					    ${escapeHtml(getSimilarityMethodLabel(groupMembers[0]?.clusterMatchMethod || 'variant-merge'))}
					  </span>
					  <span
					    class="runnable-cluster-match-score has-tooltip"
					    data-tooltip="${escapeAttr(getSimilarityScoreTooltip(
                    groupMembers[0]?.clusterMatchMethod || 'variant-merge',
                    groupMembers[0]?.clusterMatchScore || 0
                ))}"
					  >
					    ${Math.round(Number(groupMembers[0]?.clusterMatchScore || 0) * 100)}%
					  </span>
					</div>

				    <div class="runnable-cluster-match-summary">
				      ${escapeHtml(groupMembers[0]?.clusterMatchSummary || '')}
				    </div>

				    <pre class="runnable-cluster-inline-stack">${escapeHtml(stackText || '(No stack available)')}</pre>

				    <div class="runnable-cluster-member-actions">
				 
				      ${groupMembers.length === 1
                    ? `
				            <button
				              type="button"
				              class="btn btn-sm runnable-cluster-thread-btn"
				              data-dump-idx="${escapeAttr(String(groupMembers[0].dumpIndex))}"
                              data-source-key="${escapeAttr(groupMembers[0].sourceKey)}"
				            >
				              Details
				            </button>
				          `
                    : ''
                }
				    </div>

					<details
					  class="runnable-cluster-stack-group-details"
					  data-stack-group-key="${escapeAttr(stackGroupStateKey)}"
					  ${isRunnableStackGroupOpen(stackGroupStateKey) ? 'open' : ''}
					>
				      <summary class="runnable-cluster-stack-group-details-summary">
				        Show example threads and per-dump breakdown
				      </summary>

				      <div class="runnable-cluster-stack-group-occurrences">
				        ${renderRunnableOccurrenceGroups(groupMembers)}
				      </div>
				    </details>
				  </div>
				`;
        }).join('')
        : '<div class="hint-muted">No matching threads.</div>';

		return `
				<details
				  class="runnable-cluster-card"
				  data-trend="${escapeAttr(trendKey)}"
				  data-cluster-id="${escapeAttr(cluster.id)}"
                  data-details-loaded="${detailsLoaded}"
				  ${isRunnableClusterOpen(cluster.id) ? 'open' : ''}
				>
				    <summary class="runnable-cluster-card-summary">
				      <div class="runnable-cluster-card-head">
				        <div class="runnable-cluster-card-titlewrap">
				          <div class="runnable-cluster-card-title has-tooltip"
				               data-tooltip="${escapeAttr(title)}">
				            ${escapeHtml(title)}
				          </div>

				          <div class="runnable-cluster-card-signature has-tooltip"
				               data-tooltip="${escapeAttr(signatureText)}">
				            ${escapeHtml(signatureText)}
				          </div>
				        </div>

				        <div class="runnable-cluster-card-stats">
				          <span
				            class="runnable-cluster-stat has-tooltip"
				            data-tooltip="${escapeAttr(getClusterSeenTooltip(cluster))}"
				          >
				            <label>Seen</label>
				            <strong>${dumpCountSeen}/${parsedDumps.length}</strong>
				          </span>

				          <span
				            class="runnable-cluster-stat has-tooltip"
				            data-tooltip="${escapeAttr(getClusterTotalTooltip(cluster))}"
				          >
				            <label>Total</label>
				            <strong>${totalOccurrences}</strong>
				          </span>

				          <span
				            class="runnable-cluster-stat has-tooltip"
				            data-tooltip="${escapeAttr(getClusterRunTooltip(cluster))}"
				          >
				            <label>Run</label>
				            <strong>${longestConsecutiveRun}</strong>
				          </span>

				          <span
				            class="runnable-cluster-stat has-tooltip"
				            data-tooltip="${escapeAttr(getClusterSimilarityTooltip(cluster))}"
				          >
				            <label>Similarity</label>
				            <strong>${similarityPct}%</strong>
				          </span>

				          <span
				            class="runnable-cluster-stat runnable-cluster-stat-help has-tooltip"
				            data-tooltip="${escapeAttr(getClusterPrimaryGroupingTooltip(cluster))}"
				          >
				            <label>Primary</label>
				            <strong>${escapeHtml(getSimilarityMethodLabel(primaryMethod))}</strong>
				          </span>
				        </div>

						<div class="runnable-cluster-card-badges">
						  <span
						    class="runnable-cluster-trend-badge runnable-cluster-trend-${escapeAttr(trendKey)} has-tooltip"
						    data-tooltip="${escapeAttr(getRunnableClusterTrendTooltip(trendRaw))}">
						    ${escapeHtml(trendRaw)}
						  </span>

						  ${hasMixedMethods ? `
						    <span
						      class="runnable-cluster-trend-badge runnable-cluster-trend-intermittent has-tooltip"
						      data-tooltip="${escapeAttr(getRunnableClusterMixedMethodsTooltip(cluster))}">
						      Mixed
						    </span>
						  ` : ''}
						</div>
				      </div>
				    </summary>

			    <div class="runnable-cluster-card-body">
				
		  <div class="runnable-cluster-section">
		    <div class="runnable-cluster-section-label">Presence across snapshots</div>
		    ${renderRunnableClusterTimeline(cluster)}
		  </div>

		  <div class="runnable-cluster-section">
		    <div class="runnable-cluster-section-label">Similarity methods used</div>
		    <div class="runnable-cluster-method-chip-row">
		      ${breakdownHtml}
		    </div>
		  </div>

		  <div class="runnable-cluster-section">
		    <div class="runnable-cluster-section-label">Representative frames</div>
		    <div class="runnable-cluster-frames">
		      ${representativeFrames.length
            ? representativeFrames.map((frame) => `
		              <div class="runnable-cluster-frame-line">${escapeHtml(frame)}</div>
		            `).join('')
            : `<div class="runnable-cluster-frame-line">${escapeHtml(fallbackTopFrame)}</div>`
        }
		    </div>
		  </div>
		  
		  <div class="runnable-cluster-section">
		    <div class="runnable-cluster-member-actions">
		      <button
		        type="button"
		        class="btn btn-sm runnable-cluster-compare-btn has-tooltip"
		        data-cluster-id="${escapeAttr(cluster.id)}"
		        data-tooltip="Open all related stack shapes side by side in a comparison view">
		        Show side by side
		      </button>
		    </div>
		  </div>

		  <div class="runnable-cluster-section">
		    <div class="runnable-cluster-member-list">
		      ${allMembersHtml}
		    </div>
		  </div>
		  </div>
      </details>
    `;
}
function openThreadStateChartModal() {
    if (!UI.threadStateChartModal) return;

    UI.threadStateChartModal.classList.remove('hidden');
    UI.threadStateChartModal.setAttribute('aria-hidden', 'false');
    UI.threadStateChartModal.showModal?.();

    renderThreadStatePieChart(
        UI.threadStateChartLarge,
        UI.threadStateLegendLarge,
        320
    );
}

function closeThreadStateChartModal() {
    if (!UI.threadStateChartModal) return;

    UI.threadStateChartModal.classList.add('hidden');
    UI.threadStateChartModal.setAttribute('aria-hidden', 'true');
    UI.threadStateChartModal.close?.();
}

// ---- modal ----
function lockAssessmentLabel(assessment) {
    const labels = {
        deadlock: 'Deadlock',
        contention: 'Observed contention',
        'likely-blocker': 'Likely lock bottleneck',
        'confirmed-hold': 'Confirmed lock hold',
        none: 'No lock evidence',
    };
    return labels[assessment?.tier] || 'No lock evidence';
}

function renderLockAssessmentCard(thread) {
    const assessment = thread?.lockAssessment;
    if (!assessment || assessment.tier === 'none') return '';

    const transitions = assessment.transitions || {};
    const transitionLines = [
        ...((transitions.observedAtBothEndpoints || []).map((lock) =>
            `Observed at both endpoints: ${lock.lockId || '—'}`)),
        ...((transitions.appearedSincePrevious || []).map((lock) =>
            `Appeared at current endpoint: ${lock.lockId || '—'}`)),
        ...((transitions.noLongerObservedSincePrevious || []).map((lock) =>
            `No longer observed at current endpoint: ${lock.lockId || '—'}`)),
    ];
    const blockerLines = (assessment.likelyBlockers || []).map((blocker) =>
        `${blocker.lockId || '—'}: ${blocker.waiterCount} observed waiter(s)`);
    const contentionLines = (assessment.observedContentions || []).map((contention) =>
        `${contention.lockId || '—'}: ${contention.ownerResolution.replaceAll('-', ' ')}`);
    const evidenceKey = assessment.tier === 'confirmed-hold'
        ? 'confirmed-lock-hold'
        : assessment.tier === 'likely-blocker'
            ? 'likely-lock-bottleneck'
            : assessment.tier === 'contention'
                ? 'observed-lock-contention'
                : 'deadlock';
    const evidence = diagnosticEvidenceFor(evidenceKey);
    const interval = transitions.intervalMs == null
        ? 'No safe adjacent interval'
        : `${fmtElapsed(transitions.intervalMs / 1000)} (${transitions.intervalBasis})`;

    return `
      <div class="pr-card contention-modal-card">
        <div class="pr-card-title">Lock evidence ${diagnosticEvidenceMarker(evidence)}</div>
        <dl class="kv">
          <dt>Hierarchy</dt><dd>${escapeHtml(lockAssessmentLabel(assessment))}</dd>
          <dt>Severity score</dt><dd>${escapeHtml(`${assessment.severityScore}/100 · ${assessment.severity}`)}</dd>
          <dt>Endpoint comparison</dt><dd>${escapeHtml(lockTransitionStatusLabel(transitions.status))}</dd>
          <dt>Observation interval</dt><dd>${escapeHtml(interval)}</dd>
        </dl>
        ${blockerLines.length ? `<div class="mono-small"><strong>Likely blocker:</strong><br>${blockerLines.map(escapeHtml).join('<br>')}</div>` : ''}
        ${contentionLines.length ? `<div class="mono-small"><strong>Observed contention:</strong><br>${contentionLines.map(escapeHtml).join('<br>')}</div>` : ''}
        ${transitionLines.length ? `<div class="mono-small"><strong>Endpoint changes:</strong><br>${transitionLines.map(escapeHtml).join('<br>')}</div>` : ''}
        <div class="mono-small" style="margin-top:8px;">${escapeHtml(transitions.qualification || evidence.qualification)}</div>
      </div>
    `;
}

function lockObservationLabel(kind) {
    const labels = {
        'monitor-enter': 'Waiting to enter monitor',
        'monitor-wait': 'Waiting on monitor',
        'synchronizer-park': 'Parked for synchronizer',
        monitor: 'Held monitor',
        'ownable-synchronizer': 'Owned synchronizer',
    };
    return labels[kind] || 'Lock observation';
}

function renderLockObservations(title, locks) {
    if (!Array.isArray(locks) || locks.length === 0) return '';

    const rows = locks.map((lock) => `
        <dt>${escapeHtml(lockObservationLabel(lock.kind))}</dt>
        <dd>
            <code>${escapeHtml(lock.lockId || '—')}</code>
            ${lock.lockType ? `<span class="mono-small">${escapeHtml(lock.lockType)}</span>` : ''}
            ${lock.ownerJvmId != null ? `<span class="mono-small">Reported owner: #${escapeHtml(lock.ownerJvmId)} (at this thread's observation)</span>` : ''}
        </dd>
    `).join('');

    return `
        <div class="thread-details-card">
            <div class="thread-details-card-header"><h3>${escapeHtml(title)}</h3></div>
            <div class="thread-details-card-body"><dl class="kv">${rows}</dl></div>
        </div>
    `;
}

function snapshotEndpointLabel(dumpIndex) {
    const index = Number(dumpIndex);
    return Number.isInteger(index) && index >= 0 ? `Snapshot ${index + 1}` : '—';
}

function rootCauseRelationLabel(relation) {
    if (relation === 'previously-waited-on-lock') return 'Previously waited on lock';
    if (relation === 'previously-held-lock-with-waiters') return 'Previously held lock with waiters';
    return 'Prior lock association';
}

function renderCrossSnapshotDiagnosticsCard(thread) {
        const summary = thread?.crossSnapshotDiagnostics;
        if (!summary) return '';

        const currentKey = String(thread?.scenarioKey || '');
        const diagnostics = [...(summary.diagnostics || [])].sort((left, right) => {
                if (left.key === currentKey && right.key !== currentKey) return -1;
                if (right.key === currentKey && left.key !== currentKey) return 1;
                return String(left.label).localeCompare(String(right.label));
        });
        const diagnosticRows = diagnostics.length
                ? diagnostics.map((diagnostic) => {
                        const trend = seriesTrendPresentation(diagnostic.trend);
                        return `
                            <div class="series-diagnostic-row">
                                <div class="series-diagnostic-row-main">
                                    <strong>${escapeHtml(diagnostic.label)}</strong>
                                    <span class="series-diagnostic-badge series-trend-${escapeAttr(diagnostic.trend)}">
                                        ${trend.icon} ${escapeHtml(trend.label)}
                                    </span>
                                </div>
                                <div class="mono-small">
                                    Observed ${escapeHtml(String(diagnostic.count))}/${escapeHtml(String(diagnostic.totalOccurrences))}
                                    endpoints · first ${escapeHtml(snapshotEndpointLabel(diagnostic.firstObservedDumpIndex))}
                                    · last ${escapeHtml(snapshotEndpointLabel(diagnostic.lastObservedDumpIndex))}
                                    · longest run ${escapeHtml(String(diagnostic.longestStreak))}
                                </div>
                                <div class="mono-small series-diagnostic-reason">${escapeHtml(diagnostic.reason)}</div>
                            </div>
                        `;
                }).join('')
                : '<div class="mono-small">No scenario or finding was observed in this thread series.</div>';

        const rootCauseLinks = summary.rootCauseLinks || [];
        const rootCauseHtml = rootCauseLinks.length
                ? `
                    <div class="series-root-cause-section">
                        <div class="series-root-cause-title">Possible temporal lock associations</div>
                        ${rootCauseLinks.map((link) => `
                            <div class="series-root-cause-item">
                                <div>
                                    ${diagnosticEvidenceMarker(link.evidence)}
                                    <strong>${escapeHtml(rootCauseRelationLabel(link.relation))}</strong>
                                    <span class="mono-small">${escapeHtml(link.lockId || '—')}</span>
                                </div>
                                <div class="mono-small">${escapeHtml(link.reason)}</div>
                                <div class="mono-small">
                                    Observed ${escapeHtml(String(link.observationCount))} time${link.observationCount === 1 ? '' : 's'}
                                    from ${escapeHtml(snapshotEndpointLabel(link.firstObservedDumpIndex))}
                                    to ${escapeHtml(snapshotEndpointLabel(link.lastObservedDumpIndex))};
                                    livelock endpoint ${escapeHtml(snapshotEndpointLabel(link.livelockDumpIndex))}.
                                </div>
                                <div class="mono-small series-diagnostic-qualification">${escapeHtml(link.qualification)}</div>
                            </div>
                        `).join('')}
                    </div>
                `
                : '';

        return `
            <div class="pr-card series-diagnostics-card">
                <div class="pr-card-title">Cross-snapshot diagnostics</div>
                <dl class="kv series-diagnostics-metadata">
                    <dt>Series status</dt><dd>${escapeHtml(seriesStatusLabel(summary.status))}</dd>
                    <dt>Occurrences</dt><dd>${escapeHtml(String(summary.occurrenceCount))}</dd>
                    <dt>First endpoint</dt><dd>${escapeHtml(snapshotEndpointLabel(summary.firstObservedDumpIndex))}</dd>
                    <dt>Last endpoint</dt><dd>${escapeHtml(snapshotEndpointLabel(summary.lastObservedDumpIndex))}</dd>
                </dl>
                <div class="series-diagnostic-list">${diagnosticRows}</div>
                ${rootCauseHtml}
                <div class="mono-small series-diagnostic-qualification">${escapeHtml(summary.qualification)}</div>
            </div>
        `;
}

function renderClassInitializationDetailsCard(model) {
    const relations = Array.isArray(model?.classInitialization) ? model.classInitialization : [];
    if (!relations.length) return '';

    return `
      <article class="thread-details-card class-initialization-details-card">
        <div class="thread-details-card-header"><h3>Class initialization relationship</h3></div>
        <div class="thread-details-card-body">
          ${relations.map((relation) => {
              const waits = relation.initializerWaitingResources || [];
              const waitText = waits.length
                  ? waits.map((resource) => [resource.lockId, resource.lockType].filter(Boolean).join(' · ')).join('; ')
                  : 'No parsed initializer wait resource';
              return `
                <div class="class-initialization-details-relation">
                  <dl class="kv">
                    <dt>Role</dt><dd>${escapeHtml(relation.role)}</dd>
                    <dt>Class</dt><dd class="mono-small">${escapeHtml(relation.className)}</dd>
                    <dt>Status</dt><dd>${escapeHtml(relation.status.replaceAll('-', ' '))}</dd>
                    <dt>Waiters</dt><dd>${escapeHtml(String(relation.waiterCount))}</dd>
                    <dt>Initializer</dt><dd>${escapeHtml(relation.initializerThreadName || 'Not resolved')}</dd>
                    <dt>Initializer state</dt><dd>${escapeHtml(relation.initializerState || 'Not observed')}</dd>
                    <dt>Initializer wait</dt><dd class="mono-small">${escapeHtml(waitText)}</dd>
                  </dl>
                  <p class="mono-small series-diagnostic-qualification">${escapeHtml(relation.qualification)}</p>
                </div>
              `;
          }).join('')}
        </div>
      </article>
    `;
}

function renderThreadDetailsTabMarkup(model) {
    const tabs = getThreadDetailsTabOrder().map((tabId, index) => {
        const label = { overview: 'Overview', locks: 'Locks', history: 'History' }[tabId];
        const isActive = index === 0;
        return `
            <button
                type="button"
                class="thread-details-tab ${isActive ? 'is-active' : ''}"
                id="threadDetailsTab-${tabId}"
                role="tab"
                data-thread-tab="${tabId}"
                aria-controls="threadDetailsPanel-${tabId}"
                aria-selected="${isActive ? 'true' : 'false'}"
                tabindex="${isActive ? '0' : '-1'}"
            >${label}</button>
        `;
    }).join('');

    const assessmentText = model.assessment.reason;
    const evidenceText = model.assessment.evidenceLabel || 'UNCLASSIFIED';
    const scoreText = model.assessment.score || '—';
    const comparison = model.cpuComparison;
    const comparisonDetail = (Number.isFinite(comparison.intervalMs) && comparison.intervalMs > 0
        ? `${fmtElapsed(comparison.intervalMs / 1000)} · ${cpuRateBasisLabel(comparison.basis)}`
        : cpuDeltaStatusLabel(comparison.status)) + (comparison.reason ? ` · ${comparison.reason}` : '');

    const panelMarkup = getThreadDetailsTabOrder().map((tabId, index) => {
        const panelId = `threadDetailsPanel-${tabId}`;
        const isActive = index === 0;

        if (tabId === 'overview') {
            const facts = model.coreFacts.map((fact) => `
                <div class="thread-details-fact">
                    <dt>${escapeHtml(fact.label)}</dt>
                    <dd>${fact.label === 'Java state' ? stateBadge(fact.value) : escapeHtml(String(fact.value ?? '—'))}</dd>
                </div>
            `).join('');

            return `
                <section
                    id="${panelId}"
                    class="thread-details-panel ${isActive ? 'is-active' : ''}"
                    role="tabpanel"
                    aria-labelledby="threadDetailsTab-${tabId}"
                    ${isActive ? '' : 'hidden'}
                >
                    <div class="thread-details-overview-grid">
                        <article class="thread-details-card">
                            <div class="thread-details-card-header">
                                <h3>Assessment</h3>
                                ${model.assessment.matched ? `<span class="thread-details-badge thread-details-badge-neutral">${escapeHtml(evidenceText)}</span>` : ''}
                            </div>
                            <div class="thread-details-card-body">
                                <div class="thread-details-kicker">${escapeHtml(model.assessment.title)}</div>
                                <div class="thread-details-summary-block"><p>${escapeHtml(assessmentText)}</p></div>
                                ${model.assessment.matched ? `<details class="tda-detail-disclosure">
                                  <summary><span class="tda-detail-show">Show details</span><span class="tda-detail-hide">Hide details</span><span class="sr-only">: assessment evidence</span></summary>
                                  <div class="tda-detail-content">
                                <div class="thread-details-summary-block"><strong>Confidence</strong><p>${escapeHtml(model.assessment.confidence || '—')}</p></div>
                                <div class="thread-details-summary-block"><strong>Pattern evidence</strong><p>${escapeHtml(scoreText)}</p></div>
                                <div class="thread-details-summary-block"><strong>Evidence basis</strong><p>${escapeHtml(model.assessment.evidenceBasis || '—')}</p></div>
                                <div class="thread-details-summary-block"><strong>Qualification</strong><p>${escapeHtml(model.assessment.evidenceQualification || '—')}</p></div>
                                  </div>
                                </details>` : ''}
                            </div>
                        </article>

                        <article class="thread-details-card">
                            <div class="thread-details-card-header">
                                <h3>Core facts</h3>
                            </div>
                            <div class="thread-details-comparison"><strong>CPU comparison</strong><p>${escapeHtml(comparison.label)}</p><p>${escapeHtml(comparisonDetail)}</p></div>
                            <dl class="thread-details-fact-grid">${facts}</dl>
                        </article>
                    </div>
                    ${renderClassInitializationDetailsCard(model)}
                </section>
            `;
        }

        if (tabId === 'locks') {
            const lockEvidence = model.lockEvidence || {};
            const heldLocks = Array.isArray(lockEvidence.heldLocks) ? lockEvidence.heldLocks : [];
            const waitingLocks = Array.isArray(lockEvidence.waitingLocks) ? lockEvidence.waitingLocks : [];
            const assessmentHtml = renderLockAssessmentCard({ lockAssessment: lockEvidence.assessment });
            const evidenceHtml = [
                assessmentHtml,
                renderLockObservations('Waiting for', waitingLocks),
                renderLockObservations('Held monitors and synchronizers', heldLocks),
            ].filter(Boolean).join('');

            return `
                <section
                    id="${panelId}"
                    class="thread-details-panel ${isActive ? 'is-active' : ''}"
                    role="tabpanel"
                    aria-labelledby="threadDetailsTab-${tabId}"
                    ${isActive ? '' : 'hidden'}
                >
                    ${evidenceHtml || `
                        <div class="thread-details-card">
                            <div class="thread-details-card-header">
                                <h3>Lock evidence</h3>
                            </div>
                            <div class="thread-details-card-body">
                                <p class="thread-details-empty-state">No lock evidence was parsed for this thread in the selected snapshot.</p>
                            </div>
                        </div>
                    `}
                </section>
            `;
        }

        if (tabId === 'history') {
            const history = model.history || {};
            const historyHtml = history.summary
                ? renderCrossSnapshotDiagnosticsCard({
                    crossSnapshotDiagnostics: history.summary,
                    scenarioKey: history.scenarioKey,
                })
                : '';

            return `
                <section
                    id="${panelId}"
                    class="thread-details-panel ${isActive ? 'is-active' : ''}"
                    role="tabpanel"
                    aria-labelledby="threadDetailsTab-${tabId}"
                    ${isActive ? '' : 'hidden'}
                >
                    ${historyHtml || `
                        <div class="thread-details-card">
                            <div class="thread-details-card-header">
                                <h3>Cross-snapshot diagnostics</h3>
                            </div>
                            <div class="thread-details-card-body">
                                <p class="thread-details-empty-state">Cross-snapshot diagnostics require a valid thread identity across compatible snapshots. The current thread does not have enough safe data for a trend conclusion.</p>
                            </div>
                        </div>
                    `}
                </section>
            `;
        }

        return '';
    }).join('');

    return `
        <div class="thread-details-shell">
            <aside class="thread-details-sidebar" aria-label="Thread information">
                <div class="thread-details-summary" id="threadModalSummary" aria-live="polite"></div>
                <div class="thread-details-tabs" role="tablist" aria-label="Thread details tabs">${tabs}</div>
                ${panelMarkup}
            </aside>
            <section class="thread-details-evidence" aria-labelledby="threadDumpHeading">
                <header class="thread-details-evidence-header">
                    <div class="thread-stack-toolbar">
                        <h2 id="threadDumpHeading">Thread dump</h2>
                        <div class="thread-stack-display-controls">
                            <div class="thread-stack-views" role="group" aria-label="Thread dump view">
                                <button id="threadStackView" class="btn" type="button" aria-pressed="true" aria-controls="threadStackCode">Stack</button>
                                <button id="threadOriginalView" class="btn" type="button" aria-pressed="false" aria-controls="threadStackCode"${model.hasOriginal ? '' : ' disabled'}>${escapeHtml(model.originalLabel)}</button>
                            </div>
                            <label class="thread-stack-colors"><input id="threadStackColors" type="checkbox" checked /> Colors</label>
                        </div>
                    </div>
                    <div class="thread-stack-search" role="search" aria-label="Search thread dump">
                        <input id="threadStackSearch" type="search" aria-label="Search this stack" placeholder="Search this stack (Ctrl+F)" autocomplete="off" maxlength="256" aria-describedby="threadStackSearchStatus" />
                        <output id="threadStackSearchStatus" aria-live="polite" aria-atomic="true"></output>
                        <button id="threadStackPrevious" class="btn" type="button" aria-label="Previous stack match" title="Previous match (Shift+Enter)" disabled>↑</button>
                        <button id="threadStackNext" class="btn" type="button" aria-label="Next stack match" title="Next match (Enter)" disabled>↓</button>
                    </div>
                    <div class="thread-stack-legend" aria-label="Stack color key">
                        <span class="is-jvm">JVM</span><span class="is-library">Libraries</span><span class="is-other" title="Package hints only; other frames often contain application code.">Other / application</span><span class="is-lock">Locks</span>
                    </div>
                </header>
                <div class="thread-details-stack-shell">
                    <pre id="threadStackCode" class="thread-details-code" tabindex="0" aria-label="Readable thread stack">${escapeHtml(model.stackText || 'No stack data is available for this thread.')}</pre>
                </div>
            </section>
        </div>
    `;
}

function updateThreadDetailsTabActivation(tabId) {
    if (!UI.modalBody) return;

    const tabs = UI.modalBody.querySelectorAll('.thread-details-tab');
    const panels = UI.modalBody.querySelectorAll('.thread-details-panel');

    tabs.forEach((tab) => {
        const active = tab.dataset.threadTab === tabId;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.tabIndex = active ? 0 : -1;
    });

    panels.forEach((panel) => {
        const active = panel.id === `threadDetailsPanel-${tabId}`;
        panel.classList.toggle('is-active', active);
        if (active) {
            panel.removeAttribute('hidden');
        } else {
            panel.setAttribute('hidden', 'hidden');
        }
    });
}

function bindThreadDetailsTabs() {
    if (!UI.modalBody) return;

    UI.modalBody.onkeydown = (event) => {
        const tab = event.target.closest('.thread-details-tab');
        if (!tab) return;

        const tabs = [...UI.modalBody.querySelectorAll('.thread-details-tab')];
        const currentIndex = tabs.indexOf(tab);
        if (currentIndex < 0) return;

        let nextIndex = currentIndex;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % tabs.length;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = tabs.length - 1;
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
            updateThreadDetailsTabActivation(tab.dataset.threadTab);
            event.preventDefault();
            return;
        }
        if (nextIndex !== currentIndex) {
            tabs[nextIndex].focus();
            updateThreadDetailsTabActivation(tabs[nextIndex].dataset.threadTab);
            event.preventDefault();
        }
    };

    UI.modalBody.onclick = (event) => {
        const tab = event.target.closest('.thread-details-tab');
        if (tab) {
            updateThreadDetailsTabActivation(tab.dataset.threadTab);
        }
    };
}

const rawDumpStatus = document.getElementById('rawDumpStatus');
const rawDumpReturn = document.getElementById('rawDumpReturn');
let rawDumpTab = null;
let rawDumpTabUnload = null;
let rawDumpSnapshot = null;
let rawDumpWorkspace = null;
let rawDumpOrigin = null;
let rawDumpGraphOrigin = null;
let threadModalOpener = null;

function closeRawDumpTab() {
    const origin = rawDumpOrigin;
    invalidateRawDumpWorkspace();
    window.focus();
    origin?.focus({ preventScroll: true });
}

function revealFromRawDump(reveal, sourceElement) {
    const details = UI.dependencyGraphPanel?.querySelector('details');
    const wasOpen = details?.open;
    if (details) details.open = true;
    if (!reveal()) {
        if (details) details.open = wasOpen;
        return false;
    }
    rawDumpGraphOrigin = sourceElement;
    contentionGraphReturn.hidden = true;
    rawDumpReturn.hidden = false;
    window.focus();
    UI.dependencyGraphPanel?.scrollIntoView({ block: 'start' });
    rawDumpReturn.focus({ preventScroll: true });
    return true;
}

function openRawDumpTab() {
    const dump = parsedDumps[selectedDumpIndex];
    if (!dump?.rawText) return;
    rawDumpOrigin = document.activeElement;
    if (rawDumpSnapshot !== dump || !rawDumpWorkspace || rawDumpTab?.closed) {
        const origin = rawDumpOrigin;
        invalidateRawDumpWorkspace();
        rawDumpOrigin = origin;
        // No window features: open a normal tab without blocking the analyzer.
        // The raw text stays in browser memory, with no upload or URL payload.
        const popup = window.open('', '_blank');
        if (!popup) {
            rawDumpStatus.textContent = 'Allow this site to open a new tab, then click Raw dump again.';
            rawDumpStatus.classList.remove('hidden');
            return;
        }
        popup.opener = null;
        rawDumpTab = popup;
        rawDumpSnapshot = dump;
        rawDumpGraphOrigin = null;
        rawDumpReturn.hidden = true;
        const isCurrent = () => rawDumpTab === popup && !popup.closed
            && parsedDumps[selectedDumpIndex] === dump;
        rawDumpTabUnload = () => {
            if (rawDumpTab === popup) invalidateRawDumpWorkspace({ closeTab: false });
        };
        rawDumpWorkspace = createRawDumpWorkspace({
            popup,
            dump,
            snapshotIndex: selectedDumpIndex,
            snapshotCount: parsedDumps.length,
            stylesheetUrl: new URL('./styles.css', import.meta.url).href,
            onClose: closeRawDumpTab,
            onOpenThread: (thread, sourceElement) => {
                if (!isCurrent()) return;
                window.focus();
                openThreadModal(thread, sourceElement);
            },
            onRevealThread: (thread, sourceElement) => isCurrent() && revealFromRawDump(
                () => dependencyGraphView.revealThread(thread), sourceElement,
            ),
            onRevealLock: (lockId, sourceElement) => isCurrent() && revealFromRawDump(
                () => dependencyGraphView.revealLock(lockId), sourceElement,
            ),
        });
        popup.addEventListener('pagehide', rawDumpTabUnload);
    }
    rawDumpTab?.focus();
    rawDumpWorkspace?.focus();
}

rawDumpReturn.addEventListener('click', () => {
    openRawDumpTab();
    if (rawDumpGraphOrigin?.isConnected) rawDumpGraphOrigin.focus({ preventScroll: true });
});

function invalidateRawDumpWorkspace({ closeTab = true } = {}) {
    const popup = rawDumpTab;
    rawDumpTab = null;
    if (popup && !popup.closed) popup.removeEventListener('pagehide', rawDumpTabUnload);
    rawDumpTabUnload = null;
    rawDumpWorkspace?.destroy();
    rawDumpWorkspace = null;
    rawDumpSnapshot = null;
    rawDumpOrigin = null;
    rawDumpGraphOrigin = null;
    rawDumpReturn.hidden = true;
    rawDumpStatus.textContent = '';
    rawDumpStatus.classList.add('hidden');
    if (threadModalOpener?.ownerDocument.defaultView === popup) threadModalOpener = null;
    if (closeTab && popup && !popup.closed) popup.close();
}

window.addEventListener('pagehide', () => invalidateRawDumpWorkspace());

function openThreadModal(thread, sourceElement = document.activeElement) {
    const model = buildThreadDetailsViewModel(thread, {
        snapshot: parsedDumps[selectedDumpIndex],
        snapshotIndex: selectedDumpIndex,
        snapshotCount: parsedDumps.length,
    });
    const summaryMetaHtml = model.summaryMeta.map((item) => `
        <span${item.label === 'Java state' ? ` data-java-state="${escapeAttr(String(thread.javaState || 'UNKNOWN').trim().toUpperCase())}"` : ''} class="thread-details-chip ${['JVM ID', 'Native ID', 'Java state', 'Locks held'].includes(item.label) || ['No', 'Not reported', '—', '0'].includes(String(item.value)) ? 'thread-details-chip-neutral' : ''}"><span class="thread-details-chip-label">${escapeHtml(item.label)}</span> <span>${escapeHtml(String(item.value ?? '—'))}</span></span>
    `).join('');

    UI.modalTitle.textContent = model.title;
    const context = document.getElementById('threadModalContext');
    context.textContent = `${model.context.label} · ${model.context.time.headline} · Source: ${model.context.source}`;
    context.title = model.context.time.tooltip;
    UI.modalBody.innerHTML = renderThreadDetailsTabMarkup(model);
    UI.modalBody.setAttribute('data-thread-name', model.title);
    UI.modalBody.setAttribute('data-thread-modal', 'active');

    const summaryNode = document.getElementById('threadModalSummary');
    if (summaryNode) {
        summaryNode.innerHTML = summaryMetaHtml;
    }

    UI.modalCopyBtn.textContent = 'Copy raw thread block';
    UI.modalCopyBtn.dataset.copy = model.rawText;
    UI.modalCopyBtn.disabled = !model.hasOriginal;

    UI.modal.classList.remove('hidden');
    UI.modal.setAttribute('aria-hidden', 'false');
    UI.modal.showModal?.();

    updateThreadDetailsTabActivation('overview');
    bindThreadDetailsTabs();
    bindThreadStackControls(UI.modalBody, model);

    // A Details button can belong to the raw evidence tab's document.
    threadModalOpener = sourceElement?.focus ? sourceElement : null;

    const firstTab = UI.modalBody.querySelector('.thread-details-tab');
    if (firstTab) {
        firstTab.focus();
    }
}

function closeThreadModal() {
    try { UI.modal.close?.(); } catch {}
    UI.modal.classList.add('hidden');
    UI.modal.setAttribute('aria-hidden', 'true');

    if (threadModalOpener?.isConnected && !threadModalOpener.ownerDocument.defaultView?.closed) {
        threadModalOpener.ownerDocument.defaultView?.focus();
        threadModalOpener.focus({ preventScroll: true });
    }
    threadModalOpener = null;
}

UI.modal.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeThreadModal();
});
UI.modalClose?.addEventListener('click', closeThreadModal);
UI.modalClose2?.addEventListener('click', closeThreadModal);
UI.modal.addEventListener('click', (event) => {
    const target = event.target;
    if (target && target.getAttribute && target.getAttribute('data-close') === 'thread') {
        closeThreadModal();
    }
});
UI.modalCopyBtn?.addEventListener('click', async () => {
    const raw = UI.modalCopyBtn.dataset.copy || '';
    try {
        await navigator.clipboard.writeText(raw);
        UI.modalCopyBtn.textContent = 'Copied';
        setTimeout(() => (UI.modalCopyBtn.textContent = 'Copy raw thread block'), 900);
    } catch {
        UI.modalCopyBtn.textContent = 'Copy failed';
        setTimeout(() => (UI.modalCopyBtn.textContent = 'Copy raw thread block'), 1200);
    }
});
UI.openRawDumpBtn?.addEventListener('click', openRawDumpTab);





async function pasteThreadDumpFromClipboard() {
    // Start reading at the click, rather than after earlier queued additions.
    const read = Promise.resolve().then(() => navigator.clipboard.readText()).then(text =>
        text.trim()
            ? { sources: [{ text, name: 'clipboard-thread-dump.txt', kind: 'clipboard' }], failures: [] }
            : { sources: [], failures: ['Clipboard is empty. Copy a JVM thread dump and try Paste again.'], notice: {
                severity: 'info', title: 'Clipboard is empty', summary: 'There is no text on the clipboard to analyze.',
                guidance: 'Copy a HotSpot text or JSON thread dump, then use Paste again.',
            } },
    () => ({ sources: [], failures: ['The clipboard could not be read. Allow clipboard access, or use Ctrl+V outside a text field.'], notice: {
        severity: 'warning', title: 'Could not read clipboard', summary: 'The browser could not access clipboard text.',
        guidance: 'Allow clipboard access, use Ctrl+V outside a text field, or choose a dump file.',
    } }));
    return queueSessionImport(read);
}

// ---- events & UI wiring ----
function beginInputRequest() {
    const requestId = inputRequestGate.begin();
    analysisClient.cancel();
    return requestId;
}

function applySessionAnalysis(result) {
    reportDatasetRevision++;
    blockingPatterns = result.blockingPatterns || [];
    blockingPatternSummary = result.blockingPatternSummary || null;
    ({ parserResult, parsedDumps, threadSeries, runnableStackClusters } = result);
    cpuTimelineModelCache = null;
    UI.fileName.textContent = sessionSources.length === 1
        ? inputSourceLabel(sessionSources[0])
        : `${parsedDumps.length} snapshots · ${sessionSources.length} sources`;
    UI.fileName.title = sessionSources.map(inputSourceLabel).join('\n');
    renderParserState(parserResult);
    activateSelectedDump();
    renderDumpNavigator();
    render();
}

async function addBlockingFinding(pattern, allObservations) {
    try {
        const capturedSources = sessionSources.map(s => ({name:s.name,kind:s.kind,id:s.id,text:s.text}));
        const finding = createBlockingFinding({pattern, snapshotIndex: selectedDumpIndex, allObservations,
            context:{datasetRevision:reportDatasetRevision, sources:capturedSources.map(({text,...source})=>source),
                snapshotCount:parsedDumps.length, tableSearch:UI.searchInput.value, cpuProfile:cpuThresholdProfileId,
                chartFilter:chartFilterState, tableFocus:runnableClusterTableFocusState, graphPresentation:dependencyGraphView.exportContext(),
                tableFilters:{daemon:UI.onlyDaemonToggle.checked,blocked:UI.onlyBlockedToggle.checked,waiting:UI.onlyWaitingToggle.checked,deadlocked:UI.onlyDeadlockedToggle.checked,carrier:UI.onlyCarrierToggle.checked},
                evidenceScope:'Full parsed snapshots for this pattern; table/search/chart filters do not restrict dependency evidence.'}});
        // Clone the graph before any await, while it still represents this selection.
        const graphic = dependencyGraphView.exportPng({download:false});
        finding.context.inputSha256 = await inputDigest(capturedSources);
        finding.graphic = await graphic || null;
        findingsReport.add(finding);
    } catch(error) {showSessionInputStatus(`Could not add finding: ${error.message}`);}
}

function setInputBusy(isBusy, message = 'Analyzing thread dump…') {
    document.body.classList.toggle('analyzer-busy', isBusy);
    UI.loadingState?.classList.toggle('hidden', !isBusy);
    if (UI.loadingState) UI.loadingState.textContent = isBusy ? message : '';
    UI.threadTable?.setAttribute('aria-busy', String(isBusy));
    UI.dependencyGraphPanel?.setAttribute('aria-busy', String(isBusy));
}

function showInputFailure(summary, guidance) {
    if (!UI.errorState) return;
    UI.errorState.classList.remove('hidden', 'analysis-state-warning');
    UI.errorState.classList.add('analysis-state-error');
    UI.errorState.textContent = `${summary} ${guidance}`;
    inputFeedbackDialog.show(getInputDialogFeedback({ previousSnapshotCount: parsedDumps.length,
        notice: { severity: 'error', title: 'Thread dump analysis failed', summary, guidance } }));
}

function resetSessionView() {
    selectedBlockingPatternKey = '';
    invalidateRawDumpWorkspace();
    if (UI.modal?.open) closeThreadModal();
    resetDatasetScopedUi(UI);

    chartFilterState = null;
    cpuTimelineState = { query: '', limit: 10, selectedSeriesKey: '' };
    cpuTimelineModelCache = null;
    if (UI.cpuTimelineSearch) UI.cpuTimelineSearch.value = '';
    if (UI.cpuTimelineLimit) UI.cpuTimelineLimit.value = '10';
    pageState.page = 1;
    selectedDumpIndex = 0;
    runnableClusterFilterState = {
        persistentOnly: false,
        growingOnly: false,
        minDumpsSeen: 2
    };
    runnableClusterPage = 1;
    resetRunnableClusterUiState();
	clearRunnableClusterTableFocus();
}

function cancelSessionInputs() {
    exampleReadController?.abort();
    exampleReadController = null;
    inputFeedbackDialog.close({ restoreFocus: false });
    sessionInputQueue.clear();
    inputRequestGate.invalidate();
    analysisClient.cancel();
}

function showSessionInputStatus(message) {
    if (!UI.sessionInputStatus) return;
    UI.sessionInputStatus.textContent = message;
    UI.sessionInputStatus.classList.toggle('hidden', !message);
}

function queueSessionImport(read, mode = UI.inputMode?.value || 'append') {
    // Replacing cancels pending additions, but keeps the current session until validation succeeds.
    if (mode === 'replace') cancelSessionInputs();
    return sessionInputQueue.enqueue(async isCurrent => {
        const requestId = beginInputRequest();
        const previousSnapshotCount = parsedDumps.length;
        try {
            const { sources, failures = [], notice = null } = await (typeof read === 'function' ? read() : read);
            if (!isCurrent() || !inputRequestGate.isCurrent(requestId)) return;
            if (!sources.length) {
                showSessionInputStatus(`${failures.join(' ')}${sessionSources.length ? ' The current session was kept.' : ''}`);
                inputFeedbackDialog.show(getInputDialogFeedback({ failures, notice, previousSnapshotCount, mode }));
                return;
            }
            const base = mode === 'replace' ? [] : sessionSources;
            const candidates = [...base, ...sources.map(source => ({ ...source, id: `source:${++nextSessionSourceId}` }))];
            const result = await analysisClient.analyze(candidates, cpuThresholdProfile.thresholds);
            if (!result || !isCurrent() || !inputRequestGate.isCurrent(requestId)) return;
            const submittedResults = result.sourceResults.slice(base.length);
            const feedback = getInputDialogFeedback({ sourceResults: submittedResults, failures, previousSnapshotCount, mode });
            const additions = submittedResults.filter(source => source.accepted);
            const rejected = submittedResults.filter(source => !source.accepted)
                .map(source => `${source.label}: ${getInputFeedback(source)?.summary || 'No supported thread dump was found.'}`);
            if (!additions.length) {
                if (!sessionSources.length) renderParserState(result.parserResult);
                showSessionInputStatus([...failures, ...rejected, sessionSources.length ? 'The current session was kept.' : ''].filter(Boolean).join(' '));
                inputFeedbackDialog.show(feedback);
                return;
            }
            const oldCount = mode === 'append' ? parsedDumps.length : 0;
            if (!oldCount) resetSessionView();
            else {
                invalidateRawDumpWorkspace();
                if (UI.modal?.open) closeThreadModal();
                clearRunnableClusterTableFocus();
            }
            sessionSources = candidates.filter((_, index) => result.sourceResults[index].accepted);
            selectedDumpIndex = oldCount;
            applySessionAnalysis(result);
            const count = additions.reduce((total, source) => total + source.snapshotCount, 0);
            showSessionInputStatus([
                `${count} snapshot${count === 1 ? '' : 's'} ${mode === 'replace' || !oldCount ? 'loaded' : 'added'} · ${parsedDumps.length} in this session from ${sessionSources.length} source${sessionSources.length === 1 ? '' : 's'}.`,
                ...failures, ...rejected,
            ].join(' '));
            inputFeedbackDialog.show(feedback);
        } catch (error) {
            if (!isCurrent() || !inputRequestGate.isCurrent(requestId)) return;
            console.error('Failed to analyze thread dump:', error);
            showInputFailure('Thread dump analysis failed unexpectedly.', 'Reload the page if the analysis worker could not load, or try a complete HotSpot text/JSON dump.');
            if (sessionSources.length) showSessionInputStatus('The current session was kept. The new input could not be analyzed.');
        }
    });
}

function onLoadText(text, name, kind = 'file', mode) {
    return queueSessionImport(Promise.resolve({ sources: [{ text: String(text || ''), name, kind }] }), mode);
}

function readThreadDumpFiles(files, kind) {
    return Promise.all(files.map(async file => {
        try { return { source: { text: await file.text(), name: file.name, kind } }; }
        catch { return { failure: `${file.name} could not be read. Choose a readable text or JSON dump.` }; }
    })).then(results => ({
        sources: results.filter(result => result.source).map(result => result.source),
        failures: results.filter(result => result.failure).map(result => result.failure),
    }));
}

function renderParserState(result) {
    if (!UI.errorState || !UI.threadTable) return;

    const hasBlockingStatus = result?.status === 'empty' || result?.status === 'unsupported';
    UI.threadTable.classList.toggle('hidden', hasBlockingStatus);
    UI.errorState.classList.toggle('hidden', !result || result.status === 'success');
    UI.errorState.classList.toggle('analysis-state-warning', result?.status === 'partial');
    UI.errorState.classList.toggle('analysis-state-error', result?.status === 'empty' || result?.status === 'unsupported');

    if (!result || result.status === 'success') {
        UI.errorState.textContent = '';
        return;
    }

    const feedback = getInputFeedback(result);
    const message = feedback?.summary || 'Thread dump analysis could not be completed.';
    const guidance = feedback?.guidance || '';
    const diagnostics = result.diagnostics || {};
    UI.errorState.textContent = `${message} Detected ${diagnostics.supportedThreadHeaders || 0} supported thread header${diagnostics.supportedThreadHeaders === 1 ? '' : 's'} across ${diagnostics.snapshots || 0} snapshot${diagnostics.snapshots === 1 ? '' : 's'}. ${guidance}`.trim();
}

function activateSelectedDump() {
    if (rawDumpSnapshot && rawDumpSnapshot !== parsedDumps[selectedDumpIndex]) invalidateRawDumpWorkspace();
    const selected = parsedDumps[selectedDumpIndex] || null;
    if (UI.openRawDumpBtn) UI.openRawDumpBtn.disabled = !selected?.rawText;

    if (!selected) {
        allThreads = [];
        filtered = [];
        deadlocks = [];
        classInitializationChains = [];
        contentionChains = [];
        smartAnalysis = null;
        if (UI.dumpPointInTime) {
            UI.dumpPointInTime.textContent = '';
            UI.dumpPointInTime.title = '';
            UI.dumpPointInTime.dataset.timeStatus = '';
        }
        return;
    }

    allThreads = selected.threads || [];
    deadlocks = selected.deadlocks || [];
    classInitializationChains = selected.classInitializationChains || [];
    contentionChains = selected.contentionChains || [];
    smartAnalysis = selected.smartAnalysis || null;

    pageState.page = 1;
    applyFilters();
}
function formatDumpLabel(dump, idx) {
    const ts = dump?.timestamp || `Dump ${idx + 1}`;
    const count = dump?.threads?.length ?? 0;
    const time = formatSnapshotTime(dump);
    return `#${idx + 1} · ${ts} · ${time.pillLabel} · ${count} threads${dump.sourceLabel ? ` · ${dump.sourceLabel}` : ''}`;
}

function renderDeltaPill(label, value) {
    if (value == null) return '';

    const cls =
        value > 0 ? 'dump-delta-pill dump-delta-pill-up' :
            value < 0 ? 'dump-delta-pill dump-delta-pill-down' :
                'dump-delta-pill dump-delta-pill-neutral';

    const prefix = value > 0 ? '+' : '';
    return `<span class="${cls}">${escapeHtml(label)} ${prefix}${value}</span>`;
}

function renderThreadChangePill(label, value, variant, tooltip) {
    if (value == null) return '';
    const cls = variant === 'up'
        ? 'dump-delta-pill dump-delta-pill-up'
        : variant === 'down'
            ? 'dump-delta-pill dump-delta-pill-down'
            : 'dump-delta-pill dump-delta-pill-neutral';
    const prefix = variant === 'up' && value > 0 ? '+' : variant === 'down' && value > 0 ? '−' : '';
    return `<span class="${cls} has-tooltip" data-tooltip="${escapeAttr(tooltip)}">${escapeHtml(label)} ${prefix}${escapeHtml(value)}</span>`;
}

function renderSnapshotTimePill(dump) {
    const time = formatSnapshotTime(dump);
    return `<span class="dump-delta-pill dump-time-pill-${escapeAttr(time.severity)} has-tooltip" data-tooltip="${escapeAttr(time.tooltip)}">${escapeHtml(time.pillLabel)}</span>`;
}

function renderDumpNavigator() {
    if (!UI.dumpNavigator || !UI.dumpSelect || !UI.dumpCountLabel || !UI.dumpDeltaSummary) return;

    if (!parsedDumps.length || parsedDumps.length <= 1) {
        UI.dumpNavigator.classList.add('hidden');
        UI.dumpSelect.innerHTML = '';
        UI.dumpCountLabel.textContent = '1 dump';
        UI.dumpDeltaSummary.innerHTML = '';
        const view = getDumpNavigationView(selectedDumpIndex, parsedDumps.length);
        if (UI.dumpNavigationAnnouncement) UI.dumpNavigationAnnouncement.textContent = view.announcement;
        return;
    }

    UI.dumpNavigator.classList.remove('hidden');
    const selected = parsedDumps[selectedDumpIndex];
    const navigationView = getDumpNavigationView(
        selectedDumpIndex,
        parsedDumps.length,
        selected?.timestamp,
    );
    UI.dumpCountLabel.textContent = navigationView.positionText;

    UI.dumpSelect.innerHTML = parsedDumps
        .map((dump, idx) => {
            const selected = idx === selectedDumpIndex ? 'selected' : '';
            return `<option value="${idx}" ${selected}>${escapeHtml(formatDumpLabel(dump, idx))}</option>`;
        })
        .join('');

    const delta = selected?.delta;
    const changes = selected?.threadChanges;

    const transitionPills = delta
        ? [
            renderDeltaPill('Threads', delta.threadsDelta),
            renderDeltaPill('Blocked', delta.blockedDelta),
            renderDeltaPill('Runnable', delta.runnableDelta),
            renderDeltaPill('Waiting', delta.waitingDelta),
            renderDeltaPill('Deadlocked', delta.deadlockedDelta),
            renderThreadChangePill(
                'New',
                changes?.newCount ?? '?',
                changes?.newCount == null ? 'neutral' : 'up',
                changes?.newCount == null ? 'Unavailable because the snapshot collection cannot be compared reliably' : boundedTooltipLines(
                    (selected.threads || [])
                        .filter((thread) => thread.snapshotChange?.status === 'new')
                        .map((thread) => thread.threadName),
                    'No new exact identities',
                ),
            ),
            renderThreadChangePill(
                'Ended',
                changes?.endedCount ?? '?',
                changes?.endedCount == null ? 'neutral' : 'down',
                changes?.endedCount == null
                    ? 'Unavailable because snapshots are incomplete, have different coverage, or identities are unresolved'
                    : boundedTooltipLines(
                        (changes?.endedThreads || []).map((thread) => thread.threadName),
                        'No ended identities',
                    ),
            ),
            renderThreadChangePill(
                'Changed',
                changes?.changedCount ?? '?',
                'neutral',
                boundedTooltipLines(
                    (selected.threads || [])
                        .filter((thread) => thread.snapshotChange?.changes?.length)
                        .map((thread) => `${thread.threadName}: ${snapshotChangeSummary(thread)}`),
                    'No material per-thread changes',
                ),
            ),
            renderThreadChangePill(
                'Identity?',
                changes?.unresolvedCount,
                'neutral',
                boundedTooltipLines(
                    (selected.threads || [])
                        .filter((thread) => thread.snapshotChange?.status === 'unresolved')
                        .map((thread) => thread.threadName),
                    'No unresolved identities',
                ),
            )
        ]
        : ['<span class="dump-delta-pill dump-delta-pill-neutral">First snapshot</span>'];
    transitionPills.push(renderSnapshotTimePill(selected));
    UI.dumpDeltaSummary.innerHTML = transitionPills.join('');

    UI.prevDumpBtn.disabled = navigationView.previousDisabled;
    UI.nextDumpBtn.disabled = navigationView.nextDisabled;
    if (UI.dumpNavigationAnnouncement) {
        UI.dumpNavigationAnnouncement.textContent = navigationView.announcement;
    }
}

function navigateToDump(action, directIndex) {
    const nextIndex = resolveDumpIndex(selectedDumpIndex, parsedDumps.length, action, directIndex);
    if (nextIndex === selectedDumpIndex) return false;

    captureRunnableClusterUiStateFromDom();
    clearRunnableClusterTableFocus();
    selectedDumpIndex = nextIndex;
    activateSelectedDump();
    renderDumpNavigator();
    render();
    return true;
}

function activateCpuThresholdProfile(profileId) {
    cpuThresholdProfileId = resolveRunnableCpuThresholdProfileId(profileId);
    cpuThresholdProfile = getRunnableCpuThresholdProfile(cpuThresholdProfileId);
    if (UI.cpuThresholdProfile) {
        const thresholds = cpuThresholdProfile.thresholds;
        UI.cpuThresholdProfile.value = cpuThresholdProfileId;
        UI.cpuThresholdProfile.title =
            `${cpuThresholdProfile.description} ` +
            `Application finding/scenario: ${thresholds.applicationFindingPercent}%/${thresholds.applicationScenarioPercent}%. ` +
            `Infrastructure finding/scenario: ${thresholds.infrastructureFindingPercent}%/${thresholds.infrastructureScenarioPercent}%. ` +
            `Livelock evidence: ${thresholds.livelockPercent}%.`;
    }

    const url = new URL(window.location.href);
    url.search = updateRunnableCpuThresholdProfileSearch(url.search, cpuThresholdProfileId);
    window.history.replaceState(null, '', url);
}

activateCpuThresholdProfile(cpuThresholdProfileId);

UI.cpuThresholdProfile?.addEventListener('change', async (event) => {
    const requestedProfile = getRunnableCpuThresholdProfile(event.target.value);
    if (!sessionSources.length) {
        activateCpuThresholdProfile(requestedProfile.id);
        return;
    }
    await sessionInputQueue.enqueue(async isCurrent => {
        const requestId = beginInputRequest();
        captureRunnableClusterUiStateFromDom();
        try {
            const result = await analysisClient.analyze(sessionSources, requestedProfile.thresholds);
            if (result && isCurrent() && inputRequestGate.isCurrent(requestId)) {
                activateCpuThresholdProfile(requestedProfile.id);
                applySessionAnalysis(result);
            }
        } catch (error) {
            if (!isCurrent() || !inputRequestGate.isCurrent(requestId)) return;
            showInputFailure('Thread dump analysis failed unexpectedly.', 'Try the CPU profile again; the current session was kept.');
        } finally {
            UI.cpuThresholdProfile.value = cpuThresholdProfileId;
        }
    });
});

UI.fileInput?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) await queueSessionImport(readThreadDumpFiles(files, 'file'));
});
UI.dumpSelect?.addEventListener('change', (e) => {
    const idx = Number(e.target.value);
    if (!Number.isFinite(idx)) return;
    navigateToDump('direct', idx);
});

UI.nextDumpBtn?.addEventListener('click', () => {
    navigateToDump('next');
});

UI.prevDumpBtn?.addEventListener('click', () => {
    navigateToDump('previous');
});

function loadThreadExample(sample) {
    return queueSessionImport(async () => {
        const controller = new AbortController();
        exampleReadController = controller;
        try {
            const text = await readExample(sample, { signal: controller.signal });
            return { sources: [{ text, name: sample.filename, kind: 'sample',
                exampleTitle: sample.id === 'tda-overview' ? '' : sample.title }] };
        } catch (error) {
            return { sources: [], notice: { severity: 'error', title: 'Could not load example',
                summary: `${sample.title}: ${error.message}`,
                guidance: 'Try loading the example again, or choose a local dump file. The current session was kept.' } };
        } finally {
            if (exampleReadController === controller) exampleReadController = null;
        }
    }, 'replace');
}
createExamplePicker({ samples: THREAD_EXAMPLES, analyzer: 'tda',
    button: document.getElementById('chooseExampleBtn'), onLoad: loadThreadExample });
UI.loadSampleBtn?.addEventListener('click', () => loadThreadExample(THREAD_EXAMPLES[0]));
UI.pasteClipboardBtn?.addEventListener('click', async () => {
    await pasteThreadDumpFromClipboard();
});

const helpSearch = createHelpSearch(UI.howToUseModal);
function openHowToUseModal() {
    if (!UI.howToUseModal) return;
    UI.howToUseModal.classList.remove('hidden');
    UI.howToUseModal.setAttribute('aria-hidden', 'false');
    UI.howToUseModal.showModal?.();
    helpSearch.reset();
    UI.howToUseModal.querySelector('.help-modal-body')?.scrollTo({ top: 0 });
    UI.howToUseModalClose?.focus({ preventScroll: true });
}

function closeHowToUseModal() {
    if (!UI.howToUseModal) return;
    UI.howToUseModal.classList.add('hidden');
    UI.howToUseModal.setAttribute('aria-hidden', 'true');
    UI.howToUseModal.close?.();
    UI.howToUseBtn?.focus();
}

UI.howToUseBtn?.addEventListener('click', openHowToUseModal);
UI.howToUseModalClose?.addEventListener('click', closeHowToUseModal);
UI.howToUseModalClose2?.addEventListener('click', closeHowToUseModal);
UI.howToUseModal?.addEventListener('click', (event) => {
    if (event.target?.dataset?.close === 'how-to-use') closeHowToUseModal();
});
UI.howToUseModal?.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeHowToUseModal();
});



UI.clearBtn?.addEventListener('click', () => {
    cancelSessionInputs();
    sessionSources = [];
    showSessionInputStatus('');

    parsedDumps = [];
    blockingPatterns = [];
    blockingPatternSummary = null;
    threadSeries = [];
    selectedDumpIndex = 0;
    parserResult = null;

    allThreads = [];
    filtered = [];
    deadlocks = [];
    classInitializationChains = [];
    contentionChains = [];
    smartAnalysis = null;
    runnableStackClusters = [];
    runnableClusterPage = 1;
    chartFilterState = null;
    cpuTimelineState = { query: '', limit: 10, selectedSeriesKey: '' };
    cpuTimelineModelCache = null;
    pageState.page = 1;
    clearRunnableClusterTableFocus();

    runnableClusterFilterState = {
        persistentOnly: false,
        growingOnly: false,
        minDumpsSeen: 2
    };
    resetRunnableClusterUiState();
    UI.fileName.textContent = 'No file loaded';
    UI.fileName.title = '';

    if (UI.fileInput) {
        UI.fileInput.value = '';
    }

    if (UI.searchInput) {
        UI.searchInput.value = '';
    }
    if (UI.cpuTimelineSearch) UI.cpuTimelineSearch.value = '';
    if (UI.cpuTimelineLimit) UI.cpuTimelineLimit.value = '10';

    if (UI.errorState) {
        UI.errorState.textContent = '';
        UI.errorState.classList.add('hidden');
        UI.errorState.classList.remove('analysis-state-warning', 'analysis-state-error');
    }
    if (UI.threadTable) {
        UI.threadTable.classList.remove('hidden');
    }

    if (UI.onlyDaemonToggle) UI.onlyDaemonToggle.checked = false;
    if (UI.onlyBlockedToggle) UI.onlyBlockedToggle.checked = false;
    if (UI.onlyWaitingToggle) UI.onlyWaitingToggle.checked = false;
    if (UI.onlyDeadlockedToggle) UI.onlyDeadlockedToggle.checked = false;
    if (UI.onlyCarrierToggle) UI.onlyCarrierToggle.checked = false;

    invalidateRawDumpWorkspace();
    resetDatasetScopedUi(UI);
    renderDumpNavigator();
    render();
});

UI.runnableClusterCompareModalClose?.addEventListener('click', closeRunnableClusterCompareModal);
UI.runnableClusterCompareModalClose2?.addEventListener('click', closeRunnableClusterCompareModal);

UI.runnableClusterCompareModal?.addEventListener('click', (e) => {
    if (e.target?.dataset?.close === 'runnable-cluster-compare') {
        closeRunnableClusterCompareModal();
    }
});

UI.deadlockPanelBody?.addEventListener('click', (e) => {
    const showBtn = e.target.closest('.show-deadlocked-threads-btn');
    if (showBtn) {
        const cycleId = Number(showBtn.dataset.cycleId);
        const cycle = deadlocks.find((d) => Number(d.id) === cycleId);
        if (cycle) openDeadlockedThreadsModal(cycle);
        return;
    }

    const btn = e.target.closest('.deadlock-thread-btn');
    if (btn) {
        const t = allThreads.find((x) => x.sourceKey === btn.dataset.sourceKey);
        if (t) openThreadModal(t);
    }
});

function closeDeadlockedThreadsModal() {
    if (!UI.deadlockedThreadsModal) return;
    UI.deadlockedThreadsModal.classList.add('hidden');
    UI.deadlockedThreadsModal.setAttribute('aria-hidden', 'true');
    UI.deadlockedThreadsModal.close?.();
}

UI.deadlockedThreadsModalClose?.addEventListener('click', closeDeadlockedThreadsModal);
UI.deadlockedThreadsModalClose2?.addEventListener('click', closeDeadlockedThreadsModal);

UI.deadlockedThreadsModal?.addEventListener('click', (e) => {
    if (e.target?.dataset?.close === 'deadlocked-threads') {
        closeDeadlockedThreadsModal();
    }
});

UI.refreshBtn?.addEventListener('click', () => {
    pageState.page = 1;
    applyFilters();
    render();
});
document.getElementById('clearThreadFiltersBtn').addEventListener('click', () => {
    UI.searchInput.value = '';
    for (const toggle of [UI.onlyDaemonToggle, UI.onlyBlockedToggle, UI.onlyWaitingToggle, UI.onlyDeadlockedToggle, UI.onlyCarrierToggle]) toggle.checked = false;
    chartFilterState = null;
    clearRunnableClusterTableFocus();
    pageState.page = 1;
    applyFilters();
    render();
    UI.searchInput.focus();
});
document.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;

    const clearBtn = e.target.closest('#clearChartFilterBtn');
    if (clearBtn) {
        e.preventDefault();
        e.stopPropagation();
        clearChartFilter();
        return;
    }

    const clearFocusBtn = e.target.closest('#clearFocusFilterBtn');
    if (clearFocusBtn) {
        e.preventDefault();
        e.stopPropagation();
        resetRunnableClusterTableFocusAndRender();
    }
});
UI.searchInput?.addEventListener(
    'input',
    debounce(() => {
        pageState.page = 1;
        applyFilters();
        render();
    }, 120)
);

UI.cpuTimelineSearch?.addEventListener('input', debounce((event) => {
    cpuTimelineState.query = String(event.target.value || '').trim();
    cpuTimelineState.selectedSeriesKey = '';
    renderCpuTimelineChart();
}, 120));

UI.cpuTimelineLimit?.addEventListener('change', (event) => {
    cpuTimelineState.limit = Number(event.target.value) || 10;
    renderCpuTimelineChart();
});

UI.cpuTimelineLegend?.addEventListener('click', (event) => {
    const item = event.target.closest('.cpu-timeline-legend-item');
    if (!item) return;
    const key = String(item.dataset.timelineSeriesKey || '');
    cpuTimelineState.selectedSeriesKey = cpuTimelineState.selectedSeriesKey === key ? '' : key;
    updateCpuTimelineEmphasis();
});

// A closed details element has no usable width. Redraw when opened or resized
// so the SVG uses the available desktop width instead of a stale viewBox.
if (UI.cpuTimelineChart && typeof ResizeObserver !== 'undefined') {
    let previousTimelineWidth = 0;
    const timelineResizeObserver = new ResizeObserver(entries => {
        const width = entries[0]?.contentRect.width || 0;
        const changed = Math.abs(width - previousTimelineWidth) > 1;
        previousTimelineWidth = width;
        if (width > 0 && changed) renderCpuTimelineChart();
    });
    timelineResizeObserver.observe(UI.cpuTimelineChart);
}

for (const eventName of ['pointerover', 'focusin']) {
    UI.cpuTimelineLegend?.addEventListener(eventName, event => {
        const item = event.target.closest('.cpu-timeline-legend-item');
        if (item) updateCpuTimelineEmphasis(item.dataset.timelineSeriesKey);
    });
}
for (const eventName of ['pointerleave', 'focusout']) {
    UI.cpuTimelineLegend?.addEventListener(eventName, () => updateCpuTimelineEmphasis());
}


UI.openThreadStateChartBtn?.addEventListener('click', () => {
    openThreadStateChartModal();
});

UI.threadStateChartModalCloseBtn?.addEventListener('click', () => {
    closeThreadStateChartModal();
});

UI.threadStateChartModal?.addEventListener('click', (e) => {
    const backdrop = e.target.closest('[data-close-thread-state-chart-modal="true"]');
    if (backdrop) {
        closeThreadStateChartModal();
    }
});

UI.onlyDaemonToggle?.addEventListener('change', () => {
    pageState.page = 1;
    applyFilters();
    render();
});
UI.onlyBlockedToggle?.addEventListener('change', () => {
    pageState.page = 1;
    applyFilters();
    render();
});
UI.onlyWaitingToggle?.addEventListener('change', () => {
    pageState.page = 1;
    applyFilters();
    render();
});

UI.onlyDeadlockedToggle?.addEventListener('change', () => {
    pageState.page = 1;
    applyFilters();
    render();
});

UI.onlyCarrierToggle?.addEventListener('change', () => {
    pageState.page = 1;
    applyFilters();
    render();
});

function focusSmartAnalysisFinding(finding) {
    const members = (finding?.threads || []).map((reference) => {
        const sourceKey = String(reference?.sourceKey || '');
        const index = Number(reference?.index);
        const thread = sourceKey
            ? allThreads.find((candidate) => candidate.sourceKey === sourceKey)
            : allThreads.find((candidate) => Number(candidate.index) === index);
        return thread ? { ...thread, dumpIndex: selectedDumpIndex } : null;
    }).filter(Boolean);

    runnableClusterTableFocusState = createFocusedTableState(
        `Smart analysis · ${finding?.title || 'finding'}`,
        selectedDumpIndex,
        members,
    );
    pageState.page = 1;
    applyFilters();
    render();
    scrollToFocusedThreadRow();
    if (UI.focusFilterAnnouncement) {
        UI.focusFilterAnnouncement.textContent = `Table focused on ${members.length} threads from smart analysis finding ${finding?.title || ''}.`;
    }
}

UI.smartAnalysisPanelBody?.addEventListener('click', (event) => {
    const focusButton = event.target.closest('.smart-analysis-focus-btn');
    if (focusButton) {
        const finding = (smartAnalysis?.findings || [])
            .find((item) => item.id === focusButton.dataset.smartFindingId);
        if (finding) focusSmartAnalysisFinding(finding);
        return;
    }

    const threadButton = event.target.closest('.smart-analysis-thread-btn');
    if (!threadButton) return;
    const thread = allThreads.find((candidate) =>
        candidate.sourceKey === threadButton.dataset.sourceKey);
    if (thread) openThreadModal(thread, threadButton);
});

UI.contentionPanelBody?.addEventListener('click', async (event) => {
    const threadButton = event.target.closest('.contention-thread-btn');
    if (threadButton) {
        const thread = allThreads.find(item => item.sourceKey === threadButton.dataset.sourceKey);
        if (thread) openThreadModal(thread, threadButton);
        return;
    }
    const copyButton = event.target.closest('.contention-copy-btn');
    if (copyButton) {
        try {
            await navigator.clipboard.writeText(copyButton.dataset.copyLock);
            copyButton.textContent = 'Copied';
        } catch {
            copyButton.textContent = 'Copy failed';
        }
        setTimeout(() => { if (copyButton.isConnected) copyButton.textContent = 'Copy address'; }, 1400);
        return;
    }
    const graphButton = event.target.closest('.contention-graph-btn');
    if (!graphButton) return;
    const graphDetails = UI.dependencyGraphPanel?.querySelector('details');
    const wasOpen = graphDetails?.open;
    if (graphDetails) graphDetails.open = true;
    if (!dependencyGraphView.revealLock(graphButton.dataset.lockId)) {
        if (graphDetails) graphDetails.open = wasOpen;
        UI.contentionPanelBody.querySelector('.contention-action-status').textContent = 'No matching lock is available in the dependency graph.';
        return;
    }
    UI.contentionPanelBody.querySelector('.contention-action-status').textContent = '';
    contentionGraphOrigin = graphButton;
    rawDumpReturn.hidden = true;
    contentionGraphReturn.hidden = false;
    UI.dependencyGraphPanel.scrollIntoView({ block: 'start' });
    contentionGraphReturn.focus({ preventScroll: true });
});

contentionGraphReturn.addEventListener('click', () => {
    if (!contentionGraphOrigin?.isConnected) return;
    contentionGraphOrigin.closest('tr').scrollIntoView({ block: 'center' });
    contentionGraphOrigin.focus({ preventScroll: true });
});

UI.classInitializationPanelBody?.addEventListener('click', (e) => {
    const btn = e.target.closest('.class-initialization-thread-btn');
    if (!btn) return;

    const thread = allThreads.find((item) => item.sourceKey === btn.dataset.sourceKey);
    if (thread) openThreadModal(thread, btn);
});

function openThreadRowDetails(row, sourceElement = row) {
    const thread = allThreads.find((item) => item.sourceKey === row.dataset.sourceKey);
    if (thread) openThreadModal(thread, sourceElement);
}

// Delegate to the table body so sorting, filtering and paging retain activation.
UI.tbody?.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const row = e.target.closest('tr.thread-details-row');
    if (!row || row.parentElement !== UI.tbody) return;

    const btn = e.target.closest('.details-btn');
    if (btn) {
        openThreadRowDetails(row, btn);
        return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.target.closest('a, button, input, select, textarea, summary, [role="button"], [role="link"], [contenteditable]:not([contenteditable="false"])')) return;

    // Selecting text should not open the dialog when the mouse is released.
    const selection = window.getSelection();
    if (selection?.toString() && selection.containsNode(row, true)) return;
    openThreadRowDetails(row);
});

UI.tbody?.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('tr.thread-details-row');
    if (!row || row !== e.target || row.parentElement !== UI.tbody) return;
    e.preventDefault();
    openThreadRowDetails(row);
});

// Pager click handler
UI.pager?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-page]');
    if (!btn) return;
    const p = Number(btn.getAttribute('data-page'));
    if (!Number.isFinite(p)) return;
    pageState.page = p;
    render();
});

UI.runnableClusterPanelBody?.addEventListener('change', (e) => {
    const target = e.target;
    if (!target) return;

    if (target.id === 'runnablePersistentOnlyToggle') {
        runnableClusterPage = 1;
        runnableClusterFilterState.persistentOnly = Boolean(target.checked);
        render();
        return;
    }

    if (target.id === 'runnableGrowingOnlyToggle') {
        runnableClusterPage = 1;
        runnableClusterFilterState.growingOnly = Boolean(target.checked);
        render();
        return;
    }

    if (target.id === 'runnableMinDumpsSeenSelect') {
        runnableClusterPage = 1;
        const n = Number(target.value);
        runnableClusterFilterState.minDumpsSeen = Number.isFinite(n) ? n : 2;
        render();
    }
});

UI.runnableClusterPanelBody?.addEventListener('toggle', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLDetailsElement)) return;

    if (target.classList.contains('runnable-cluster-panel-details')) {
        runnableClusterUiState.panelOpen = target.open;
        return;
    }

    if (target.classList.contains('runnable-cluster-card')) {
        const clusterId = target.getAttribute('data-cluster-id');
        if (clusterId) {
            runnableClusterUiState.clusterOpenById.set(String(clusterId), target.open);
            if (target.open && target.dataset.detailsLoaded !== 'true') {
                const cluster = getClusterById(clusterId);
                if (cluster) {
                    const shell = document.createElement('div');
                    shell.innerHTML = renderRunnableClusterCard(cluster);
                    const body = target.querySelector('.runnable-cluster-card-body');
                    body.replaceChildren(...shell.querySelector('.runnable-cluster-card-body').childNodes);
                    target.dataset.detailsLoaded = 'true';
                }
            }
        }
        return;
    }

    if (target.classList.contains('runnable-cluster-stack-group-details')) {
        const key = target.getAttribute('data-stack-group-key');
        if (key) {
            runnableClusterUiState.stackGroupOpenByKey.set(String(key), target.open);
        }
    }
}, true);
UI.runnableClusterPanelBody?.addEventListener('click', (e) => {
    const clusterPageButton = e.target.closest('[data-cluster-page]');
    if (clusterPageButton) {
        captureRunnableClusterUiStateFromDom();
        runnableClusterPage = Number(clusterPageButton.dataset.clusterPage);
        renderRunnableClusterPanel();
        UI.runnableClusterPanelBody.querySelector('[data-cluster-page]:not(:disabled)')?.focus({ preventScroll: true });
        return;
    }
    const timelineCell = e.target.closest('.runnable-cluster-timeline-cell');
    if (timelineCell) {
        captureRunnableClusterUiStateFromDom();

        const dumpIdx = Number(timelineCell.dataset.dumpIdx);
        const clusterCard = timelineCell.closest('.runnable-cluster-card');
        const clusterId = clusterCard?.getAttribute('data-cluster-id');

		if (Number.isFinite(dumpIdx) && parsedDumps[dumpIdx]) {
		    selectedDumpIndex = dumpIdx;

		    if (clusterId) {
		        focusRunnableClusterInDump(clusterId, dumpIdx);
		    } else {
		        clearRunnableClusterTableFocus();
		    }

		    activateSelectedDump();
		    syncPageToRunnableClusterFocus();
		    renderDumpNavigator();
		    render();
            if (UI.focusFilterAnnouncement && isRunnableClusterTableFilteredToFocus()) {
                const summary = getRunnableClusterFocusVisibilitySummary();
                UI.focusFilterAnnouncement.textContent = `Table focused on ${summary?.visibleFocused || 0} threads from ${runnableClusterTableFocusState.clusterId} in dump ${dumpIdx + 1}.`;
            }
		    scrollToFocusedThreadRow();
		}
        return;
    }

    const compareBtn = e.target.closest('.runnable-cluster-compare-btn');
    if (compareBtn) {
        const clusterId = compareBtn.dataset.clusterId;
        if (clusterId) {
            openRunnableClusterCompareModal(clusterId);
        }
        return;
    }

    const detailsBtn = e.target.closest('.runnable-cluster-thread-btn');
    if (detailsBtn) {
        const dumpIdx = Number(detailsBtn.dataset.dumpIdx);

        const dump = parsedDumps[dumpIdx];
        const thread = dump?.threads?.find((t) => t.sourceKey === detailsBtn.dataset.sourceKey);

        if (!thread) return;

        clearRunnableClusterTableFocus();
        selectedDumpIndex = dumpIdx;
        activateSelectedDump();
        renderDumpNavigator();
        render();
        openThreadModal(thread);
    }
});

// ---- URL param handling ----
(function handleStartupParams() {
    const params = new URLSearchParams(window.location.search);

    if (params.has('readclipboard')) {
        // Delay ensures UI + event handlers are ready
        setTimeout(() => {
            if (UI.pasteClipboardBtn) {
                UI.pasteClipboardBtn.click();
            } else {
                console.warn('Paste button not found in UI');
            }
        }, 300);
    }
})();

function initDeadlockLockHover() {
    if (!UI.deadlockedThreadsModalBody) return;

    UI.deadlockedThreadsModalBody.addEventListener('mouseover', (e) => {
        const ref = e.target.closest('.deadlock-lock-ref');
        if (!ref || !UI.deadlockedThreadsModalBody.contains(ref)) return;

        setDeadlockLockHover(ref.dataset.lockId || '');
    });

    UI.deadlockedThreadsModalBody.addEventListener('mouseout', (e) => {
        const fromRef = e.target.closest('.deadlock-lock-ref');
        if (!fromRef) return;

        const toRef = e.relatedTarget?.closest?.('.deadlock-lock-ref');
        if (toRef && toRef.dataset.lockId === fromRef.dataset.lockId) return;

        clearDeadlockLockHover();
    });
}

// Sort handlers
function updateSortIndicators() {
    document.querySelectorAll('#threadTable th.sortable').forEach((th) => {
        const key = th.getAttribute('data-key');
        const ind = th.querySelector('.sort-indicator');
        if (!ind) return;
        if (key === sortState.key) {
            ind.textContent = sortState.dir === 'asc' ? '▲' : '▼';
        } else {
            ind.textContent = '';
        }
    });
}

document.querySelectorAll('#threadTable th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
        const key = th.getAttribute('data-key');
        if (!key) return;
        if (sortState.key === key) {
            sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
        } else {
            sortState.key = key;
            // sensible defaults
            sortState.dir =
                (key === 'threadName' || key === 'javaState' || key === 'stateText' || key === 'topFrame')
                    ? 'asc'
                    : 'desc';
        }
        applySort();
    });
});


let activeTooltipTarget = null;
let tooltipHideTimer = null;

function getTooltipHost() {
    return document.body;
}
function getTooltipEl() {
    let tooltipEl = document.getElementById('appTooltip');
    if (!tooltipEl) return null;

    const host = getTooltipHost();
    if (tooltipEl.parentElement !== host) {
        host.appendChild(tooltipEl);
    }

    return tooltipEl;
}

function getTooltipTextFromTarget(target) {
    if (!target) return '';
    return String(target.getAttribute('data-tooltip') || '').trim();
}

function tooltipNode(tagName, className, text = '') {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    node.textContent = text;
    return node;
}

function appendTooltipFact(grid, label, value) {
    if (value == null || value === '') return;
    grid.append(
        tooltipNode('span', 'app-tooltip-fact-label', label),
        tooltipNode('span', 'app-tooltip-fact-value', value),
    );
}

function renderDiagnosticTooltip(tooltipEl, payload) {
    tooltipEl.replaceChildren();
    tooltipEl.classList.remove('app-tooltip-timeline');
    tooltipEl.classList.add('app-tooltip-diagnostic');

    const header = tooltipNode('div', 'app-tooltip-diagnostic-header');
    header.appendChild(tooltipNode('strong', 'app-tooltip-diagnostic-title', payload.title || 'Diagnostic'));
    if (payload.evidence?.label) {
        const provenance = tooltipNode(
            'span',
            `app-tooltip-provenance app-tooltip-provenance-${payload.evidence.level || 'unclassified'}`,
            payload.evidence.label,
        );
        header.appendChild(provenance);
    }
    tooltipEl.appendChild(header);

    if (payload.reason) {
        tooltipEl.appendChild(tooltipNode('p', 'app-tooltip-diagnostic-reason', payload.reason));
    }

    const facts = tooltipNode('div', 'app-tooltip-facts');
    appendTooltipFact(facts, 'Confidence', String(payload.confidence || 'low').toUpperCase());
    if (Number.isFinite(payload.patternScore)) {
        appendTooltipFact(facts, 'Pattern score', `${payload.patternScore}/100`);
    }
    if (facts.childElementCount) tooltipEl.appendChild(facts);

    if (payload.evidence?.basis) {
        const section = tooltipNode('section', 'app-tooltip-section');
        section.append(
            tooltipNode('div', 'app-tooltip-section-title', 'Evidence basis'),
            tooltipNode('div', 'app-tooltip-section-text', payload.evidence.basis),
        );
        tooltipEl.appendChild(section);
    }

    if (Array.isArray(payload.signals) && payload.signals.length) {
        const section = tooltipNode('section', 'app-tooltip-section');
        section.appendChild(tooltipNode('div', 'app-tooltip-section-title', 'Scoring signals'));
        const list = tooltipNode('ul', 'app-tooltip-signal-list');
        payload.signals.forEach((signal) => {
            const item = tooltipNode('li', 'app-tooltip-signal');
            item.appendChild(tooltipNode('span', '', signal.label || 'Signal'));
            if (Number.isFinite(signal.points)) {
                const prefix = signal.points >= 0 ? '+' : '';
                item.appendChild(tooltipNode(
                    'span',
                    signal.points >= 0 ? 'app-tooltip-points-positive' : 'app-tooltip-points-negative',
                    `${prefix}${signal.points}`,
                ));
            }
            list.appendChild(item);
        });
        section.appendChild(list);
        tooltipEl.appendChild(section);
    }

    if (Array.isArray(payload.matchedFrames) && payload.matchedFrames.length) {
        const section = tooltipNode('section', 'app-tooltip-section');
        section.appendChild(tooltipNode('div', 'app-tooltip-section-title', 'Matched frames'));
        payload.matchedFrames.forEach((frame) => {
            section.appendChild(tooltipNode('code', 'app-tooltip-frame', frame));
        });
        if (payload.omittedFrameCount > 0) {
            section.appendChild(tooltipNode(
                'div',
                'app-tooltip-more',
                `+${payload.omittedFrameCount} more frame${payload.omittedFrameCount === 1 ? '' : 's'} in Details`,
            ));
        }
        tooltipEl.appendChild(section);
    }

    if (payload.evidence?.qualification) {
        const limitation = tooltipNode('section', 'app-tooltip-section app-tooltip-limitation');
        limitation.append(
            tooltipNode('div', 'app-tooltip-section-title', 'Limitation'),
            tooltipNode('div', 'app-tooltip-section-text', payload.evidence.qualification),
        );
        tooltipEl.appendChild(limitation);
    }
}

function renderCpuTimelineTooltip(tooltipEl, point) {
    tooltipEl.replaceChildren();
    tooltipEl.classList.add('app-tooltip-diagnostic', 'app-tooltip-timeline');

    const dump = parsedDumps[point.dumpIndex];
    const dumpLabel = `D${point.dumpIndex + 1}`;
    const header = tooltipNode('div', 'app-tooltip-diagnostic-header app-tooltip-timeline-header');
    header.appendChild(tooltipNode('strong', 'app-tooltip-diagnostic-title', point.threadName || 'Unknown thread'));
    header.appendChild(tooltipNode(
        'span',
        'app-tooltip-provenance app-tooltip-provenance-measured',
        'MEASURED INTERVAL',
    ));
    tooltipEl.appendChild(header);

    const hero = tooltipNode('div', 'app-tooltip-timeline-hero');
    const metric = tooltipNode('div', 'app-tooltip-timeline-metric');
    metric.append(
        tooltipNode('strong', 'app-tooltip-timeline-rate', `${point.ratePercent.toFixed(1)}%`),
        tooltipNode('span', 'app-tooltip-timeline-rate-label', 'CPU usage'),
    );
    const context = tooltipNode('div', 'app-tooltip-timeline-context');
    context.append(
        tooltipNode('strong', 'app-tooltip-timeline-dump', `D${point.dumpIndex}→${dumpLabel}`),
        tooltipNode('span', 'app-tooltip-timeline-timestamp', dump?.timestamp || 'Timestamp unavailable'),
        tooltipNode('span', 'app-tooltip-timeline-state', point.state || 'UNKNOWN'),
    );
    hero.append(metric, context);
    tooltipEl.appendChild(hero);

    const facts = tooltipNode('div', 'app-tooltip-facts app-tooltip-timeline-facts');
    appendTooltipFact(facts, 'CPU consumed', Number.isFinite(point.deltaMs) ? `${point.deltaMs.toFixed(2)} ms` : 'Unavailable');
    appendTooltipFact(facts, 'Measured over', Number.isFinite(point.intervalMs) ? `${point.intervalMs.toFixed(0)} ms` : 'Unavailable');
    appendTooltipFact(facts, 'Rate basis', point.rateBasis ? point.rateBasis.replaceAll('-', ' ') : 'Unavailable');
    if (Number.isFinite(point.intervalUncertaintyMs)) appendTooltipFact(facts, 'Time uncertainty', `±${point.intervalUncertaintyMs.toFixed(0)} ms`);
    if (point.intervalReason) appendTooltipFact(facts, 'Interval quality', point.intervalReason);
    appendTooltipFact(facts, 'Native ID', point.nativeId || 'Unavailable');
    tooltipEl.appendChild(facts);

    const stackSection = tooltipNode('section', 'app-tooltip-timeline-stack-section');
    const stackHeader = tooltipNode('div', 'app-tooltip-timeline-stack-header');
    stackHeader.append(
        tooltipNode('div', 'app-tooltip-section-title', 'Captured endpoint stack'),
        tooltipNode(
            'span',
            'app-tooltip-timeline-frame-count',
            `${point.stackLines.length} line${point.stackLines.length === 1 ? '' : 's'}`,
        ),
    );
    stackSection.appendChild(stackHeader);
    if (point.stackLines.length) {
        stackSection.appendChild(tooltipNode(
            'pre',
            'app-tooltip-timeline-stack',
            point.stackLines.join('\n'),
        ));
        if (point.omittedStackLineCount > 0) {
            stackSection.appendChild(tooltipNode(
                'div',
                'app-tooltip-more app-tooltip-timeline-more',
                `+${point.omittedStackLineCount} additional stack lines omitted`,
            ));
        }
    } else {
        stackSection.appendChild(tooltipNode(
            'div',
            'app-tooltip-timeline-empty-stack',
            'No Java stack frames were captured at this endpoint.',
        ));
    }
    tooltipEl.appendChild(stackSection);
    tooltipEl.appendChild(tooltipNode(
        'div',
        'app-tooltip-timeline-action',
        `Click the point to open ${dumpLabel}`,
    ));
}

function getDiagnosticTooltipPayload(target) {
    if (target?.getAttribute('data-tooltip-format') !== 'diagnostic') return null;
    try {
        return JSON.parse(target.getAttribute('data-tooltip-data') || '');
    } catch {
        return null;
    }
}

function getCpuTimelineTooltipPayload(target) {
    if (target?.getAttribute('data-tooltip-format') !== 'cpu-timeline') return null;
    const point = target.__data__;
    return point && Number.isFinite(point.dumpIndex) && Number.isFinite(point.ratePercent)
        ? point
        : null;
}

function showAppTooltip(target, clientX, clientY) {
    const tooltipEl = getTooltipEl();
    if (!tooltipEl) return;

    const text = getTooltipTextFromTarget(target);
    if (!text) return;

    // A pending mouse-leave timer belongs to the previous tooltip, not to a
    // newly focused target (including keyboard focus on a CPU timeline point).
    clearTimeout(tooltipHideTimer);
    activeTooltipTarget = target;
    const cpuTimelinePayload = getCpuTimelineTooltipPayload(target);
    const diagnosticPayload = getDiagnosticTooltipPayload(target);
    if (cpuTimelinePayload) {
        renderCpuTimelineTooltip(tooltipEl, cpuTimelinePayload);
    } else if (diagnosticPayload) {
        renderDiagnosticTooltip(tooltipEl, diagnosticPayload);
    } else {
        tooltipEl.classList.remove('app-tooltip-diagnostic', 'app-tooltip-timeline');
        tooltipEl.textContent = text;
    }
    tooltipEl.classList.remove('hidden');
    tooltipEl.setAttribute('aria-hidden', 'false');

    positionAppTooltip(clientX, clientY);
}

function hideAppTooltip() {
    const tooltipEl = getTooltipEl();
    if (!tooltipEl) return;

    activeTooltipTarget = null;
    tooltipEl.classList.add('hidden');
    tooltipEl.setAttribute('aria-hidden', 'true');
    tooltipEl.classList.remove('app-tooltip-diagnostic', 'app-tooltip-timeline');
    tooltipEl.textContent = '';
}

function positionAppTooltip(clientX, clientY) {
    const tooltipEl = getTooltipEl();
    if (!tooltipEl || tooltipEl.classList.contains('hidden')) return;

    const gap = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    tooltipEl.style.left = '0px';
    tooltipEl.style.top = '0px';

    const rect = tooltipEl.getBoundingClientRect();

    let left = clientX + gap;
    let top = clientY + gap;

    if (left + rect.width > vw - 8) {
        left = Math.max(8, clientX - rect.width - gap);
    }

    if (top + rect.height > vh - 8) {
        top = Math.max(8, clientY - rect.height - gap);
    }

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
}

function scheduleHideAppTooltip() {
    clearTimeout(tooltipHideTimer);
    const delay = getTooltipEl()?.classList.contains('app-tooltip-diagnostic') ? 140 : 40;
    tooltipHideTimer = setTimeout(() => {
        hideAppTooltip();
    }, delay);
}

function findTooltipTarget(node) {
    if (!node) return null;
    if (node instanceof Element) {
        return node.closest('[data-tooltip]');
    }
    return node.parentElement ? node.parentElement.closest('[data-tooltip]') : null;
}

function initAppTooltips() {
    document.addEventListener('mouseover', (event) => {
        const tooltipEl = getTooltipEl();
        if (tooltipEl?.contains(event.target)) {
            clearTimeout(tooltipHideTimer);
            return;
        }
        const target = findTooltipTarget(event.target);
        if (!target) {
            scheduleHideAppTooltip();
            return;
        }

        clearTimeout(tooltipHideTimer);
        showAppTooltip(target, event.clientX, event.clientY);
    });

    document.addEventListener('mousemove', (event) => {
        if (!activeTooltipTarget) return;
        const tooltipEl = getTooltipEl();
        if (tooltipEl?.contains(event.target)) return;
        if (findTooltipTarget(event.target) !== activeTooltipTarget) return;
        positionAppTooltip(event.clientX, event.clientY);
    });

    document.addEventListener('mouseout', (event) => {
        const tooltipEl = getTooltipEl();
        if (tooltipEl?.contains(event.target)) {
            if (tooltipEl.contains(event.relatedTarget)) return;
            scheduleHideAppTooltip();
            return;
        }
        const from = findTooltipTarget(event.target);
        if (!from) return;

        if (tooltipEl?.contains(event.relatedTarget)) {
            clearTimeout(tooltipHideTimer);
            return;
        }

        const to = findTooltipTarget(event.relatedTarget);
        if (from === to) return;

        scheduleHideAppTooltip();
    });

    document.addEventListener('focusin', (event) => {
        const target = findTooltipTarget(event.target);
        if (!target) return;

        const rect = target.getBoundingClientRect();
        showAppTooltip(target, rect.left + 12, rect.bottom + 8);
    });

    document.addEventListener('focusout', (event) => {
        const target = findTooltipTarget(event.target);
        if (!target) return;
        hideAppTooltip();
    });

    window.addEventListener('scroll', () => {
        if (activeTooltipTarget) hideAppTooltip();
    }, true);

    window.addEventListener('resize', () => {
        if (activeTooltipTarget) hideAppTooltip();
    });
}

document.addEventListener('paste', (e) => {
    const active = document.activeElement;
    const isTypingInInput =
        active &&
        (active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.isContentEditable);

    if (isTypingInInput) return;

    const text = e.clipboardData?.getData('text/plain');
    if (!text || !text.trim()) return;

    e.preventDefault();
    onLoadText(text, 'clipboard-thread-dump.txt', 'clipboard');
});

document.addEventListener('keydown', (event) => {
    const target = event.target;
    const isTyping = Boolean(
        target?.matches?.('input, textarea, select, button, a[href], [role="button"]')
        || target?.isContentEditable
    );
    const dialogOpen = Boolean(document.querySelector('dialog[open]'));
    const action = keyboardDumpNavigationAction({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        isTyping,
        dialogOpen,
    });
    if (!action || parsedDumps.length <= 1) return;
    event.preventDefault();
    navigateToDump(action);
});

bindAnalyzerStart({
    choose: () => UI.fileInput.click(),
    paste: () => UI.pasteClipboardBtn.click(),
    sample: () => UI.loadSampleBtn.click(),
});
bindAnalyzerDropZones(files => queueSessionImport(readThreadDumpFiles(files, 'drop')));


function bindTooltipScope(root) {
    if (!root) return;

    root.addEventListener('mouseover', (event) => {
        const target = findTooltipTarget(event.target);
        if (!target || !root.contains(target)) return;

        clearTimeout(tooltipHideTimer);
        showAppTooltip(target, event.clientX, event.clientY);
    });

    root.addEventListener('mousemove', (event) => {
        if (!activeTooltipTarget) return;
        if (!root.contains(activeTooltipTarget)) return;
        positionAppTooltip(event.clientX, event.clientY);
    });

    root.addEventListener('mouseout', (event) => {
        const from = findTooltipTarget(event.target);
        if (!from || !root.contains(from)) return;

        const to = findTooltipTarget(event.relatedTarget);
        if (to && from === to) return;

        scheduleHideAppTooltip();
    });
}


function debounce(fn, ms) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

// Initial render
initDeadlockLockHover();
initAppTooltips();

render();
