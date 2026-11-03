// The host may put a report in a separate panel, a new tab or an inline card.
// Supply a useful chat answer independently of where it chooses to render UI.
export function conversationAnswer(conclusion) {
    if (!conclusion) return null;
    const { language, summary, nextCheck } = conclusion;
    return { language, summary, nextCheck,
        text: `${summary}\n\n${language === 'sv' ? 'Nästa kontroll' : 'Next check'}: ${nextCheck}` };
}
export const chatInstruction = 'Answer the user in chat with the diagnostic conclusion, its material uncertainty and next check in the conversation language. Use chatAnswer when supplied. The report may open in a separate panel or tab; a link or completion acknowledgment alone is not an answer. Keep the chat answer concise; do not copy full stacks, tables or every finding. Do not assert which host surface is visible or that an earlier report was updated.';
