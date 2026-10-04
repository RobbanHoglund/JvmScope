/** Native, text-only input feedback. It never changes the analyzed session. */
export function createInputFeedbackDialog(dialog, { chooseFiles = () => {}, fallbackFocus = () => null } = {}) {
    let returnFocus = null;
    const close = ({ restoreFocus = true } = {}) => {
        if (!dialog || dialog.classList.contains('hidden')) return;
        dialog.close();
        dialog.classList.add('hidden');
        dialog.setAttribute('aria-hidden', 'true');
        const target = returnFocus?.isConnected ? returnFocus : fallbackFocus();
        returnFocus = null;
        if (restoreFocus) target?.focus({ preventScroll: true });
    };
    dialog?.querySelectorAll('[data-close-input-feedback]').forEach(button => button.addEventListener('click', () => close()));
    dialog?.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog?.addEventListener('click', event => {
        if (event.target.dataset.close === 'input-feedback') close();
    });
    dialog?.querySelector('#inputFeedbackChoose')?.addEventListener('click', () => { close({ restoreFocus: false }); chooseFiles(); });

    return Object.freeze({
        close,
        show(model) {
            if (!dialog || !model) return;
            const document = dialog.ownerDocument;
            if (!dialog.open) {
                const active = document.activeElement;
                returnFocus = active && active !== document.body && active !== document.documentElement ? active : fallbackFocus();
            }
            const severity = ['error', 'warning', 'info'].includes(model.severity) ? model.severity : 'error';
            dialog.dataset.severity = severity;
            dialog.setAttribute('role', severity === 'info' ? 'dialog' : 'alertdialog');
            for (const [id, text] of [
                ['inputFeedbackLevel', { error: 'Input error', warning: 'Input warning', info: 'Information' }[severity]],
                ['inputFeedbackTitle', model.title], ['inputFeedbackSummary', model.summary],
                ['inputFeedbackOutcome', model.outcome], ['inputFeedbackGuidance', model.guidance],
            ]) dialog.querySelector(`#${id}`).textContent = String(text || '');
            const notes = dialog.querySelector('#inputFeedbackNotes');
            notes.replaceChildren();
            for (const note of model.notes || []) {
                const item = document.createElement('li');
                const label = document.createElement('strong');
                label.textContent = note.label;
                const message = document.createElement('p');
                message.textContent = note.message;
                const guidance = document.createElement('p');
                guidance.className = 'input-feedback-source-guidance';
                guidance.textContent = note.guidance;
                item.append(label, message, guidance);
                notes.append(item);
            }
            dialog.querySelector('#inputFeedbackSourceDetails').hidden = !notes.children.length;
            dialog.classList.remove('hidden');
            dialog.setAttribute('aria-hidden', 'false');
            if (!dialog.open) dialog.showModal();
            dialog.querySelector('.modal-body').scrollTop = 0;
            dialog.querySelector('#inputFeedbackClose').focus({ preventScroll: true });
        },
    });
}
