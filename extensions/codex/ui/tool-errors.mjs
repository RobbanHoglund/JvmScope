import { toolErrorCode } from '../src/tool-error.mjs';
const copy = {
    en: {
        REPORT_NOT_AVAILABLE: 'This report’s temporary analysis is no longer available in this connection. Analyze the files again in chat and open the new report.',
        REPORT_SOURCE_CHANGED: 'A source file has changed since this report was created. Analyze the changed files again in chat before inspecting them.',
        REPORT_SOURCE_UNAVAILABLE: 'A source file could not be opened. Restore access to the original file and try again, or select the file again in chat.',
        REPORT_CONTEXT_MISMATCH: 'The source reference does not match this report. Analyze the selected files again in chat.',
        REPORT_VERSION_MISMATCH: 'This report was created by a different plugin version. Analyze the files again in chat and open the new report.',
    },
    sv: {
        REPORT_NOT_AVAILABLE: 'Rapportens tillfälliga analysunderlag finns inte längre i den här anslutningen. Analysera filerna på nytt i chatten och öppna den nya rapporten.',
        REPORT_SOURCE_CHANGED: 'En källfil har ändrats sedan rapporten skapades. Analysera de ändrade filerna på nytt i chatten innan du granskar dem.',
        REPORT_SOURCE_UNAVAILABLE: 'En källfil kunde inte öppnas. Återställ åtkomsten till originalfilen och försök igen, eller välj filen på nytt i chatten.',
        REPORT_CONTEXT_MISMATCH: 'Källreferensen stämmer inte med rapporten. Analysera de valda filerna på nytt i chatten.',
        REPORT_VERSION_MISMATCH: 'Rapporten skapades med en annan pluginversion. Analysera filerna på nytt i chatten och öppna den nya rapporten.',
    },
};
export const toolErrorMessage = (error, locale) => copy[locale]?.[toolErrorCode(error)] || error.message;
export function clearToolError(container) {
    for (const child of [...container.children]) if (child.classList.contains('tool-error')) child.remove();
}
export function showToolError(container, error, locale) {
    clearToolError(container);
    const notice = document.createElement('p'); notice.className = 'error tool-error'; notice.setAttribute('role', 'alert');
    notice.textContent = toolErrorMessage(error, locale); container.append(notice);
}
