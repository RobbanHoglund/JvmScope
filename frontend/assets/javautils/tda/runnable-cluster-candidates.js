/** Every existing prefilter match shares a top-eight frame or a last-sixteen tail frame. */
export function createClusterCandidateIndex() {
    const byFrame = new Map();
    const positions = new Map();
    function frames(thread) {
        const values = Array.isArray(thread?.meaningfulFrames) ? thread.meaningfulFrames : [];
        return new Set([...values.slice(0, 8), ...values.slice(-16)].filter(value => typeof value === 'string' && value));
    }
    return {
        add(cluster) {
            if (positions.has(cluster)) return;
            positions.set(cluster, positions.size);
            for (const frame of frames(cluster.representative)) {
                if (!byFrame.has(frame)) byFrame.set(frame, new Set());
                byFrame.get(frame).add(cluster);
            }
        },
        matching(thread) {
            const matches = new Set();
            for (const frame of frames(thread)) {
                for (const cluster of byFrame.get(frame) || []) matches.add(cluster);
            }
            // Preserve the original first-created winner when similarity scores tie.
            return [...matches].sort((left, right) => positions.get(left) - positions.get(right));
        },
    };
}
