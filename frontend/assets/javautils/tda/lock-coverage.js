/** Do not interpret missing ownership fields as a complete zero-lock census. */
export function describeLockCoverage(thread) {
    const coverage = thread?.lockCoverage;
    if (!coverage) return 'Coverage not reported. Counts are observations, not total ownership.';
    return [
        coverage.monitors ? 'Monitor details available.' : 'Monitor details not reported.',
        coverage.ownableSynchronizers ? 'Ownable synchronizers reported.' : 'Ownable synchronizers not reported.',
        'Counts are observations, not total ownership.',
    ].join(' ');
}
