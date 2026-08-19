import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CalendarClock, User } from 'lucide-react';
import DatePicker from '@/components/DatePicker';
import CommentThread from '@/components/shared/CommentThread';
import NodeTaskComments from '@/components/shared/NodeTaskComments';
import { STATUSES as statuses } from '@/lib/statusMeta';
import { pb } from '@/api/pb';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { useNodeEditState } from './useNodeEditState';
import FilesSection from './sections/FilesSection';
import FormatovanyPopis from '@/components/shared/FormatovanyPopis';
import OdkazyVPopisu from '@/components/shared/OdkazyVPopisu';

// ZJEDNODUŠENÉ okno uzlu pro SPOLUPRACOVNÍKA (sdílení „work") — Richard 14. 8.
// 2026: běžný uživatel nemá dostat přeplněný editor. Zadání jen ČTE (název,
// popis, termín, garant), DĚLÁ v něm svoje: přepne stav (routa /node-status —
// kdo smí, rozhoduje server: garant nebo řešitel úkolu na uzlu), požádá
// o změnu termínu, nahraje přílohu (u automatizovaného kroku tím krok rozjede)
// a komentuje. Mapu tenhle dialog NEUKLÁDÁ — žádné onSave.
export default function NodeEditDialogSimple({ node, mapId, onClose, mapAccess, onWorkStatusSaved }) {
  const { t } = useTranslation('editor');
  const { toast } = useToast();
  const { user } = useAuth();
  // onSave se nepředává — hook ho pro čtecí/žádací akce nepotřebuje
  const s = useNodeEditState({ node, mapId, onSave: () => {}, mapAccess });
  const [savingStatus, setSavingStatus] = useState(false);
  const d = node?.data || {};

  const changeStatus = async (next) => {
    if (savingStatus || next === s.status) return;
    setSavingStatus(true);
    try {
      const res = await pb.send('/api/kb/node-status', { method: 'POST', body: { mapId, nodeId: node.id, status: next } });
      s.setStatus(next);
      onWorkStatusSaved?.(node.id, next, res?.updated);
    } catch (err) {
      // kdo smí co, rozhoduje server (garant NEBO řešitel úkolu na uzlu)
      if (err?.status === 403) {
        toast({ title: t('node.workOwnOnly'), description: t('node.workOwnOnlyHint'), variant: 'destructive' });
      } else {
        toast({ title: t('common:misc.statusChangeFailed'), description: err?.message, variant: 'destructive' });
      }
    }
    setSavingStatus(false);
  };

  return (
    <Dialog open={!!node} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md flex flex-col max-h-[90dvh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {s.icon && <span className="leading-none">{s.icon}</span>}
            <span className="truncate">{s.title || t('nodeDialog.title')}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 flex-1 min-h-0 overflow-y-auto pr-1">
          {s.description && (
            <FormatovanyPopis text={s.description} className="text-sm text-muted-foreground" />
          )}
          {/* Holé adresy napsané v textu; pojmenované odkazy jsou už klikací
              přímo v textu, takže se pod ním neopakují (nález panelu 19. 8. 2026). */}
          <OdkazyVPopisu text={s.description} jenHole />
          <div className="space-y-2">
            <Label>{t('tasks:taskDialog.labelStatus')}</Label>
            <div className="flex gap-2">
              {statuses.map((st) => (
                <button
                  key={st.value}
                  disabled={savingStatus}
                  onClick={() => changeStatus(st.value)}
                  className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                    s.status === st.value
                      ? st.activeClass
                      : 'border-border hover:border-muted-foreground/30'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                  {st.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {d.deadline && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <CalendarClock className="w-3.5 h-3.5" /> {d.deadline}
              </span>
            )}
            {d.owner && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <User className="w-3.5 h-3.5" /> {d.owner}
              </span>
            )}
          </div>
          {/* žádost o změnu termínu — jediná „zadávací" věc, kterou řešitel smí */}
          {s.origDeadline && !s.dlWanted && !s.dlReqOpen && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { s.setDlReqDate(''); s.setDlReqNote(''); s.setDlReqOpen(true); }}>
              <CalendarClock className="w-3.5 h-3.5" /> {t('nodeDialog.dlRequestButton')}
            </Button>
          )}
          {s.dlReqOpen && (
            <div className="space-y-2 rounded-lg border p-2">
              <DatePicker id="dl-request-date" value={s.dlReqDate} onChange={s.setDlReqDate} className="h-8" />
              <Input value={s.dlReqNote} onChange={(e) => s.setDlReqNote(e.target.value)} placeholder={t('nodeDialog.dlRequestNotePh')} maxLength={500} />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => s.setDlReqOpen(false)}>{t('common:actions.cancel')}</Button>
                <Button size="sm" disabled={!s.dlReqDate || s.dlReqBusy}
                  onClick={() => s.dlAction({ action: 'request', date: s.dlReqDate, note: s.dlReqNote },
                    { wanted: s.dlReqDate, note: s.dlReqNote, by: user?.email }, 'nodeDialog.dlRequestSent')}>
                  {t('nodeDialog.dlRequestSend')}
                </Button>
              </div>
            </div>
          )}
          {s.dlWanted && s.dlBy === user?.email && (
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <CalendarClock className="w-3.5 h-3.5 shrink-0" />
              {t('nodeDialog.dlRequestMine', { date: s.dlWanted })}
              <button type="button" className="underline hover:text-foreground" disabled={s.dlReqBusy}
                onClick={() => s.dlAction({ action: 'cancel' }, { wanted: '', note: '', by: '' }, 'nodeDialog.dlRequestCanceled')}>
                {t('nodeDialog.dlRequestCancel')}
              </button>
            </p>
          )}
          <FilesSection s={s} mapId={mapId} />
          <CommentThread entity="Comment" filter={{ goalmap_id: mapId, node_id: node?.id }} />
          <NodeTaskComments mapId={mapId} nodeId={node?.id} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
