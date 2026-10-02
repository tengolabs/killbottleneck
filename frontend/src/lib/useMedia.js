import { useState, useEffect } from 'react';

// Živá shoda s CSS media dotazem (mění se s velikostí okna).
export function useMedia(dotaz) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(dotaz).matches);
  useEffect(() => {
    const mq = window.matchMedia(dotaz);
    const h = (e) => setM(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [dotaz]);
  return m;
}
