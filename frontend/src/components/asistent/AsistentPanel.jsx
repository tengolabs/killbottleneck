import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bot, Brain, ChevronDown, ChevronLeft, ChevronUp, FileText, History, ImagePlus, Loader2, PanelRightClose, Plus, Send, Sunrise, Trash2, X } from 'lucide-react';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/AuthContext';
import { useAsistent, MIN_W, MAX_W } from '@/lib/AsistentContext';
import { useLazyNs } from '@/i18n/lazyNs';
import { useAiModes } from '@/hooks/useAiEnabled';
import { chatPamet, chatPametUloz, chatKonceptUloz } from '@/api/asistentApi';
import { setSkin } from '@/lib/theme';
import { getBuiltinSkin, DEFAULT_SKIN_ID } from '@/lib/skins';
import { base44 } from '@/api/base44Client';
import { pripravObrazek, obrazekZeSchranky } from '@/lib/obrazek';
import AsistentZprava from './AsistentZprava';
import PdfPohled from './PdfPohled';
import { useAsistentChat } from './useAsistentChat';

// AI chat na boku (13. 9. 2026): vpravo, přes celou výšku, minimalizovatelný na
// ouško. Rozhovor drží AsistentContext (nad Routerem); tahle komponenta jen
// kreslí a posílá kontext „kde uživatel je" (cesta + otevřená mapa).

// Paměť asistenta o uživateli — čte se a přepisuje přes /chat/pamet.
// Poznámky k jednomu projektu (paměť projektu): upravit / smazat
function PametProjektu({ p, onUloz }) {
  const { t } = useTranslation('asistent');
  const [text, setText] = useState(p.text || '');
  const [uklada, setUklada] = useState(false);
  const uloz = async (hodnota) => { setUklada(true); try { await onUloz(p.map_id, hodnota); setText(hodnota); } catch { /* text zůstane */ } setUklada(false); };
  return (
    <div className="rounded-lg border border-border p-2 space-y-1.5" data-testid="chat-pamet-projekt">
      <p className="text-xs font-semibold">{p.title}</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[90px] text-xs font-mono" data-testid="chat-pamet-projekt-text" />
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs" disabled={uklada} onClick={() => uloz(text)}>{t('memorySave')}</Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={uklada || !text} onClick={() => uloz('')} data-testid="chat-pamet-projekt-smaz">{t('memoryDelete')}</Button>
      </div>
    </div>
  );
}

function PametPohled({ onZpet }) {
  const { t } = useTranslation('asistent');
  const [text, setText] = useState('');
  const [projekty, setProjekty] = useState([]);
  const [nacteno, setNacteno] = useState(false);
  const [uklada, setUklada] = useState(false);
  useEffect(() => {
    let zivy = true;
    chatPamet().then((r) => { if (zivy) { setText(r.text || ''); setProjekty(r.projekty || []); setNacteno(true); } }).catch(() => { if (zivy) setNacteno(true); });
    return () => { zivy = false; };
  }, []);
  const uloz = async (hodnota) => {
    setUklada(true);
    try { const r = await chatPametUloz(hodnota); setText(r.text || ''); } catch { /* toast není třeba, text zůstane */ }
    setUklada(false);
  };
  const ulozProjekt = async (mapId, hodnota) => {
    await chatPametUloz(hodnota, mapId);
    if (!hodnota) setProjekty((p) => p.filter((x) => x.map_id !== mapId));
  };
  return (
    <div className="flex-1 flex flex-col min-h-0 p-3 gap-2 overflow-y-auto" data-testid="chat-pamet">
      <button type="button" onClick={onZpet} className="self-start inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="w-3.5 h-3.5" />{t('memoryBack')}
      </button>
      <h3 className="text-sm font-semibold">{t('memoryTitle')}</h3>
      <p className="text-xs text-muted-foreground">{t('memoryHint')}</p>
      {nacteno ? (
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t('memoryEmpty')} className="min-h-[120px] text-sm font-mono shrink-0" data-testid="chat-pamet-text" />
      ) : <Loader2 className="w-4 h-4 animate-spin" />}
      <div className="flex gap-2 shrink-0">
        <Button size="sm" disabled={uklada || !nacteno} onClick={() => uloz(text)} data-testid="chat-pamet-uloz">{t('memorySave')}</Button>
        <Button size="sm" variant="outline" disabled={uklada || !nacteno || !text} onClick={() => { setText(''); uloz(''); }} data-testid="chat-pamet-smaz">{t('memoryClear')}</Button>
      </div>
      <h3 className="text-sm font-semibold mt-2">{t('memoryProjects')}</h3>
      {nacteno && projekty.length === 0 && <p className="text-xs text-muted-foreground">{t('memoryProjectsEmpty')}</p>}
      {projekty.map((p) => <PametProjektu key={p.map_id} p={p} onUloz={ulozProjekt} />)}
    </div>
  );
}

// Přepínač modelu v UI byl odstraněn 13. 9. 2026 (Richard: „to budeme dělat my v pozadí,
// teď to zabírá místo"). Model se řídí KB_CHAT_MODEL; routa /chat/modely a `model`
// v požadavku (správce) zůstávají pro měření skripty.

export default function AsistentPanel() {
  const ready = useLazyNs('asistent');
  const { t } = useTranslation('asistent');
  const { user, patchUser } = useAuth();
  const panel = useAsistent();
  const ai = useAiModes();
  const dostupny = ai.has('chat_panel');
  const { setDostupny } = panel;
  useEffect(() => { if (setDostupny) setDostupny(dostupny); }, [dostupny, setDostupny]);
  const rozhovor = useAsistentChat({ open: panel.open && dostupny });
  // jedno „A" pro zbytek komponenty: stav panelu + rozhovor
  const A = useMemo(() => ({ ...panel, ...rozhovor }), [panel, rozhovor]);
  const location = useLocation();
  const [text, setText] = useState('');
  const [pohled, setPohled] = useState('chat'); // chat | pamet | pdf
  // Vložený obrázek (Ctrl+V, přetažení, sponka) — 16. 9. 2026. Zmenšuje se hned při
  // vložení; server ho přepíše a originál zahodí, ve vlákně zůstane náhled a přepis.
  const [obrazek, setObrazek] = useState(null);   // { base64, nahled, nahledMime, url }
  const [obrazekChyba, setObrazekChyba] = useState(false);
  const [pretahuje, setPretahuje] = useState(false);
  const souborRef = useRef(null);
  const obrazekRef = useRef(null);
  obrazekRef.current = obrazek;
  useEffect(() => () => { if (obrazekRef.current) URL.revokeObjectURL(obrazekRef.current.url); }, []);
  const odeberObrazek = useCallback(() => { setObrazekChyba(false); setObrazek((o) => { if (o) URL.revokeObjectURL(o.url); return null; }); }, []);
  const prijmiObrazek = useCallback(async (soubor) => {
    if (!soubor || !String(soubor.type).startsWith('image/')) return;
    try {
      const o = await pripravObrazek(soubor);
      setObrazek((p) => { if (p) URL.revokeObjectURL(p.url); return o; });
      setObrazekChyba(false);
    } catch {
      setObrazekChyba(true);
    }
  }, []);
  // Příloha PDF (18. 9. 2026): text stran jde serveru, SOUBOR zůstává tady — pdfSoubory drží
  // ORIGINÁLNÍ bajty (klíč název + počet stran). Každá další karta aplikuje na originál všechny
  // dřívější potvrzené opravy + nové, takže druhá oprava neztratí první (Richard 19. 9. 2026:
  // „potvrdím další a vrátí to původní“). Seznam dřívějších oprav se bere z ROZHOVORU (server
  // u každé hotové karty drží vysledek_klienta), takže přežije i obnovení stránky — po reloadu
  // stačí vybrat soubor znovu. Geometrie se vždy počítá z originálu a model může dál citovat
  // původní text. Drží se poslední 3 soubory (na telefonu paměť).
  const [pdf, setPdf] = useState(null);         // { name, pages, strany, bytes, stranyBezTextu }
  const [pdfCte, setPdfCte] = useState(false);
  const [pdfSeznam, setPdfSeznam] = useState([]); // soubory v záložce PDF — přežijí přepnutí do chatu
  const pdfSoubory = useRef(new Map());        // klíč → { bytes }
  const klicPdf = (name, pages) => `${name}|${pages || 0}`;
  const najdiPdf = useCallback((name, pages) => pdfSoubory.current.get(klicPdf(name, pages)) || null, []);
  const ulozPdf = useCallback((name, pages, bytes) => {
    const m = pdfSoubory.current;
    const k = klicPdf(name, pages);
    if (m.has(k)) m.delete(k);
    m.set(k, { bytes });
    while (m.size > 3) m.delete(m.keys().next().value);
  }, []);
  // dřívější potvrzené opravy téhož souboru v tomto rozhovoru (karty PŘED tou danou)
  const chatMsgs = A.chat && A.chat.messages;
  const drivejsiOpravy = useCallback((kartaId, name, pages) => {
    const out = [];
    for (const m of chatMsgs || []) {
      for (const k of m.karty || []) {
        if (k.type !== 'akce' || k.klient !== 'pdf_nahrada') continue;
        if (k.id === kartaId) return out;
        if (k.stav !== 'hotovo' || !k.pdf || k.pdf.name !== name || (k.pdf.pages || 0) !== (pages || 0) || !k.vysledek_klienta) continue;
        for (const x of k.vysledek_klienta.provedeno || []) out.push({ page: x.page, find: x.find, replace: x.replace });
      }
    }
    return out;
  }, [chatMsgs]);
  const prijmiPdf = useCallback(async (soubor) => {
    setObrazekChyba(false); setPdfCte(true);
    try {
      const P = await import('@/lib/pdf');
      const priloha = await P.prilohaPdf(soubor);
      ulozPdf(priloha.name, priloha.pages, priloha.bytes);
      setPdf(priloha);
    } catch (e) {
      setObrazekChyba('pdf:' + (e && e.kod ? e.kod : 'poskozeno'));
    } finally { setPdfCte(false); }
  }, [ulozPdf]);
  const jePdf = (f) => !!f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
  // první soubor z přetažení / schránky: obrázek → přepis, PDF → text stran
  const prijmiSoubor = useCallback((soubor) => { if (jePdf(soubor)) prijmiPdf(soubor); else prijmiObrazek(soubor); }, [prijmiPdf, prijmiObrazek]);
  const souborZPrenosu = (dt) => obrazekZeSchranky(dt) || [...((dt && dt.files) || [])].find(jePdf) || null;
  const naOpravit = useCallback((priloha) => { ulozPdf(priloha.name, priloha.pages, priloha.bytes); setPdf(priloha); setObrazekChyba(false); setPohled('chat'); }, [ulozPdf]);
  const konec = useRef(null);
  const vstup = useRef(null);
  const [mobil, setMobil] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  useEffect(() => {
    const f = () => setMobil(window.innerWidth < 640);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);

  // Nabídka ranní porady (Richard 13. 9. 2026: „ráno otevřu a zeptá se mě"):
  // ukáže se při prvním otevření aplikace v daném dni nebo po víc než 8 h
  // od poslední aktivity, dokud dnes porada neproběhla nebo ji uživatel neodmítl.
  const dnes = new Date().toLocaleDateString('en-CA');
  const [poradaOdmitnuta, setPoradaOdmitnuta] = useState(() => nactiKlic('kb-chat-porada-ne') === dnes);
  const [poradaNabidka] = useState(() => {
    const posledni = Number(nactiKlic('kb-chat-aktivita')) || 0;
    const ted = Date.now();
    ulozKlic('kb-chat-aktivita', String(ted));
    // nabídka, jednou vzniklá, drží celý den (i přes reload), dokud ji uživatel nevyřídí
    if (nactiKlic('kb-chat-porada-den') === dnes) return true;
    const nova = !posledni || new Date(posledni).toLocaleDateString('en-CA') !== dnes || ted - posledni > 8 * 3600 * 1000;
    if (nova) ulozKlic('kb-chat-porada-den', dnes);
    return nova;
  });
  const poradaDnes = (A.seznam || []).some((c) => c.mode === 'porada' && String(c.updated || '').slice(0, 10) === dnes);
  const nabidnoutPoradu = dostupny && poradaNabidka && !poradaOdmitnuta && !poradaDnes;
  const odmitniPoradu = () => { ulozKlic('kb-chat-porada-ne', dnes); setPoradaOdmitnuta(true); };

  // kontext pro server: cesta + otevřená mapa (/map/:id) — „kde uživatel je"
  // + vybraný uzel z editoru (panel.uzel), jen když patří k otevřené mapě; server z toho
  // složí hranatou závorku u zprávy uživatele (ne do systémové zprávy — cache prefixu promptu)
  const kontext = useMemo(() => {
    const m = location.pathname.match(/^\/map\/([^/]+)/);
    const mapId = m ? m[1] : undefined;
    const uzel = panel.uzel && mapId && panel.uzel.map_id === mapId ? panel.uzel.node_id : undefined;
    return { route: location.pathname, map_id: mapId, node_id: uzel };
  }, [location.pathname, panel.uzel]);

  const zpravy = (A.chat && A.chat.messages) || [];
  // mapy pro „Uložit do projektu" u konceptu — jednou po otevření panelu
  const [mapy, setMapy] = useState([]);
  useEffect(() => {
    if (!panel.open || !dostupny || mapy.length) return;
    base44.entities.GoalMap.list('-updated_date', 50).then((rows) => setMapy((rows || []).filter((m) => m.kind !== 'org').map((m) => ({ id: m.id, title: m.title })))).catch(() => {});
  }, [panel.open, dostupny, mapy.length]);
  const vychoziMapa = kontext.map_id || (A.chat && A.chat.target && A.chat.target.map_id) || '';
  const ulozKoncept = useCallback((payload) => chatKonceptUloz(payload), []);
  // Posun: při odeslání dolů (vlastní zpráva + „přemýšlím"), po odpovědi na
  // ZAČÁTEK odpovědi — dlouhá odpověď jinak skočí na konec a člověk musí jet
  // nahoru, aby viděl, jak začíná (Richard 13. 9., z telefonu).
  const zacatekOdpovedi = useRef(null);
  const posledniUser = zpravy.map((m) => m.role).lastIndexOf('user');
  const prvniOdpovedIdx = zpravy.findIndex((m, i) => i > posledniUser && m.role === 'assistant' && (m.content || (m.karty || []).length));
  useEffect(() => {
    if (!A.open) return;
    if (A.loading) { if (konec.current) konec.current.scrollIntoView({ block: 'end' }); return; }
    if (zacatekOdpovedi.current) zacatekOdpovedi.current.scrollIntoView({ block: 'start' });
    else if (konec.current) konec.current.scrollIntoView({ block: 'end' });
  }, [zpravy.length, A.loading, A.open]);
  // fokus do políčka: na počítači vždy; na telefonu jen když panel otevřelo
  // klepnutí do lišty dole (jinak by vyskakovala klávesnice při každém otevření)
  const zListy = useRef(false);
  useEffect(() => {
    if (!A.open || pohled !== 'chat' || !vstup.current) return;
    if (!mobil || zListy.current) { vstup.current.focus(); zListy.current = false; }
  }, [A.open, pohled, mobil]);
  // zmenšení z panelu do lišty (tlačítko u políčka): fokus přejde do políčka lišty,
  // ať klávesnice zůstane a rozepsaný text taky (sdílený stav `text`)
  const vstupListy = useRef(null);
  const doListy = useRef(false);
  useEffect(() => {
    if (A.open || !mobil || !doListy.current || !vstupListy.current) return;
    vstupListy.current.focus();
    doListy.current = false;
  }, [A.open, mobil]);
  const zmensit = useCallback(() => { doListy.current = true; A.setOpen(false); }, [A]);

  const persistSkin = useCallback((fields) => {
    if (!user?.id) return;
    base44.entities.User.update(user.id, fields).catch(() => {});
    patchUser(fields);
  }, [user, patchUser]);
  // txt = čip/volba (posílá se sám, bez obrázku); bez argumentu = políčko + vložený obrázek
  const odesli = useCallback(async (txt) => {
    const zPolicka = txt === undefined;
    const v = String(zPolicka ? text : txt).trim();
    const obr = zPolicka ? obrazek : null;
    const prilohaPdf = zPolicka ? pdf : null;
    if (!v && !obr && !prilohaPdf) return;
    if (zPolicka) { setText(''); setObrazek(null); setPdf(null); }
    const vysl = await A.send(v, kontext, patchUser, obr || undefined, prilohaPdf || undefined);
    if (!obr && !prilohaPdf) return;
    // server zprávu nezpracoval (přepis selhal, vadný obrázek, brzda) → příloha i text zpátky do políčka
    if (vysl && vysl.vratit) {
      if (obr) setObrazek((p) => { if (p) { URL.revokeObjectURL(obr.url); return p; } return obr; });
      if (prilohaPdf) setPdf((p) => p || prilohaPdf);
      setText((p) => p || v);
    } else if (obr) URL.revokeObjectURL(obr.url);
  }, [A, text, obrazek, pdf, kontext, patchUser]);
  const potvrd = useCallback((id, ok, vysledek) => A.potvrd(id, ok, kontext, patchUser, vysledek), [A, kontext, patchUser]);
  // na telefonu panel kryje celou obrazovku → po „Ukázat v mapě" ho schovat (Richard 13. 9.)
  const poOdkazu = useCallback(() => { if (mobil) A.setOpen(false); }, [mobil, A]);
  // Toasty (vpravo dole) zakrývaly políčko chatu, dokud nezmizely — např. „mapa sloučena“
  // hned po potvrzené akci asistenta (klik-test 14. 9. 2026: psaní šlo do toastu). Otevřený
  // panel na desktopu posune výřez toastů vlevo o svou šířku (CSS proměnná čtená v toast.jsx).
  useEffect(() => {
    const el = document.documentElement;
    if (panel.open && !mobil) el.style.setProperty('--kb-toast-right', `${panel.width}px`); else el.style.removeProperty('--kb-toast-right');
    return () => el.style.removeProperty('--kb-toast-right');
  }, [panel.open, panel.width, mobil]);
  const vratSkin = useCallback((predchozi) => {
    const id = predchozi || DEFAULT_SKIN_ID;
    const s = getBuiltinSkin(id);
    if (s) { setSkin(s); persistSkin({ skin_id: id }); }
  }, [persistSkin]);

  // tažení za levou hranu = šířka (bez knihovny; primitiv resizable v ui/ není)
  const tah = useRef(null);
  const naTah = useCallback((e) => {
    e.preventDefault();
    tah.current = { x: e.clientX, w: A.width };
    const move = (ev) => { if (tah.current) A.setWidth(tah.current.w + (tah.current.x - ev.clientX)); };
    const up = () => { tah.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [A]);

  if (!ready || !dostupny) return null;

  if (!A.open && mobil) {
    // telefon: minimalizovaný chat = lišta dole (poslední věta asistenta + políčko),
    // mapa je vidět. Z lišty jde psát i odeslat bez otevření (Richard 13. 9.: „zmenšit,
    // co je nade mnou, mít rozhled a pořád psát"); odpověď se ukáže v liště, karty
    // (otázky, akce k potvrzení) se hlásí tečkou — klepnutí na řádek panel otevře.
    const posledniA = [...zpravy].reverse().find((m) => m.role === 'assistant' && m.content);
    const posledniTah = zpravy.slice(zpravy.map((m) => m.role).lastIndexOf('user') + 1);
    const cekaKarta = posledniTah.some((m) => (m.karty || []).some((k) => k.type === 'otazky' || (k.type === 'akce' && k.stav === 'ceka')));
    return (
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-card shadow-lg" data-testid="chat-bar">
        <button type="button" onClick={() => A.setOpen(true)} className="w-full px-3 pt-1.5 text-left text-xs text-muted-foreground inline-flex items-center gap-1.5" data-testid="chat-bar-otevrit">
          {A.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" /> : <Bot className="w-3.5 h-3.5 text-primary shrink-0" />}
          <span className="truncate" data-testid="chat-bar-text">{A.loading ? t('thinking') : nabidnoutPoradu ? t('poradaOffer') : (posledniA ? posledniA.content.replace(/\s+/g, ' ').slice(0, 120) : t('emptyTitle'))}</span>
          {(nabidnoutPoradu || cekaKarta) && <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" data-testid={cekaKarta ? 'chat-bar-karta' : 'chat-tab-porada'} />}
        </button>
        <form className="p-2 pt-1 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); odesli(); }}>
          <input
            ref={vstupListy}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('placeholder')}
            className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
            data-testid="chat-bar-input"
          />
          <Button type="button" size="icon" variant="outline" className="h-9 w-9" title={t('expand')} aria-label={t('expand')} onClick={() => { zListy.current = true; A.setOpen(true); }} data-testid="chat-bar-rozbalit"><ChevronUp className="w-4 h-4" /></Button>
          <Button type="submit" size="icon" className="h-9 w-9" disabled={A.loading || !text.trim()} aria-label={t('send')} data-testid="chat-bar-send"><Send className="w-4 h-4" /></Button>
        </form>
      </div>
    );
  }

  if (!A.open) {
    return (
      <button
        type="button"
        onClick={() => A.setOpen(true)}
        title={nabidnoutPoradu ? t('poradaOffer') : t('toggle')}
        aria-label={t('toggle')}
        data-testid="chat-tab"
        className="fixed right-0 top-24 z-30 flex items-center gap-1.5 rounded-l-lg border border-r-0 bg-card px-2 py-2.5 shadow-md hover:bg-secondary transition-all"
      >
        <Bot className="w-4 h-4 text-primary" />
        <span className="hidden sm:inline text-xs font-medium">{nabidnoutPoradu ? t('poradaTab') : t('tab')}</span>
        {nabidnoutPoradu && <span className="w-2 h-2 rounded-full bg-primary animate-pulse" data-testid="chat-tab-porada" />}
      </button>
    );
  }

  // poslední VIDITELNÁ zpráva (zprávy nástrojů se nekreslí): když model skončí textem
  // a zároveň suggest_next, leží za odpovědí ještě výsledek nástroje a čipy by byly zašedlé
  let posledniIdx = zpravy.length - 1;
  while (posledniIdx > 0 && zpravy[posledniIdx].role === 'tool') posledniIdx--;
  const chyba = A.error ? (A.error === 'rate' ? t('errorRate') : A.error === 'timeout' ? t('errorTimeout') : A.error === 'lost' ? t('errorLost') : A.error === 'generic' ? t('errorGeneric') : A.error) : null;
  const chips = t('chips', { returnObjects: true });

  return (
    <aside
      className="fixed right-0 top-0 bottom-0 z-40 flex flex-col bg-card border-l shadow-xl w-full sm:w-auto"
      style={mobil ? undefined : { width: A.width, minWidth: MIN_W, maxWidth: MAX_W }}
      data-testid="chat-panel"
      aria-label={t('title')}
    >
      {!mobil && (
        <div
          onPointerDown={naTah}
          title={t('resize')}
          data-testid="chat-resize"
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30"
        />
      )}
      <div className="h-12 border-b flex items-center justify-between px-3 gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-semibold truncate">{(A.chat && A.chat.title) || t('title')}</span>
          {/* Nový rozhovor hned u názvu a s popiskem — mezi samotnými ikonami vpravo se hledal (Richard 17. 9. 2026) */}
          <Button variant="outline" size="sm" className="h-8 px-2 gap-1 shrink-0" title={t('newChat')} onClick={() => { setPohled('chat'); A.novy(); }} data-testid="chat-novy"><Plus className="w-4 h-4" />{t('newChatShort')}</Button>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" title={t('history')} data-testid="chat-historie"><History className="w-4 h-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>{t('history')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {A.seznam.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('historyEmpty')}</div>}
              {A.seznam.map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => { setPohled('chat'); A.otevriChat(c.id); }} className="flex items-center justify-between gap-2">
                  <span className="truncate">{c.mode === 'porada' ? '☀ ' : c.mode === 'rozbor' ? '⚒ ' : ''}{c.title || t('newChat')}</span>
                  <button type="button" className="text-muted-foreground hover:text-destructive" title={t('delete')} onClick={(e) => { e.stopPropagation(); e.preventDefault(); A.smaz(c.id); }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* PDF mezi historií a pamětí (Richard 19. 9. 2026) */}
          <Button variant={pohled === 'pdf' ? 'default' : 'ghost'} size="icon" className="h-8 w-8" title={t('pdf.tab')} aria-label={t('pdf.tab')} onClick={() => setPohled((p) => (p === 'pdf' ? 'chat' : 'pdf'))} data-testid="chat-pdf-btn"><FileText className="w-4 h-4" /></Button>
          <Button variant={pohled === 'pamet' ? 'default' : 'ghost'} size="icon" className="h-8 w-8" title={t('memory')} onClick={() => setPohled((p) => (p === 'pamet' ? 'chat' : 'pamet'))} data-testid="chat-pamet-btn"><Brain className="w-4 h-4" /></Button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          {/* minimalizace, ne zavření — rozhovor zůstává (křížek sváděl k „zavírám úplně", Richard 13. 9.) */}
          <Button variant="ghost" size="icon" className="h-8 w-8" title={t('close')} aria-label={t('close')} onClick={() => A.setOpen(false)} data-testid="chat-zavrit">{mobil ? <ChevronDown className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}</Button>
        </div>
      </div>

      {pohled === 'pamet' ? <PametPohled onZpet={() => setPohled('chat')} /> : pohled === 'pdf' ? <PdfPohled onZpet={() => setPohled('chat')} onOpravit={naOpravit} loading={A.loading} soubory={pdfSeznam} setSoubory={setPdfSeznam} /> : (
        <>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2" data-testid="chat-zpravy">
            {nabidnoutPoradu && !A.loading && (
              <div className="rounded-lg border border-primary/50 bg-background/70 p-3 text-sm" data-testid="chat-porada-nabidka">
                <p className="inline-flex items-center gap-1.5 font-medium"><Sunrise className="w-4 h-4 text-primary" />{t('poradaOffer')}</p>
                <p className="text-xs text-muted-foreground mt-1">{t('poradaOfferHint')}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => { odmitniPoradu(); setPohled('chat'); A.zacniRezim('porada', {}, kontext, patchUser); }} data-testid="chat-porada-ano">{t('poradaYes')}</Button>
                  <Button size="sm" variant="outline" onClick={odmitniPoradu} data-testid="chat-porada-ne">{t('poradaNo')}</Button>
                </div>
              </div>
            )}
            {zpravy.length === 0 && (
              <div className="pt-6 text-center space-y-3">
                <Bot className="w-8 h-8 mx-auto text-primary/70" />
                <p className="text-sm font-medium">{t('emptyTitle')}</p>
                <p className="text-xs text-muted-foreground px-4">{t('emptyHint')}</p>
              </div>
            )}
            {zpravy.map((z, i) => (
              <div key={i} ref={i === prvniOdpovedIdx ? zacatekOdpovedi : undefined} className={i === prvniOdpovedIdx ? 'scroll-mt-2' : undefined}>
                <AsistentZprava zprava={z} posledni={i === posledniIdx} loading={A.loading} onSend={odesli} onPotvrd={potvrd} onRevertSkin={vratSkin} mapy={mapy} vychoziMapa={vychoziMapa} onUlozKoncept={ulozKoncept} onOdkaz={poOdkazu} najdiPdf={najdiPdf} ulozPdf={ulozPdf} drivejsiOpravy={drivejsiOpravy} />
              </div>
            ))}
            {A.loading && (
              <div className="flex justify-start" data-testid="chat-thinking">
                <div className="rounded-2xl rounded-bl-md bg-secondary px-3 py-2 text-xs text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />{zpravy.length && zpravy[zpravy.length - 1].docasna && zpravy[zpravy.length - 1].obrazek ? t('imageReading') : zpravy.length && zpravy[zpravy.length - 1].docasna && zpravy[zpravy.length - 1].pdf ? t('pdf.thinking') : t('thinking')}
                </div>
              </div>
            )}
            {chyba && <p className="text-xs text-destructive px-1" data-testid="chat-chyba">{chyba}</p>}
            <div ref={konec} />
          </div>
          {zpravy.length === 0 && Array.isArray(chips) && (
            <div className="px-3 pb-2 flex flex-wrap gap-1.5">
              {/* průvodci: ranní porada, rozbor projektu (na mapě: tenhle projekt), zaseknutí */}
              <button type="button" onClick={() => A.zacniRezim('porada', {}, kontext, patchUser)} disabled={A.loading} className="text-xs rounded-full border border-primary/50 px-2.5 py-1 hover:bg-secondary" data-testid="chat-chip-porada">{t('chipPorada')}</button>
              <button type="button" onClick={() => A.zacniRezim('rozbor', {}, kontext, patchUser)} disabled={A.loading} className="text-xs rounded-full border border-primary/50 px-2.5 py-1 hover:bg-secondary" data-testid="chat-chip-rozbor">{kontext.map_id ? t('chipRozborMapa') : t('chipRozbor')}</button>
              {chips.map((c) => (
                <button key={c} type="button" onClick={() => odesli(c)} disabled={A.loading} className="text-xs rounded-full border px-2.5 py-1 hover:bg-secondary" data-testid="chat-chip">{c}</button>
              ))}
            </div>
          )}
          {(obrazek || obrazekChyba || pdf || pdfCte) && (
            <div className="border-t px-2 pt-2 flex items-center gap-2 shrink-0" data-testid="chat-obrazek-nahled">
              {pdfCte && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" data-testid="chat-pdf-cte"><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('pdf.reading')}</span>}
              {pdf && (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs max-w-[14rem]" data-testid="chat-pdf-priloha">
                    <FileText className="w-3.5 h-3.5 text-primary shrink-0" /><span className="truncate">{pdf.name}</span><span className="text-muted-foreground shrink-0">· {t('pdf.pages', { count: pdf.pages })}</span>
                  </span>
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setPdf(null)} data-testid="chat-pdf-zrus">
                    <X className="w-3.5 h-3.5 mr-1" />{t('pdf.removeAttachment')}
                  </Button>
                </>
              )}
              {obrazek && (
                <>
                  <img src={obrazek.url} alt="" className="h-14 max-w-[8rem] rounded border object-cover" />
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={odeberObrazek} data-testid="chat-obrazek-zrus">
                    <X className="w-3.5 h-3.5 mr-1" />{t('imageRemove')}
                  </Button>
                </>
              )}
              {obrazekChyba && <p className="text-xs text-destructive" data-testid="chat-obrazek-chyba">{t(obrazekChyba === 'jenObrazek' ? 'imageOnly' : obrazekChyba === true ? 'imageError' : `pdf.chyba.${String(obrazekChyba).replace(/^pdf:/, '')}`, { defaultValue: t('pdf.chyba.poskozeno') })}</p>}
            </div>
          )}
          <form
            className={`border-t p-2 flex items-end gap-2 shrink-0 ${pretahuje ? 'ring-2 ring-inset ring-primary bg-primary/5' : ''}`}
            onSubmit={(e) => { e.preventDefault(); odesli(); }}
            onDragOver={(e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setPretahuje(true); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPretahuje(false); }}
            onDrop={(e) => {
              // jakýkoli soubor zachytit — jinak by prohlížeč PDF otevřel místo aplikace a rozhovor zmizel
              if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
              e.preventDefault();
              setPretahuje(false);
              const f = souborZPrenosu(e.dataTransfer);
              if (f) prijmiSoubor(f); else setObrazekChyba('jenObrazek');
            }}
            data-testid="chat-form"
          >
            <Textarea
              ref={vstup}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); odesli(); } }}
              onPaste={(e) => { const f = souborZPrenosu(e.clipboardData); if (f) { e.preventDefault(); prijmiSoubor(f); } }}
              placeholder={pretahuje ? t('imageDrop') : t('placeholder')}
              title={t('imageHint')}
              rows={2}
              className="min-h-[44px] max-h-40 text-sm resize-none"
              data-testid="chat-input"
            />
            <input
              ref={souborRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf,.pdf"
              className="hidden"
              data-testid="chat-obrazek-input"
              onChange={(e) => { prijmiSoubor(e.target.files?.[0]); e.target.value = ''; }}
            />
            <Button type="button" size="icon" variant="ghost" title={`${t('imageAdd')} — ${t('imageHint')}`} aria-label={t('imageAdd')} disabled={A.loading} onClick={() => souborRef.current?.click()} data-testid="chat-obrazek">
              <ImagePlus className="w-4 h-4" />
            </Button>
            {mobil && (
              <Button type="button" size="icon" variant="outline" title={t('shrink')} aria-label={t('shrink')} onClick={zmensit} data-testid="chat-zmensit"><ChevronDown className="w-4 h-4" /></Button>
            )}
            <Button type="submit" size="icon" disabled={A.loading || pdfCte || (!text.trim() && !obrazek && !pdf)} title={t('send')} aria-label={t('send')} data-testid="chat-send">
              {A.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </form>
        </>
      )}
    </aside>
  );
}
