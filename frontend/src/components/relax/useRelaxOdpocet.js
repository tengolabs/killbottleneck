import { useEffect, useState } from 'react';

// Odpočet relaxu: počítá se z časového razítka konce (jako stopky v lib/TimerContext), ne z počtu
// tiků — přepnutí záložky nebo uspaný notebook odpočet nezpomalí. Hodnota se odvozuje při KAŽDÉM
// vykreslení (ne ze stavu): po „Ještě 5 min“ by stará nula ve stavu přežila jeden commit a efekt
// doběhnutí by pauzu hned zase ukončil (ui-relax.js). Vrací zbývající sekundy (≥ 0).
export function useRelaxOdpocet(konecV, bezi) {
  const [, tik] = useState(0);
  useEffect(() => {
    if (!bezi) return undefined;
    const dal = () => tik((t) => t + 1);
    const id = setInterval(dal, 1000);
    document.addEventListener('visibilitychange', dal);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', dal); };
  }, [bezi]);
  return Math.max(0, Math.ceil(((Number(konecV) || 0) - Date.now()) / 1000));
}

export const formatOdpocet = (s) => {
  const v = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

// Jemné cinknutí po doběhnutí (dva tóny, ~0,6 s) — nezávislé na zvuku scény (ten je ve výchozím stavu
// vypnutý). Bez dřívějšího gesta uživatele zůstane AudioContext pozastavený a nic se neozve — nevadí.
export function cinkni() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const ton = (f, od, delka) => {
      const o = ac.createOscillator(); const g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ac.currentTime + od);
      g.gain.exponentialRampToValueAtTime(0.08, ac.currentTime + od + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + od + delka);
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + od); o.stop(ac.currentTime + od + delka + 0.05);
    };
    ton(660, 0, 0.35); ton(880, 0.3, 0.45);
    setTimeout(() => { try { ac.close(); } catch { /* už zavřený */ } }, 1500);
  } catch { /* zvuk je bonus */ }
}
