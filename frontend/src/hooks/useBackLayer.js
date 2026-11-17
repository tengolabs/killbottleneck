import { useEffect, useRef } from 'react';
import { openLayer, closeLayer } from '@/lib/backLayers';

// While `active`, the browser's back closes this layer (calls `onBack`) instead of leaving the page — lib/backLayers.js.
// `block`: back does nothing (relax locked with a PIN). Nested layers: the one that opened last closes first
// (a game over the Brain training list → back = the list, back again = the zone closes); `level` decides between
// layers that open in the same render (a restored Office panel over the restored assistant on a phone).
export function useBackLayer(active, onBack, block = false, level = 0) {
  const ref = useRef({ onBack, block });
  ref.current = { onBack, block };
  useEffect(() => {
    if (!active) return undefined;
    const layer = { level, get: () => ref.current };
    openLayer(layer);
    return () => closeLayer(layer);
  }, [active]); // (the level of a layer is fixed)
}
