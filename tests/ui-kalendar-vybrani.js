// UI e2e: Správa organizace → Sdílené kalendáře → kalendář „jen vybraní“ → VÝBĚR ČLENŮ.
//
// Hlídá (analýza kódu 3, F4-03 / F5-01): po přepnutí viditelnosti na „jen vybraní“ se
// pod kalendářem rozbalí seznam členů s checkboxem pro KAŽDÉHO člena instance a
// zaškrtnutí se uloží (API /api/kb/calendars nese `members`). Fixtura: admin + 2 členové
// přes API, kalendář založený formulářem ve Správě.
//
// MUTAČNÍ DŮKAZ: na image v0.98-beta (kb-analyza-3) sada ČERVENÁ — getMembers() vracel
// tělo { members }, KalendareSection nad ním volal .filter, výjimku spolkl .catch a
// seznam `kal-clenove-seznam-*` byl vždy PRÁZDNÝ (0 checkboxů). Přes API to šlo
// (tests/kalendare.js), proto to serverové sady nechytily.
const H = require('./_harness');
const { expect, sleep } = H;

const ADMIN = 'spravce-kal@e2e.cz';
const CLEN1 = 'clen1-kal@e2e.cz';
const CLEN2 = 'clen2-kal@e2e.cz';

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'kal-vybrani', env: { KB_UVODNI_MAPA: 0 } });
  for (const u of [ADMIN, CLEN1, CLEN2]) {
    const reg = await inst.register(u);
    expect(reg.status === 200, `účet ${u} založen (${reg.status})`);
  }
  const A = await inst.login(ADMIN); // první účet = správce
  const lide = (await inst.api('GET', '/api/kb/members', { token: A })).json;
  expect(Array.isArray(lide.members) && lide.members.length === 3, `API /members: 3 lidé (${JSON.stringify(lide).slice(0, 80)})`);

  const { page, chyby } = await H.browser();
  await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email');
  await page.type('#email', ADMIN);
  await page.type('#password', H.PW);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1000);

  console.log('== Správa organizace → Sdílené kalendáře: nový kalendář formulářem ==');
  await page.goto(`${inst.base}/admin/users?oddil=kalendare`, { waitUntil: 'networkidle2' });
  const sprava = await page.waitForSelector('[data-testid="kal-sprava"]', { visible: true, timeout: 15000 }).catch(() => null);
  expect(!!sprava, 'sekce Sdílené kalendáře je na stránce');
  await page.waitForSelector('[data-testid="kal-novy-btn"]', { timeout: 8000 });
  await page.click('[data-testid="kal-novy-btn"]');
  await page.waitForSelector('[data-testid="kal-novy-nazev"]', { timeout: 5000 });
  await page.type('[data-testid="kal-novy-nazev"]', 'Vedení');
  await page.click('[data-testid="kal-novy-ulozit"]');
  const kalendare = async () => ((await inst.api('GET', '/api/kb/calendars', { token: A })).json.calendars || []);
  await H.waitFor(async () => (await kalendare()).some((c) => c.name === 'Vedení'), { timeout: 8000, popis: 'Vedení v API' }).catch(() => {});
  const vedeni = (await kalendare()).find((c) => c.name === 'Vedení');
  expect(!!vedeni && vedeni.visibility === 'all', `kalendář Vedení založen, výchozí viditelnost celý tým (${JSON.stringify(vedeni && vedeni.visibility)})`);
  if (!vedeni) return;
  const ID = vedeni.id;

  console.log('== „Kdo vidí“ → jen vybraní: rozbalí se seznam členů s checkboxy ==');
  await page.waitForSelector(`[data-testid="kal-viditelnost-${ID}"]`, { timeout: 8000 });
  await page.click(`[data-testid="kal-viditelnost-${ID}"]`); // Radix Select: skutečný klik otevře nabídku
  await page.waitForSelector('[role="option"]', { visible: true, timeout: 5000 });
  const volby = await page.$$eval('[role="option"]', (els) => els.map((e) => (e.textContent || '').trim()));
  expect(volby.includes('jen vybraní'), `nabídka viditelnosti: ${JSON.stringify(volby)}`);
  for (const o of await page.$$('[role="option"]')) {
    if ((await page.evaluate((el) => (el.textContent || '').trim(), o)) === 'jen vybraní') { await o.click(); break; }
  }
  // Radix Select drží body { pointer-events: none }, dokud nabídka nedoběhne zavírací animaci —
  // klik v tu chvíli propadne (první verze sady tak „ztratila“ první checkbox)
  await page.waitForFunction(() => !document.querySelector('[role="listbox"]') && document.body.style.pointerEvents !== 'none', { timeout: 8000 }).catch(() => {});
  await H.waitFor(async () => ((await kalendare()).find((c) => c.id === ID) || {}).visibility === 'members', { timeout: 8000, popis: 'viditelnost members v API' }).catch(() => {});
  expect(((await kalendare()).find((c) => c.id === ID) || {}).visibility === 'members', 'API: viditelnost = members');
  const seznam = await page.waitForSelector(`[data-testid="kal-clenove-seznam-${ID}"]`, { visible: true, timeout: 8000 }).catch(() => null);
  expect(!!seznam, 'seznam členů se po přepnutí rozbalil');
  // ⭐ jádro F4-03: seznam NESMÍ být prázdný — checkbox pro každého člena instance
  await page.waitForSelector(`[data-testid="kal-clen-${ID}-${CLEN1}"]`, { timeout: 5000 }).catch(() => {});
  const checkboxy = await page.$$eval(`[data-testid="kal-clenove-seznam-${ID}"] input[type="checkbox"]`, (els) => els.map((e) => e.getAttribute('data-testid')));
  expect(checkboxy.length === 3, `seznam má checkbox pro každého ze 3 lidí (${checkboxy.length}: ${JSON.stringify(checkboxy)})`);
  expect(checkboxy.includes(`kal-clen-${ID}-${CLEN1}`) && checkboxy.includes(`kal-clen-${ID}-${CLEN2}`), 'oba členové mají svůj checkbox');
  expect(/vybraní členové: 0/.test(await page.$eval(`[data-testid="kal-clenove-${ID}"]`, (el) => el.textContent).catch(() => '')), 'před výběrem: „vybraní členové: 0“');

  console.log('== zaškrtnutí obou členů se uloží (API members) ==');
  const clenoveApi = async () => (((await kalendare()).find((c) => c.id === ID) || {}).members || []).slice().sort();
  // checkboxy jsou během ukládání (a následného načtení tabulky) disabled — klik v tu chvíli propadne
  const klikClen = async (email) => {
    await H.waitFor(() => page.$eval(`[data-testid="kal-clen-${ID}-${email}"]`, (el) => !el.disabled).catch(() => false), { timeout: 8000, popis: 'checkbox aktivní' });
    await page.click(`[data-testid="kal-clen-${ID}-${email}"]`);
  };
  const chyba = async () => (await page.$eval('[data-testid="kal-chyba"]', (el) => el.textContent).catch(() => ''));
  await klikClen(CLEN1);
  await H.waitFor(async () => (await clenoveApi()).includes(CLEN1), { timeout: 8000, popis: 'člen 1 v API' }).catch(() => {});
  expect(JSON.stringify(await clenoveApi()) === JSON.stringify([CLEN1]), `po prvním kliku API members = [clen1] (${JSON.stringify(await clenoveApi())}${await chyba() ? ', chyba v UI: ' + await chyba() : ''})`);
  // po uložení se tabulka načte znovu — checkbox musí zůstat zaškrtnutý a seznam otevřený
  await H.waitFor(() => page.$eval(`[data-testid="kal-clen-${ID}-${CLEN1}"]`, (el) => el.checked && !el.disabled).catch(() => false), { timeout: 8000, popis: 'checkbox 1 zaškrtnutý' }).catch(() => {});
  expect(await page.$eval(`[data-testid="kal-clen-${ID}-${CLEN1}"]`, (el) => el.checked).catch(() => false), 'checkbox člena 1 je po uložení zaškrtnutý');
  await klikClen(CLEN2);
  await H.waitFor(async () => (await clenoveApi()).includes(CLEN2), { timeout: 8000, popis: 'člen 2 v API' }).catch(() => {});
  expect(JSON.stringify(await clenoveApi()) === JSON.stringify([CLEN1, CLEN2].sort()), `po druhém kliku API members = oba členové (${JSON.stringify(await clenoveApi())})`);
  await H.waitFor(() => page.$eval(`[data-testid="kal-clenove-${ID}"]`, (el) => /vybraní členové: 2/.test(el.textContent)).catch(() => false), { timeout: 8000, popis: 'počet 2 v tlačítku' }).catch(() => {});
  expect(/vybraní členové: 2/.test(await page.$eval(`[data-testid="kal-clenove-${ID}"]`, (el) => el.textContent).catch(() => '')), 'tlačítko ukazuje „vybraní členové: 2“');
  // odškrtnutí odebere
  await klikClen(CLEN1);
  await H.waitFor(async () => !(await clenoveApi()).includes(CLEN1), { timeout: 8000, popis: 'člen 1 odebrán' }).catch(() => {});
  expect(JSON.stringify(await clenoveApi()) === JSON.stringify([CLEN2]), `odškrtnutí člena 1 → API members = [clen2] (${JSON.stringify(await clenoveApi())})`);

  console.log('== vybraný člen kalendář vidí, nevybraný ne (parita se serverem) ==');
  const C1 = await inst.login(CLEN1);
  const C2 = await inst.login(CLEN2);
  expect(!((await inst.api('GET', '/api/kb/calendars', { token: C1 })).json.calendars || []).some((c) => c.id === ID), 'nevybraný člen 1 kalendář Vedení nevidí');
  expect(((await inst.api('GET', '/api/kb/calendars', { token: C2 })).json.calendars || []).some((c) => c.id === ID), 'vybraný člen 2 kalendář Vedení vidí');

  expect(chyby.length === 0, `konzole bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 160) : ''})`);
}, { nazev: 'UI-KALENDAR-VYBRANI' });
