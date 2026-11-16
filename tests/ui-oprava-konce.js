// UI e2e (headless Chrome): the end of a time entry closed by the 12 h auto-stop can be corrected in the app
// (Richard's decision 16 Nov 2026; components/time/FixEndDialog.jsx).
//
// Before: the server allowed moving such an end earlier, but the app had no form — delete the entry and type it
// again. Now the entry carries "Opravit konec" in both time lists and the "Zastavené stopky" notification
// opens the correction directly. Only earlier than the automatic stop and after the start.
//
// Real clicks; the date-and-time field is filled through the native setter (typing into datetime-local depends
// on the browser's locale). The database is read through the API.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-oprava-konce', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register('sef@example.com', { name: 'Šéf' });
  const su = await inst.superuser();
  const ST = (su && su.token) || su;
  const { browser, chyby } = await H.browser();
  const S = await E.clovek(browser, inst, 'sef@example.com', chyby);
  const { page } = S;
  const zaznam = async (id) => (await inst.api('GET', `/api/collections/time_entries/records/${id}`, { token: S.token })).json;
  const zapomenute = async (label, note) => {
    const r = await inst.api('POST', '/api/collections/time_entries/records', { token: S.token, body: { started: new Date(Date.now() - 13 * 3600000).toISOString(), ended: '', label, note } });
    const a = await inst.api('POST', '/api/flowmap/run-auto-stop', { token: ST });
    return { id: r.json.id, stopped: (a.json || {}).stopped };
  };
  const dialog = () => page.evaluate(() => {
    const el = document.querySelector('[data-testid="oprava-konce-dialog"]');
    if (!el) return null;
    const q = (id) => el.querySelector(`[data-testid="${id}"]`);
    return { nadpis: (el.querySelector('h2') || {}).innerText || '', souhrn: (q('oprava-konce-souhrn') || {}).innerText || '', cervene: /destructive/.test((q('oprava-konce-souhrn') || {}).className || ''), vypnuto: !!(q('oprava-konce-ulozit') || {}).disabled, min: q('oprava-konce-cas').min, max: q('oprava-konce-cas').max };
  });
  // fills the field with a local date-time `ms` after the entry's start
  const vypln = (startedIso, ms) => page.evaluate((iso, plus) => {
    const d = new Date(new Date(iso.replace(' ', 'T')).getTime() + plus); const p = (n) => String(n).padStart(2, '0');
    const v = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    const el = document.querySelector('[data-testid="oprava-konce-cas"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return v;
  }, startedIso, ms);
  const tlacitek = (kde = 'body') => page.evaluate((k) => document.querySelectorAll(`${k} [data-testid="opravit-konec"]`).length, kde);

  console.log('== příprava: zapomenuté stopky zavřené pojistkou + běžný záznam ==');
  const z1 = await zapomenute('zapomenuté stopky', 'telefonát s klientem');
  let r1 = await zaznam(z1.id);
  expect(z1.stopped === 1 && r1.duration_min === 720 && /auto-stop po 12 h/.test(r1.note), `pojistka zavřela záznam na 12 h (${r1.duration_min} min, „${r1.note}“)`);
  const t0 = Date.now();
  await inst.api('POST', '/api/collections/time_entries/records', { token: S.token, body: { started: new Date(t0 - 2 * 3600000).toISOString(), ended: new Date(t0 - 3600000).toISOString(), label: 'běžný záznam' } });

  console.log('== oznámení „Zastavené stopky“ otevře rovnou opravu ==');
  await page.goto(`${inst.base}/notifications`, { waitUntil: 'networkidle2' });
  const klik = await page.evaluate(() => { const el = [...document.querySelectorAll('button, [role="button"], li, div')].filter((e) => /běžely přes 12 hodin/.test(e.innerText || '')).pop(); if (el) el.click(); return !!el; });
  expect(klik, 'klik na oznámení o zastavených stopkách');
  expect(await E.cekej(async () => !!(await dialog()), 8000, 'dialog opravy'), 'otevřel se dialog „Opravit konec měření“');
  expect(/\/notifications$/.test(page.url()), `oznámení nikam neodvedlo (${page.url()})`);
  let d = await dialog();
  expect(d && d.nadpis === 'Opravit konec měření', `nadpis („${d && d.nadpis}“)`);
  expect(d && d.vypnuto, 'bez zadaného času nejde uložit');
  expect(d && d.min && d.max && d.min < d.max, `pole má meze začátek–automatické zastavení (${d && d.min} … ${d && d.max})`);
  await page.screenshot({ path: `${process.env.KB_SNIMKY || '/tmp'}/oprava-konce.png` }).catch(() => {});

  console.log('== později než automatické zastavení nejde, dřív ano ==');
  await vypln(r1.started, 12.5 * 3600000);
  d = await dialog();
  expect(d.vypnuto && d.cervene && /dřív než automatické zastavení/.test(d.souhrn), `konec po automatickém zastavení: uložit nejde, pravidlo červeně („${d.souhrn}“)`);
  await vypln(r1.started, -3600000);
  d = await dialog();
  expect(d.vypnuto && d.cervene, 'konec před začátkem: uložit nejde');
  await vypln(r1.started, 3 * 3600000);
  d = await dialog();
  expect(!d.vypnuto && !d.cervene && /Celkem 3 h 0 min/.test(d.souhrn), `konec 3 h po začátku: dialog ukazuje novou délku („${d.souhrn}“)`);
  await page.screenshot({ path: `${process.env.KB_SNIMKY || '/tmp'}/oprava-konce-vyplneno.png` }).catch(() => {});
  await page.click('[data-testid="oprava-konce-ulozit"]');
  expect(await E.cekej(async () => !(await dialog()), 8000, 'dialog zavřený'), 'uložení dialog zavře');
  r1 = await zaznam(z1.id);
  expect(r1.duration_min === 180, `záznam má v databázi 3 hodiny (${r1.duration_min} min)`);
  expect(r1.note === 'telefonát s klientem', `poznámka zůstala, značka pojistky zmizela („${r1.note}“)`);
  expect(await E.cekej(async () => (await tlacitek()) === 0, 6000, 'tlačítko pryč'), 'opravený záznam už „Opravit konec“ nenabízí');
  const text = await page.evaluate(() => (document.querySelector('[role="dialog"]') || document.body).innerText);
  expect(/3 h/.test(text) && /běžný záznam/.test(text), 'pod dialogem zůstal přehled času s opravenou délkou');

  console.log('== totéž oznámení podruhé: záznam už opravit nejde → jen přehled ==');
  await page.keyboard.press('Escape'); await sleep(600);
  await page.evaluate(() => { const el = [...document.querySelectorAll('button, [role="button"], li, div')].filter((e) => /běžely přes 12 hodin/.test(e.innerText || '')).pop(); if (el) el.click(); });
  await sleep(2500);
  expect(!(await dialog()), 'dialog opravy se znovu neotevřel');
  expect(await page.evaluate(() => /běžný záznam/.test((document.querySelector('[role="dialog"]') || {}).innerText || '')), 'otevřel se přehled času');
  await page.keyboard.press('Escape'); await sleep(600);

  console.log('== panel Měření času v mapě: tlačítko u záznamu ==');
  const z2 = await zapomenute('druhé zapomenuté', '');
  let r2 = await zaznam(z2.id);
  expect(z2.stopped === 1 && r2.duration_min === 720, `druhý záznam zavřela pojistka (${r2.duration_min} min)`);
  const A = await E.zalozMapu(inst, S.token, 'Oprava konce');
  await S.otevriMapu(A.id);
  expect(await S.klikTitulek('Měření času — záznamy a přiřazení'), 'otevřen panel Měření času');
  expect(await E.cekej(async () => (await tlacitek('[data-testid="timelog-panel"]')) === 1, 8000, 'tlačítko v panelu'), 'v panelu má „Opravit konec“ právě jeden záznam (běžný ani opravený ne)');
  await page.click('[data-testid="timelog-panel"] [data-testid="opravit-konec"]');
  expect(await E.cekej(async () => !!(await dialog()), 6000, 'dialog'), 'tlačítko otevře dialog');
  await vypln(r2.started, 90 * 60000);
  await page.keyboard.press('Tab'); await sleep(200);
  await page.click('[data-testid="oprava-konce-ulozit"]');
  expect(await E.cekej(async () => !(await dialog()), 8000, 'dialog zavřený'), 'uložení dialog zavře');
  r2 = await zaznam(z2.id);
  expect(r2.duration_min === 90 && !/auto-stop/.test(r2.note), `druhý záznam má 1 h 30 min a je bez značky (${r2.duration_min} min, „${r2.note}“)`);
  expect(await E.cekej(async () => (await tlacitek('[data-testid="timelog-panel"]')) === 0, 6000, 'tlačítko pryč'), 'tlačítko z panelu zmizelo');
  const pozdeji = await inst.api('PATCH', `/api/collections/time_entries/records/${z2.id}`, { token: S.token, body: { ended: new Date(Date.now() - 3600000).toISOString() } });
  expect(pozdeji.status === 409, `opravený záznam už je zamčený jako každý ukončený (${pozdeji.status})`);

  expect(chyby.filter((c) => !/409/.test(c)).length === 0, `konzole bez chyb (${chyby.length}: ${chyby.slice(0, 2).join(' | ')})`);
}, { nazev: 'UI-OPRAVA-KONCE' });
