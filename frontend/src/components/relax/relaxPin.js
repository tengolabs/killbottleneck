// Otisk PINu zámku relaxu (14. 10. 2026). Zámek je ZÁVĚS pro kolemjdoucí, ne zabezpečení
// (kdo umí F12, obejde ho; text pod polem to říká a odkazuje na zámek systému). Proto stačí
// rychlý synchronní otisk (cyrb53) — crypto.subtle na LAN přes http (staging :8090, boxy bez
// TLS uvnitř sítě) NENÍ k dispozici (není „secure context“) a PIN by nešel ani nastavit.
export function otiskPinu(pin, sul) {
  const s = `${String(sul || '')}:${String(pin || '')}`;
  let h1 = 0xdeadbeef ^ 53, h2 = 0x41c6ce57 ^ 53;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

export const PIN_DELKA = 4;
export const PIN_MAX_POKUSU = 5;
export const PIN_BLOK_MS = 30000;
export const platnyPin = (p) => new RegExp(`^\\d{${PIN_DELKA}}$`).test(String(p || ''));
