export function endpoint(value) {
    const u = new URL(value.trim());
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw Error('Укажите адрес API без ключей, параметров и пароля в URL.');
    if (u.protocol === 'http:' && !loopback(u.hostname)) throw Error('Для внешнего API нужен HTTPS. HTTP разрешён только для localhost.');
    return u.href.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}
const loopback = host => host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
export function checkKeyTransport(key, location = globalThis.location) {
    if (key && location?.protocol !== 'https:' && location && !loopback(location.hostname)) throw Error('Для передачи ключа открой SillyTavern через HTTPS. HTTP допустим только на localhost.');
}
export function nextCredential(previousEndpoint, nextEndpoint, previousKey, enteredKey) {
    if (enteredKey.trim()) return enteredKey.trim();
    return previousEndpoint === nextEndpoint ? previousKey : '';
}
async function readResponse(response) {
    const max = 256 * 1024;
    if (Number(response.headers.get('content-length')) > max) throw Error('Ответ API слишком большой.');
    const reader = response.body?.getReader();
    if (!reader) throw Error('API вернул пустой ответ.');
    const decoder = new TextDecoder(); let size = 0, text = '';
    try {
        while (true) {
            const {done,value} = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > max) throw Error('Ответ API слишком большой.');
            text += decoder.decode(value,{stream:true});
        }
        text += decoder.decode();
    } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
    try { return JSON.parse(text); } catch { throw Error('API вернул некорректный JSON.'); }
}
export async function request(context, settings, key, system, payload, signal, maxTokens = 1800) {
    if (!settings.model?.trim()) throw Error('Укажите модель в настройках.');
    let base;
    base = endpoint(settings.endpoint);
    checkKeyTransport(key);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 90000);
    try {
        const r = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST', headers: context.getRequestHeaders(), signal: controller.signal, redirect: 'error', credentials: 'same-origin', cache: 'no-store',
            body: JSON.stringify({ chat_completion_source: 'openai', reverse_proxy: base, proxy_password: key,
                model: settings.model.trim(), stream: false, temperature: 0.35, max_tokens: maxTokens,
                messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }] }),
        });
        if (!r.ok) throw Error(({401:'API не принял ключ.',403:'Доступ к API запрещён.',429:'Лимит API исчерпан. Повторите позднее.'})[r.status] || `Запрос не выполнен (HTTP ${r.status}). Проверьте эндпоинт и модель.`);
        const data = await readResponse(r);
        const text = data.choices?.[0]?.message?.content;
        if (data.error || typeof text !== 'string' || !text.trim()) throw Error('API не вернул текст. Проверьте модель, ключ и адрес подключения.');
        if (text.length > 32000) throw Error('Текст ответа API слишком большой.');
        return text;
    } catch (e) {
        if (e.name === 'AbortError' && !signal?.aborted) throw Error('API не ответил за 90 секунд. Можно повторить запрос.');
        if (e instanceof TypeError) throw Error('Не удалось связаться с сервером SillyTavern.');
        throw e;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
