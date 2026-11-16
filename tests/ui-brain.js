// Brain training zone 🧠 (9 Nov 2026) — click suite (Puppeteer) against a MOCKED ollama: the word "hlavolam" opens the hub
// next to the chat without the model, 11 cards (the game of the day + 10 more) + bonus, week and streak, a level choice, a game loads in an iframe and a finished
// round (debug API of the game) is stored on the server (card ticked, streak 1), relax and brain exclude each other, layout
// toggle, the chat stays usable next to the zone, preferences survive F5 (the open game does not), phone = above the chat,
// every game file is served by the instance and passes its own self-test, console clean.
const H = require('./_harness');
const { expect, sleep } = H;

const fronta = [];
const text = (s) => ({ content: s });
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  JSON.parse(body);
  const o = fronta.shift() || text('(empty queue)');
  res.end(JSON.stringify({ message: { role: 'assistant', content: o.content || '' }, prompt_eval_count: 100, eval_count: 20, done: true }));
};
const GAMES = ['mines', 'memory', 'word', 'math', 'stroop', 'sudoku', 'clock', 'maze', 'sequence', 'anagram', 'missing'];

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ui-brain', addHostGateway: true, env: { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0 } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  const A = await inst.login('admin@example.com');
  const me = (await inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@example.com', password: H.PW } })).json.record;

  const { page, chyby, novaStranka } = await H.browser();
  await page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); }, A);
  const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const atr = (sel, a) => page.evaluate((s, x) => document.querySelector(s)?.getAttribute(x), sel, a);
  const textOf = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent || '', sel);
  const napis = async (s) => { await page.click('[data-testid="chat-input"]'); await page.keyboard.type(s); await page.keyboard.press('Enter'); };
  const hraFrame = () => page.frames().find((f) => /\/brain\/[a-z]+\.html/.test(f.url()));
  // a game card may sit under "More games" below the fold, and the hub re-renders when the summary arrives →
  // wait for the card, bring it to the middle, then click
  const hrat = async (id) => {
    const sel = `[data-testid="brain-hrat-${id}"]`;
    await page.waitForSelector(sel, { timeout: 10000 });
    await page.$eval(sel, (e) => e.scrollIntoView({ block: 'center' }));
    await sleep(250);
    await page.click(sel);
  };
  const klic = `kb-brain:${me.id}`;

  console.log('== the word "hlavolam" opens the hub next to the chat, no model ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-tab"]'), 'panel closed → tab');
  await (await page.$('[data-testid="chat-tab"]')).click();
  expect(await cekej('[data-testid="chat-input"]'), 'panel open');
  if (await page.$('[data-testid="chat-porada-ne"]')) await page.click('[data-testid="chat-porada-ne"]');
  expect(await cekej('[data-testid="chat-chip-brain"]'), 'chip 🧠 in the empty chat');
  expect(await cekej('[data-testid="chat-brain-toggle"][aria-pressed="false"]'), 'toggle 🧠 in the header, off');
  const volaniPred = fronta.length;
  await napis('hlavolam');
  expect(await cekej('[data-testid="brain-vrstva"][data-rozlozeni="vedle"][data-hra="hub"]', 10000), 'hub opened next to the chat');
  expect(fronta.length === volaniPred, 'the word did not reach the model (no request consumed)');
  expect(await cekej('[data-testid="brain-souhrn"][data-nacteno="1"]', 10000), 'summary loaded from the server');
  // the game of the day = one of the 11, picked by the server for this user and day (the same pick the hub got)
  const tz = await page.evaluate(() => -new Date().getTimezoneOffset());
  const hraDne = (await inst.api('GET', `/api/kb/brain/summary?tzOffset=${tz}`, { token: A })).json.today.game;
  const minyDne = hraDne === 'mines';
  expect(GAMES.includes(hraDne), `the server picked a game of the day (${hraDne})`);
  expect((await page.$$('[data-testid^="brain-karta-"]')).length === 11, '11 game cards');
  const kartyDnes = await page.$$eval('[data-testid="brain-karty"] [data-testid^="brain-karta-"]', (els) => els.map((e) => e.dataset.testid.replace('brain-karta-', '')));
  const kartyDalsi = await page.$$eval('[data-testid="brain-karty-dalsi"] [data-testid^="brain-karta-"]', (els) => els.map((e) => e.dataset.testid.replace('brain-karta-', '')));
  expect(kartyDnes.join() === hraDne && kartyDalsi.length === 10 && !kartyDalsi.includes(hraDne),
    `the game of the day on top, the other 10 under "More games" (${kartyDnes.join()} | ${kartyDalsi.join()})`);
  expect(/Další hry/.test(await textOf('[data-testid="brain-dalsi"]')), 'the second group is titled "Další hry"');
  expect((await atr('[data-testid="brain-serie"]', 'data-serie')) === '0', 'streak 0');
  expect((await atr('[data-testid="brain-dnes"]', 'data-splneno')) === '0' && /Hra dne/.test(await textOf('[data-testid="brain-souhrn"]')), `game of the day not done yet (${await textOf('[data-testid="brain-souhrn"]')})`);
  expect(!(await page.$('[data-testid="brain-bonus"]')), 'no bonus yet');
  expect((await atr('[data-testid="brain-tyden"]', 'data-tyden')) === '0' && /0 z 11/.test(await textOf('[data-testid="brain-tyden-text"]')), `week 0 of 11 (${await textOf('[data-testid="brain-tyden-text"]')})`);
  expect(await cekej('[data-testid="chat-brain-toggle"][aria-pressed="true"]'), 'toggle 🧠 is on');
  expect((await page.evaluate(() => document.querySelector('[data-testid="chat-input"]')?.value)) === '', 'input emptied');
  {
    // the zone sits left of the chat, under the top bar; the chat stays usable
    const v = await (await page.$('[data-testid="brain-vrstva"]')).boundingBox();
    const p = await (await page.$('[data-testid="chat-panel"]')).boundingBox();
    expect(v.x + v.width <= p.x + 2 && v.y > 0, `zone left of the chat (zone to ${Math.round(v.x + v.width)}, chat from ${Math.round(p.x)})`);
    await page.click('[data-testid="chat-input"]'); await page.keyboard.type('abc');
    expect((await page.evaluate(() => document.querySelector('[data-testid="chat-input"]').value)) === 'abc', 'typing in the chat works next to the zone');
    await page.evaluate(() => { const el = document.querySelector('[data-testid="chat-input"]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); });
  }

  console.log('== level 2 of mines, the game loads in an iframe, a finished round is stored ==');
  await page.click('[data-testid="brain-uroven-mines-2"]');
  expect(await cekej('[data-testid="brain-uroven-mines-2"][aria-pressed="true"]'), 'level 2 chosen');
  expect(!!(await page.$('[data-testid="brain-uroven-mines-4"]')), 'on a computer the mines card offers Expert (level 4)');
  await hrat('mines');
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="mines"][data-uroven="2"]'), 'mines open at level 2');
  const src = await atr('[data-testid="brain-iframe"]', 'src');
  expect(/\/brain\/mines\.html\?embed=1&lang=cs&level=2&theme=(light|dark)&v=\d+$/.test(src), `iframe src (${src})`);
  expect(await cekej('[data-testid="brain-vrstva"][data-nacteno="1"]', 20000), 'the game reported ready');
  expect(/Hledání min/.test(await textOf('[data-testid="brain-nazev"]')) && /Úroveň 2/.test(await textOf('[data-testid="brain-nazev"]')), 'bar shows the game and the level');
  // a round was opened on the server before the game started
  await sleep(500);
  let rows = (await inst.api('GET', '/api/collections/brain_results/records?perPage=50', { token: A })).json.items;
  expect(rows.length === 1 && rows[0].game === 'mines' && rows[0].level === 2 && !rows[0].finished, `one open round on the server (${rows.length})`);
  // reload the game with the debug API (same URL + &debug) and finish it as a win
  let fr = hraFrame();
  expect(!!fr, 'game frame found');
  await fr.evaluate(() => { location.href = location.href + '&debug'; });
  await sleep(1500);
  fr = hraFrame();
  expect(!!fr && (await fr.evaluate(() => typeof window.brainGame === 'object')), 'debug API available');
  await fr.evaluate(() => window.brainGame.finish({ won: true }));
  expect(await cekej('[data-testid="brain-vysledek"][data-won="1"]', 10000), 'result bar: done');
  {
    await page.waitForFunction(() => /Týden 1\/11/.test(document.querySelector('[data-testid="brain-vysledek-dnes"]')?.textContent || ''), { timeout: 10000 }).catch(() => {});
    const bar = await textOf('[data-testid="brain-vysledek-dnes"]');
    expect((minyDne ? /Hra dne ✓/.test(bar) : /Hra dne: /.test(bar) && /\+1 bonus/.test(bar)) && /Týden 1\/11/.test(bar), `result bar: game of the day / bonus / week (${bar})`);
  }
  await sleep(500);
  rows = (await inst.api('GET', '/api/collections/brain_results/records?perPage=50', { token: A })).json.items;
  const hotove = rows.filter((r) => r.finished);
  expect(hotove.length === 1 && hotove[0].won === true && hotove[0].game === 'mines', `the round is finished on the server (${hotove.length} finished of ${rows.length})`);
  expect(rows.length === 2, 'the next round of the same game was opened right away (the game\'s own "play again" does not ask the hub)');
  await page.click('[data-testid="brain-vysledek-zpet"]');
  expect(await cekej('[data-testid="brain-karta-mines"][data-hotovo="1"]'), 'back in the hub: mines ticked for today');
  expect((await atr('[data-testid="brain-serie"]', 'data-serie')) === (minyDne ? '1' : '0'), `streak ${minyDne ? 1 : 0} (mines ${minyDne ? 'are' : 'are not'} the game of the day)`);
  expect((await atr('[data-testid="brain-dnes"]', 'data-splneno')) === (minyDne ? '1' : '0'), 'the game of the day done only when it was mines');
  expect(minyDne ? !(await page.$('[data-testid="brain-bonus"]')) : (await atr('[data-testid="brain-bonus"]', 'data-bonus')) === '1', 'another game than the game of the day = +1 bonus');
  expect((await atr('[data-testid="brain-tyden"]', 'data-tyden')) === '1' && (await atr('[data-testid="brain-tyden-mines"]', 'data-hotovo')) === '1', 'week 1/11, mines marked in the week row');
  expect(/0:00/.test(await textOf('[data-testid="brain-nejlepsi-mines"]')), `best for mines level 2 shown (${await textOf('[data-testid="brain-nejlepsi-mines"]')})`);

  console.log('== the game of the day through the hub: today done, streak 1 ==');
  if (!minyDne) {
    await hrat(hraDne);
    expect(await cekej(`[data-testid="brain-vrstva"][data-hra="${hraDne}"][data-nacteno="1"]`, 20000), `${hraDne} (game of the day) open`);
    let fd = hraFrame();
    await fd.evaluate(() => { location.href = location.href + '&debug'; });
    await sleep(1500);
    fd = hraFrame();
    await fd.evaluate(() => window.brainGame.finish({ won: true }));
    expect(await cekej('[data-testid="brain-vysledek"]', 10000), `${hraDne}: result bar`);
    // the bar shows at once, the server's new summary follows with the /finish answer
    await cekej('[data-testid="brain-vysledek-dnes"][data-splneno="1"]', 10000);
    const bar = await textOf('[data-testid="brain-vysledek-dnes"]');
    expect(/Hra dne ✓/.test(bar) && /\+1 bonus/.test(bar) && /Týden 2\/11/.test(bar), `result bar after the game of the day (${bar})`);
    await page.click('[data-testid="brain-vysledek-zpet"]');
    expect(await cekej(`[data-testid="brain-karta-${hraDne}"][data-hotovo="1"]`), 'game of the day ticked');
  }
  expect((await atr('[data-testid="brain-serie"]', 'data-serie')) === '1' && (await atr('[data-testid="brain-dnes"]', 'data-splneno')) === '1', 'game of the day done → streak 1');
  expect(/Každá další hra je bonus/.test(await textOf('[data-testid="brain-dnes"]')), `done text (${await textOf('[data-testid="brain-dnes"]')})`);

  console.log('== level picked inside the game → hub takes it over; app theme switch recolours the game without a restart ==');
  await hrat('mines');
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="mines"][data-uroven="2"][data-nacteno="1"]', 20000), 'mines open again at level 2');
  let fr2 = hraFrame();
  expect(!!fr2 && (await fr2.evaluate(() => document.querySelectorAll('#levels .lvl').length)) === 4, 'the game shows its own 4-level selector');
  await fr2.evaluate(() => document.querySelector('#levels .lvl[data-level="3"]').click());
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="mines"][data-uroven="3"][data-nacteno="1"]', 20000), 'level 3 picked in the game → the hub is at level 3');
  expect(/level=3&/.test(await atr('[data-testid="brain-iframe"]', 'src')), 'the game was reloaded at level 3');
  fr2 = hraFrame();
  expect((await fr2.evaluate(() => document.querySelector('#levels .lvl[data-level="3"]').getAttribute('aria-pressed'))) === 'true', 'level 3 pressed inside the game');
  await sleep(400);
  rows = (await inst.api('GET', '/api/collections/brain_results/records?perPage=50', { token: A })).json.items;
  expect(rows.some((r) => r.game === 'mines' && r.level === 3 && !r.finished), 'a round at level 3 was opened on the server');
  // theme: the running game keeps its state (marker) and only recolours. The game's theme follows the REAL page background
  // (a dark skin in light mode → dark game), so compare with the body luminance, then force a light body like a skin change would.
  const lumTheme = () => page.evaluate(() => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(document.body).backgroundColor); return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 < 0.5 ? 'dark' : 'light'; });
  await fr2.evaluate(() => { window.__kbMarker = 7; });
  const themeBefore = await fr2.evaluate(() => document.documentElement.dataset.theme);
  expect(themeBefore === (await lumTheme()), `the game opened in the theme of the page background (${themeBefore})`);
  const THEME_BTN = 'button[title="Přepnout na tmavý režim"], button[title="Přepnout na světlý režim"]';
  expect(!!(await page.$(THEME_BTN)), 'app theme toggle found in the header');
  await page.click(THEME_BTN);
  await sleep(700);
  fr2 = hraFrame();
  let themeAfter = await fr2.evaluate(() => [document.documentElement.dataset.theme, window.__kbMarker]);
  expect(themeAfter[0] === (await lumTheme()) && themeAfter[1] === 7, `after the app toggle the game follows the page background without a restart (${themeBefore} → ${themeAfter[0]}, marker ${themeAfter[1]})`);
  expect(/level=3&theme=/.test(await atr('[data-testid="brain-iframe"]', 'src')), 'iframe src unchanged by the theme switch');
  await page.click(THEME_BTN); // back to the original theme
  await sleep(300);
  // a skin change repaints the body: force a light background → the game must turn light, still without a restart
  await page.evaluate(() => { document.body.style.backgroundColor = 'rgb(250, 250, 250)'; });
  await sleep(700);
  fr2 = hraFrame();
  themeAfter = await fr2.evaluate(() => [document.documentElement.dataset.theme, window.__kbMarker]);
  expect(themeAfter[0] === 'light' && themeAfter[1] === 7, `light page background → light game, no restart (${themeAfter[0]}, marker ${themeAfter[1]})`);
  await page.evaluate(() => { document.body.style.backgroundColor = 'rgb(10, 14, 26)'; });
  await sleep(700);
  fr2 = hraFrame();
  themeAfter = await fr2.evaluate(() => [document.documentElement.dataset.theme, window.__kbMarker]);
  expect(themeAfter[0] === 'dark' && themeAfter[1] === 7, `dark page background → dark game, no restart (${themeAfter[0]}, marker ${themeAfter[1]})`);
  await page.evaluate(() => { document.body.style.backgroundColor = ''; });
  await sleep(300);
  // back to level 2 from inside the game (the F5 check below expects level 2 remembered)
  fr2 = hraFrame();
  await fr2.evaluate(() => document.querySelector('#levels .lvl[data-level="2"]').click());
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="mines"][data-uroven="2"][data-nacteno="1"]', 20000), 'level 2 picked in the game again');
  await page.click('[data-testid="brain-zpet"]');
  expect(await cekej('[data-testid="brain-hub"]'), 'back in the hub');
  expect(await cekej('[data-testid="brain-uroven-mines-2"][aria-pressed="true"]'), 'the hub card shows level 2');

  console.log('== "how to play" in every game; the word game explains itself; sudoku hint explains first, fills second, free on Easy ==');
  await hrat('word');
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="word"][data-nacteno="1"]', 20000), 'word game open');
  let fw = hraFrame();
  const guide = await fw.evaluate(() => (document.querySelector('#guide') || {}).textContent || '');
  expect(/Hádej skryté české slovo/.test(guide) && /Zadat/.test(guide), `intro line above the grid before the first guess (${guide.slice(0, 60)})`);
  const helpW = await fw.evaluate(async () => {
    const btn = document.querySelector('#helpBtn'), ov = document.querySelector('#helpOverlay'); if (!btn || !ov) return { missing: true };
    const label = (document.querySelector('#helpLbl') || {}).textContent;
    btn.click(); await new Promise((r) => setTimeout(r, 100));
    const open = !ov.hidden, items = [...ov.querySelectorAll('#rulesList li')].map((li) => li.textContent);
    const example = ov.querySelectorAll('#rulesList .ex i.hit').length > 0 && ov.querySelectorAll('#rulesList .ex i.near').length > 0;
    document.querySelector('#helpClose').click(); await new Promise((r) => setTimeout(r, 100));
    return { label, open, n: items.length, goal: /Cíl:/.test(items[0] || ''), example, closed: ov.hidden };
  });
  expect(!helpW.missing && helpW.label === 'Jak hrát' && helpW.open && helpW.n >= 5 && helpW.goal && helpW.example && helpW.closed, `word: "Jak hrát" opens the rules with coloured example tiles and closes (${JSON.stringify(helpW)})`);
  // one guess → the legend replaces the intro
  await fw.evaluate(() => { for (const k of 'strom') document.querySelector(`#kbd [data-k="${k}"]`).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.querySelector('#kbd [data-k="⏎"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await sleep(300);
  const legend = await fw.evaluate(() => ({ t: document.querySelector('#guide').textContent, chips: document.querySelectorAll('#guide .ex i').length, row: document.querySelectorAll('#grid .tile.hit, #grid .tile.near, #grid .tile.miss').length }));
  expect(legend.chips === 3 && /správné místo/.test(legend.t) && /ve slově není/.test(legend.t) && legend.row === 5, `after the first guess the colour legend is shown (${JSON.stringify(legend)})`);
  // any five letters are a guess (Richard 15 Nov 2026): a nonsense word is scored, not refused
  await fw.evaluate(() => { for (const k of 'xqzjw') document.querySelector(`#kbd [data-k="${k}"]`).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.querySelector('#kbd [data-k="⏎"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await sleep(300);
  const nonsense = await fw.evaluate(() => ({ scored: document.querySelectorAll('#grid .tile.hit, #grid .tile.near, #grid .tile.miss').length, attempt: document.querySelector('#attempt').textContent, toast: (document.querySelector('.toast.show') || {}).textContent || '' }));
  expect(nonsense.scored === 10 && /^3/.test(nonsense.attempt) && !/slovníku/.test(nonsense.toast), `a made-up word XQZJW is scored like any other guess (${JSON.stringify(nonsense)})`);
  await page.click('[data-testid="brain-zpet"]');
  expect(await cekej('[data-testid="brain-hub"]'), 'back in the hub');
  await hrat('sudoku');
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="sudoku"][data-uroven="1"][data-nacteno="1"]', 20000), 'sudoku open at level 1');
  let fs = hraFrame();
  await fs.evaluate(() => { location.href = location.href + '&debug'; });
  await sleep(1500);
  fs = hraFrame();
  const h1 = await fs.evaluate(() => {
    const pen = document.querySelector('#hintPen').textContent, help = (document.querySelector('#helpLbl') || {}).textContent;
    const p = window.brainGame.hint(); const st = window.brainGame.state();
    const cell = document.querySelectorAll('.cell')[p.i];
    return { help, pen, kind: p.kind, d: p.d, right: p.d === st.solution[p.i], hints: st.hints, penaltyMs: st.penaltyMs, text: st.hintText, hinted: cell.classList.contains('hinted'), empty: st.grid[p.i] === 0 };
  });
  expect(h1.help === 'Jak hrát' && h1.pen === '' && h1.penaltyMs === 0 && h1.hints === 1, `sudoku Easy: hint is free, no "(+30 s)" label (${JSON.stringify({ help: h1.help, pen: h1.pen, penaltyMs: h1.penaltyMs })})`);
  expect(['single', 'row', 'col', 'box'].includes(h1.kind) && h1.right && h1.empty && h1.hinted && new RegExp(`\\b${h1.d}\\b`).test(h1.text) && /označeného pole/.test(h1.text) && /stiskni Nápovědu znovu/.test(h1.text), `first press explains the step with a reason and marks the cell (${JSON.stringify({ kind: h1.kind, d: h1.d, text: h1.text.slice(0, 90) })})`);
  const h2 = await fs.evaluate(() => { const p = window.brainGame.state().pending; window.brainGame.hint(); const st = window.brainGame.state(); return { filled: st.grid[p.i] === p.d, hints: st.hints, penaltyMs: st.penaltyMs, bar: document.querySelector('#hintBar').classList.contains('show') }; });
  expect(h2.filled && h2.hints === 1 && h2.penaltyMs === 0 && !h2.bar, `second press fills the digit in, still one hint, bar gone (${JSON.stringify(h2)})`);
  // a hidden tab pauses the clock, coming back (or a tap on the overlay) resumes it — before, the game stayed on "Pause" for good
  const pz = await fs.evaluate(async () => {
    const ov = document.querySelector('#pauseOverlay'); const wait = () => new Promise((r) => setTimeout(r, 50));
    const hide = (h) => { Object.defineProperty(document, 'hidden', { get: () => h, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); };
    hide(true); await wait(); const paused = !ov.hidden && window.brainGame.state().paused;
    hide(false); await wait(); const resumed = ov.hidden && !window.brainGame.state().paused;
    hide(true); await wait(); ov.click(); await wait(); const tapped = ov.hidden && !window.brainGame.state().paused;
    hide(false); return { paused, resumed, tapped };
  });
  expect(pz.paused && pz.resumed && pz.tapped, `sudoku: hidden tab pauses, visible tab or a tap resumes (${JSON.stringify(pz)})`);
  const h3 = await fs.evaluate(() => { const st = window.brainGame.state(); const i = st.grid.indexOf(0); document.querySelectorAll('.cell')[i].click(); document.querySelector(`#pad [data-d="${st.solution[i] === 1 ? 2 : 1}"]`).click();
    const p = window.brainGame.hint(); const t = window.brainGame.state().hintText; window.brainGame.hint(); return { kind: p.kind, at: p.i === i, text: t, erased: window.brainGame.state().grid[i] === 0 }; });
  expect(h3.kind === 'wrong' && h3.at && /nepatří/.test(h3.text) && h3.erased, `a wrong entry is pointed out first; the second press erases it (${JSON.stringify(h3)})`);
  // Medium: the hint costs 30 s
  await fs.evaluate(() => document.querySelector('#levels .lvl[data-level="2"]').click());
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="sudoku"][data-uroven="2"][data-nacteno="1"]', 20000), 'sudoku level 2 picked in the game');
  fs = hraFrame();
  await fs.evaluate(() => { location.href = location.href + '&debug'; });
  await sleep(1500);
  fs = hraFrame();
  const h4 = await fs.evaluate(() => { const pen = document.querySelector('#hintPen').textContent; window.brainGame.hint(); const st = window.brainGame.state(); return { pen, penaltyMs: st.penaltyMs, time: document.querySelector('#time').textContent }; });
  expect(h4.pen === '(+30 s)' && h4.penaltyMs === 30000 && /0:3\d/.test(h4.time), `sudoku Medium: hint adds 30 s (${JSON.stringify(h4)})`);
  await fs.evaluate(() => document.querySelector('#levels .lvl[data-level="1"]').click());
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="sudoku"][data-uroven="1"][data-nacteno="1"]', 20000), 'back to level 1');
  // every game has the button and the modal (cs + en), the sound button stays next to it
  for (const g of GAMES) {
    const p3 = await novaStranka();
    for (const lang of ['cs', 'en']) {
      await p3.goto(`${inst.base}/brain/${g}.html?embed=1&lang=${lang}&level=1`, { waitUntil: 'load' });
      await sleep(300);
      const h = await p3.evaluate(async () => {
        const btn = document.querySelector('.status #helpBtn'), ov = document.querySelector('#helpOverlay'); if (!btn || !ov) return { missing: true };
        btn.click(); await new Promise((r) => setTimeout(r, 100));
        const open = !ov.hidden, n = ov.querySelectorAll('#rulesList li').length, title = document.querySelector('#rulesTitle').textContent, text = document.querySelector('#rulesList').innerText;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((r) => setTimeout(r, 100));
        return { label: document.querySelector('#helpLbl').textContent, open, n, title, czech: /[ěščřžýůťďňĚŠČŘŽÝŮŤĎŇ]/.test(text), closedByEsc: ov.hidden, sound: !!document.querySelector('.status #soundBtn') };
      });
      const okLang = lang === 'cs' ? (h.label === 'Jak hrát' && h.title === 'Jak hrát' && h.czech) : (h.label === 'How to play' && h.title === 'How to play' && !h.czech);
      expect(!h.missing && h.open && h.n >= 4 && okLang && h.closedByEsc && h.sound, `${g} ${lang}: "how to play" button + ${h.n} rules, Escape closes (${JSON.stringify(h)})`);
    }
    await p3.close();
  }
  await page.click('[data-testid="brain-zpet"]');
  expect(await cekej('[data-testid="brain-hub"]'), 'back in the hub');

  console.log('== a phase 2 game through the hub: an anagram round is stored and ticked ==');
  await hrat('anagram');
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="anagram"][data-nacteno="1"]', 20000), 'anagram open, the game reported ready');
  let fa = hraFrame();
  await fa.evaluate(() => { location.href = location.href + '&debug'; });
  await sleep(1500);
  fa = hraFrame();
  // one hint in the running round → the server stores hints 1 with the result
  await fa.evaluate(() => document.querySelector('.overlay:not([hidden]) .btn')?.click());
  await sleep(900);
  await fa.evaluate(() => document.getElementById('hintBtn').click());
  await sleep(300);
  const hintsInGame = await fa.evaluate(() => window.brainGame.state().hints);
  await fa.evaluate(() => window.brainGame.finish({ won: true }));
  expect(await cekej('[data-testid="brain-vysledek"][data-won="1"]', 10000), 'anagram: result bar');
  await sleep(500);
  const rowsA = (await inst.api('GET', '/api/collections/brain_results/records?perPage=100', { token: A })).json.items;
  expect(rowsA.some((r) => r.game === 'anagram' && r.finished && r.won), 'anagram: the round is finished on the server');
  expect(hintsInGame === 1 && rowsA.some((r) => r.game === 'anagram' && r.finished && r.hints === 1), `anagram: the hint used in the game is stored with the round (game ${hintsInGame})`);
  await page.click('[data-testid="brain-vysledek-zpet"]');
  expect(await cekej('[data-testid="brain-karta-anagram"][data-hotovo="1"]'), 'anagram ticked in the hub (in or outside today\'s set)');

  console.log('== word games hand out words like a deck: the next anagram rounds share no word ==');
  {
    await hrat('anagram');
    expect(await cekej('[data-testid="brain-vrstva"][data-hra="anagram"][data-nacteno="1"]', 20000), 'anagram open again');
    let fd = hraFrame();
    await fd.evaluate(() => { location.href = location.href + '&debug'; });
    await sleep(1500);
    fd = hraFrame();
    const kola = [await fd.evaluate(() => window.brainGame.state().words)];
    for (let k = 0; k < 3; k++) kola.push(await fd.evaluate(() => { window.brainGame.newGame(); return window.brainGame.state().words; }));
    const vsechna = kola.flat();
    const deck = await fd.evaluate(() => { try { return JSON.parse(localStorage.getItem('brain-deck-anagram-cs-1') || 'null'); } catch { return null; } });
    expect(kola.every((k) => k.length === 10) && new Set(vsechna).size === 40 && !!deck && Array.isArray(deck.used) && deck.used.length >= 40,
      `4 rounds = 40 different words, the deck is stored in the browser (${new Set(vsechna).size} different, deck ${deck && deck.used && deck.used.length})`);
    await page.click('[data-testid="brain-zpet"]');
    expect(await cekej('[data-testid="brain-hub"]'), 'back in the hub after the deck check');
  }

  console.log('== keyboard goes to the game right after it opens (maze arrows without clicking into it first) ==');
  await hrat('maze');
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="maze"][data-nacteno="1"]', 20000), 'maze open, the game reported ready');
  await sleep(600);
  const active = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
  // every direction twice: from the corner start at least one of them is open, so the step counter must move
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) { await page.keyboard.press(k); await sleep(200); }
  await sleep(400);
  const steps = Number(await hraFrame().$eval('#steps', (e) => e.textContent));
  expect(active === 'IFRAME' && steps > 0, `maze: real keyboard arrows move the ball straight from the hub (focus ${active}, ${steps} steps)`);
  await page.click('[data-testid="brain-zpet"]');
  expect(await cekej('[data-testid="brain-hub"]'), 'back in the hub after the maze');

  console.log('== layout: full screen and back; close ==');
  await page.click('[data-testid="brain-rozlozeni"]');
  expect(await cekej('[data-testid="brain-vrstva"][data-rozlozeni="cela"]'), 'full screen');
  expect(await cekej('[data-testid="brain-zpet-vedle"]'), 'button back next to the chat');
  await page.click('[data-testid="brain-zpet-vedle"]');
  expect(await cekej('[data-testid="brain-vrstva"][data-rozlozeni="vedle"]'), 'back next to the chat');
  await page.click('[data-testid="brain-konec"]');
  await sleep(300);
  expect(!(await page.$('[data-testid="brain-vrstva"]')), 'closed');
  expect(await cekej('[data-testid="chat-brain-toggle"][aria-pressed="false"]'), 'toggle off');

  console.log('== relax and brain exclude each other; toggle; F5 keeps preferences, not the game ==');
  await page.click('[data-testid="chat-brain-toggle"]');
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="hub"]'), 'toggle opens the hub');
  await napis('relax');
  expect(await cekej('[data-testid="relax-vrstva"]', 10000), 'relax started');
  await sleep(300);
  expect(!(await page.$('[data-testid="brain-vrstva"]')), 'brain closed by relax');
  await page.click('[data-testid="chat-brain-toggle"]');
  expect(await cekej('[data-testid="brain-vrstva"]'), 'brain back');
  await sleep(300);
  expect(!(await page.$('[data-testid="relax-vrstva"]')), 'relax closed by brain');
  const prefs = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), klic);
  expect(!!prefs && prefs.levels && prefs.levels.mines === 2 && prefs.layout === undefined, `preferences per account: the levels, not the layout (${JSON.stringify(prefs)})`);
  await hrat('sudoku');
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="sudoku"]'), 'sudoku open');
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(800);
  expect(!(await page.$('[data-testid="brain-vrstva"]')), 'after F5 the zone is not open (no lock, nothing to restore)');
  if (await page.$('[data-testid="chat-tab"]')) await (await page.$('[data-testid="chat-tab"]')).click(); // the panel's open state survives F5
  expect(await cekej('[data-testid="chat-brain-toggle"]'), 'panel open again');
  await page.click('[data-testid="chat-brain-toggle"]');
  expect(await cekej('[data-testid="brain-uroven-mines-2"][aria-pressed="true"]', 10000), 'level 2 of mines remembered after F5');
  expect(await cekej('[data-testid="brain-karta-mines"][data-hotovo="1"]', 10000), 'today\'s tick comes from the server after F5');
  await page.click('[data-testid="brain-konec"]');

  console.log('== every game is served by the instance and passes its self-test; English strings ==');
  for (const g of GAMES) {
    const p2 = await novaStranka();
    await p2.goto(`${inst.base}/brain/${g}.html?selftest&embed=1&lang=cs&level=1`, { waitUntil: 'load' });
    const st = await p2.waitForFunction(() => /SELFTEST (PASS|FAIL)/.test(document.querySelector('#selftest')?.textContent || ''), { timeout: 20000 }).then(() => p2.evaluate(() => document.querySelector('#selftest').textContent)).catch(() => '(no #selftest)');
    expect(/SELFTEST PASS/.test(st), `${g}: ${st.slice(0, 120)}`);
    await p2.goto(`${inst.base}/brain/${g}.html?debug&embed=1&lang=en&level=1`, { waitUntil: 'load' });
    await sleep(300);
    const dbg = await p2.evaluate(() => typeof window.brainGame === 'object' && typeof window.brainGame.finish === 'function' && !/[ěščřžýůťďňĚŠČŘŽÝŮŤĎŇ]/.test(document.body.innerText));
    expect(dbg, `${g}: debug API present, English UI without Czech letters (French accents allowed — mines)`);
    if (['maze', 'sequence', 'anagram', 'missing'].includes(g)) {
      // phase 2 games: the hub's pause/resume and a hidden tab both pause, and the game wakes up again (phase 1 checkup bug)
      const pr = await p2.evaluate(async () => {
        const send = (action) => window.postMessage({ type: 'kb-brain', action }, location.origin);
        const wait = () => new Promise((r) => setTimeout(r, 150));
        // games with a Start card ignore a pause before the round runs (nothing to pause) — start it first
        const start = document.querySelector('#startBtn'); if (start) { start.click(); await new Promise((r) => setTimeout(r, 1200)); }
        send('pause'); await wait(); const a = window.brainGame.state().paused;
        send('resume'); await wait(); const b = window.brainGame.state().paused;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange')); await wait(); const c = window.brainGame.state().paused;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange')); await wait();
        if (window.brainGame.state().paused) { const tag = document.querySelector('#pause-tag, #pauseTag, #pause, .pause-tag'); if (tag) tag.click(); await wait(); }
        return { a, b, c, d: window.brainGame.state().paused };
      });
      expect(pr.a === true && pr.b === false && pr.c === true && pr.d === false, `${g}: pause/resume from the hub, autopause on a hidden tab and waking up (${JSON.stringify(pr)})`);
    }
    await p2.close();
  }

  console.log('== phone: the zone above the chat ==');
  await page.setViewport({ width: 390, height: 844 });
  await sleep(400);
  // the panel may be collapsed to the bottom bar on a phone (chat-bar-input) — the word works from both
  if (!(await page.$('[data-testid="chat-input"]')) && (await page.$('[data-testid="chat-bar-input"]'))) {
    await page.click('[data-testid="chat-bar-input"]'); await page.keyboard.type('hlavolam'); await page.keyboard.press('Enter');
  } else await napis('hlavolam');
  expect(await cekej('[data-testid="brain-vrstva"][data-rozlozeni="nad"]', 10000), 'phone: zone with the chat (mode "nad")');
  // Richard 15 Nov 2026: the zone fills the screen UNDER the assistant's header bar, which stays visible (🧠 in it closes the zone)
  const headerBar = async () => {
    const h = await (await page.$('[data-testid="chat-hlavicka"]')).boundingBox();
    const v = await (await page.$('[data-testid="brain-vrstva"]')).boundingBox();
    const onTop = await page.evaluate(() => { const b = document.querySelector('[data-testid="chat-brain-toggle"]'); const r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
    return { h, v, onTop };
  };
  {
    const { h, v, onTop } = await headerBar();
    expect(Math.abs(v.y - (h.y + h.height)) <= 2 && v.y + v.height >= 843, `phone: the zone starts right under the assistant's header bar and runs to the bottom (${Math.round(v.y)}..${Math.round(v.y + v.height)})`);
    expect(onTop, 'phone: the 🧠 button in the header bar is visible and clickable above the zone');
    expect(!(await page.$('[data-testid="brain-rozlozeni"]')), 'phone: no full-screen toggle — the bar must stay visible');
    expect(!!(await page.$('[data-testid="brain-uroven-mines-3"]')) && !(await page.$('[data-testid="brain-uroven-mines-4"]')), 'phone: the mines card offers three levels, Expert 30×16 is not among them');
  }
  await hrat('sudoku');
  expect(await cekej('[data-testid="brain-vrstva"][data-rozlozeni="nad"][data-hra="sudoku"][data-nacteno="1"]', 20000), 'phone: a game opens in the same place');
  {
    const v = await (await page.$('[data-testid="brain-iframe"]')).boundingBox();
    const { onTop } = await headerBar();
    expect(v.height > 600 && onTop, `phone: the game gets the height under the bar (${Math.round(v.height)} px), the bar stays`);
  }
  await page.click('[data-testid="brain-zpet"]');
  expect(await cekej('[data-testid="brain-vrstva"][data-rozlozeni="nad"][data-hra="hub"]', 5000), 'phone: back to the list');
  await page.click('[data-testid="chat-brain-toggle"]');
  expect(await page.waitForSelector('[data-testid="brain-vrstva"]', { hidden: true, timeout: 5000 }).then(() => true).catch(() => false) && !!(await page.$('[data-testid="chat-input"]')), 'phone: 🧠 in the header bar closes the zone → the chat is back');
  await page.click('[data-testid="chat-brain-toggle"]');
  expect(await cekej('[data-testid="brain-vrstva"][data-rozlozeni="nad"][data-hra="hub"]', 10000), 'phone: 🧠 again opens the list under the bar');
  // mines by touch: a long press flags a square once even when the browser also fires contextmenu (Android), the next tap still reveals
  await hrat('mines');
  expect(await cekej('[data-testid="brain-vrstva"][data-nacteno="1"][data-hra="mines"]', 20000), 'phone: mines open under the bar');
  await sleep(500);
  // touch emulation switched on through CDP (a viewport change with hasTouch would reload the page)
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  {
    const f = hraFrame();
    const cells = await f.$$('.cell');
    const mid = async (n) => { const b = await cells[n].boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    let [x, y] = await mid(0);
    const t1 = await page.touchscreen.touchStart(x, y); await sleep(600); await t1.end(); await sleep(250);
    expect((await f.$$eval('.cell.flag', (a) => a.length)) === 1, 'phone: holding a square puts a flag on it');
    [x, y] = await mid(1);
    const t2 = await page.touchscreen.touchStart(x, y); await sleep(450);
    await cells[1].evaluate((el) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    await t2.end(); await sleep(250);
    expect((await f.$$eval('.cell.flag', (a) => a.length)) === 2, "phone (Android): the browser's own long-press event does not take the flag away again");
    [x, y] = await mid(2);
    await page.touchscreen.tap(x, y); await sleep(300);
    expect(await cells[2].evaluate((el) => el.classList.contains('down')), 'phone: a short tap right after a long press still reveals (not swallowed)');
    // regression: a flag before the first reveal used to skip mine placement — a board with no mines that could never be won
    // the board follows the remembered level (2 = 16×16 / 40 here) — a board without mines would open every square
    const opened = await f.$$eval('.cell.down', (a) => a.length);
    const total = cells.length, mines = { 81: 10, 256: 40, 280: 50, 480: 99 }[total];
    expect(!!mines && opened > 0 && opened <= total - mines, `phone: mines are placed even when the first move was a flag (${opened} of ${total} squares open, ${mines} mines)`);
  }
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.click('[data-testid="brain-zpet"]');
  expect(await cekej('[data-testid="brain-vrstva"][data-rozlozeni="nad"][data-hra="hub"]', 5000), 'phone: back from mines to the list');
  await page.setViewport({ width: 844, height: 390 });
  expect(await cekej('[data-testid="brain-vrstva"][data-rozlozeni="vedle"]', 5000), 'phone in landscape: next to the chat like on a computer');

  console.log('== phone in the simplified view: a collapsed assistant leaves the zone full screen — the "Assistant" button brings it back ==');
  await page.setViewport({ width: 390, height: 844, hasTouch: true });
  await page.goto(`${inst.base}/lite`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="lite-asistent"]'), 'lite: the assistant button in the header');
  await page.click('[data-testid="lite-asistent"]');
  expect(await cekej('[data-testid="chat-brain-toggle"]'), 'lite: the panel is open');
  if (await page.$('[data-testid="chat-porada-ne"]')) await page.click('[data-testid="chat-porada-ne"]');
  await page.click('[data-testid="chat-brain-toggle"]');
  expect(await cekej('[data-testid="brain-vrstva"][data-rozlozeni="nad"]'), 'lite: the zone opens under the assistant\'s header bar');
  {
    const h = await (await page.$('[data-testid="chat-hlavicka"]')).boundingBox();
    const v = await (await page.$('[data-testid="brain-vrstva"]')).boundingBox();
    expect(Math.abs(v.y - (h.y + h.height)) <= 2 && v.y + v.height >= 843, `lite: zone from the bar to the bottom (${Math.round(v.y)}..${Math.round(v.y + v.height)})`);
  }
  await page.click('[data-testid="chat-zavrit"]');
  expect(await cekej('[data-testid="brain-vrstva"][data-rozlozeni="cela"]', 5000), 'lite: collapsing the panel leaves the zone over the whole screen');
  expect(/Asistent/.test(await textOf('[data-testid="brain-rozlozeni"]')), 'lite: the toolbar offers a labelled "Asistent" button, not only ✕');
  await page.click('[data-testid="brain-rozlozeni"]');
  expect(await cekej('[data-testid="brain-vrstva"][data-rozlozeni="nad"]', 5000) && !!(await page.$('[data-testid="chat-hlavicka"]')), 'lite: "Asistent" opens the panel again with the zone under its bar');
  await page.click('[data-testid="brain-konec"]');
  expect(await page.waitForSelector('[data-testid="brain-vrstva"]', { hidden: true, timeout: 5000 }).then(() => true).catch(() => false), 'lite: ✕ closes the zone');

  const chybyVazne = chyby.filter((c) => !/favicon|404/.test(c));
  expect(chybyVazne.length === 0, `console clean (${chybyVazne.slice(0, 3).join(' | ')})`);
}, { nazev: 'ui-brain' });
