import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { listUdalosti, listPripominkyUzlu, sledujKolekci } from '@/api/udalosti';

// Události a připomínky k uzlům pro kalendář na /tasks (19. 9. 2026).
// `aktivni` = načítat jen když je kalendář otevřený (jiné pohledy je nepotřebují).
// Položka kalendáře má STEJNÝ tvar jako uzly (hooks/useTaskTrees.js:calendarItems),
// aby TaskCalendar a lib/kalendar.js nepotřebovaly druhou větev: `deadline` je
// tu jen den v mřížce (událost NENÍ úkol — proto kind:'event', bez map_id).
export function useUdalosti({ aktivni, userEmail }) {
  const [udalosti, setUdalosti] = useState([]);
  const [pripominky, setPripominky] = useState([]);
  const [nacteno, setNacteno] = useState(false);
  const timer = useRef(null);

  const nacti = useCallback(async () => {
    try {
      const [u, p] = await Promise.all([listUdalosti(), listPripominkyUzlu()]);
      setUdalosti(u?.events || []);
      setPripominky(p?.reminders || []);
    } catch { /* výpadek → poslední známý stav; realtime to dožene */ }
    finally { setNacteno(true); }
  }, []);

  useEffect(() => {
    if (!aktivni) return undefined;
    nacti();
    // 200 ms debounce: hromadná změna (účastníci) by jinak vyvolala N načtení
    const naZmenu = () => { clearTimeout(timer.current); timer.current = setTimeout(nacti, 200); };
    const odU = sledujKolekci('events', naZmenu);
    const odP = sledujKolekci('node_reminders', naZmenu);
    window.addEventListener('kb-native-resume', naZmenu);
    window.addEventListener('kb-udalosti-changed', naZmenu);
    return () => {
      clearTimeout(timer.current);
      odU(); odP();
      window.removeEventListener('kb-native-resume', naZmenu);
      window.removeEventListener('kb-udalosti-changed', naZmenu);
    };
  }, [aktivni, nacti]);

  const items = useMemo(() => udalosti.map((ev) => ({
    key: `ev-${ev.id}`,
    title: ev.title,
    deadline: ev.day,
    time: ev.time || '',
    status: 'todo',
    kind: 'event',
    map_id: '',
    node_id: '',
    created_by: ev.owner_email,
    mine: ev.mine === true || ev.owner_email === userEmail,
    participants: ev.participants || [],
    remind: !!ev.remind,
    remind_before_min: ev.remind_before_min || 0,
    raw: ev,
  })), [udalosti, userEmail]);

  // "<mapId>:<nodeId>" → připomínka (ikona zvonečku na chipu uzlu)
  const pripominkyPodleUzlu = useMemo(() => {
    const m = new Map();
    for (const r of pripominky) m.set(`${r.map_id}:${r.node_id}`, r);
    return m;
  }, [pripominky]);

  return { udalosti, items, pripominky, pripominkyPodleUzlu, nacteno, reload: nacti };
}
