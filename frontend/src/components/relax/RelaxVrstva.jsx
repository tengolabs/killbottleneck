import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bug, Columns2, Expand, Fish, Flower2, Lock, Maximize2, Minimize2, Plus, Timer, X } from 'lucide-react';
import { useAsistent, RELAX_SABLONY } from '@/lib/AsistentContext';
import { useAuth } from '@/lib/AuthContext';
import { useLazyNs } from '@/i18n/lazyNs';
import { useRelaxOdpocet, formatOdpocet, cinkni } from './useRelaxOdpocet';
import RelaxZamek from './RelaxZamek';

// Relax (Richard 14. 10. 2026): „pustí se akvárko nebo úl“ s odpočtem 5 / 15 minut.
// Dvě rozložení:
//   cela  — přes celou obrazovku (z-[60]: nad panelem asistenta, pod toasty); jde zamknout PINem a odejít od PC
//   vedle — vlevo od chatu místo mapy (stejný vzor jako DokumentyPanel: fixed, right = šířka chatu, pod hlavičkou),
//           mapa pod tím zůstává namountovaná, jen není vidět; v chatu se dál pracuje
// Scény = statické soubory public/relax/*.html od GPT Astra (1:1, jen embed dodatek) v iframe — cizí kód
// s globálními posluchači a styly zůstává izolovaný a do balíku aplikace nic nepřidává.
// Vrstva se montuje JEN když relax běží (App.jsx) → bez relaxu nulová zátěž.
const SOUBOR = { akvarium: 'akvarium', ul: 'vceli-ul', mraveniste: 'mraveniste' };
// výběr scén (Richard 15. 10.: větší tlačítka ve sloupci, bude jich víc) — sloupec vlevo uprostřed
const SCENY = [{ id: 'akvarium', Ikona: Fish, klic: 'scenaAkvarium' }, { id: 'ul', Ikona: Flower2, klic: 'scenaUl' }, { id: 'mraveniste', Ikona: Bug, klic: 'scenaMraveniste' }];
const VERZE = 1; // zvednout při změně souborů v public/relax (service worker je necachuje, prohlížeč ano)
const KLID_MS = 4000; // po 4 s bez pohybu myši lišta ztlumí (jen celá obrazovka)
export const NAD_PODIL = '40%'; // výška scény nad chatem na telefonu (panel asistenta začíná pod ní — AsistentPanel)

const Tlacitko = ({ onClick, title, testid, aktivni, disabled, children, className = '' }) => (
  <button type="button" onClick={onClick} title={title} aria-label={title} disabled={disabled} aria-pressed={aktivni === undefined ? undefined : !!aktivni}
    className={`inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium text-white transition-colors hover:bg-white/15 disabled:opacity-40 ${aktivni ? 'bg-white/20' : ''} ${className}`}
    data-testid={testid}>
    {children}
  </button>
);

export default function RelaxVrstva({ lite = false }) {
  const ready = useLazyNs('relax');
  const { t, i18n } = useTranslation('relax');
  const A = useAsistent();
  const { user } = useAuth();
  const r = A.relax;
  const [uzke, setUzke] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  // nízké okno = telefon na ležato (Richard 15. 10.: lišta a sloupec scén zabraly většinu místa) → lišta jako jeden pruh
  // nahoře s malými ikonami scén uvnitř, bez sloupce
  const [nizke, setNizke] = useState(() => typeof window !== 'undefined' && window.innerHeight < 500);
  useEffect(() => {
    const f = () => { setUzke(window.innerWidth < 640); setNizke(window.innerHeight < 500); };
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const pruh = uzke || nizke;
  const zamceno = !!(r && r.zamek);
  // dělené rozložení: na počítači „vedle“ (vlevo scéna, vpravo chat), na úzkém okně (telefon na výšku) „nad“ — scéna v horních
  // NAD_PODIL výšky, chat pod ní (Richard 15. 10.: „scéna menší“); ležící telefon je širší než 640 px → chová se jako počítač
  // lite (zjednodušené zobrazení) má vlastní stav otevření panelu (liteOpen) a panel vždy přes celou šířku → dělení jen „nad“
  const otevren = lite ? A.liteOpen : A.open;
  // telefon se ZMENŠENÝM panelem (lišta dole, chat-bar): scéna má zabrat všechno nad lištou, ne ji zakrýt — Richard 15. 10.:
  // „chtěl bych si zmenšit dolů jenom lištu asistenta, abych mohl posílat hlasovky a vidět akvárko“
  const [vyskaListy, setVyskaListy] = useState(0);
  useEffect(() => {
    if (!uzke || lite || otevren) { setVyskaListy(0); return undefined; }
    const el = document.querySelector('[data-testid="chat-bar"]');
    if (!el) { setVyskaListy(0); return undefined; }
    const zmer = () => setVyskaListy(Math.round(el.getBoundingClientRect().height));
    zmer();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(zmer) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, [uzke, lite, otevren, r && r.rozlozeni]);
  const nadListou = uzke && !lite && !otevren && A.dostupny && vyskaListy > 0;
  const vedleMozne = (otevren && A.dostupny && (uzke || lite || A.width > 0)) || nadListou;
  const vedle = !!r && r.rozlozeni === 'vedle' && vedleMozne && !zamceno;
  const nad = vedle && (uzke || lite);
  const scena = r && SOUBOR[r.scena] ? r.scena : 'akvarium';

  // iframe scény: po načtení pošle kb-relax-ready → prolnutí
  const iframe = useRef(null);
  const [nacteno, setNacteno] = useState(false);
  useEffect(() => {
    const f = (e) => { if (e.origin === window.location.origin && e.data && e.data.type === 'kb-relax-ready') setNacteno(true); };
    window.addEventListener('message', f);
    return () => window.removeEventListener('message', f);
  }, []);
  useEffect(() => { setNacteno(false); }, [scena, i18n.language]);
  // zámek: aplikace pod závěsem nesmí jít ovládat klávesnicí (Tab, zkratky stránek) — sourozenci vrstvy dostanou `inert`,
  // fokus drží PIN pole; po odemknutí/ukončení se atribut sundá (/checkup 15. 10.)
  const koren = useRef(null);
  useEffect(() => {
    if (!zamceno) return undefined;
    // vrstva sedí uvnitř #root → inert dostanou SOUROZENCI každého předka až k body (ne předci sami, ti by zneplatnili i vrstvu)
    const ostatni = [];
    for (let el = koren.current; el && el !== document.body; el = el.parentElement) {
      for (const s of el.parentElement ? el.parentElement.children : []) if (s !== el && !s.hasAttribute('inert')) ostatni.push(s);
    }
    ostatni.forEach((el) => el.setAttribute('inert', ''));
    return () => ostatni.forEach((el) => el.removeAttribute('inert'));
  }, [zamceno]);
  const posli = useCallback((akce) => {
    try { if (iframe.current && iframe.current.contentWindow) iframe.current.contentWindow.postMessage({ type: 'kb-relax', akce }, window.location.origin); } catch { /* iframe ještě není */ }
  }, []);

  // odpočet; doběhnutí = cinknutí + ztlumení scény + stav hotovo (zamčené zůstane zamčené)
  // konecV 0 = bez odpočtu (jen scéna); „+5“ pak odpočet teprve zapne
  const sOdpoctem = !!r && Number(r.konecV) > 0;
  const bezi = sOdpoctem && !r.hotovo;
  const zbyva = useRelaxOdpocet(r ? r.konecV : 0, bezi);
  const { upravRelax, ukonciRelax, prodluzRelax } = A;
  useEffect(() => {
    if (!bezi || zbyva > 0) return;
    cinkni();
    posli('ztlum');
    upravRelax({ hotovo: true });
  }, [bezi, zbyva, posli, upravRelax]);

  // lišta ztlumí po chvíli bez pohybu (celá obrazovka), pohyb ji vrátí
  const [klid, setKlid] = useState(false);
  const klidTimer = useRef(null);
  const pohyb = useCallback(() => {
    setKlid(false);
    if (klidTimer.current) clearTimeout(klidTimer.current);
    klidTimer.current = setTimeout(() => setKlid(true), KLID_MS);
  }, []);
  useEffect(() => { pohyb(); return () => { if (klidTimer.current) clearTimeout(klidTimer.current); }; }, [pohyb]);
  // pohyb myši NAD scénou dostává iframe, ne vrstva → stejný původ, posluchač přímo v dokumentu scény (po načtení)
  useEffect(() => {
    if (!nacteno) return undefined;
    let doc = null;
    try { doc = iframe.current && iframe.current.contentDocument; } catch { doc = null; }
    if (!doc) return undefined;
    doc.addEventListener('pointermove', pohyb);
    doc.addEventListener('pointerdown', pohyb);
    return () => { try { doc.removeEventListener('pointermove', pohyb); doc.removeEventListener('pointerdown', pohyb); } catch { /* dokument už není */ } };
  }, [nacteno, pohyb]);

  // celá obrazovka PROHLÍŽEČE (z vrstvy, ne z iframe); Esc ji ukončí, relax běží dál
  const [fsProhlizec, setFsProhlizec] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  const zpetVedle = !!(r && r.zpet === 'vedle');
  useEffect(() => {
    const f = () => {
      const fs = !!document.fullscreenElement;
      setFsProhlizec(fs);
      // Esc / odchod z celé obrazovky prohlížeče: dočasné zvětšení z „vedle“ se vrátí vedle chatu (Richard 15. 10.)
      if (!fs && zpetVedle) upravRelax({ rozlozeni: 'vedle', zpet: '', docasne: true });
    };
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, [zpetVedle, upravRelax]);
  const prepniFsProhlizece = useCallback(() => {
    try {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    } catch { /* prohlížeč bez podpory */ }
  }, []);
  const ukonci = useCallback(() => {
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch { /* nevadí */ }
    ukonciRelax();
  }, [ukonciRelax]);

  // zámek: 'nastavit' (dialog volby PINu) | 'odemknout' (pole PIN v zamčeném stavu) | ''
  const [pinRezim, setPinRezim] = useState('');
  useEffect(() => { if (!zamceno) setPinRezim((p) => (p === 'odemknout' ? '' : p)); }, [zamceno]);
  const sul = (user && user.id) || '';

  if (!r) return null;
  const ztlumeno = !!r.hotovo;
  // vedle: celá levá část od horního okraje (Richard 15. 10.: „na vodu je pruh aplikace, to ne“) — hlavička aplikace zůstává pod vrstvou
  const styl = nad ? (nadListou ? { top: 0, left: 0, right: 0, bottom: vyskaListy } : { top: 0, left: 0, right: 0, height: NAD_PODIL }) : vedle ? { top: 0, right: A.width, left: 0, bottom: 0 } : undefined;
  const tridy = vedle ? 'fixed z-40' : 'fixed inset-0 z-[60]';
  // na úzkém okně (telefon) má scéna vlastní hlavičku přes celou šířku → lišta je pruh NAD scénou, ne přes ni
  const lista = pruh
    ? 'absolute inset-x-0 top-0 z-10 flex h-11 items-center justify-center gap-1 overflow-x-auto bg-black/70 px-1'
    : 'absolute left-1/2 top-2 -translate-x-1/2 flex flex-wrap items-center gap-1 rounded-xl border border-white/15 bg-black/45 px-2 py-1 shadow-lg backdrop-blur-md';
  // v klidu (4 s bez pohybu myši, celá obrazovka) ztlumí jen TLAČÍTKA — odpočet zůstává čitelný (Richard 15. 10.: „nahoře to zšedne
  // a proto jsem neviděl odpočet času“)
  const ztlumit = !vedle && !pruh && klid && !pinRezim;
  const ovladani = `contents [&>*]:transition-opacity ${ztlumit ? '[&>*]:opacity-30' : ''}`;
  // iframe je nahrazovaný prvek: top+bottom mu výšku NEdá (zůstala by výchozích 150 px) → výška výslovně
  const ramIframe = pruh ? 'absolute inset-x-0 top-11 h-[calc(100%-2.75rem)]' : 'absolute inset-0 h-full';
  const minut = r.minut;

  return (
    <div ref={koren} className={`${tridy} overflow-hidden bg-[#06151a] text-white`} style={styl} onMouseMove={pohyb} onPointerDown={pohyb}
      data-testid="relax-vrstva" data-rozlozeni={nad ? 'nad' : vedle ? 'vedle' : 'cela'} data-nad-listou={nadListou ? '1' : '0'} data-scena={scena} data-hotovo={ztlumeno ? '1' : '0'} data-zamek={zamceno ? '1' : '0'} data-nacteno={nacteno ? '1' : '0'}>
      <iframe
        ref={iframe}
        key={scena}
        src={`/relax/${SOUBOR[scena]}${/^en/.test(i18n.language || '') ? '-en' : ''}.html?embed=1&v=${VERZE}`}
        title={t((SCENY.find((x) => x.id === scena) || SCENY[0]).klic)}
        allow="autoplay"
        className={`${ramIframe} w-full border-0 transition-opacity duration-500 ${nacteno ? (ztlumeno ? 'opacity-40' : 'opacity-100') : 'opacity-0'}`}
        data-testid="relax-iframe"
      />
      {!nacteno && <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-white/70" data-testid="relax-nacitam">{ready ? t('nacitam') : ''}</p>}

      {/* výběr scény: sloupec větších tlačítek u PRAVÉHO okraje uprostřed (všechny tři scény tam mají volno, vlevo má mraveniště
          vlastní panel), pevný tmavý podklad ať je vidět i na světlé scéně; na úzkém okně menší bez popisku; zamčeno = bez výběru */}
      {ready && !zamceno && !nizke && (
        <div className={`absolute right-2 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1.5 rounded-2xl border border-white/20 bg-[#0b1a1f]/85 p-1.5 shadow-lg backdrop-blur-md transition-opacity ${ztlumit ? 'opacity-40' : 'opacity-100'}`} data-testid="relax-sceny">
          {SCENY.map(({ id, Ikona, klic }) => (
            <button key={id} type="button" onClick={() => upravRelax({ scena: id })} title={t(klic)} aria-label={t(klic)} aria-pressed={scena === id}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-xl border transition-colors ${uzke ? 'h-11 w-11' : 'h-16 w-16'} ${scena === id ? 'border-white bg-white text-[#0b1a1f]' : 'border-white/15 bg-white/5 text-white/90 hover:bg-white/20'}`}
              data-testid={`relax-scena-${id}`}>
              <Ikona className={uzke ? 'w-5 h-5' : 'w-6 h-6'} />
              {!uzke && <span className="text-[10px] leading-tight">{t(klic)}</span>}
            </button>
          ))}
        </div>
      )}
      {/* lišta: odpočet, rozložení, +5 / šablony, zámek, celá obrazovka, konec — v zamčeném stavu jen odpočet */}
      {ready && (
        <div className={lista} data-testid="relax-lista">
          {sOdpoctem
            ? <span className="inline-flex items-center gap-1 px-2 font-mono text-sm tabular-nums" title={t('odpocet')} data-testid="relax-odpocet">{formatOdpocet(zbyva)}</span>
            : <span className="inline-flex items-center gap-1 px-2 text-xs text-white/80" title={t('bezOdpoctu')} data-testid="relax-bez-odpoctu"><Timer className="w-3.5 h-3.5" />{t('bezOdpoctu')}</span>}
          {!zamceno && (
            <span className={ovladani} data-testid="relax-ovladani" data-ztlumeno={ztlumit ? '1' : '0'}>
              {nizke && (
                <>
                  <span className="mx-0.5 h-5 w-px bg-white/20" aria-hidden="true" />
                  {SCENY.map(({ id, Ikona, klic }) => (
                    <Tlacitko key={id} onClick={() => upravRelax({ scena: id })} title={t(klic)} testid={`relax-scena-${id}`} aktivni={scena === id}><Ikona className="w-4 h-4" /></Tlacitko>
                  ))}
                </>
              )}
              <span className="mx-0.5 h-5 w-px bg-white/20" aria-hidden="true" />
              {/* šablony odpočtu (Richard 15. 10. 2026): bez odpočtu 5 · 15 · 30, s odpočtem +5 */}
              {sOdpoctem
                ? <Tlacitko onClick={() => prodluzRelax(5)} title={t('prodlouzit')} testid="relax-prodlouzit"><Plus className="w-3.5 h-3.5" />5</Tlacitko>
                : RELAX_SABLONY.map((m) => <Tlacitko key={m} onClick={() => prodluzRelax(m)} title={t('odpocetMin', { count: m })} testid={`relax-odpocet-${m}`}>{m}</Tlacitko>)}
              {vedleMozne && (
                <Tlacitko onClick={() => upravRelax(vedle ? { rozlozeni: 'cela', zpet: 'vedle', docasne: true } : { rozlozeni: 'vedle', zpet: '' })} title={vedle ? t('rozlozeniCela') : t(uzke || lite ? 'rozlozeniNad' : 'rozlozeniVedle')} testid="relax-rozlozeni" aktivni={vedle}>
                  {vedle ? <Maximize2 className="w-4 h-4" /> : <Columns2 className="w-4 h-4" />}
                </Tlacitko>
              )}
              <Tlacitko onClick={() => { if (vedle) upravRelax({ rozlozeni: 'cela', zpet: 'vedle', docasne: true }); prepniFsProhlizece(); }} title={fsProhlizec ? t('prohlizecZpet') : t('prohlizecCela')} testid="relax-cela-obrazovka" aktivni={fsProhlizec}>
                {fsProhlizec ? <Minimize2 className="w-4 h-4" /> : <Expand className="w-4 h-4" />}
              </Tlacitko>
              <Tlacitko onClick={() => setPinRezim('nastavit')} title={t('zamknout')} testid="relax-zamknout"><Lock className="w-4 h-4" /></Tlacitko>
              <span className="mx-0.5 h-5 w-px bg-white/20" aria-hidden="true" />
              {zpetVedle
                ? <Tlacitko onClick={() => { try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch { /* nevadí */ } upravRelax({ rozlozeni: 'vedle', zpet: '', docasne: true }); }} title={t(uzke || lite ? 'zpetNad' : 'zpetVedle')} testid="relax-zpet-vedle"><Minimize2 className="w-4 h-4" /></Tlacitko>
                : <Tlacitko onClick={ukonci} title={t('konec')} testid="relax-konec"><X className="w-4 h-4" /></Tlacitko>}
            </span>
          )}
          {zamceno && (
            <>
              <span className="mx-0.5 h-5 w-px bg-white/20" aria-hidden="true" />
              <span className="inline-flex items-center gap-1 px-1 text-xs text-white/80" data-testid="relax-zamceno"><Lock className="w-3.5 h-3.5" />{t('zamceno')}</span>
              {pinRezim !== 'odemknout' && <Tlacitko onClick={() => setPinRezim('odemknout')} title={t('odemknout')} testid="relax-odemknout">{t('odemknout')}</Tlacitko>}
            </>
          )}
        </div>
      )}

      {/* volba PINu / odemykání */}
      {ready && pinRezim === 'nastavit' && !zamceno && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30" data-testid="relax-zamek-dialog">
          <RelaxZamek rezim="nastavit" relax={r} sul={sul} onNastav={(otisk) => { upravRelax({ zamek: otisk, pokusy: 0, blokDo: 0, ...(vedle ? { rozlozeni: 'cela', zpet: 'vedle', docasne: true } : {}) }); setPinRezim(''); }} onZrusit={() => setPinRezim('')} />
        </div>
      )}
      {ready && zamceno && pinRezim === 'odemknout' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <RelaxZamek rezim="odemknout" relax={r} sul={sul} onOdemknuto={() => { upravRelax({ zamek: '', pokusy: 0, blokDo: 0, ...(zpetVedle ? { rozlozeni: 'vedle', zpet: '', docasne: true } : {}) }); setPinRezim(''); }} onPokus={(patch) => upravRelax(patch)} onZrusit={() => setPinRezim('')} />
        </div>
      )}

      {/* doběhnutí: scéna ztlumená, nabídka návratu (zamčené → nejdřív odemknout) */}
      {ready && ztlumeno && !zamceno && pinRezim !== 'nastavit' && (
        <div className="absolute inset-x-0 bottom-10 flex justify-center px-4">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/20 bg-black/55 px-6 py-4 shadow-2xl backdrop-blur-md" data-testid="relax-hotovo">
            <p className="text-base font-medium">{t('hotovoTitle')}</p>
            <p className="text-sm text-white/80">{t('hotovoHint', { count: minut })}</p>
            <div className="flex items-center gap-2">
              {/* Richard 15. 10.: „Pokračuji“ se četlo jako pokračovat v relaxu → „Zpět k práci“ + „Relaxovat dál“ (bez odpočtu) */}
              <button type="button" onClick={ukonci} className="rounded-lg bg-white/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-white" data-testid="relax-pokracuji">{t('pokracuji')}</button>
              <button type="button" onClick={() => prodluzRelax(5)} className="rounded-lg border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10" data-testid="relax-jeste">{t('jeste5')}</button>
              <button type="button" onClick={() => { upravRelax({ konecV: 0, hotovo: false }); posli('pokracuj'); }} className="rounded-lg border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10" data-testid="relax-dal">{t('dal')}</button>
            </div>
          </div>
        </div>
      )}
      {ready && ztlumeno && zamceno && pinRezim !== 'odemknout' && (
        <div className="absolute inset-x-0 bottom-10 flex justify-center px-4">
          <button type="button" onClick={() => setPinRezim('odemknout')} className="rounded-2xl border border-white/20 bg-black/55 px-6 py-3 text-sm shadow-2xl backdrop-blur-md hover:bg-black/70" data-testid="relax-hotovo-zamceno">
            {t('hotovoTitle')} · {t('odemknout')}
          </button>
        </div>
      )}
    </div>
  );
}
