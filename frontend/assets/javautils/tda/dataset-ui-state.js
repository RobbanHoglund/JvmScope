export function resetDatasetScopedUi(ui = {}) {
    if (ui.openRawDumpBtn) {
        ui.openRawDumpBtn.disabled = true;
    }

    [ui.chartFilterAnnouncement, ui.focusFilterAnnouncement].forEach((announcement) => {
        if (announcement) announcement.textContent = '';
    });
}
