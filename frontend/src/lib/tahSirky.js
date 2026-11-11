// Tažení šířky panelu za levou hranu (asistent, Dokumenty) — JEDNA cesta pro oba.
// Richard 15. 10. 2026: „jen přiblížení bez mačkání myši asistenta posune a zmenší“ — když ukazatel při tahu
// přejel nad iframe scény relaxu, `pointerup` dostal iframe a rodič nikdy; tah zůstal „zaseknutý“ a každý další
// pohyb myši bez tlačítka panel přeměřoval. Proto: pointer capture na úchytu (události chodí úchytu i nad
// iframe), po dobu tahu `body.kb-tah` (CSS vypne pointer-events iframe a výběr textu) a úklid i při
// pointercancel / ztrátě zachycení / odchodu z okna.
// `smer` (10 Nov 2026): +1 = handle on the panel's LEFT edge (panel on the right, dragging left widens),
// -1 = handle on the RIGHT edge (panel on the left, dragging right widens).
export function zacniTah(e, { sirka, nastav, smer = 1 }) {
  e.preventDefault();
  const el = e.currentTarget;
  const id = e.pointerId;
  const start = { x: e.clientX, w: sirka };
  let zivy = true;
  try { el.setPointerCapture(id); } catch { /* starší prohlížeč */ }
  document.body.classList.add('kb-tah');
  const move = (ev) => { if (zivy) nastav(start.w + smer * (start.x - ev.clientX)); };
  const konec = () => {
    if (!zivy) return;
    zivy = false;
    document.body.classList.remove('kb-tah');
    try { if (el.hasPointerCapture && el.hasPointerCapture(id)) el.releasePointerCapture(id); } catch { /* už uvolněno */ }
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', konec);
    el.removeEventListener('pointercancel', konec);
    el.removeEventListener('lostpointercapture', konec);
    window.removeEventListener('pointerup', konec);
    window.removeEventListener('blur', konec);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', konec);
  el.addEventListener('pointercancel', konec);
  el.addEventListener('lostpointercapture', konec);
  window.addEventListener('pointerup', konec);
  window.addEventListener('blur', konec);
}

// Moving the assistant to the other side by dragging its header (10 Nov 2026). Same capture/cleanup rules as zacniTah
// (pointer capture so an iframe of the relax scene can't swallow pointerup, body.kb-tah while dragging).
// onTarget(side | null) reports the drop target while dragging (null = below the threshold / middle third → no change),
// onDrop(side | null) fires once on release. Clicks on buttons inside the header are ignored by the caller.
const MOVE_THRESHOLD = 8;
function moveTarget(x, viewport) {
  if (x <= viewport / 3) return 'left';
  if (x >= (viewport * 2) / 3) return 'right';
  return null;
}
export function startMove(e, { onTarget, onDrop }) {
  if (e.button !== undefined && e.button !== 0) return;
  const el = e.currentTarget;
  const id = e.pointerId;
  const start = { x: e.clientX, y: e.clientY };
  let alive = true;
  let dragging = false;
  let target = null;
  try { el.setPointerCapture(id); } catch { /* older browser */ }
  const move = (ev) => {
    if (!alive) return;
    if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < MOVE_THRESHOLD) return;
    if (!dragging) { dragging = true; document.body.classList.add('kb-tah', 'kb-presun'); }
    target = moveTarget(ev.clientX, window.innerWidth);
    onTarget(target);
  };
  const end = (ev) => {
    if (!alive) return;
    alive = false;
    document.body.classList.remove('kb-tah', 'kb-presun');
    try { if (el.hasPointerCapture && el.hasPointerCapture(id)) el.releasePointerCapture(id); } catch { /* already released */ }
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end);
    el.removeEventListener('lostpointercapture', end);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('blur', end);
    onTarget(null);
    // cancel / blur / lost capture without a real release = no move
    onDrop(dragging && ev && ev.type === 'pointerup' ? target : null);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  window.addEventListener('pointerup', end);
  window.addEventListener('blur', end);
}
