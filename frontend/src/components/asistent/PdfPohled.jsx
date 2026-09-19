import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Bot, ChevronLeft, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveBlob, saveBlobs, safeFilename } from '@/lib/saveFile';

// Záložka PDF v panelu asistenta (18. 9. 2026): sloučit, rozdělit, vyjmout a odebrat
// strany — všechno v prohlížeči (pdf-lib přes lib/pdf, líně), soubor nikam
// neodchází a nic to nestojí. „Opravit s asistentem“ přečte text stran (pdf.js)
// a předá ho do chatu jako přílohu; sám soubor zůstane v paměti prohlížeče pro
// kartu opravy. Bez otáčení a miniatur (rozhodnutí Richarda 18. 9.).

const nazevBez = (name) => String(name || '').replace(/\.pdf$/i, '');
const nazevVystupu = (zaklad, pripona) => `${safeFilename(zaklad, 'dokument')}${pripona}.pdf`;

// `soubory`/`setSoubory` drží PANEL (přepnutí do chatu a zpět by jinak seznam vymazalo)
export default function PdfPohled({ onZpet, onOpravit, loading, soubory, setSoubory }) {
  const { t } = useTranslation('asistent');
  const [rozsah, setRozsah] = useState('');
  const [akce, setAkce] = useState('');         // právě běžící akce (sloucit | rozdelit | vyjmout | odebrat | opravit)
  const [chyba, setChyba] = useState('');
  const [hotovo, setHotovo] = useState('');
  const [pretahuje, setPretahuje] = useState(false);
  const inputRef = useRef(null);
  const nactiLib = () => import('@/lib/pdf'); // dynamický import si modul cachuje sám
  const zivy = useRef(true);
  useEffect(() => () => { zivy.current = false; }, []);

  const pridej = useCallback(async (files) => {
    const nove = [...(files || [])].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!nove.length) { setChyba('neniPdf'); return; }
    setChyba(''); setHotovo('');
    const polozky = nove.map((f) => ({ id: `${f.name}-${f.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, file: f, name: f.name, pages: 0, chyba: '' }));
    setSoubory((s) => [...s, ...polozky]);
    try {
      const P = await nactiLib();
      for (const p of polozky) {
        try {
          const n = await P.pocetStran(p.file);
          if (zivy.current) setSoubory((s) => s.map((x) => (x.id === p.id ? { ...x, pages: n } : x)));
        } catch (e) {
          if (zivy.current) setSoubory((s) => s.map((x) => (x.id === p.id ? { ...x, chyba: e && e.kod ? e.kod : 'poskozeno' } : x)));
        }
      }
    } catch { setChyba('poskozeno'); }
  }, [setSoubory]);
  const odeber = (id) => setSoubory((s) => s.filter((x) => x.id !== id));
  const posun = (id, smer) => setSoubory((s) => {
    const i = s.findIndex((x) => x.id === id);
    const j = i + smer;
    if (i < 0 || j < 0 || j >= s.length) return s;
    const out = [...s]; [out[i], out[j]] = [out[j], out[i]]; return out;
  });

  const platne = soubory.filter((s) => s.pages > 0 && !s.chyba);
  const prvni = platne[0];
  const bezi = !!akce;

  const spust = async (jaka, fn) => {
    setAkce(jaka); setChyba(''); setHotovo('');
    try {
      const P = await nactiLib();
      const vysledek = await fn(P);
      if (zivy.current) setHotovo(vysledek);
    } catch (e) {
      if (zivy.current) setChyba(e && e.kod ? e.kod : 'poskozeno');
    } finally {
      if (zivy.current) setAkce('');
    }
  };
  const sloucit = () => spust('sloucit', async (P) => {
    const blob = await P.sloucit(platne.map((s) => s.file));
    await saveBlob(blob, nazevVystupu(nazevBez(prvni.name), '-slouceno'));
    return t('pdf.doneMerge', { count: platne.length });
  });
  // rozsahy podle políčka; prázdné = každá strana zvlášť
  const rozsahy = (P) => (rozsah.trim() ? P.parsujRozsahy(rozsah, prvni.pages) : P.poJedne(prvni.pages));
  const rozdelit = () => spust('rozdelit', async (P) => {
    const r = rozsahy(P);
    const bloby = await P.rozdelit(prvni.file, r);
    await saveBlobs(bloby.map((blob, i) => ({ blob, filename: nazevVystupu(nazevBez(prvni.name), `-str-${P.popisRozsahu(r[i])}`) })));
    return t('pdf.doneSplit', { count: bloby.length });
  });
  const vyjmout = () => spust('vyjmout', async (P) => {
    const r = P.parsujRozsahy(rozsah, prvni.pages);
    await saveBlob(await P.vyjmout(prvni.file, r), nazevVystupu(nazevBez(prvni.name), `-str-${r.map(P.popisRozsahu).join('_')}`));
    return t('pdf.doneExtract');
  });
  const odebrat = () => spust('odebrat', async (P) => {
    const r = P.parsujRozsahy(rozsah, prvni.pages);
    await saveBlob(await P.odebrat(prvni.file, r), nazevVystupu(nazevBez(prvni.name), '-bez-stran'));
    return t('pdf.doneRemove');
  });
  const opravit = () => spust('opravit', async (P) => {
    onOpravit(await P.prilohaPdf(prvni.file));
    return '';
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 p-3 gap-2 overflow-y-auto" data-testid="chat-pdf">
      <button type="button" onClick={onZpet} className="self-start inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="chat-pdf-zpet">
        <ChevronLeft className="w-3.5 h-3.5" />{t('memoryBack')}
      </button>
      <h3 className="text-sm font-semibold">{t('pdf.title')}</h3>
      <p className="text-xs text-muted-foreground">{t('pdf.hint')}</p>
      <div
        className={`rounded-lg border border-dashed p-3 text-center text-xs ${pretahuje ? 'border-primary bg-primary/5' : 'border-border'}`}
        onDragOver={(e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setPretahuje(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPretahuje(false); }}
        onDrop={(e) => { if (![...(e.dataTransfer?.types || [])].includes('Files')) return; e.preventDefault(); setPretahuje(false); pridej(e.dataTransfer.files); }}
        data-testid="chat-pdf-drop"
      >
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" data-testid="chat-pdf-input" onChange={(e) => { pridej(e.target.files); e.target.value = ''; }} />
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => inputRef.current?.click()} disabled={bezi} data-testid="chat-pdf-vybrat">
          <Upload className="w-3.5 h-3.5 mr-1" />{t('pdf.add')}
        </Button>
        <p className="mt-1.5 text-muted-foreground">{t('pdf.dropHint')}</p>
      </div>
      {soubory.length > 0 && (
        <ul className="space-y-1" data-testid="chat-pdf-seznam">
          {soubory.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs" data-testid="chat-pdf-soubor">
              <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="truncate flex-1" title={s.name}>{s.name}</span>
              <span className="text-muted-foreground shrink-0" data-testid="chat-pdf-strany">{s.chyba ? t(`pdf.chyba.${s.chyba}`, { defaultValue: t('pdf.chyba.poskozeno') }) : s.pages ? t('pdf.pages', { count: s.pages }) : <Loader2 className="w-3 h-3 animate-spin" />}</span>
              {soubory.length > 1 && (
                <>
                  <button type="button" className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === 0} onClick={() => posun(s.id, -1)} title={t('pdf.up')} data-testid="chat-pdf-nahoru"><ArrowUp className="w-3.5 h-3.5" /></button>
                  <button type="button" className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === soubory.length - 1} onClick={() => posun(s.id, 1)} title={t('pdf.down')} data-testid="chat-pdf-dolu"><ArrowDown className="w-3.5 h-3.5" /></button>
                </>
              )}
              <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => odeber(s.id)} title={t('pdf.remove')} data-testid="chat-pdf-odebrat"><Trash2 className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      {platne.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border p-2.5" data-testid="chat-pdf-akce">
          <Button size="sm" className="w-full h-8 text-xs" disabled={bezi || platne.length < 2} onClick={sloucit} data-testid="chat-pdf-sloucit">
            {akce === 'sloucit' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}{t('pdf.merge', { count: platne.length })}
          </Button>
          <div className="pt-1 border-t border-border">
            <p className="text-xs font-medium">{t('pdf.firstFile', { name: prvni.name, count: prvni.pages })}</p>
            <Input value={rozsah} onChange={(e) => setRozsah(e.target.value)} placeholder={t('pdf.rangePlaceholder')} className="h-8 text-xs mt-1.5" data-testid="chat-pdf-rozsah" />
            <p className="text-[11px] text-muted-foreground mt-1">{t('pdf.rangeHint')}</p>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={bezi} onClick={rozdelit} data-testid="chat-pdf-rozdelit">{akce === 'rozdelit' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('pdf.split')}</Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={bezi || !rozsah.trim()} onClick={vyjmout} data-testid="chat-pdf-vyjmout">{akce === 'vyjmout' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('pdf.extract')}</Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={bezi || !rozsah.trim()} onClick={odebrat} data-testid="chat-pdf-odebrat-strany">{akce === 'odebrat' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('pdf.removePages')}</Button>
            </div>
          </div>
          <div className="pt-1 border-t border-border">
            <Button size="sm" variant="secondary" className="w-full h-8 text-xs" disabled={bezi || loading} onClick={opravit} data-testid="chat-pdf-opravit">
              {akce === 'opravit' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Bot className="w-3.5 h-3.5 mr-1 text-primary" />}{t('pdf.fixWithAssistant')}
            </Button>
            <p className="text-[11px] text-muted-foreground mt-1">{t('pdf.fixHint')}</p>
          </div>
        </div>
      )}
      {chyba && <p className="text-xs text-destructive" data-testid="chat-pdf-chyba">{t(`pdf.chyba.${chyba}`, { defaultValue: t('pdf.chyba.poskozeno') })}</p>}
      {hotovo && <p className="text-xs text-emerald-600 dark:text-emerald-400" data-testid="chat-pdf-hotovo">{hotovo}</p>}
      <p className="text-[11px] text-muted-foreground mt-auto pt-2">{t('pdf.privacy')}</p>
    </div>
  );
}
