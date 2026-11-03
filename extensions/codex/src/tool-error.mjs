const reportCodes = new Set(['REPORT_NOT_AVAILABLE', 'REPORT_SOURCE_CHANGED', 'REPORT_SOURCE_UNAVAILABLE',
    'REPORT_CONTEXT_MISMATCH', 'REPORT_VERSION_MISMATCH']);
export function toolErrorCode(error) {
    if (reportCodes.has(error.code)) return error.code;
    if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) return 'REPORT_SOURCE_UNAVAILABLE';
    // Compatibility with an older server that returned only an English message.
    if (error.message?.startsWith('Report expired or belongs to another session.')) return 'REPORT_NOT_AVAILABLE';
    if (error.message?.startsWith('Capture changed')) return 'REPORT_SOURCE_CHANGED';
    return 'TOOL_ERROR';
}
export function toolFailure(error) {
    return { isError: true, content: [{ type: 'text', text: error.message }],
        _meta: { jvmscopeError: { code: toolErrorCode(error) } } };
}
