import { useState, useCallback } from 'react';
import { advisor } from '@/api/kb';
import { layoutTree } from '@/lib/treeLayout';
import { advisorPreviewToMap } from '@/lib/mapNodes';

// AI v editoru mapy: dialog Poradce (advisorOpen → AdvisorDialog + převzetí
// návrhu do mapy), chat s AI (chatOpen → AIChatPanel + aplikace operací nad
// mapou se snímkem pro „Vrátit AI změny") a rozpad/přepis uzlu z jeho menu
// (expandingNodeId = spinner na uzlu). Vytaženo z GoalMapEditor.jsx (analýza
// kódu 27. 8. 2026, F1-07) BEZE ZMĚNY chování — vše ostatní přichází jako
// parametry: layoutAllForView a centerOnNode vznikají v editoru dřív, než se
// tenhle hook volá (volá se hned za layoutAllForView, ne u ostatních useState).
export function useAiActions({
  nodes, edges, setNodes, setEdges, pushHistory, aiSnapshotRef, setCanUndoAi,
  layoutAllForView, centerOnNode, directionRef, canonicalPosRef, toast, t,
}) {
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [expandingNodeId, setExpandingNodeId] = useState(null);

  const handleAcceptAdvisor = useCallback(
    (preview, goalType, goalText) => {
      // Konverze náhledu je sdílená s useMapCreation (lib/mapNodes.js) a vrací
      // KANONICKÉ SVISLÉ pozice. Dřív se layoutovalo v aktuálním směru — na
      // mobilu (vodorovné view) pak save vydával vodorovné pozice za svislé
      // a mapa se po otevření na desktopu rozsypala (task #17).
      const { nodes: newNodes, edges: newEdges } = advisorPreviewToMap(preview, goalType, goalText, t('defaults.newGoal'));

      let laidOutNodes = newNodes;
      if (directionRef.current === 'horizontal') {
        // vodorovné view: kanonické svislé pozice zapsat do canonicalPosRef
        // (ať je save čte odtud) a pro ZOBRAZENÍ spočítat vodorovný layout
        for (const n of newNodes) canonicalPosRef.current.set(n.id, { ...n.position });
        const hpos = layoutTree(newNodes, newEdges, 'horizontal');
        laidOutNodes = newNodes.map((n) => ({ ...n, position: hpos[n.id] || n.position }));
      }

      setNodes((prev) => [...prev, ...laidOutNodes]);
      setEdges((prev) => [...prev, ...newEdges]);

      toast({
        title: t('toasts.structureAdded'),
        description: t('toasts.structureAddedDesc', { count: newNodes.length }),
      });
    },
    [setNodes, setEdges, toast, t]
  );

  const handleExpandNode = useCallback(
    async (nodeId, action = 'subgoals') => {
      const clickedNode = nodes.find((n) => n.id === nodeId);
      if (!clickedNode) return;

      // Build parent map from edges
      const parentMap = {};
      for (const edge of edges) {
        parentMap[edge.target] = edge.source;
      }

      // Find root node by following parent chain
      let rootId = nodeId;
      while (parentMap[rootId]) {
        rootId = parentMap[rootId];
      }
      const rootNode = nodes.find((n) => n.id === rootId);
      const rootText = rootNode?.data?.apexText || rootNode?.data?.title || '';

      // Build path from root to clicked node
      const path = [];
      let currentId = nodeId;
      while (currentId) {
        const node = nodes.find((n) => n.id === currentId);
        if (!node) break;
        path.unshift(node.data.title || node.data.apexText || '');
        currentId = parentMap[currentId];
      }

      setExpandingNodeId(nodeId);
      try {
        const isRewrite = action === 'rewrite';
        const result = await advisor({
          goal: rootText,
          mode: 'expand',
          action,
          path,
          node: {
            id: nodeId,
            title: clickedNode.data.title || clickedNode.data.apexText || '',
            description: clickedNode.data.description || '',
          },
          count: isRewrite ? 1 : 3,
        });
        const data = result;
        if (data?.error) {
          toast({ title: t('toasts.aiError'), description: data.error, variant: 'destructive' });
          return;
        }
        if (!data?.nodes || !Array.isArray(data.nodes)) {
          toast({ title: t('toasts.aiError'), description: t('toasts.aiInvalidResponse'), variant: 'destructive' });
          return;
        }

        if (isRewrite) {
          const updated = data.nodes[0];
          if (updated) {
            setNodes((prev) => prev.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, title: updated.title || n.data.title, description: updated.description || n.data.description } }
                : n
            ));
          }
          toast({ title: t('toasts.nodeImproved'), description: t('toasts.nodeImprovedDesc') });
          return;
        }

        const ts = Date.now();
        const newNodes = data.nodes.map((n, i) => ({
          id: `node-${ts}-${i}`,
          type: 'goalNode',
          position: { x: 0, y: 0 },
          data: {
            title: n.title || t('defaults.newGoal'),
            description: n.description || '',
            status: 'todo',
            color: '',
            collapsed: false,
          },
        }));
        const newEdges = data.nodes.map((n, i) => ({
          id: `edge-${ts}-${i}`,
          source: nodeId,
          target: `node-${ts}-${i}`,
          type: 'deletable',
        }));

        const allNodes = [...nodes, ...newNodes];
        const allEdges = [...edges, ...newEdges];
        const positions = layoutAllForView(allNodes, allEdges);
        const laidOutNodes = allNodes.map((n) => ({
          ...n,
          position: positions[n.id] || n.position,
        }));

        pushHistory();
        setNodes(laidOutNodes);
        setEdges(allEdges);

        // Přepočet layoutu uzel posune → vycentrovat pohled zpět NA NĚJ (i s okolím),
        // ať to „neuletí" jinam. Stejně jako při otevření mapy na uzel.
        centerOnNode(nodeId, { pos: positions[nodeId], delay: 80 });

        toast({
          title: t('toasts.subgoalsAdded'),
          description: t('toasts.subgoalsAddedDesc', { count: newNodes.length }),
        });
      } catch (err) {
        const msg = err.response?.error || err.message || t('toasts.aiConnectionError');
        toast({ title: t('toasts.aiError'), description: msg, variant: 'destructive' });
      } finally {
        setExpandingNodeId(null);
      }
    },
    [nodes, edges, toast, setNodes, setEdges, pushHistory, centerOnNode, layoutAllForView]
  );

  const handleApplyOperations = useCallback(
    (operations) => {
      if (!operations || !operations.length) return;
      aiSnapshotRef.current = { nodes: nodes.map((n) => ({ ...n })), edges: edges.map((e) => ({ ...e })) };
      setCanUndoAi(true);
      pushHistory();

      const parentMap = {};
      for (const edge of edges) {
        parentMap[edge.target] = edge.source;
      }
      const rootNode = nodes.find((n) => !parentMap[n.id]);
      const rootId = rootNode?.id;

      let updatedNodes = [...nodes];
      let updatedEdges = [...edges];
      let counter = 0;

      for (const op of operations) {
        const suffix = `${Date.now()}-${counter++}`;

        if (op.op === 'add') {
          const parentId = op.parentId || rootId;
          if (!parentId) continue;
          const newId = `node-${suffix}`;
          updatedNodes = [
            ...updatedNodes,
            {
              id: newId,
              type: 'goalNode',
              position: { x: 0, y: 0 },
              data: {
                title: op.title || t('defaults.newGoal'),
                description: op.description || '',
                status: 'todo',
                color: '',
                collapsed: false,
              },
            },
          ];
          updatedEdges = [
            ...updatedEdges,
            { id: `edge-${suffix}`, source: parentId, target: newId, type: 'deletable' },
          ];
        } else if (op.op === 'update') {
          updatedNodes = updatedNodes.map((n) => {
            if (n.id !== op.id) return n;
            const dataUpdate = {};
            if (op.title !== undefined) dataUpdate.title = op.title;
            if (op.description !== undefined) dataUpdate.description = op.description;
            if (op.status !== undefined) dataUpdate.status = op.status;
            return { ...n, data: { ...n.data, ...dataUpdate } };
          });
        } else if (op.op === 'delete') {
          const parentId = (updatedEdges.find((e) => e.target === op.id) || {}).source;
          updatedEdges = updatedEdges
            .filter((e) => e.target !== op.id)
            .map((e) => e.source === op.id ? (parentId ? { ...e, source: parentId } : e) : e);
          updatedNodes = updatedNodes.filter((n) => n.id !== op.id);
        } else if (op.op === 'move') {
          updatedEdges = updatedEdges.map((e) =>
            e.target === op.id
              ? op.newParentId
                ? { ...e, source: op.newParentId }
                : null
              : e
          ).filter(Boolean);
        }
      }

      const positions = layoutAllForView(updatedNodes, updatedEdges);
      const laidOutNodes = updatedNodes.map((n) => ({
        ...n,
        position: positions[n.id] || n.position,
      }));

      setNodes(laidOutNodes);
      setEdges(updatedEdges);

      toast({
        title: t('toasts.opsApplied'),
        description: t('toasts.opsAppliedDesc', { count: operations.length }),
      });
    },
    [nodes, edges, setNodes, setEdges, pushHistory, toast, layoutAllForView]
  );

  return {
    advisorOpen, setAdvisorOpen, chatOpen, setChatOpen, expandingNodeId,
    handleAcceptAdvisor, handleExpandNode, handleApplyOperations,
  };
}
