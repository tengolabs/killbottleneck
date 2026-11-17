import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { toast } from '@/components/ui/use-toast';
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

  const gen = useRef(0);
  const retries = useRef(0);
  const retryTimer = useRef(null);
  const refreshRef = useRef(null);
  const refresh = useCallback(() => {
    if (!user) {
      setRunning(null);
      return Promise.resolve();
    }
    // a re-read started before a Start/Stop/assign of this tab must not overwrite its result
    const g = ++gen.current;
    return base44.entities.TimeEntry.filter({ ended: '' }, '-started', 1)
      .then((list) => { if (g === gen.current) { retries.current = 0; setRunning(list?.[0] || null); } })
      // A failed read leaves the header without the running timer, which reads as "nothing is running"
      // (code analysis 4, F5-08) — ask again a few times instead of waiting for a manual reload.
      .catch(() => {
        if (g !== gen.current || retries.current >= 4) return;
        retries.current += 1;
        clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => refreshRef.current?.(), retries.current === 1 ? 5000 : 30000);
      });
  }, [user]);
  refreshRef.current = refresh;
  useEffect(() => () => clearTimeout(retryTimer.current), []);

  useEffect(() => { refresh(); }, [refresh]);

  // The timer may have been closed elsewhere (a new one started in another tab or on the
  // phone, the 12 h auto-stop) — coming back to this tab re-reads it, so the tab does not
  // keep ticking on an entry that has ended (finding F6-04).
  useEffect(() => {
    if (!user) return undefined;
    const onReturn = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [user, refresh]);

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
    gen.current++;
    setRunning(rec);
    return rec;
  }, []);

  // přiřazení ZA BĚHU (projekt/klient/poznámka) — timer běží dál
  const assign = useCallback(async (patch = {}) => {
    if (!running) return null;
    const rec = await base44.entities.TimeEntry.update(running.id, patch);
    gen.current++;
    setRunning(rec);
    return rec;
  }, [running]);

  // stop(patch) — patch může nést i finální přiřazení (map_id/client_id/note/label)
  const stop = useCallback(async (patch = {}) => {
    if (!running) return null;
    try {
      const rec = await base44.entities.TimeEntry.update(running.id, {
        ...patch,
        ended: new Date().toISOString(),
      });
      gen.current++;
      setRunning(null);
      return rec;
    } catch (err) {
      // 409 = the entry was already closed elsewhere and the server keeps its end (F6-04);
      // 404 = it was deleted. Either way this tab was showing a timer that no longer runs:
      // nothing is written, the tab shows what really runs now, and the caller gets the
      // entry as the server recorded it, marked `alreadyEnded` (no "time recorded" toast).
      if (err?.status !== 409 && err?.status !== 404) throw err;
      // what the person filled in at Stop (note, project, client) is still theirs to keep:
      // the server lets a finished entry take it, only the end stays
      const keep = Object.fromEntries(Object.entries(patch).filter(([k, v]) => k !== 'ended' && v !== '' && v != null));
      let rec = null;
      if (err.status === 409) {
        if (Object.keys(keep).length) rec = await base44.entities.TimeEntry.update(running.id, keep).catch(() => null);
        if (!rec) rec = await base44.entities.TimeEntry.get(running.id).catch(() => null);
      }
      await refresh();
      // said here, once, for every Stop button (header, panel, node, task row)
      if (err.status === 409 && err?.response?.message) toast({ title: err.response.message });
      return { ...(rec || {}), alreadyEnded: true };
    }
  }, [running, refresh]);

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
