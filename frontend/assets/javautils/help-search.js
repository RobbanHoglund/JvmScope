function searchTerms(value) {
    return [...new Set(value.trim().toLowerCase().split(/\s+/).filter(Boolean))];
}

function clearHighlights(root) {
    for (const mark of root.querySelectorAll('mark[data-help-match]')) mark.replaceWith(...mark.childNodes);
    root.normalize();
}

function highlight(root, terms) {
    const escaped = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(escaped.sort((a, b) => b.length - a.length).join('|'), 'gi');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
        const text = node.textContent;
        const matches = [...text.matchAll(pattern)];
        if (!matches.length) continue;
        const fragment = document.createDocumentFragment();
        let end = 0;
        for (const match of matches) {
            fragment.append(document.createTextNode(text.slice(end, match.index)));
            const mark = document.createElement('mark');
            mark.dataset.helpMatch = '';
            mark.textContent = match[0];
            fragment.append(mark);
            end = match.index + match[0].length;
        }
        fragment.append(document.createTextNode(text.slice(end)));
        node.replaceWith(fragment);
    }
}

export function createHelpSearch(dialog) {
    const input = dialog?.querySelector('[data-help-search]');
    if (!input) return { reset() {} };
    const content = dialog.querySelector('.docs-content');
    // Heading/list pairs become topics without copying or replacing guide text.
    if (content) {
        let topic;
        for (const child of [...content.children]) {
            if (child.classList.contains('docs-subtitle')) {
                topic = document.createElement('section');
                topic.className = 'help-search-topic';
                child.before(topic);
            }
            topic?.append(child);
        }
    }
    const topics = [...dialog.querySelectorAll('.help-search-topic')];
    const quickstart = dialog.querySelector('.help-quickstart');
    const entries = [...(quickstart ? [quickstart] : []), ...topics]
        .map(root => ({ root, text: root.textContent.replace(/\s+/g, ' ').toLowerCase() }));
    const count = dialog.querySelector('[data-help-search-count]');
    const empty = dialog.querySelector('[data-help-search-empty]');
    const clear = dialog.querySelector('[data-help-search-clear]');
    const layout = dialog.querySelector('.docs-layout');
    const links = [...dialog.querySelectorAll('.docs-nav a')].map(link => ({
        link, topic: topics.find(topic => [...topic.querySelectorAll('[id]')].some(node => `#${node.id}` === link.getAttribute('href'))),
    }));
    // Scroll only the documentation pane, not the whole dialog or page URL.
    dialog.querySelector('.docs-nav')?.addEventListener('click', (event) => {
        const link = event.target.closest('a[href^="#guide-"]');
        const entry = links.find(entry => entry.link === link);
        if (!entry?.topic || entry.topic.hidden) return;
        event.preventDefault();
        const body = dialog.querySelector('.modal-body');
        const heading = entry.topic.querySelector('.docs-subtitle');
        if (!body || !heading) return;
        body.scrollTo({ top: body.scrollTop + heading.getBoundingClientRect().top - body.getBoundingClientRect().top - 16 });
    });
    function render() {
        const terms = searchTerms(input.value);
        let matches = 0;
        for (const entry of entries) {
            clearHighlights(entry.root);
            entry.root.hidden = !terms.every(term => entry.text.includes(term));
            if (entry.root.hidden) continue;
            matches++;
            if (terms.length) highlight(entry.root, terms);
        }
        for (const { link, topic } of links) link.hidden = Boolean(topic?.hidden);
        if (layout) layout.hidden = topics.every(topic => topic.hidden);
        empty.hidden = matches > 0;
        count.textContent = terms.length ? `${matches} of ${entries.length} topics match` : `${entries.length} guide topics`;
        clear.disabled = !input.value;
        dialog.classList.toggle('help-searching', terms.length > 0);
        dialog.querySelector('.modal-body')?.scrollTo({ top: 0 });
        dialog.querySelector('.docs-nav')?.scrollTo({ top: 0 });
    }
    input.addEventListener('input', render);
    input.addEventListener('search', render);
    clear.addEventListener('click', () => { input.value = ''; render(); input.focus(); });
    render();
    return { reset() { input.value = ''; render(); } };
}
