// UI e2e: the page scrolls again after a dialog opened FROM another dialog is closed (whole-app analysis 5, c9-1).
// Dialogs under the top bar lock the scrolling of the body themselves. Each one used to remember "the value
// before me" and put it back on closing: Clients opened from Time worked remembered "hidden", the outer window
// closed first, and closing Clients — by Esc, the cross or a click beside it — put "hidden" back for good.
// Nothing scrolled (wheel, PageDown) on any page until a reload. The lock now counts open dialogs.
// ⚠️ Scrolling is tested with the WHEEL: window.scrollTo passes through `body { overflow: hidden }`.
const H = require('./_harness');
const { expect, sleep } = H;

const USER = 'zamek@e2e.cz';

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'scroll-lock', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register(USER);
  const { page, chyby } = await H.browser({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email');
  await page.type('#email', USER);
  await page.type('#password', H.PW);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1000);

  const bodyLock = () => page.evaluate(() => document.body.style.overflow);
  const openDialogs = () => page.evaluate(() => [...document.querySelectorAll('[role="dialog"][data-state="open"]')].map((d) => ((d.querySelector('h2') || {}).innerText || '').trim().split('\n')[0]));
  const pad = () => page.evaluate(() => { if (document.querySelector('[data-testid="filler"]')) return; const d = document.createElement('div'); d.style.height = '3000px'; d.setAttribute('data-testid', 'filler'); document.querySelector('[data-testid="obsah"]').appendChild(d); });
  const wheel = async () => { await page.evaluate(() => window.scrollTo(0, 0)); await page.mouse.move(700, 500); await page.mouse.wheel({ deltaY: 600 }); await sleep(500); return page.evaluate(() => Math.round(window.scrollY)); };
  const clickButton = async (scope, re) => {
    const h = await page.evaluateHandle((s, src) => [...document.querySelectorAll(s)].find((b) => b.offsetParent !== null && new RegExp(src).test((b.innerText || '').trim())) || null, scope, re.source);
    if (!h.asElement()) return false;
    await h.asElement().click();
    return true;
  };
  const openTimeWorked = async () => {
    await page.waitForSelector('button[data-user-menu]', { timeout: 20000 });
    await page.click('button[data-user-menu]');
    await page.waitForSelector('[role="menuitem"]', { timeout: 5000 });
    await clickButton('[role="menuitem"]', /^Odpracovaný čas$/);
    await H.waitFor(async () => (await openDialogs()).some((t) => /Odpracovaný čas/.test(t)), { timeout: 8000, popis: 'window Time worked' });
    await sleep(400);
  };
  const closers = {
    Esc: async () => { await page.keyboard.press('Escape'); },
    'the cross': async () => { await page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"][data-state="open"]')].pop(); const x = [...d.querySelectorAll('button')].find((b) => /Zavřít|Close/.test(b.innerText || b.getAttribute('aria-label') || '') || b.querySelector('.lucide-x')); if (x) x.click(); }); },
  };

  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  await pad();
  expect((await bodyLock()) !== 'hidden' && (await wheel()) >= 500, 'before: the page scrolls with the wheel');

  console.log('== control: Time worked alone ==');
  await openTimeWorked();
  expect((await bodyLock()) === 'hidden', 'an open dialog locks the scrolling of the page');
  await page.keyboard.press('Escape');
  await H.waitFor(async () => (await openDialogs()).length === 0, { timeout: 5000, popis: 'dialog closed' });
  expect((await bodyLock()) !== 'hidden' && (await wheel()) >= 500, 'closed → the page scrolls');

  for (const [how, close] of Object.entries(closers)) {
    console.log(`== Time worked → Clients → close by ${how} ==`);
    await openTimeWorked();
    expect(await clickButton('[role="dialog"][data-state="open"] button', /^Klienti$/), 'button Klienti in the window');
    await H.waitFor(async () => (await openDialogs()).some((t) => /^Klienti/.test(t)), { timeout: 8000, popis: 'window Clients' });
    await sleep(500);
    expect((await bodyLock()) === 'hidden', `with Clients open the page is locked (open: ${(await openDialogs()).join(', ')})`);
    for (let i = 0; i < 3 && (await openDialogs()).length; i++) { await close(); await sleep(600); }
    const left = await openDialogs();
    const lock = await bodyLock();
    const y = await wheel();
    expect(left.length === 0, `all dialogs closed (${left.join(', ') || 'none'})`);
    expect(lock !== 'hidden', `the lock is released (body overflow "${lock}")`);
    expect(y >= 500, `the wheel scrolls the page again (scrollY ${y})`);
    await page.goto(`${inst.base}/tasks`, { waitUntil: 'networkidle2' });
    expect((await bodyLock()) !== 'hidden', 'and stays released on another page (Tasks)');
    await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
    await pad();
  }
  expect(chyby.length === 0, `console without errors (${chyby.slice(0, 2).join(' | ')})`);
}, { nazev: 'UI-SCROLL-LOCK-NESTED-DIALOGS' });
