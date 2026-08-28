import { useState, useCallback } from 'react';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';

// Levé panely (zásobník × měření času): sdílené localStorage klíče, otevřený
// panel obsah odsouvá doprava a naráz je otevřený nejvýš jeden (překrývaly by
// se). Jedna implementace pro Home, Úkoly i editor mapy — dřív tři opsané kopie
// (analýza kódu 27. 8. 2026, F3-10).
export function useSidePanels() {
  const [bufferOpen, setBufferOpen] = useState(() => nactiKlic('kb-buffer-open') === '1');
  const [timeLogOpen, setTimeLogOpen] = useState(() =>
    nactiKlic('kb-timelog-open') === '1' && nactiKlic('kb-buffer-open') !== '1');
  const toggleBuffer = useCallback(() => {
    setBufferOpen((v) => {
      ulozKlic('kb-buffer-open', v ? '0' : '1');
      if (!v) { setTimeLogOpen(false); ulozKlic('kb-timelog-open', '0'); }
      return !v;
    });
  }, []);
  const toggleTimeLog = useCallback(() => {
    setTimeLogOpen((v) => {
      ulozKlic('kb-timelog-open', v ? '0' : '1');
      if (!v) { setBufferOpen(false); ulozKlic('kb-buffer-open', '0'); }
      return !v;
    });
  }, []);
  return { bufferOpen, timeLogOpen, toggleBuffer, toggleTimeLog, setBufferOpen, setTimeLogOpen };
}
