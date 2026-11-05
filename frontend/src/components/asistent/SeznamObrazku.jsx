import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ImageIcon, ImagePlus, Loader2, Pin, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAsistent } from '@/lib/AsistentContext';
import { obrazky as apiObrazky, obrazekNovy, obrazekVytvorit } from '@/api/asistentApi';
import { useAiModes } from '@/hooks/useAiEnabled';
import { pb } from '@/api/pb';

// Záložka Obrázky v Kanceláři (4. 11. 2026, Richard: „zasloužilo by si to solo kategorii“): všechny vlastní AI obrázky,
// nejnovější nahoře, hledání podle názvu / popisu. Klik = prohlížeč (ObrazekVrstva) se správou: natrvalo, smazat.
// Úklid (rozhodnutí Richarda 4. 11.): nepoužitý obrázek se smaže po 90 dnech, použitý v dokumentu / stránce nikdy.
// Nový obrázek (Richard 4. 11. večer: „v sekci obrázky chci mít možnost vytvořit nový obrázek“): popis → nakreslit → otevřít v prohlížeči.
// Formát podle účelu (prezentace, e-mail, příspěvek, story) a styl na klik; popis přepíše asistent na podrobný anglický
// (jako u obrázků v prezentaci). Formulář po nakreslení zůstane vyplněný,
// ať jde týž popis zkusit v jiném stylu (Nakreslit znovu = týž obrázek s jiným seedem je v prohlížeči).
const FORMATY = ['siroky', 'banner', 'ctverec', 'vysoky'];
const STYLY = ['malba', 'ilustrace', 'foto', 'kresleny', 'akvarel', 'skica', '3d']; // malba = výchozí (Richard 5. 11.), ilustrace = plochý vzhled z prezentací
const cip = (vybrano) => `rounded-full border px-2 py-0.5 transition-colors ${vybrano ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:text-foreground'}`;

function NovyObrazek({ onHotovo, onZavri }) {
  const { t } = useTranslation('asistent');
  const ai = useAiModes();
  const [popis, setPopis] = useState('');
  const [format, setFormat] = useState('ctverec');
  const [styl, setStyl] = useState('malba');
  const [text, setText] = useState('');
  const [kresli, setKresli] = useState(false);
  const [chyba, setChyba] = useState('');
  // zadaný, ale nenakreslený obrázek (brána vytížená / výpadek): Zkusit znovu se stejným zadáním jen dokreslí —
  // nový popis od modelu by stál tokeny znovu a v databázi by zůstal neviditelný nepovedený záznam (checkup 5. 11.)
  const [zadany, setZadany] = useState(null); // { klic, id }
  const nakresli = async () => {
    if (!popis.trim() || kresli) return;
    setKresli(true); setChyba('');
    const klic = JSON.stringify([popis.trim(), format, styl, text.trim()]);
    try {
      let id = zadany && zadany.klic === klic ? zadany.id : '';
      if (!id) {
        const z = await obrazekNovy({ prompt: popis.trim(), preset: format, styl, text: text.trim() });
        id = z.obrazek.id; setZadany({ klic, id });
      }
      const r = await obrazekVytvorit(id, false);
      setZadany(null);
      onHotovo(r.obrazek);
    } catch (e) { setChyba(e.message || t('img.failed')); }
    setKresli(false);
  };
  return (
    <div className="rounded-md border border-border bg-secondary/40 p-2 space-y-2 text-xs" data-testid="chat-obr-novy-formular">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{t('obr.novy')}</p>
        <button type="button" onClick={onZavri} title={t('obr.zavrit')} aria-label={t('obr.zavrit')} className="text-muted-foreground hover:text-foreground" data-testid="chat-obr-novy-zavrit"><X className="w-3.5 h-3.5" /></button>
      </div>
      <Textarea value={popis} onChange={(e) => setPopis(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) nakresli(); }}
        placeholder={t('obr.novyPopis')} maxLength={1000} disabled={kresli} className="min-h-[4.5rem] text-sm" data-testid="chat-obr-novy-popis" autoFocus />
      {ai.has('chat_draw_text') && (
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('obr.novyText')} maxLength={200} disabled={kresli} className="h-8 text-xs" data-testid="chat-obr-novy-text" />
      )}
      <div className="space-y-1">
        <p className="text-muted-foreground">{t('obr.format')}</p>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t('obr.format')}>
          {FORMATY.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={format === f} disabled={kresli} onClick={() => setFormat(f)}
              className={cip(format === f)} data-testid="chat-obr-novy-format" data-format={f}>
              {t(`obr.formatNazev.${f}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-muted-foreground">{t('obr.styl')}</p>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t('obr.styl')}>
          {STYLY.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={styl === s} disabled={kresli} onClick={() => setStyl(s)}
              className={cip(styl === s)} data-testid="chat-obr-novy-styl" data-styl={s}>
              {t(`obr.stylNazev.${s}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" className="h-7" disabled={!popis.trim() || kresli} onClick={nakresli} title={!popis.trim() ? t('obr.nejdrivPopis') : undefined} data-testid="chat-obr-novy-nakreslit">
          {kresli ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5 mr-1" />}{kresli ? t('obr.kreslim') : t('obr.nakreslit')}
        </Button>
      </div>
      {chyba && <p className="text-destructive" data-testid="chat-obr-novy-chyba">{chyba}</p>}
    </div>
  );
}

export default function SeznamObrazku() {
  const { t } = useTranslation('asistent');
  const A = useAsistent();
  const [q, setQ] = useState('');
  const [hledat, setHledat] = useState('');
  const [rows, setRows] = useState(null);
  const [dalsi, setDalsi] = useState(false);
  const [strana, setStrana] = useState(0);
  const [chyba, setChyba] = useState('');
  const [verze, setVerze] = useState(0);
  const [novy, setNovy] = useState(false);
  const [poNovem, setPoNovem] = useState(''); // id právě nakresleného → po načtení seznamu otevřít v prohlížeči
  useEffect(() => { const h = setTimeout(() => setHledat(q.trim()), 250); return () => clearTimeout(h); }, [q]);
  useEffect(() => { setStrana(0); }, [hledat]);
  useEffect(() => {
    let zivy = true;
    apiObrazky({ q: hledat, strana })
      .then((r) => { if (!zivy) return; setRows((p) => (strana ? [...(p || []), ...(r.obrazky || [])] : r.obrazky || [])); setDalsi(!!r.dalsi); setChyba(''); })
      .catch((e) => { if (zivy) { setRows((p) => p || []); setChyba(e.message); } });
    return () => { zivy = false; };
  }, [hledat, strana, verze]);
  // změna v prohlížeči (natrvalo / smazat) → načíst znovu od první strany
  const obnov = useCallback(() => { setStrana(0); setVerze((v) => v + 1); }, []);
  const hotove = (rows || []).filter((o) => o.stav === 'hotovo' && o.url);
  const otevri = useCallback((o) => A.otevriObrazek({ polozky: hotove, index: Math.max(0, hotove.findIndex((x) => x.id === o.id)), sprava: true, onZmena: obnov }), [A, hotove, obnov]);
  // nový obrázek: hledání pryč (jinak by v seznamu nemusel být), načíst znovu a otevřít ho; formulář zůstává (jiný styl)
  const poNakresleni = (o) => { setQ(''); setHledat(''); setPoNovem(o.id); obnov(); };
  useEffect(() => {
    if (!poNovem || !rows) return;
    const o = hotove.find((x) => x.id === poNovem);
    if (o) { setPoNovem(''); otevri(o); }
  }, [poNovem, rows, hotove, otevri]);

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="chat-obr-pohled">
      <div className="px-3 pt-3 pb-2 space-y-2 border-b shrink-0">
        {novy && <NovyObrazek onHotovo={poNakresleni} onZavri={() => setNovy(false)} />}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('obr.hledat')} className="h-8 pl-8 text-sm" data-testid="chat-obr-hledat" />
          </div>
          {!novy && <Button size="sm" className="h-8 text-xs shrink-0" onClick={() => setNovy(true)} data-testid="chat-obr-novy"><ImagePlus className="w-3.5 h-3.5 mr-1" />{t('obr.novy')}</Button>}
        </div>
        <p className="text-[11px] text-muted-foreground">{t('obr.uklidHint')}</p>
      </div>
      <div className="flex-1 overflow-y-auto p-2" data-testid="chat-obr-seznam">
        {rows === null && <Loader2 className="w-4 h-4 animate-spin m-3" />}
        {chyba && <p className="text-xs text-destructive px-2">{chyba}</p>}
        {rows && rows.length === 0 && !chyba && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground" data-testid="chat-obr-prazdno">
            <ImageIcon className="w-6 h-6 mx-auto mb-2 opacity-60" />
            <p>{hledat ? t('obr.prazdnoHledani') : t('obr.prazdno')}</p>
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
          {(rows || []).map((o) => {
            const hotovo = o.stav === 'hotovo' && o.url;
            const pouzito = o.pouziti && o.pouziti.length > 0;
            return (
              <button key={o.id} type="button" disabled={!hotovo} onClick={() => otevri(o)}
                className="group text-left rounded-lg border border-border bg-background/50 p-1.5 hover:border-primary/60 disabled:cursor-default transition-colors"
                data-testid="chat-obr-polozka" data-id={o.id} data-stav={o.stav} data-pouzito={pouzito ? '1' : '0'} data-trvale={o.trvale ? '1' : '0'}>
                <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-secondary">
                  {hotovo
                    ? <img src={pb.baseURL.replace(/\/$/, '') + o.url} alt={o.title || ''} loading="lazy" className="h-full w-full object-cover" />
                    : o.stav === 'chyba' ? <AlertTriangle className="w-4 h-4 text-muted-foreground" /> : <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                </div>
                <p className="mt-1 flex items-center gap-1 text-xs font-medium">
                  {o.trvale && <Pin className="w-3 h-3 shrink-0 text-primary" aria-label={t('obr.natrvalo')} />}
                  <span className="truncate">{o.title || t('img.untitled')}</span>
                </p>
                <p className="truncate text-[11px] text-muted-foreground" title={pouzito ? o.pouziti.map((x) => x.title).join(', ') : ''}>
                  {pouzito ? t('obr.pouzitoKratce', { kde: o.pouziti[0].title || '?' }) + (o.pouziti.length > 1 ? ` +${o.pouziti.length - 1}` : '') : new Date(o.created.replace(' ', 'T')).toLocaleDateString()}
                </p>
              </button>
            );
          })}
        </div>
        {dalsi && (
          <div className="mt-2 flex justify-center">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStrana((s) => s + 1)} data-testid="chat-obr-dalsi">{t('obr.nacistDalsi')}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
