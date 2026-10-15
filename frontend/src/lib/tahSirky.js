// Tažení šířky panelu za levou hranu (asistent, Dokumenty) — JEDNA cesta pro oba.
// Richard 15. 10. 2026: „jen přiblížení bez mačkání myši asistenta posune a zmenší“ — když ukazatel při tahu
// přejel nad iframe scény relaxu, `pointerup` dostal iframe a rodič nikdy; tah zůstal „zaseknutý“ a každý další
// pohyb myši bez tlačítka panel přeměřoval. Proto: pointer capture na úchytu (události chodí úchytu i nad
// iframe), po dobu tahu `body.kb-tah` (CSS vypne pointer-events iframe a výběr textu) a úklid i při
// pointercancel / ztrátě zachycení / odchodu z okna.
export function zacniTah(e, { sirka, nastav }) {
  e.preventDefault();
  const el = e.currentTarget;
  const id = e.pointerId;
  const start = { x: e.clientX, w: sirka };
  let zivy = true;
  try { el.setPointerCapture(id); } catch { /* starší prohlížeč */ }
  document.body.classList.add('kb-tah');
  const move = (ev) => { if (zivy) nastav(start.w + (start.x - ev.clientX)); };
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
