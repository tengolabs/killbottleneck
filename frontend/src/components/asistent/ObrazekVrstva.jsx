import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Download, Loader2, Maximize2, Minimize2, Pin, PinOff, RefreshCw, Trash2, X } from 'lucide-react';
import { useAsistent, DOK_MAX_W, sirkaDokumentu } from '@/lib/AsistentContext';
import { useSpodekHlavicky } from '@/hooks/useSpodekHlavicky';
import { obrazekPonechat, obrazekSmazat, obrazekVytvorit } from '@/api/asistentApi';
import { pb } from '@/api/pb';
import { saveBlob, safeFilename } from '@/lib/saveFile';

// Prohlížeč obrázku (4. 11. 2026, Richard: „ne nové okno — vidět ho vlevo místo mapy, nebo přes celou obrazovku jako
// akvárko a v rohu zavřít křížkem“). Stejný vzor jako relax: „vedle“ = levá část pod lištou až k Dokumentům / chatu
// (mapa pod tím zůstává namountovaná), „celá“ = přes celou obrazovku (z-[60]). Na úzkém okně (telefon) jen celá.
// Šipky listují obrázky téže karty / záložky; Esc zavře (dřív než Dokumenty — posluchač v zachytávací fázi).
// sprava (záložka Obrázky) přidá Ponechat natrvalo a Smazat; po změně volá onZmena (záložka se načte znovu).
// Položka se `src` (data URL) = strana / snímek dokumentu z Kanceláře (pozvánka, prezentace — Richard 4. 11. večer):
// zobrazí se stejně, jen bez Stáhnout (dokument má vlastní tlačítka PDF / PowerPoint / Word).
// Nakreslit znovu (sprava; Richard 4. 11. večer: „v jiném režimu šlo přegenerovat, tady ne“) = týž popis, nový seed,
// soubor se nahradí jako na kartě v chatu. Obrázek ve stránce ne (stránka drží adresu souboru — server vrátí 409).
const MIN_VEDLE = 360; // užší levá část = rovnou přes celou obrazovku

const Tlacitko = ({ onClick, title, testid, aktivni, disabled, children, className = '' }) => (
  <button type="button" onClick={onClick} title={title} aria-label={title} disabled={disabled} aria-pressed={aktivni === undefined ? undefined : !!aktivni}
    className={`inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium text-white transition-colors hover:bg-white/15 disabled:opacity-40 ${aktivni ? 'bg-white/20' : ''} ${className}`}
    data-testid={testid}>
    {children}
  </button>
);

const datum = (iso, lang) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString(lang); };

export default function ObrazekVrstva() {
  const { t, i18n } = useTranslation('asistent');
  const A = useAsistent();
  const p = A.prohlizec;
  const spodek = useSpodekHlavicky(true);
  const [okno, setOkno] = useState(() => window.innerWidth);
  useEffect(() => {
    const f = () => setOkno(window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const [cela, setCela] = useState(false);
  const [smazatPotvrdit, setSmazatPotvrdit] = useState(false);
  const [chyba, setChyba] = useState('');
  const [prace, setPrace] = useState(false);
  const [kresliId, setKresliId] = useState(''); // id kresleného (šipkami jde mezitím jinam)
  const polozky = (p && p.polozky) || [];
  const index = p ? Math.min(Math.max(0, p.index || 0), polozky.length - 1) : 0;
  const o = polozky[index];
  useEffect(() => { setSmazatPotvrdit(false); setChyba(''); }, [o && o.id]);

  const chatW = A.open ? A.width : 0;
  const dokW = A.open && A.dokOpen ? Math.min(DOK_MAX_W, sirkaDokumentu(okno, A.width, A.dokWidth)) : 0;
  const vedleMozne = okno >= 640 && okno - chatW - dokW >= MIN_VEDLE;
  const vedle = vedleMozne && !cela;

  const zavri = A.zavriObrazek;
  const posun = useCallback((d) => {
    if (polozky.length < 2) return;
    A.setProhlizec((x) => (x ? { ...x, index: (index + d + polozky.length) % polozky.length } : x));
  }, [A, index, polozky.length]);
  useEffect(() => {
    const f = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); zavri(); }
      else if (e.key === 'ArrowLeft') posun(-1);
      else if (e.key === 'ArrowRight') posun(1);
    };
    window.addEventListener('keydown', f, true);
    return () => window.removeEventListener('keydown', f, true);
  }, [zavri, posun]);

  const zmenPolozku = useCallback((nova) => {
    A.setProhlizec((x) => (x ? { ...x, polozky: x.polozky.map((y) => (y.id === nova.id ? { ...y, ...nova } : y)) } : x));
    if (p && p.onZmena) p.onZmena();
  }, [A, p]);
  const prepniTrvale = async () => {
    setPrace(true); setChyba('');
    try { zmenPolozku((await obrazekPonechat(o.id, !o.trvale)).obrazek); } catch (e) { setChyba(e.message); } finally { setPrace(false); }
  };
  const znovu = async () => {
    const id = o.id;
    setKresliId(id); setChyba('');
    try { zmenPolozku((await obrazekVytvorit(id, true)).obrazek); } catch (e) { setChyba(e.isTimeout ? t('img.timeout') : e.message); } finally { setKresliId(''); }
  };
  const smaz = async () => {
    setPrace(true); setChyba('');
    try {
      await obrazekSmazat(o.id);
      const zbyle = polozky.filter((y) => y.id !== o.id);
      if (p && p.onZmena) p.onZmena();
      if (!zbyle.length) zavri();
      else A.setProhlizec((x) => (x ? { ...x, polozky: zbyle, index: Math.min(index, zbyle.length - 1) } : x));
    } catch (e) { setChyba(e.message); setSmazatPotvrdit(false); } finally { setPrace(false); }
  };

  if (!o) return null;
  const src = o.src || (o.url ? pb.baseURL.replace(/\/$/, '') + o.url : '');
  const nazev = o.title || t('img.untitled');
  const stahni = async () => {
    try { const res = await fetch(src); await saveBlob(await res.blob(), `${safeFilename(nazev)}.jpg`); } catch (e) { setChyba(e.message); }
  };
  const lang = i18n.language || 'cs';
  const info = !p.sprava ? ''
    : o.pouziti && o.pouziti.length ? t('obr.pouzito', { kde: o.pouziti.map((x) => x.title || '?').join(', ') })
    : o.trvale ? t('obr.natrvalo')
    : o.smaze_se ? t('obr.smazeSe', { datum: datum(o.smaze_se, lang) }) : '';
  const kresli = !!kresliId && kresliId === o.id;
  const sirokyPruh = (vedle ? okno - chatW - dokW : okno) >= 760; // užší prohlížeč: jen ikona, ať zbyde místo na název
  const veStrance = !!(o.pouziti && o.pouziti.some((x) => x.druh === 'stranka'));
  const styl = vedle ? { top: spodek, left: 0, bottom: 0, right: chatW + dokW } : undefined;

  return (
    <div className={`${vedle ? 'fixed z-[41]' : 'fixed inset-0 z-[60]'} flex flex-col bg-[#0b0f14] text-white`} style={styl}
      role="dialog" aria-modal={vedle ? undefined : true} aria-label={nazev}
      data-testid="obrazek-vrstva" data-rozlozeni={vedle ? 'vedle' : 'cela'} data-id={o.id}>
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-white/10 bg-black/40 px-2">
        <p className="min-w-0 flex-1 truncate px-1 text-sm font-medium" data-testid="obrazek-vrstva-nazev">{nazev}</p>
        {polozky.length > 1 && (
          <>
            <Tlacitko onClick={() => posun(-1)} title={t('obr.predchozi')} testid="obrazek-vrstva-predchozi"><ChevronLeft className="w-4 h-4" /></Tlacitko>
            <span className="px-1 text-xs tabular-nums text-white/70" data-testid="obrazek-vrstva-poradi">{index + 1} / {polozky.length}</span>
            <Tlacitko onClick={() => posun(1)} title={t('obr.dalsi')} testid="obrazek-vrstva-dalsi"><ChevronRight className="w-4 h-4" /></Tlacitko>
            <span className="mx-0.5 h-5 w-px bg-white/20" aria-hidden="true" />
          </>
        )}
        {src && !o.src && <Tlacitko onClick={stahni} title={t('img.download')} testid="obrazek-vrstva-stahnout"><Download className="w-4 h-4" /></Tlacitko>}
        {p.sprava && (
          <>
            {!o.src && (
              <Tlacitko onClick={znovu} disabled={prace || !!kresliId || veStrance} title={veStrance ? t('obr.nelzeZnovu') : t('img.redraw')} testid="obrazek-vrstva-znovu">
                <RefreshCw className={`w-4 h-4 ${kresli ? 'animate-spin' : ''}`} />{sirokyPruh && <span>{t('img.redraw')}</span>}
              </Tlacitko>
            )}
            <Tlacitko onClick={prepniTrvale} disabled={prace} aktivni={!!o.trvale} title={o.trvale ? t('obr.zrusitNatrvalo') : t('obr.ponechat')} testid="obrazek-vrstva-natrvalo">
              {o.trvale ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
            </Tlacitko>
            {smazatPotvrdit
              ? <Tlacitko onClick={smaz} disabled={prace} title={t('obr.smazatPotvrdit')} testid="obrazek-vrstva-smazat-ano" className="bg-red-600/80 hover:bg-red-600">{t('obr.smazatPotvrdit')}</Tlacitko>
              : <Tlacitko onClick={() => setSmazatPotvrdit(true)} disabled={prace || !!(o.pouziti && o.pouziti.length)} title={o.pouziti && o.pouziti.length ? t('obr.nelzeSmazat') : t('obr.smazat')} testid="obrazek-vrstva-smazat"><Trash2 className="w-4 h-4" /></Tlacitko>}
          </>
        )}
        <span className="mx-0.5 h-5 w-px bg-white/20" aria-hidden="true" />
        {vedleMozne && (
          <Tlacitko onClick={() => setCela((c) => !c)} title={cela ? t('obr.vedle') : t('obr.cela')} aktivni={cela} testid="obrazek-vrstva-cela">
            {cela ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Tlacitko>
        )}
        <Tlacitko onClick={zavri} title={t('obr.zavrit')} testid="obrazek-vrstva-zavrit"><X className="w-5 h-5" /></Tlacitko>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-3">
        {src
          ? <img src={src} alt={nazev} className={`max-h-full max-w-full rounded-md object-contain shadow-2xl transition-opacity ${kresli ? 'opacity-40' : ''}`} data-testid="obrazek-vrstva-img" />
          : <p className="text-sm text-white/70">{o.chyba || t('img.failed')}</p>}
        {kresli && <span className="absolute inset-0 flex items-center justify-center gap-2 text-sm" data-testid="obrazek-vrstva-kreslim"><Loader2 className="w-5 h-5 animate-spin" />{t('img.drawing')}</span>}
      </div>
      {(info || chyba) && (
        <div className="shrink-0 border-t border-white/10 bg-black/40 px-3 py-2 text-xs">
          {info && <p className="text-white/75" data-testid="obrazek-vrstva-info">{info}</p>}
          {chyba && <p className="text-red-300" data-testid="obrazek-vrstva-chyba">{chyba}</p>}
        </div>
      )}
    </div>
  );
}
