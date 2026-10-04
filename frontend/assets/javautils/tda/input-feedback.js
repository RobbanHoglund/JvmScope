/** Pure labels and recovery guidance for thread-dump input. */

function basename(value) {
    return String(value ?? '').split(/[\\/]/).pop()?.trim() || '';
}

export function inputSourceLabel(source = {}) {
    const kind = String(source.kind || '').toLowerCase();
    const name = basename(source.name);
    if ((kind === 'file' || kind === 'drop') && name) return name;
    if (kind === 'clipboard') return 'Clipboard input';
    if (kind === 'sample') return String(source.exampleTitle || 'Built-in sample');
    return name || 'Loaded text';
}

export function getInputFeedback(result) {
    const status = String(result?.status || '');
    if (!status || status === 'success') return null;

    const warning = Array.isArray(result?.warnings)
        ? result.warnings.map((value) => String(value || '').trim()).find(Boolean)
        : '';

    if (status === 'empty') {
        return {
            severity: 'error',
            summary: warning || 'No thread dump content was provided.',
            guidance: 'Choose, drop, or paste a non-empty HotSpot thread dump in text or JSON format.',
        };
    }
    if (status === 'unsupported') {
        return {
            severity: 'error',
            summary: warning || 'No supported JVM thread dump was detected.',
            guidance: 'Verify that the input contains a complete HotSpot Thread.print/jstack dump or Thread.dump_to_file text/JSON output.',
        };
    }
    if (status === 'partial') {
        return {
            severity: 'warning',
            summary: warning || 'The thread dump was only partially parsed.',
            guidance: 'Review the warning, use the available snapshots cautiously, and capture a complete dump when possible.',
        };
    }
    return {
        severity: 'error',
        summary: warning || 'Thread dump analysis could not be completed.',
        guidance: 'Try a complete HotSpot text/JSON thread dump or use the built-in sample to verify the analyzer.',
    };
}

/** Feedback for the submitted batch only; old partial sources must not reopen warnings. */
export function getInputDialogFeedback({ sourceResults = [], failures = [], previousSnapshotCount = 0, mode = 'append', notice = null } = {}) {
    const sources = Array.isArray(sourceResults) ? sourceResults : [];
    const readFailures = Array.isArray(failures) ? failures.map(value => String(value || '').trim()).filter(Boolean) : [];
    const count = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
    const previous = count(previousSnapshotCount);
    const loaded = sources.filter(source => source?.accepted === true).reduce((sum, source) => sum + count(source.snapshotCount), 0);
    const verb = previous && mode !== 'replace' ? 'added' : 'loaded';
    const outcome = loaded
        ? `${loaded} snapshot${loaded === 1 ? '' : 's'} ${verb}. The session now contains ${(mode === 'replace' ? 0 : previous) + loaded} snapshot${(mode === 'replace' ? 0 : previous) + loaded === 1 ? '' : 's'}.`
        : previous ? 'The current session was kept. No new snapshots were added.' : 'No snapshots were loaded.';

    if (notice) return {
        severity: ['error', 'warning', 'info'].includes(notice.severity) ? notice.severity : 'error',
        title: String(notice.title || 'Thread dump input'),
        summary: String(notice.summary || ''), guidance: String(notice.guidance || ''),
        outcome, notes: [],
    };

    const affected = sources.filter(source => source && (source.accepted !== true || source.status === 'partial'));
    if (!affected.length && !readFailures.length) return null;
    const notes = affected.map(source => {
        const feedback = getInputFeedback(source);
        return {
            label: basename(source.label) || 'Loaded text',
            message: feedback?.summary || 'No supported JVM thread dump was detected.',
            guidance: feedback?.guidance || '',
        };
    }).concat(readFailures.map(message => ({ label: 'File read failed', message, guidance: '' })));
    const empty = !readFailures.length && affected.length && affected.every(source => source.status === 'empty');
    return {
        severity: loaded ? 'warning' : 'error',
        title: loaded ? 'Thread dump loaded with warnings'
            : !sources.length && readFailures.length ? 'Could not read thread dump file'
                : empty ? 'Empty thread dump' : 'Invalid thread dump',
        summary: loaded ? 'Some input was incomplete or could not be read. The available snapshots were loaded.'
            : empty ? 'The selected input contains no thread dump text.'
                : !sources.length && readFailures.length ? 'The selected file could not be opened for reading.'
                    : 'No supported JVM thread dump could be read from the selected input.',
        outcome,
        guidance: 'Use a readable HotSpot Thread.print/jstack dump or Thread.dump_to_file text/JSON output. Review the source details below before continuing.',
        notes,
    };
}
