export function profiles(context) {
    const service = context.ConnectionManagerRequestService;
    if (!service || context.extensionSettings?.disabledExtensions?.includes('connection-manager')) return [];
    return (context.extensionSettings?.connectionManager?.profiles || []).filter(profile => {
        try { return service.validateProfile(profile).selected === 'openai' && !!profile.model; }
        catch { return false; }
    }).map(({id,name,model}) => ({id,name,model}));
}

export async function request(context, settings, system, payload, signal, maxTokens = 1800) {
    const service = context.ConnectionManagerRequestService;
    if (!service) throw Error('Обнови SillyTavern: нужен штатный менеджер профилей подключения.');
    if (!profiles(context).some(p => p.id === settings.profileId)) throw Error('Выбери сохранённый профиль Chat Completion в настройках Таро.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, 90000);
    let rejectAbort;
    const cancelled = new Promise((_, reject) => { rejectAbort = () => reject(new DOMException('Aborted','AbortError')); });
    controller.signal.addEventListener('abort', rejectAbort, {once:true});
    try {
        if (controller.signal.aborted) throw new DOMException('Aborted','AbortError');
        // ST resolves profile credentials. Never activate/rotate a profile or read its key.
        const result = await Promise.race([cancelled, service.sendRequest(settings.profileId,
            [{role:'system',content:system},{role:'user',content:JSON.stringify(payload)}], maxTokens,
            {stream:false,signal:controller.signal,extractData:true,includePreset:false,includeInstruct:false},
            {temperature:0.35})]);
        if (typeof result?.content !== 'string' || !result.content.trim() || result.content.length > 32000) throw Error('invalid response');
        return result.content;
    } catch(e) {
        if (signal?.aborted) throw new DOMException('Aborted','AbortError');
        if (controller.signal.aborted) throw Error('API не ответил за 90 секунд. Можно повторить запрос.');
        // Host/provider errors may include sensitive diagnostics: never render them.
        throw Error('Не удалось получить ответ. Проверь выбранный профиль и ключ в подключениях SillyTavern.');
    } finally {
        clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',rejectAbort);
    }
}
