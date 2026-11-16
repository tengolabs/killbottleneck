import { useEffect, useLayoutEffect, useState } from 'react';
import { useAsistent } from '@/lib/AsistentContext';
import { useSpodekHlavicky } from '@/hooks/useSpodekHlavicky';

// Shared placement of a "zone" layer (relax 🐟, brain training 🧠) relative to the assistant panel.
// Extracted from RelaxVrstva (9 Nov 2026) so both zones behave identically:
//   full  — the whole viewport (z-[60]: above the assistant panel, below toasts)
//   side  — left of the chat instead of the map (fixed, right = chat width, BELOW the top bar); the map
//           stays mounted underneath, the chat keeps working
//   above — side layout on a narrow window (phone, portrait) or in lite: the zone takes the top
//           ABOVE_SHARE of the height and the chat sits under it (AsistentPanel reads the same constant)
//   aboveBar — phone with the panel collapsed to the bottom bar (chat-bar): the zone fills everything above it
export const ABOVE_SHARE = '40%';

// underPanelHeader (brain zone, Richard 15 Nov 2026: "when I press the brain, the list opens over the whole screen, but the bar
// must stay visible"): on a phone the zone does not take the top 40 % — it fills everything UNDER the assistant panel's header
// bar (🧠 in it closes the zone, ⌄ collapses the panel), so the player always sees where they are. Relax keeps the 40 % split.
export function useZoneLayout({ lite = false, layout = 'side', locked = false, underPanelHeader = false } = {}) {
  const A = useAsistent();
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  // low window = phone in landscape: the toolbar becomes one strip at the top (callers use `strip`)
  const [low, setLow] = useState(() => typeof window !== 'undefined' && window.innerHeight < 500);
  useEffect(() => {
    const f = () => { setNarrow(window.innerWidth < 640); setLow(window.innerHeight < 500); };
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  // lite has its own open state (liteOpen) and a full-width panel → the split is always "above"
  const open = lite ? A.liteOpen : A.open;
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    if (!narrow || lite || open) { setBarHeight(0); return undefined; }
    const el = document.querySelector('[data-testid="chat-bar"]');
    if (!el) { setBarHeight(0); return undefined; }
    const measure = () => setBarHeight(Math.round(el.getBoundingClientRect().height));
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, [narrow, lite, open, layout]);
  const aboveBar = narrow && !lite && !open && A.dostupny && barHeight > 0;
  // bottom edge of the assistant panel's header bar (window coordinates) for `underPanelHeader`
  // measured BEFORE paint (useLayoutEffect) and seeded from the DOM: with a plain effect the first frame used the 40 %
  // fallback over the bar and jumped under it ~300 ms later (checkup 15 Nov 2026 — a flash, and a flaky ui-brain check)
  const panelHeader = () => (typeof document !== 'undefined' ? document.querySelector('[data-testid="chat-hlavicka"]') : null);
  const [panelHeaderBottom, setPanelHeaderBottom] = useState(() => {
    const el = underPanelHeader && (narrow || lite) && open ? panelHeader() : null;
    return el ? Math.max(0, Math.round(el.getBoundingClientRect().bottom)) : 0;
  });
  useLayoutEffect(() => {
    if (!underPanelHeader || !(narrow || lite) || !open) { setPanelHeaderBottom(0); return undefined; }
    const el = panelHeader();
    if (!el) { setPanelHeaderBottom(0); return undefined; }
    const measure = () => setPanelHeaderBottom(Math.max(0, Math.round(el.getBoundingClientRect().bottom)));
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) { ro.observe(el); if (el.parentElement) ro.observe(el.parentElement); }
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [underPanelHeader, narrow, lite, open, layout]);
  // the zone starts under the pinned top bar (lite has none → 0)
  const headerBottom = useSpodekHlavicky(!lite);
  const sideAllowed = (open && A.dostupny && (narrow || lite || A.width > 0)) || aboveBar;
  const side = layout === 'side' && sideAllowed && !locked;
  const above = side && (narrow || lite);
  const underHeader = above && !aboveBar && underPanelHeader && panelHeaderBottom > 0;
  const style = above
    ? (aboveBar ? { top: headerBottom, left: 0, right: 0, bottom: barHeight }
      : underHeader ? { top: panelHeaderBottom, left: 0, right: 0, bottom: 0 }
        : { top: headerBottom, left: 0, right: 0, height: ABOVE_SHARE })
    : side ? (A.side === 'left' ? { top: headerBottom, left: A.width, right: 0, bottom: 0 } : { top: headerBottom, right: A.width, left: 0, bottom: 0 }) : undefined; // assistant on the left (v1.1.0) → zone to its right
  // under the panel header the zone overlaps the panel body (panel = z-40) → z-50; toasts/dialogs stay above (z-60+)
  const classes = underHeader ? 'fixed z-50' : side ? 'fixed z-40' : 'fixed inset-0 z-[60]';
  return { narrow, low, strip: narrow || low, side, above, aboveBar, underHeader, sideAllowed, barHeight, headerBottom, style, classes, mode: above ? 'nad' : side ? 'vedle' : 'cela' };
}
