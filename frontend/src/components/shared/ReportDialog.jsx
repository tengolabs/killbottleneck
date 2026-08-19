import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Bug, Lightbulb, Loader2, Send, Check } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { pb } from '@/api/pb';
import { useTranslation } from 'react-i18next';
import { useLazyNs } from '@/i18n/lazyNs';

// Nahlásit chybu nebo nápad provozovateli (Richard 18. 8. 2026).
//
// Dialog se nabízí JEN tam, kde je kam poslat — podle `report_enabled`
// z /api/kb/config, které je pravdivé pouze s nastaveným KB_REPORT_TO.
// V cizím self-hostu položka v menu vůbec není.
//
// Co se odesílá, je VIDĚT PŘED ODESLÁNÍM. U produktu, který prodává soukromí
// dat, nesmí aplikace potichu sbírat kontext — proto je adresa, verze
// a stránka vypsaná v dialogu, ne jen v mailu.
// Ze systémové cesty udělá název, který člověk pozná. Není to k výběru —
// je to poznámka, kde byl, když psal (Richard 18. 8. 2026 se ptal, proč to
// nejde zvolit; nabídka pod panáčkem je všude, takže cestu bere aplikace sama).
function nazevStranky(cesta, t) {
  const c = String(cesta || '/');
  if (c.startsWith('/map/')) return t('report.stranky.mapa');
  if (c.startsWith('/lite')) return t('report.stranky.lite');
  const znamy = t(`report.stranky.${c}`, { defaultValue: '' });
  return znamy || t('report.stranky.jina');
}

export default function ReportDialog({ open, onClose, userEmail, version }) {
  const { t } = useTranslation('popis');
  const nsReady = useLazyNs('popis');
  const [druh, setDruh] = useState('chyba');
  const [text, setText] = useState('');
  const [odesilam, setOdesilam] = useState(false);
  const [hotovo, setHotovo] = useState(false);
  const [chyba, setChyba] = useState('');
  const [historie, setHistorie] = useState(null);   // null = ještě nenačteno

  // Vlastní hlášení — ať člověk nehlásí podruhé totéž. RLS pustí jen jeho
  // vlastní záznamy, takže se čte kolekce přímo, bez další routy.
  const nactiHistorii = () => {
    pb.collection('reports')
      .getList(1, 5, { sort: '-created' })
      .then((r) => setHistorie(r.items || []))
      .catch(() => setHistorie([]));   // starší instance kolekci nemá — seznam se prostě neukáže
  };
  useEffect(() => { if (open) nactiHistorii(); }, [open]);

  const reset = () => { setDruh('chyba'); setText(''); setHotovo(false); setChyba(''); setOdesilam(false); };
  const zavri = () => { reset(); onClose(); };

  const odesli = async () => {
    if (text.trim().length < 5 || odesilam) return;
    setOdesilam(true);
    setChyba('');
    try {
      await base44.reportIssue({
        kind: druh,
        text: text.trim(),
        page: window.location.pathname,
        browser: navigator.userAgent,
      });
      setHotovo(true);
      nactiHistorii();
    } catch (err) {
      setChyba(err?.response?.error || err?.message || t('report.chybaObecna'));
    } finally {
      setOdesilam(false);
    }
  };

  if (!nsReady) return null;

  const druhy = [
    { id: 'chyba', ikona: Bug, popis: t('report.druhChyba') },
    { id: 'napad', ikona: Lightbulb, popis: t('report.druhNapad') },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) zavri(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="w-4 h-4 text-primary" />
            {t('report.titulek')}
          </DialogTitle>
          <DialogDescription>{t('report.uvod')}</DialogDescription>
        </DialogHeader>

        {hotovo ? (
          <div className="py-4 flex items-center gap-2 text-sm">
            <Check className="w-4 h-4 text-green-600 shrink-0" />
            {t('report.odeslano')}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              {druhy.map(({ id, ikona: Ikona, popis }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDruh(id)}
                  data-report-druh={id}
                  className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                    druh === id ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-muted-foreground/30'
                  }`}
                >
                  <Ikona className="w-4 h-4" />
                  {popis}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-text">
                {druh === 'napad' ? t('report.popisNapad') : t('report.popisChyba')}
              </Label>
              <Textarea
                id="report-text"
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 5000))}
                placeholder={druh === 'napad' ? t('report.placeholderNapad') : t('report.placeholderChyba')}
                rows={6}
              />
            </div>

            {/* co odejde spolu se zprávou — žádné tiché sbírání údajů */}
            <div className="rounded-md border bg-muted/30 px-2.5 py-2 space-y-0.5">
              <p className="text-[11px] font-medium text-muted-foreground">{t('report.coOdejde')}</p>
              <ul className="text-[11px] text-muted-foreground space-y-0.5">
                {userEmail && <li>· {userEmail}</li>}
                <li>· {window.location.host}{version ? ` (${version})` : ''}</li>
                <li>· {t('report.coOdejdeStranka')}: {nazevStranky(window.location.pathname, t)}</li>
                {/* prohlížeč se posílá taky — když se to nevypíše, je slib „vidíte,
                    co odejde" jen půlpravda (nález panelu 19. 8. 2026) */}
                <li className="truncate" title={navigator.userAgent}>· {t('report.coOdejdeProhlizec')}</li>
              </ul>
            </div>

            {chyba && <p className="text-sm text-red-600 dark:text-red-400">{chyba}</p>}

            {historie !== null && historie.length > 0 && (
              <div className="pt-1" data-report-historie>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">{t('report.uzMate')}</p>
                <ul className="space-y-1 max-h-28 overflow-y-auto pr-1">
                  {historie.map((h) => (
                    <li key={h.id} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      {h.kind === 'napad'
                        ? <Lightbulb className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
                        : <Bug className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />}
                      <span className="truncate" title={h.text}>{h.text}</span>
                      <span className="ml-auto shrink-0 tabular-nums">
                        {new Date(h.created).toLocaleDateString()}
                        {h.sent === false && ` · ${t('report.neodeslano')}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={zavri}>
            {hotovo ? t('report.zavrit') : t('report.zrusit')}
          </Button>
          {!hotovo && (
            <Button onClick={odesli} disabled={text.trim().length < 5 || odesilam} data-report-odeslat>
              {odesilam ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {t('report.odeslat')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
