// UI e2e: KALENDÁŘ v2 na stránce Úkoly (v0.60-beta) — dodávka z externího nástroje (Měsíc/Týden/
// Den/Agenda, postranní panel) + přetažení termínu s potvrzením (z feat/kalendar).
//
// Hlídá: /tasks?view=calendar otevře kalendář; chipy uzlů; hotový chip se netáhne;
// přetažení vlastníkem → dialog „Změnit termín z X na Y?“ → Zrušit nic nezmění,
// Potvrdit zapíše termín (API) a chip je v cílovém dni, Vrátit v hlášce vrátí zpět;
// Týden: tažení karty do jiného sloupce otevře dialog; klávesa w při otevřeném
// dialogu nepřepne pohled; SBALENÝ PANEL NESCHOVÁ MŘÍŽKU (chyba z dodávky);
// šířka 800 px = mřížka vidět; MOBIL 390 px: Měsíc = tečky bez vodorovného přetoku, klepnutí na den = detail,
// Týden = svislý seznam dnů s hlavičkou; řešitel bez práva → dialog žádosti → API nese
// žádost, termín beze změny → Vrátit žádost zruší.
//
// Fixtura přes API: projekt se 4 cíli (včera, +2, +10, hotový +5), sdílený řešiteli (work).
// MUTAČNÍ DŮKAZ: na image z main sada ČERVENÁ — .gcal-wrapper ani kal-dialog-termin neexistují.
const H = require('./_harness');
const { expect, sleep } = H;

const VLASTNIK = 'kal@e2e.cz';
const RESITEL = 'resitel-kal@e2e.cz';
const den = (posun) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + posun);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'kalendar', env: { KB_UVODNI_MAPA: 0 } });
  for (const u of [VLASTNIK, RESITEL]) {
    const reg = await inst.register(u);
    expect(reg.status === 200, `účet ${u} založen (${reg.status})`);
  }
  const V = await inst.login(VLASTNIK);
  const W = await inst.login(RESITEL);

  const mapa = (await inst.api('POST', '/api/collections/goalmaps/records', { token: V, body: {
    title: 'Rozjezd kavárny',
    nodes: [
      { id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'ROZJEZD KAVÁRNY', title: 'ROZJEZD KAVÁRNY', status: 'todo' } },
      { id: 'n1', type: 'goalNode', position: { x: 0, y: 380 }, data: { title: 'Zpožděná kolaudace', status: 'todo', deadline: den(-1), owner: VLASTNIK } },
      { id: 'n2', type: 'goalNode', position: { x: 250, y: 380 }, data: { title: 'Ochutnávka pro sousedy', status: 'in_progress', deadline: den(2), owner: RESITEL } },
      { id: 'n3', type: 'goalNode', position: { x: 500, y: 380 }, data: { title: 'Budoucí otevření', status: 'todo', deadline: den(10), owner: VLASTNIK } },
      { id: 'n4', type: 'goalNode', position: { x: 750, y: 380 }, data: { title: 'Hotové vybavení', status: 'done', deadline: den(5), owner: VLASTNIK } },
    ],
    edges: [
      { id: 'e1', source: 'apex', target: 'n1' }, { id: 'e2', source: 'apex', target: 'n2' },
      { id: 'e3', source: 'apex', target: 'n3' }, { id: 'e4', source: 'apex', target: 'n4' },
    ],
  } })).json;
  expect(!!mapa.id, 'projekt s termíny založen');
  const sdileni = await inst.api('POST', '/api/kb/share', { token: V, body: { action: 'share', mapId: mapa.id, email: RESITEL, permission: 'work' } });
  expect(sdileni.status === 200, `projekt sdílen řešiteli (${sdileni.status})`);
  const uzel = async (id, token = V) => ((await inst.api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token })).json?.nodes || []).find((n) => n.id === id);

  const { page, chyby, novaStranka } = await H.browser();
  const prihlas = async (pg, email) => {
    await pg.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
    await pg.waitForSelector('#email');
    await pg.type('#email', email);
    await pg.type('#password', H.PW);
    await Promise.all([pg.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), pg.click('button[type="submit"]')]);
    await sleep(1000);
  };
  const otevriKalendar = async (pg) => {
    await pg.goto(`${inst.base}/tasks?view=calendar`, { waitUntil: 'networkidle2' });
    await pg.waitForSelector('.gcal-wrapper', { timeout: 15000 });
    // fáze 2 načtení map (uzly) — teprve pak jsou chipy tažitelné
    await pg.waitForFunction(() => !!document.querySelector('[data-testid^="gcal-chip-"][data-tazitelny="true"]'), { timeout: 15000 }).catch(() => {});
    await sleep(600);
  };
  const stred = async (pg, sel) => pg.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
  }, sel);
  const chipSel = (text) => `[data-testid^="gcal-chip-"][title^="${text}"]`;
  // spike DnD (7. 9. 2026): pohyb ≥ 6 px aktivuje MouseSensor, pak plynule na cíl
  const tahni = async (pg, zSel, doSel) => {
    // cíl doprostřed okna: u spodního okraje stránka při tahu sama roluje (auto-scroll)
    // a myš držená na místě pak pustí o řádek níž — 17. 9. 2026 „dnes+4“ = 4. řádek
    // září, drop přistál na 28. 9. místo 21. 9. (změřeno: posun 128 px během tahu)
    await pg.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), doSel);
    await sleep(300);
    const z = await stred(pg, zSel);
    const c = await stred(pg, doSel);
    if (!z || !c) return false;
    await pg.mouse.move(z.x, z.y);
    await pg.mouse.down();
    await pg.mouse.move(z.x + 10, z.y + 4, { steps: 3 });
    await sleep(80);
    await pg.mouse.move(c.x, c.y, { steps: 12 });
    await sleep(200);
    await pg.mouse.up();
    await sleep(700);
    return true;
  };
  const klikText = async (pg, text, sel = 'button') => {
    for (const h of await pg.$$(sel)) {
      if ((await pg.evaluate((el) => (el.textContent || '').trim(), h)) === text) { await h.click(); await sleep(600); return true; }
    }
    return false;
  };
  const dialogJe = (pg, rezim) => pg.$(`[data-testid="kal-dialog-${rezim}"]`).then((h) => !!h);

  console.log('== vlastník: /tasks?view=calendar otevře kalendář v2 ==');
  await prihlas(page, VLASTNIK);
  await otevriKalendar(page);
  expect(!!(await page.$('.gcal-wrapper')), 'kalendář v2 (.gcal-wrapper) je na stránce');
  expect((await page.$$('.gcal-month-cell')).length === 42, `mřížka měsíce má 42 buněk (${(await page.$$('.gcal-month-cell')).length})`);
  const telo = await page.evaluate(() => document.body.innerText);
  for (const cil of ['Ochutnávka pro sousedy', 'Hotové vybavení']) expect(telo.includes(cil), `cíl „${cil}“ je v kalendáři`);
  const hotovy = await page.$(chipSel('Hotové vybavení'));
  expect(!!hotovy && (await page.evaluate((el) => el.dataset.tazitelny, hotovy)) === 'false', 'hotový chip se netáhne (data-tazitelny=false)');
  const n2chip = await page.$(chipSel('Ochutnávka pro sousedy'));
  expect(!!n2chip && (await page.evaluate((el) => el.dataset.tazitelny, n2chip)) === 'true', 'nehotový chip vlastníka je tažitelný');
  // týdenní karta nemá title, ale sdílí data-testid (gcal-chip-<klíč položky>) s měsíčním chipem
  const n2Testid = n2chip ? await page.evaluate((el) => el.dataset.testid, n2chip) : '';

  console.log('== přetažení → dialog „Změnit termín“ → Zrušit = beze změny ==');
  const CIL = den(4);
  expect(await tahni(page, chipSel('Ochutnávka pro sousedy'), `[data-testid="gcal-den-${CIL}"]`), 'tažení chipu na jiný den proběhlo');
  expect(await dialogJe(page, 'termin'), 'otevřel se dialog změny termínu (kal-dialog-termin)');
  const textDialogu = await page.evaluate(() => document.querySelector('[data-testid="kal-dialog-termin"]')?.innerText || '');
  expect(/Změnit termín/.test(textDialogu) && textDialogu.includes(String(Number(CIL.slice(8)))), `dialog se ptá „Změnit termín z X na Y?“ (${textDialogu.split('\n')[0]})`);
  expect(await klikText(page, 'Zrušit'), 'Zrušit v dialogu');
  expect(!(await dialogJe(page, 'termin')), 'dialog po Zrušit zmizel');
  expect((await uzel('n2'))?.data?.deadline === den(2), 'API: termín po Zrušit beze změny');

  console.log('== přetažení → Potvrdit = termín zapsán, chip v cílovém dni; Vrátit ==');
  await tahni(page, chipSel('Ochutnávka pro sousedy'), `[data-testid="gcal-den-${CIL}"]`);
  expect(await dialogJe(page, 'termin'), 'dialog znovu otevřen');
  await page.click('[data-testid="kal-dialog-potvrdit"]');
  await H.waitFor(async () => (await uzel('n2'))?.data?.deadline === CIL, { timeout: 8000, popis: 'zápis termínu' }).catch(() => {});
  expect((await uzel('n2'))?.data?.deadline === CIL, `API: termín změněn na ${CIL}`);
  await sleep(800);
  expect(!!(await page.$(`[data-testid="gcal-den-${CIL}"] ${chipSel('Ochutnávka pro sousedy')}`)), 'chip je v cílovém dni');
  const vratit = await page.waitForSelector('[data-testid="kal-vratit"]', { timeout: 8000 }).catch(() => null);
  expect(!!vratit, 'hláška nabízí Vrátit');
  if (vratit) await vratit.click();
  await H.waitFor(async () => (await uzel('n2'))?.data?.deadline === den(2), { timeout: 8000, popis: 'vrácení termínu' }).catch(() => {});
  expect((await uzel('n2'))?.data?.deadline === den(2), 'API: Vrátit vrátilo původní termín');
  await sleep(800);
  expect(!!(await page.$(`[data-testid="gcal-den-${den(2)}"] ${chipSel('Ochutnávka pro sousedy')}`)), 'chip je zpět v původním dni');

  console.log('== hotový chip: tažení nic neotevře ==');
  await tahni(page, chipSel('Hotové vybavení'), `[data-testid="gcal-den-${CIL}"]`);
  expect(!(await dialogJe(page, 'termin')), 'hotový chip neotevřel dialog');
  expect((await uzel('n4'))?.data?.deadline === den(5), 'API: hotový uzel beze změny');

  console.log('== klávesa w při otevřeném dialogu nepřepne pohled ==');
  await tahni(page, chipSel('Ochutnávka pro sousedy'), `[data-testid="gcal-den-${CIL}"]`);
  expect(await dialogJe(page, 'termin'), 'dialog otevřen');
  await page.keyboard.press('w');
  await sleep(400);
  expect(!!(await page.$('.gcal-month-view')), 'pohled zůstal Měsíc (w se v dialogu ignoruje)');
  await page.keyboard.press('Escape');
  await sleep(500);
  expect(!(await dialogJe(page, 'termin')), 'Esc dialog zavřel');

  console.log('== Týden: tažení karty do jiného sloupce → dialog ==');
  expect(await klikText(page, 'Týden', '.gcal-view-btn'), 'přepnuto na Týden');
  let sloupce = await page.$$('.gcal-week-column');
  expect(sloupce.length === 7, `týden má 7 sloupců (${sloupce.length})`);
  // n2 (dnes+2) může být v příštím týdnu → posunout
  const kartaSel = `.gcal-week-column [data-testid="${n2Testid}"]`;
  let karta = await page.$(kartaSel);
  if (!karta) { await page.click('[aria-label="Další týden"]'); await sleep(700); karta = await page.$(kartaSel); }
  expect(!!karta, 'karta n2 je v týdenním pohledu');
  const jinySloupec = await page.evaluate((sel) => {
    const cols = [...document.querySelectorAll('.gcal-week-column')];
    const vlastni = cols.find((c) => c.querySelector(sel));
    const jiny = cols.find((c) => c !== vlastni);
    return jiny ? jiny.dataset.testid : null;
  }, `[data-testid="${n2Testid}"]`);
  expect(!!jinySloupec, 'našel se jiný sloupec jako cíl');
  if (jinySloupec) await tahni(page, kartaSel, `[data-testid="${jinySloupec}"]`);
  expect(await dialogJe(page, 'termin'), 'tažení v Týdnu otevřelo dialog změny termínu');
  await klikText(page, 'Zrušit');
  expect((await uzel('n2'))?.data?.deadline === den(2), 'API: po Zrušit v Týdnu beze změny');
  await klikText(page, 'Měsíc', '.gcal-view-btn');

  console.log('== sbalený postranní panel NESCHOVÁ mřížku (chyba z dodávky) ==');
  const sirkaMrizky = () => page.evaluate(() => (document.querySelector('.gcal-month-grid')?.getBoundingClientRect().width) || 0);
  const pred = await sirkaMrizky();
  await page.click('.gcal-sidebar-toggle');
  await sleep(500);
  expect(!(await page.$('.gcal-sidebar')), 'panel je sbalený');
  const po = await sirkaMrizky();
  expect(po > 600 && po >= pred, `mřížka měsíce je po sbalení vidět a širší (${Math.round(pred)} → ${Math.round(po)} px)`);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.gcal-wrapper', { timeout: 15000 });
  await sleep(600);
  expect(!(await page.$('.gcal-sidebar')) && (await sirkaMrizky()) > 600, 'po reloadu (uložený stav) je panel sbalený a mřížka vidět');
  await page.click('.gcal-sidebar-toggle');
  await sleep(500);
  expect(!!(await page.$('.gcal-sidebar')), 'panel se dá znovu rozbalit');

  console.log('== šířka 800 px: panel skrytý, mřížka vidět ==');
  await page.setViewport({ width: 800, height: 900 });
  await sleep(600);
  const uzke = await page.evaluate(() => ({
    panel: (() => { const el = document.querySelector('.gcal-sidebar'); return el ? el.offsetParent !== null : false; })(),
    mrizka: document.querySelector('.gcal-month-grid')?.getBoundingClientRect().width || 0,
  }));
  expect(!uzke.panel && uzke.mrizka > 600, `při 800 px panel skrytý, mřížka ${Math.round(uzke.mrizka)} px`);
  await page.setViewport({ width: 1400, height: 900 });
  await sleep(400);

  console.log('== MOBIL 390 px: Měsíc na šířku displeje (tečky), klepnutí na den = detail; Týden = svislý seznam ==');
  const mob = await H.browser({ mobil: true });
  await prihlas(mob.page, VLASTNIK);
  await otevriKalendar(mob.page);
  const mereni = () => mob.page.evaluate(() => {
    const pane = document.querySelector('.gcal-content-pane');
    const chips = [...document.querySelectorAll('.gcal-month-cell [data-testid^="gcal-chip-"]')];
    return {
      pretece: pane ? pane.scrollWidth - pane.clientWidth : -1,
      bunek: document.querySelectorAll('.gcal-month-cell').length,
      sirkaMrizky: document.querySelector('.gcal-month-grid')?.getBoundingClientRect().width || 0,
      maxChip: Math.max(0, ...chips.map((c) => c.getBoundingClientRect().width)),
      okno: window.innerWidth,
    };
  });
  const m1 = await mereni();
  expect(m1.bunek === 42 && m1.pretece <= 1, `Měsíc na mobilu nepřetéká vodorovně (přetok ${m1.pretece} px, okno ${m1.okno})`);
  expect(m1.sirkaMrizky > 300 && m1.sirkaMrizky <= m1.okno, `mřížka měsíce zabírá šířku displeje (${Math.round(m1.sirkaMrizky)} px)`);
  expect(m1.maxChip > 0 && m1.maxChip <= 12, `štítky jsou na mobilu tečky (nejširší ${Math.round(m1.maxChip)} px)`);
  await mob.page.click(`[data-testid="gcal-den-${den(2)}"]`);
  await sleep(500);
  const modalText = await mob.page.evaluate(() => document.querySelector('.gcal-day-modal')?.innerText || '');
  expect(modalText.includes('Ochutnávka pro sousedy'), 'klepnutí na den s termínem otevřelo detail dne s položkou');
  const modalRect = await mob.page.evaluate(() => { const r = document.querySelector('.gcal-day-modal').getBoundingClientRect(); return { l: r.left, r: r.right, w: window.innerWidth }; });
  expect(modalRect.l >= 0 && modalRect.r <= modalRect.w, `detail dne se vejde na displej (${Math.round(modalRect.l)}–${Math.round(modalRect.r)} z ${modalRect.w} px)`);
  await mob.page.click('.gcal-modal-close-btn');
  await sleep(400);
  expect(!(await mob.page.$('.gcal-day-modal')), 'tlačítko Zavřít detail dne zavřelo');
  // regrese: obal tažení nesmí přepsat inline barvy štítku (--event-color)
  const barvaTecky = await mob.page.evaluate(() => getComputedStyle(document.querySelector(`[data-testid="gcal-den-${document.querySelector('.gcal-month-cell [data-testid^="gcal-chip-"]').closest('[data-testid^="gcal-den-"]').dataset.testid.slice(9)}"] [data-testid^="gcal-chip-"]`)).backgroundColor);
  expect(barvaTecky && barvaTecky !== 'rgba(0, 0, 0, 0)', `tečka má barvu stavu (${barvaTecky})`);
  expect(await klikText(mob.page, 'Týden', '.gcal-view-btn'), 'mobil: přepnuto na Týden');
  const w = await mob.page.evaluate(() => {
    const pane = document.querySelector('.gcal-content-pane');
    const cols = [...document.querySelectorAll('.gcal-week-column')];
    return {
      pretece: pane ? pane.scrollWidth - pane.clientWidth : -1,
      sloupcu: cols.length,
      minSirka: Math.min(...cols.map((c) => c.getBoundingClientRect().width)),
      hlavicek: [...document.querySelectorAll('.gcal-week-col-day')].filter((e) => e.offsetParent !== null).length,
      okno: window.innerWidth,
    };
  });
  expect(w.sloupcu === 7 && w.pretece <= 1, `Týden na mobilu nepřetéká (přetok ${w.pretece} px)`);
  expect(w.minSirka > 300, `dny v týdnu jsou pod sebou na celou šířku (nejužší ${Math.round(w.minSirka)} px z ${w.okno})`);
  expect(w.hlavicek === 7, `každý den v týdnu má na mobilu vlastní hlavičku (${w.hlavicek}/7)`);
  expect(mob.chyby.length === 0, `mobil: konzole bez chyb (${mob.chyby.length}${mob.chyby.length ? ': ' + mob.chyby[0].slice(0, 120) : ''})`);

  console.log('== řešitel bez práva: tažení → dialog žádosti → API nese žádost, termín beze změny → Vrátit ==');
  const page2 = await novaStranka();
  await prihlas(page2, RESITEL);
  await otevriKalendar(page2);
  const NAVRH = den(3);
  expect(await tahni(page2, chipSel('Ochutnávka pro sousedy'), `[data-testid="gcal-den-${NAVRH}"]`), 'řešitel táhl chip cizího uzlu');
  expect(await dialogJe(page2, 'zadost'), 'otevřel se dialog žádosti o termín (kal-dialog-zadost)');
  await page2.type('[data-testid="kal-dialog-duvod"]', 'Čekám na podklady');
  await page2.click('[data-testid="kal-dialog-odeslat"]');
  await H.waitFor(async () => (await uzel('n2'))?.data?.deadlineChangeWanted === NAVRH, { timeout: 8000, popis: 'žádost' }).catch(() => {});
  let n2 = await uzel('n2');
  expect(n2?.data?.deadlineChangeWanted === NAVRH && n2?.data?.deadlineChangeRequestedBy === RESITEL, `API: uzel nese žádost o ${NAVRH} od řešitele`);
  expect(n2?.data?.deadline === den(2), 'API: samotný termín se žádostí NEZMĚNIL');
  // API nese žádost dřív, než prohlížeč dostane odpověď a ukáže hlášku → čekat na tlačítko
  const vratit2 = await page2.waitForSelector('[data-testid="kal-vratit"]', { timeout: 8000 }).catch(() => null);
  expect(!!vratit2, 'hláška o odeslané žádosti nabízí Vrátit');
  if (vratit2) await vratit2.click();
  await H.waitFor(async () => !(await uzel('n2'))?.data?.deadlineChangeWanted, { timeout: 8000, popis: 'zrušení žádosti' }).catch(() => {});
  n2 = await uzel('n2');
  expect(!n2?.data?.deadlineChangeWanted, 'API: Vrátit žádost zrušilo');

  console.log('== události (19. 9. 2026): „+“ → volič → dialog → chip s časem → detail → tažení → filtr Osobní → pozvaný ==');
  const udalosti = async (token = V) => ((await inst.api('GET', '/api/kb/events', { token })).json?.events || []);
  // page2 (řešitel) je teď tab v popředí — tab na pozadí Chrome škrtí (žádný rAF → page.click visí
  // na protocolTimeout); a přihlášení řešitele přepsalo sdílené localStorage → přihlásit vlastníka znovu
  await page.bringToFront();
  await prihlas(page, VLASTNIK);
  await otevriKalendar(page);
  await page.click('.gcal-create-primary-btn');
  await page.waitForSelector('[data-testid="kal-dialog-nova"]', { timeout: 8000 }).catch(() => {});
  expect(!!(await page.$('[data-testid="kal-novy-ukol"]')) && !!(await page.$('[data-testid="kal-nova-udalost"]')), '„+“ nabízí Úkol do projektu / Událost');
  await page.click('[data-testid="kal-nova-udalost"]');
  await page.waitForSelector('[data-testid="kal-dialog-udalost"]', { timeout: 8000 }).catch(() => {});
  expect(!!(await page.$('[data-testid="kal-dialog-udalost"]')), 'otevřel se dialog nové události');
  await page.type('[data-testid="udalost-nazev"]', 'Zubař');
  // <input type="time"> psaný klávesnicí závisí na locale prohlížeče (AM/PM) → hodnota přes nativní setter
  await page.$eval('[data-testid="udalost-cas"]', (el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '14:00');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(!!(await page.$(`[data-testid="udalost-ucastnik-${RESITEL}"]`)), 'seznam účastníků nabízí kolegu');
  await page.click(`[data-testid="udalost-ucastnik-${RESITEL}"]`);
  await page.click('[data-testid="udalost-ulozit"]');
  await H.waitFor(async () => (await udalosti()).length === 1, { timeout: 8000, popis: 'událost v API' }).catch(() => {});
  const ev = (await udalosti())[0];
  expect(!!ev && ev.title === 'Zubař' && ev.time === '14:00' && ev.day === den(0) && ev.participants[0] === RESITEL && ev.remind && ev.remind_before_min === 30,
    `API: událost Zubař dnes 14:00, pozván řešitel, připomínka 30 min (${JSON.stringify(ev)})`);
  const chipZubar = await page.waitForSelector(chipSel('14:00 Zubař'), { timeout: 8000 }).catch(() => null);
  expect(!!chipZubar, 'chip události je v mřížce s časem před názvem');
  expect(await page.evaluate((s) => { const el = document.querySelector(s); return el?.dataset.kind === 'event' && /14:00/.test(el?.textContent || ''); }, chipSel('14:00 Zubař')), 'chip nese data-kind=event a čas 14:00');
  expect(!!(await page.$('[data-testid="gcal-filtr-osobni"]')), 'postranní filtr má řádek „Osobní“');
  // detail klepnutím
  await page.click(chipSel('14:00 Zubař'));
  await page.waitForSelector('[data-testid="kal-dialog-udalost"]', { timeout: 8000 }).catch(() => {});
  expect((await page.$eval('[data-testid="udalost-nazev"]', (el) => el.value).catch(() => '')) === 'Zubař', 'klik na chip otevře detail události s názvem');
  await page.keyboard.press('Escape');
  await sleep(500);
  // tažení na jiný den → dialog přesunu → API → Vrátit
  const CIL_U = den(3);
  expect(await tahni(page, chipSel('14:00 Zubař'), `[data-testid="gcal-den-${CIL_U}"]`), 'vlastník táhl událost');
  expect(await dialogJe(page, 'presun'), 'otevřel se dialog „Přesunout událost“ (kal-dialog-presun)');
  await page.click('[data-testid="kal-dialog-potvrdit"]');
  await H.waitFor(async () => (await udalosti())[0]?.day === CIL_U, { timeout: 8000, popis: 'přesun události' }).catch(() => {});
  expect((await udalosti())[0]?.day === CIL_U, `API: událost přesunuta na ${CIL_U}`);
  const vratitU = await page.waitForSelector('[data-testid="kal-vratit"]', { timeout: 8000 }).catch(() => null);
  expect(!!vratitU, 'hláška nabízí Vrátit');
  if (vratitU) await vratitU.click();
  await H.waitFor(async () => (await udalosti())[0]?.day === den(0), { timeout: 8000, popis: 'vrácení události' }).catch(() => {});
  expect((await udalosti())[0]?.day === den(0), 'API: Vrátit posunulo událost zpět');
  // filtr Osobní schová události, uzly zůstanou
  await page.click('[data-testid="gcal-filtr-osobni"] .gcal-custom-checkbox');
  await sleep(500);
  expect(!(await page.$(chipSel('14:00 Zubař'))) && !!(await page.$(chipSel('Ochutnávka pro sousedy'))), 'filtr „Osobní“ schová událost, uzly zůstávají');
  await page.click('[data-testid="gcal-filtr-osobni"] .gcal-custom-checkbox');
  await sleep(500);
  expect(!!(await page.$(chipSel('14:00 Zubař'))), 'a zase ji ukáže');
  // připomínka k uzlu z detailu (den před termínem v 16:00) → API → zvoneček na chipu
  await page.click(chipSel('Ochutnávka pro sousedy'));
  const tlNastavit = await page.waitForSelector('[data-testid="uzel-pripominka-nastavit"]', { timeout: 8000 }).catch(() => null);
  expect(!!tlNastavit, 'detail uzlu s termínem nabízí „Připomenout mi termín“');
  if (tlNastavit) await tlNastavit.click();
  await page.waitForSelector('[data-testid="uzel-pripominka-ulozit"]', { timeout: 8000 }).catch(() => {});
  expect((await page.$eval('[data-testid="uzel-pripominka-cas"]', (el) => el.value).catch(() => '')) === '16:00', 'výchozí „den před termínem“ nabízí 16:00');
  await page.click('[data-testid="uzel-pripominka-ulozit"]');
  const pripominky = async () => ((await inst.api('GET', `/api/kb/node-reminders?map=${mapa.id}`, { token: V })).json?.reminders || []);
  await H.waitFor(async () => (await pripominky()).length === 1, { timeout: 8000, popis: 'připomínka v API' }).catch(() => {});
  const rem = (await pripominky())[0];
  expect(!!rem && rem.node_id === 'n2' && rem.offset_days === 1 && rem.time === '16:00' && rem.day === den(1), `API: připomínka den před termínem 16:00 (${JSON.stringify(rem)})`);
  expect(!!(await page.waitForSelector('[data-testid="uzel-pripominka-stav"]', { timeout: 8000 }).catch(() => null)), 'dialog ukazuje nastavenou připomínku');
  expect((await uzel('n2'))?.data?.deadline === den(2), 'API: termín uzlu se připomínkou NEZMĚNIL');
  await page.keyboard.press('Escape');
  await sleep(600);
  expect(!!(await page.waitForSelector(`${chipSel('Ochutnávka pro sousedy')} [data-testid="gcal-chip-zvonek"]`, { timeout: 8000 }).catch(() => null)), 'chip uzlu s připomínkou má zvoneček');
  // Můj den: dnešní událost jako řádek s časem nad seznamem (server sections.events)
  const mujDen = (await inst.api('GET', '/api/kb/my-day', { token: V })).json;
  expect((mujDen?.sections?.events || []).some((e) => e.title === 'Zubař' && e.time === '14:00' && e.mine && e.participants === 1), `Můj den API nese dnešní událost s časem (${JSON.stringify((mujDen?.sections || {}).events)})`);
  // na Úkolech je panel výchozí sbalený (Richard 11. 8.) → Projekty (rozbalený)
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  const radekUdalosti = await page.waitForSelector('[data-testid="myday-udalosti"]', { timeout: 15000 }).catch(() => null);
  expect(!!radekUdalosti && /14:00/.test(await page.evaluate((el) => el.innerText, radekUdalosti)) && /Zubař/.test(await page.evaluate((el) => el.innerText, radekUdalosti)), 'panel Můj den ukazuje „14:00 Zubař“');
  // pozvaný kolega: vidí, ale nemění; tažení = vysvětlení; má pozvánku ve zvonečku
  await page2.bringToFront();
  await prihlas(page2, RESITEL);
  await otevriKalendar(page2);
  const chipHost = await page2.waitForSelector(chipSel('14:00 Zubař'), { timeout: 8000 }).catch(() => null);
  expect(!!chipHost, 'pozvaný vidí událost ve svém kalendáři');
  await page2.click(chipSel('14:00 Zubař'));
  await page2.waitForSelector('[data-testid="kal-dialog-udalost"]', { timeout: 8000 }).catch(() => {});
  expect(!(await page2.$('[data-testid="udalost-ulozit"]')) && !(await page2.$('[data-testid="udalost-smazat"]')), 'pozvaný má detail jen ke čtení (bez Uložit/Smazat)');
  expect(!!(await page2.$('[data-testid="udalost-opustit"]')), 'pozvaný má tlačítko „Odebrat se z události“');
  await page2.keyboard.press('Escape');
  await sleep(500);
  expect(await tahni(page2, chipSel('14:00 Zubař'), `[data-testid="gcal-den-${CIL_U}"]`), 'pozvaný zkusil událost táhnout');
  expect(await dialogJe(page2, 'odmitnuto'), 'dostal vysvětlení, že událost přesouvá jen zakladatel');
  expect((await udalosti())[0]?.day === den(0), 'API: událost se pozvanému nepřesunula');
  const pozvanky = (await inst.api('GET', '/api/collections/notifications/records?filter=' + encodeURIComponent('type="event_invited"'), { token: W })).json?.items || [];
  expect(pozvanky.length === 1 && pozvanky[0].event_id === ev.id, 'pozvaný má ve zvonečku event_invited s event_id');
  // zvoneček → pozvánka → otevře detail události, i když pozvaný stojí na /tasks v TABULCE
  // (pohled se přepne za běhu; panel /checkup 19. 9.: DTO nemělo event_id, Tasks četl ?view= jen při mountu)
  await page2.keyboard.press('Escape'); // zavřít dialog „odmítnuto“ z tažení
  await sleep(500);
  await page2.goto(`${inst.base}/tasks?view=table`, { waitUntil: 'networkidle2' });
  await sleep(800);
  // Radix DropdownMenu se otvírá na pointerdown → skutečný klik myší, ne el.click()
  for (const h of await page2.$$('button')) {
    if (await page2.evaluate((el) => !!el.querySelector('svg.lucide-bell'), h)) { await h.click(); break; }
  }
  await sleep(600);
  const polozka = await page2.waitForSelector(`[data-testid="bell-item-${pozvanky[0].id}"]`, { timeout: 8000 }).catch(() => null);
  expect(!!polozka, 'zvoneček ukazuje pozvánku');
  if (polozka) await polozka.click();
  const dialogZeZvonku = await page2.waitForSelector('[data-testid="kal-dialog-udalost"]', { timeout: 15000 }).catch(() => null);
  expect(!!dialogZeZvonku && (await page2.$eval('[data-testid="udalost-nazev"]', (el) => el.value).catch(() => '')) === 'Zubař', 'klik na pozvánku ve zvonečku přepnul na kalendář a otevřel detail události');
  expect(!!(await page2.$('.gcal-wrapper')), 'pohled se přepnul z Tabulky na Kalendář');
  await page2.keyboard.press('Escape');
  await sleep(500);
  await otevriKalendar(page2);
  // odebrat se: dvojklik na tlačítko (první = potvrzení) → chip zmizí, API bez účastníka
  await page2.click(chipSel('14:00 Zubař'));
  await page2.waitForSelector('[data-testid="udalost-opustit"]', { timeout: 8000 }).catch(() => {});
  await page2.click('[data-testid="udalost-opustit"]');
  await sleep(300);
  await page2.click('[data-testid="udalost-opustit"]');
  await H.waitFor(async () => ((await udalosti())[0]?.participants || []).length === 0, { timeout: 8000, popis: 'odebrání' }).catch(() => {});
  expect(((await udalosti())[0]?.participants || []).length === 0, 'API: pozvaný se z události odebral');
  await H.waitFor(async () => !(await page2.$(chipSel('14:00 Zubař'))), { timeout: 8000, popis: 'chip zmizel' }).catch(() => {});
  expect(!(await page2.$(chipSel('14:00 Zubař'))), 'a chip mu z kalendáře zmizel (realtime)');

  expect(chyby.length === 0, `konzole bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 160) : ''})`);
}, { nazev: 'UI-KALENDAR' });
