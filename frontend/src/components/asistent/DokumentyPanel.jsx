import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { Brain, Check, ChevronLeft, Copy, Download, ExternalLink, Eye, EyeOff, FileText, FolderKanban, Gift, ImagePlus, Loader2, Mail, Pencil, Phone, Plus, Presentation, ScrollText, Search, Trash2, Undo2, Users, X, NotebookPen, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAsistent, DOK_MAX_W, PAMET, STRANKA, NOVY_DOK, sirkaDokumentu } from '@/lib/AsistentContext';
import NovyDokument, { DRUHY_PRO_FILTR } from './NovyDokument';
import PdfPohled from './PdfPohled';
import { useLazyNs } from '@/i18n/lazyNs';
import { useKbConfig } from '@/hooks/useKbConfig';
import { SeznamStranek, DetailStranky, NovaStranka, NOVA } from './StrankyPohled';
import { LayoutTemplate, Files } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { dokumenty as apiSeznam, dokument as apiDokument, dokumentUloz, dokumentVratit, dokumentSmazat } from '@/api/asistentApi';
import { saveBlob, safeFilename } from '@/lib/saveFile';
import PametPohled from './PametPohled';
import { FakturySeznam, FakturaDetail, FAKTURA_PREFIX } from './FakturaPohled';
import { useSpodekHlavicky } from '@/hooks/useSpodekHlavicky';
import { zacniTah } from '@/lib/tahSirky';

// Dokumenty asistenta (30. 9. 2026) — poznámky, koncepty e-mailů a sumáře, které
// asistent napsal (draft_text) nebo si uživatel založil sám. Richard: „jako když
// v Claude vidím plán vedle chatu“ → panel VLEVO od chatu, PŘES mapu (stránku
// neodsouvá, jen ji překryje). Na telefonu přes celou obrazovku nad chatem.
// Na počítači začíná POD horní lištou stránky: přes celou výšku zakrýval pravou část
// lišty (tlačítko asistenta, menu účtu, v editoru Sdílet/Export) — lišta musí zůstat klikací.
// Soukromé (vidí jen vlastník), e-mail jen koncept (Kopírovat / Otevřít v poště).
// Paměť asistenta (co asistent ČTE) je tu jako `dokId = PAMET` — vlastní tlačítko v hlavičce asistenta
// zrušeno 1. 10. 2026 (Richard); 2. 11. 2026 přesunuta z prvního místa na nenápadný řádek pod seznam.
// Nové dokumenty zakládá JEN asistent (Richard 1. 10. 2026, varianta A): ruční „Nová poznámka“
// by se tloukla se zásobníkem nápadů — úkoly v poznámce by z porad a plánování vypadly.

const IKONA = { note: NotebookPen, email: Mail, summary: ClipboardList, meeting: Users, call: Phone, other: ScrollText, presentation: Presentation, card: Gift };
// faktury (9. 10. 2026): vystavené faktury vedle dokumentů — jiný zdroj (/chat/faktury), stejné místo pro uživatele
const SKUPINY = ['', 'poznamky', 'emaily', 'sumare', 'kancelar', 'faktury'];
// kancelář (14. 10. 2026): pole mimo text podle druhu — prezentace podtitul + publikum, přání šablona, kdy, kde, odkaz, podpis
const META_POLE = { presentation: ['subtitle', 'audience'], card: ['date', 'place', 'link', 'signature'] };
const SABLONY = ['greeting', 'invitation', 'poster', 'certificate'];
const FOTKA_MAX = 4 * 1024 * 1024;
const PRAZDNA_META = {};
const stejnaMeta = (a, b) => JSON.stringify(a || PRAZDNA_META) === JSON.stringify(b || PRAZDNA_META);
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
function Seznam({ verze, onOtevri, onNova, skupina, setSkupina, q, setQ }) {
  const { t, i18n } = useTranslation('asistent');
  // názvy druhů pro čipy prázdného stavu (líný ns kancelar — stejné texty jako formulář Nový dokument)
  const kancReady = useLazyNs('kancelar');
  const { t: tk } = useTranslation('kancelar');
  const [hledat, setHledat] = useState('');
  const [rows, setRows] = useState(null);
  const [chyba, setChyba] = useState('');
  // hledání až po krátké pauze v psaní — ne dotaz na každé písmeno
  useEffect(() => { const h = setTimeout(() => setHledat(q.trim()), 250); return () => clearTimeout(h); }, [q]);
  useEffect(() => {
    let zivy = true;
    if (skupina === 'faktury') { setRows([]); return () => { zivy = false; }; }
    apiSeznam({ skupina, q: hledat })
      .then((r) => { if (zivy) { setRows(r.dokumenty || []); setChyba(''); } })
      .catch((e) => { if (zivy) { setRows((p) => p || []); setChyba(e.message || t('dok.errorLoad')); } });
    return () => { zivy = false; };
  }, [skupina, hledat, verze, t]);
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 pt-3 pb-2 space-y-2 border-b shrink-0">
        <div className="flex items-center gap-1.5">
        <div className="flex flex-wrap gap-1.5 flex-1" role="tablist">
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
          {/* Nový dokument tlačítkem jako u Stránek (Richard 1. 11. 2026) — v každé podsekci, předvolený druh podle filtru */}
          <Button size="sm" className="h-7 text-xs shrink-0" onClick={() => onNova((DRUHY_PRO_FILTR[skupina] || [])[0] || '')} data-testid="chat-dok-novy"><Plus className="w-3.5 h-3.5 mr-1" />{t('dok.novy')}</Button>
        </div>
        {skupina !== 'faktury' && <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dok.search')} className="h-8 pl-8 text-sm" data-testid="chat-dok-hledat" />
        </div>}
      </div>
      {skupina === 'faktury' ? <FakturySeznam verze={verze} onOtevri={onOtevri} /> : (
      <div className="flex-1 overflow-y-auto p-2 space-y-1" data-testid="chat-dok-seznam">
        {rows === null && <Loader2 className="w-4 h-4 animate-spin m-3" />}
        {chyba && <p className="text-xs text-destructive px-2">{chyba}</p>}
        {rows && rows.length === 0 && !chyba && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground" data-testid="chat-dok-prazdno">
            <FileText className="w-6 h-6 mx-auto mb-2 opacity-60" />
            <p>{hledat || skupina ? t('dok.emptyFiltered') : t('dok.empty')}</p>
            {/* čipy druhů místo věty „zkuste napsat…“ — jde na ně kliknout (1. 11. 2026) */}
            {!hledat && kancReady && (DRUHY_PRO_FILTR[skupina] || []).length > 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-1.5" data-testid="chat-dok-prazdno-sablony">
                {DRUHY_PRO_FILTR[skupina].filter((d) => d !== 'volne').map((d) => (
                  <button key={d} type="button" onClick={() => onNova(d)} className="text-xs rounded-full border border-primary/50 px-2.5 py-1 hover:bg-secondary text-foreground" data-testid="chat-dok-sablona-cip" data-druh={d}>
                    {tk(`druhy.${d}.nazev`)}
                  </button>
                ))}
              </div>
            )}
          </div>
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
        {/* paměť asistenta — nenápadný řádek AŽ POD seznamem, jen v „Vše“ bez hledání (Richard 2. 11. 2026:
            nahoře mátla a většina lidí ji vidět nepotřebuje) */}
        {!skupina && !hledat && (
          <button type="button" onClick={() => onOtevri(PAMET)} title={t('dok.memoryHint')} className="w-full text-left rounded-md px-2.5 py-1.5 mt-2 flex items-center gap-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors" data-testid="chat-dok-pamet">
            <Brain className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{t('dok.memory')}</span>
          </button>
        )}
      </div>
      )}
    </div>
  );
}

// Kancelář: stažení souboru (PDF / Word / PowerPoint), u přání šablona, barva a fotka, náhled první strany.
// Soubor vzniká v prohlížeči (lib/kancelar líně); fotka se drží jen v paměti panelu — nikam se neposílá.
// Šablona a barva se ukládají do meta dokumentu hned (jedna routa jako úprava textu).
function KancelarOvladani({ dok, onMeta, uklada }) {
  const { t, i18n } = useTranslation('asistent');
  const lang = i18n.language === 'en' ? 'en' : 'cs';
  const [formaty, setFormaty] = useState(null);
  const [beh, setBeh] = useState('');
  const [chyba, setChyba] = useState('');
  const [fotka, setFotka] = useState(null); // { bytes, name }
  const [nahled, setNahled] = useState(''); // data URL nebo ''
  const meta = dok.meta || PRAZDNA_META;
  const jeKarta = dok.kind === 'card';
  useEffect(() => { let z = true; import('@/lib/kancelar').then((K) => { if (z) setFormaty(K.formaty(dok.kind)); }); return () => { z = false; }; }, [dok.kind]);
  useEffect(() => { setNahled(''); }, [dok.updated, fotka]); // změna textu, barvy nebo fotky = starý náhled neplatí
  const stahni = async (format) => {
    if (beh) return;
    setBeh(format); setChyba('');
    try {
      const { stahniDokument } = await import('@/lib/kancelar/stahni');
      await stahniDokument(dok, format, { lang, barva: jeKarta ? meta.color || '' : '', fotka: fotka ? fotka.bytes : null });
    } catch { setChyba(t('dok.fileError')); }
    setBeh('');
  };
  const ukazNahled = async () => {
    if (nahled) { setNahled(''); return; }
    if (beh) return;
    setBeh('nahled'); setChyba('');
    try {
      const { nahledDokumentu } = await import('@/lib/kancelar/stahni');
      setNahled(await nahledDokumentu(dok, { lang, barva: jeKarta ? meta.color || '' : '', fotka: fotka ? fotka.bytes : null, sirka: 560 }));
    } catch { setChyba(t('dok.previewError')); }
    setBeh('');
  };
  const vyberFotku = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\/(png|jpe?g)$/i.test(f.type) || f.size > FOTKA_MAX) { setChyba(t('dok.photoBad')); return; }
    setChyba('');
    setFotka({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name });
  };
  return (
    <div className="rounded-md border border-border bg-secondary/40 px-2.5 py-2 space-y-2 text-xs" data-testid="chat-dok-kancelar">
      {jeKarta && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground">{t('dok.template')}:</span>
            <select value={SABLONY.includes(meta.template) ? meta.template : 'greeting'} disabled={uklada} onChange={(e) => onMeta({ ...meta, template: e.target.value })} className="h-7 rounded-md border border-input bg-background px-1.5 text-xs" data-testid="chat-dok-sablona">
              {SABLONY.map((sb) => <option key={sb} value={sb}>{t(`dok.templateName.${sb}`)}</option>)}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground">{t('dok.color')}:</span>
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(meta.color || '') ? meta.color : '#2563eb'} disabled={uklada} onChange={(e) => onMeta({ ...meta, color: e.target.value })} className="h-7 w-9 rounded-md border border-input bg-background p-0.5" data-testid="chat-dok-barva" aria-label={t('dok.color')} />
          </label>
          {meta.color && <button type="button" className="text-primary hover:underline" disabled={uklada} onClick={() => { const m = { ...meta }; delete m.color; onMeta(m); }} data-testid="chat-dok-barva-vzhled">{t('dok.colorSkin')}</button>}
          <label className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 cursor-pointer hover:bg-secondary">
            <ImagePlus className="w-3.5 h-3.5" />{fotka ? fotka.name : t('dok.photo')}
            <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={vyberFotku} data-testid="chat-dok-fotka" />
          </label>
          {fotka && <button type="button" className="text-primary hover:underline" onClick={() => setFotka(null)} data-testid="chat-dok-fotka-pryc">{t('dok.photoRemove')}</button>}
        </div>
      )}
      {jeKarta && <p className="text-[11px] text-muted-foreground">{t('dok.photoHint')}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">{t('dok.downloadAs')}:</span>
        {(formaty || []).map((f) => (
          <Button key={f} size="sm" variant="outline" className="h-7 px-2" disabled={!!beh} onClick={() => stahni(f)} data-testid={`chat-dok-soubor-${f}`}>
            {beh === f ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1" />}{f === 'pptx' ? 'PowerPoint' : f === 'docx' ? 'Word' : 'PDF'}
          </Button>
        ))}
        <Button size="sm" variant="ghost" className="h-7 px-2" disabled={!!beh && beh !== 'nahled'} onClick={ukazNahled} data-testid="chat-dok-nahled">
          {beh === 'nahled' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : nahled ? <EyeOff className="w-3.5 h-3.5 mr-1" /> : <Eye className="w-3.5 h-3.5 mr-1" />}{nahled ? t('dok.previewHide') : t('dok.preview')}
        </Button>
      </div>
      {nahled && <img src={nahled} alt={t('dok.previewAlt')} className="w-full rounded-md border border-border bg-white" data-testid="chat-dok-nahled-obrazek" />}
      {chyba && <p className="text-destructive" data-testid="chat-dok-kancelar-chyba">{chyba}</p>}
    </div>
  );
}

function Detail({ id, verze, zmenene, onZpet, onSmazano, hlidac, onProjekt }) {
  const { t, i18n } = useTranslation('asistent');
  const [dok, setDok] = useState(null);
  const [chyba, setChyba] = useState('');
  const [uprava, setUprava] = useState(false);
  const [pole, setPole] = useState({ title: '', text: '', email_to: '', email_subject: '', meta: PRAZDNA_META });
  const [uklada, setUklada] = useState(false);
  const [zkopirovano, setZkopirovano] = useState(false);
  const [potvrdSmazat, setPotvrdSmazat] = useState(false);
  const [hlaska, setHlaska] = useState('');
  const [cizi, setCizi] = useState(false); // asistent dokument změnil, zatímco ho uživatel upravuje
  const upravaRef = useRef(false);
  upravaRef.current = uprava;
  const zmeneno = !!dok && uprava && (['title', 'text', 'email_to', 'email_subject'].some((k) => (pole[k] || '') !== (dok[k] || '')) || !stejnaMeta(pole.meta, dok.meta));
  // panel se ptá před odchodem (Zpět / zavřít / jiný dokument), když jsou neuložené změny
  useEffect(() => { hlidac.current = zmeneno; return () => { hlidac.current = false; }; }, [zmeneno, hlidac]);

  // odpověď, která dorazí až po začátku úpravy, rozepsaný text NEpřepíše (checkup 1. 10.)
  const nacti = useCallback(async () => {
    try {
      const r = await apiDokument(id);
      if (upravaRef.current) { setCizi(true); return; }
      setDok(r.dokument); setChyba(''); setCizi(false);
      setPole({ title: r.dokument.title || '', text: r.dokument.text || '', email_to: r.dokument.email_to || '', email_subject: r.dokument.email_subject || '', meta: r.dokument.meta || PRAZDNA_META });
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

  const zacniUpravu = () => { if (!dok) return; setPole({ title: dok.title || '', text: dok.text || '', email_to: dok.email_to || '', email_subject: dok.email_subject || '', meta: dok.meta || PRAZDNA_META }); setUprava(true); setHlaska(''); };
  // šablona / barva z ovládání kanceláře: uloží se hned (meta celá), text se nemění
  const ulozMeta = async (meta) => {
    setUklada(true); setHlaska('');
    try { const r = await dokumentUloz({ id, meta }); setDok(r.dokument); } catch (e) { setHlaska(e.message || t('dok.errorSave')); }
    setUklada(false);
  };
  // QR odkaz kreslí jen pozvánka a plakát (pranicko.js) — u přání a diplomu pole neukazovat, jinak se vstup tiše ztratí (/checkup 2. 11. 2026)
  const metaPole = (META_POLE[dok ? dok.kind : ''] || []).filter((k) => k !== 'link' || !dok || !dok.meta || ['invitation', 'poster'].includes(dok.meta.template));
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
            {metaPole.map((k) => (
              <Input key={k} value={pole.meta[k] || ''} onChange={(e) => setPole((p) => ({ ...p, meta: { ...p.meta, [k]: e.target.value } }))} placeholder={t(`dok.meta.${k}`)} maxLength={300} data-testid={`chat-dok-meta-${k}`} />
            ))}
            {dok.kind === 'presentation' && <p className="text-[11px] text-muted-foreground">{t('dok.outlineHint')}</p>}
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
            {metaPole.some((k) => dok.meta && dok.meta[k]) && (
              <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded-md bg-secondary/60 px-2.5 py-1.5" data-testid="chat-dok-meta-cteni">
                {metaPole.filter((k) => dok.meta[k]).map((k) => <Fragment key={k}><dt className="text-muted-foreground">{t(`dok.meta.${k}`)}:</dt><dd className="break-words">{dok.meta[k]}</dd></Fragment>)}
              </dl>
            )}
            {/* kancelář: stažení souboru, u přání šablona / barva / fotka, náhled — pro všechny druhy (PDF + Word) */}
            <KancelarOvladani dok={dok} onMeta={ulozMeta} uklada={uklada} />
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
  // Stránky asistenta (14. 10. 2026): druhá záložka panelu (Moje | Tým); jen když instance stránky nabízí (config.pages, KB_PAGES=0 → nic)
  const { config } = useKbConfig();
  const strankyOn = !!(config && config.pages);
  const [zalozka, setZalozka] = useState('dokumenty');
  const [skupinaStr, setSkupinaStr] = useState('moje');
  const [qStr, setQStr] = useState('');
  const jeStranka = !!A.dokId && A.dokId.startsWith(STRANKA);
  // 'stranka:nova' / 'stranka:nova:<šablona>' = formulář nové stránky ze šablony (15. 10. 2026)
  const novaStranka = jeStranka && A.dokId.slice(STRANKA.length).split(':')[0] === NOVA;
  const novaSablona = novaStranka ? (A.dokId.split(':')[2] || '') : '';
  // otevření dokumentu z karty v chatu přepne na jeho záložku (jinak „Zpět“ ze záložky PDF vrátilo do PDF — /checkup 2. 11. 2026)
  useEffect(() => { if (jeStranka) setZalozka('stranky'); else if (A.dokId && A.dokId !== PAMET && !A.dokId.startsWith(NOVY_DOK)) setZalozka('dokumenty'); }, [A.dokId, jeStranka]);
  // 'novy' / 'novy:<druh>' = formulář Nový dokument (Kancelář, 1. 11. 2026)
  const novyDok = !!A.dokId && (A.dokId === NOVY_DOK || A.dokId.startsWith(NOVY_DOK + ':'));
  const novyDruh = novyDok ? (A.dokId.split(':')[1] || '') : '';
  const otevriNovy = useCallback((d) => A.setDokId(NOVY_DOK + (d ? ':' + d : '')), [A]);
  // záložky panelu Kancelář: Dokumenty | Stránky (když instance stránky má) | PDF — PDF sem přešlo z hlavičky chatu (Richard 1. 11. 2026: dvě ikonky „dokument“ a „složka“ mátly)
  const ZALOZKY = [['dokumenty', FileText, 'str.tabDocs'], ...(strankyOn ? [['stranky', LayoutTemplate, 'str.tabPages']] : []), ['pdf', Files, 'dok.tabPdf']];
  const zalozky = (
    <div className="flex items-center gap-1" role="tablist" data-testid="chat-dok-zalozky">
      {ZALOZKY.map(([z, Ik, klic]) => (
        <button key={z} type="button" role="tab" aria-selected={zalozka === z} onClick={() => setZalozka(z)}
          className={`text-sm font-semibold inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${zalozka === z ? 'bg-secondary' : 'text-muted-foreground hover:text-foreground'}`}
          data-testid="chat-dok-zalozka" data-zalozka={z}>
          <Ik className={`w-4 h-4 ${zalozka === z ? 'text-primary' : ''}`} />{t(klic)}
        </button>
      ))}
    </div>
  );
  const location = useLocation();
  const mapaZAdresy = (location.pathname.match(/^\/map\/([^/]+)/) || [])[1] || '';
  // zpráva složená formulářem jde do chatu přes žádost kontextu (panel chatu je líný, vyřídí ji, až je volný)
  const posliZpravu = useCallback((text) => { A.setDokId(''); A.spust('zprava', { text }); }, [A]);
  const [okno, setOkno] = useState(() => window.innerWidth);
  const spodek = useSpodekHlavicky();
  // neuložené změny hlídá kontext (A.hlidac / A.opatrne / A.odchod) — jde přes něj i samootevření,
  // karty v chatu, přepínač v hlavičce a minimalizace chatu (checkup 1. 10.)
  const { hlidac, opatrne, odchod, setOdchod, zahodZmeny } = A;
  useEffect(() => {
    const f = () => setOkno(window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  // otevřená faktura (z karty v chatu / po potvrzení) → filtr seznamu na Faktury, ať Zpět vede mezi faktury
  // dokId 'faktura:' bez id (proklik z Můj účet) = jen přepnout filtr na Faktury a ukázat seznam
  useEffect(() => { if (A.dokId && A.dokId.startsWith(FAKTURA_PREFIX)) { setSkupina('faktury'); if (A.dokId === FAKTURA_PREFIX) A.setDokId(''); } }, [A, A.dokId]);
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
  // tažení šířky: pointer capture + úklid i nad iframe relaxu (lib/tahSirky.js, 15. 10. 2026)
  const naTah = useCallback((e) => zacniTah(e, { sirka: A.dokWidth, nastav: A.setDokWidth }), [A]);
  // na úzkém okně se vejde, co zbude vedle chatu (48 px mapy vlevo nechat vidět)
  const sirka = sirkaDokumentu(okno, A.width, A.dokWidth);

  return (
    <aside
      // z-[45]: NAD relaxem „vedle“ (z-40, kreslí se později a Dokumenty dřív zakryl — klik-test 19. 10.), pod relaxem přes celou
      // obrazovku (z-[60]) a pod dialogy (z-50)
      // i na telefonu POD lištou (rozhodnutí Richarda 27. 10. 2026 „i na telefonu panel pod lištou“ platí i pro Dokumenty)
      className={mobil ? 'fixed left-0 right-0 bottom-0 z-50 flex flex-col bg-card' : 'fixed bottom-0 z-[45] flex flex-col bg-card border-l border-t shadow-2xl'}
      style={mobil ? { top: spodek } : { top: spodek, right: A.width, width: sirka, maxWidth: DOK_MAX_W }}
      data-testid="chat-dokumenty"
      aria-label={t('dok.kancelarTitle')}
    >
      {!mobil && (
        <div onPointerDown={naTah} title={t('resize')} data-testid="chat-dok-resize" className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30" />
      )}
      <div className="h-12 border-b flex items-center justify-between px-3 gap-2 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {mobil ? (
            <Button variant="ghost" size="sm" className="h-8 px-2 -ml-1" onClick={A.dokId ? zpet : zavri} data-testid="chat-dok-zpet-chat">
              <ChevronLeft className="w-4 h-4 mr-0.5" />{A.dokId ? (novyDok ? t('dok.back') : novaStranka ? t('str.nova') : jeStranka ? t('str.back') : t('dok.back')) : t('dok.backToChat')}
            </Button>
          ) : A.dokId ? (
            <Button variant="ghost" size="sm" className="h-8 px-2 -ml-1" onClick={zpet} data-testid="chat-dok-zpet"><ChevronLeft className="w-4 h-4 mr-0.5" />{novaStranka ? t('str.nova') : jeStranka ? t('str.back') : t('dok.back')}</Button>
          ) : zalozky}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!mobil && <Button variant="ghost" size="icon" className="h-8 w-8" title={t('dok.kancelarClose')} aria-label={t('dok.kancelarClose')} onClick={zavri} data-testid="chat-dok-zavrit"><X className="w-4 h-4" /></Button>}
        </div>
      </div>
      {mobil && !A.dokId && <div className="h-10 border-b flex items-center px-3 shrink-0">{zalozky}</div>}
      {odchod && (
        <div className="border-b bg-amber-500/10 px-3 py-2 text-xs flex flex-wrap items-center gap-2 shrink-0" data-testid="chat-dok-neulozeno">
          <span className="flex-1">{t('dok.unsaved')}</span>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setOdchod(null)}>{t('dok.keepEditing')}</Button>
          <Button size="sm" variant="destructive" className="h-7" onClick={zahodZmeny} data-testid="chat-dok-zahodit">{t('dok.discard')}</Button>
        </div>
      )}
      {A.dokId === PAMET
        ? <PametPohled />
        : novyDok
        ? <NovyDokument key={A.dokId} druh={novyDruh} mapId={mapaZAdresy} onOdeslat={posliZpravu} onZpet={() => A.setDokId('')} />
        : !A.dokId && zalozka === 'pdf'
        ? <PdfPohled onZpet={() => setZalozka('dokumenty')} onOpravit={A.funkcni ? (priloha) => A.spust('pdf_oprava', { priloha }) : undefined} loading={false} soubory={A.pdfSoubory} setSoubory={A.setPdfSoubory} />
        : novaStranka
        ? <NovaStranka key={A.dokId} sablona={novaSablona} mapId={mapaZAdresy} onOdeslat={posliZpravu} onZpet={() => A.setDokId('')} />
        : jeStranka
        ? <DetailStranky key={A.dokId} id={A.dokId.slice(STRANKA.length)} verze={A.dokVerze} zmenene={A.dokZmenene} onZpet={() => A.setDokId('')} onSmazano={() => { A.setDokId(''); A.obnovDokumenty(); }} />
        : !A.dokId && strankyOn && zalozka === 'stranky'
        ? <SeznamStranek verze={A.dokVerze} onOtevri={(id) => A.setDokId(STRANKA + id)} onNova={(s) => A.setDokId(STRANKA + NOVA + (s ? ':' + s : ''))} skupina={skupinaStr} setSkupina={setSkupinaStr} q={qStr} setQ={setQStr} />
        : A.dokId && A.dokId.startsWith(FAKTURA_PREFIX)
        ? <FakturaDetail key={A.dokId} id={A.dokId.slice(FAKTURA_PREFIX.length)} onZpet={() => { setSkupina('faktury'); A.setDokId(''); }} />
        : A.dokId
        ? <Detail key={A.dokId} id={A.dokId} verze={A.dokVerze} zmenene={A.dokZmenene} hlidac={hlidac} onProjekt={naProjekt} onZpet={() => A.setDokId('')} onSmazano={() => { A.setDokId(''); A.obnovDokumenty(); }} />
        : <Seznam verze={A.dokVerze} onOtevri={(id) => A.setDokId(id)} onNova={otevriNovy} skupina={skupina} setSkupina={setSkupina} q={q} setQ={setQ} />}
    </aside>
  );
}
