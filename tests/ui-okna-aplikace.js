// UI e2e (headless Chrome, own temporary profile): confirmations and notices are dialogs of the
// app, not the browser's own windows (Richard's decision 15 Nov 2026; lib/appDialogs.js).
//
// Before: window.confirm / window.alert on 38 places — a foreign-looking window with the page
// address, different on every platform. Now one dialog: "Zrušit" + a red "Smazat" for deleting,
// "Potvrdit" for other questions, "Rozumím" for a notice; Escape and Cancel mean no.
//
// Real clicks and key presses; the dialogs are answered BY HAND here (the helper's automatic
// "yes" is switched off). The database is read through the API.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-okna-aplikace', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register('sef@example.com', { name: 'Šéf' });
  const { browser, chyby } = await H.browser();
  const S = await E.clovek(browser, inst, 'sef@example.com', chyby, { appDialogy: false });
  const { page } = S;
  const nativni = [];
  page.on('dialog', (d) => { if (d.type() !== 'beforeunload') nativni.push(`${d.type()}: ${d.message()}`); });
  const db = (id) => E.mapaZDb(inst, S.token, id);
  const okno = () => page.evaluate(() => {
    const el = document.querySelector('[data-testid="potvrzeni-dialog"][data-state="open"], [data-testid="oznameni-dialog"][data-state="open"]');
    if (!el) return null;
    const b = (id) => { const x = el.querySelector(`[data-testid="${id}"]`); return x ? { text: (x.innerText || '').trim(), cls: x.className } : null; };
    return { druh: el.getAttribute('data-testid'), nadpis: (el.querySelector('h2') || {}).innerText || '', text: (el.querySelector('[data-testid="potvrzeni-text"]') || {}).innerText || '', ano: b('potvrzeni-ano'), ne: b('potvrzeni-ne'), ok: b('oznameni-ok'), fokus: (document.activeElement || {}).getAttribute ? document.activeElement.getAttribute('data-testid') : '' };
  });
  const cekejOkno = () => E.cekej(async () => !!(await okno()), 6000, 'okno aplikace');
  const cekejZavreno = () => E.cekej(async () => !(await okno()), 6000, 'okno zavřené');
  const teloKlikaci = () => page.evaluate(() => getComputedStyle(document.body).pointerEvents !== 'none');

  console.log('== smazání kroku v mapě: okno aplikace, Zrušit nic nesmaže ==');
  const A = await E.zalozMapu(inst, S.token, 'Okna aplikace');
  await S.otevriMapu(A.id);
  expect(await S.akceUzlu('k1', 'Smazat'), 'klik na koš kroku k1');
  expect(await cekejOkno(), 'otevřelo se okno aplikace');
  let o = await okno();
  expect(o && o.druh === 'potvrzeni-dialog' && /Krok jedna/.test(o.text), `okno jmenuje krok („${o && o.text}“)`);
  expect(o && o.ano && o.ano.text === 'Smazat' && /destructive/.test(o.ano.cls), `potvrzovací tlačítko je červené „Smazat“ („${o && o.ano && o.ano.text}“)`);
  expect(o && o.ne && o.ne.text === 'Zrušit', 'vedle je „Zrušit“');
  expect(o && o.nadpis === 'Opravdu smazat?', `nadpis okna („${o && o.nadpis}“)`);
  expect(nativni.length === 0, `žádné systémové okno prohlížeče (${nativni.length})`);
  await page.screenshot({ path: `${process.env.KB_SNIMKY || '/tmp'}/okno-smazat.png` }).catch(() => {});
  await page.click('[data-testid="potvrzeni-ne"]');
  expect(await cekejZavreno(), '„Zrušit“ okno zavře');
  await sleep(1800);
  expect(!!E.uzel(await db(A.id), 'k1') && (await S.uzlyNaPlatne()).length === 3, 'krok k1 po „Zrušit“ zůstal na plátně i v databázi');

  console.log('== Escape = ne ==');
  expect(await S.akceUzlu('k1', 'Smazat'), 'klik na koš kroku k1 podruhé');
  expect(await cekejOkno(), 'okno aplikace');
  await page.keyboard.press('Escape');
  expect(await cekejZavreno(), 'Escape okno zavře');
  await sleep(1800);
  expect(!!E.uzel(await db(A.id), 'k1'), 'krok k1 po Escape zůstal');
  expect(await teloKlikaci(), 'stránka je po zavření dál klikací');

  console.log('== Smazat = ano; Enter potvrzuje jako dřív ==');
  expect(await S.akceUzlu('k1', 'Smazat'), 'klik na koš kroku k1 potřetí');
  expect(await cekejOkno(), 'okno aplikace');
  expect((await okno()).fokus === 'potvrzeni-ano', `fokus je na potvrzovacím tlačítku (${(await okno()).fokus})`);
  await page.keyboard.press('Enter');
  expect(await cekejZavreno(), 'Enter okno zavře');
  expect(await E.cekej(async () => !E.uzel(await db(A.id), 'k1'), 10000, 'k1 pryč'), 'krok k1 je smazaný i v databázi');
  expect(await S.klikTitulek('Vrátit zpět'), 'Zpět po smazání funguje dál');
  expect(await E.cekej(async () => !!E.uzel(await db(A.id), 'k1'), 10000, 'k1 zpět'), 'krok k1 je zpátky');

  console.log('== otázka, která není mazání: neutrální „Potvrdit“ ==');
  expect(await S.akceUzlu('k2', 'Do zásobníku') || await S.akceUzlu('k2', 'Odložit'), 'klik „do zásobníku“ u kroku k2');
  expect(await cekejOkno(), 'okno aplikace');
  o = await okno();
  expect(o && o.ano && o.ano.text === 'Potvrdit' && !/destructive/.test(o.ano.cls), `neutrální tlačítko „Potvrdit“ („${o && o.ano && o.ano.text}“)`);
  expect(o && o.nadpis === 'Potvrzení', `nadpis („${o && o.nadpis}“)`);
  await page.click('[data-testid="potvrzeni-ne"]');
  expect(await cekejZavreno(), 'zavřeno');
  await sleep(1500);
  expect(!!E.uzel(await db(A.id), 'k2'), 'krok k2 zůstal v mapě');

  console.log('== otázka z okna pod lištou (Klienti): okno, ze kterého se ptám, zůstane otevřené ==');
  // Dialogs opened from the user menu are non-modal; the app's question on top of them is "outside"
  // for them and used to close them — also on Cancel.
  const kl = await inst.api('POST', '/api/collections/clients/records', { token: S.token, body: { name: 'Klient Okno' } });
  expect(kl.status === 200, `klient založen přes API (${kl.status})`);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('kb-otevri-klienty', { detail: {} })));
  const klienti = () => page.evaluate(() => [...document.querySelectorAll('[role="dialog"][data-state="open"]')].some((d) => !d.getAttribute('data-testid') && /Klient Okno/.test(d.innerText || '')));
  expect(await E.cekej(klienti, 8000, 'okno Klienti'), 'otevřelo se okno Klienti s klientem');
  const kos = () => page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"][data-state="open"]')].find((x) => /Klient Okno/.test(x.innerText || '')); const b = d && [...d.querySelectorAll('button[title="Smazat"]')].pop(); if (b) b.setAttribute('data-kos-test', '1'); return !!b; });
  expect(await kos(), 'koš u klienta');
  await page.click('[data-kos-test="1"]');
  expect(await cekejOkno(), 'okno aplikace s otázkou');
  await sleep(600);
  expect(await klienti(), 'okno Klienti pod otázkou zůstalo otevřené');
  await page.click('[data-testid="potvrzeni-ne"]');
  expect(await cekejZavreno(), '„Zrušit“ otázku zavře');
  await sleep(800);
  expect(await klienti(), 'po „Zrušit“ je okno Klienti dál otevřené a klient v něm');
  expect(await kos(), 'koš u klienta podruhé');
  await page.click('[data-kos-test="1"]');
  expect(await cekejOkno(), 'okno aplikace podruhé');
  await page.click('[data-testid="potvrzeni-ano"]');
  expect(await cekejZavreno(), '„Smazat“ otázku zavře');
  expect(await E.cekej(async () => page.evaluate(() => [...document.querySelectorAll('[role="dialog"][data-state="open"]')].some((d) => /Klienti/.test((d.querySelector('h2') || {}).innerText || '') && !/Klient Okno/.test(d.innerText || ''))), 8000, 'klient pryč, okno otevřené'), 'po „Smazat“ klient zmizel a okno Klienti zůstalo otevřené');
  await page.keyboard.press('Escape'); await sleep(600);

  console.log('== oznámení: jedno tlačítko „Rozumím“ ==');
  await inst.register('clen@example.com', { name: 'Člen' });
  await page.goto(`${inst.base}/admin/users`, { waitUntil: 'networkidle2' });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (r.method() === 'GET' && /\/api\/kb\/users\/[^/]+\/maps/.test(r.url())) r.respond({ status: 500, contentType: 'application/json', body: '{"message":"PODVRH"}' });
    else r.continue();
  });
  await page.waitForSelector('[data-testid="akce-clen@example.com"]', { timeout: 15000 });
  await page.click('[data-testid="akce-clen@example.com"]');
  await page.waitForSelector('[data-testid="smazat-clen@example.com"]', { timeout: 5000 });
  await page.click('[data-testid="smazat-clen@example.com"]');
  expect(await cekejOkno(), 'okno aplikace s oznámením');
  o = await okno();
  expect(o && o.druh === 'oznameni-dialog' && /Nepodařilo se zjistit/.test(o.text), `oznámení říká, co se nepovedlo („${o && o.text.slice(0, 70)}“)`);
  expect(o && o.ok && o.ok.text === 'Rozumím' && !o.ano && !o.ne, 'jediné tlačítko „Rozumím“');
  await page.screenshot({ path: `${process.env.KB_SNIMKY || '/tmp'}/okno-oznameni.png` }).catch(() => {});
  await page.click('[data-testid="oznameni-ok"]');
  expect(await cekejZavreno(), '„Rozumím“ okno zavře');
  expect(await teloKlikaci(), 'stránka je dál klikací');
  expect(nativni.length === 0, `za celou sadu žádné systémové okno prohlížeče (${JSON.stringify(nativni).slice(0, 200)})`);

  expect(chyby.filter((c) => !/500|PODVRH/.test(c)).length === 0, `konzole bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 140) : ''})`);
}, { nazev: 'UI-OKNA-APLIKACE' });
