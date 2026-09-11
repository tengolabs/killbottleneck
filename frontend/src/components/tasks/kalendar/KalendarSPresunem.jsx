import { useState, useMemo, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLazyNs } from '@/i18n/lazyNs';
import { useToast } from '@/components/ui/use-toast';
import { labelForEmail } from '@/lib/memberLabel';
import { projectName } from '@/lib/projectColors';
import { dnesKlic, vlastnikMapy } from '@/lib/kalendar';
import { useKalendarZapis, fmtDen } from '@/hooks/useKalendarZapis';
import TaskCalendar from '../TaskCalendar';
import DialogTermin from './DialogTermin';

// Kalendář v2 (externí dodávka schválená 7.–10. 9. 2026) + přesun termínu tažením
// (mechanika z feat/kalendar, Richard: „fungovalo dobře přetažení a potvrzení“).
// TaskCalendar zůstává prezentační; tady je lepidlo: matice (přes useKalendarDnd
// uvnitř TaskCalendar) → dialog „Změnit termín z X na Y?“ / žádost / odmítnutí
// → zápis (useKalendarZapis: compare-and-set, toast s Vrátit).
// Texty kalendáře i dialogu jsou v líném ns `kalendar` (lite dieta); dokud
// nedojede (pár kB, jednou), je tu jen krátký spinner. Když chunk nedojede
// vůbec (starý tab po nasazení), useLazyNs přesto uvolní → kalendář se ukáže
// s klíči místo textů, nikdy nezůstane u spinneru.
export default function KalendarSPresunem({ items = [], maps = [], members = [], user, tasksApi, loadMaps, setMaps, onOpen, onCreate }) {
  const nsReady = useLazyNs('kalendar');
  const { t } = useTranslation('kalendar');
  const { t: tCommon } = useTranslation('common');
  const { t: tEditor } = useTranslation('editor');
  const { toast } = useToast();
  const zapis = useKalendarZapis({ setMaps, tasksApi, loadMaps, toast });

  const mapyPodleId = useMemo(() => Object.fromEntries(maps.map((m) => [m.id, m])), [maps]);
  const mapaOf = useCallback((item) => mapyPodleId[item.map_id], [mapyPodleId]);
  const zadavatelOf = useCallback((item) => {
    const mapa = mapaOf(item);
    const email = item.kind === 'node' ? (item.assignedBy || vlastnikMapy(mapa)) : (item.created_by || vlastnikMapy(mapa));
    return email ? (labelForEmail(members, email) || email) : '';
  }, [mapaOf, members]);

  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const kontextPro = useCallback((stitek) => ({ dnes: dnesKlic(), userEmail: user?.email, map: mapaOf(stitek.item) }), [user, mapaOf]);
  const onAkce = useCallback((r, stitek, den) => {
    const item = stitek.item;
    const mapa = mapaOf(item);
    if (r.akce === 'nic') return;
    if (r.akce === 'odmitnout') {
      if (r.duvod === 'hotovo') toast({ title: t('toast.hotovoNepresouvat') });
      else if (r.duvod === 'mapaChybi') toast({ title: t('chip.nacita') });
      else {
        setDialog({
          rezim: 'odmitnuto', stitek, nova: den, duvod: r.duvod,
          zadavatel: r.duvod === 'ciziZadost'
            ? (labelForEmail(members, item.deadlineChangeRequestedBy) || item.deadlineChangeRequestedBy)
            : zadavatelOf(item),
        });
      }
      return;
    }
    // plán se v kalendáři v2 nezobrazuje → větev 'plan' tu nenastane
    setDialog({
      rezim: r.akce === 'termin' ? 'zmena' : 'zadost', stitek, nova: den, puvodni: r.puvodni,
      mapaNazev: mapa ? projectName(mapa) : '', zadavatel: zadavatelOf(item),
    });
  }, [mapaOf, toast, t, members, zadavatelOf]);

  const potvrdit = useCallback(async (note) => {
    if (!dialog) return;
    setBusy(true);
    try {
      if (dialog.rezim === 'zmena') await zapis.zmenTermin(dialog.stitek.item, dialog.nova, dialog.puvodni);
      else if (dialog.rezim === 'zadost') await zapis.posliZadost(dialog.stitek.item, dialog.nova, note);
      setDialog(null);
    } catch { /* hlášku dal useKalendarZapis */ setDialog(null); }
    finally { setBusy(false); }
  }, [dialog, zapis]);

  if (!nsReady) {
    return (
      <div className="flex justify-center py-20" data-testid="kal-nacitani">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  return (
    <>
      <TaskCalendar
        items={items}
        maps={maps}
        onOpen={onOpen}
        onCreate={onCreate}
        onPresun={onAkce}
        kontextPresunu={kontextPro}
      />
      <DialogTermin
          stav={dialog}
          busy={busy}
          onZavrit={() => setDialog(null)}
          onPotvrdit={potvrdit}
          onDetail={() => { const it = dialog?.stitek?.item; setDialog(null); if (it) onOpen?.(it); }}
          t={t}
          tEditor={tEditor}
          tCommon={tCommon}
          fmtDen={fmtDen}
        />
    </>
  );
}
