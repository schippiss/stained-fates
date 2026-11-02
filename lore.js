// Use Tavern's own activation rules without consuming chat sticky/cooldown state.
export async function scanLore(context, messages, question = '') {
    if (typeof context.getWorldInfoPrompt !== 'function') return { status: 'unavailable', text: '' };
    const scan = [question, ...messages.slice().reverse().map(m => m.text)].filter(Boolean);
    try {
        const wi = await context.getWorldInfoPrompt(scan, context.maxContext || 8192, true);
        const parts = [wi.worldInfoBefore, wi.worldInfoAfter];
        for (const group of wi.worldInfoDepth || []) {
            if (Array.isArray(group?.entries)) parts.push(...group.entries);
        }
        for (const name of ['worldInfoExamples', 'worldInfoTopAN', 'worldInfoBottomAN']) {
            for (const entry of Array.isArray(wi[name]) ? wi[name] : []) {
                parts.push(typeof entry === 'string' ? entry : entry?.content);
            }
        }
        const text = parts.filter(p => typeof p === 'string').join('\n').slice(0, 10000);
        return { status: text ? 'included' : 'empty', text };
    } catch {
        throw Error('Не удалось прочитать лор мира. Повтори попытку.');
    }
}
