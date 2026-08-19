import CommentThread from '@/components/shared/CommentThread';
import NodeTaskComments from '@/components/shared/NodeTaskComments';

// Komentáře uzlu. Zakládání úkolů-položek zrušeno se slovníkem (17. 8. 2026):
// úkol = uzel s řešitelem nebo termínem, nová práce = nový uzel.
export default function TasksCommentsSection({ s, mapId }) {
  return (
    <>
      {/* onCountChange drží odznak u kategorie v souladu i po přidání či smazání
          komentáře; prvotní počet načítá useNodeEditState, aby odznak byl vidět
          hned po otevření okna, ne až po vstupu do téhle kategorie */}
      <CommentThread
        entity="Comment"
        filter={{ goalmap_id: mapId, node_id: s.node?.id }}
        onCountChange={s.setCommentCount}
      />
      <NodeTaskComments mapId={mapId} nodeId={s.node?.id} />
    </>
  );
}
