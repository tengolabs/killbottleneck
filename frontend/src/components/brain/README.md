# Brain training zone — game contract

The brain training zone (🧠, sibling of the relax zone 🐟) shows a hub with a game of the day and ten more small games.
Every game is **one static HTML file** in `product/frontend/public/brain/<id>.html`, loaded by the hub in an
`<iframe>`. Results are reported to the hub with `postMessage` and stored on the server (personal statistics,
no leaderboard). This file is the contract every game must follow. Code, comments and identifiers are English;
user-facing strings exist in Czech and English inside the file.

## Games

**Game of the day** (owner's decision 16 Nov 2026, replacing the first idea of a daily set of 7): the server picks ONE
game from the user id and the local day (`dailyGame()` in `server/pb_hooks/brain.js`, nothing stored); within each cycle of
11 days every game comes once, never the same game two days in a row. The hub shows it on top, the other ten under "More
games". Summary: `today.game`, `today.dailyDone`, `today.done` (all games finished today — ticked cards), `today.bonus`
(distinct games finished today other than the game of the day), `week` (`start` = Monday, `done`/`count` = distinct
games finished since Monday, `total` = 11 → all 11 = the week's badge). The **streak** counts days whose game of the day
was finished — by the `daily` flag stored at /finish (`rules` = 2), so a later change of the rotation never rewrites
history; rows from v1.3.0 (`rules` = 0) count with any finished round, as they did then (owner 16 Nov 2026). A round's
`day` is the local day of the finish. Every finished round is stored (game, level, score, duration, won, daily, rules,
hints — the result message may carry `hints`: anagram and sudoku send theirs, the server clamps to 0–1000)
— the base for a future experience/character system; rounds never finished are dropped after the 2 h finish window
(owner 16 Nov 2026: abandoned rounds are not kept — every opened game creates one).

| id | game | cognitive function | levels | `score` meaning | better |
|---|---|---|---|---|---|
| `mines` | Minesweeper (9×9/10 · 16×16/40 · 20×14/50 · 30×16/99) | logic, decision making | 1–4 | seconds to clear | lower |
| `memory` | Pairs (pexeso) | memory | 1–3 (4×4, 6×6, 8×6) | seconds | lower |
| `word` | Five-letter word (6 guesses) | language | 1 | guesses used (1–6) | lower |
| `math` | Quick arithmetic (60 s) | processing speed | 1–3 | correct answers | higher |
| `stroop` | Colours (word × ink colour, 60 s) | concentration | 1–3 | correct − wrong (min 0) | higher |
| `sudoku` | Sudoku (unique solution) | logic | 1–3 | seconds | lower |
| `clock` | Clock (analogue time, 10 questions) | orientation in time | 1–3 | correct answers (0–10) | higher |
| `maze` | Maze (11×11 / 17×17 / 25×25 block grid, one path) | spatial orientation | 1–3 | seconds to the goal | lower |
| `sequence` | Sequence (4 / 6 / 9 pads, colours + tones, grows by one) | working memory | 1–3 | longest sequence repeated | higher |
| `anagram` | Anagrams (10 words of 5 / 6 / 7 letters, 60 s per word) | language | 1–3 | words solved (0–10) | higher |
| `missing` | What's missing (9 symbols for 5 / 4 / 3 s, then 8) | visual attention | 1–3 | rounds right (0–10) | higher |

`won` is `true` when the round was completed successfully (mines cleared, all pairs found, word guessed,
sudoku solved, maze goal reached); for timed or open-ended games (`math`, `stroop`, `clock`, `sequence`, `anagram`,
`missing`) a finished round is always `won: true`. The server clamps `anagram`/`missing` to 10 and `sequence` to 1000.
Only `won` rounds count towards "best"; every finished round (won or lost) counts as played — game of the day, bonus, week.

## File rules

- Single file: inline CSS, JS and SVG. **No external URLs** (no CDN, no Google Fonts, no images) — the desktop
  app has a strict CSP. System font stack only. Target ≤ 60 kB (word lists excluded).
- Works with mouse, touch and keyboard; no `alert/confirm/prompt`; no `localStorage` except an optional
  sound preference (the hub stores results on the server).
- Light/dark: follow `prefers-color-scheme`; `?theme=light|dark` overrides it (set `data-theme` on `<html>`).
  Shared look = the **Deluxe kit** (chosen 14. 11. 2026 from the "Minesweeper Deluxe" candidate): every game inlines the
  same CSS block (`:root` light / `:root[data-theme="dark"]` tokens, `.blobs` glowing background, `#app.glass` panel,
  `.status` HUD with `.display`/`.digits` counters, `.tile` 3D cells, `.btn`, `.overlay > .card`) and the same JS block
  (`sfx` square-wave tones from "NEON::MINES" — click/flag/ok/bad/boom/win —, `confetti()`, `syncSound()` for the
  `#soundBtn` toggle, `bindHelp()` for the "How to play" modal). The canonical copy of both blocks lives at the top of
  `public/brain/mines.html`; when you change the kit, change it in every game. The only localStorage key is `brain-sound`.
- **"How to play" in every game** (15. 11. 2026, after the klik-test — the word game had no explanation at all): a labelled
  button `#helpBtn` (`❓ Jak hrát` / `How to play`, the label hides below 480 px) in the `.status` HUD opens `#helpOverlay`
  with `#rulesTitle` + `#rulesList` (4–6 short items from `STR.<lang>.rules`: goal, a turn, what the colours/numbers mean,
  result, levels, keyboard). Opening it never pauses or restarts the game; Escape, the × and the backdrop close it.
  The word game also shows a guide line above the grid (`#guide`: the "type any word" sentence until the first guess, then the
  three-colour legend) and an example row in the rules. Sudoku's **hint explains before it fills** (`findHint()` pure function:
  a wrong entry first, then a naked single, then a hidden single in a row/column/box, "plain" only as a last resort — the
  self-test solves ten Easy puzzles by reasons alone): the first press marks the cell and says why in `#hintBar`, the second
  press fills it in; hints are free on Easy and cost +30 s on Medium/Hard.
  Layout must work from 320 px wide and from 300 px tall (a phone in landscape), without horizontal scrolling. On a
  phone the zone fills the screen under the assistant's header bar (`useZoneLayout({ underPanelHeader: true })`, the
  bar stays visible and its 🧠 closes the zone); a collapsed panel leaves the zone full screen with an "Assistant" button.
  Touch rules for a game: a long press must do its secondary action exactly once even though Android Chrome also fires
  `contextmenu` for it (mines: `touchFlagged` guard), `suppressClick` must reset on the next `pointerdown` (a long press
  that produced no click would otherwise swallow the next tap), `touch-action: manipulation` on tiles.

## URL parameters

`/brain/<id>.html?embed=1&lang=cs&level=2&theme=dark&v=1`

- `embed=1` — loaded by the hub: hide any standalone-only chrome (full-screen buttons, external links).
- `lang=cs|en` — UI language; strings live in `const STR = { cs: {...}, en: {...} }`; default `en`.
- `level=N` — difficulty (1-based, see table; out of range → 1).
- `theme=light|dark` — colour scheme override.
- `v=N` — cache buster, ignore.
- `selftest` — run logic self-tests without DOM dependence (generator validity, win detection, scoring…) and
  write the result into an element `<div id="selftest">` as `SELFTEST PASS` or `SELFTEST FAIL: <reasons>`.
  Also expose `window.brainSelftest()` returning the array of failure strings.
- `debug` — expose `window.brainGame = { state(), finish({ won }) , newGame(level) }` so UI tests can end
  a round instantly; `finish` must emit the same `result` message as a real round.

## Messages

Game → hub (`window.parent.postMessage(msg, location.origin)`; when not embedded, do nothing):

```js
{ type: 'kb-brain', event: 'ready',  game: 'memory' }                       // after load, once
{ type: 'kb-brain', event: 'result', game: 'memory', level: 2,              // once per finished round
  won: true, score: 73, durationMs: 73120 }
{ type: 'kb-brain', event: 'close' }                                        // optional in-game close button
{ type: 'kb-brain', event: 'level', game: 'memory', level: 3 }              // the player picked a level INSIDE the game (games with
                                                                            // levels > 1 show a `#levels` selector): the hub stores it
                                                                            // and reloads the game with ?level=3 (new server round)
```

`durationMs` is measured by the game from the first interaction (or round start for timed games) to the end.

Hub → game (`event.data.type === 'kb-brain'`, check `event.origin === location.origin`):

```js
{ type: 'kb-brain', action: 'pause' }    // stop timers, dim; 'resume' continues
{ type: 'kb-brain', action: 'resume' }
{ type: 'kb-brain', action: 'mute' }     // silence sounds (games may have none)
{ type: 'kb-brain', action: 'new' }      // start a new round at the current level
{ type: 'kb-brain', action: 'theme', theme: 'dark' }  // the app theme or skin changed: recolour (set data-theme), NEVER restart
```

After a finished round the game shows its own short summary (score, best is shown by the hub) with a
"Play again" button that starts a new round at the same level; the hub also offers "Back" to the list.

## Verification before a game is considered done

1. Headless Chrome (`/usr/bin/google-chrome`, `puppeteer-core` from the repo root `node_modules`) loads
   `file://…/<id>.html?selftest&embed=1&lang=cs` → `#selftest` reads `SELFTEST PASS`, console has no errors.
2. `?debug&embed=1&lang=en&level=1` → `ready` is posted, `window.brainGame.finish({ won: true })` posts a
   `result` with the right shape; `lang=cs` renders Czech, `theme=dark` renders dark.
   A preview script kept outside the repo (next to the Deluxe design kit) runs all of this plus the level selector,
   the `theme` action and the "How to play" modal (opens, ≥ 3 items, closes, English without Czech letters) and leaves PNGs
   of five viewports to look at.
3. Viewport 320×560 and 1280×300: no horizontal scrollbar, controls reachable.

## Conscious decisions (so nobody reopens them by accident)
- `?debug` stays in the production files: the server has to trust the client's `won/score/durationMs` anyway (personal
  statistics only — no leaderboard, nothing shared), so a debug hook adds no new power. Revisit the moment a score
  becomes a reward or a ranking (server seed + replay, debug stripped from the build).
- Only the chosen levels persist per account (`kb-brain:<uid>` → `{ levels }`); the layout always starts next to /
  under the chat, full screen is a momentary zoom with a way back.
- Expert minesweeper (30×16) is offered from 640 px of width (`phoneLevels: 3` in `brainApi.js`, the same rule as CSS
  in `mines.html`): on a phone the board would scroll inside the frame and the scrolling fights the long press.
- `GAMES` lives twice (`brainApi.js` for the hub, `server/pb_hooks/brain.js` for validation) — `tests/brain-api.js`
  parses both and fails when ids, levels or `better` differ. The shared kit block (`const sfx = {` … `// Theme + level
  plumbing`) is byte-identical in all games — the same suite fails when one copy drifts.
- One shared word list `public/brain/words.js` (`window.BRAIN_WORDS = { cs, en, cs6, en6, cs7, en7 }` — five letters for both games, six/seven for anagram levels 2/3; owner's decision 16 Nov 2026) for
  `word` and `anagram` — the only exception to "one file per game". Both games load it with `<script src="words.js">`
  and their self-tests fail when it did not load. Words are our own selection reviewed by hand (sources in
  `wordlists/`), never from ispell/hunspell (GPL).
- No repeats in the word games (owner 16 Nov 2026): `window.BRAIN_DECK` in `words.js` hands out words like a deck —
  per game, language and level (`localStorage` key `brain-deck-<game>-<lang>[-<level>]`, the only other thing a game
  stores besides the sound switch) a word comes back only after the whole list was used, and a new deck never starts
  with the words of the round just played. Browser-local on purpose (no server state for it): another device starts its
  own deck. What's missing asks for ten different missing symbols in a round (24 symbols, no storage needed). The other
  games generate their content (mines, sudoku, maze, sums, colours, clock, sequence, pairs layout).
- The game of the day is derived, not stored: the same user sees the same game all day, a new one at local midnight.
  Games are not weighted (all equal) — weights belong to the future experience system, decided from the collected data.
