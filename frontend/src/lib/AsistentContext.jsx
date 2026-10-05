import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';

// Stav AI chatu na boku (13. 9. 2026), který musí přežít přepnutí jazyka:
// `Router key={i18n.language}` v App.jsx přemontuje všechno pod sebou, proto
// tenhle provider sedí NAD Routerem. Drží jen otevřeno/šířku/dostupnost —
// logika rozhovoru (useAsistentChat) žije v líném panelu, aby hlavní balík
// (veze se i do /lite, hlídá tests/lite-bundle.js) nenarostl. Rozhovor sám je na serveru.
const KEY_OPEN = 'kb-chat-open';
const KEY_WIDTH = 'kb-chat-width';
export const MIN_W = 320;
export const MAX_W = 640;
// Dokumenty asistenta (30. 9. 2026): panel VLEVO od chatu, přes mapu (stránku neodsouvá).
const KEY_DOK_OPEN = 'kb-chat-dok-open';
const KEY_DOK_WIDTH = 'kb-chat-dok-width';
export const DOK_MIN_W = 320;
export const DOK_MAX_W = 720;
// šířka panelu Dokumentů na daném okně — jeden vzorec pro panel i odsazení toastů (checkup 1. 10.):
// na úzkém okně se vejde, co zbude vedle chatu (48 px mapy vlevo nechat vidět)
export const sirkaDokumentu = (okno, sirkaChatu, dokWidth) => Math.max(Math.min(DOK_MIN_W, okno - sirkaChatu), Math.min(dokWidth, okno - sirkaChatu - 48));
// připnutá paměť asistenta v panelu Dokumenty (dokId) — PB id mají 15 znaků, se slovem se nepletou
export const PAMET = 'pamet';

const Ctx = createContext(null);
const ctiSirku = () => {
  const n = Number(nactiKlic(KEY_WIDTH));
  return n >= MIN_W && n <= MAX_W ? n : 400;
};
const ctiSirkuDok = () => {
  const n = Number(nactiKlic(KEY_DOK_WIDTH));
  return n >= DOK_MIN_W && n <= DOK_MAX_W ? n : 480;
};

export function AsistentProvider({ children }) {
  const [open, setOpenState] = useState(() => nactiKlic(KEY_OPEN) === '1');
  const [width, setWidthState] = useState(ctiSirku);
  const [dostupny, setDostupny] = useState(false); // server hlásí mód chat_panel (zjistí líný panel)
  // Zjednodušené zobrazení (4. 10. 2026): VLASTNÍ, NEperzistentní stav otevření. `kb-chat-open`
  // patří plné aplikaci — kdo tam nechal panel otevřený, nesmí na telefonu v lite dostat chat
  // přes celou obrazovku místo seznamu (a chunk panelu by jel hned při startu, lite-bundle.js).
  // Zavřený panel se v lite ODMONTUJE; rozhovor je na serveru (kb-chat-id ho po otevření vrátí).
  // Sedí tady (nad Routerem), ne v LiteApp: přepnutí jazyka kartou asistenta LiteApp přemontuje.
  const [liteOpen, setLiteOpen] = useState(false);
  // vybraný uzel v editoru mapy {map_id, node_id, title} — editor ho hlásí, panel ho
  // posílá v kontextu (Richard 14. 9. 2026: „tenhle krok“ = vybraný uzel)
  const [uzel, setUzel] = useState(null);
  // Spuštění balíčku asistenta odjinud (dialog Nový projekt → „Navrhnout s AI“, zásobník →
  // „Roztřídit s AI“, 1. 10. 2026). Panel je líný, proto jen žádost: vyřídí ji, jakmile je
  // načtený a volný.
  const [zadost, setZadost] = useState(null);
  const [dokOpen, setDokOpenState] = useState(() => nactiKlic(KEY_DOK_OPEN) === '1');
  const [dokWidth, setDokWidthState] = useState(ctiSirkuDok);
  const [dokId, setDokId] = useState('');      // otevřený dokument ('' = seznam)
  // asistent dokument založil/změnil → panel znovu načte; `ids` = KTERÉ dokumenty (detail jiného
  // dokumentu nesmí hlásit „asistent ho mezitím upravil“ — checkup 1. 10.)
  const [dokZmena, setDokZmena] = useState({ verze: 0, ids: [] });
  // Neuložené změny v detailu dokumentu (Detail sem hlásí). Hlídání MUSÍ být tady, ne v panelu:
  // samootevření po tahu, karty v chatu, přepínač v hlavičce i minimalizace jdou mimo panel a
  // rozepsanou úpravu by bez dotazu zahodily (checkup 1. 10.). `odchod` = co provést po „Zahodit“.
  const hlidac = useRef(false);
  const [odchod, setOdchod] = useState(null);
  const opatrne = useCallback((fn) => { if (hlidac.current) setOdchod(() => fn); else fn(); }, []);
  const zahodZmeny = useCallback(() => {
    setOdchod((f) => { hlidac.current = false; if (f) setTimeout(f, 0); return null; });
  }, []);
  const setDokOpen = useCallback((v) => {
    setDokOpenState((prev) => {
      const next = typeof v === 'function' ? v(prev) : !!v;
      ulozKlic(KEY_DOK_OPEN, next ? '1' : '0');
      return next;
    });
  }, []);
  const setDokWidth = useCallback((w) => {
    const n = Math.min(DOK_MAX_W, Math.max(DOK_MIN_W, Math.round(w)));
    setDokWidthState(n);
    ulozKlic(KEY_DOK_WIDTH, String(n));
  }, []);
  const otevriDokument = useCallback((id) => opatrne(() => { setDokId(id || ''); setDokOpen(true); }), [opatrne, setDokOpen]);
  const obnovDokumenty = useCallback((ids) => setDokZmena((z) => ({ verze: z.verze + 1, ids: ids || [] })), []);
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
  const spust = useCallback((mode, target) => { setZadost({ mode, target: target || {} }); setOpen(true); }, [setOpen]);
  const vyridZadost = useCallback(() => setZadost(null), []);
  const value = useMemo(() => ({
    open, setOpen, width, setWidth, dostupny, setDostupny, uzel, setUzel, liteOpen, setLiteOpen,
    dokOpen, setDokOpen, dokWidth, setDokWidth, dokId, setDokId, otevriDokument, dokVerze: dokZmena.verze, dokZmenene: dokZmena.ids, obnovDokumenty,
    hlidac, opatrne, odchod, setOdchod, zahodZmeny,
    zadost, spust, vyridZadost,
  }), [open, setOpen, width, setWidth, dostupny, uzel, liteOpen, dokOpen, setDokOpen, dokWidth, setDokWidth, dokId, otevriDokument, dokZmena, obnovDokumenty, opatrne, odchod, zahodZmeny, zadost, spust, vyridZadost]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Mimo provider (testy, lite) vrací neutrální stav — nic nespadne.
const PRAZDNO = { open: false, width: 0, dostupny: false, uzel: null, setUzel: () => {}, liteOpen: false, setLiteOpen: () => {}, dokOpen: false, otevriDokument: () => {}, opatrne: (fn) => fn(), zadost: null, spust: () => {}, vyridZadost: () => {} };
export function useAsistent() {
  return useContext(Ctx) || PRAZDNO;
}
