import assert from 'node:assert/strict';
import test from 'node:test';

import { resetDatasetScopedUi } from '../../assets/javautils/tda/dataset-ui-state.js';

test('resets controls and announcements that belong to the previous dataset', () => {
    const ui = {
        openRawDumpBtn: { disabled: false },
        chartFilterAnnouncement: { textContent: 'Chart filter cleared. Showing 67 of 67 threads.' },
        focusFilterAnnouncement: { textContent: 'Table focused on 3 threads.' },
    };

    resetDatasetScopedUi(ui);

    assert.equal(ui.openRawDumpBtn.disabled, true);
    assert.equal(ui.chartFilterAnnouncement.textContent, '');
    assert.equal(ui.focusFilterAnnouncement.textContent, '');
});

test('is idempotent and tolerates optional controls', () => {
    const ui = {
        openRawDumpBtn: { disabled: true },
        chartFilterAnnouncement: { textContent: '' },
    };

    resetDatasetScopedUi(ui);
    resetDatasetScopedUi(ui);

    assert.deepEqual(ui, {
        openRawDumpBtn: { disabled: true },
        chartFilterAnnouncement: { textContent: '' },
    });
    assert.doesNotThrow(() => resetDatasetScopedUi());
});
