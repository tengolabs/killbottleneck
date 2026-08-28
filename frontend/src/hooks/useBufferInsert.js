import { useCallback } from 'react';
import { BUFFER_DRAG_MIME } from '@/components/goal-map/BufferPanel';

// Zásobník nápadů v editoru (F1-07, krok 10): příznak dostupnosti zásobníku
// (bufferEnabled), vložení nápadu do mapy tlačítkem i drag&drop na plátno
// (insertBufferItem, handleBufferDragOver/Drop) a odložení uzlu do zásobníku
// (handleStashNode). Vytaženo z GoalMapEditor.jsx (analýza kódu 27. 8. 2026)
// BEZE ZMĚNY chování. Samotné `useBufferNodes(user)` zůstává v editoru: jeho
// `buffer.items` čte efekt přenačtení „Mojí mapy" dřív, než vzniknou vstupy
// tohoto hooku (pushHistory, handleDeleteNode, canRemoveNodeShared…) — proto
// se hook volá až za handleDeleteEdge (na místě původního insertBufferItem)
// a `buffer` přichází jako vstup (stejný vzor jako skipNextSave).
export function useBufferInsert({
  user, isPublicView, isTemplatePreview, nodes, edges, setNodes, setEdges, direction, rfInstance,
  pushHistory, buffer, canRemoveNodeShared, assignedDeleteRefused, handleDeleteNode, setEditNodeId, toast, t,
}) {
  // Zásobník jen pro přihlášené a mimo demo/náhled šablony (tam se mapa neukládá
  // a vložení by nápad ze zásobníku nenávratně spotřebovalo)
  const bufferEnabled = !!user && !isPublicView && !isTemplatePreview;

  // Zásobník: vložení = přesun (uzel vznikne v mapě, ze zásobníku zmizí)
  const insertBufferItem = useCallback(
    (item, position) => {
      // Bez pozice (tlačítko se šipkou, typicky mobil) se uzel VĚŠÍ POD VRCHOL
      // i s hranou. Dřív vznikl volně plovoucí uzel uprostřed viewportu — na
      // mobilu bez drag&drop slepá ulička: „skočil náhodně a neměl jsem ho kam
      // dát" (Richard 7. 8. 2026 v noci). Strom nezná uzly bez rodiče.
      // Drop myší (position) nechává pozici i volnost napojení jak byly.
      const id = `node-${Date.now()}`;
      const apex = nodes.find((n) => n.type === 'apexNode');
      let pos = position;
      if (!pos) {
        if (apex) {
          const sourozenci = edges.filter((e) => e.source === apex.id).length;
          pos = direction === 'vertical'
            ? { x: apex.position.x + 40 + sourozenci * 40, y: apex.position.y + 260 }
            : { x: apex.position.x + 320, y: apex.position.y + 40 + sourozenci * 40 };
        } else if (rfInstance) {
          const center = rfInstance.screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          });
          pos = { x: center.x - 110, y: center.y - 60 };
        } else {
          pos = { x: 250, y: 150 };
        }
      }
      pushHistory();
      setNodes((prev) => [
        ...prev,
        {
          id: id,
          type: 'goalNode',
          position: pos,
          data: {
            title: item.title,
            status: 'todo',
            description: item.description || '',
            color: item.color || '',
            deadline: item.deadline || '',
            nodeType: 'normal',
            goalType: '',
            apexText: '',
          },
        },
      ]);
      if (!position && apex) {
        setEdges((prev) => [...prev, { id: `edge-${Date.now()}`, source: apex.id, target: id }]);
      }
      buffer.remove(item.id);
    },
    [rfInstance, setNodes, setEdges, pushHistory, buffer, nodes, edges, direction]
  );

  const handleBufferDragOver = useCallback((e) => {
    if (e.dataTransfer.types.includes(BUFFER_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleBufferDrop = useCallback(
    (e) => {
      const raw = e.dataTransfer.getData(BUFFER_DRAG_MIME);
      if (!raw) return;
      e.preventDefault();
      let item;
      try {
        item = JSON.parse(raw);
      } catch {
        return;
      }
      let pos;
      if (rfInstance) {
        const p = rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        pos = { x: p.x - 110, y: p.y - 30 };
      }
      insertBufferItem(item, pos);
    },
    [rfInstance, insertBufferItem]
  );

  const handleStashNode = useCallback(
    async (nodeId, override) => {
      const node = nodes.find((n) => n.id === nodeId);
      // override = rozeditované hodnoty z dialogu (uzel v mapě je může mít starší/prázdné)
      const nodeTitle = (override?.title ?? node?.data?.title ?? '').trim();
      if (!node || !nodeTitle) return;
      // stash = odstranění z mapy — cizí zadaný úkol nesmí zmizet do soukromého
      // zásobníku (obchvat zámku termínu); kontrola PŘED zápisem do bufferu,
      // jinak by se nápad zduplikoval a uzel v mapě zůstal
      if (!canRemoveNodeShared(node)) { assignedDeleteRefused(node); return; }
      try {
        await buffer.add({
          title: nodeTitle,
          description: override?.description ?? node.data?.description ?? '',
          color: override?.color ?? node.data?.color ?? '',
          deadline: override?.deadline ?? node.data?.deadline ?? '',
        });
      } catch {
        toast({ title: t('tasks:tasksPage.stashFailed'), description: t('common:misc.tryAgainPlease'), variant: 'destructive' });
        return;
      }
      handleDeleteNode(nodeId);
      setEditNodeId(null);
      toast({ title: t('tasks:tasksPage.stashedToBuffer'), description: nodeTitle });
    },
    [nodes, buffer, handleDeleteNode, toast, canRemoveNodeShared, assignedDeleteRefused]
  );

  return { bufferEnabled, insertBufferItem, handleBufferDragOver, handleBufferDrop, handleStashNode };
}
