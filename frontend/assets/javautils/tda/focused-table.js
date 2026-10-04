/** Pure state and presentation helpers for snapshot-scoped table focus. */

export function emptyFocusedTableState() {
    return {
        active: false,
        clusterId: null,
        dumpIndex: null,
        threadIndexes: [],
        filterTableToFocus: false,
    };
}

function validDumpIndex(value) {
    const index = Number(value);
    return Number.isInteger(index) && index >= 0 ? index : null;
}

function validThreadIndex(value) {
    const index = Number(value);
    return Number.isInteger(index) && index > 0 ? index : null;
}

export function createFocusedTableState(clusterId, dumpIndex, members) {
    const normalizedClusterId = String(clusterId ?? '').trim();
    const normalizedDumpIndex = validDumpIndex(dumpIndex);
    if (!normalizedClusterId || normalizedDumpIndex == null) return emptyFocusedTableState();

    const threadIndexes = [...new Set(
        (Array.isArray(members) ? members : [])
            .filter((member) => Number(member?.dumpIndex) === normalizedDumpIndex)
            .map((member) => validThreadIndex(member?.index))
            .filter((index) => index != null),
    )].sort((left, right) => left - right);

    if (!threadIndexes.length) return emptyFocusedTableState();
    return {
        active: true,
        clusterId: normalizedClusterId,
        dumpIndex: normalizedDumpIndex,
        threadIndexes,
        filterTableToFocus: true,
    };
}

export function isFocusedTableActive(state, selectedDumpIndex) {
    return Boolean(
        state?.active
        && state.filterTableToFocus === true
        && Number(state.dumpIndex) === Number(selectedDumpIndex)
        && Array.isArray(state.threadIndexes)
        && state.threadIndexes.some((index) => validThreadIndex(index) != null)
    );
}

export function focusedThreadIndexSet(state, selectedDumpIndex) {
    if (!isFocusedTableActive(state, selectedDumpIndex)) return new Set();
    return new Set(
        state.threadIndexes
            .map(validThreadIndex)
            .filter((index) => index != null),
    );
}

export function getFocusedTableView(state, selectedDumpIndex, visibleFocusedCount, dumpLabel) {
    if (!isFocusedTableActive(state, selectedDumpIndex)) {
        return {
            isActive: false,
            clusterId: '',
            dumpIndex: null,
            dumpLabel: '',
            totalFocused: 0,
            visibleFocused: 0,
            hiddenFocused: 0,
            countText: '',
        };
    }

    const totalFocused = focusedThreadIndexSet(state, selectedDumpIndex).size;
    const numericVisible = Number(visibleFocusedCount);
    const visibleFocused = Math.min(
        totalFocused,
        Number.isFinite(numericVisible) ? Math.max(0, Math.floor(numericVisible)) : 0,
    );

    return {
        isActive: true,
        clusterId: String(state.clusterId),
        dumpIndex: Number(state.dumpIndex),
        dumpLabel: String(dumpLabel ?? '').trim() || `Dump ${Number(state.dumpIndex) + 1}`,
        totalFocused,
        visibleFocused,
        hiddenFocused: totalFocused - visibleFocused,
        countText: `Showing ${visibleFocused} of ${totalFocused} focused threads after all other table filters`,
    };
}
