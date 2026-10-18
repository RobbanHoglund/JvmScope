/** A bounded display-only snapshot. Never append this metadata to the model request. */
function validateFindingContext(context) {
    if (context == null) return;
    const text = (value, limit) => typeof value === 'string' && value.length <= limit;
    if (typeof context !== 'object' || !text(context.scope, 500) || typeof context.edited !== 'boolean'
        || !Array.isArray(context.findings) || context.findings.length > 3
        || context.findings.some(f => !f || !['critical','high','medium','info'].includes(f.severity)
            || !text(f.title, 160) || !text(f.detail, 1600) || !text(f.qualification, 800))) {
        throw new Error('Invalid local analyzer finding context. Reopen the AI review.');
    }
}
function snapshotFindingContext(context) {
    validateFindingContext(context);
    if (context == null) return undefined;
    return { scope: context.scope, edited: context.edited, findings: context.findings.map(({ severity, title, detail, qualification }) => ({ severity, title, detail, qualification })) };
}
module.exports = { validateFindingContext, snapshotFindingContext };
