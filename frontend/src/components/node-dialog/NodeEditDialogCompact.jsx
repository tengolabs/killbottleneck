import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Inbox, Trash2, ExternalLink } from 'lucide-react';
import TaskDialog from '@/components/tasks/TaskDialog';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { useNodeEditState } from './useNodeEditState';
import BasicsSection from './sections/BasicsSection';
import AssignmentSection from './sections/AssignmentSection';
import ExecutorSection from './sections/ExecutorSection';
import FilesSection from './sections/FilesSection';
import BehaviorSection from './sections/BehaviorSection';
import TasksCommentsSection from './sections/TasksCommentsSection';
import ColorPicker from './sections/ColorPicker';

// Dialog uzlu — od 14. 8. 2026 rozpadlý na sekce (components/node-dialog/):
// stav a handlery drží hook useNodeEditState, sekce jsou čistě prezentační.
// Tahle KOMPAKTNÍ podoba (jeden scroll, původní pořadí polí) slouží volajícím
// mimo editor mapy (Tasks, Moje mapa) a jako základ zjednodušeného okna;
// editor mapy dostává velké okno s kategoriemi (NodeEditDialogFull).
//
// mapAccess = { ownerEmail, sharedWith: [], teamAccess } — kdo má k mapě přístup.
// members = adresář týmu. Výběr člena BEZ přístupu → dotaz a přisdílení mapy
// (onShareAdd, jen vlastník). Volný text zrušen — zodpovědná osoba se jen vybírá.
// map + emailOptions + onTasksChanged: volitelné — když volající předá mapu (DTO s id+nodes),
// dialog nabídne založení úkolu k uzlu (vč. opakování) stejným formulářem jako tabulka úkolů.
export default function NodeEditDialogCompact({ node, mapId, onSave, onClose, mapAccess, members = [], onShareAdd, onStash, onDelete, onOpenMap, map, emailOptions = [], onTasksChanged, onContactsChanged }) {
  const { t } = useTranslation('editor');
  const { toast } = useToast();
  const s = useNodeEditState({ node, mapId, onSave, mapAccess });

  return (
    <Dialog open={!!node} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md flex flex-col max-h-[90dvh]">
        <DialogHeader>
          <DialogTitle>{t('nodeDialog.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 flex-1 min-h-0 overflow-y-auto pr-1">
          <BasicsSection s={s} withColor={false} />
          <AssignmentSection s={s} mapAccess={mapAccess} members={members} onShareAdd={onShareAdd} onContactsChanged={onContactsChanged} />
          {!s.isApex && (
            <>
              <ExecutorSection s={s} />
              <FilesSection s={s} mapId={mapId} />
              <BehaviorSection s={s} />
              <ColorPicker color={s.color} setColor={s.setColor} labelKey="nodeDialog.colorBgLabel" />
            </>
          )}
          <TasksCommentsSection s={s} map={map} mapId={mapId} />
        </div>
        <DialogFooter>
          <div className="flex gap-2 sm:mr-auto">
            {/* uzel se zadaným úkolem (termínem) odstraní jen zadavatel/vlastník —
                stash i smazání jsou totéž odstranění, server obojí odmítne */}
            {onStash && !s.isApex && (
              <Button
                variant="outline"
                onClick={() => onStash(node.id, { title: s.title.trim(), description: s.description, color: s.color, deadline: s.deadline })}
                disabled={!s.title.trim() || !s.canManageTask}
                title={s.canManageTask ? t('nodeDialog.stashTitle') : t('nodeDialog.removeAssignerOnly', { email: s.taskAssigner })}
              >
                <Inbox className="w-4 h-4" /> {t('tasks:taskDialog.stashButton')}
              </Button>
            )}
            {onDelete && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(node.id)}
                disabled={!s.canManageTask}
                title={s.canManageTask ? t('nodeDialog.deleteTitle') : t('nodeDialog.removeAssignerOnly', { email: s.taskAssigner })}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
            {onOpenMap && (
              <Button variant="outline" onClick={() => onOpenMap(node.id)} title={t('nodeDialog.openMapTitle')}>
                <ExternalLink className="w-4 h-4" />
              </Button>
            )}
          </div>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={s.handleSave} disabled={s.isApex ? !s.apexText.trim() : !s.title.trim()}>
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
        {map && (
          <TaskDialog
            open={s.taskOpen}
            task={null}
            defaults={{ map_id: map.id, node_id: node?.id }}
            maps={[map]}
            emailOptions={emailOptions}
            members={members}
            onSave={async (data) => {
              try {
                await base44.entities.Task.create(data);
                onTasksChanged?.();
                toast({ title: t('nodeDialog.taskCreated'), description: data.recurrence ? t('nodeDialog.taskCreatedDesc') : undefined });
              } catch (e) {
                toast({ title: t('tasks:nodeTasksDialog.createFailed'), variant: 'destructive' });
                throw e;
              }
            }}
            onClose={() => s.setTaskOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
