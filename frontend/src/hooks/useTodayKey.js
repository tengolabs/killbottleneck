import { useState, useEffect } from 'react';
import { dnesKlic } from '@/lib/kalendar';

// Key of the local day ("2026-11-12") that CHANGES when the day changes while the page stays open
// (code analysis 4, F3-06). The Tasks page is a work surface people leave open overnight: the
// timeline computed "today" once on the first render and My day kept yesterday's sections.
// Checked when the tab comes back (visibility, focus, wake-up of the mobile shell) and once a
// minute; the state changes only when the key really differs, so nothing re-renders in between.
export function useTodayKey() {
  const [key, setKey] = useState(() => dnesKlic());
  useEffect(() => {
    const check = () => setKey((prev) => { const now = dnesKlic(); return now === prev ? prev : now; });
    const iv = setInterval(check, 60000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    window.addEventListener('kb-native-resume', check);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      window.removeEventListener('kb-native-resume', check);
    };
  }, []);
  return key;
}
