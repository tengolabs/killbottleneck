import { Bomb, Calculator, Clock, Copy, Eye, LayoutGrid, Palette, Repeat, Route, Shuffle, SpellCheck } from 'lucide-react';
import { pb } from '@/api/pb';

// Brain training zone — client side of the game contract (README.md in this folder) and of the server
// routes in server/pb_hooks/brain.pb.js. Keep GAMES in sync with server/pb_hooks/brain.js.
export const GAMES = [
  // phoneLevels: Expert 30×16 needs ~630 px of board — under 640 px the board would scroll inside the frame and the
  // scrolling fights the long press (flag), so a phone gets three levels (decision 16 Nov 2026 after the checkup)
  { id: 'mines', Icon: Bomb, levels: 4, phoneLevels: 3, better: 'low', unit: 'seconds', skill: 'skillLogic' },
  { id: 'memory', Icon: Copy, levels: 3, better: 'low', unit: 'seconds', skill: 'skillMemory' },
  { id: 'word', Icon: SpellCheck, levels: 1, better: 'low', unit: 'guesses', skill: 'skillLanguage' },
  { id: 'math', Icon: Calculator, levels: 3, better: 'high', unit: 'correct', skill: 'skillSpeed' },
  { id: 'stroop', Icon: Palette, levels: 3, better: 'high', unit: 'points', skill: 'skillFocus' },
  { id: 'sudoku', Icon: LayoutGrid, levels: 3, better: 'low', unit: 'seconds', skill: 'skillLogic' },
  { id: 'clock', Icon: Clock, levels: 3, better: 'high', unit: 'correct', skill: 'skillOrientation' },
  // phase 2 (16 Nov 2026) — one of the 11 is the game of the day, picked by the server (summary.today.game)
  { id: 'maze', Icon: Route, levels: 3, better: 'low', unit: 'seconds', skill: 'skillSpatial' },
  { id: 'sequence', Icon: Repeat, levels: 3, better: 'high', unit: 'steps', skill: 'skillMemory' },
  { id: 'anagram', Icon: Shuffle, levels: 3, better: 'high', unit: 'correct', skill: 'skillLanguage' },
  { id: 'missing', Icon: Eye, levels: 3, better: 'high', unit: 'correct', skill: 'skillFocus' },
];
export const GAME_IDS = GAMES.map((g) => g.id);
export const gameMeta = (id) => GAMES.find((g) => g.id === id) || null;
// how many levels the hub offers here: fewer on a narrow window when the game says so (phoneLevels)
export const maxLevels = (id, narrow) => { const m = gameMeta(id); return !m ? 1 : narrow && m.phoneLevels ? Math.min(m.levels, m.phoneLevels) : m.levels; };
export const GAMES_VERSION = 9; // bump when files in public/brain change (the service worker never caches them, the browser does)

// minutes EAST of UTC (Prague winter = 60); the server clamps it to ±14 h and derives the local day itself
export const tzOffset = () => -new Date().getTimezoneOffset();

export async function startRound(game, level) {
  return pb.send('/api/kb/brain/start', { method: 'POST', body: { game, level, tzOffset: tzOffset() } });
}
export async function finishRound(id, { won, score, durationMs, hints }) {
  return pb.send('/api/kb/brain/finish', { method: 'POST', body: { id, won: !!won, score, durationMs, hints: Number(hints) || 0, tzOffset: tzOffset() } });
}
export async function loadSummary() {
  return pb.send(`/api/kb/brain/summary?tzOffset=${encodeURIComponent(tzOffset())}`, { method: 'GET' });
}

// Unit label after the score (seconds are already m:ss → no label).
// plural forms by the number (cs: 1 krok / 2 kroky / 5 kroků)
export const unitLabel = (t, game, n) => { const m = gameMeta(game); return !m || m.unit === 'seconds' ? '' : t(`unit.${m.unit}`, { count: Math.round(Number(n)) || 0 }); };

// Score as text: seconds → m:ss, guesses/correct/points → number (the unit label comes from unitLabel).
export function formatScore(game, score) {
  const m = gameMeta(game);
  const n = Number(score);
  if (!m || !isFinite(n)) return '—';
  if (m.unit === 'seconds') { const s = Math.max(0, Math.round(n)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  return String(Math.round(n));
}
