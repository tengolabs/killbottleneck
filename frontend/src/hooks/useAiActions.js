import { useState, useCallback } from 'react';
import { advisor } from '@/api/kb';

// AI v editoru mapy: rozpad/přepis uzlu z jeho menu (expandingNodeId = spinner
// na uzlu). Vytaženo z GoalMapEditor.jsx (analýza kódu 27. 8. 2026, F1-07);
// layoutAllForView a centerOnNode vznikají v editoru dřív, než se tenhle hook
// volá (volá se hned za layoutAllForView, ne u ostatních useState).
// 15. 9. 2026: Poradce v editoru („Navrhnout s AI“) a starý chat nad mapou
// (AIChatPanel + aplikace operací) odstraněny s tlačítky z lišty (Richard) —
// nahrazuje je asistent na boku (components/asistent).
export function useAiActions({
  nodes, edges, nodesNow, edgesNow, setNodes, setEdges, pushHistory, layoutAllForView, centerOnNode, toast, t,
}) {
  const [expandingNodeId, setExpandingNodeId] = useState(null);

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
        const data = await advisor({
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

        // Compose from the map as it is NOW, not as it was at the click: the model answers after seconds to
        // tens of seconds and whatever the person did meanwhile used to be overwritten (code analysis 4, F1-10).
        const liveNodes = nodesNow?.current || nodes;
        const liveEdges = edgesNow?.current || edges;
        if (!liveNodes.some((n) => n.id === nodeId)) return; // the step was deleted while the model was thinking
        const allNodes = [...liveNodes, ...newNodes];
        const allEdges = [...liveEdges, ...newEdges];
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
    [nodes, edges, nodesNow, edgesNow, toast, setNodes, setEdges, pushHistory, centerOnNode, layoutAllForView]
  );

  return { expandingNodeId, handleExpandNode };
}
