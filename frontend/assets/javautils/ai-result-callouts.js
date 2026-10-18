import { AI_ICONS } from './ai-icons.js';

const types = Object.freeze({
    CRITICAL: { label: 'Critical', icon: 'critical' }, CAUTION: { label: 'Caution', icon: 'critical' },
    WARNING: { label: 'Warning', icon: 'warning' }, IMPORTANT: { label: 'Important', icon: 'important' },
    NOTE: { label: 'Note', icon: 'note' }, TIP: { label: 'Suggested check', icon: 'note' },
});

/** Explicit Markdown callouts only. Never assign severity from prose or diagnostic keywords. */
export function addAiCallouts(md) {
    md.core.ruler.after('inline', 'ai_callouts', state => {
        let icons = 0;
        for (let index = 0; index < state.tokens.length; index++) {
            const open = state.tokens[index], inline = state.tokens[index + 2];
            if (open.type !== 'blockquote_open' || open.level !== 0
                || state.tokens[index + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
            const marker = inline.content.match(/^\[!(CRITICAL|CAUTION|WARNING|IMPORTANT|NOTE|TIP)\](?:[ \t]*\n|[ \t]*$)/i);
            if (!marker) continue;
            let depth = 1, closing = index + 1;
            for (; closing < state.tokens.length; closing++) {
                if (state.tokens[closing].type === 'blockquote_open') depth++;
                if (state.tokens[closing].type === 'blockquote_close') depth--;
                if (!depth) break;
            }
            if (depth) continue;
            const type = types[marker[1].toUpperCase()];
            open.tag = 'aside'; state.tokens[closing].tag = 'aside';
            open.attrSet('class', `ai-callout ai-callout-${type.icon}`);
            open.attrSet('aria-label', `${type.label} — AI assessment`);
            const title = new state.Token('ai_callout_title', '', 0);
            title.block = true; title.meta = { ...type, showIcon: icons++ < 3 };
            inline.content = inline.content.slice(marker[0].length);
            if (inline.content.trim()) md.inline.parse(inline.content, md, state.env, inline.children = []);
            state.tokens.splice(index + 1, inline.content.trim() ? 0 : 3, title);
        }
    });
    md.renderer.rules.ai_callout_title = (tokens, index) => {
        const {label, icon, showIcon} = tokens[index].meta;
        return `<p class="ai-callout-label">${showIcon ? AI_ICONS[icon] : ''}<strong>${label}</strong><small>AI assessment</small></p>\n`;
    };
}
