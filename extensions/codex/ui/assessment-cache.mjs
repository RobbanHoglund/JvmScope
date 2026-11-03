// The server cache may disappear while this report remains open. Keep only the
// assessments actually delivered to this widget, with the same strict scope.
export function createAssessmentCache() {
    const saved = new Map();
    return {
        resolve(candidate, reportId, scope) {
            const key = JSON.stringify([reportId, scope]);
            if (candidate?.origin === 'assistant' && candidate.reportId === reportId
                && JSON.stringify(candidate.scope) === JSON.stringify(scope)
                && typeof candidate.summary === 'string' && typeof candidate.nextCheck === 'string') {
                saved.delete(key);
                while (saved.size >= 24) saved.delete(saved.keys().next().value);
                saved.set(key, candidate);
            }
            return saved.get(key) || null;
        },
    };
}
