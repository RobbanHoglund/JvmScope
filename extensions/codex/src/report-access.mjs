// A bounded source reference survives the memory cache. It is not a capability
// or saved analysis: recovery reads the explicit paths and verifies every hash
// before parsing. No capture, assessment or cache is persisted to disk.
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
const failure = (code, message) => Object.assign(new Error(message), { code });
const referenceKey = context => JSON.stringify([context.version, context.pluginVersion, context.reportId, context.snapshotCount,
    context.sources.map(s => [s.path, s.sha256]), !!context.example]);
export function reportContext(report, id, pluginVersion) {
    return { version: 1, pluginVersion, reportId: id, snapshotCount: report.snapshotCount,
        sources: report.sources.map(({ path, sha256 }) => ({ path, sha256 })),
        ...(report.example?.synthetic ? { example: true } : {}) };
}

export function createReportAccess({ reports, jobs, version, example }) {
    const pending = new Map();
    function add(report, id = randomUUID()) {
        report.reportId = id;
        report.reportContext = reportContext(report, id, version);
        reports.add(report, { id, validate(value) {
            if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 512 * 1024)
                throw new Error('Result exceeds the 512 KiB response limit. Reduce limit or select a smaller capture interval.');
        } });
        return report.reportId;
    }
    return {
        add,
        async ensure(id, context, { snapshotIndex, offset, limit } = {}, signal) {
            if (context && context.reportId !== id)
                throw failure('REPORT_CONTEXT_MISMATCH', 'Report context does not match the requested report id.');
            if (context && (context.version !== 1 || context.pluginVersion !== version))
                throw failure('REPORT_VERSION_MISMATCH', 'Report reference was created by a different plugin version. Analyze the captures again.');
            try {
                const cached = reports.get(id);
                if (context && referenceKey(reportContext(cached, id, version)) !== referenceKey(context))
                    throw failure('REPORT_CONTEXT_MISMATCH', 'Report context does not match the cached source reference.');
                return cached;
            } catch (error) { if (error.code !== 'REPORT_NOT_AVAILABLE' || !context) throw error; }
            // The original source order includes rejected files: changing it can
            // change sourceKeys and the global snapshot numbering.
            const key = referenceKey(context);
            if (!pending.has(key)) {
                const work = (async () => {
                    const isExample = context.example === true;
                    // readCapture returns a canonical path. Windows temp/drive
                    // aliases and symlinks can differ from the installation path.
                    if (isExample && (!example || context.sources.length !== 1 || context.sources[0].path !== await realpath(example.path)))
                        throw failure('REPORT_CONTEXT_MISMATCH', 'The example reference does not identify the bundled sample.');
                    const restored = await jobs.run(isExample ? 'show_thread_example' : 'analyze_thread_dumps', {
                        paths: context.sources.map(s => s.path), expectedSources: context.sources,
                        offset: offset ?? snapshotIndex ?? 0, limit: limit ?? 1,
                    }, signal);
                    if (restored.snapshotCount !== context.snapshotCount)
                        throw failure('REPORT_CONTEXT_MISMATCH', 'Restored snapshot count does not match the report reference.');
                    if (isExample) restored.example = example.definition;
                    add(restored, id);
                    restored.cache.recovered = true;
                    return restored;
                })();
                pending.set(key, work);
                void work.finally(() => pending.delete(key)).catch(() => {});
            }
            await pending.get(key);
            return reports.get(id);
        },
    };
}
