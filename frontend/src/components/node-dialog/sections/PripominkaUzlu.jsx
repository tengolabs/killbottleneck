import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useLazyNs } from '@/i18n/lazyNs';
import { fmtDen } from '@/hooks/useKalendarZapis';
import { listPripominkyUzlu, ulozPripominkuUzlu, smazPripominkuUzlu } from '@/api/udalosti';

// Připomínka k uzlu (19. 9. 2026): „den před termínem v 16:00“ — SOUKROMÁ,
// per uživatel, RELATIVNÍ k termínu (posun termínu ji přepočítá server) a termín
// NIKDY nemění. Žije mimo node.data → ukládá se HNED routou, ne s tlačítkem
// Uložit dialogu. Ukazuje se jen u uzlu s ULOŽENÝM termínem (origDeadline).
const OFFSETY = ['0', '1', '2', '7'];
const VYCHOZI_CAS = { 0: '09:00', 1: '16:00', 2: '09:00', 7: '09:00' };

export default function PripominkaUzlu({ mapId, nodeId, deadline }) {
  const nsReady = useLazyNs('kalendar');
  const { t } = useTranslation('kalendar');
  const { toast } = useToast();
  const [rec, setRec] = useState(null);       // uložená připomínka (DTO) nebo null
  const [offset, setOffset] = useState('1');
  const [time, setTime] = useState('16:00');
  const [otevreno, setOtevreno] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nacteno, setNacteno] = useState(false);

  const nacti = useCallback(async () => {
    try {
      const r = await listPripominkyUzlu(mapId, nodeId);
      const moje = (r?.reminders || [])[0] || null;
      setRec(moje);
      if (moje) { setOffset(String(moje.offset_days)); setTime(moje.time); }
    } catch { setRec(null); }
    finally { setNacteno(true); }
  }, [mapId, nodeId]);
  useEffect(() => { setOtevreno(false); setNacteno(false); nacti(); }, [nacti]);

  const zmenOffset = (v) => { setOffset(v); if (!rec) setTime(VYCHOZI_CAS[v] || '09:00'); };
  const uloz = async () => {
    setBusy(true);
    try {
      const r = await ulozPripominkuUzlu({ map: mapId, node_id: nodeId, offset_days: Number(offset), time });
      setRec(r.reminder);
      setOtevreno(false);
      window.dispatchEvent(new CustomEvent('kb-udalosti-changed'));
      toast({ title: t('pripominka.ulozena', { at: `${fmtDen(r.reminder.day)} ${r.reminder.time}` }) });
    } catch (e) {
      toast({ title: t('pripominka.selhala'), description: e?.message, variant: 'destructive' });
    } finally { setBusy(false); }
  };
  const zrus = async () => {
    if (!rec) return;
    setBusy(true);
    try {
      await smazPripominkuUzlu(rec.id);
      setRec(null);
      window.dispatchEvent(new CustomEvent('kb-udalosti-changed'));
      toast({ title: t('pripominka.zrusena') });
    } catch (e) {
      toast({ title: t('pripominka.selhala'), description: e?.message, variant: 'destructive' });
    } finally { setBusy(false); }
  };

  if (!nsReady || !nacteno) return null;
  const casOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const offsetText = (o) => (OFFSETY.includes(String(o)) ? t(`pripominka.offset.${o}`) : t('pripominka.offsetJine', { n: o }));
  return (
    <div className="space-y-1.5 rounded-lg border p-2" data-testid="uzel-pripominka">
      {rec && !otevreno ? (
        <div className="flex items-center gap-2 text-xs">
          <Bell className="w-3.5 h-3.5 shrink-0 text-sky-600" />
          <span className="flex-1" data-testid="uzel-pripominka-stav">{t('pripominka.nastavena', { kdy: offsetText(rec.offset_days), at: `${fmtDen(rec.day)} ${rec.time}` })}</span>
          <button type="button" className="underline hover:text-foreground" onClick={() => setOtevreno(true)} disabled={busy}>{t('pripominka.zmenit')}</button>
          <button type="button" className="underline hover:text-foreground" onClick={zrus} disabled={busy} data-testid="uzel-pripominka-zrusit">{t('pripominka.zrusit')}</button>
        </div>
      ) : !otevreno ? (
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOtevreno(true)} data-testid="uzel-pripominka-nastavit">
          <Bell className="w-3.5 h-3.5" /> {t('pripominka.nastavit')}
        </Button>
      ) : (
        <div className="space-y-2">
          <Label className="text-xs flex items-center gap-1"><Bell className="w-3.5 h-3.5" /> {t('pripominka.titulek')}</Label>
          <div className="flex gap-2">
            <Select value={offset} onValueChange={zmenOffset}>
              <SelectTrigger className="h-8 flex-1" data-testid="uzel-pripominka-offset"><SelectValue /></SelectTrigger>
              <SelectContent>
                {!OFFSETY.includes(offset) && <SelectItem value={offset}>{offsetText(offset)}</SelectItem>}
                {OFFSETY.map((o) => <SelectItem key={o} value={o}>{offsetText(o)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-8 w-28" data-testid="uzel-pripominka-cas" />
          </div>
          <p className="text-[11px] text-muted-foreground">{t('pripominka.pozn', { deadline: fmtDen(deadline) })}</p>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setOtevreno(false)} disabled={busy}>{t('common:actions.cancel')}</Button>
            {rec && (
              <Button variant="ghost" size="sm" onClick={zrus} disabled={busy}><BellOff className="w-3.5 h-3.5" /> {t('pripominka.zrusit')}</Button>
            )}
            <Button size="sm" onClick={uloz} disabled={busy || !casOk} data-testid="uzel-pripominka-ulozit">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />} {t('pripominka.ulozit')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
