import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { pb } from '@/api/pb';

// Odznaky na kartách uzlů: počty komentářů, příloh, statistika úkolů mapy a
// uzly s právě běžící automatizací (realtime na agent_runs). Vlastní kolekce
// mimo JSON mapy — do autosave nezasahují. Vytaženo z GoalMapEditor.jsx
// (analýza kódu 27. 8. 2026, F1-07) BEZE ZMĚNY chování.
export function useMapCounts({ activeMapId, isPublicView, user, editNodeId }) {
  const [commentCounts, setCommentCounts] = useState({});
  const [fileCounts, setFileCounts] = useState({});
  const [taskStats, setTaskStats] = useState({});
  const [mapTasks, setMapTasks] = useState([]);
  const [mapTaskCount, setMapTaskCount] = useState(0);
  const [taskStatsVersion, setTaskStatsVersion] = useState(0);
  // uzly, nad kterými PRÁVĚ běží automatizace (pending/running běh) — jen pro
  // indikátor na uzlu; realtime na agent_runs drží stav bez reloadu
  const [runningAgentNodes, setRunningAgentNodes] = useState(new Set());

  // Load comment counts for this map
  useEffect(() => {
    if (!activeMapId || isPublicView) return;
    (async () => {
      try {
        const comments = await base44.entities.Comment.filter({ goalmap_id: activeMapId }, 'created_date', 500);
        const counts = {};
        for (const c of comments || []) {
          counts[c.node_id] = (counts[c.node_id] || 0) + 1;
        }
        setCommentCounts(counts);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [activeMapId, isPublicView, editNodeId]);

  // Počty příloh → odznak se sponkou na kartě uzlu. Stejný spouštěč jako
  // u komentářů (zavření detailu uzlu), ať se odznak objeví hned po přidání.
  useEffect(() => {
    if (!activeMapId || isPublicView) return;
    (async () => {
      try {
        setFileCounts(await base44.nodeFiles.counts(activeMapId));
      } catch (e) {
        setFileCounts({});   // bez příloh se mapa kreslí dál, odznak je bonus
      }
    })();
  }, [activeMapId, isPublicView, editNodeId]);

  // Úkoly mapy → progres na uzlech (podúkoly dědí node_id, počítají se také).
  // Úkoly žijí ve vlastní kolekci — nezasahují do auto-save JSON mapy.
  useEffect(() => {
    if (!activeMapId || isPublicView || !user) return;
    (async () => {
      try {
        const tasks = await base44.entities.Task.filter({ map_id: activeMapId }, 'created_date', 1000);
        const stats = {};
        for (const task of tasks || []) {
          if (!task.node_id) continue;
          const s = (stats[task.node_id] = stats[task.node_id] || { total: 0, done: 0 });
          s.total += 1;
          if (task.status === 'done') s.done += 1;
        }
        setTaskStats(stats);
        setMapTasks(tasks || []);
        setMapTaskCount((tasks || []).length);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [activeMapId, isPublicView, user, taskStatsVersion]);

  useEffect(() => {
    if (!activeMapId) { setRunningAgentNodes(new Set()); return undefined; }
    const load = () => {
      base44.entities.AgentRun
        .filter({ map_id: activeMapId }, '-created_date', 200)
        .then((rows) => setRunningAgentNodes(new Set(
          rows.filter((r) => r.status === 'pending' || r.status === 'running').map((r) => r.node_id)
        )))
        .catch(() => {});
    };
    load();
    // callback agenta mění běh mimo tenhle prohlížeč → bez realtime by indikátor
    // zůstal tepat i po doběhnutí. Debounce: cron odešle dávku běhů naráz a bez
    // něj by každá událost spustila vlastní dotaz na 200 řádků.
    let unsubscribe;
    let timer;
    const debounced = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
    pb.collection('agent_runs').subscribe('*', debounced).then((u) => { unsubscribe = u; }).catch(() => {});
    return () => { clearTimeout(timer); if (unsubscribe) unsubscribe(); };
  }, [activeMapId]);

  return {
    commentCounts, fileCounts, taskStats, mapTasks, mapTaskCount,
    taskStatsVersion, setTaskStatsVersion, runningAgentNodes,
  };
}
