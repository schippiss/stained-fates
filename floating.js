const clamp = (x, low, high) => Math.min(high, Math.max(low, x));
export function floatingBounds(viewport) {
    return { left: (viewport.offsetLeft || 0) + 8, top: (viewport.offsetTop || 0) + 8,
        width: Math.max(0, viewport.width - 72), height: Math.max(0, viewport.height - 72) };
}
export function floatingPoint(position, viewport) {
    const b = floatingBounds(viewport);
    const valid = position && Number.isFinite(position.x) && Number.isFinite(position.y);
    return { x: b.left + b.width * (valid ? clamp(position.x,0,1) : 1),
        y: valid ? b.top + b.height * clamp(position.y,0,1) : clamp((viewport.offsetTop || 0) + viewport.height - 156,b.top,b.top+b.height) };
}
export function attachFloating(button, getPosition, savePosition, getViewport) {
    let drag = null, suppressClick = false;
    const place = point => {button.style.left=`${point.x}px`;button.style.top=`${point.y}px`;};
    const normalize = point => { const b=floatingBounds(getViewport());return {x:b.width ? clamp((point.x-b.left)/b.width,0,1) : 0,y:b.height ? clamp((point.y-b.top)/b.height,0,1) : 0}; };
    const refresh = () => { if (!drag) place(floatingPoint(getPosition(),getViewport())); };
    button.addEventListener('pointerdown',e=>{
        if(e.button!==0 || e.isPrimary===false)return;
        suppressClick=false;const r=button.getBoundingClientRect();
        drag={id:e.pointerId,x:e.clientX,y:e.clientY,start:{x:r.left,y:r.top},point:{x:r.left,y:r.top},moved:false};
        button.setPointerCapture(e.pointerId);
    });
    button.addEventListener('pointermove',e=>{
        if(!drag || e.pointerId!==drag.id)return;
        const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
        if(!drag.moved && Math.hypot(dx,dy)<6)return;
        drag.moved=true;suppressClick=true;e.preventDefault();
        const b=floatingBounds(getViewport());
        drag.point={x:clamp(drag.start.x+dx,b.left,b.left+b.width),y:clamp(drag.start.y+dy,b.top,b.top+b.height)};
        place(drag.point);button.classList.add('tf-dragging');
    });
    const end = e => {
        if(!drag || e.pointerId!==drag.id)return;
        const previous=drag;drag=null;button.classList.remove('tf-dragging');
        if(button.hasPointerCapture(e.pointerId))button.releasePointerCapture(e.pointerId);
        if(previous.moved && e.type!=='pointercancel')savePosition(normalize(previous.point));
        refresh();
    };
    for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,end);
    button.addEventListener('click',e=>{if(suppressClick && e.detail!==0){e.preventDefault();e.stopImmediatePropagation();}suppressClick=false;},true);
    button.addEventListener('keydown',e=>{
        const delta={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]}[e.key];
        if(!delta)return;e.preventDefault();const p=floatingPoint(getPosition(),getViewport());
        savePosition(normalize({x:p.x+delta[0],y:p.y+delta[1]}));refresh();
    });
    refresh();return refresh;
}
