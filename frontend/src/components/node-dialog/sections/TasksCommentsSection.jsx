import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RotateCw } from 'lucide-react';
import CommentThread from '@/components/shared/CommentThread';
import NodeTaskComments from '@/components/shared/NodeTaskComments';

// „Úkoly & komentáře": nabídka založení úkolu k uzlu + vlákna komentářů.
// Vrchol úkoly nepřijímá („na vrchol jde věšet jen uzly", 13. 8. 2026) —
// nabídka nového úkolu se u vrcholu vůbec neukazuje.
export default function TasksCommentsSection({ s, map, mapId }) {
  const { t } = useTranslation('editor');
  return (
    <>
      {map && !s.isApex && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border">
          <div>
            <Label>{t('nodeDialog.taskBox')}</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('nodeDialog.taskBoxDesc')}
            </p>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => s.setTaskOpen(true)}>
            <RotateCw className="w-4 h-4" /> {t('tasks:tasksPage.newTask')}
          </Button>
        </div>
      )}
      <CommentThread entity="Comment" filter={{ goalmap_id: mapId, node_id: s.node?.id }} />
      <NodeTaskComments mapId={mapId} nodeId={s.node?.id} />
    </>
  );
}
