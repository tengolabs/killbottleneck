import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Brain, Check, ChevronLeft, Copy, Download, ExternalLink, FileText, FolderKanban, Loader2, Mail, Pencil, Phone, ScrollText, Search, Trash2, Undo2, Users, X, NotebookPen, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAsistent, DOK_MAX_W, PAMET, sirkaDokumentu } from '@/lib/AsistentContext';
import { copyToClipboard } from '@/lib/clipboard';
import { dokumenty as apiSeznam, dokument as apiDokument, dokumentUloz, dokumentVratit, dokumentSmazat } from '@/api/asistentApi';
import { saveBlob, safeFilename } from '@/lib/saveFile';
import PametPohled from './PametPohled';
import { useSpodekHlavicky } from '@/hooks/useSpodekHlavicky';

// Dokumenty asistenta (30. 9. 2026) — poznámky, koncepty e-mailů a sumáře, které
// asistent napsal (draft_text) nebo si uživatel založil sám. Richard: „jako když
// v Claude vidím plán vedle chatu“ → panel VLEVO od chatu, PŘES mapu (stránku
// neodsouvá, jen ji překryje). Na telefonu přes celou obrazovku nad chatem.
// Na počítači začíná POD horní lištou stránky: přes celou výšku zakrýval pravou část
// lišty (tlačítko asistenta, menu účtu, v editoru Sdílet/Export) — lišta musí zůstat klikací.
// Soukromé (vidí jen vlastník), e-mail jen koncept (Kopírovat / Otevřít v poště).
// Paměť asistenta (co asistent ČTE) je tu připnutá nahoře jako `dokId = PAMET` — vlastní tlačítko
// v hlavičce asistenta zrušeno 1. 10. 2026 (Richard).
// Nové dokumenty zakládá JEN asistent (Richard 1. 10. 2026, varianta A): ruční „Nová poznámka“
// by se tloukla se zásobníkem nápadů — úkoly v poznámce by z porad a plánování vypadly.

const IKONA = { note: NotebookPen, email: Mail, summary: ClipboardList, meeting: Users, call: Phone, other: ScrollText };
const SKUPINY = ['', 'poznamky', 'emaily', 'sumare'];
// mailto: s dlouhým tělem prohlížeče / poštovní programy uříznou (limit URL ~2000 znaků) — měří se
// ZAKÓDOVANÁ délka (č = %C4%8D, 6 znaků; checkup 1. 10.)
const MAILTO_MAX = 1800;

// Prostý text s lehkým členěním (jako bubliny chatu): řádek zakončený dvojtečkou
// nebo začínající „#“ (kdyby model přece jen napsal markdown) = nadpis sekce.
function DokText({ text }) {
  const radky = String(text || '').split('\n');
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed" data-testid="chat-dok-cteni">
      {radky.map((r, i) => {
        const h = r.match(/^#{1,3}\s+(.*)$/);
        const sekce = h || /^[^-•\s].{0,58}:$/.test(r.trim());
        return <span key={i}>{sekce ? <span className="font-semibold">{h ? h[1] : r}</span> : r}{i < radky.length - 1 ? '\n' : ''}</span>;
      })}
    </div>
  );
}

function datum(iso, lang) {
  if (!iso) return '';
  const d = new Date(String(iso).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(lang === 'en' ? 'en-GB' : 'cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}


// filtr a hledání drží panel (ne seznam) — po návratu z dokumentu zůstanou, jak byly
function Seznam({ verze, onOtevri, skupina, setSkupina, q, setQ }) {
  const { t, i18n } = useTranslation('asistent');
  const [hledat, setHledat] = useState('');
  const [rows, setRows] = useState(null);
  const [chyba, setChyba] = useState('');
  // hledání až po krátké pauze v psaní — ne dotaz na každé písmeno
  useEffect(() => { const h = setTimeout(() => setHledat(q.trim()), 250); return () => clearTimeout(h); }, [q]);
  useEffect(() => {
    let zivy = true;
    apiSeznam({ skupina, q: hledat })
      .then((r) => { if (zivy) { setRows(r.dokumenty || []); setChyba(''); } })
      .catch((e) => { if (zivy) { setRows((p) => p || []); setChyba(e.message || t('dok.errorLoad')); } });
    return () => { zivy = false; };
  }, [skupina, hledat, verze, t]);
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 pt-3 pb-2 space-y-2 border-b shrink-0">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {SKUPINY.map((s) => (
            <button
              key={s || 'vse'}
              type="button"
              role="tab"
              aria-selected={skupina === s}
              onClick={() => setSkupina(s)}
              className={`text-xs rounded-full border px-2.5 py-1 transition-colors ${skupina === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-secondary'}`}
              data-testid="chat-dok-filtr"
              data-skupina={s || 'vse'}
            >
              {t(`dok.skupina.${s || 'vse'}`)}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dok.search')} className="h-8 pl-8 text-sm" data-testid="chat-dok-hledat" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1" data-testid="chat-dok-seznam">
        {rows === null && <Loader2 className="w-4 h-4 animate-spin m-3" />}
        {chyba && <p className="text-xs text-destructive px-2">{chyba}</p>}
        {rows && rows.length === 0 && !chyba && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground" data-testid="chat-dok-prazdno">
            <FileText className="w-6 h-6 mx-auto mb-2 opacity-60" />
            <p>{hledat || skupina ? t('dok.emptyFiltered') : t('dok.empty')}</p>
          </div>
        )}
        {/* připnutá paměť — jen v „Vše“ bez hledání */}
        {!skupina && !hledat && (
          <button type="button" onClick={() => onOtevri(PAMET)} className="w-full text-left rounded-lg border border-dashed border-primary/50 px-2.5 py-2 hover:bg-secondary transition-colors mb-1" data-testid="chat-dok-pamet">
            <div className="flex items-center gap-2 min-w-0">
              <Brain className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm font-medium truncate flex-1">{t('dok.memory')}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 pl-6">{t('dok.memoryHint')}</p>
          </button>
        )}
        {(rows || []).map((d) => {
          const Ikona = IKONA[d.kind] || ScrollText;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => onOtevri(d.id)}
              className="w-full text-left rounded-lg border border-transparent px-2.5 py-2 hover:bg-secondary hover:border-border transition-colors"
              data-testid="chat-dok-polozka"
              data-id={d.id}
              data-kind={d.kind}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Ikona className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm font-medium truncate flex-1">{d.title || t(`dok.kind.${d.kind}`)}</span>
                <span className="text-[11px] text-muted-foreground shrink-0">{datum(d.updated, i18n.language)}</span>
              </div>
              {d.map_title && <p className="text-[11px] text-primary/90 truncate mt-0.5 pl-6 inline-flex items-center gap-1 max-w-full" data-testid="chat-dok-polozka-projekt"><FolderKanban className="w-3 h-3 shrink-0" /><span className="truncate">{d.map_title}</span></p>}
              {d.nahled && <p className="text-xs text-muted-foreground truncate mt-0.5 pl-6">{d.nahled}</p>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Detail({ id, verze, zmenene, onZpet, onSmazano, hlidac, onProjekt }) {
  const { t, i18n } = useTranslation('asistent');
  const [dok, setDok] = useState(null);
  const [chyba, setChyba] = useState('');
  const [uprava, setUprava] = useState(false);
  const [pole, setPole] = useState({ title: '', text: '', email_to: '', email_subject: '' });
  const [uklada, setUklada] = useState(false);
  const [zkopirovano, setZkopirovano] = useState(false);
  const [potvrdSmazat, setPotvrdSmazat] = useState(false);
  const [hlaska, setHlaska] = useState('');
  const [cizi, setCizi] = useState(false); // asistent dokument změnil, zatímco ho uživatel upravuje
  const upravaRef = useRef(false);
  upravaRef.current = uprava;
  const zmeneno = !!dok && uprava && ['title', 'text', 'email_to', 'email_subject'].some((k) => (pole[k] || '') !== (dok[k] || ''));
  // panel se ptá před odchodem (Zpět / zavřít / jiný dokument), když jsou neuložené změny
  useEffect(() => { hlidac.current = zmeneno; return () => { hlidac.current = false; }; }, [zmeneno, hlidac]);

  // odpověď, která dorazí až po začátku úpravy, rozepsaný text NEpřepíše (checkup 1. 10.)
  const nacti = useCallback(async () => {
    try {
      const r = await apiDokument(id);
      if (upravaRef.current) { setCizi(true); return; }
      setDok(r.dokument); setChyba(''); setCizi(false);
      setPole({ title: r.dokument.title || '', text: r.dokument.text || '', email_to: r.dokument.email_to || '', email_subject: r.dokument.email_subject || '' });
    } catch (e) { setChyba(e.status === 404 ? t('dok.notFound') : (e.message || t('dok.errorLoad'))); }
  }, [id, t]);
  useEffect(() => { setDok(null); setUprava(false); setPotvrdSmazat(false); setHlaska(''); nacti(); }, [id, nacti]);
  // asistent přepsal PRÁVĚ tenhle dokument (update_document) → načíst; rozepsanou úpravu nepřepisovat
  const prvni = useRef(true);
  useEffect(() => {
    if (prvni.current) { prvni.current = false; return; }
    if (zmenene && zmenene.length && !zmenene.includes(id)) return;
    if (upravaRef.current) setCizi(true); else nacti();
  }, [verze, zmenene, id, nacti]);

  const zacniUpravu = () => { if (!dok) return; setPole({ title: dok.title || '', text: dok.text || '', email_to: dok.email_to || '', email_subject: dok.email_subject || '' }); setUprava(true); setHlaska(''); };
  const uloz = async () => {
    setUklada(true); setHlaska('');
    try {
      const r = await dokumentUloz({ id, ...pole });
      setDok(r.dokument); setUprava(false); setHlaska(cizi ? t('dok.savedOverAssistant') : t('dok.saved')); setCizi(false);
    } catch (e) { setHlaska(e.message || t('dok.errorSave')); }
    setUklada(false);
  };
  const vratit = async () => {
    setUklada(true); setHlaska('');
    try { const r = await dokumentVratit(id); setDok(r.dokument); setUprava(false); setHlaska(t('dok.restored')); } catch (e) { setHlaska(e.message || t('dok.errorSave')); }
    setUklada(false);
  };
  const smazat = async () => {
    setUklada(true);
    try { await dokumentSmazat(id); hlidac.current = false; onSmazano(); } catch (e) { setHlaska(e.message || t('dok.errorSave')); setUklada(false); }
  };
  const aktualni = uprava ? pole : (dok || pole);
  const jeEmail = dok && dok.kind === 'email';
  const kopiruj = async () => {
    if (!(await copyToClipboard(aktualni.text || ''))) { setHlaska(t('dok.copyFailed')); return; }
    setZkopirovano(true); setTimeout(() => setZkopirovano(false), 1500);
  };
  const telo = aktualni.text || '';
  const teloKod = encodeURIComponent(telo);
  const dlouhe = teloKod.length > MAILTO_MAX;
  const mailto = `mailto:${encodeURIComponent(aktualni.email_to || '').replace(/%40/g, '@').replace(/%2C/g, ',')}?subject=${encodeURIComponent(aktualni.email_subject || '')}&body=${dlouhe ? '' : teloKod}`;
  // dlouhé tělo se do odkazu nevejde → text do schránky a v poště se jen vloží (hláška jen když se to povedlo)
  const doPosty = async () => { if (dlouhe) setHlaska((await copyToClipboard(telo)) ? t('dok.mailtoLong') : t('dok.mailtoLongNoCopy')); };
  // zahodit úpravu a načíst aktuální verzi (po „asistent mezitím upravil“) — ref hned, nacti ho čte
  const zahodAUnacti = () => { upravaRef.current = false; setUprava(false); setHlaska(''); nacti(); };
  const stahni = () => {
    const hlava = jeEmail ? [aktualni.email_to ? `${t('dok.to')}: ${aktualni.email_to}` : '', aktualni.email_subject ? `${t('dok.subject')}: ${aktualni.email_subject}` : ''].filter(Boolean).join('\n') : '';
    const obsah = (hlava ? `${hlava}\n\n` : '') + telo;
    saveBlob(new Blob([obsah], { type: 'text/plain;charset=utf-8' }), `${safeFilename(aktualni.title || '', 'dokument')}.txt`);
  };

  if (chyba) return (
    <div className="p-4 text-sm space-y-3">
      <p className="text-destructive">{chyba}</p>
      <Button size="sm" variant="outline" onClick={onZpet}><ChevronLeft className="w-4 h-4 mr-1" />{t('dok.back')}</Button>
    </div>
  );
  if (!dok) return <Loader2 className="w-4 h-4 animate-spin m-4" />;
  const Ikona = IKONA[dok.kind] || ScrollText;
  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="chat-dok-detail" data-id={dok.id} data-kind={dok.kind}>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
          <Ikona className="w-3.5 h-3.5 text-primary" />{t(`dok.kind.${dok.kind}`)} · {datum(dok.updated, i18n.language)}
        </p>
        {cizi && (
          <div className="rounded-md border border-primary/50 bg-primary/5 px-2.5 py-1.5 text-xs flex items-center justify-between gap-2" data-testid="chat-dok-cizi">
            <span>{t('dok.changedByAssistant')} {t('dok.saveOverwrites')}</span>
            <button type="button" className="text-primary hover:underline shrink-0" onClick={zahodAUnacti}>{t('dok.loadNew')}</button>
          </div>
        )}
        {uprava ? (
          <>
            <Input value={pole.title} onChange={(e) => setPole((p) => ({ ...p, title: e.target.value }))} placeholder={t('dok.titlePlaceholder')} className="font-semibold" maxLength={200} data-testid="chat-dok-nazev" />
            {jeEmail && (
              <>
                <Input value={pole.email_to} onChange={(e) => setPole((p) => ({ ...p, email_to: e.target.value }))} placeholder={t('dok.to')} maxLength={500} data-testid="chat-dok-komu" />
                <Input value={pole.email_subject} onChange={(e) => setPole((p) => ({ ...p, email_subject: e.target.value }))} placeholder={t('dok.subject')} maxLength={300} data-testid="chat-dok-predmet" />
              </>
            )}
            <Textarea value={pole.text} onChange={(e) => setPole((p) => ({ ...p, text: e.target.value }))} className="min-h-[50vh] text-sm leading-relaxed" maxLength={20000} data-testid="chat-dok-text" />
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold break-words" data-testid="chat-dok-titulek">{dok.title}</h2>
            {/* ke kterému projektu dokument patří → mapa, jako odkazy v asistentovi (Richard 1. 10. 2026) */}
            {dok.map && dok.map_title && (
              <Link to={`/map/${dok.map}`} onClick={onProjekt} className="inline-flex items-center gap-1.5 rounded-lg border border-primary/60 bg-background/60 px-2.5 py-1 text-xs font-medium text-primary hover:bg-secondary max-w-full" data-testid="chat-dok-projekt">
                <FolderKanban className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{t('dok.openProject', { title: dok.map_title })}</span><ExternalLink className="w-3 h-3 shrink-0" />
              </Link>
            )}
            {jeEmail && (dok.email_to || dok.email_subject) && (
              <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded-md bg-secondary/60 px-2.5 py-1.5">
                {dok.email_to && <><dt className="text-muted-foreground">{t('dok.to')}:</dt><dd className="break-all" data-testid="chat-dok-komu-cteni">{dok.email_to}</dd></>}
                {dok.email_subject && <><dt className="text-muted-foreground">{t('dok.subject')}:</dt><dd className="break-words" data-testid="chat-dok-predmet-cteni">{dok.email_subject}</dd></>}
              </dl>
            )}
            {/* dvojklik do textu = upravit (jako v Claude) */}
            <div onDoubleClick={zacniUpravu} className="cursor-text">
              {dok.text ? <DokText text={dok.text} /> : <p className="text-sm text-muted-foreground italic">{t('dok.emptyText')}</p>}
            </div>
          </>
        )}
      </div>
      <div className="border-t px-3 py-2 space-y-1.5 shrink-0">
        {hlaska && <p className="text-xs text-muted-foreground" data-testid="chat-dok-hlaska">{hlaska}</p>}
        {potvrdSmazat ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="chat-dok-smazat-potvrzeni">
            <span className="text-xs">{t('dok.deleteConfirm')}</span>
            <Button size="sm" variant="destructive" disabled={uklada} onClick={smazat} data-testid="chat-dok-smazat-ano">{t('dok.deleteYes')}</Button>
            <Button size="sm" variant="outline" disabled={uklada} onClick={() => setPotvrdSmazat(false)}>{t('dok.cancel')}</Button>
          </div>
        ) : uprava ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={uklada || !zmeneno} onClick={uloz} data-testid="chat-dok-ulozit">{uklada ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Check className="w-3.5 h-3.5 mr-1" />}{t('dok.save')}</Button>
            <Button size="sm" variant="outline" disabled={uklada} onClick={() => (cizi ? zahodAUnacti() : (setUprava(false), setHlaska('')))} data-testid="chat-dok-zrusit">{t('dok.cancel')}</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-8" onClick={zacniUpravu} data-testid="chat-dok-upravit"><Pencil className="w-3.5 h-3.5 mr-1" />{t('dok.edit')}</Button>
            <Button size="sm" variant="outline" className="h-8" onClick={kopiruj} data-testid="chat-dok-kopirovat">{zkopirovano ? <Check className="w-3.5 h-3.5 mr-1 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 mr-1" />}{zkopirovano ? t('draft.copied') : t('draft.copy')}</Button>
            {jeEmail && (
              <Button size="sm" variant="outline" className="h-8" asChild>
                <a href={mailto} onClick={doPosty} data-testid="chat-dok-mailto"><Mail className="w-3.5 h-3.5 mr-1" />{t('dok.mailto')}</a>
              </Button>
            )}
            <Button size="icon" variant="ghost" className="h-8 w-8" title={t('dok.download')} aria-label={t('dok.download')} onClick={stahni} data-testid="chat-dok-stahnout"><Download className="w-4 h-4" /></Button>
            {dok.ma_predchozi && (
              <Button size="icon" variant="ghost" className="h-8 w-8" title={t('dok.restore')} aria-label={t('dok.restore')} disabled={uklada} onClick={vratit} data-testid="chat-dok-vratit"><Undo2 className="w-4 h-4" /></Button>
            )}
            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" title={t('dok.delete')} aria-label={t('dok.delete')} onClick={() => setPotvrdSmazat(true)} data-testid="chat-dok-smazat"><Trash2 className="w-4 h-4" /></Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DokumentyPanel({ mobil }) {
  const { t } = useTranslation('asistent');
  const A = useAsistent();
  const [skupina, setSkupina] = useState('');
  const [q, setQ] = useState('');
  const [okno, setOkno] = useState(() => window.innerWidth);
  const spodek = useSpodekHlavicky(!mobil);
  // neuložené změny hlídá kontext (A.hlidac / A.opatrne / A.odchod) — jde přes něj i samootevření,
  // karty v chatu, přepínač v hlavičce a minimalizace chatu (checkup 1. 10.)
  const { hlidac, opatrne, odchod, setOdchod, zahodZmeny } = A;
  useEffect(() => {
    const f = () => setOkno(window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const zavri = useCallback(() => opatrne(() => A.setDokOpen(false)), [A, opatrne]);
  const zpet = useCallback(() => opatrne(() => A.setDokId('')), [A, opatrne]);
  // Esc zavře panel — ne při psaní (tam Esc patří políčku) a ne, když je otevřený jiný
  // dialog nebo menu: Esc patří jemu (snímky 30. 9.: zavření dialogu účelu zavřelo i dokumenty)
  useEffect(() => {
    const f = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      zavri();
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [zavri]);

  // odkaz na projekt: na počítači se mapa přepne POD panelem a dokument zůstane vedle;
  // na telefonu by panel mapu zakryl → schovat dokumenty i chat (jako „Ukázat v mapě“ v asistentovi)
  const naProjekt = useCallback(() => { if (mobil) { A.setDokOpen(false); A.setOpen(false); } }, [mobil, A]);

  // tažení za levou hranu = šířka (stejně jako panel chatu)
  const tah = useRef(null);
  const naTah = useCallback((e) => {
    e.preventDefault();
    tah.current = { x: e.clientX, w: A.dokWidth };
    const move = (ev) => { if (tah.current) A.setDokWidth(tah.current.w + (tah.current.x - ev.clientX)); };
    const up = () => { tah.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [A]);
  // na úzkém okně se vejde, co zbude vedle chatu (48 px mapy vlevo nechat vidět)
  const sirka = sirkaDokumentu(okno, A.width, A.dokWidth);

  return (
    <aside
      className={mobil ? 'fixed inset-0 z-50 flex flex-col bg-card' : 'fixed bottom-0 z-40 flex flex-col bg-card border-l border-t shadow-2xl'}
      style={mobil ? undefined : { top: spodek, right: A.width, width: sirka, maxWidth: DOK_MAX_W }}
      data-testid="chat-dokumenty"
      aria-label={t('dok.title')}
    >
      {!mobil && (
        <div onPointerDown={naTah} title={t('resize')} data-testid="chat-dok-resize" className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30" />
      )}
      <div className="h-12 border-b flex items-center justify-between px-3 gap-2 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {mobil ? (
            <Button variant="ghost" size="sm" className="h-8 px-2 -ml-1" onClick={A.dokId ? zpet : zavri} data-testid="chat-dok-zpet-chat">
              <ChevronLeft className="w-4 h-4 mr-0.5" />{A.dokId ? t('dok.back') : t('dok.backToChat')}
            </Button>
          ) : A.dokId ? (
            <Button variant="ghost" size="sm" className="h-8 px-2 -ml-1" onClick={zpet} data-testid="chat-dok-zpet"><ChevronLeft className="w-4 h-4 mr-0.5" />{t('dok.back')}</Button>
          ) : (
            <span className="text-sm font-semibold inline-flex items-center gap-1.5"><FileText className="w-4 h-4 text-primary" />{t('dok.title')}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!mobil && <Button variant="ghost" size="icon" className="h-8 w-8" title={t('dok.close')} aria-label={t('dok.close')} onClick={zavri} data-testid="chat-dok-zavrit"><X className="w-4 h-4" /></Button>}
        </div>
      </div>
      {odchod && (
        <div className="border-b bg-amber-500/10 px-3 py-2 text-xs flex flex-wrap items-center gap-2 shrink-0" data-testid="chat-dok-neulozeno">
          <span className="flex-1">{t('dok.unsaved')}</span>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setOdchod(null)}>{t('dok.keepEditing')}</Button>
          <Button size="sm" variant="destructive" className="h-7" onClick={zahodZmeny} data-testid="chat-dok-zahodit">{t('dok.discard')}</Button>
        </div>
      )}
      {A.dokId === PAMET
        ? <PametPohled />
        : A.dokId
        ? <Detail key={A.dokId} id={A.dokId} verze={A.dokVerze} zmenene={A.dokZmenene} hlidac={hlidac} onProjekt={naProjekt} onZpet={() => A.setDokId('')} onSmazano={() => { A.setDokId(''); A.obnovDokumenty(); }} />
        : <Seznam verze={A.dokVerze} onOtevri={(id) => A.setDokId(id)} skupina={skupina} setSkupina={setSkupina} q={q} setQ={setQ} />}
    </aside>
  );
}
