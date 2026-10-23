import { ARTICLES, FEATURES, filterArticles } from '../../../frontend/assets/javautils/knowledge/data.js';
import { TLS_ISSUE_CATALOG } from '../../../frontend/assets/javautils/tls-issue-catalog.js';
import { page } from './analysis.mjs';

const tlsArticles = TLS_ISSUE_CATALOG.map(issue => ({ id: `tls-${issue.id}`, title: issue.matchKey, sections: issue.sections,
    scope: 'Bundled JvmScope TLS explanation; verify the actual alert direction and capture evidence. Placeholders such as {AlertEndpoint} are contextual, not observed values.' }));

export function searchKnowledge({ query, limit = 10 }) {
    const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const tls = tlsArticles.filter(a => tokens.every(t => JSON.stringify(a).toLowerCase().includes(t)));
    return page([...filterArticles({ query }), ...tls].map(a => ({ id: a.id, title: a.title, summary: a.summary,
        verifiedDate: a.verifiedDate ?? null, topics: a.topics ?? ['tls'] })), 0, limit);
}

export function knowledgeArticle({ id }) {
    const article = ARTICLES.find(a => a.id === id) || tlsArticles.find(a => a.id === id);
    if (!article) throw new Error('Unknown article id. Use search_knowledge first.');
    return { ...article, features: (article.features || []).map(id => FEATURES.find(f => f.id === id)),
        currency: 'Bundled reference, not a live lookup. Check version/build scope and cited primary sources before proposing changes.' };
}
