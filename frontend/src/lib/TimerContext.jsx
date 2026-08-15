import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { intlLocale, parsePbDate } from '@/lib/locale';

// Globální stopky (měření času práce). Běžící záznam žije v DB (time_entries,
// ended = '') — přežije reload i zavřený prohlížeč; context ho drží pro
// TimerWidget v hlavičce a Start/Stop tlačítka u úkolů. Jediný běžící timer
// na uživatele vynucuje server (start nového zavře starý).

const TimerContext = createContext(null);

// PB vrací datum s mezerou ("2026-07-21 09:00:00.000Z") — převod řeší lib/locale
const parseDate = (s) => (s ? parsePbDate(s) : null);

export function TimerProvider({ children }) {
  const { user } = useAuth();
  const [running, setRunning] = useState(null); // TimeEntry DTO s ended = ''
  const [elapsed, setElapsed] = useState(0); // sekundy

  const refresh = useCallback(() => {
    if (!user) {
      setRunning(null);
      return;
    }
    base44.entities.TimeEntry.filter({ ended: '' }, '-started', 1)
      .then((list) => setRunning(list?.[0] || null))
      .catch(() => {});
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const startMs = parseDate(running.started)?.getTime() || Date.now();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [running]);

  // start({map_id, task_id, node_id, client_id, label}) — server případný běžící záznam zavře
  const start = useCallback(async (target = {}) => {
    const rec = await base44.entities.TimeEntry.create({
      started: new Date().toISOString(),
      ended: '',
      map_id: target.map_id || '',
      task_id: target.task_id || '',
      node_id: target.node_id || '',
      client_id: target.client_id || '',
      label: (target.label || '').slice(0, 200),
    });
    setRunning(rec);
    return rec;
  }, []);

  // přiřazení ZA BĚHU (projekt/klient/poznámka) — timer běží dál
  const assign = useCallback(async (patch = {}) => {
    if (!running) return null;
    const rec = await base44.entities.TimeEntry.update(running.id, patch);
    setRunning(rec);
    return rec;
  }, [running]);

  // stop(patch) — patch může nést i finální přiřazení (map_id/client_id/note/label)
  const stop = useCallback(async (patch = {}) => {
    if (!running) return null;
    const rec = await base44.entities.TimeEntry.update(running.id, {
      ...patch,
      ended: new Date().toISOString(),
    });
    setRunning(null);
    return rec;
  }, [running]);

  return (
    <TimerContext.Provider value={{ running, elapsed, start, assign, stop, refresh }}>
      {children}
    </TimerContext.Provider>
  );
}

// mimo provider (např. veřejné stránky) vrací neaktivní stopky, ať komponenty nepadají
export const useTimer = () =>
  useContext(TimerContext) || { running: null, elapsed: 0, start: async () => null, assign: async () => null, stop: async () => null, refresh: () => {} };

// „od–do" záznamu (HH:MM–HH:MM) — Richard: „5 min kolem 9:00 a docvakne mi, co to bylo"
export const formatTimeRange = (started, ended) => {
  const fmt = (s) => {
    const d = parseDate(s);
    return d ? d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }) : '?';
  };
  return `${fmt(started)}–${fmt(ended)}`;
};

export const formatElapsed = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
};
