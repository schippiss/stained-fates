import { KEY, NAMES, ROMAN, draw, fingerprint, parseJSON, validateReading, reconcile, status, applyUpdates, influence, DRAW_PROMPT, MONITOR_PROMPT } from './core.js';
import { request, endpoint, nextCredential, checkKeyTransport } from './api.js';
import { scanLore } from './lore.js';

const ctx = () => globalThis.SillyTavern.getContext();
const defaults = { enabled: true, endpoint: '', model: '', reversed: true, interval: 1, contextChars: 14000 };
let config, secret = '', connected = false, busy = false, controller, epoch = 0, timer, generation = false;
let modal, panel, grid, notice, detail, selected = null, lastFocus, pendingCheck = false;
const celebrating = new Set(), art = new Map();
const label = { pending: 'Ждёт трактовки', waiting: 'Ожидает выбора', active: 'Действует', conflict: 'Требует внимания', complete: 'Исполнено' };
const asset = id => { id = id === 'back' || (Number.isInteger(id) && id >= 0 && id < 22) ? id : 'back'; return art.get(String(id)) || new URL(`assets/${id === 'back' ? 'back' : String(id).padStart(2,'0')}.webp`, import.meta.url).href; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
function button(text, fn, cls = '') { const b = el('button', `tf-button ${cls}`, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
function chatKey() { const c = ctx(); return c.chatId == null ? null : `${c.groupId ?? c.characterId ?? ''}:${c.chatId}`; }
function state() {
    if (!chatKey()) return null;
    const metadata = ctx().chatMetadata;
    return metadata[KEY] ||= { version: 1, cards: [], cursor: ctx().chat.length, hashes: ctx().chat.map(fingerprint), draft: '' };
}
function save() { ctx().saveMetadataDebounced(); syncPrompt(); }
function syncPrompt() { ctx().setExtensionPrompt(KEY, config.enabled ? influence(state()?.cards || []) : '', 1, 0, false, 0); }
function setEnabled() {
    config.enabled = !config.enabled; invalidate(); clearTimeout(timer); pendingCheck = false;
    celebrating.clear(); document.querySelectorAll('.tf-completion').forEach(e => e.remove());
    ctx().saveSettingsDebounced(); syncPrompt(); render();
    say(config.enabled ? 'Таро включено. Карты продолжают свою историю.' : 'Таро выключено. Карты сохранены; запросы и влияние на историю остановлены.');
    if (config.enabled) schedule();
}
function say(text, error = false) { notice.textContent = text; notice.classList.toggle('tf-error', error); }
function render() {
    const toggle = panel.querySelector('[data-enabled]');
    toggle.textContent = config.enabled ? 'Таро включено' : 'Таро выключено';
    toggle.setAttribute('aria-pressed', String(config.enabled));
    const s = state(); grid.replaceChildren();
    panel.querySelector('[data-question]').disabled = !s || !config.enabled;
    panel.querySelector('[data-draw]').disabled = !config.enabled || !s || s.cards.length >= 3 || busy;
    panel.querySelector('[data-count]').textContent = `${s?.cards.length || 0} / 3`;
    for (let i = 0; i < 3; i++) {
        const c = s?.cards[i];
        if (!c) { const empty = button('', () => panel.querySelector('[data-question]').focus(), 'tf-empty'); empty.append(el('span','tf-star','✧'),el('span','','Возможное будущее')); empty.setAttribute('aria-label','Задать вопрос для новой карты'); grid.append(empty); continue; }
        const b = button('', () => openCard(c.id), 'tf-card'); b.dataset.id = c.id;
        const img = el('img'); img.src = asset(c.arcana); img.alt = ''; img.className = c.reversed ? 'tf-reversed' : ''; img.loading = 'lazy';
        const text = el('span','tf-card-caption'); text.append(el('strong','',NAMES[c.arcana]), el('small','',`${c.reversed ? 'Перевёрнутая · ' : ''}${label[status(c)]}`));
        b.append(img,text); b.setAttribute('aria-label',`${NAMES[c.arcana]}. ${label[status(c)]}. Открыть предсказание`); grid.append(b);
    }
    if (selected) renderDetail();
}
function open() {
    lastFocus = document.activeElement;
    panel.querySelector('[data-question]').value = state()?.draft || '';
    render(); if (!modal.open) modal.showModal();
    if (!config.enabled) say('Таро выключено. Сохранённые карты доступны для просмотра.');
    else if (!chatKey()) say('Открой чат, чтобы обратиться к картам.');
    else if (!connected) say('Подключи модель в настройках, чтобы карты могли читать историю.');
}
function openCard(id) { selected = id; detail.hidden = false; grid.hidden = true; panel.querySelector('.tf-compose').hidden = true; renderDetail(); detail.querySelector('button')?.focus(); }
function closeCard() { selected = null; detail.hidden = true; grid.hidden = false; panel.querySelector('.tf-compose').hidden = false; render(); queueCelebrations(); }
function renderDetail() {
    const c = state()?.cards.find(c => c.id === selected); if (!c) { closeCard(); return; }
    detail.replaceChildren(); detail.style.setProperty('--tf-back',`url("${asset('back')}")`);
    detail.append(button('← К картам',closeCard,'tf-quiet'));
    detail.append(el('div','tf-eyebrow',`${ROMAN[c.arcana]} · ${c.reversed ? 'Перевёрнутая' : 'Прямая'}`),el('h2','',NAMES[c.arcana]),el('span','tf-status',label[status(c)]));
    detail.append(el('p','tf-question',c.question));
    if (c.reading) {
        detail.append(el('p','tf-prophecy',c.reading.prediction));
        if (status(c) === 'waiting') detail.append(el('p','tf-trigger',`Вступит в силу, когда: ${c.reading.trigger}`));
        const list = el('ol','tf-track');
        for (const f of [...c.facts].sort((a,b)=>a.message-b.message || a.step-b.step)) {
            const li = el('li'); li.append(el('span','',f.summary));
            const proof = el('details'); proof.append(el('summary','',`Сообщение ${f.message+1}`),el('blockquote','',f.quote)); li.append(proof); list.append(li);
        }
        if (!c.facts.length) list.append(el('li','tf-unconfirmed','Подтверждённых событий пока нет.'));
        detail.append(list);
        if (c.conflict) detail.append(el('p','tf-error',`Противоречие: ${c.conflict.summary}. Карта не будет завершена автоматически. Можно отменить её или исправить событие в чате.`));
    } else {
        detail.append(el('p','tf-prophecy','Карта уже выбрана. Осталось услышать её предсказание.'));
        detail.append(button('Повторить трактовку',()=>readCard(c.id)));
    }
    const actions = el('div','tf-actions');
    actions.append(button('Проверить события',()=>check(true),'tf-quiet'));
    actions.append(button('Отменить предсказание',()=>{
        actions.replaceChildren(el('span','','Карта исчезнет и перестанет влиять на историю.'));
        actions.append(button('Да, отменить',()=>removeCard(c.id)),button('Оставить',renderDetail,'tf-quiet'));
    },'tf-danger tf-quiet'));
    detail.append(actions);
}
function invalidate() { epoch++; controller?.abort(); }
function removeCard(id) {
    const s = state(); if (!s) return;
    invalidate(); s.cards = s.cards.filter(c => c.id !== id); celebrating.delete(id);
    if (selected === id) closeCard(); save(); render();
}
function contextWindow(chat) {
    let left = config.contextChars; const out = [];
    for (let i = chat.length-1; i >= 0 && left > 0; i--) {
        if (chat[i].is_system) continue;
        const full = String(chat[i].mes || ''), text = full.slice(-left); left -= text.length;
        out.unshift({ message:i, role:chat[i].is_user?'player':'narrator', name:chat[i].name, text, truncated: text.length < full.length });
    }
    return out;
}
async function drawCard() {
    const s = state(), input = panel.querySelector('[data-question]'), question = input.value.trim();
    if (!config.enabled || !s || busy) return;
    if (!connected) { say('Сначала сохрани подключение в настройках.',true); return; }
    if (!question) { input.focus(); return; }
    const c = { id:crypto.randomUUID(), ...draw(s.cards, config.reversed), question:question.slice(0,600), drawAt:ctx().chat.length, facts:[], reading:null, conflict:null };
    s.cards.push(c); s.draft = ''; input.value = ''; save(); render(); openCard(c.id); await readCard(c.id);
}
async function readCard(id) {
    if (!config.enabled || busy) return;
    const s = state(), card = s?.cards.find(c => c.id === id); if (!card || card.reading) return;
    const currentEpoch = epoch, key = chatKey(); controller = new AbortController(); busy = true; render(); say('Карта всматривается в историю…');
    try {
        const c = ctx(), character = c.characters?.[c.characterId];
        const summary = [...c.chat].reverse().find(m => m.extra?.memory)?.extra.memory;
        const worldLore = await scanLore(c, contextWindow(c.chat), card.question);
        if (epoch !== currentEpoch || chatKey() !== key) return;
        const result = await request(c, config, secret, DRAW_PROMPT, {
            worldLore,
            card: NAMES[card.arcana], reversed:card.reversed, question:card.question,
            characters: { player:c.name1, partner:c.name2, description:String(character?.description || '').slice(0,2500), scenario:String(character?.scenario || '').slice(0,1500) },
            summary: typeof summary === 'string' ? summary.slice(0,2500) : '', messages:contextWindow(c.chat),
            otherPredictions:s.cards.filter(x=>x.reading).map(x=>x.reading),
        }, controller.signal, 1400);
        if (epoch !== currentEpoch || chatKey() !== key) return;
        card.reading = validateReading(parseJSON(result)); s.cursor = Math.min(s.cursor,card.drawAt); save(); say('Предсказание открыто. Оно ждёт твоего выбора.');
    } catch(e) { if (epoch === currentEpoch && e.name !== 'AbortError') say(e.message,true); }
    finally { busy = false; render(); if (pendingCheck) schedule(); }
}
function schedule() { if (!config.enabled) return; pendingCheck = true; clearTimeout(timer); timer = setTimeout(()=>{ if (!generation) check(); },650); }
async function check(force = false) {
    const s = state();
    if (!config.enabled || busy || generation || !s) return;
    pendingCheck = false;
    reconcile(s,ctx().chat); save(); render();
    const cards = s.cards.filter(c=>c.reading); if (!cards.length) return;
    if (!connected) { say('Наблюдение ждёт подключения API. Открой настройки.',true); return; }
    const chat = ctx().chat;
    if (force) s.cursor = Math.min(s.cursor, ...cards.map(c=>c.drawAt));
    if (s.cursor >= chat.length) { queueCelebrations(); if(force) say('Новых событий для проверки нет.'); return; }
    if (!force && config.interval > 1 && chat.slice(s.cursor).filter(m=>!m.is_user&&!m.is_system).length < config.interval) return;
    const currentEpoch = epoch, key = chatKey(); controller = new AbortController(); busy = true; render(); say('Проверяем следы предсказаний…');
    try {
        const worldLore = await scanLore(ctx(), contextWindow(ctx().chat));
        if (epoch !== currentEpoch || chatKey() !== key) return;
        // Batches preserve all text: oversized messages are split into overlapping segments.
        // The cursor advances only after every segment of the message has been checked.
        while (s.cursor < ctx().chat.length && epoch === currentEpoch && chatKey() === key) {
            const i = s.cursor, m = ctx().chat[i];
            if (m.is_system || i < Math.min(...cards.map(c=>c.drawAt))) { s.cursor++; continue; }
            const messages = []; let end = i, size = 0;
            while (end < ctx().chat.length) {
                const item = ctx().chat[end], text = String(item.mes || '');
                if (size + text.length > config.contextChars && messages.length) break;
                messages.push({ message:end, role:item.is_user?'player':item.is_system?'system':'narrator', name:item.name, text }); size += text.length; end++;
                if (size >= config.contextChars) break;
            }
            const segments = messages.length === 1 && messages[0].text.length > config.contextChars
                ? Array.from({length:Math.ceil(messages[0].text.length/(config.contextChars-400))},(_,j)=>[{...messages[0],text:messages[0].text.slice(j*(config.contextChars-400),j*(config.contextChars-400)+config.contextChars),partial:true}]) : [messages];
            for (const batch of segments) {
                const result = await request(ctx(),config,secret,MONITOR_PROMPT,{
                    worldLore,
                    cards:cards.map(c=>({id:c.id,trigger:c.reading.trigger,steps:c.reading.steps,confirmed:c.facts,conflict:c.conflict})),
                    previous:ctx().chat.slice(Math.max(0,i-2),i).map(m=>({role:m.is_user?'player':'narrator',text:String(m.mes).slice(-1200)})),messages:batch,
                },controller.signal,2200);
                if (epoch !== currentEpoch || chatKey() !== key) return;
                const copy = structuredClone(s);
                applyUpdates(copy,parseJSON(result).updates,ctx().chat,new Set(batch.filter(x=>x.role!=='system').map(x=>x.message)));
                for(const c of cards) { const update = copy.cards.find(x=>x.id===c.id); c.facts=update.facts; c.conflict=update.conflict; }
            }
            s.cursor = end; s.hashes = ctx().chat.map(fingerprint); save(); render();
        }
        say('Наблюдение активно · все новые события проверены.'); queueCelebrations();
    } catch(e) { if(epoch === currentEpoch && e.name !== 'AbortError') say(`${e.message} Прогресс не потерян; проверку можно повторить.`,true); }
    finally { busy=false; render(); if(pendingCheck) schedule(); }
}
function queueCelebrations() {
    if (!config.enabled || generation || document.hidden || celebrating.size) return;
    for (const c of state()?.cards || []) {
        if(status(c)!=='complete' || selected===c.id || celebrating.has(c.id)) continue;
        celebrating.add(c.id);
        const key = chatKey(), version = epoch;
        const toast = button('',()=>finish(),'tf-completion');
        const img = el('img'); img.src = asset(c.arcana); img.alt = NAMES[c.arcana]; if(c.reversed)img.className='tf-reversed';
        toast.append(img,el('strong','','Предсказание исполнено'),el('span','',NAMES[c.arcana]));
        toast.setAttribute('aria-label',`${NAMES[c.arcana]}: предсказание исполнено. Закрыть`);
        (modal.open ? modal : document.body).append(toast);
        let done=false;
        function finish() {
            if(done)return; done=true; toast.remove(); celebrating.delete(c.id);
            if(chatKey()===key && epoch===version && status(c)==='complete' && selected!==c.id) { const s=state(); s.cards=s.cards.filter(x=>x.id!==c.id); save(); render(); }
            queueCelebrations();
        }
        setTimeout(finish,4600);
        break;
    }
}
function field(form, title, type, value, name) {
    const wrap=el('label','tf-field'); wrap.append(el('span','',title)); const input=el('input'); input.type=type; input.name=name;
    if(type==='checkbox')input.checked=value; else input.value=value; wrap.append(input); form.append(wrap); return input;
}
function settingsUI() {
    const d=el('details','tf-settings'); d.append(el('summary','','Настройки'));
    const form=el('form');
    const url=field(form,'Адрес API (включая /v1, если требуется)','url',config.endpoint,'endpoint'); url.placeholder='https://example.com/v1';
    const model=field(form,'Модель','text',config.model,'model'); model.placeholder='Название модели у провайдера';
    const key=field(form,'API-ключ · до перезагрузки страницы','password','','key'); key.autocomplete='off';
    form.append(el('p','tf-help','Ключ хранится только в памяти этой страницы. После перезагрузки введи его снова. Чат и подходящие записи подключённых лорбуков отправляются выбранному API через сервер SillyTavern.'));
    const rev=field(form,'Разрешить перевёрнутые карты','checkbox',config.reversed,'reversed');
    const interval=field(form,'Проверка каждые N ответов (1 — сразу)','number',config.interval,'interval'); interval.min='1';interval.max='10';
    const budget=field(form,'Объём чата за запрос, символов','number',config.contextChars,'budget'); budget.min='4000';budget.max='32000';budget.step='1000';
    function capture() {
        const next={endpoint:endpoint(url.value),model:model.value.trim(),reversed:rev.checked,interval:Math.min(10,Math.max(1,Number(interval.value)||1)),contextChars:Math.min(32000,Math.max(4000,Number(budget.value)||14000))};
        if(!next.model)throw Error('Укажи название модели.');
        const newSecret=nextCredential(config.endpoint,next.endpoint,secret,key.value);
        checkKeyTransport(newSecret);
        invalidate(); Object.assign(config,next); secret=newSecret; key.value='';
        connected=true; ctx().saveSettingsDebounced();
    }
    const submit=el('button','tf-button','Сохранить подключение');submit.type='submit';form.append(submit);
    form.addEventListener('submit',e=>{e.preventDefault();try{capture();say('Подключение сохранено.');schedule();}catch(err){say(err.message,true);}});
    form.append(button('Проверить API',async()=>{
        if(!config.enabled){say('Включи Таро перед проверкой подключения.');return;}
        if(busy)return;
        try {capture();busy=true;say('Проверяем подключение…');await request(ctx(),config,secret,'Ответь одним словом: готово.',{},undefined,24);say('API отвечает. Можно обратиться к картам.');}
        catch(e){say(e.message,true);}finally{busy=false;render();}
    },'tf-quiet'));
    form.append(button('Отключить и забыть ключ',()=>{invalidate();secret='';key.value='';connected=false;clearTimeout(timer);say('Ключ удалён из памяти. Наблюдение отключено.');},'tf-quiet'));
    form.append(el('p','tf-help','Проверки расходуют токены. Интервал больше 1 уменьшает частоту, но задерживает отметки. На каждом ходе рассказчик получает краткие условия карт.'));
    d.append(form);
    const upload=el('label','tf-field'); upload.append(el('span','','Свои изображения · выбрать одно или несколько'));
    const files=el('input');files.type='file';files.accept='image/jpeg,image/png,image/webp';files.multiple=true;upload.append(files);d.append(upload);
    d.append(el('p','tf-help','Имена: 00–21 и back либо русские названия арканов. Изображения сохраняются в этом браузере. Загрузка автоматически уменьшает их.'));
    files.addEventListener('change',async()=>{try{await importArt(files.files);say('Оформление колоды обновлено.');render();}catch(e){say(e.message,true);}finally{files.value='';}});
    d.append(button('Вернуть исходную колоду',async()=>{try{await clearArt();render();say('Исходная колода восстановлена.');}catch{say('Не удалось открыть хранилище изображений.',true);}},'tf-quiet'));
    return d;
}
let dbPromise;
function db() { return dbPromise ||= new Promise((resolve,reject)=>{const r=indexedDB.open('stained-fates-art',1);r.onupgradeneeded=()=>r.result.createObjectStore('images');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Браузер не разрешил сохранить изображения.'));}); }
async function putArt(id,blob) { const database=await db();await new Promise((resolve,reject)=>{const t=database.transaction('images','readwrite');t.objectStore('images').put(blob,String(id));t.oncomplete=resolve;t.onerror=()=>reject(Error('Недостаточно места для изображений.'));});if(art.has(String(id)))URL.revokeObjectURL(art.get(String(id)));art.set(String(id),URL.createObjectURL(blob)); }
async function loadArt() { const database=await db();await new Promise((resolve,reject)=>{const r=database.transaction('images').objectStore('images').openCursor();r.onsuccess=()=>{const cursor=r.result;if(cursor){art.set(cursor.key,URL.createObjectURL(cursor.value));cursor.continue();}else resolve();};r.onerror=reject;}); }
async function clearArt() { const database=await db();await new Promise((resolve,reject)=>{const t=database.transaction('images','readwrite');t.objectStore('images').clear();t.oncomplete=resolve;t.onerror=reject;});for(const url of art.values())URL.revokeObjectURL(url);art.clear(); }
async function importArt(files) {
    if(files.length>23)throw Error('За один раз можно загрузить не больше 23 изображений.');
    let count=0;
    for(const file of files) {
        if(file.size>20*1024*1024)throw Error('Одно изображение должно быть меньше 20 МБ.');
        const header=new Uint8Array(await file.slice(0,12).arrayBuffer());
        const png=[137,80,78,71,13,10,26,10].every((v,i)=>header[i]===v);
        const jpg=header[0]===255&&header[1]===216&&header[2]===255;
        const webp=String.fromCharCode(...header.slice(0,4))==='RIFF'&&String.fromCharCode(...header.slice(8,12))==='WEBP';
        if(!png&&!jpg&&!webp)throw Error('Допустимы только настоящие PNG, JPEG и WebP.');
        const name=file.name.replace(/\.[^.]+$/,'').toLowerCase().replaceAll('ё','е');
        let id=NAMES.findIndex(n=>n.toLowerCase().replaceAll('ё','е')===name);
        if(/^\d{1,2}$/.test(name)&&Number(name)<22)id=Number(name);
        if(name==='возлюбленные')id=6;
        if(['back','рубашка'].includes(name))id='back';
        if(id===-1)continue;
        const image=new Image(),url=URL.createObjectURL(file);
        try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Не удалось прочитать изображение.'));image.src=url;});
            if(image.naturalWidth*image.naturalHeight>24000000 || Math.max(image.naturalWidth,image.naturalHeight)>12000)throw Error('Изображение слишком большое: максимум 24 мегапикселя и 12000 пикселей по стороне.');
            const canvas=document.createElement('canvas'),ratio=Math.min(1,1000/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.round(image.naturalWidth*ratio);canvas.height=Math.round(image.naturalHeight*ratio);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
            const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.83));if(!blob)throw Error('Не удалось подготовить изображение.');await putArt(id,blob);count++;
        }finally{URL.revokeObjectURL(url);}
    }
    if(!count)throw Error('Имена не распознаны. Используй 00–21, back или названия карт.');
}
function mount() {
    modal=el('dialog','tf-modal');modal.setAttribute('aria-labelledby','tf-title'); panel=el('section','tf-panel');
    const head=el('header','tf-header'),titles=el('div');titles.append(el('span','tf-eyebrow','ТАРО · СТАРШИЕ АРКАНЫ'));const title=el('h1','','Витражи судьбы');title.id='tf-title';titles.append(title);head.append(titles,button('✕',()=>modal.close(),'tf-close'));head.lastChild.setAttribute('aria-label','Закрыть окно таро');panel.append(head);
    const sub=el('div','tf-sub');sub.append(el('span','','У каждого выбора — своё продолжение.'));const count=el('span');count.dataset.count='';sub.append(count);panel.append(sub);
    const toolbar=el('div','tf-toolbar'),toggle=button('',setEnabled,'tf-toggle');toggle.dataset.enabled='';
    toolbar.append(toggle,el('span','tf-help','Свой расклад в каждом чате'));panel.append(toolbar);
    grid=el('div','tf-grid');panel.append(grid);detail=el('article','tf-detail');detail.hidden=true;panel.append(detail);
    const compose=el('form','tf-compose');const question=el('textarea');question.dataset.question='';question.placeholder='К чему приведёт мой выбор?';question.maxLength=600;question.rows=2;question.setAttribute('aria-label','Вопрос картам');question.addEventListener('input',()=>{const s=state();if(s){s.draft=question.value;save();}});compose.append(question);
    const drawButton=el('button','tf-button tf-primary','Вытянуть карту');drawButton.type='submit';drawButton.dataset.draw='';compose.append(drawButton);compose.addEventListener('submit',e=>{e.preventDefault();drawCard().catch(e=>say(e.message,true));});panel.append(compose);
    notice=el('p','tf-notice');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');panel.append(notice);
    const footer=el('div','tf-footer');footer.append(button('Проверить события',()=>check(true),'tf-quiet'));
    const settings=settingsUI();
    const settingsButton=button('Настройки',()=>{settings.open=!settings.open;},'tf-quiet');
    settingsButton.setAttribute('aria-expanded','false');
    settings.addEventListener('toggle',()=>{panel.classList.toggle('tf-show-settings',settings.open);settingsButton.textContent=settings.open?'← К раскладу':'Настройки';settingsButton.setAttribute('aria-expanded',String(settings.open));});
    footer.append(settingsButton);panel.append(footer,settings);modal.append(panel);document.body.append(modal);
    modal.addEventListener('close',()=>{closeCard();lastFocus?.focus?.();});
    const opener=button('☾ Таро',open,'tf-launcher');opener.title='Витражи судьбы';(document.querySelector('#extensionsMenu') || document.querySelector('#extensions_settings') || document.body).append(opener);
    const moon=button('☾',open,'tf-launcher tf-floating');moon.setAttribute('aria-label','Открыть Таро — Витражи судьбы');moon.title='Открыть Таро';document.body.append(moon);
    function viewport(){ const v=window.visualViewport;modal.style.setProperty('--tf-height',`${v?.height||innerHeight}px`);modal.style.setProperty('--tf-top',`${v?.offsetTop||0}px`); }
    window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);window.addEventListener('resize',viewport);viewport();
}
function init() {
    const c=ctx();
    if(!c.setExtensionPrompt || !c.saveMetadataDebounced || !c.eventSource || !c.getRequestHeaders || !globalThis.HTMLDialogElement)throw Error('Для таро нужна актуальная версия SillyTavern и браузер с поддержкой dialog.');
    config=c.extensionSettings[KEY]=Object.assign({},defaults,c.extensionSettings[KEY]);mount();
    loadArt().then(render).catch(()=>say('Своя колода недоступна; используется встроенная.',true));
    const events=c.eventTypes||c.event_types;
    const on=(name,fn)=>{if(events[name])c.eventSource.on(events[name],fn);};
    on('CHAT_CHANGED',()=>{invalidate();pendingCheck=false;generation=false;celebrating.clear();document.querySelectorAll('.tf-completion').forEach(e=>e.remove());selected=null;detail.hidden=true;grid.hidden=false;panel.querySelector('.tf-compose').hidden=false;panel.querySelector('[data-question]').value=state()?.draft||'';if(state()){reconcile(state(),ctx().chat);save();}syncPrompt();render();say(connected?'Карты этого чата готовы.':'Наблюдение ждёт подключения API.');schedule();});
    const changed=()=>{invalidate();const s=state();if(s){reconcile(s,ctx().chat);save();render();}schedule();};
    for(const name of ['MESSAGE_SENT','MESSAGE_EDITED','MESSAGE_UPDATED','MESSAGE_DELETED','MESSAGE_SWIPED'])on(name,changed);
    on('GENERATION_STARTED',(_type,_options,dryRun)=>{if(!dryRun){generation=true;controller?.abort();}syncPrompt();});
    on('GENERATION_AFTER_COMMANDS',(_type,_options,dryRun)=>{if(!dryRun){const s=state();if(s)reconcile(s,ctx().chat);syncPrompt();}});
    on('GENERATION_ENDED',()=>{generation=false;changed();});on('GENERATION_STOPPED',()=>{generation=false;changed();});
    on('CHARACTER_MESSAGE_RENDERED',()=>{if(!generation)changed();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)queueCelebrations();});
    if(state()){reconcile(state(),c.chat);save();}syncPrompt();render();
}
try { init(); } catch(e) { const message=el('p','tf-error',`Таро: ${e.message}`);(document.querySelector('#extensions_settings')||document.body).append(message); }
