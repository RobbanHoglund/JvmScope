import { renderLocalFindings } from './ai-findings-view.js';
import { renderAiMarkdown } from './ai-result-markdown.js';
import './ai-result.css';

const host = acquireVsCodeApi();
const status = document.getElementById('actionStatus');
let pending = null, sequence = 0, timer;
const post = value => host.postMessage({ channel: 'jvmscope-ai-result', version: 1, ...value });
function finish(message) {
    clearTimeout(timer); pending = null; status.textContent = message;
    document.querySelectorAll('[data-action]').forEach(button => { button.disabled = false; });
}
function action(action, url) {
    if (pending) return;
    pending = ++sequence;
    document.querySelectorAll('[data-action]').forEach(button => { button.disabled = true; });
    status.textContent = action === 'save' ? 'Choose where to save the Markdown response…' : 'Working…';
    timer = setTimeout(() => finish('The action did not finish. You can try again.'), 60_000);
    post({ type: 'action', id: pending, action, ...(url ? { url } : {}) });
}
window.addEventListener('message', ({ data }) => {
    if (data?.channel !== 'jvmscope-ai-result' || data.version !== 1) return;
    if (data.type === 'result') {
        try {
            document.getElementById('resultScope').textContent = data.result.scope;
            document.getElementById('resultModel').textContent = `Model: ${data.result.model}`;
            renderLocalFindings(document.getElementById('localFindings'), data.result.findingContext);
            const answer = document.getElementById('answer');
            answer.innerHTML = renderAiMarkdown(data.result.body);
            // Wide tables scroll locally; they must not widen the entire report.
            answer.querySelectorAll('table').forEach(table => {
                const wrapper = document.createElement('div'); wrapper.className = 'table-scroll';
                wrapper.tabIndex = 0; wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', 'AI response table');
                table.before(wrapper); wrapper.append(table);
            });
            answer.querySelectorAll('pre').forEach(pre => { pre.tabIndex = 0; pre.setAttribute('aria-label', 'Code block'); });
            answer.setAttribute('aria-busy', 'false');
            finish(''); post({ type: 'rendered' });
        } catch {
            document.getElementById('answer').textContent = data.result.body;
            document.getElementById('answer').setAttribute('aria-busy', 'false');
            finish('Formatting could not be displayed. The complete text is shown below.');
            post({ type: 'rendered' });
        }
    } else if (data.type === 'actionResult' && data.id === pending) finish(data.message);
});
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => action(button.dataset.action)));
document.getElementById('answer').addEventListener('click', event => {
    const link = event.target.closest('a[data-report-link]');
    if (!link) return;
    event.preventDefault(); action('external', link.dataset.reportLink);
});
post({ type: 'ready' });
