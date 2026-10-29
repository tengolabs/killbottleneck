import { useEffect, useMemo, useRef, useState } from 'react';
import { pb } from '@/api/pb';
import { todayStr } from '@/lib/rhythm';

// Rytmus kroků a ZDRAVÍ BĚHU mapy (styl Proces, 21. 10. 2026) ze serveru
// (GET /api/kb/process-health). Na rozdíl od pravidel (jen editor) ho vidí
// každý, kdo mapu vidí — z něj kreslí karta kroku větu „🔁 každé pondělí"
// i čtenářům a vrchol procesu „N včas · M po termínu · naposledy prošlo".
// Přenačítá se po změně stavu/termínu uzlů nebo pravidel (s odstupem, ať
// autosave a pravidlo na serveru stihnou doběhnout).
export function useProcessHealth({ mapId, enabled, nodes, rules }) {
  const [health, setHealth] = useState(null);
  const podpis = useMemo(() => (nodes || [])
    .filter((n) => n.type !== 'note')
    .map((n) => `${n.id}:${n.data?.status || ''}:${n.data?.deadline || ''}`).join('|')
    + `#${(rules || []).map((r) => `${r.id}:${r.updated || ''}:${r.enabled}`).join(',')}`, [nodes, rules]);
  const posledni = useRef('');
  useEffect(() => {
    if (!mapId || !enabled) { setHealth(null); posledni.current = ''; return undefined; }
    const prvni = posledni.current === '';
    posledni.current = podpis;
    let zivy = true;
    const tm = setTimeout(() => {
      pb.send(`/api/kb/process-health?map=${encodeURIComponent(mapId)}&today=${todayStr()}`, { method: 'GET' })
        .then((h) => { if (zivy) setHealth(h); })
        .catch(() => { /* zdraví je bonus — mapa funguje i bez něj */ });
    }, prvni ? 0 : 2500);
    return () => { zivy = false; clearTimeout(tm); };
  }, [mapId, enabled, podpis]);
  const rhythmById = useMemo(() => {
    const out = {};
    for (const st of health?.steps || []) out[st.id] = st.rhythm;
    return out;
  }, [health]);
  return { health, rhythmById };
}

// Rytmus kroků všech PROCESŮ v seznamu map (Úkoly, Richard 29. 10. 2026: „nepoznám, jestli je to
// proces“) — { mapId: { nodeId: rytmus } }. Jeden dávkový dotaz (/process-rhythms, /checkup 29. 10.:
// ne N× /process-health), znovu při změně mapy (`updated_date`) a po zásahu asistenta (kb-map-changed).
export function useProcessRhythms(maps) {
  const [out, setOut] = useState({});
  const [tik, setTik] = useState(0);
  const procesy = (maps || []).filter((m) => m && m.kind === 'process');
  const podpis = procesy.map((m) => `${m.id}:${m.updated_date || ''}`).sort().join('|');
  useEffect(() => {
    const h = () => setTik((x) => x + 1);
    window.addEventListener('kb-map-changed', h);
    return () => window.removeEventListener('kb-map-changed', h);
  }, []);
  useEffect(() => {
    if (!podpis) { setOut({}); return undefined; }
    let zivy = true;
    const ids = podpis.split('|').map((x) => x.split(':')[0]);
    pb.send(`/api/kb/process-rhythms?maps=${encodeURIComponent(ids.join(','))}`, { method: 'GET' })
      .then((r) => { if (zivy) setOut(r?.maps || {}); })
      .catch(() => { /* rytmus je bonus — seznam funguje i bez něj */ });
    return () => { zivy = false; };
  }, [podpis, tik]);
  return out;
}
