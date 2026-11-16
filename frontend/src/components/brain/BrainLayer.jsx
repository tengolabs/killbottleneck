import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Columns2, Expand, Maximize2, MessageSquare, Minimize2, X } from 'lucide-react';
import { useAsistent } from '@/lib/AsistentContext';
import { useLazyNs } from '@/i18n/lazyNs';
import { effectiveTheme } from '@/lib/theme';
import { useZoneLayout } from '@/components/zones/useZoneLayout';
import BrainHub from './BrainHub';
import { GAMES_VERSION, gameMeta, formatScore, unitLabel, startRound, finishRound, loadSummary, maxLevels } from './brainApi';

// Brain training zone 🧠 (9 Nov 2026): sibling of the relax zone — same placement (full / side / above the
// chat on a phone, see useZoneLayout), no countdown and no PIN lock. The hub (React) lists the daily set;
// a game is one static file public/brain/<id>.html in an iframe (contract: README.md). Every round is
// opened on the server (/start) before the game begins and closed (/finish) when the game posts `result`;
// after a result the next round of the same game is opened right away, because the game's own
// "Play again" starts without asking the hub. Rounds left open are simply abandoned.
// Theme for the game file: the app may be dark through a dark SKIN while the light/dark switch says light (skin "Půlnoc"),
// so read the real page background and fall back to the switch.
// A transparent background (no skin paints the body) must NOT count as black → fall through to the switch.
function pickTheme() {
  try {
    for (const el of [document.body, document.documentElement]) {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(getComputedStyle(el).backgroundColor || '');
      if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) continue;
      const lum = (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
      return lum < 0.5 ? 'dark' : 'light';
    }
  } catch { /* no DOM */ }
  return effectiveTheme();
}

const Tool = ({ onClick, title, testid, active, children }) => (
  <button type="button" onClick={onClick} title={title} aria-label={title} aria-pressed={active === undefined ? undefined : !!active}
    className={`inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors hover:bg-secondary ${active ? 'bg-secondary' : ''}`}
    data-testid={testid}>
    {children}
  </button>
);

export default function BrainLayer({ lite = false }) {
  const ready = useLazyNs('brain');
  const { t, i18n } = useTranslation('brain');
  const A = useAsistent();
  const b = A.brain;
  const { updateBrain, stopBrain } = A;
  const L = useZoneLayout({ lite, layout: b && b.layout === 'vedle' ? 'side' : 'full', underPanelHeader: true });
  const lang = /^en/.test(i18n.language || '') ? 'en' : 'cs';

  // summary from the server (today's set, streak, bests)
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    setLoading(true);
    loadSummary().then((s) => { setSummary(s); setLoading(false); }, () => setLoading(false));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // the open round: { id, game, level } — the iframe is keyed by game+level so a level change reloads it
  const game = b && gameMeta(b.game) ? b.game : '';
  const level = game ? Math.min(maxLevels(game, L.narrow), Math.max(1, Math.round(Number((b.levels || {})[game]) || 1))) : 1;
  // "Assistant" / "next to the chat": opens the (collapsed) assistant panel and seats the zone beside or under its header
  const chatOpen = lite ? A.liteOpen : A.open;
  const showChat = useCallback(() => {
    if (!chatOpen) (lite ? A.setLiteOpen : A.setOpen)(true);
    updateBrain({ layout: 'vedle', zpet: '' });
  }, [chatOpen, lite, A, updateBrain]);
  const leaveGame = useCallback(() => updateBrain({ game: '' }), [updateBrain]);
  const round = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [last, setLast] = useState(null); // last finished result (shown as a bar under the game)
  const iframe = useRef(null);
  // sequence number: a late answer of an OLDER /start (level changed meanwhile) must not become the open round
  const roundSeq = useRef(0);
  const openRound = useCallback((g, lvl) => {
    round.current = null;
    const seq = ++roundSeq.current;
    startRound(g, lvl).then((r) => { if (seq === roundSeq.current && r && r.id) round.current = { id: r.id, game: g, level: lvl }; }, () => { if (seq === roundSeq.current) round.current = null; });
  }, []);
  useEffect(() => {
    setLoaded(false); setLast(null);
    if (game) openRound(game, level);
    return () => { round.current = null; };
  }, [game, level, openRound]);

  // Theme of the game file: read once per game+level+language into the URL; a later change of the app theme or skin
  // is SENT to the running game as a message, so it recolours without restarting (Richard's klik-test 14. 11.).
  const [theme, setThemeState] = useState(pickTheme);
  useEffect(() => {
    const check = () => { const th = pickTheme(); setThemeState((prev) => (prev === th ? prev : th)); };
    const mo = new MutationObserver(check);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-skin'] });
    if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-skin'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', check);
    return () => { mo.disconnect(); mq.removeEventListener('change', check); };
  }, []);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const src = useMemo(() => (game ? `/brain/${game}.html?embed=1&lang=${lang}&level=${level}&theme=${themeRef.current}&v=${GAMES_VERSION}` : ''), [game, level, lang]);
  useEffect(() => {
    if (!loaded || !iframe.current || !iframe.current.contentWindow) return;
    try { iframe.current.contentWindow.postMessage({ type: 'kb-brain', action: 'theme', theme }, window.location.origin); } catch { /* gone */ }
  }, [theme, loaded]);

  // messages from the game (same origin, and only from OUR iframe)
  useEffect(() => {
    const f = (e) => {
      if (e.origin !== window.location.origin || !e.data || e.data.type !== 'kb-brain') return;
      if (!iframe.current || e.source !== iframe.current.contentWindow) return;
      const d = e.data;
      if (d.event === 'ready') { setLoaded(true); return; }
      if (d.event === 'close') { leaveGame(); return; }
      // the player picked a level inside the game: the hub takes it over and reloads the game at that level
      if (d.event === 'level') {
        const n = Number(d.level);
        if (n >= 1 && n <= maxLevels(game, L.narrow) && n !== level) updateBrain({ levels: { ...(b.levels || {}), [game]: n } });
        return;
      }
      if (d.event !== 'result' || !game) return;
      const r = round.current;
      round.current = null;
      const res = { game, level, won: !!d.won, score: Number(d.score) || 0, durationMs: Number(d.durationMs) || 0 };
      const done = r && r.game === game && r.level === level ? finishRound(r.id, res) : Promise.reject(new Error('no open round'));
      done.then((out) => { if (out && out.summary) setSummary(out.summary); }, () => refresh());
      setLast(res);
      openRound(game, level); // the game's own "Play again" will start without asking us
    };
    window.addEventListener('message', f);
    return () => window.removeEventListener('message', f);
  }, [game, level, b, openRound, refresh, updateBrain, leaveGame]);

  // browser full screen (from the layer, not the iframe); Esc leaves it, the zone stays
  const [fsBrowser, setFsBrowser] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  const backToSide = !!(b && b.zpet === 'vedle');
  useEffect(() => {
    const f = () => {
      const fs = !!document.fullscreenElement;
      setFsBrowser(fs);
      if (!fs && backToSide) updateBrain({ layout: 'vedle', zpet: '' });
    };
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, [backToSide, updateBrain]);
  const toggleFsBrowser = useCallback(() => {
    try {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    } catch { /* no support */ }
  }, []);
  const close = useCallback(() => {
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch { /* fine */ }
    stopBrain();
  }, [stopBrain]);

  if (!b) return null;
  const side = L.side;
  const barClass = L.strip
    ? 'flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b bg-card px-1'
    : 'flex h-11 shrink-0 items-center gap-1 border-b bg-card px-2';
  const best = summary && summary.bests && summary.bests[game] ? summary.bests[game][level] : undefined;

  return (
    <div className={`${L.classes} flex flex-col overflow-hidden bg-background text-foreground`} style={L.style}
      data-testid="brain-vrstva" data-rozlozeni={L.mode} data-nad-listou={L.aboveBar ? '1' : '0'} data-hra={game || 'hub'} data-uroven={level} data-nacteno={!game || loaded ? '1' : '0'}>
      {ready && (
        <div className={barClass} data-testid="brain-lista">
          {game
            ? <Tool onClick={leaveGame} title={t('back')} testid="brain-zpet"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">{t('back')}</span></Tool>
            : <span className="inline-flex items-center gap-1 px-2 text-sm font-semibold">🧠 {t('title')}</span>}
          {game && <span className="truncate px-1 text-sm font-medium" data-testid="brain-nazev">{t(`game.${game}`)}{gameMeta(game).levels > 1 ? ` · ${t('level')} ${level}` : ''}</span>}
          <span className="flex-1" />
          {A.dostupny && (side
            // on a phone the zone already fills the screen under the assistant's header bar, and that bar must stay visible → no full-screen toggle there
            ? (L.above ? null : <Tool onClick={() => updateBrain({ layout: 'cela', zpet: 'vedle' })} title={t('layoutFull')} testid="brain-rozlozeni" active><Maximize2 className="h-4 w-4" /></Tool>)
            : chatOpen
              ? <Tool onClick={showChat} title={t(L.narrow || lite ? 'layoutAbove' : 'layoutSide')} testid="brain-rozlozeni"><Columns2 className="h-4 w-4" /></Tool>
              // the assistant panel is closed (collapsed on a phone / lite, closed on a computer): the zone fills the window and
              // the only way out used to be ✕ (Richard 15 Nov 2026) — a labelled button brings the assistant back with the zone beside/above it
              : <Tool onClick={showChat} title={t('showChat')} testid="brain-rozlozeni"><MessageSquare className="h-4 w-4" /><span>{t('showChat')}</span></Tool>)}
          <Tool onClick={() => { if (side && !L.above) updateBrain({ layout: 'cela', zpet: 'vedle' }); toggleFsBrowser(); }} title={fsBrowser ? t('browserBack') : t('browserFull')} testid="brain-cela-obrazovka" active={fsBrowser}>
            {fsBrowser ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
          </Tool>
          {backToSide
            ? <Tool onClick={() => { try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch { /* fine */ } updateBrain({ layout: 'vedle', zpet: '' }); }} title={t(L.narrow || lite ? 'backAbove' : 'backSide')} testid="brain-zpet-vedle"><Minimize2 className="h-4 w-4" /></Tool>
            : <Tool onClick={close} title={t('close')} testid="brain-konec"><X className="h-4 w-4" /></Tool>}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {ready && !game && (
          <BrainHub summary={summary} loading={loading} levels={b.levels || {}} narrow={L.narrow}
            onLevel={(g, n) => updateBrain({ levels: { ...(b.levels || {}), [g]: n } })}
            onPlay={(g, n) => updateBrain({ game: g, levels: { ...(b.levels || {}), [g]: n } })} />
        )}
        {game && (
          <>
            <iframe ref={iframe} key={`${game}-${level}-${lang}`}
              src={src}
              title={t(`game.${game}`)}
              className={`absolute inset-0 h-full w-full border-0 bg-background transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
              data-testid="brain-iframe" />
            {!loaded && <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground" data-testid="brain-nacitam-hru">{ready ? t('loading') : ''}</p>}
            {last && ready && (
              <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center px-2">
                <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-card/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur" data-testid="brain-vysledek" data-won={last.won ? '1' : '0'}>
                  <span className="font-medium">{last.won ? t('resultWon') : t('resultLost')}</span>
                  <span>{t('score')}: <b className="tabular-nums">{formatScore(game, last.score)}{unitLabel(t, game)}</b></span>
                  {best !== undefined && <span className="text-muted-foreground">{t('best')}: {formatScore(game, best)}{unitLabel(t, game)}</span>}
                  {summary && <span className="text-muted-foreground" data-testid="brain-vysledek-dnes">{t('todayShort', { done: summary.today.count, total: summary.today.total })}</span>}
                  <button type="button" onClick={leaveGame} className="rounded-md border px-2 py-0.5 hover:bg-secondary" data-testid="brain-vysledek-zpet">{t('backToList')}</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
