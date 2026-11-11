import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowLeftRight, Bot, ChevronDown, ChevronUp, FileText, Files, Fish, ImagePlus, List, Loader2, PanelLeftClose, PanelRightClose, RefreshCw, Send, Sparkles, SquarePen, Sunrise, Moon, X } from 'lucide-react';
import { nactiKlic, ulozKlic, KEY_PORADA_NE, KEY_PORADA_DEN, KEY_AKTIVITA, KEY_RELAX_AKTIVITA, KEY_START_RELAX } from '@/lib/storageKeys';
import { useRelaxOdpocet, formatOdpocet } from '@/components/relax/useRelaxOdpocet';
import { NAD_PODIL } from '@/components/relax/RelaxVrstva';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/AuthContext';
import { useSpodekHlavicky } from '@/hooks/useSpodekHlavicky';
import { useAsistent, MIN_W, MAX_W, sirkaDokumentu, RELAX_SABLONY } from '@/lib/AsistentContext';
import { useLazyNs } from '@/i18n/lazyNs';
import { useAiModes, stavAsistenta, refreshAiModes } from '@/hooks/useAiEnabled';
import { setSkin, effectiveTheme, hlidejRotaci } from '@/lib/theme';
import { getBuiltinSkin, DEFAULT_SKIN_ID, skinDne, ROTACE_ID } from '@/lib/skins';
import { validateSkin } from '@/lib/skinValidator';
import { base44 } from '@/api/base44Client';
import { pripravObrazek, obrazekZeSchranky } from '@/lib/obrazek';
import { loadKbConfig, useKbConfig } from '@/hooks/useKbConfig';
import { useHlasovka, HlasovkaTlacitko, HlasovkaPruh } from './Hlasovka';
import AsistentZprava from './AsistentZprava';
import AiBlok from './AiBlok';
import DokumentyPanel from './DokumentyPanel';
import ConversationList from './ConversationList';
import { STRANKA, NOVY_DOK } from '@/lib/AsistentContext';
import { strankaNapsat } from '@/api/asistentApi';
import { useAsistentChat } from './useAsistentChat';
import { useToast } from '@/components/ui/use-toast';
import { savedMode } from '@/lib/liteMode';
import { nactiStupen } from '@/lib/citelnost';
import { pb } from '@/api/pb';
import { zacniTah, startMove } from '@/lib/tahSirky';

// AI chat na boku (13. 9. 2026): vpravo, přes celou výšku, minimalizovatelný na
// ouško. Rozhovor drží AsistentContext (nad Routerem); tahle komponenta jen
// kreslí a posílá kontext „kde uživatel je" (cesta + otevřená mapa).
// + klientské předvolby (motiv, zjednodušené zobrazení, čitelnost) žijí jen v prohlížeči → jdou serveru s každým
// požadavkem v `context.klient`, ať je get_settings umí přečíst (server je do promptu nedává — cache prefixu)
const sKlientem = (kontext) => ({ ...kontext, klient: { theme: effectiveTheme(), mode: savedMode() || 'auto', readability: nactiStupen() } });

// Přepínač modelu v UI byl odstraněn 13. 9. 2026 (Richard: „to budeme dělat my v pozadí,
// teď to zabírá místo"). Model se řídí KB_CHAT_MODEL; routa /chat/modely a `model`
// v požadavku (správce) zůstávají pro měření skripty.

// značka režimu v historii rozhovorů
const IKONA_REZIMU = { porada: '☀ ', nocni: '☾ ', rozbor: '⚒ ', trideni: '☰ ', novy_projekt: '✦ ', po_schuzce: '✎ ', revize: '↻ ', priprava: '☷ ', tymova_porada: '⚑ ', kancelar: '▤ ' };
const MAX_TEXT = 8000; // strop zprávy na serveru (chat.js)
// Night-planning frame in an empty conversation (Richard 29.–30. 9. 2026) — hidden since 11 Nov 2026 at his request
const NIGHT_PLANNING_IN_PANEL = false;
const CHYBA_TEXTU = { textDlouhy: 'textTooLong', textPrazdny: 'textEmpty', textChyba: 'textError', zvukVelky: 'voiceTooBig' };

// ---- Relax (Richard 14. 10. 2026) ----
// Slovo „relax“ / „relax 15“ (i čip „🐟 Relax 5 min“) spustí pauzu v PROHLÍŽEČI, bez modelu — 0 tokenů, žádný tah.
const RX_RELAX = /^\s*(?:🐟\s*)?relax(?:\s+(\d{1,3}))?(?:\s*min(?:ut|uty|utes|s)?\.?)?\s*[.!]?\s*$/iu;
// Hlídač pauzy: po ~50 minutách souvislé práce (psaní, kliky; mezera > 10 min = nový blok) nabídne relax,
// nejvýš 1× za hodinu a ne do hodiny po pauze. Stav per účet v localStorage, ať reload nezačíná od nuly.
const HLIDAC_BLOK_MS = 50 * 60000;
const HLIDAC_MEZERA_MS = 10 * 60000;
const HLIDAC_ZNOVU_MS = 60 * 60000;
const HLIDAC_KROK_MS = 30000; // zápis nejvýš jednou za 30 s
const ctiAktivitu = (klic) => { try { return JSON.parse(nactiKlic(klic) || '{}') || {}; } catch { return {}; } };
function useHlidacPauzy(klic, aktivni) {
  const [nabidka, setNabidka] = useState(false);
  useEffect(() => {
    if (!aktivni) return undefined;
    let posledniZapis = 0;
    const f = () => {
      const ted = Date.now();
      if (ted - posledniZapis < HLIDAC_KROK_MS) return;
      posledniZapis = ted;
      const s = ctiAktivitu(klic);
      const start = !s.posledni || ted - s.posledni > HLIDAC_MEZERA_MS ? ted : (s.start || ted);
      const n = { ...s, start, posledni: ted };
      if (ted - start >= HLIDAC_BLOK_MS && ted - (s.nabidnuto || 0) >= HLIDAC_ZNOVU_MS && ted - (s.posledniRelax || 0) >= HLIDAC_ZNOVU_MS) { n.nabidnuto = ted; setNabidka(true); }
      ulozKlic(klic, JSON.stringify(n));
    };
    document.addEventListener('keydown', f, true);
    document.addEventListener('pointerdown', f, true);
    return () => { document.removeEventListener('keydown', f, true); document.removeEventListener('pointerdown', f, true); };
  }, [klic, aktivni]);
  return [nabidka, setNabidka];
}
// Stav pauzy v panelu (relax běží / skončila): v rozložení „vedle“ je to jediné místo s odpočtem u chatu
function RelaxStav({ relax, t, onKonec, onProdluz, onDal }) {
  const sOdpoctem = Number(relax.konecV) > 0;
  const zbyva = useRelaxOdpocet(relax.konecV, sOdpoctem && !relax.hotovo);
  return (
    <div className="mx-3 mb-2 rounded-lg border border-primary/50 bg-background/70 px-2.5 py-1.5 text-xs flex items-center gap-1.5 whitespace-nowrap overflow-x-auto" data-testid="chat-relax-stav" data-hotovo={relax.hotovo ? '1' : '0'}>
      <Fish className="w-4 h-4 text-primary shrink-0" />
      {relax.hotovo ? (
        <>
          <span className="font-medium">{t('relaxHotovo')}</span>
          <Button size="sm" className="h-7" onClick={onKonec} data-testid="chat-relax-pokracuji">{t('relaxPokracuji')}</Button>
          <Button size="sm" variant="outline" className="h-7" onClick={() => onProdluz(5)} data-testid="chat-relax-jeste">{t('relaxJeste')}</Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={onDal} data-testid="chat-relax-dal">{t('relaxDal')}</Button>
        </>
      ) : (
        <>
          {/* jeden řádek (Richard 15. 10.: „zbytečně na dva řádky“): stav · 5 15 30 min · ✕ */}
          <span className="font-medium tabular-nums" data-testid="chat-relax-odpocet" data-odpocet={sOdpoctem ? '1' : '0'}>{sOdpoctem ? t('relaxBezi', { cas: formatOdpocet(zbyva) }) : t('relaxBeziVolne')}</span>
          <span className="h-4 w-px bg-border" aria-hidden="true" />
          {sOdpoctem
            ? <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onProdluz(5)} data-testid="chat-relax-plus5">{t('relaxPlus5')}</Button>
            : (
              <>
                {RELAX_SABLONY.map((m) => <Button key={m} size="sm" variant="ghost" className="h-7 px-1.5 tabular-nums" onClick={() => onProdluz(m)} title={t('relaxSablona', { count: m })} data-testid={`chat-relax-sablona-${m}`}>{m}</Button>)}
                <span className="text-muted-foreground">{t('relaxMin')}</span>
              </>
            )}
          <Button size="icon" variant="outline" className="h-7 w-7 ml-auto shrink-0" onClick={onKonec} title={t('relaxKonec')} aria-label={t('relaxKonec')} data-testid="chat-relax-konec"><X className="w-3.5 h-3.5" /></Button>
        </>
      )}
    </div>
  );
}

// `lite` (4. 10. 2026): panel ve zjednodušeném zobrazení — otevřeno/zavřeno drží vlastní stav
// kontextu (liteOpen; zavřít = host panel odmontuje), kreslí se vždy přes celou obrazovku
// jako na telefonu (rozhodnutí Richarda: lite je produkt pro telefon i v širokém okně) a nemá
// minimalizovanou lištu ani ouško — ty by kolidovaly se spodní navigací a tlačítkem + v lite;
// tlačítko k otevření je v hlavičce lite (LiteApp).
// Text průběhu tahu (5. 10. 2026): ze záznamu ai_chat_prubeh skládá APLIKACE — jméno nástroje přes toolNames,
// název mapy ze serveru. „Přečetl jsem mapu projektu „Dílna“ · Přemýšlím…“. Bez průběhu vrací '' (panel ukáže obecný text).
function textPrubehu(p, t) {
  if (!p || typeof p !== 'object') return '';
  const jmeno = (k) => { const n = k && k.nastroj ? t(`toolNames.${k.nastroj}`, { defaultValue: '' }) : ''; const z = n || t(k && k.kind === 'write' ? 'prubeh.zapis' : 'prubeh.neznamy'); return k && k.nazev ? `${z} „${k.nazev}“` : z; };
  const hotovo = Array.isArray(p.hotovo) ? p.hotovo.filter((k) => k && k.kind !== 'write') : [];
  const posledni = hotovo.length ? hotovo[hotovo.length - 1] : null;
  const casti = [];
  if (posledni) casti.push(t(hotovo.length > 1 ? 'prubeh.precteno' : 'prubeh.precteno1', { co: jmeno(posledni), count: hotovo.length - 1 }));
  if (p.faze === 'nastroj') casti.push(t(p.kind === 'read' ? 'prubeh.ctu' : 'prubeh.provadim', { co: jmeno(p) }));
  else if (p.faze === 'navrh') casti.push(t('prubeh.navrh'));
  else casti.push(t('thinking'));
  return casti.join(' · ');
}

// Pruh pod hlavičkou, když AI asistentovi neodpovídá (19. 10. 2026, Richard: „když nefunguje AI, není vidět celý
// asistent — mohl by být vidět aspoň jako historie a hlásit, že je nefunkční“). Texty schválené náhledem
// 8099/kb-asistent-bez-ai: cloud = výpadek u nás, vlastní instalace = jejich AI neodpovídá / ještě není připojená.
// `blik` (počítadlo) = uživatel zkusil odeslat zprávu, která bez AI neodejde → pruh krátce blikne.
function StavAsistenta({ stav, hosted, spravce, blik, t, onZkusit, onRelax, onNastaveni }) {
  const [blika, setBlika] = useState(false);
  useEffect(() => {
    if (!blik) return undefined;
    setBlika(true);
    const tm = setTimeout(() => setBlika(false), 1200);
    return () => clearTimeout(tm);
  }, [blik]);
  const nepripojeno = stav === 'nepripojeno';
  const druh = nepripojeno ? 'nepripojeno' : hosted ? 'vypadek' : 'vlastniVypadek';
  return (
    <div
      // barvy jen průhledně přes pozadí vzhledu (skin) — pevné světlé pozadí dávalo na tmavých skinech světlý text
      // na světlém (klik-test 19. 10.: výchozí skin je tmavý i bez třídy .dark)
      className={`mx-3 mt-2 rounded-lg border p-3 text-sm shrink-0 bg-background/70 ${nepripojeno ? 'border-primary/50' : 'border-amber-500/70'} ${blika ? 'animate-pulse ring-2 ring-amber-500/70' : ''}`}
      data-testid="chat-stav" data-stav={stav} data-druh={druh} role="status"
    >
      <p className="inline-flex items-center gap-1.5 font-semibold">
        {nepripojeno ? <Sparkles className="w-4 h-4 text-primary shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />}{t(`stav.${druh}Title`)}
      </p>
      <p className="text-xs mt-1 text-muted-foreground">{t(`stav.${druh}Text`)}</p>
      {/* tlačítka podle náhledu: cloud Zkusit znovu + Relax · vlastní AI dole Zkusit znovu + (správce) nastavení ·
          bez AI (správce) Připojit AI + Relax */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {!nepripojeno && <Button size="sm" variant="outline" className="h-7" onClick={onZkusit} data-testid="chat-stav-zkusit"><RefreshCw className="w-3.5 h-3.5 mr-1" />{t('stav.zkusit')}</Button>}
        {nepripojeno && spravce && <Button size="sm" className="h-7" onClick={onNastaveni} data-testid="chat-stav-pripojit">{t('stav.pripojit')}</Button>}
        {druh === 'vlastniVypadek'
          ? (spravce && <Button size="sm" variant="outline" className="h-7" onClick={onNastaveni} data-testid="chat-stav-nastaveni">{t('stav.nastaveni')}</Button>)
          : <Button size="sm" variant="outline" className="h-7" onClick={onRelax} data-testid="chat-stav-relax"><Fish className="w-3.5 h-3.5 mr-1" />{t('stav.relax')}</Button>}
      </div>
      {nepripojeno && !spravce && <p className="text-xs text-muted-foreground mt-2" data-testid="chat-stav-clen">{t('stav.nepripojenoClen')}</p>}
    </div>
  );
}

export default function AsistentPanel({ lite = false }) {
  const ready = useLazyNs('asistent');
  const { t } = useTranslation('asistent');
  const { user, patchUser } = useAuth();
  const ctx = useAsistent();
  const panel = useMemo(() => (lite ? { ...ctx, open: ctx.liteOpen, setOpen: ctx.setLiteOpen } : ctx), [ctx, lite]);
  const ai = useAiModes();
  // dostupny = panel se kreslí (i při výpadku / bez AI: historie, Dokumenty, relax); funkcni = AI odpovídá (19. 10. 2026)
  const stav = stavAsistenta(ai);
  const dostupny = stav !== 'skryto';
  const funkcni = stav === 'funkcni';
  const spravce = user?.role === 'admin';
  const [blik, setBlik] = useState(0);
  // obrázky jen s modelem, který je vidí (server hlásí chat_image, 30. 9. 2026) — jinak sponka bere jen
  // PDF a vložený obrázek dostane místní hlášku místo chyby ze serveru
  const umiObrazek = ai.has('chat_image');
  // hlasovky (1. 10. 2026): jen kde přepis opravdu jde (server hlásí chat_voice)
  const umiHlas = ai.has('chat_voice');
  const [maxHlas, setMaxHlas] = useState(300);
  const [maxHlasMb, setMaxHlasMb] = useState(3);
  useEffect(() => { loadKbConfig().then((c) => { if (c && c.chat_voice_max_s) setMaxHlas(c.chat_voice_max_s); if (c && c.chat_voice_max_mb) setMaxHlasMb(c.chat_voice_max_mb); }).catch(() => {}); }, []);
  const { setDostupny, setFunkcni } = panel;
  useEffect(() => { if (setDostupny) setDostupny(dostupny); }, [dostupny, setDostupny]);
  useEffect(() => { if (setFunkcni) setFunkcni(funkcni); }, [funkcni, setFunkcni]);
  const navigate = useNavigate();
  const { toast } = useToast();
  const rozhovor = useAsistentChat({ open: panel.open && dostupny, klient: { navigate, spustRelax: ctx.spustRelax } });
  // jedno „A" pro zbytek komponenty: stav panelu + rozhovor
  const A = useMemo(() => ({ ...panel, ...rozhovor }), [panel, rozhovor]);
  const location = useLocation();
  const [text, setText] = useState('');
  const [pohled, setPohled] = useState('chat'); // chat | rozhovory (conversation list, 10 Nov 2026); paměť je od 1. 10. 2026 v Dokumentech
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
    if (!umiObrazek) { setObrazekChyba('bezObrazku'); return; }
    try {
      const o = await pripravObrazek(soubor);
      setObrazek((p) => { if (p) URL.revokeObjectURL(p.url); return o; });
      setObrazekChyba(false);
    } catch {
      setObrazekChyba(true);
    }
  }, [umiObrazek]);
  // Příloha PDF (18. 9. 2026): text stran jde serveru, SOUBOR zůstává tady — pdfSoubory drží
  // ORIGINÁLNÍ bajty (klíč název + počet stran). Každá další karta aplikuje na originál všechny
  // dřívější potvrzené opravy + nové, takže druhá oprava neztratí první (Richard 19. 9. 2026:
  // „potvrdím další a vrátí to původní“). Seznam dřívějších oprav se bere z ROZHOVORU (server
  // u každé hotové karty drží vysledek_klienta), takže přežije i obnovení stránky — po reloadu
  // stačí vybrat soubor znovu. Geometrie se vždy počítá z originálu a model může dál citovat
  // původní text. Drží se poslední 3 soubory (na telefonu paměť).
  const [pdf, setPdf] = useState(null);         // { name, pages, strany, bytes, stranyBezTextu }
  const [pdfCte, setPdfCte] = useState(false);
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
  // textový soubor (.txt/.md) → obsah do políčka (podklady pro Nový projekt s AI, poznámky k roztřídění)
  const jeText = (f) => !!f && (f.type === 'text/plain' || f.type === 'text/markdown' || /\.(txt|md|markdown)$/i.test(f.name || ''));
  // zvukový soubor (hlasovka z WhatsAppu .opus, diktafon .m4a…) — druh pozná server podle obsahu
  const jeZvuk = (f) => !!f && (String(f.type).startsWith('audio/') || /\.(opus|ogg|oga|m4a|mp3|wav|webm)$/i.test(f.name || ''));
  const hlasRef = useRef(null);
  // první soubor z přetažení / schránky: obrázek → přepis, PDF → text stran, zvuk → hlasovka (odejde hned)
  const prijmiText = useCallback(async (soubor) => {
    setObrazekChyba(false);
    try {
      const obsah = String(await soubor.text()).replace(/\r\n?/g, '\n').trim();
      if (!obsah) { setObrazekChyba('textPrazdny'); return; }
      const spojeno = (text.trim() ? `${text.trim()}\n\n` : '') + obsah;
      if (spojeno.length > MAX_TEXT) setObrazekChyba('textDlouhy');
      setText(spojeno.slice(0, MAX_TEXT));
      if (vstup.current) vstup.current.focus();
    } catch { setObrazekChyba('textChyba'); }
  }, [text]);
  const prijmiSoubor = useCallback((soubor) => {
    if (!soubor) return;
    if (jeText(soubor)) prijmiText(soubor);
    // bez AI se přílohy (PDF, obrázek, nahrávka) nepřipojují — neodešly by; text do políčka jde dál
    else if (!funkcni) setBlik((n) => n + 1);
    else if (jePdf(soubor)) prijmiPdf(soubor);
    else if (jeZvuk(soubor)) {
      if (!(umiHlas && hlasRef.current)) setObrazekChyba('jenObrazek');
      // moc velkou nahrávku říct hned tady — server by ji odmítl holým 413 dřív, než by došlo na srozumitelnou hlášku
      else if (soubor.size > maxHlasMb * 1024 * 1024) setObrazekChyba('zvukVelky');
      else { setObrazekChyba(false); hlasRef.current.posliSoubor(soubor); }
    }
    else prijmiObrazek(soubor);
  }, [prijmiText, prijmiPdf, prijmiObrazek, umiHlas, maxHlasMb, funkcni]);
  const souborZPrenosu = (dt) => obrazekZeSchranky(dt) || [...((dt && dt.files) || [])].find((f) => jePdf(f) || jeZvuk(f) || jeText(f)) || null;
  const naOpravit = useCallback((priloha) => { ulozPdf(priloha.name, priloha.pages, priloha.bytes); setPdf(priloha); setObrazekChyba(false); setPohled('chat'); }, [ulozPdf]);
  const konec = useRef(null);
  const vstup = useRef(null);
  const [uzkeOkno, setUzkeOkno] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  useEffect(() => {
    const f = () => setUzkeOkno(window.innerWidth < 640);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  // lite = telefonní rozvržení vždy (sloupec max-w-xl se neodsouvá, Dokumenty nemají hlavičku plné appky)
  const mobil = lite || uzkeOkno;
  // panel začíná pod ukotvenou horní lištou (Richard 27. 10. 2026) — i na telefonu v plné aplikaci; lite lištu nemá → 0
  const spodek = useSpodekHlavicky(!lite);
  // Side (10 Nov 2026): on a phone / in lite the panel covers the full width, so the side only applies on a wide window
  const vlevo = !mobil && panel.side === 'left';
  // header drag → drop target shown while dragging ('left' | 'right' | null)
  const [moveTarget, setMoveTarget] = useState(null);

  // Nabídka ranní porady (Richard 13. 9. 2026: „ráno otevřu a zeptá se mě"):
  // ukáže se při prvním otevření aplikace v daném dni nebo po víc než 8 h
  // od poslední aktivity, dokud dnes porada neproběhla nebo ji uživatel neodmítl.
  // Klíče jsou vázané na účet (sufix id uživatele, analýza kódu 2 F4-06): u sdíleného
  // počítače by odmítnutí / aktivita jednoho člověka potlačila nabídku druhému. Staré
  // klíče bez sufixu se nemigrují; při odhlášení se `kb-chat-*` mažou (lib/storageKeys).
  const dnes = new Date().toLocaleDateString('en-CA');
  const klicUctu = (k) => `${k}:${user?.id || ''}`;
  const [poradaOdmitnuta, setPoradaOdmitnuta] = useState(() => nactiKlic(klicUctu(KEY_PORADA_NE)) === dnes);
  const [poradaNabidka] = useState(() => {
    const posledni = Number(nactiKlic(klicUctu(KEY_AKTIVITA))) || 0;
    const ted = Date.now();
    ulozKlic(klicUctu(KEY_AKTIVITA), String(ted));
    // nabídka, jednou vzniklá, drží celý den (i přes reload), dokud ji uživatel nevyřídí
    if (nactiKlic(klicUctu(KEY_PORADA_DEN)) === dnes) return true;
    const nova = !posledni || new Date(posledni).toLocaleDateString('en-CA') !== dnes || ted - posledni > 8 * 3600 * 1000;
    if (nova) ulozKlic(klicUctu(KEY_PORADA_DEN), dnes);
    return nova;
  });
  const poradaDnes = (A.seznam || []).some((c) => c.mode === 'porada' && String(c.updated || '').slice(0, 10) === dnes);
  const nabidnoutPoradu = funkcni && poradaNabidka && !poradaOdmitnuta && !poradaDnes;
  const odmitniPoradu = () => { ulozKlic(klicUctu(KEY_PORADA_NE), dnes); setPoradaOdmitnuta(true); };
  // Relax: hlídač 50 minut práce (nabídka v panelu + tečka na oušku) a jednotné spuštění (zapíše čas pauzy pro hlídač)
  const klicRelax = `${KEY_RELAX_AKTIVITA}:${user?.id || ''}`;
  const [relaxNabidka, setRelaxNabidka] = useHlidacPauzy(klicRelax, dostupny && !panel.relax);
  // čas pauzy pro hlídač zapisuje AsistentContext.spustRelax (i pro relax od modelu); obal jen schová nabídku
  const spustRelax = useCallback((o) => { setRelaxNabidka(false); panel.spustRelax(o || {}); }, [setRelaxNabidka, panel]);
  const odmitniRelax = () => setRelaxNabidka(false); // `nabidnuto` už je zapsané → příště nejdřív za hodinu
  // Start aplikace (Richard 25. 10. 2026: „po spuštění aplikace jako default akvárko a asistent otevřený“; nahrazuje ranní
  // akvárium z 15. 10.): jednou za kartu prohlížeče (sessionStorage — po zavření akvárka ho F5 nevrátí, nová karta ano)
  // otevře panel a spustí akvárium vedle chatu bez odpočtu. Jen plná aplikace na širokém okně, ne když relax běží;
  // config.start_relax (KB_START_RELAX=0) to vypne.
  const { config: kbConfig } = useKbConfig();
  const startRef = useRef(false);
  useEffect(() => {
    if (startRef.current || lite || !ready || !dostupny || mobil || !kbConfig || kbConfig.start_relax === false) return;
    startRef.current = true;
    // relax už běží (stav v localStorage je společný pro karty) = start je vyřízený; jinak by se po zavření hned znovu otevřel (/checkup 25. 10.)
    let uz = false; try { uz = sessionStorage.getItem(KEY_START_RELAX) === '1'; } catch { uz = false; }
    if (uz || panel.relax) { try { sessionStorage.setItem(KEY_START_RELAX, '1'); } catch { /* nic */ } return; }
    try { sessionStorage.setItem(KEY_START_RELAX, '1'); } catch { /* bez úložiště jen tentokrát */ }
    if (!A.open) A.setOpen(true);
    spustRelax({ scena: 'akvarium', minut: 0, rozlozeni: 'vedle' });
    // závislosti záměrně jen stráže: běží nejvýš jednou (startRef)
  }, [lite, ready, dostupny, mobil, panel.relax, kbConfig]);

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
  // closed panel: a dot when the assistant finished a turn while it was closed (e.g. a presentation being made — Richard
  // 11 Nov 2026: "a dot when it wants to say something or finishes … and I closed it while it was working")
  const [unread, setUnread] = useState(false);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (A.loading) { wasRunning.current = true; return; }
    if (wasRunning.current) { wasRunning.current = false; if (!A.open) setUnread(true); }
  }, [A.loading, A.open]);
  useEffect(() => { if (A.open) setUnread(false); }, [A.open]);
  const posledniTah = zpravy.slice(zpravy.map((m) => m.role).lastIndexOf('user') + 1);
  const cekaKarta = posledniTah.some((m) => (m.karty || []).some((k) => k.type === 'otazky' || (k.type === 'akce' && k.stav === 'ceka')));
  // desktop: the robot sits in the left rail's top slot ALWAYS (also with the assistant on the right — Richard 11 Nov 2026,
  // approved option "robot stays on the left"); the rails move one slot down for it
  const robotLeft = !!ready && !!dostupny && !mobil && stav !== 'nepripojeno';
  const { setLeftTabShown } = panel;
  useEffect(() => { setLeftTabShown(robotLeft); return () => setLeftTabShown(false); }, [robotLeft, setLeftTabShown]);
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
  // (Richard 15. 10.: telefon na ležato je širší než 640 px = „počítač“, a fokus pak vyvolal klávesnici — dotyková
  // zařízení (pointer: coarse) se berou jako telefon bez ohledu na šířku)
  useEffect(() => {
    if (!A.open || pohled !== 'chat' || !vstup.current) return;
    let dotyk = false; try { dotyk = window.matchMedia('(pointer: coarse)').matches; } catch { dotyk = false; }
    if ((!mobil && !dotyk) || zListy.current) { vstup.current.focus(); zListy.current = false; }
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
  // zavření/zmenšení chatu zavře i Dokumenty → přes hlídač neuložených změn (checkup 1. 10.)
  const zavriChat = useCallback(() => A.opatrne(() => A.setOpen(false)), [A]);
  // fokus do lišty jen když uživatel v políčku právě psal (klávesnice byla otevřená) — jinak zmenšení samo otevíralo
  // klávesnici (Richard 15. 10. 2026, z telefonu při relaxu)
  // (klepnutí na tlačítko políčku sebere fokus těsně PŘED onClick → bere se i blur z posledních 800 ms)
  const psalDo = useRef(0);
  const zmensit = useCallback(() => A.opatrne(() => {
    const vPolicku = typeof document !== 'undefined' && !!vstup.current && document.activeElement === vstup.current;
    doListy.current = vPolicku || Date.now() - psalDo.current < 800;
    A.setOpen(false);
  }), [A]);

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
    // „relax“ / „relax 15“ / čip: pauza v prohlížeči bez modelu (jde i během odpovědi — model k tomu není potřeba)
    const rel = !obr && !prilohaPdf && v.match(RX_RELAX);
    if (rel) { if (zPolicka) setText(''); spustRelax({ minut: rel[1] ? Number(rel[1]) : 0 }); return; }
    // bez AI zpráva neodejde: text zůstane v políčku a pruh stavu blikne
    // (z lišty na telefonu se panel rozbalí, ať je pruh vidět)
    if (!funkcni) { setBlik((n) => n + 1); if (!A.open) A.setOpen(true); return; }
    // Enter během odpovědi / čtení PDF: A.send by zprávu odmítl (loading) — políčko ani
    // přílohu NEmazat, jinak rozepsaný text tiše zmizí (analýza kódu 2, F3-01)
    if (A.loading || pdfCte) return;
    if (zPolicka) { setText(''); setObrazek(null); setPdf(null); }
    const vysl = await A.send(v, sKlientem(kontext), patchUser, obr || undefined, prilohaPdf || undefined);
    if (!obr && !prilohaPdf) return;
    // server zprávu nezpracoval (přepis selhal, vadný obrázek, brzda) → příloha i text zpátky do políčka
    if (vysl && vysl.vratit) {
      if (obr) setObrazek((p) => { if (p) { URL.revokeObjectURL(obr.url); return p; } return obr; });
      if (prilohaPdf) setPdf((p) => p || prilohaPdf);
      setText((p) => p || v);
    } else if (obr) URL.revokeObjectURL(obr.url);
  }, [A, text, obrazek, pdf, pdfCte, kontext, patchUser, spustRelax, funkcni]);
  // hlasovka odejde hned (rozhodnutí 30. 9.); když ji server nezpracuje (přepis selhal), zůstane v pruhu k opakování
  const odesliHlas = useCallback(async (h) => {
    // nahrávka rozpracovaná před výpadkem zůstane v pruhu k opakování
    if (!funkcni) { setBlik((n) => n + 1); return { ok: false, vratit: true }; }
    return A.loading ? { ok: false, vratit: true } : A.send('', sKlientem(kontext), patchUser, undefined, undefined, h);
  }, [A, kontext, patchUser, funkcni]);
  const hlas = useHlasovka({ maxS: maxHlas, maxMb: maxHlasMb, onOdeslat: odesliHlas });
  hlasRef.current = hlas;
  // Pruh nahrávání (● 0:42 · Zrušit · Odeslat) je vidět jen v otevřeném chatu a na telefonu ve spodní liště.
  // Zavřený panel na počítači nebo pohled PDF ho nekreslí → nahrávání se zastaví a nahrávka počká v pruhu
  // „Neodesláno“ (mikrofon nesmí běžet naslepo a hlasovka sama odejít).
  // (a když panel není vůbec — AI právě není dostupná —, nekreslí se nic: taky zastavit)
  const pruhVidet = ready && dostupny && (A.open ? pohled === 'chat' : mobil);
  const podrzHlas = hlas.podrz;
  useEffect(() => { if (!pruhVidet) podrzHlas(); }, [pruhVidet, podrzHlas]);
  const potvrd = useCallback((id, ok, vysledek) => A.potvrd(id, ok, sKlientem(kontext), patchUser, vysledek), [A, kontext, patchUser]);
  // oprava přepisu poslední hlasovky / fotky (tužka v bublině): server zahodí nepotvrzené návrhy a asistent odpoví znovu
  const opravPrepis = useCallback((txt) => A.oprav(txt, sKlientem(kontext), patchUser), [A, kontext, patchUser]);
  // výchozí skin instance (nástroj set_instance_skin, kind client): JSON vestavěných skinů má jen prohlížeč — po Ano
  // uloží přes tutéž routu jako Správa organizace a serveru pošle výsledek, ať model dopoví pravdu
  const potvrdKlientaSkin = useCallback(async (karta) => {
    const id = String((karta.args && karta.args.builtin_id) || '');
    let vysledek;
    try {
      const skin = id ? getBuiltinSkin(id) : null;
      if (id && !skin) vysledek = { ok: false, chyba: 'unknown skin' };
      else { await pb.send('/api/kb/instance-skin', { method: 'POST', body: { skin, builtin_id: id } }); vysledek = { ok: true, builtin_id: id }; }
    } catch (e) { vysledek = { ok: false, chyba: (e && e.response && e.response.error) || (e && e.message) || 'save failed' }; }
    return potvrd(karta.id, true, vysledek);
  }, [potvrd]);
  // Vrátit u karty nastavení (logika v hooku): když se zápis na účet nepovede, řekneme to — jinak by prohlížeč byl
  // vrácený a účet ne, beze slova (panel 4. 10. 2026)
  const vratNastaveni = useCallback(async (karta) => {
    const ok = await A.vratNastaveni(karta, patchUser, user?.id);
    if (!ok) toast({ title: t('nastaveni.revertFailed'), variant: 'destructive' });
  }, [A, patchUser, user, toast, t]);
  // na telefonu panel kryje celou obrazovku → po „Ukázat v mapě" ho schovat (Richard 13. 9.)
  // odkaz z karty (Ukázat v mapě, Otevřít projekt, kalendář) ukončí relax — jinak by akvárium „vedle“ cílovou stránku
  // zakrylo a klik vypadal, že nic nedělá (klik-test 19. 10., stejně jako Připojit AI); zamčený relax se nechává
  const poOdkazu = useCallback(() => {
    if (panel.relax && !panel.relax.zamek) panel.ukonciRelax();
    if (mobil) zavriChat();
  }, [mobil, zavriChat, panel]);
  // Toasty (vpravo dole) zakrývaly políčko chatu, dokud nezmizely — např. „mapa sloučena“
  // hned po potvrzené akci asistenta (klik-test 14. 9. 2026: psaní šlo do toastu). Otevřený
  // panel na desktopu posune výřez toastů vlevo o svou šířku (CSS proměnná čtená v toast.jsx).
  // Telefon: toasty jsou NAHOŘE a ležely přes hlavičku panelu (robot, Nový, historie, šipka
  // dolů) — pár vteřin po každé provedené akci nešlo panel zmenšit, klepnutí bralo oznámení
  // (klik-test 29. 9. 2026). Otevřený panel je posune pod svou hlavičku (h-12 = 48 px) — a ta je od 27. 10. 2026
  // pod ukotvenou horní lištou (spodek), takže o ni navíc.
  useEffect(() => {
    const el = document.documentElement;
    // otevřené dokumenty leží vlevo od chatu → toasty ještě o jejich šířku dál (orientačně; na úzkém okně je panel užší)
    // assistant on the left: toasts stay bottom-right where nothing covers them
    if (panel.open && !mobil && !vlevo) el.style.setProperty('--kb-toast-right', `${panel.width + (panel.dokOpen ? sirkaDokumentu(window.innerWidth, panel.width, panel.dokWidth) : 0)}px`); else el.style.removeProperty('--kb-toast-right');
    if (panel.open && mobil) el.style.setProperty('--kb-toast-top', `${spodek + 48}px`); else el.style.removeProperty('--kb-toast-top');
    return () => { el.style.removeProperty('--kb-toast-right'); el.style.removeProperty('--kb-toast-top'); };
  }, [panel.open, panel.width, panel.dokOpen, panel.dokWidth, mobil, spodek, vlevo]);
  // Dokumenty (30. 9. 2026): když asistent v tahu dokument založí (draft_text) nebo přepíše
  // (update_document), panel dokumentů se na počítači sám otevře s ním — jako artefakt v Claude.
  // Jen po DOKONČENÉM tahu (loading true → false), ne při načtení starého rozhovoru z historie, a jen na
  // dokumenty, které v tahu NOVĚ přibyly — potvrzení karty dřív znovu otevřelo starý koncept (checkup 1. 10.).
  // Rozepsanou úpravu jiného dokumentu nepřepne: jen obnoví seznam (hlídač v kontextu).
  const { otevriDokument, obnovDokumenty, hlidac } = panel;
  const predTahem = useRef(null); // podpisy karet dokumentů před tahem (id + stav)
  // podpis = id dokumentu + místo karty v rozhovoru (týž dokument přepsaný v dalším tahu je nová karta);
  // akce se počítá až provedená (potvrzení karty s přepisem dokumentu = nový podpis)
  // Stránky (14. 10. 2026): karta `stranka` (create_page / update_page) = záznam „ceka“ — writer spouští PROHLÍŽEČ až po tahu
  // (POST /chat/stranka/napsat, minuty; odpověď se nečeká, panel čeká realtime). Karta akce se stránkou (share_page) jen otevře panel.
  const podpisy = (msgs) => msgs.flatMap((m, i) => (m.karty || []).map((k, j) => ((k.type === 'koncept' || k.type === 'dokument' || k.type === 'soubor') && k.doc_id ? `${k.doc_id}:${i}.${j}`
    : k.type === 'stranka' ? `${STRANKA}${k.page_id}:${i}.${j}:ceka`
    : k.type === 'akce' && k.stav === 'hotovo' && k.odkaz && k.odkaz.type === 'dokument' ? `${k.odkaz.doc_id}:${i}.${j}:hotovo`
    : k.type === 'akce' && k.stav === 'hotovo' && k.odkaz && k.odkaz.odkaz && k.odkaz.odkaz.type === 'stranka' ? `${STRANKA}${k.odkaz.odkaz.page_id}:${i}.${j}:hotovo`
    : k.type === 'akce' && k.stav === 'hotovo' && k.odkaz && k.odkaz.type === 'faktura' ? `faktura:${k.odkaz.id}:${i}.${j}:hotovo` : ''))).filter(Boolean);
  const spustenyWriter = useRef(new Set()); // podpis karty → napsat se volá jednou (reload rozhovoru ho nespustí znovu)
  useEffect(() => {
    if (A.loading) { if (!predTahem.current) predTahem.current = new Set(podpisy(zpravy)); return; }
    if (!predTahem.current) return;
    const pred = predTahem.current;
    predTahem.current = null;
    const nove = podpisy(zpravy).filter((p) => !pred.has(p));
    if (!nove.length) return;
    const ids = nove.map((p) => p.replace(/:\d+\.\d+(:ceka|:hotovo)?$/, '')); // doc_id | stranka:<id> | faktura:<id> (panel Dokumenty → Faktury)
    for (const p of nove) {
      if (!p.startsWith(STRANKA) || !p.endsWith(':ceka') || spustenyWriter.current.has(p)) continue;
      spustenyWriter.current.add(p);
      strankaNapsat(p.replace(/:\d+\.\d+:ceka$/, '').slice(STRANKA.length)).catch(() => {}); // stav přijde realtime; chybu ukáže detail
    }
    obnovDokumenty(ids);
    if (!mobil && !(hlidac && hlidac.current)) otevriDokument(ids[ids.length - 1]);
  }, [A.loading, zpravy, mobil, otevriDokument, obnovDokumenty, hlidac]);
  const vratSkin = useCallback((predchozi) => {
    // predchozi ROTACE_ID = před změnou běžela rotace (každý den jiný skin, 29. 10. 2026)
    if (predchozi === ROTACE_ID) { setSkin(skinDne()); persistSkin({ skin_rotace: true }); hlidejRotaci({ skin_rotace: true }); return; }
    const id = predchozi || DEFAULT_SKIN_ID;
    // vlastní skin (skin_id 'custom') žije v user.skin_custom — getBuiltinSkin by vrátil null a Vrátit nic neudělal;
    // neplatný vlastní skin se přeskočí (ne Les s uloženým skin_id 'custom')
    const vlastni = id === 'custom' && validateSkin(user && user.skin_custom);
    const s = id === 'custom' ? (vlastni.ok ? vlastni.clean : null) : getBuiltinSkin(id);
    if (s) { setSkin(s); persistSkin({ skin_id: id, skin_rotace: false }); hlidejRotaci(null); }
  }, [persistSkin, user]);

  // tažení za levou hranu = šířka (bez knihovny; primitiv resizable v ui/ není)
  // tažení šířky: pointer capture + úklid i nad iframe relaxu (lib/tahSirky.js, 15. 10. 2026)
  const naTah = useCallback((e) => zacniTah(e, { sirka: A.width, nastav: A.setWidth, smer: vlevo ? -1 : 1 }), [A, vlevo]);
  // dragging the header to the other edge (buttons inside the header keep their clicks)
  const { setSide } = panel;
  const naPresun = useCallback((e) => {
    if (mobil || (e.target && e.target.closest && e.target.closest('button, a, input, textarea, [role="button"]'))) return;
    startMove(e, { onTarget: setMoveTarget, onDrop: (s) => { if (s) setSide(s); } });
  }, [mobil, setSide]);
  const prepniStranu = useCallback(() => setSide((s) => (s === 'left' ? 'right' : 'left')), [setSide]);
  // conversations list: open / new / back (the list replaces messages + input; Esc is handled by the list)
  const zpetDoChatu = useCallback(() => setPohled('chat'), []);
  const novyRozhovor = useCallback(() => { setPohled('chat'); A.novy(); }, [A]);
  const otevriRozhovor = useCallback((id) => { setPohled('chat'); A.otevriChat(id); }, [A]);

  // balíček spuštěný odjinud (Nový projekt → „Navrhnout s AI“, zásobník → „Roztřídit s AI“): vyřídit, až je
  // panel volný — během odpovědi by zacniRezim žádost tiše zahodil
  const { zadost, vyridZadost } = panel;
  // Stránky ze šablony: panel Dokumentů → záložka Stránky → formulář (jen když instance stránky nabízí)
  const strankyOn = !!(kbConfig && kbConfig.pages);
  const otevriNovouStranku = useCallback(() => { panel.setDokId(STRANKA + 'nova'); panel.setDokOpen(true); }, [panel]);
  // pomocník „Prezentace, přání, pozvánka“ otevře formulář Nový dokument v Kanceláři (jeden průvodce pro tlačítko i AI blok, 1. 11. 2026);
  // serverový formulář režimu kancelar zůstává pro lite a API
  const otevriNovyDokument = useCallback(() => { panel.setDokId(NOVY_DOK); panel.setDokOpen(true); }, [panel]);
  useEffect(() => {
    if (!zadost || !ready || !funkcni || A.loading) return;
    vyridZadost();
    setPohled('chat');
    // 'zprava' = hotová zpráva složená formulářem (Stránky → šablona, 15. 10. 2026): do běžícího rozhovoru;
    // na telefonu by panel Dokumentů chat zakryl → zavřít
    if (zadost.mode === 'zprava') { if (mobil) panel.setDokOpen(false); A.send(String((zadost.target || {}).text || ''), sKlientem(kontext), patchUser); return; }
    // 'pdf_oprava' = „Opravit s asistentem“ ze záložky PDF v Kanceláři (1. 11. 2026): soubor jako příloha nad políčkem
    if (zadost.mode === 'pdf_oprava') { if (mobil) panel.setDokOpen(false); naOpravit((zadost.target || {}).priloha); return; }
    A.zacniRezim(zadost.mode, zadost.target, sKlientem(kontext), patchUser);
  }, [zadost, ready, funkcni, A, kontext, patchUser, vyridZadost, mobil, panel, naOpravit]);

  if (!ready || !dostupny) return null;
  // lite: zavřený panel nekreslí nic (host ho stejně odmontuje) — žádná lišta dole ani ouško
  if (lite && !A.open) return null;
  // bez připojené AI ani ouško na kraji, ani lišta na telefonu — jen tlačítko v hlavičce (schválený náhled 19. 10.)
  if (stav === 'nepripojeno' && !A.open) return null;
  // relax (ranní akvárium vedle chatu) by Správu organizace zakryl a klik vypadal jako „nic se nestalo“ (klik-test 19. 10.)
  const naNastaveniAi = () => { if (panel.relax && !panel.relax.zamek) panel.ukonciRelax(); navigate('/admin/users?oddil=ai'); if (mobil) zavriChat(); };
  const placeholderStav = stav === 'vypadek' ? t('stav.placeholderVypadek') : stav === 'nepripojeno' ? t('stav.placeholderNepripojeno') : '';

  // Closed-panel tab = robot + dot, no words (Richard 11 Nov 2026: "Morning briefing waiting" lay over the left rail).
  // Same height on both sides: the left rail's top slot (rails start one slot lower) and the same top on the right.
  // The left robot is always there on desktop; on the right only while the assistant is docked right (approved mock-up).
  // Spinner while it works; dot = a question/action waiting, news finished while closed, morning briefing, pause.
  const tecka = cekaKarta ? 'karta' : unread ? 'novinka' : nabidnoutPoradu ? 'porada' : relaxNabidka ? 'relax' : ''; // one dot; the testid names the most pressing reason
  const popis = A.loading ? (textPrubehu(A.prubeh, t) || t('thinking')) : tecka === 'porada' ? t('poradaOffer') : tecka === 'relax' ? t('relaxOffer') : t('toggle');
  const ousko = (strana, hlavni) => {
    const zavreno = !A.open;
    return (
      <button
        key={strana}
        type="button"
        onClick={() => (hlavni ? A.setOpen(true) : A.setOpen((v) => !v))}
        title={zavreno ? popis : t('toggle')}
        aria-label={t('toggle')}
        data-testid={hlavni ? 'chat-tab' : 'chat-tab-levy'}
        data-tecka={zavreno ? tecka : ''}
        data-pracuje={zavreno && A.loading ? '1' : '0'}
        style={strana === 'left' ? { top: spodek + 8, left: panel.leftPanelWidth || 0 } : { top: spodek + 8 }}
        data-side={strana}
        className={`fixed ${strana === 'left' ? `rounded-r-lg ${panel.leftPanelWidth ? '' : 'border-l-0'}` : 'right-0 rounded-l-lg border-r-0'} z-30 flex items-center gap-1.5 border bg-card px-2 py-2.5 shadow-md hover:bg-secondary transition-all`}
      >
        {zavreno && A.loading ? <Loader2 className="w-4 h-4 text-primary animate-spin" data-testid={hlavni ? 'chat-tab-pracuje' : undefined} /> : <Bot className="w-4 h-4 text-primary" />}
        {zavreno && tecka && <span className="w-2 h-2 rounded-full bg-primary animate-pulse" data-testid={hlavni ? `chat-tab-${tecka}` : undefined} />}
        {zavreno && stav === 'vypadek' && <span className="w-2 h-2 rounded-full bg-amber-500" data-testid={hlavni ? 'chat-tab-vypadek' : undefined} />}
      </button>
    );
  };

  if (!A.open && mobil) {
    // telefon: minimalizovaný chat = lišta dole (poslední věta asistenta + políčko),
    // mapa je vidět. Z lišty jde psát i odeslat bez otevření (Richard 13. 9.: „zmenšit,
    // co je nade mnou, mít rozhled a pořád psát"); odpověď se ukáže v liště, karty
    // (otázky, akce k potvrzení) se hlásí tečkou — klepnutí na řádek panel otevře.
    const posledniA = [...zpravy].reverse().find((m) => m.role === 'assistant' && m.content);
    return (
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-card shadow-lg" data-testid="chat-bar">
        <button type="button" onClick={() => A.setOpen(true)} className="w-full px-3 pt-1.5 text-left text-xs text-muted-foreground inline-flex items-center gap-1.5" data-testid="chat-bar-otevrit">
          {A.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" /> : <Bot className="w-3.5 h-3.5 text-primary shrink-0" />}
          <span className="truncate" data-testid="chat-bar-text">{A.loading ? (textPrubehu(A.prubeh, t) || t('thinking')) : stav === 'vypadek' ? t(ai.hosted ? 'stav.vypadekTitle' : 'stav.vlastniVypadekTitle') : nabidnoutPoradu ? t('poradaOffer') : (posledniA ? posledniA.content.replace(/\s+/g, ' ').slice(0, 120) : t('emptyTitle'))}</span>
          {/* no "news" dot here: the bar itself shows the finished reply */}
          {(nabidnoutPoradu || cekaKarta) && <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" data-testid={cekaKarta ? 'chat-bar-karta' : 'chat-tab-porada'} />}
          {stav === 'vypadek' && <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" data-testid="chat-bar-vypadek" />}
        </button>
        <form className="p-2 pt-1 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); odesli(); }}>
          {hlas.aktivni ? <HlasovkaPruh h={hlas} kompaktni /> : (<>
          {umiHlas && <HlasovkaTlacitko h={hlas} disabled={A.loading} className="h-9 w-9 shrink-0 border border-input" />}
          <input
            ref={vstupListy}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholderStav || t('placeholder')}
            className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
            data-testid="chat-bar-input"
          />
          <Button type="button" size="icon" variant="outline" className="h-9 w-9" title={t('expand')} aria-label={t('expand')} onClick={() => { zListy.current = true; A.setOpen(true); }} data-testid="chat-bar-rozbalit"><ChevronUp className="w-4 h-4" /></Button>
          <Button type="submit" size="icon" className="h-9 w-9" disabled={A.loading || !text.trim()} aria-label={t('send')} data-testid="chat-bar-send"><Send className="w-4 h-4" /></Button>
          </>)}
        </form>
      </div>
    );
  }

  if (!A.open) return <>{ousko('left', vlevo)}{!vlevo && ousko('right', true)}</>;

  // poslední VIDITELNÁ zpráva (zprávy nástrojů se nekreslí): když model skončí textem
  // a zároveň suggest_next, leží za odpovědí ještě výsledek nástroje a čipy by byly zašedlé
  const posledniUzivatelIdx = zpravy.map((z) => z.role).lastIndexOf('user');
  // „Ukázat v mapě“ i úplně dole jako poslední věc tahu (Richard 15. 10. 2026): odkaz hotové karty z kteréhokoli
  // bloku tahu se zopakuje pod poslední zprávou asistenta v tahu — jen když za kartou ještě něco je (text, čipy),
  // jinak by byl dvakrát pod sebou
  let posledniIdx = zpravy.length - 1;
  while (posledniIdx > 0 && zpravy[posledniIdx].role === 'tool') posledniIdx--;
  const odkazDole = (i) => {
    const z = zpravy[i];
    if (i !== posledniIdx || !z || z.role !== 'assistant') return null; // jen poslední zpráva tahu
    let zac = i; while (zac > 0 && zpravy[zac - 1].role !== 'user') zac -= 1;
    const blok = zpravy.slice(zac, i + 1);
    // po založení projektu už server přidává kartu „Otevřít projekt“ — druhý odkaz by byl navíc
    if (blok.some((m) => (m.karty || []).some((k) => k.type === 'otevrit'))) return null;
    let odkaz = null; let zaKartou = false;
    blok.forEach((m, mi) => {
      (m.karty || []).forEach((k) => {
        if (k.type === 'akce' && k.stav === 'hotovo' && k.odkaz && k.odkaz.map_id && !k.odkaz.pripominka) { odkaz = k.odkaz; zaKartou = false; return; }
        if (odkaz && (k.type === 'navrhy' || k.type === 'otazky')) zaKartou = true;
      });
      // text zprávy se kreslí NAD jejími kartami — „za kartou“ je tedy jen text pozdější zprávy
      if (odkaz && mi > 0 && m.content && String(m.content).trim() && !(m.karty || []).some((k) => k.odkaz === odkaz)) zaKartou = true;
    });
    return odkaz && zaKartou ? odkaz : null;
  };
  const chyba = A.error ? (A.error === 'rate' ? t('errorRate') : A.error === 'timeout' ? t('errorTimeout') : A.error === 'lost' ? t('errorLost') : A.error === 'generic' ? t('errorGeneric') : A.error) : null;
  const chips = t('chips', { returnObjects: true });
  // telefon na výšku + relax „vedle“ = scéna NAD chatem (RelaxVrstva), panel začíná pod ní
  const relaxNad = mobil && !!panel.relax && panel.relax.rozlozeni === 'vedle' && !panel.relax.zamek; // i lite (panel přes celou šířku)
  // čip „🐟 Relax 5 min“ navíc mezi „co dál“ po větší akci (průvodce, nebo tah s ≥ 3 nástroji), ne do hodiny po pauze
  let relaxNavrh = '';
  if (!A.loading && !panel.relax && zpravy.length && (zpravy.slice(posledniUzivatelIdx + 1).filter((z) => z.role === 'tool').length >= 3 || (A.chat && A.chat.mode))) {
    if (Date.now() - (ctiAktivitu(klicRelax).posledniRelax || 0) >= HLIDAC_ZNOVU_MS) relaxNavrh = t('relaxChip');
  }

  // minimise button at the OUTER screen edge on both sides (Richard 11 Nov 2026: "as close to the screen edge as on the other
  // side — then I click one spot to keep opening and closing"); the closed tab sits at the same spot. Not a close: the chat stays.
  const zavrit = <Button variant="ghost" size="icon" className={`h-8 w-8 ${vlevo ? '-ml-1 shrink-0' : ''}`} title={t('close')} aria-label={t('close')} onClick={zavriChat} data-testid="chat-zavrit">{mobil ? <ChevronDown className="w-4 h-4" /> : vlevo ? <PanelLeftClose className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}</Button>;
  return (
    <>
    {/* no AI connected: the rails don't move down (railOffset 0), so the robot must not sit over them */}
    {!vlevo && robotLeft && ousko('left', false)}
    {panel.dokOpen && <DokumentyPanel mobil={mobil} />}
    <aside
      className={`fixed ${vlevo ? 'left-0' : 'right-0'} ${mobil ? (vlevo ? 'border-r' : 'border-l') : ''} bottom-0 z-40 flex flex-col bg-card shadow-xl w-full ${mobil ? '' : 'sm:w-auto'}`}
      style={mobil ? { top: relaxNad ? `calc(${spodek}px + ${NAD_PODIL})` : spodek } : { top: spodek, width: A.width, minWidth: MIN_W, maxWidth: MAX_W }}
      data-testid="chat-panel"
      data-side={vlevo ? 'left' : 'right'}
      data-pohled={pohled}
      aria-label={t('title')}
    >
      {!mobil && (
        <div
          onPointerDown={naTah}
          title={t('resize')}
          data-testid="chat-resize"
          className={`peer absolute ${vlevo ? 'right-0' : 'left-0'} top-0 bottom-0 z-10 w-1.5 cursor-col-resize hover:bg-primary/30`}
        />
      )}
      {/* Column edge (Richard 11 Nov 2026: "make the assistant column's divider stand out, maybe with an effect"):
          a 2 px accent line + a soft accent glow spilling onto the page; brighter while the resize handle is hovered */}
      {!mobil && <div aria-hidden="true" data-testid="chat-hrana" className={`kb-chat-hrana ${vlevo ? 'kb-chat-hrana-vlevo' : ''} peer-hover:bg-primary`} />}
      {/* Header (10 Nov 2026, approved mock-up): ☰ Conversations · title · ✎ New · 📄 Office · 🐟 (11 Nov: Office in the middle, aquarium right) | ⇄ side · ⇥ minimise.
          On a wide window the empty part of the header is a drag handle — drop it on the other edge to move the panel. */}
      <div
        className={`h-12 border-b flex items-center justify-between px-3 gap-2 shrink-0 ${mobil ? '' : 'cursor-grab active:cursor-grabbing select-none touch-none'}`}
        onPointerDown={mobil ? undefined : naPresun}
        title={mobil ? undefined : t('moveHint')}
        data-testid="chat-hlavicka"
      >
        <div className="flex items-center gap-2 min-w-0">
          {vlevo && <>{zavrit}<span className="h-5 w-px bg-border shrink-0" aria-hidden="true" /></>}
          <Button variant={pohled === 'rozhovory' ? 'default' : 'ghost'} size="icon" className={`h-8 w-8 shrink-0 ${vlevo ? '' : '-ml-1'}`} title={t('conversations')} aria-label={t('conversations')} aria-pressed={pohled === 'rozhovory'} onClick={() => setPohled((p) => (p === 'rozhovory' ? 'chat' : 'rozhovory'))} data-testid="chat-historie"><List className="w-4 h-4" /></Button>
          <span className="text-sm font-semibold truncate" data-testid="chat-nazev">{pohled === 'rozhovory' ? t('conversations') : (A.chat && A.chat.title) || t('title')}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" title={t('newChat')} aria-label={t('newChat')} onClick={novyRozhovor} data-testid="chat-novy"><SquarePen className="w-4 h-4" /></Button>
          {/* Dokumenty (30. 9. 2026): poznámky, e-maily a sumáře od asistenta — panel vedle chatu */}
          {/* Kancelář (1. 11. 2026; od 11. 11. uprostřed, akvárko vpravo — Richard): jedna ikonka = panel se záložkami Dokumenty | Stránky | PDF (dřív zvlášť „složka“ a „dokument“ pro PDF — mátlo) */}
          <Button variant={panel.dokOpen ? 'default' : 'ghost'} size="icon" className="h-8 w-8" title={t('dok.kancelarTitle')} aria-label={t('dok.kancelarTitle')} aria-pressed={panel.dokOpen} onClick={() => (panel.dokOpen ? panel.opatrne(() => panel.setDokOpen(false)) : panel.setDokOpen(true))} data-testid="chat-dokumenty-btn"><Files className="w-4 h-4" /></Button>
          {/* relax (Richard 15. 10. 2026): stálý přepínač mapa ⇄ rybičky v hlavičce — bez odpočtu, vedle chatu (na telefonu celá) */}
          <Button variant={panel.relax ? 'default' : 'ghost'} size="icon" className="h-8 w-8" title={t('relaxToggle')} aria-label={t('relaxToggle')} aria-pressed={!!panel.relax} onClick={() => (panel.relax ? panel.ukonciRelax() : spustRelax({ minut: 0, rozlozeni: 'vedle' }))} data-testid="chat-relax-toggle"><Fish className="w-4 h-4" /></Button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          {!mobil && <Button variant="ghost" size="icon" className="h-8 w-8" title={`${t(vlevo ? 'moveRight' : 'moveLeft')} — ${t('moveHint')}`} aria-label={t(vlevo ? 'moveRight' : 'moveLeft')} onClick={prepniStranu} data-testid="chat-strana"><ArrowLeftRight className="w-4 h-4" /></Button>}
          {!vlevo && zavrit}
        </div>
      </div>

      {!funkcni && <StavAsistenta stav={stav} hosted={!!ai.hosted} spravce={spravce} blik={blik} t={t} onZkusit={() => refreshAiModes()} onRelax={() => spustRelax({ minut: 0 })} onNastaveni={naNastaveniAi} />}

      {pohled === 'rozhovory' ? (
        <ConversationList items={A.seznam} activeId={A.chat && A.chat.id} modeIcons={IKONA_REZIMU} t={t} onOpen={otevriRozhovor} onNew={novyRozhovor} onDelete={A.smaz} onBack={zpetDoChatu} />
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2" data-testid="chat-zpravy">
            {/* Výpadek: historie rovnou v panelu (schválený náhled 19. 10.) — bez AI je to hlavní, co tu jde dělat;
                otevřený rozhovor je zvýrazněný, ostatní jedním klepnutím */}
            {stav === 'vypadek' && A.seznam.length > 0 && (
              <div className="rounded-lg border bg-background/70 py-1.5 text-sm" data-testid="chat-stav-historie">
                <p className="px-3 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t('history')}</p>
                {A.seznam.slice(0, 5).map((c) => (
                  <button key={c.id} type="button" onClick={() => A.otevriChat(c.id)} className={`block w-full truncate px-3 py-1.5 text-left hover:bg-secondary ${A.chat && A.chat.id === c.id ? 'font-semibold text-primary' : ''}`} data-testid="chat-stav-historie-polozka">
                    {IKONA_REZIMU[c.mode] || ''}{c.title || t('newChat')}
                  </button>
                ))}
                {A.seznam.length > 5 && <button type="button" onClick={() => setPohled('rozhovory')} className="block w-full px-3 py-1.5 text-left text-xs text-primary hover:underline" data-testid="chat-stav-historie-vse">{t('conversations')} ({A.seznam.length})</button>}
              </div>
            )}
            {relaxNabidka && !panel.relax && (
              <div className="rounded-lg border border-primary/50 bg-background/70 p-3 text-sm" data-testid="chat-relax-nabidka">
                <p className="inline-flex items-center gap-1.5 font-medium"><Fish className="w-4 h-4 text-primary" />{t('relaxOffer')}</p>
                <p className="text-xs text-muted-foreground mt-1">{t('relaxOfferHint')}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => spustRelax({ minut: 5 })} data-testid="chat-relax-5">{t('relaxOffer5')}</Button>
                  <Button size="sm" variant="outline" onClick={() => spustRelax({ minut: 15 })} data-testid="chat-relax-15">{t('relaxOffer15')}</Button>
                  <Button size="sm" variant="ghost" onClick={odmitniRelax} data-testid="chat-relax-ne">{t('relaxOfferNe')}</Button>
                </div>
              </div>
            )}
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
            {/* Noční plánování (Richard 29.–30. 9. 2026): vlastní rámeček pod nabídkou ranní porady, v prázdném
                rozhovoru VŽDY — žádná logika dne, nabídka ani notifikace, nic k odmítání; spouští ho jen uživatel.
                Spuštění uklidí ranní nabídku pro dnešek (Richard 30. 9.: „už by mi neměla svítit“) */}
            {/* hidden 11 Nov 2026 (Richard: "Night planning — hide it"); the mode stays (rules, history) — NIGHT_PLANNING_IN_PANEL brings the frame back */}
            {NIGHT_PLANNING_IN_PANEL && zpravy.length === 0 && funkcni && !A.loading && (
              <div className="rounded-lg border border-primary/50 bg-background/70 p-3 text-sm" data-testid="chat-nocni-nabidka">
                <p className="inline-flex items-center gap-1.5 font-medium"><Moon className="w-4 h-4 text-primary" />{t('nocniOffer')}</p>
                <p className="text-xs text-muted-foreground mt-1">{t('nocniOfferHint')}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { odmitniPoradu(); setPohled('chat'); A.zacniRezim('nocni', {}, kontext, patchUser); }} data-testid="chat-nocni-start">{t('nocniYes')}</Button>
                </div>
              </div>
            )}
            {/* AI blok (fáze C, 1. 10. 2026): balíčky, které si uživatel spustí sám — pod Nočním plánováním,
                jen v prázdném rozhovoru */}
            {zpravy.length === 0 && funkcni && !A.loading && (
              <AiBlok mobil={mobil} userId={user?.id} vedouci={user?.role === 'admin' || user?.role === 'manager'} stranky={strankyOn} disabled={A.loading} onSpust={(mode) => { if (mode === 'stranka') { otevriNovouStranku(); return; } if (mode === 'kancelar') { otevriNovyDokument(); return; } setPohled('chat'); A.zacniRezim(mode, {}, kontext, patchUser); }} />
            )}
            {zpravy.length === 0 && funkcni && (
              <div className="pt-6 text-center space-y-3">
                <Bot className="w-8 h-8 mx-auto text-primary/70" />
                <p className="text-sm font-medium">{t('emptyTitle')}</p>
                <p className="text-xs text-muted-foreground px-4">{t('emptyHint')}</p>
              </div>
            )}
            {zpravy.map((z, i) => (
              // klíč nese i rozhovor: jinak stav karet (rozepsaná odpověď, otevřená úprava přepisu) přežil přepnutí
              // rozhovoru z historie a karta s jiným počtem otázek pak při odeslání spadla
              <div key={`${(A.chat && A.chat.id) || 'novy'}:${i}`} ref={i === prvniOdpovedIdx ? zacatekOdpovedi : undefined} className={i === prvniOdpovedIdx ? 'scroll-mt-2' : undefined}>
                <AsistentZprava zprava={z} posledni={i === posledniIdx} odkazDole={odkazDole(i)} loading={A.loading} onSend={odesli} onPotvrd={potvrd} onRevertSkin={vratSkin} onRevertNastaveni={vratNastaveni} onKlientSkin={potvrdKlientaSkin} onOdkaz={poOdkazu} najdiPdf={najdiPdf} ulozPdf={ulozPdf} drivejsiOpravy={drivejsiOpravy} onOtevriDokument={otevriDokument} lzeOpravit={i === posledniUzivatelIdx && !!(A.chat && A.chat.lze_opravit)} onOprav={opravPrepis} extraNavrh={i === posledniIdx ? relaxNavrh : ''} />
              </div>
            ))}
            {A.loading && (
              <div className="flex justify-start" data-testid="chat-thinking">
                <div className="rounded-2xl rounded-bl-md bg-secondary px-3 py-2 text-xs text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {/* průběh tahu ze serveru (co asistent právě čte / připravuje) má přednost před obecným „Přemýšlím…“ */}
                  <span data-testid="chat-prubeh" data-faze={(A.prubeh && A.prubeh.faze) || ''}>{textPrubehu(A.prubeh, t) || (zpravy.length && zpravy[zpravy.length - 1].docasna && zpravy[zpravy.length - 1].obrazek ? t('imageReading') : zpravy.length && zpravy[zpravy.length - 1].docasna && zpravy[zpravy.length - 1].hlas ? t('voiceReading') : zpravy.length && zpravy[zpravy.length - 1].docasna && zpravy[zpravy.length - 1].pdf ? t('pdf.thinking') : t('thinking'))}</span>
                </div>
              </div>
            )}
            {chyba && <p className="text-xs text-destructive px-1" data-testid="chat-chyba">{chyba}</p>}
            <div ref={konec} />
          </div>
          {panel.relax && <RelaxStav relax={panel.relax} t={t} onKonec={panel.ukonciRelax} onProdluz={(m) => panel.prodluzRelax(m || 5)} onDal={() => panel.upravRelax({ konecV: 0, hotovo: false })} />}
          {/* bez AI řádek čipů vůbec (relax je v pruhu stavu i v hlavičce) — schválený náhled */}
          {zpravy.length === 0 && funkcni && Array.isArray(chips) && (
            <div className={`px-3 pb-2 flex gap-1.5 ${mobil ? 'flex-nowrap overflow-x-auto whitespace-nowrap [scrollbar-width:none]' : 'flex-wrap'}`} data-testid="chat-chipy">
              {/* průvodci: ranní porada, rozbor projektu (na mapě: tenhle projekt), zaseknutí; noční plánování má vlastní rámeček výš */}
              <button type="button" onClick={() => A.zacniRezim('porada', {}, kontext, patchUser)} disabled={A.loading} className="text-xs rounded-full border border-primary/50 px-2.5 py-1 hover:bg-secondary" data-testid="chat-chip-porada">{t('chipPorada')}</button>
              <button type="button" onClick={() => A.zacniRezim('rozbor', {}, kontext, patchUser)} disabled={A.loading} className="text-xs rounded-full border border-primary/50 px-2.5 py-1 hover:bg-secondary" data-testid="chat-chip-rozbor">{kontext.map_id ? t('chipRozborMapa') : t('chipRozbor')}</button>
              {strankyOn && <button type="button" onClick={otevriNovouStranku} disabled={A.loading} className="text-xs rounded-full border border-primary/50 px-2.5 py-1 hover:bg-secondary" data-testid="chat-chip-stranka">{kontext.map_id ? t('chipStrankaMapa') : t('chipStranka')}</button>}
              {/* relax (14. 10. 2026): pauza s akváriem / úlem — bez modelu */}
              {!panel.relax && <button type="button" onClick={() => spustRelax({ minut: 0 })} className="text-xs rounded-full border border-primary/50 px-2.5 py-1 hover:bg-secondary" data-testid="chat-chip-relax">{t('relaxChipVolny')}</button>}
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
              {obrazekChyba && <p className="text-xs text-destructive" data-testid="chat-obrazek-chyba">{t(obrazekChyba === 'jenObrazek' ? (umiObrazek ? 'imageOnly' : 'pdfOnly') : obrazekChyba === 'bezObrazku' ? 'imageOff' : obrazekChyba === true ? 'imageError' : CHYBA_TEXTU[obrazekChyba] || `pdf.chyba.${String(obrazekChyba).replace(/^pdf:/, '')}`, { defaultValue: t('pdf.chyba.poskozeno'), mb: maxHlasMb })}</p>}
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
            {hlas.aktivni ? <HlasovkaPruh h={hlas} /> : (<>
            {/* mikrofon úplně vlevo a přes celou výšku políčka (Richard 15. 10. 2026, z telefonu) */}
            {umiHlas && <HlasovkaTlacitko h={hlas} disabled={A.loading} className="self-stretch h-auto min-h-[44px] w-11 shrink-0 border border-input" />}
            <Textarea
              ref={vstup}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); odesli(); } }}
              onPaste={(e) => { const f = souborZPrenosu(e.clipboardData); if (f) { e.preventDefault(); prijmiSoubor(f); } }}
              onBlur={() => { psalDo.current = Date.now(); }}
              placeholder={pretahuje ? t('imageDrop') : placeholderStav || t('placeholder')}
              title={t(umiObrazek ? 'imageHint' : 'pdfHint')}
              rows={2}
              className="min-h-[44px] max-h-40 text-sm resize-none"
              data-testid="chat-input"
            />
            <input
              ref={souborRef}
              type="file"
              accept={(umiObrazek ? 'image/png,image/jpeg,image/webp,' : '') + 'application/pdf,.pdf,text/plain,text/markdown,.txt,.md' + (umiHlas ? ',audio/*,.opus,.ogg,.m4a,.mp3,.wav' : '')}
              className="hidden"
              data-testid="chat-obrazek-input"
              onChange={(e) => { prijmiSoubor(e.target.files?.[0]); e.target.value = ''; }}
            />
            {funkcni && <Button type="button" size="icon" variant="ghost" title={umiObrazek ? `${t('imageAdd')} — ${t('imageHint')}` : `${t('pdfAdd')} — ${t('pdfHint')}`} aria-label={t(umiObrazek ? 'imageAdd' : 'pdfAdd')} disabled={A.loading} onClick={() => souborRef.current?.click()} data-testid="chat-obrazek">
              {umiObrazek ? <ImagePlus className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
            </Button>}
            {mobil && (
              <Button type="button" size="icon" variant="outline" title={t('shrink')} aria-label={t('shrink')} onClick={zmensit} data-testid="chat-zmensit"><ChevronDown className="w-4 h-4" /></Button>
            )}
            <Button type="submit" size="icon" disabled={A.loading || pdfCte || (!text.trim() && !obrazek && !pdf)} title={t('send')} aria-label={t('send')} data-testid="chat-send">
              {A.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
            </>)}
          </form>
        </>
      )}
    </aside>
    {/* drop target while dragging the header: a translucent strip on the side the panel will dock to */}
    {moveTarget && moveTarget !== (vlevo ? 'left' : 'right') && (
      <div
        className={`fixed bottom-0 z-[55] pointer-events-none border-2 border-dashed border-primary bg-primary/15 flex items-center justify-center text-sm font-medium text-primary ${moveTarget === 'left' ? 'left-0' : 'right-0'}`}
        style={{ top: spodek, width: A.width }}
        data-testid="chat-strana-cil" data-cil={moveTarget}
      >
        {t('moveDrop')}
      </div>
    )}
    </>
  );
}
