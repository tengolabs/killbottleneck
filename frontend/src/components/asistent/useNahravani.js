// Nahrávání hlasovky v prohlížeči (1. 10. 2026, fáze B plánu AI funkcí).
// MediaRecorder, formát podle prohlížeče: Chrome/Edge/Android webm+opus, Firefox ogg+opus, Safari mp4 (AAC);
// mono, 32 kb/s → 5 minut ≈ 1,2 MB. Mikrofon se uvolní hned po nahrání (jinak svítí indikátor nahrávání).
// Výsledek jde VŽDY přes onNahrano(blob, sekundy) — i při automatickém zastavení na limitu (délka, velikost),
// aby se nahrávka neztratila. Zrušení nahrávku zahodí.
// ⚠️ getUserMedia jde jen na https nebo localhost (secure context) — na self-hostu přes http:// v LAN
// mikrofon není (stejně jako schránka), proto `duvodNejde()`.
import { useCallback, useEffect, useRef, useState } from 'react';

const FORMATY = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'];

// proč nahrávání v tomhle prohlížeči nejde ('' = jde): nezabezpeceno | nepodporovano
export function duvodNejde() {
  if (typeof window === 'undefined') return 'nepodporovano';
  if (!window.isSecureContext) return 'nezabezpeceno';
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || typeof window.MediaRecorder === 'undefined') return 'nepodporovano';
  return '';
}

export default function useNahravani({ maxS = 300, maxBajtu = Math.round(3 * 1024 * 1024 * 0.95), onNahrano } = {}) {
  const [stav, setStav] = useState('klid'); // klid | ceka (povolení) | nahrava | chyba
  const [sekundy, setSekundy] = useState(0);
  const [chyba, setChyba] = useState('');   // povoleni | zadnyMikrofon | nezabezpeceno | nepodporovano
  const rec = useRef(null);
  const proud = useRef(null);
  const kousky = useRef([]);
  const zacatek = useRef(0);
  const casovac = useRef(null);
  const velikost = useRef(0);
  const zahodit = useRef(false);
  const naVysledek = useRef(onNahrano);
  naVysledek.current = onNahrano;
  // pořadové číslo pokusu: „Zrušit“ nebo odmontování během čekání na povolení mikrofonu ho zvýší → povolení,
  // které přijde potom, už nahrávání nespustí (dřív se nahrávalo naslepo až do limitu a hlasovka sama odešla)
  const pokus = useRef(0);

  const uvolni = useCallback(() => {
    clearInterval(casovac.current); casovac.current = null;
    if (proud.current) { proud.current.getTracks().forEach((s) => s.stop()); proud.current = null; }
  }, []);
  useEffect(() => () => { pokus.current += 1; zahodit.current = true; try { if (rec.current && rec.current.state !== 'inactive') rec.current.stop(); } catch { /* už neběží */ } uvolni(); }, [uvolni]);

  const zacni = useCallback(async () => {
    const d = duvodNejde();
    if (d) { setChyba(d); setStav('chyba'); return false; }
    const muj = ++pokus.current;
    setChyba(''); setStav('ceka');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      if (muj !== pokus.current) return false; // mezitím zrušeno — chybu už nikdo nečeká
      const n = e && e.name;
      setChyba(n === 'NotAllowedError' || n === 'SecurityError' ? 'povoleni' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'zadnyMikrofon' : 'nepodporovano');
      setStav('chyba'); uvolni(); return false;
    }
    // zrušeno (nebo odmontováno) dřív, než prohlížeč mikrofon povolil → hned ho uvolnit a nenahrávat
    if (muj !== pokus.current) { stream.getTracks().forEach((s) => s.stop()); return false; }
    proud.current = stream;
    const mime = FORMATY.find((f) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(f)) || '';
    let r;
    try { r = new MediaRecorder(proud.current, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 }); } catch { r = new MediaRecorder(proud.current); }
    kousky.current = []; velikost.current = 0; zahodit.current = false;
    r.ondataavailable = (ev) => {
      if (!ev.data || !ev.data.size) return;
      kousky.current.push(ev.data); velikost.current += ev.data.size;
      if (velikost.current > maxBajtu && r.state === 'recording') r.stop(); // pojistka velikosti (Safari AAC bývá tlustší)
    };
    r.onstop = () => {
      const s = (Date.now() - zacatek.current) / 1000;
      uvolni();
      setStav('klid');
      if (zahodit.current) return;
      const blob = new Blob(kousky.current, { type: r.mimeType || mime || 'audio/webm' });
      if (naVysledek.current) naVysledek.current(blob, s);
    };
    rec.current = r;
    r.start(1000);
    zacatek.current = Date.now();
    setSekundy(0); setStav('nahrava');
    casovac.current = setInterval(() => {
      const s = Math.floor((Date.now() - zacatek.current) / 1000);
      setSekundy(s);
      if (s >= maxS && r.state === 'recording') r.stop(); // limit délky → nahrávka odejde sama
    }, 250);
    return true;
  }, [maxS, maxBajtu, uvolni]);

  const zastav = useCallback(() => { const r = rec.current; if (r && r.state === 'recording') { zahodit.current = false; r.stop(); } }, []);
  const zrus = useCallback(() => { pokus.current += 1; const r = rec.current; zahodit.current = true; if (r && r.state !== 'inactive') r.stop(); else uvolni(); setStav('klid'); }, [uvolni]);
  const zavriChybu = useCallback(() => { setChyba(''); setStav('klid'); }, []);

  return { stav, sekundy, chyba, zacni, zastav, zrus, zavriChybu };
}

// Blob → holý base64 (bez prefixu data:…;base64,)
export function naBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => { const s = String(fr.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
    fr.onerror = () => reject(fr.error || new Error('read'));
    fr.readAsDataURL(blob);
  });
}
