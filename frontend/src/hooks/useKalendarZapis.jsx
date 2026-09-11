import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { pb } from '@/api/pb';
import { patchNodeData } from '@/lib/taskActions';
import { fmtDate } from '@/lib/locale';

// Zápisová vrstva kalendáře na stránce Úkoly (Richard 7. 9. 2026):
//   • termín — přetažení + potvrzovací dialog; uzel přes patchNodeData se zámkem
//     base_updated A compare-and-set pole `deadline` (kolegova změna se nepřepíše);
//     úkolový záznam přes tasksApi.update BEZ compare-and-set (PocketBase záznam
//     nemá zámek verze; server hlídá jen zadavatele — taskDeadlineOwnerOnly);
//   • žádost o termín — POST /api/kb/deadline-requests (stejná routa jako detail
//     uzlu), Vrátit v hlášce = action 'cancel'.
// Každá akce dává hlášku, CO se stalo, a kde to jde, nabídne Vrátit (jeden krok
// zpět jako všude v aplikaci — vzor MyDaySection). Chip se přesune až podle dat
// ze serveru; žádné optimistické UI.
export const fmtDen = (k, opts) => (k ? fmtDate(k + 'T00:00:00', opts || { day: 'numeric', month: 'numeric', year: 'numeric' }) : '');

export function useKalendarZapis({ setMaps, tasksApi, loadMaps, toast }) {
  const { t } = useTranslation('kalendar');
  const { t: tCommon } = useTranslation('common');
  const { t: tTasks } = useTranslation('tasks');
  const { t: tEditor } = useTranslation('editor');

  const chyba = useCallback((e, titulek) => {
    const msg = e?.message === 'mapNotFound' ? tTasks('tasksPage.mapNotFound') : e?.message;
    toast({ title: titulek || tTasks('tasksPage.saveToMapFailed'), description: msg, variant: 'destructive' });
  }, [toast, tTasks]);

  const vratit = useCallback((fn) => (
    <button
      type="button"
      onClick={fn}
      className="shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-secondary"
      data-testid="kal-vratit"
    >
      {tCommon('rowActions.undo')}
    </button>
  ), [tCommon]);

  // jeden zápis jednoho pole; uzel = mapa (zámek + volitelný compare-and-set), úkol = záznam
  const zapis = useCallback(async (item, pole, hodnota, ocekavane) => {
    if (item.kind === 'node') {
      const nodes = await patchNodeData(item.map_id, item.node_id, { [pole]: hodnota }, null,
        ocekavane ? { ocekavane } : undefined);
      setMaps((prev) => prev.map((m) => (m.id === item.map_id ? { ...m, nodes } : m)));
      return;
    }
    await tasksApi.update(item.raw.id, { [pole]: hodnota });
  }, [setMaps, tasksApi]);

  // jedna hláška pro kolizi i selhání — stejná pro zápis i pro Vrátit
  const chybaTerminu = useCallback((e) => {
    if (e?.message === 'kalendarZmenaMezitim') {
      toast({ title: t('toast.terminMezitim', { now: fmtDen(e.aktualni) || '—' }), variant: 'destructive' });
      loadMaps?.();
    } else {
      chyba(e, t('toast.zmenaSelhala'));
    }
  }, [toast, t, chyba, loadMaps]);

  const zmenTermin = useCallback(async (item, nova, puvodni) => {
    try {
      await zapis(item, 'deadline', nova, { deadline: puvodni });
    } catch (e) {
      chybaTerminu(e);
      throw e;
    }
    let vraceno = false; // dvojklik na Vrátit nesmí zapsat dvakrát
    toast({
      title: t('toast.terminZmenen', { to: fmtDen(nova) }),
      action: vratit(async () => {
        if (vraceno) return;
        vraceno = true;
        try {
          await zapis(item, 'deadline', puvodni, { deadline: nova });
          toast({ title: t('toast.terminVracen', { from: fmtDen(puvodni) }) });
        } catch (e) { vraceno = false; chybaTerminu(e); }
      }),
    });
  }, [zapis, toast, t, vratit, chybaTerminu]);

  const zrusZadost = useCallback(async (item) => {
    try {
      await pb.send('/api/kb/deadline-requests', { method: 'POST', body: { mapId: item.map_id, nodeId: item.node_id, action: 'cancel' } });
      loadMaps?.();
      toast({ title: t('toast.zadostZrusena') });
    } catch (e) { chyba(e, tEditor('nodeDialog.dlRequestFailed')); }
  }, [loadMaps, toast, t, tEditor, chyba]);

  const posliZadost = useCallback(async (item, nova, note) => {
    try {
      await pb.send('/api/kb/deadline-requests', {
        method: 'POST',
        body: { mapId: item.map_id, nodeId: item.node_id, action: 'request', date: nova, note: note || '' },
      });
    } catch (e) {
      chyba(e, tEditor('nodeDialog.dlRequestFailed'));
      throw e;
    }
    loadMaps?.();
    toast({ title: tEditor('nodeDialog.dlRequestSent'), action: vratit(() => zrusZadost(item)) });
  }, [loadMaps, toast, tEditor, vratit, chyba, zrusZadost]);

  return useMemo(() => ({ zmenTermin, posliZadost, zrusZadost }), [zmenTermin, posliZadost, zrusZadost]);
}
