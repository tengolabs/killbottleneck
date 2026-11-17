// Browser "back" never throws the person out of the app (Richard 17 Nov 2026, recording a tutorial: Brain training →
// sudoku → the mouse back button jumped to the sign-in page). Click suite (Puppeteer) against a MOCKED ollama:
//  · signing in through the form leaves no sign-in page in the history (back from the app ≠ /login);
//  · back in a game = the list of games, back again = the zone closes, the page stays (also with the focus inside the game);
//  · closing by the layer's own ✕ eats the extra history entry (the next back is an ordinary one, not a dead press);
//  · a reload with a layer open: the first back is not a dead press;
//  · relax closes on back, relax locked with a PIN does NOT; a dialog closes on back; the Office side panel on a
//    computer does not take back (it stays open across pages);
//  · phone: back closes the Office, then folds the assistant away; lite: back closes the quick-add form, then folds
//    the assistant away, staying in /lite; console clean.
// The browser's own back (Alt+←, the Windows app, Android) jumps over entries a page added without a fresh click —
// that case is in desktop-e2e/zpet.js (real Electron); headless Chrome's mouse button takes the page's own path.
// The mechanism: lib/backLayers.js + hooks/useBackLayer.js.
const H = require('./_harness');
const { expect, sleep } = H;

const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  JSON.parse(body);
  res.end(JSON.stringify({ message: { role: 'assistant', content: 'ok' }, prompt_eval_count: 10, eval_count: 2, done: true }));
};

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ui-zpet', addHostGateway: true, env: { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0 } });
  const B = inst.base;
  await inst.register('admin@example.com', { name: 'Petr Novák' });

  const { page, chyby } = await H.browser();
  const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const zmizi = async (sel, ms = 8000) => page.waitForSelector(sel, { hidden: true, timeout: ms }).then(() => true).catch(() => false);
  const atr = (sel, a) => page.evaluate((s, x) => document.querySelector(s)?.getAttribute(x), sel, a);
  const cesta = () => page.evaluate(() => (window.location.origin === 'null' ? 'about:blank' : window.location.pathname));
  const naUrl = () => page.url();
  const straz = () => page.evaluate(() => !!(window.history.state && window.history.state.kbBackGuard));
  // back = what the mouse button / Alt+← / the phone's back do: one step of the session history
  const zpet = async (p = page) => { await p.goBack({ timeout: 5000 }).catch(() => {}); await sleep(700); };
  // a click that survives a re-render between finding the element and clicking it ("Node is detached", full
  // regression 17 Nov 2026 right after the zone closed and the header re-rendered)
  const klik = async (sel) => {
    for (let i = 0; ; i += 1) {
      try { await page.waitForSelector(sel, { timeout: 10000 }); await page.click(sel); return; } catch (e) {
        if (i >= 3 || !/detached|not clickable/i.test(String(e && e.message))) throw e;
        await sleep(300);
      }
    }
  };
  const hrat = async (id) => {
    const sel = `[data-testid="brain-hrat-${id}"]`;
    await page.waitForSelector(sel, { timeout: 10000 });
    await page.$eval(sel, (e) => e.scrollIntoView({ block: 'center' }));
    await sleep(250);
    await klik(sel);
  };
  const otevriChat = async () => {
    if (await page.$('[data-testid="chat-input"]')) return true;
    if (!(await cekej('[data-testid="chat-tab"]'))) return false;
    await klik('[data-testid="chat-tab"]');
    const ok = await cekej('[data-testid="chat-input"]');
    if (await page.$('[data-testid="chat-porada-ne"]')) await klik('[data-testid="chat-porada-ne"]');
    return ok;
  };

  console.log('== sign-in through the form: back from the app does not return to /login ==');
  await page.goto(`${B}/`, { waitUntil: 'networkidle2' });
  expect(await cekej('#email', 15000), 'not signed in → the sign-in form');
  await page.type('#email', 'admin@example.com');
  await page.type('#password', H.PW);
  await klik('button[type="submit"]');
  await page.waitForFunction(() => window.location.pathname === '/' && !document.querySelector('#password'), { timeout: 20000 }).catch(() => {});
  expect(await cekej('[data-testid="chat-tab"], [data-testid="chat-input"]', 15000), 'signed in, the app with the assistant');
  await zpet();
  expect(!/\/login/.test(naUrl()), `back after signing in does not show the sign-in page (${naUrl()})`);

  console.log('== Brain training: back in a game = the list, back again = the zone closes, the app stays ==');
  await page.goto(`${B}/`, { waitUntil: 'networkidle2' });
  expect(await otevriChat(), 'assistant panel open');
  expect(!(await straz()), 'nothing open → no extra history entry');
  await klik('[data-testid="chat-brain-toggle"]');
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="hub"]'), 'the zone is open on the list of games');
  expect(await straz(), 'the open zone holds an extra history entry');
  await hrat('sudoku');
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="sudoku"][data-nacteno="1"]', 15000), 'sudoku loaded');
  {
    // the person clicks into the game (focus in the iframe) and presses the mouse's back button
    const box = await (await page.$('[data-testid="brain-iframe"]')).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(300);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'back' }).catch(() => {});
    await sleep(800);
    const mysiZpet = (await atr('[data-testid="brain-vrstva"]', 'data-hra')) === 'hub';
    console.log(`   (headless Chrome ${mysiZpet ? 'carried out' : 'ignores'} the mouse back button itself — the history step follows)`);
    if (!mysiZpet) await zpet();
  }
  expect((await atr('[data-testid="brain-vrstva"]', 'data-hra')) === 'hub', 'back from the game = the list of games');
  expect((await cesta()) === '/' && !/\/login/.test(naUrl()), `still in the app (${naUrl()})`);
  await zpet();
  expect(await zmizi('[data-testid="brain-vrstva"]'), 'back again = the zone closed');
  expect((await cesta()) === '/', `the page stayed (${naUrl()})`);
  expect(!!(await page.$('[data-testid="chat-input"]')), 'the assistant stayed open');
  expect(!(await straz()), 'no extra entry left after closing');

  console.log('== ✕ eats the extra entries: the next back is an ordinary one ==');
  // a known page before the home page: /tasks → /
  await klik('[data-nav="tasks"]');
  await page.waitForFunction(() => window.location.pathname === '/tasks', { timeout: 10000 }).catch(() => {});
  await klik('[data-nav="projects"]');
  await page.waitForFunction(() => window.location.pathname === '/', { timeout: 10000 }).catch(() => {});
  await otevriChat();
  await klik('[data-testid="chat-brain-toggle"]');
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="hub"]'), 'zone open again');
  await hrat('sudoku');
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="sudoku"]', 15000), 'a game over the list (two layers)');
  await klik('[data-testid="brain-konec"]');
  expect(await zmizi('[data-testid="brain-vrstva"]'), '✕ closed the zone with the game');
  await sleep(1000);
  expect(!(await straz()), 'after ✕ the current entry is the page itself, not an extra one');
  expect((await cesta()) === '/', 'the page stayed after ✕');
  await zpet();
  expect((await cesta()) === '/tasks', `the next back leaves for the page before — no dead press (${naUrl()})`);
  await page.goForward({ timeout: 5000 }).catch(() => {});
  await sleep(700);
  expect((await cesta()) === '/', `forward returns to the home page (${naUrl()})`);

  console.log('== a reload with a layer open: the first back is not a dead press ==');
  await otevriChat();
  await klik('[data-testid="chat-brain-toggle"]');
  expect(await cekej('[data-testid="brain-vrstva"][data-hra="hub"]'), 'zone open');
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1000);
  await zpet();
  expect((await cesta()) === '/tasks', `after the reload one back leaves for the page before (${naUrl()})`);
  await page.goForward({ timeout: 5000 }).catch(() => {});
  await sleep(1200);
  expect((await cesta()) === '/', `forward back home, over the left-over entry (${naUrl()})`);

  console.log('== relax: back closes it; locked with a PIN it stays ==');
  await klik('[data-testid="chat-relax-toggle"]');
  expect(await cekej('[data-testid="relax-vrstva"]'), 'relax open');
  await zpet();
  expect(await zmizi('[data-testid="relax-vrstva"]'), 'back closed relax');
  expect((await cesta()) === '/', 'the page stayed');
  await klik('[data-testid="chat-relax-toggle"]');
  expect(await cekej('[data-testid="relax-vrstva"]'), 'relax open again');
  await klik('[data-testid="relax-zamknout"]');
  expect(await cekej('[data-testid="relax-pin-nastavit"]'), 'PIN dialog');
  await page.type('[data-testid="relax-pin"]', '1234');
  await sleep(300);
  await page.type('[data-testid="relax-pin"]', '1234');
  expect(await cekej('[data-testid="relax-vrstva"][data-zamek="1"]'), 'locked');
  await zpet();
  await zpet();
  expect((await atr('[data-testid="relax-vrstva"]', 'data-zamek')) === '1', 'two backs: relax still locked');
  expect((await cesta()) === '/' && !/\/login/.test(naUrl()), `the locked screen did not leave for another page (${naUrl()})`);
  expect(await straz(), 'the locked relax still holds its entry');
  await klik('[data-testid="relax-odemknout"]');
  expect(await cekej('[data-testid="relax-pin-odemknout"]'), 'unlock field');
  await page.type('[data-testid="relax-pin"]', '1234');
  expect(await cekej('[data-testid="relax-vrstva"][data-zamek="0"]'), 'unlocked');
  await zpet();
  expect(await zmizi('[data-testid="relax-vrstva"]'), 'unlocked relax closes on back again');

  console.log('== a computer: the Office side panel does not take back; a dialog closes on back ==');
  await otevriChat();
  await klik('[data-testid="chat-dokumenty-btn"]');
  expect(await cekej('[data-testid="chat-dokumenty"]'), 'Office open');
  expect(!(await straz()), 'the Office side panel holds no extra entry on a computer');
  await klik('[data-testid="chat-dokumenty-btn"]');
  expect(await zmizi('[data-testid="chat-dokumenty"]'), 'Office closed by its button');
  await klik('[data-user-menu]');
  await cekej('[data-testid="menu-connect-agent"]', 5000);
  await klik('[data-testid="menu-connect-agent"]');
  expect(await cekej('[data-testid="agent-setup-dialog"]'), 'dialog from the menu open');
  await zpet();
  expect(await zmizi('[data-testid="agent-setup-dialog"]'), 'back closed the dialog');
  expect((await cesta()) === '/', 'the page stayed');
  expect(!(await straz()), 'nothing open → no extra entry');

  console.log('== a dialog closes and the app changes page at once: the new page stays ==');
  // the dialog's own close eats its extra entry with history.go(-1); a navigation right after it (before that step
  // arrives) must not be undone by it — Chrome aims the step when it is called (lib/backLayers.js)
  await klik('[data-user-menu]');
  await cekej('[data-testid="menu-connect-agent"]', 5000);
  await klik('[data-testid="menu-connect-agent"]');
  expect(await cekej('[data-testid="agent-setup-dialog"]'), 'dialog open');
  await page.evaluate(() => {
    const puvodni = window.history.go.bind(window.history);
    window.history.go = (n) => { window.history.go = puvodni; puvodni(n); document.querySelector('[data-nav="tasks"]').click(); };
  });
  // the menu that opened the dialog still holds the focus for a moment (its closing animation) — Escape would go to it
  await page.waitForFunction(() => !document.querySelector('[role="menu"]'), { timeout: 5000 }).catch(() => {});
  await sleep(300);
  await page.keyboard.press('Escape');
  expect(await zmizi('[data-testid="agent-setup-dialog"]'), 'Escape closed the dialog');
  await sleep(1500);
  expect((await cesta()) === '/tasks', `the page the app went to stayed (${naUrl()})`);
  expect(!(await straz()), 'the new page is the current entry');
  await zpet();
  expect((await cesta()) === '/', `back from it = the page before, the left-over entry is stepped over (${naUrl()})`);
  expect(!(await straz()), 'and the current entry is the page itself');
  // ordinary back still leaves the page (here to the page before the app) — nothing swallows it
  await zpet();
  expect((await cesta()) !== '/' || !/^http/.test(naUrl()), `with nothing open back is an ordinary one (${naUrl()})`);

  console.log('== phone: back closes the Office, then folds the assistant away ==');
  const tok = await inst.login('admin@example.com');
  const { page: p3, chyby: chyby3 } = await H.browser({ mobil: true });
  await p3.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); localStorage.setItem('kb-mode', 'full'); localStorage.setItem('kb-chat-open', '1'); }, tok);
  await p3.goto(`${B}/tasks`, { waitUntil: 'networkidle2' });
  await p3.goto(`${B}/`, { waitUntil: 'networkidle2' });
  const c3 = (sel, ms = 10000) => p3.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const z3 = (sel, ms = 8000) => p3.waitForSelector(sel, { hidden: true, timeout: ms }).then(() => true).catch(() => false);
  // (the assistant open from the last visit: its layer is restored on load, then the Office opens by a click)
  expect(await c3('[data-testid="chat-input"]', 15000), 'phone: the assistant open');
  if (await p3.$('[data-testid="chat-porada-ne"]')) await p3.click('[data-testid="chat-porada-ne"]');
  await p3.click('[data-testid="chat-dokumenty-btn"]');
  expect(await c3('[data-testid="chat-dokumenty"]'), 'phone: the Office open over the assistant');
  await zpet(p3);
  expect(await z3('[data-testid="chat-dokumenty"]'), 'phone: back closed the Office');
  expect(!!(await p3.$('[data-testid="chat-input"]')), 'phone: the assistant is still open under it');
  await zpet(p3);
  expect(await z3('[data-testid="chat-input"]'), 'phone: back again folded the assistant away');
  expect(new URL(p3.url()).pathname === '/', `phone: the page stayed (${p3.url()})`);
  await zpet(p3);
  expect(new URL(p3.url()).pathname === '/tasks', `phone: then back is an ordinary one (${p3.url()})`);

  console.log('== lite (phone): back closes the quick-add form, folds the assistant away, stays in /lite ==');
  const { page: p2, chyby: chyby2 } = await H.browser({ mobil: true });
  await p2.evaluateOnNewDocument(() => { localStorage.setItem('kb-mode', 'lite'); });
  await p2.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); }, tok);
  await p2.goto(`${B}/lite`, { waitUntil: 'networkidle2' });
  const ok2 = await p2.waitForSelector('[data-testid="lite-asistent"]', { timeout: 15000 }).then(() => true).catch(() => false);
  expect(ok2, 'lite: the Assistant button');
  if (await p2.$('[data-testid="lite-pridat"]')) {
    await p2.click('[data-testid="lite-pridat"]');
    expect(await p2.waitForSelector('[data-testid="lite-rychle-pridani"]', { timeout: 8000 }).then(() => true).catch(() => false), 'lite: the quick-add form open');
    await zpet(p2);
    expect(await p2.waitForSelector('[data-testid="lite-rychle-pridani"]', { hidden: true, timeout: 8000 }).then(() => true).catch(() => false), 'lite: back closed the quick-add form');
    expect(/\/lite/.test(p2.url()), `lite: still in /lite (${p2.url()})`);
  } else expect(false, 'lite: the + button');
  if (ok2) {
    await p2.click('[data-testid="lite-asistent"]');
    expect(await p2.waitForSelector('[data-testid="chat-input"]', { timeout: 15000 }).then(() => true).catch(() => false), 'lite: the assistant open');
    await zpet(p2);
    expect(await p2.waitForSelector('[data-testid="chat-input"]', { hidden: true, timeout: 8000 }).then(() => true).catch(() => false), 'lite: back folded the assistant away');
    expect(/\/lite/.test(p2.url()), `lite: still in /lite (${p2.url()})`);
  }

  const vse = [...chyby, ...chyby2, ...chyby3];
  expect(vse.length === 0, `console clean (${vse.length}${vse.length ? ': ' + vse[0].slice(0, 160) : ''})`);
}, { nazev: 'UI-ZPET' });
