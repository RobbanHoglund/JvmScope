/** Pure snapshot navigation rules and presentation state. */

function normalizedTotal(value) {
    const total = Number(value);
    return Number.isInteger(total) && total > 0 ? total : 0;
}

function normalizedCurrent(value, total) {
    const current = Number(value);
    if (!total) return 0;
    if (!Number.isInteger(current)) return 0;
    return Math.min(total - 1, Math.max(0, current));
}

export function resolveDumpIndex(currentIndex, totalCount, action, directIndex) {
    const total = normalizedTotal(totalCount);
    const current = normalizedCurrent(currentIndex, total);
    if (!total) return 0;

    if (action === 'previous') return Math.max(0, current - 1);
    if (action === 'next') return Math.min(total - 1, current + 1);
    if (action === 'first') return 0;
    if (action === 'last') return total - 1;
    if (action === 'direct') {
        const direct = Number(directIndex);
        return Number.isInteger(direct)
            ? Math.min(total - 1, Math.max(0, direct))
            : current;
    }
    return current;
}

export function getDumpNavigationView(currentIndex, totalCount, timestamp) {
    const total = normalizedTotal(totalCount);
    const current = normalizedCurrent(currentIndex, total);
    const positionText = total ? `Snapshot ${current + 1} of ${total}` : 'No snapshots';
    const timestampText = String(timestamp || '').trim();
    return {
        isVisible: total > 1,
        positionText,
        announcement: total
            ? `${positionText} selected${timestampText ? `: ${timestampText}` : ''}.`
            : 'No snapshots available.',
        previousDisabled: !total || current === 0,
        nextDisabled: !total || current === total - 1,
    };
}

export function keyboardDumpNavigationAction(event = {}) {
    if (event.isTyping || event.dialogOpen || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return null;
    }
    return {
        ArrowLeft: 'previous',
        ArrowRight: 'next',
        Home: 'first',
        End: 'last',
    }[event.key] || null;
}
