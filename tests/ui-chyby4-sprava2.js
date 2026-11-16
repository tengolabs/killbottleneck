// UI e2e (headless Chrome) for wave 3B of code analysis 4 — administration and sign-in,
// what the person SEES:
//
//  A) F4-07: sign-in, sign-up and lite errors are in the person's language — never
//     PocketBase's English "Failed to authenticate." / "Failed to create record." /
//     "Something went wrong."; a sentence written by the server (lock, limit) is shown.
//  B) F4-02: the org structure manager keeps the list of people after sending an invitation
//     (it used to empty to "0 people" until the page was reloaded).
//  C) F4-05: a failed action in administration is SAID — the invitation under the field in
//     its dialog, the purpose by a message, the list of people on the page with "try again".
//  D) F4-03: "Save" of the organisation name keeps the purpose select and does not create
//     a second organisation record when the record was created meanwhile by the purpose.
//  E) F4-06: the number of projects in a person's row equals the numbers in the delete
//     dialog and names no private project (fixed in wave 1; re-checked here, not a mutation).
//  F) F4-04: when the sign-in stops being valid under an open tab (the administrator resets
//     the password), the next click leads to the sign-in page, which says why — instead of
//     an app that looks empty. After signing in again the person lands where they were going.
//  G) F5-02: without network the last "My day" is shown instead of the sign-in form; the
//     sign-in is confirmed again when the network is back.
const H = require('./_harness');
const { expect, sleep } = H;

const telo = (title) => ({
  title,
  nodes: [
    { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: title, title, status: 'todo' } },
    { id: 'k1', type: 'goalNode', position: { x: 0, y: 240 }, data: { title: 'Krok', status: 'todo' } },
  ],
  edges: [{ id: 'e1', source: 'root', target: 'k1' }],
});

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-chyby4-sprava2', env: { KB_UVODNI_MAPA: 0 } });
  const ST = await inst.superuser();
  const ucet = async (email, extra) => {
    const r = await inst.register(email, extra || {});
    if (r.status !== 200) throw new Error(`registrace ${email}: ${r.status}`);
    const token = await inst.login(email);
    await inst.api('POST', '/api/collections/loginlogs/records', { token, body: {} });
    return { id: r.json.id, email, token };
  };
  const mapa = async (kdo, title) => (await inst.api('POST', '/api/collections/goalmaps/records', { token: kdo.token, body: Object.assign(telo(title), { owner: kdo.id, owner_email: kdo.email }) })).json;
  const admin = await ucet('admin@sprava2.cz');
  const spravce = await ucet('spravce@sprava2.cz'); // org structure manager, not an administrator
  const clen = await ucet('clen@sprava2.cz');
  const obet = await ucet('obet@sprava2.cz');       // their password gets reset under an open tab
  const mobil = await ucet('mobil@sprava2.cz');     // lite without network
  await inst.api('PATCH', `/api/collections/users/records/${spravce.id}`, { token: admin.token, body: { is_org_manager: true } });
  await mapa(clen, 'TAJNY-SOUKROMY-PROJEKT');
  const T = await mapa(clen, 'Tymovy projekt clena');
  await inst.api('POST', '/api/kb/share', { token: clen.token, body: { action: 'set_team_access', mapId: T.id, access: 'read' } });
  await mapa(obet, 'PROJEKT-OBETI');
  const dnes = new Date(); const den = `${dnes.getFullYear()}-${String(dnes.getMonth() + 1).padStart(2, '0')}-${String(dnes.getDate()).padStart(2, '0')}`;
  const napad = await inst.api('POST', '/api/collections/buffer_nodes/records', { token: mobil.token, body: { title: 'UKOL-NA-DNESEK', planned_on: den, owner: mobil.id } });
  if (napad.status !== 200) throw new Error(`nápad na dnešek: ${napad.status}`);

  const { browser, page, chyby } = await H.browser({ viewport: { width: 1900, height: 950 } });
  const dialogy = [];
  let potvrdit = true;
  // since 15 Nov 2026 the questions and notices are dialogs of the app (lib/appDialogs.js)
  const nativni = [];
  page.on('dialog', async (d) => { nativni.push(d.message()); await d.accept(); });
  await H.appDialogy(page, (d) => { dialogy.push(d); return d.typ !== 'confirm' || potvrdit; });
  const kontext = async (opts = {}) => {
    const ctx = await (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
    const p = await ctx.newPage();
    await p.setViewport(opts.mobil ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1500, height: 950 });
    if (opts.en) await p.evaluateOnNewDocument(() => { try { localStorage.setItem('flowmap-lang', 'en'); } catch (e) { /* no storage */ } });
    return { ctx, p };
  };
  const vypln = async (p, email, heslo) => {
    await p.waitForSelector('#email');
    await p.type('#email', email);
    await p.type('#password', heslo);
  };
  const prihlas = async (p, email, heslo = H.PW) => {
    await p.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
    await vypln(p, email, heslo);
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type="submit"]')]);
    await sleep(1500);
  };
  const text = (p) => p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const hlaska = (p) => p.evaluate(() => { const e = document.querySelector('.text-destructive'); return e ? e.innerText.trim() : ''; });
  const ANGLICKY = /Failed to|Something went wrong|Value must be/;

  console.log('== A) F4-07: chyby přihlášení a registrace v jazyce člověka ==');
  await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
  await vypln(page, admin.email, 'spatne-heslo-123');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !!document.querySelector('.text-destructive'), { timeout: 10000 }).catch(() => {});
  let h = await hlaska(page);
  expect(h === 'Neplatný email nebo heslo', `špatné heslo česky („${h}")`);
  expect(!ANGLICKY.test(await text(page)), 'na přihlášení není anglická věta PocketBase');
  await page.goto(`${inst.base}/register`, { waitUntil: 'networkidle2' });
  await vypln(page, admin.email, H.PW);
  await page.type('#confirm', H.PW);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !!document.querySelector('.text-destructive'), { timeout: 10000 }).catch(() => {});
  h = await hlaska(page);
  expect(/^(Účet s tímto e-mailem už existuje|Účet se nepodařilo vytvořit)/.test(h) && /obnovit heslo/.test(h) && !ANGLICKY.test(h), `registrace na adresu s účtem česky a s radou („${h}")`);
  {
    const { ctx, p } = await kontext({ en: true });
    await p.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
    await vypln(p, admin.email, 'wrong-password-123');
    await p.click('button[type="submit"]');
    await p.waitForFunction(() => !!document.querySelector('.text-destructive'), { timeout: 10000 }).catch(() => {});
    h = await hlaska(p);
    expect(h === 'Invalid email or password', `wrong password in English („${h}")`);
    await p.goto(`${inst.base}/register`, { waitUntil: 'networkidle2' });
    await vypln(p, admin.email, H.PW);
    await p.type('#confirm', H.PW);
    await p.click('button[type="submit"]');
    await p.waitForFunction(() => !!document.querySelector('.text-destructive'), { timeout: 10000 }).catch(() => {});
    h = await hlaska(p);
    expect(/^(An account with this email already exists|The account could not be created)/.test(h) && !/Failed to|Registrace selhala/.test(h), `sign-up with a taken address in English („${h}")`);
    await ctx.close();
  }

  console.log('== B) F4-02: správci struktury po pozvánce seznam lidí nezmizí ==');
  await prihlas(page, spravce.email);
  await page.goto(`${inst.base}/admin/users`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="oddil-lide"]', { timeout: 20000 });
  const lide = () => page.evaluate(() => ({
    radky: [...document.querySelectorAll('[data-testid^="deputy-"]')].map((x) => x.getAttribute('data-testid').slice(7)).sort(),
    zalozka: (document.querySelector('[data-testid="oddil-lide"]') || {}).innerText.replace(/\s+/g, ' ').trim(),
    identita: (document.querySelector('[data-testid="admin-identita"]') || {}).innerText || '',
  }));
  await page.waitForSelector('[data-testid^="deputy-"]', { timeout: 15000 }).catch(() => {});
  let L = await lide();
  expect(L.radky.length === 5 && /5/.test(L.zalozka), `správce struktury vidí 5 lidí (${L.radky.length}, záložka „${L.zalozka}")`);
  const pozvi = async (email) => {
    await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Pozvat').click());
    await page.waitForSelector('#invite-email', { timeout: 8000 });
    await page.type('#invite-email', email);
    await page.keyboard.press('Enter');
  };
  await pozvi('novy@sprava2.cz');
  await page.waitForFunction(() => /Dočasné heslo|temp/i.test((document.querySelector('[role="dialog"]') || {}).innerText || '') || !!document.querySelector('[role="dialog"] code'), { timeout: 10000 }).catch(() => {});
  expect(await page.evaluate(() => !!document.querySelector('[role="dialog"] code')), 'pozvánka prošla — dialog ukazuje dočasné heslo');
  await page.keyboard.press('Escape'); await sleep(800);
  L = await lide();
  expect(L.radky.length === 6 && L.radky.includes('novy@sprava2.cz'), `po pozvánce je v seznamu 6 lidí včetně nového (${L.radky.length}: ${L.radky.join(', ')})`);
  expect(/6/.test(L.zalozka) && /6 lid/.test(L.identita), `záložka i hlavička říkají 6 („${L.zalozka}", „${L.identita}")`);

  console.log('== C) F4-05: selhání ve Správě se řekne ==');
  await prihlas(page, admin.email);
  await page.goto(`${inst.base}/admin/users`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid^="deputy-"]', { timeout: 20000 });
  dialogy.length = 0;
  await pozvi(clen.email); // already has an account
  await page.waitForSelector('[data-testid="invite-error"]', { timeout: 8000 }).catch(() => {});
  h = await page.evaluate(() => (document.querySelector('[data-testid="invite-error"]') || {}).innerText || '');
  expect(/už existuje/.test(h), `pozvánka existující adresy: důvod serveru pod polem („${h}")`);
  expect(await page.evaluate(() => !!document.querySelector('#invite-email') && document.querySelector('#invite-email').value === 'clen@sprava2.cz'), 'dialog zůstal otevřený s vyplněnou adresou');
  await page.keyboard.press('Escape'); await sleep(500);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Pozvat').click());
  await page.waitForSelector('#invite-email', { timeout: 8000 });
  expect(await page.evaluate(() => !document.querySelector('[data-testid="invite-error"]')), 'znovu otevřený dialog je bez staré chyby');
  await page.keyboard.press('Escape'); await sleep(500);

  // list of people fails to load → said on the page, "try again" loads it
  await page.setRequestInterception(true);
  let shodit = true;
  const zachyt = (req) => {
    if (shodit && req.method() === 'GET' && /\/api\/collections\/users\/records(\?|$)/.test(req.url())) {
      req.respond({ status: 400, contentType: 'application/json', body: JSON.stringify({ status: 400, message: 'PODVRZENE-SELHANI-SEZNAMU', data: {} }) });
    } else if (shodit && req.method() === 'POST' && req.url().includes('/api/kb/purpose')) {
      req.respond({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'PODVRZENE-SELHANI-UCELU' }) });
    } else req.continue();
  };
  page.on('request', zachyt);
  await page.goto(`${inst.base}/admin/users`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="lide-load-error"]', { timeout: 15000 }).catch(() => {});
  h = await page.evaluate(() => (document.querySelector('[data-testid="lide-load-error"]') || {}).innerText || '');
  expect(/PODVRZENE-SELHANI-SEZNAMU/.test(h) && /Zkusit znovu/.test(h), `nenačtený seznam lidí se řekne na stránce („${h.replace(/\s+/g, ' ')}")`);
  // purpose refused → message with the server's sentence, the select returns
  await page.goto(`${inst.base}/admin/users?oddil=org`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#org-purpose', { timeout: 15000 });
  dialogy.length = 0;
  await page.select('#org-purpose', 'family');
  await H.waitFor(() => dialogy.some((d) => d.typ === 'alert'), { timeout: 8000, popis: 'hláška o účelu' }).catch(() => {});
  expect(/PODVRZENE-SELHANI-UCELU/.test((dialogy.find((d) => d.typ === 'alert') || {}).text || ''), `odmítnutý účel se řekne větou serveru („${(dialogy.find((d) => d.typ === 'alert') || {}).text || ''}")`);
  expect((await page.$eval('#org-purpose', (s) => s.value)) === 'team', 'a výběr se vrátil na původní hodnotu');
  shodit = false;
  await page.goto(`${inst.base}/admin/users`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="lide-load-error"]', { timeout: 3000 }).catch(() => {});
  shodit = true;
  await page.goto(`${inst.base}/admin/users`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="lide-load-error"]', { timeout: 15000 }).catch(() => {});
  shodit = false;
  const znovu = await page.$('[data-testid="lide-load-error"] button');
  if (znovu) await znovu.click();
  await page.waitForSelector('[data-testid^="deputy-"]', { timeout: 15000 }).catch(() => {});
  L = await lide();
  expect(!!znovu && L.radky.length === 6 && await page.evaluate(() => !document.querySelector('[data-testid="lide-load-error"]')), `„Zkusit znovu" seznam načte a chyba zmizí (${L.radky.length} lidí)`);
  page.off('request', zachyt);
  await page.setRequestInterception(false);

  console.log('== D) F4-03: Uložit název organizace nechá účel a nezaloží druhý záznam ==');
  const orgZaznamy = async () => ((await inst.api('GET', '/api/collections/org_settings/records', { token: ST })).json.items || []).map((x) => ({ name: x.name, purpose: x.purpose }));
  expect((await orgZaznamy()).length === 0, 'instance zatím záznam organizace nemá');
  await page.goto(`${inst.base}/admin/users?oddil=org`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#org-purpose', { timeout: 15000 });
  await page.select('#org-purpose', 'solo');
  await H.waitFor(async () => (await orgZaznamy()).some((x) => x.purpose === 'solo'), { timeout: 8000, popis: 'uložení účelu' }).catch(() => {});
  await page.click('#org-name', { clickCount: 3 });
  await page.type('#org-name', 'Moje firma');
  const ulozit = async () => {
    await page.evaluate(() => {
      const panel = document.querySelector('#org-name').closest('[data-oddil]');
      [...panel.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Uložit').click();
    });
    await H.waitFor(async () => (await orgZaznamy()).some((x) => x.name === 'Moje firma'), { timeout: 8000, popis: 'uložení názvu' }).catch(() => {});
    await sleep(600);
  };
  await ulozit();
  expect((await page.$eval('#org-purpose', (s) => s.value)) === 'solo', `po „Uložit" výběr účelu zůstal „Jen pro sebe" (${await page.$eval('#org-purpose', (s) => s.value)})`);
  let org = await orgZaznamy();
  expect(org.length === 1 && org[0].name === 'Moje firma' && org[0].purpose === 'solo', `na serveru je JEDEN záznam organizace s názvem i účelem (${JSON.stringify(org)})`);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#org-name', { timeout: 15000 });
  await sleep(800);
  expect((await page.$eval('#org-name', (i) => i.value)) === 'Moje firma' && (await page.$eval('#org-purpose', (s) => s.value)) === 'solo', 'po obnovení stránky název i účel drží');

  console.log('== E) F4-06: počet map v řádku = čísla v dialogu mazání, bez názvů soukromých ==');
  await page.goto(`${inst.base}/admin/users`, { waitUntil: 'networkidle2' });
  await page.waitForSelector(`[data-testid="akce-${clen.email}"]`, { timeout: 20000 });
  await sleep(800);
  const radek = await page.evaluate((em) => {
    const b = document.querySelector(`[data-testid="akce-${em}"]`);
    const r = b && (b.closest('tr') || b.parentElement.parentElement.parentElement);
    return r ? r.innerText.replace(/\s+/g, ' ') : '';
  }, clen.email);
  expect(/\b2 mapy/.test(radek), `řádek člena: 2 mapy — včetně soukromé, kterou správce nevidí („${radek.slice(0, 80)}")`);
  dialogy.length = 0; potvrdit = false; // read the dialog, do not delete
  await (await page.$(`[data-testid="akce-${clen.email}"]`)).click();
  await page.waitForSelector(`[data-testid="smazat-${clen.email}"]`, { timeout: 5000 });
  await (await page.$(`[data-testid="smazat-${clen.email}"]`)).click();
  // the delete dialog is a dialog of the app since 15 Nov 2026: read it and leave by "Zrušit"
  await page.waitForSelector('[data-testid="smazat-dialog"]', { timeout: 8000 }).catch(() => {});
  const dotaz = await page.$eval('[data-testid="smazat-dialog"]', (el) => el.innerText).catch(() => '');
  if (await page.$('[data-testid="smazat-zrusit"]')) { await page.click('[data-testid="smazat-zrusit"]'); await sleep(500); }
  const cisla = [/na spolusprávce projektu: (\d+)/, /na vás \(projekt nemá jiného spolusprávce\): (\d+)/, /soukromé projekty \(nikdo jiný je nevidí\): (\d+)/].map((re) => Number((dotaz.match(re) || [])[1]));
  expect(cisla.every((n) => Number.isInteger(n)) && cisla[0] + cisla[1] + cisla[2] === 2, `dialog mazání dává dohromady tytéž 2 projekty (${cisla.join(' + ')})`);
  expect(!!dotaz && !/TAJNY-SOUKROMY-PROJEKT/.test(dotaz) && !/TAJNY-SOUKROMY-PROJEKT/.test(await text(page)), 'název soukromého projektu není v dialogu ani na stránce');
  potvrdit = true;
  expect((await inst.api('GET', `/api/collections/users/records/${clen.id}`, { token: ST })).status === 200, 'zrušený dialog účet nesmazal');

  console.log('== F) F4-04: přihlášení přestane platit pod otevřenou kartou ==');
  {
    const { ctx, p } = await kontext();
    await prihlas(p, obet.email);
    await p.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
    await p.waitForFunction(() => document.body.innerText.includes('PROJEKT-OBETI'), { timeout: 20000 }).catch(() => {});
    expect((await text(p)).includes('PROJEKT-OBETI'), 'člen má otevřenou titulku se svým projektem');
    const reset = await inst.api('POST', '/api/kb/reset-user-password', { token: admin.token, body: { email: obet.email } });
    expect(reset.status === 200 && !!reset.json.temp_password, `správce mu obnovil heslo (${reset.status})`);
    expect((await inst.api('POST', '/api/collections/users/auth-refresh', { token: obet.token })).status === 401, 'starý token už server odmítá');
    // the person clicks on in the open tab — no reload
    const ukoly = (await p.evaluateHandle(() => [...document.querySelectorAll('header a, header button, nav a, nav button')].find((x) => x.offsetParent && (x.innerText || '').trim() === 'Úkoly') || null)).asElement();
    if (ukoly) await ukoly.click();
    expect(!!ukoly, 'klik na „Úkoly" v otevřené kartě');
    const naLoginu = await p.waitForFunction(() => location.pathname === '/login', { timeout: 15000 }).then(() => true).catch(() => false);
    if (naLoginu) await p.waitForSelector('#email', { timeout: 10000 }).catch(() => {});
    await sleep(500);
    expect(naLoginu, `aplikace ho pošle na přihlášení (${await p.evaluate(() => location.pathname + location.search)})`);
    h = await hlaska(p);
    expect(/Přihlášení přestalo platit/.test(h), `přihlašovací stránka řekne proč („${h}")`);
    expect(await p.evaluate(() => { try { return !JSON.parse(localStorage.getItem('pocketbase_auth') || '{}').token; } catch (e) { return true; } }), 'neplatný token z prohlížeče zmizel');
    expect(!(await text(p)).includes('PROJEKT-OBETI') && !/Zatím nemáte žádné/.test(await text(p)), 'žádná „prázdná aplikace" — jen přihlášení');
    if (naLoginu) { // without the redirect there is no form to continue with (the checks above are already red)
      await vypln(p, obet.email, reset.json.temp_password);
      await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type="submit"]')]);
      await sleep(1500);
      expect(await p.evaluate(() => location.pathname === '/tasks'), `po novém přihlášení je tam, kam mířil (${await p.evaluate(() => location.pathname)})`);
      await p.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
      await p.waitForSelector('#email');
      expect((await hlaska(p)) === '', 'věta o vypršení se ukáže jen jednou');
    }
    await ctx.close();
  }

  console.log('== G) F5-02: bez sítě poslední „Můj den", ne přihlášení ==');
  {
    const { ctx, p } = await kontext({ mobil: true });
    await prihlas(p, mobil.email);
    await p.goto(`${inst.base}/lite`, { waitUntil: 'networkidle2' });
    await p.waitForFunction(() => document.body.innerText.includes('UKOL-NA-DNESEK'), { timeout: 20000 }).catch(() => {});
    expect((await text(p)).includes('UKOL-NA-DNESEK'), 'lite se sítí ukazuje dnešní úkol');
    // the service worker must control the page and hold the shell + the last My day
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.reload({ waitUntil: 'networkidle2' });
    await p.waitForFunction(() => document.body.innerText.includes('UKOL-NA-DNESEK'), { timeout: 20000 }).catch(() => {});
    const drzi = await H.waitFor(() => p.evaluate(async () => {
      if (!navigator.serviceWorker.controller) return false;
      const k = await caches.keys();
      const data = k.find((x) => x.startsWith('kb-data-'));
      return !!data && (await (await caches.open(data)).keys()).some((r) => r.url.includes('/api/kb/my-day'));
    }), { timeout: 15000, popis: 'uložený Můj den v service workeru' }).catch(() => false);
    expect(!!drzi, 'service worker drží poslední „Můj den"');
    await p.setOfflineMode(true);
    await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await p.waitForFunction(() => location.pathname === '/login' || document.body.innerText.includes('UKOL-NA-DNESEK'), { timeout: 20000 }).catch(() => {});
    await sleep(1000);
    const bezSite = await p.evaluate(() => ({ cesta: location.pathname, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300), token: !!JSON.parse(localStorage.getItem('pocketbase_auth') || '{}').token }));
    expect(bezSite.cesta.startsWith('/lite'), `bez sítě po obnovení zůstal v lite, ne na přihlášení (${bezSite.cesta})`);
    expect(bezSite.text.includes('UKOL-NA-DNESEK'), `a vidí poslední „Můj den" („${bezSite.text.slice(0, 120)}")`);
    expect(bezSite.token, 'přihlášení v prohlížeči zůstalo');
    // network back → the sign-in is confirmed by the server without a reload
    const overeni = [];
    p.on('response', (res) => { if (res.url().includes('/auth-refresh')) overeni.push(res.status()); });
    await p.setOfflineMode(false);
    await p.evaluate(() => window.dispatchEvent(new Event('online'))); // puppeteer's offline switch does not always fire it
    await H.waitFor(() => overeni.length > 0, { timeout: 10000, popis: 'ověření přihlášení po návratu sítě' }).catch(() => {});
    expect(overeni.includes(200), `po návratu sítě se přihlášení samo ověří u serveru (${overeni.join(',') || 'žádný dotaz'})`);
    expect(await p.evaluate(() => location.pathname.startsWith('/lite')), 'a člověk zůstává, kde byl');

    // the same at a 5xx during a deploy: the app starts on a protected page and stays there
    {
      const d = await ctx.newPage();
      await d.setViewport({ width: 1500, height: 950 });
      await d.setRequestInterception(true);
      let vypadek = true;
      d.on('request', (req) => {
        if (vypadek && req.url().includes('/api/collections/users/auth-refresh')) req.respond({ status: 502, contentType: 'application/json', body: JSON.stringify({ status: 502, message: 'Bad Gateway', data: {} }) });
        else req.continue();
      });
      await d.goto(`${inst.base}/notifications`, { waitUntil: 'networkidle2' });
      await sleep(1500);
      expect(await d.evaluate(() => location.pathname === '/notifications' && !document.querySelector('#password')), `502 na ověření přihlášení při startu: chráněná stránka zůstane, žádný formulář s heslem (${await d.evaluate(() => location.pathname)})`);
      vypadek = false;
      await d.close();
    }
    // lite quick add: the server's sentence is shown, PocketBase's English one is not (F4-07)
    if (!(await p.evaluate(() => location.pathname.startsWith('/lite')))) { // already red above; the next checks still need lite
      await p.goto(`${inst.base}/lite`, { waitUntil: 'networkidle2' });
      await p.waitForFunction(() => document.body.innerText.includes('UKOL-NA-DNESEK'), { timeout: 20000 }).catch(() => {});
    }
    await p.setRequestInterception(true);
    let odpoved = { status: 402, body: { error: 'PODVRZENA-VETA-O-ZAMKU' } };
    p.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/collections/buffer_nodes/records')) req.respond({ status: odpoved.status, contentType: 'application/json', body: JSON.stringify(odpoved.body) });
      else req.continue();
    });
    const pridej = async () => {
      await p.evaluate(() => document.querySelector('button[aria-label="Nový úkol"]').click());
      await p.waitForSelector('form input', { timeout: 8000 });
      await p.type('form input', 'Zkouska chyby');
      await p.evaluate(() => {
        const s = document.querySelector('form select');
        if (s) { s.value = [...s.options].find((o) => /zásobník/i.test(o.text)).value; s.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      await p.evaluate(() => [...document.querySelectorAll('form button')].find((x) => (x.innerText || '').trim() === 'Přidat').click());
      await p.waitForFunction(() => !!document.querySelector('form .text-destructive'), { timeout: 8000 }).catch(() => {});
      const t = await p.evaluate(() => (document.querySelector('form .text-destructive') || {}).innerText || '');
      await p.evaluate(() => document.querySelector('form button[aria-label="Nový úkol"]').click());
      await sleep(400);
      return t;
    };
    h = await pridej();
    expect(h === 'PODVRZENA-VETA-O-ZAMKU', `lite: odmítnutý zápis ukáže větu serveru („${h}")`);
    odpoved = { status: 400, body: { status: 400, message: 'Failed to create record.', data: {} } };
    h = await pridej();
    expect(h === 'Úkol se nepodařilo přidat', `lite: anglická věta PocketBase se nahradí naší („${h}")`);
    await ctx.close();
  }

  const vazne = chyby.filter((c) => !/PODVRZEN|status of 40[0-9]|ClientResponseError|User auth check failed/.test(c));
  expect(vazne.length === 0, `konzole bez nečekaných chyb (${vazne.slice(0, 2).join(' | ').slice(0, 200)})`);
}, { nazev: 'UI-CHYBY4-SPRAVA2' });
