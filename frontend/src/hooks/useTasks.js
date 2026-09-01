import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { base44 } from '@/api/base44Client';

// Strop stránky úkolů (rozhodnutí vlastníka 1. 9. 2026): místo tichého
// stropu 1000 (org s víc úkoly NEVIDĚLA nejstarší a nic to neřeklo) se
// načte prvních 500 a přes listPage() se ví, kolik jich je CELKEM —
// stránka může ukázat pruh „Zobrazeno X z Y" s tlačítkem Načíst vše.
const STRANKA = 500;

// Úkoly — vzor useBufferNodes: lokální stav + optimistické CRUD.
// mapId omezí načtení na jednu mapu (NodeTasksDialog, editor) — per-mapa
// dotaz zůstává beze změny (jedna mapa se do stropu vejde vždy).
export function useTasks(user, { mapId } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [castecne, setCastecne] = useState(false);
  // „Načíst vše" drží i přes další refresh() (deep-linky a řádkové akce
  // refreshují často — pruh se nesmí po každé akci vracet)
  const vseRef = useRef(false);

  // stránkovaný dotaz: první stránka vždy, zbylé jen když vse=true.
  // Řazení nese tiebreak `id` — úkoly založené ve stejné ms by jinak mohly
  // mezi stránkami přeskakovat (duplicitní/chybějící řádky); dedupe navrch.
  const nactiStranky = useCallback(async (vse) => {
    const prvni = await base44.entities.Task.listPage('-created_date,id', 1, STRANKA);
    let list = prvni.items;
    if (vse && prvni.totalPages > 1) {
      const videne = new Set(list.map((i) => i.id));
      for (let p = 2; p <= prvni.totalPages; p++) {
        const dalsi = await base44.entities.Task.listPage('-created_date,id', p, STRANKA);
        list = list.concat(dalsi.items.filter((i) => !videne.has(i.id) && videne.add(i.id)));
      }
    }
    return { list, totalItems: prvni.totalItems };
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (mapId) {
        const list = await base44.entities.Task.filter({ map_id: mapId }, '-created_date', 1000);
        setItems(list);
        setTotal(list.length);
        setCastecne(false);
      } else {
        const { list, totalItems } = await nactiStranky(vseRef.current);
        setItems(list);
        setTotal(totalItems);
        setCastecne(totalItems > list.length);
      }
    } catch {
      // seznam není kritický — při chybě zůstane prázdný
    } finally {
      setLoading(false);
    }
  }, [user, mapId, nactiStranky]);

  // klik na „Načíst vše" v pruhu — dotáhne zbylé stránky a pruh zmizí
  const nacistVse = useCallback(async () => {
    vseRef.current = true;
    await refresh();
  }, [refresh]);

  useEffect(() => { refresh(); }, [refresh]);

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

  return { items, loading, total, castecne, nacistVse, update, remove, refresh, byParent };
}
