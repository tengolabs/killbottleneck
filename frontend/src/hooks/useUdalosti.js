import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { listUdalosti, listPripominkyUzlu, listKalendare, sledujKolekci } from '@/api/udalosti';
import { posunDny } from '@/lib/kalendar';

// Události a připomínky k uzlům pro kalendář na /tasks (19. 9. 2026).
// `aktivni` = načítat jen když je kalendář otevřený (jiné pohledy je nepotřebují).
// Položka kalendáře má STEJNÝ tvar jako uzly (hooks/useTaskTrees.js:calendarItems),
// aby TaskCalendar a lib/kalendar.js nepotřebovaly druhou větev: `deadline` je
// tu jen den v mřížce (událost NENÍ úkol — proto kind:'event', bez map_id).
export function useUdalosti({ aktivni, userEmail }) {
  const [udalosti, setUdalosti] = useState([]);
  const [pripominky, setPripominky] = useState([]);
  const [kalendare, setKalendare] = useState([]);
  const [nacteno, setNacteno] = useState(false);
  const timer = useRef(null);

  const nacti = useCallback(async () => {
    try {
      const [u, p, k] = await Promise.all([listUdalosti(), listPripominkyUzlu(), listKalendare().catch(() => null)]);
      setUdalosti(u?.events || []);
      setPripominky(p?.reminders || []);
      if (k) setKalendare(k.calendars || []);
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
    const odK = sledujKolekci('calendars', naZmenu);
    window.addEventListener('kb-native-resume', naZmenu);
    window.addEventListener('kb-udalosti-changed', naZmenu);
    return () => {
      clearTimeout(timer.current);
      odU(); odP(); odK();
      window.removeEventListener('kb-native-resume', naZmenu);
      window.removeEventListener('kb-udalosti-changed', naZmenu);
    };
  }, [aktivni, nacti]);

  // Vícedenní událost (dovolená 20.–24.) = jedna položka NA KAŽDÝ DEN (mřížka seskupuje podle
  // `deadline`); klíč nese den, `prvni`/`posledni` kreslí okraje pruhu. Strop 62 dní na událost.
  const items = useMemo(() => {
    const out = [];
    for (const ev of udalosti) {
      const dny = [ev.day];
      if (ev.end_day && ev.end_day > ev.day) {
        for (let d = posunDny(ev.day, 1), i = 0; d && d <= ev.end_day && i < 61; d = posunDny(d, 1), i++) dny.push(d);
      }
      const vice = dny.length > 1;
      dny.forEach((den, i) => out.push({
        key: vice ? `ev-${ev.id}:${den}` : `ev-${ev.id}`,
        title: ev.title,
        deadline: den,
        time: i === 0 ? (ev.time || '') : '',
        end_time: ev.end_time || '',
        end_day: ev.end_day || '',
        prvni: i === 0,
        posledni: i === dny.length - 1,
        status: 'todo',
        kind: 'event',
        druh: ev.kind || '',          // '' osobní | shared | resource | absence
        calendar: ev.calendar || '',
        calendar_name: ev.calendar_name || '',
        away: ev.away || [],
        stav: ev.status || '',
        map_id: '',
        node_id: '',
        created_by: ev.owner_email,
        mine: ev.mine === true || ev.owner_email === userEmail,
        can_edit: ev.can_edit !== undefined ? !!ev.can_edit : (ev.mine === true || ev.owner_email === userEmail),
        participants: ev.participants || [],
        remind: !!ev.remind,
        remind_before_min: ev.remind_before_min || 0,
        raw: ev,
      }));
    }
    return out;
  }, [udalosti, userEmail]);

  // "<mapId>:<nodeId>" → připomínka (ikona zvonečku na chipu uzlu)
  const pripominkyPodleUzlu = useMemo(() => {
    const m = new Map();
    for (const r of pripominky) m.set(`${r.map_id}:${r.node_id}`, r);
    return m;
  }, [pripominky]);

  return { udalosti, items, pripominky, pripominkyPodleUzlu, kalendare, nacteno, reload: nacti };
}
