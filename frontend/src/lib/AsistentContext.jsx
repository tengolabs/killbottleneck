import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { nactiKlic, ulozKlic, smazKlic, KEY_RELAX, KEY_RELAX_SCENA, KEY_RELAX_ROZLOZENI, KEY_RELAX_AKTIVITA } from '@/lib/storageKeys';
import { useAuth } from '@/lib/AuthContext';

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
// stránka asistenta otevřená v panelu Dokumentů (dokId = 'stranka:<id>', 14. 10. 2026)
export const STRANKA = 'stranka:';

// Relax (Richard 14. 10. 2026): hlídaná pauza s akváriem / úlem a odpočtem — přes celou obrazovku (jde zamknout
// PINem a odejít od PC) nebo „vedle“ (vlevo místo mapy, vpravo chat). Scény jsou statické soubory v iframe
// (public/relax/*.html), vrstva je líný chunk (components/relax). Tady jen stav — drží se i v localStorage
// per účet, aby zamčená obrazovka přežila reload a odpočet přepnutí záložky.
export const RELAX_SABLONY = [5, 15, 30]; // klikací délky odpočtu (mikropauza · káva · delší pauza) — lišta scény i panel
export const RELAX_MAX_MINUT = 60;      // stejný strop jako nástroj start_relax na serveru
export const RELAX_SCENY = ['akvarium', 'ul', 'mraveniste'];
const ctiScenu = () => { const v = nactiKlic(KEY_RELAX_SCENA); return RELAX_SCENY.includes(v) ? v : 'akvarium'; };
// výchozí = vedle chatu (na telefonu nad chatem) — stejně jako přepínač v hlavičce; „cela“ jen když si ji uživatel zvolil
const ctiRozlozeni = () => (nactiKlic(KEY_RELAX_ROZLOZENI) === 'cela' ? 'cela' : 'vedle');
// Platný záznam = scéna + start (konecV 0 = bez odpočtu, je to výchozí cesta — /checkup 15. 10.: dřív se bez odpočtu po F5
// ztratil i zámek PINem). Nezamčený stav starší než RELAX_EXPIRACE_MS (zavřený prohlížeč uprostřed pauzy, návrat druhý den)
// se zahodí — jinak by po přihlášení naskočilo „Pauza skončila“ s cinknutím; zamčený se drží vždy.
const RELAX_EXPIRACE_MS = 3 * 3600000;
const ctiRelax = (uid) => {
  if (!uid) return null;
  try {
    const r = JSON.parse(nactiKlic(`${KEY_RELAX}:${uid}`) || 'null');
    if (!r || typeof r !== 'object' || !RELAX_SCENY.includes(r.scena) || !(Number(r.start) > 0)) return null;
    if (!r.zamek && Date.now() - Math.max(Number(r.start) || 0, Number(r.konecV) || 0) > RELAX_EXPIRACE_MS) { smazKlic(`${KEY_RELAX}:${uid}`); return null; }
    return r;
  } catch { return null; }
};

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
  const [dostupny, setDostupny] = useState(false); // panel se kreslí (i při výpadku AI / bez AI — historie, Dokumenty, relax)
  // AI asistentovi právě odpovídá (19. 10. 2026) — na tomhle visí tlačítka, která asistenta odjinud SPOUŠTĚJÍ
  // (Roztřídit s AI, Můj den, kalendář); `dostupny` drží jen rozložení stránky
  const [funkcni, setFunkcni] = useState(false);
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

  // ---- Relax ----
  // { scena, minut, start, konecV, rozlozeni, zamek (otisk PINu | ''), hotovo, pokusy, blokDo }
  const { user } = useAuth();
  const uid = (user && user.id) || '';
  const [relax, setRelaxState] = useState(() => ctiRelax(uid));
  // po přihlášení / změně účtu načíst běžící pauzu toho účtu (zamčená obrazovka po F5)
  useEffect(() => { setRelaxState(ctiRelax(uid)); }, [uid]);
  const uidRef = useRef(uid); uidRef.current = uid;
  const zapisRelax = useCallback((v) => {
    setRelaxState((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      const u = uidRef.current;
      if (u) { if (next) ulozKlic(`${KEY_RELAX}:${u}`, JSON.stringify(next)); else smazKlic(`${KEY_RELAX}:${u}`); }
      return next;
    });
  }, []);
  // minut 0 / nic = BEZ odpočtu (Richard 15. 10. 2026: „mělo by jít pustit samo, 5 min je bonus“) → konecV 0
  // Každé spuštění (slovo, čip, přepínač, hlídač, nástroj modelu, ráno) zapíše i čas pauzy pro hlídač 50 min
  // (`kb-relax-aktivita:<uid>`.posledniRelax) — jedno místo pravdy; dřív to dělal jen obal v panelu a relax od modelu ho obcházel.
  const spustRelax = useCallback(({ scena, minut, rozlozeni } = {}) => {
    const m = Math.min(RELAX_MAX_MINUT, Math.max(0, Math.round(Number(minut) || 0)));
    const s = RELAX_SCENY.includes(scena) ? scena : ctiScenu();
    const roz = rozlozeni === 'vedle' || rozlozeni === 'cela' ? rozlozeni : ctiRozlozeni();
    const ted = Date.now();
    const u = uidRef.current;
    if (u) {
      const k = `${KEY_RELAX_AKTIVITA}:${u}`;
      let a = {}; try { a = JSON.parse(nactiKlic(k) || '{}') || {}; } catch { a = {}; }
      ulozKlic(k, JSON.stringify({ ...a, start: ted, posledni: ted, posledniRelax: ted }));
    }
    zapisRelax({ scena: s, minut: m, start: ted, konecV: m ? ted + m * 60000 : 0, rozlozeni: roz, zamek: '', hotovo: false, pokusy: 0, blokDo: 0 });
  }, [zapisRelax]);
  const ukonciRelax = useCallback(() => zapisRelax(null), [zapisRelax]);
  const prodluzRelax = useCallback((min) => zapisRelax((r) => {
    if (!r) return r;
    const m = Math.min(RELAX_MAX_MINUT, Math.max(1, Math.round(Number(min) || 5)));
    const od = r.hotovo || !r.konecV ? Date.now() : Math.max(Date.now(), Number(r.konecV) || 0);
    return { ...r, konecV: od + m * 60000, minut: r.minut + m, hotovo: false };
  }), [zapisRelax]);
  // scéna / rozložení se zároveň pamatují jako předvolba (příště stejné)
  const upravRelax = useCallback((patch) => zapisRelax((r) => {
    if (!r) return r;
    const p = patch || {};
    if (RELAX_SCENY.includes(p.scena)) ulozKlic(KEY_RELAX_SCENA, p.scena);
    // `docasne`: dočasné zvětšení z „vedle“ (Richard 15. 10.) se do předvolby nezapisuje — po návratu má zůstat „vedle“
    if (!p.docasne && (p.rozlozeni === 'vedle' || p.rozlozeni === 'cela')) ulozKlic(KEY_RELAX_ROZLOZENI, p.rozlozeni);
    const { docasne: _docasne, ...zbytek } = p;
    return { ...r, ...zbytek };
  }), [zapisRelax]);

  const value = useMemo(() => ({
    open, setOpen, width, setWidth, dostupny, setDostupny, funkcni, setFunkcni, uzel, setUzel, liteOpen, setLiteOpen,
    dokOpen, setDokOpen, dokWidth, setDokWidth, dokId, setDokId, otevriDokument, dokVerze: dokZmena.verze, dokZmenene: dokZmena.ids, obnovDokumenty,
    hlidac, opatrne, odchod, setOdchod, zahodZmeny,
    zadost, spust, vyridZadost,
    relax, spustRelax, ukonciRelax, prodluzRelax, upravRelax,
  }), [open, setOpen, width, setWidth, dostupny, funkcni, uzel, liteOpen, dokOpen, setDokOpen, dokWidth, setDokWidth, dokId, otevriDokument, dokZmena, obnovDokumenty, opatrne, odchod, zahodZmeny, zadost, spust, vyridZadost, relax, spustRelax, ukonciRelax, prodluzRelax, upravRelax]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Mimo provider (testy, lite) vrací neutrální stav — nic nespadne.
const PRAZDNO = { open: false, width: 0, dostupny: false, funkcni: false, uzel: null, setUzel: () => {}, liteOpen: false, setLiteOpen: () => {}, dokOpen: false, otevriDokument: () => {}, opatrne: (fn) => fn(), zadost: null, spust: () => {}, vyridZadost: () => {}, relax: null, spustRelax: () => {}, ukonciRelax: () => {}, prodluzRelax: () => {}, upravRelax: () => {} };
export function useAsistent() {
  return useContext(Ctx) || PRAZDNO;
}
