import { useState, useEffect, useCallback, useMemo } from 'react';
import { base44 } from '@/api/base44Client';

// Úkoly — vzor useBufferNodes: lokální stav + optimistické CRUD.
// mapId omezí načtení na jednu mapu (NodeTasksDialog, editor).
export function useTasks(user, { mapId } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const list = mapId
        ? await base44.entities.Task.filter({ map_id: mapId }, '-created_date', 1000)
        : await base44.entities.Task.list('-created_date', 1000);
      setItems(list);
    } catch {
      // seznam není kritický — při chybě zůstane prázdný
    } finally {
      setLoading(false);
    }
  }, [user, mapId]);

  useEffect(() => { refresh(); }, [refresh]);

  const add = useCallback(async (data) => {
    const item = await base44.entities.Task.create({ status: 'todo', ...data });
    setItems((prev) => [item, ...prev]);
    return item;
  }, []);

  const update = useCallback(async (id, patch) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    try {
      const item = await base44.entities.Task.update(id, patch);
      setItems((prev) => prev.map((i) => (i.id === id ? item : i)));
      return item;
    } catch (e) {
      refresh();
      throw e;
    }
  }, [refresh]);

  const remove = useCallback(async (id) => {
    // podúkoly maže server cascadem, lokálně je odfiltrujeme rovnou
    setItems((prev) => prev.filter((i) => i.id !== id && i.parent_id !== id));
    try {
      await base44.entities.Task.delete(id);
    } catch (e) {
      // chybu nést dál — dřív se tu spolkla a úkol se po refreshi beze slova
      // vrátil (server mazání právem odmítl, ale uživatel se to nedozvěděl)
      refresh();
      throw e;
    }
  }, [refresh]);

  const byParent = useMemo(() => {
    const m = {};
    for (const t of items) {
      if (t.parent_id) (m[t.parent_id] = m[t.parent_id] || []).push(t);
    }
    return m;
  }, [items]);

  return { items, loading, add, update, remove, refresh, byParent };
}
