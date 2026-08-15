import { useCallback, useEffect, useState } from 'react';

/**
 * Směr rozložení mapy s ohledem na zařízení.
 *  mode: 'auto' | 'vertical' | 'horizontal'  (uživatelská volba, drží se v localStorage)
 *  narrow: true na úzkých displejích (telefon/tablet na výšku), práh 768 px
 *  direction: efektivní směr — v režimu auto se na úzkém displeji překlopí na 'horizontal'
 *
 * 'vertical' = strom dolů (na výšku), 'horizontal' = strom doprava (na šířku).
 */
const KEY = 'flowmap-map-direction'; // legacy klíč — už se jen uklízí
const BREAKPOINT = 768;

export function useMapDirection() {
  // Ruční volba směru platí JEN pro aktuální otevření mapy — NEpersistuje se.
  // Dřívější ukládání do localStorage znamenalo, že jedno ruční přepnutí navždy
  // vypnulo automatiku „dle displeje" na všech mapách (mobil pak zůstával svisle).
  const [mode, setModeState] = useState('auto');
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(`(max-width: ${BREAKPOINT}px)`).matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${BREAKPOINT}px)`);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }, []);

  const setMode = useCallback((m) => setModeState(m), []);

  const direction = mode === 'auto' ? (narrow ? 'horizontal' : 'vertical') : mode;
  return { mode, setMode, direction, narrow };
}
