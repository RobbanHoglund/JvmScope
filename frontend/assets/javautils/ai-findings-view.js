import { AI_ICONS } from './ai-icons.js';
const presentation = { critical: ['critical','Critical'], high: ['warning','High'], medium: ['important','Medium'], info: ['note','Info'] };
export function renderLocalFindings(container, context) {
    container.replaceChildren(); container.hidden = !context?.findings?.length;
    if (container.hidden) return;
    const heading = document.createElement('h2'); heading.id = 'localFindingsTitle'; heading.textContent = 'JvmScope findings';
    const scope = document.createElement('p'); scope.className = 'local-findings-scope'; scope.textContent = context.scope;
    const note = document.createElement('p'); note.className = 'local-findings-note';
    note.textContent = 'Up to three local priorities; severity does not establish application impact. Exports contain the AI response.'
        + (context.edited ? ' You edited the prompt; these findings still refer to the original selection.' : '');
    container.append(heading, scope, note);
    let more;
    if (context.findings.length > 1) {
        more = document.createElement('details'); more.className = 'local-findings-more';
        const label = document.createElement('summary'); label.textContent = `${context.findings.length - 1} more analyzer ${context.findings.length === 2 ? 'priority' : 'priorities'}`;
        more.append(label);
    }
    for (const [index, finding] of context.findings.entries()) {
        const [icon, label] = presentation[finding.severity] || presentation.info;
        const card = document.createElement('article'); card.className = `local-finding local-finding-${icon}`;
        const title = document.createElement('h3');
        const symbol = document.createElement('span'); symbol.className = 'local-finding-icon'; symbol.innerHTML = AI_ICONS[icon];
        const text = document.createElement('span'); text.textContent = `${label} · ${finding.title}`;
        title.append(symbol, text);
        const detail = document.createElement('p'); detail.textContent = finding.detail;
        const qualification = document.createElement('p'); qualification.className = 'local-finding-qualification'; qualification.textContent = finding.qualification;
        card.append(title, detail, qualification);
        if (index === 0) container.append(card); else more.append(card);
    }
    if (more) container.append(more);
}
