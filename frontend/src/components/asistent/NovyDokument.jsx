// „Nový dokument“ (Kancelář, 1. 11. 2026) — formulář skládá APLIKACE (0 volání modelu): dlaždice druhu,
// pár polí, a hotová věta jde asistentovi jako běžná zpráva (vzor NovaStranka ze Stránek). Richard 1. 11.:
// „jen napsat ‚vytvoř prezentaci‘ nikoho nenapadne — udělej to jako Stránky, tlačítkem, a ať jde tvořit
// v každé podsekci“. Texty v líném ns `kancelar` (asistent.json jede i do lite, 543/560 kB).
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { useLazyNs } from '@/i18n/lazyNs';
import { base44 } from '@/api/base44Client';

// druh → pole formuláře (pořadí = pořadí na obrazovce). `n` = povinné; chips = volby z i18n `volby.<pole>`
const POLE = {
  presentation: [{ k: 'projekt' }, { k: 'publikum', chips: ['klient', 'vedeni', 'tym'] }, { k: 'doplneni', area: true }],
  greeting: [{ k: 'komu', n: true }, { k: 'prilezitost', chips: ['pf', 'vanoce', 'narozeniny', 'vyroci', 'podekovani', 'jine'] }, { k: 'podpis' }, { k: 'ton', chips: ['pratelsky', 'formalni', 'slavnostni'] }, { k: 'doplneni', area: true }],
  invitation: [{ k: 'akce', n: true }, { k: 'kdy' }, { k: 'kde' }, { k: 'odkaz' }, { k: 'podpis' }, { k: 'ton', chips: ['pratelsky', 'formalni', 'slavnostni'] }, { k: 'doplneni', area: true }],
  poster: [{ k: 'oCem', n: true, area: true }, { k: 'kdy' }, { k: 'kde' }, { k: 'doplneni', area: true }],
  certificate: [{ k: 'komu', n: true }, { k: 'zaCo', n: true }, { k: 'podpis' }, { k: 'ton', chips: ['formalni', 'slavnostni', 'pratelsky'] }, { k: 'doplneni', area: true }],
  email: [{ k: 'komu', ph: 'komuEmail' }, { k: 'oCem', n: true, area: true }, { k: 'projekt' }, { k: 'ton', chips: ['pratelsky', 'formalni'] }],
  meeting: [{ k: 'projekt' }, { k: 'oCem', area: true }],
  note: [{ k: 'oCem', n: true, area: true }],
  summary: [{ k: 'projekt' }, { k: 'doplneni', area: true }],
  faktura: [{ k: 'zadani', n: true, area: true }],
  volne: [{ k: 'zadani', n: true, area: true }],
};
export const DRUHY_NOVEHO = Object.keys(POLE);
// které dlaždice nabídnout podle filtru seznamu (prázdný stav i tlačítko Nový): '' = všechny
export const DRUHY_PRO_FILTR = {
  '': DRUHY_NOVEHO,
  kancelar: ['presentation', 'greeting', 'invitation', 'poster', 'certificate'],
  emaily: ['email'],
  poznamky: ['note', 'meeting'],
  sumare: ['summary'],
  faktury: ['faktura'],
};

export default function NovyDokument({ druh, mapId, onOdeslat, onZpet }) {
  const nsReady = useLazyNs('kancelar');
  const { t } = useTranslation('kancelar');
  const [vybrany, setVybrany] = useState(DRUHY_NOVEHO.includes(druh) ? druh : 'presentation');
  const [hodnoty, setHodnoty] = useState({});
  const [mapy, setMapy] = useState(null);
  const location = useLocation();
  const mapaZAdresy = mapId || (location.pathname.match(/^\/map\/([^/]+)/) || [])[1] || '';
  const [mapa, setMapa] = useState(mapaZAdresy);
  useEffect(() => {
    let zivy = true;
    base44.entities.GoalMap.list('-updated_date', 50)
      .then((rows) => { if (!zivy) return; const m = (rows || []).filter((x) => !x.archived && x.kind !== 'org'); setMapy(m); }) // mimo /map/:id nic nepředvybírat — u pozvánky by „Vycházej z projektu…“ šlo do zprávy omylem (/checkup 2. 11. 2026)
      .catch(() => { if (zivy) setMapy([]); });
    return () => { zivy = false; };
  }, []);
  if (!nsReady) return <Loader2 className="w-4 h-4 animate-spin m-3" />;
  const pole = POLE[vybrany];
  const h = (k) => (hodnoty[k] || '').trim();
  const nastav = (k, v) => setHodnoty((p) => ({ ...p, [k]: v }));
  const projekt = (mapy || []).find((m) => m.id === mapa);
  const muzeOdeslat = pole.every((p) => !p.n || h(p.k));
  const odeslat = () => {
    if (!muzeOdeslat) return;
    const casti = [t(`druhy.${vybrany}.zprava`)];
    for (const p of pole) {
      if (p.k === 'projekt') { casti.push(projekt ? t('veta.projekt', { v: projekt.title }) : t('veta.bezProjektu')); continue; }
      const v = h(p.k);
      if (!v) continue;
      casti.push(t(`veta.${p.k}`, { v: p.chips ? t(`volby.${p.k}.${v}`) : v }));
    }
    onOdeslat(casti.filter(Boolean).join(' '));
  };
  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="chat-dok-novy-form" data-druh={vybrany}>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">{t('intro')}</p>
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={t('druh')}>
          {DRUHY_NOVEHO.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={vybrany === d} onClick={() => setVybrany(d)}
              className={`text-left rounded-md border px-2.5 py-1.5 transition-colors ${vybrany === d ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary'}`}
              data-testid="chat-dok-druh" data-druh={d}>
              <span className="block text-xs font-medium">{t(`druhy.${d}.nazev`)}</span>
              <span className="block text-[11px] text-muted-foreground leading-snug">{t(`druhy.${d}.popis`)}</span>
            </button>
          ))}
        </div>
        {pole.map((p) => p.k === 'projekt' ? (
          <label key={p.k} className="block space-y-1">
            <span className="text-xs font-medium">{t('projekt')}</span>
            <select value={mapa} onChange={(e) => setMapa(e.target.value)} className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" data-testid="chat-dok-novy-projekt">
              <option value="">{mapy === null ? '…' : t('bezProjektuVolba')}</option>
              {(mapy || []).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </label>
        ) : p.chips ? (
          <div key={p.k} className="space-y-1">
            <span className="text-xs font-medium">{t(`pole.${p.k}`)}</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t(`pole.${p.k}`)}>
              {p.chips.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={h(p.k) === c} onClick={() => nastav(p.k, h(p.k) === c ? '' : c)}
                  className={`text-xs rounded-full border px-2.5 py-1 ${h(p.k) === c ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-secondary'}`}
                  data-testid={`chat-dok-novy-${p.k}`} data-volba={c}>
                  {t(`volby.${p.k}.${c}`)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <label key={p.k} className="block space-y-1">
            <span className="text-xs font-medium">{t(`pole.${p.k}`)}{!p.n && <span className="text-muted-foreground font-normal"> ({t('nepovinne')})</span>}</span>
            {p.area
              ? <Textarea value={hodnoty[p.k] || ''} onChange={(e) => nastav(p.k, e.target.value)} rows={3} className="text-sm" placeholder={t(`placeholder.${p.ph || p.k}`)} data-testid={`chat-dok-novy-${p.k}`} />
              : <Input value={hodnoty[p.k] || ''} onChange={(e) => nastav(p.k, e.target.value)} className="h-8 text-sm" placeholder={t(`placeholder.${p.ph || p.k}`)} data-testid={`chat-dok-novy-${p.k}`} />}
          </label>
        ))}
      </div>
      <div className="border-t px-3 py-2 flex items-center justify-end gap-2 shrink-0">
        <Button variant="ghost" size="sm" className="h-8" onClick={onZpet} data-testid="chat-dok-novy-zpet">{t('zpet')}</Button>
        <Button size="sm" className="h-8" disabled={!muzeOdeslat} onClick={odeslat} data-testid="chat-dok-novy-odeslat">{t('submit')}</Button>
      </div>
    </div>
  );
}
