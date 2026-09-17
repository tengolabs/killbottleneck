import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';

// Stav AI chatu na boku (13. 9. 2026), který musí přežít přepnutí jazyka:
// `Router key={i18n.language}` v App.jsx přemontuje všechno pod sebou, proto
// tenhle provider sedí NAD Routerem. Drží jen otevřeno/šířku/dostupnost —
// logika rozhovoru (useAsistentChat) žije v líném panelu, aby hlavní balík
// (veze se i do /lite, strop 510 kB) nenarostl. Rozhovor sám je na serveru.
const KEY_OPEN = 'kb-chat-open';
const KEY_WIDTH = 'kb-chat-width';
export const MIN_W = 320;
export const MAX_W = 640;

const Ctx = createContext(null);
const ctiSirku = () => {
  const n = Number(nactiKlic(KEY_WIDTH));
  return n >= MIN_W && n <= MAX_W ? n : 400;
};

export function AsistentProvider({ children }) {
  const [open, setOpenState] = useState(() => nactiKlic(KEY_OPEN) === '1');
  const [width, setWidthState] = useState(ctiSirku);
  const [dostupny, setDostupny] = useState(false); // server hlásí mód chat_panel (zjistí líný panel)
  // vybraný uzel v editoru mapy {map_id, node_id, title} — editor ho hlásí, panel ho
  // posílá v kontextu (Richard 14. 9. 2026: „tenhle krok“ = vybraný uzel)
  const [uzel, setUzel] = useState(null);
  const setOpen = useCallback((v) => {
    setOpenState((prev) => {
      const next = typeof v === 'function' ? v(prev) : !!v;
      ulozKlic(KEY_OPEN, next ? '1' : '0');
      return next;
    });
  }, []);
  const setWidth = useCallback((w) => {
    const n = Math.min(MAX_W, Math.max(MIN_W, Math.round(w)));
    setWidthState(n);
    ulozKlic(KEY_WIDTH, String(n));
  }, []);
  const value = useMemo(() => ({ open, setOpen, width, setWidth, dostupny, setDostupny, uzel, setUzel }), [open, setOpen, width, setWidth, dostupny, uzel]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Mimo provider (testy, lite) vrací neutrální stav — nic nespadne.
const PRAZDNO = { open: false, width: 0, dostupny: false, uzel: null, setUzel: () => {} };
export function useAsistent() {
  return useContext(Ctx) || PRAZDNO;
}
