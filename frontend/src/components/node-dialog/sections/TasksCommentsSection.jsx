import CommentThread from '@/components/shared/CommentThread';
import NodeTaskComments from '@/components/shared/NodeTaskComments';

// Komentáře uzlu. Zakládání úkolů-položek zrušeno se slovníkem (17. 8. 2026):
// úkol = uzel s řešitelem nebo termínem, nová práce = nový uzel.
export default function TasksCommentsSection({ s, mapId }) {
  return (
    <>
      <CommentThread entity="Comment" filter={{ goalmap_id: mapId, node_id: s.node?.id }} />
      <NodeTaskComments mapId={mapId} nodeId={s.node?.id} />
    </>
  );
}
