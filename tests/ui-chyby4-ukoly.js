// UI e2e (headless Chrome, own temporary profile): the Tasks page (code analysis 4, slice F3).
//
//   F3-01  the counter "U druhých po termínu" in My day ON the Tasks page opens the delegated
//          overdue tasks (before: MY tasks, deadline filter on "all")
//   F3-02  the number on that counter = the number of rows behind it, also when the assignee
//          planned the overdue task (before: the plan hid the row, 2 on the chip, 1 in the list)
//   F3-03  a click on a column header sorts the node rows (before: only the arrow turned)
//   F3-04  a row action does not rebuild the page: no spinner, the table stays the same DOM
//          element, the scroll position stays
//   F3-05  a failed load of the maps shows an error with "Zkusit znovu", not "Zatím nemáte
//          žádné úkoly"
//   F3-06  midnight with the page open: the timeline moves "today", the deadline filter is
//          recomputed and My day is read again
//
// The person's path: real clicks (chip, headers, row action, retry). Midnight = the clock of the
// PAGE moved by a day (Date of the page shifted) and the tab getting focus again.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

const SEF = 'sef@example.com', KOLEGA = 'kolega@example.com';
const den = (posun) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + posun);
  return d.toLocaleDateString('en-CA'); // local day, as the browser
};
const uzel = (id, title, data = {}, y = 260) => ({ id, type: 'goalNode', position: { x: 0, y }, data: { title, status: 'todo', ...data } });
const apex = (title) => ({ id: 'root', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', title, apexText: title, status: 'todo' } });
const podVrchol = (nodes) => nodes.filter((n) => n.id !== 'root').map((n) => ({ id: `e-${n.id}`, source: 'root', target: n.id }));

// titles of the node rows of the table, top to bottom (only the given titles)
const radky = (page, nazvy) => page.evaluate((ns) => [...document.querySelectorAll('tbody tr')]
  .map((tr) => ns.find((n) => (tr.innerText || '').includes(n))).filter(Boolean), nazvy);
const klikHlavicku = async (page, text) => {
  const h = await page.evaluateHandle((t) => [...document.querySelectorAll('thead th button')].find((b) => (b.innerText || '').trim() === t) || null, text);
  const el = h.asElement(); if (!el) return false; await el.click(); return true;
};
const tlacitkoAktivni = (page, text) => page.evaluate((t) => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === t && x.offsetParent !== null);
  return b ? /\bbg-primary\b/.test(b.className) : null;
}, text);
const textStranky = (page) => page.evaluate(() => document.body.innerText);

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-chyby4-ukoly', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register(SEF, { name: 'Šéf' });
  await inst.register(KOLEGA, { name: 'Kolega' });
  const T = await inst.login(SEF);
  const mapa = async (title, nodes, extra = {}) => (await inst.api('POST', '/api/collections/goalmaps/records', {
    token: T, body: { title, nodes: [apex(title), ...nodes], edges: podVrchol(nodes), ...extra },
  })).json;

  // Project A — delegation: two overdue tasks of the colleague (one PLANNED by him for today),
  // one of his tasks in the future, two of mine (one overdue)
  const D1 = 'DELEG-PO-TERMINU-S-PLANEM', D2 = 'DELEG-PO-TERMINU-BEZ-PLANU', D3 = 'DELEG-V-BUDOUCNU', M1 = 'MOJE-PO-TERMINU', M2 = 'MOJE-BEZ-TERMINU';
  const A = await mapa('Projekt Delegace', [
    uzel('d1', D1, { owner: KOLEGA, deadline: den(-3), plannedOn: den(0) }),
    uzel('d2', D2, { owner: KOLEGA, deadline: den(-2) }),
    uzel('d3', D3, { owner: KOLEGA, deadline: den(20) }),
    uzel('m1', M1, { owner: SEF, deadline: den(-1) }),
    uzel('m2', M2, { owner: SEF }),
  ], { shared_with: [KOLEGA] });
  expect(!!A.id, `projekt s delegací založen (${JSON.stringify(A).slice(0, 120)})`);

  const pulnoc = new Date(); pulnoc.setHours(0, 0, 0, 0);
  const mujDen = (await inst.api('GET', `/api/kb/my-day?today=${den(0)}&since=${encodeURIComponent(pulnoc.toISOString())}`, { token: T })).json;
  const naServeru = ((mujDen || {}).counts || {}).delegatedOverdue;
  expect(naServeru === 2, `server: počítadlo „U druhých po termínu“ = ${naServeru} (čeká se 2)`);

  const { browser } = await H.browser();
  const chyby = [];
  const S = await E.clovek(browser, inst, SEF, chyby);
  const { page } = S;
  // My day on the Tasks page is collapsed by default → expanded; the clock of the page can be moved
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('kb-myday-tasks', '0');
    localStorage.setItem('kb-tasks-view', 'table');
    const Real = Date;
    window.__posunHodin = 0;
    class Posunuty extends Real {
      constructor(...a) { if (a.length === 0) super(Real.now() + window.__posunHodin); else super(...a); }
      static now() { return Real.now() + window.__posunHodin; }
    }
    window.Date = Posunuty;
  });
  // counting and forging of requests: `selhaniMap` = answer the listing of maps with 503
  let selhaniMap = false; const dotazy = [];
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    const u = rq.url();
    if (rq.method() === 'GET') dotazy.push(u);
    if (selhaniMap && rq.method() === 'GET' && /\/api\/collections\/goalmaps\/records(\?|$)/.test(u)) {
      rq.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ status: 503, message: 'Server je přetížený.', data: {} }) }).catch(() => {});
      return;
    }
    rq.continue().catch(() => {});
  });
  const otevri = async (cesta, cekatNa) => {
    await page.goto(`${inst.base}${cesta}`, { waitUntil: 'networkidle2' });
    if (cekatNa) await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 30000 }, cekatNa);
    await sleep(800);
  };

  console.log('== F3-01 + F3-02: počítadlo „U druhých po termínu“ na stránce Úkoly ==');
  await otevri('/tasks', D1);
  const cip = async () => {
    const h = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /^U druhých po termínu/.test((b.innerText || '').trim())) || null);
    return h.asElement();
  };
  expect(await E.cekej(async () => { const c = await cip(); return !!c && /2/.test(await c.evaluate((x) => x.innerText)); }, 15000, 'chip'), 'panel Můj den ukazuje počítadlo „U druhých po termínu 2“');
  const cisloNaCipu = await (await cip()).evaluate((x) => Number(((x.innerText || '').match(/(\d+)/) || [])[1]));
  await (await cip()).click();
  await sleep(800);
  const VSE = [D1, D2, D3, M1, M2];
  const poKliku = await radky(page, VSE);
  expect((await tlacitkoAktivni(page, 'Zadal jsem')) === true, 'po kliku na počítadlo je zapnutý filtr „Zadal jsem“');
  expect((await tlacitkoAktivni(page, 'Moje úkoly')) === false, 'po kliku na počítadlo NENÍ zapnutý filtr „Moje úkoly“');
  expect(await page.evaluate(() => [...document.querySelectorAll('button[role="combobox"]')].some((b) => (b.innerText || '').trim() === 'Po termínu')), 'filtr termínu je na „Po termínu“');
  expect(!poKliku.includes(M1) && !poKliku.includes(M2), `v seznamu nejsou moje vlastní úkoly (${JSON.stringify(poKliku)})`);
  expect(poKliku.includes(D2) && !poKliku.includes(D3), `v seznamu je zpožděný úkol kolegy a není tam jeho úkol s termínem v budoucnu (${JSON.stringify(poKliku)})`);
  expect(poKliku.includes(D1), 'F3-02: zpožděný úkol kolegy je v seznamu, i když si ho kolega naplánoval na dnešek');
  expect(poKliku.length === cisloNaCipu && cisloNaCipu === 2, `F3-02: číslo na počítadle (${cisloNaCipu}) = počet úkolů v seznamu po kliku (${poKliku.length})`);

  console.log('== F3-02: totéž z titulní stránky (odkaz) a ručním filtrem; plán u VLASTNÍ práce platí dál ==');
  await otevri('/tasks?owner=delegated&deadline=overdue', D2);
  const zOdkazu = await radky(page, VSE);
  expect(zOdkazu.length === 2 && zOdkazu.includes(D1) && zOdkazu.includes(D2), `odkaz „Zadal jsem + Po termínu“ ukáže oba zpožděné úkoly (${JSON.stringify(zOdkazu)})`);
  // my own work: the plan still decides (decision of 5. 11. — the filter = the sections of My day)
  const B = await mapa('Projekt Plan', [uzel('p1', 'MOJE-TERMIN-VCERA-PLAN-DNES', { owner: SEF, deadline: den(-1), plannedOn: den(0) })]);
  await otevri('/tasks?assignee=me&deadline=overdue', M1);
  const moje = await radky(page, [...VSE, 'MOJE-TERMIN-VCERA-PLAN-DNES']);
  expect(moje.includes(M1) && !moje.includes('MOJE-TERMIN-VCERA-PLAN-DNES'), `„Moje úkoly + Po termínu“: úkol naplánovaný na dnešek mezi zpožděnými NENÍ — plán u vlastní práce rozhoduje dál (${JSON.stringify(moje)})`);
  await inst.api('DELETE', `/api/collections/goalmaps/records/${B.id}`, { token: T });

  console.log('== F3-03: klik na hlavičku sloupce seřadí řádky uzlů ==');
  const R = ['Mrkev', 'Zebra', 'Cibule', 'Okurka', 'Paprika'];
  const C = await mapa('Projekt Razeni', [
    uzel('r1', 'Mrkev', { deadline: den(9), owner: KOLEGA, status: 'done' }),
    uzel('r2', 'Zebra', { deadline: den(2), owner: SEF, status: 'todo' }),
    uzel('r3', 'Cibule', { deadline: den(30), owner: SEF, status: 'in_progress' }),
    uzel('r4', 'Okurka', { deadline: den(5), owner: KOLEGA, status: 'todo' }),
    uzel('r5', 'Paprika', { deadline: den(12), owner: SEF, status: 'in_progress' }),
  ], { shared_with: [KOLEGA] });
  await otevri(`/tasks?map=${C.id}`, 'Paprika');
  const vychozi = await radky(page, R);
  expect(JSON.stringify(vychozi) === JSON.stringify(R), `bez řazení drží tabulka pořadí z mapy (${vychozi})`);
  expect(await klikHlavicku(page, 'Termín'), 'klik na hlavičku „Termín“');
  await sleep(400);
  const podleTerminu = await radky(page, R);
  expect(JSON.stringify(podleTerminu) === JSON.stringify(['Zebra', 'Okurka', 'Mrkev', 'Paprika', 'Cibule']), `Termín vzestupně: ${podleTerminu}`);
  await klikHlavicku(page, 'Termín'); await sleep(400);
  const podleTerminuDolu = await radky(page, R);
  expect(JSON.stringify(podleTerminuDolu) === JSON.stringify(['Cibule', 'Paprika', 'Mrkev', 'Okurka', 'Zebra']), `Termín sestupně (druhý klik): ${podleTerminuDolu}`);
  await klikHlavicku(page, 'Termín'); await sleep(400);
  const tretiKlik = await radky(page, R);
  expect(JSON.stringify(tretiKlik) === JSON.stringify(R), `třetí klik na tutéž hlavičku vrátí pořadí z mapy (${tretiKlik})`);
  await klikHlavicku(page, 'Úkol'); await sleep(400);
  const podleNazvu = await radky(page, R);
  expect(JSON.stringify(podleNazvu) === JSON.stringify(['Cibule', 'Mrkev', 'Okurka', 'Paprika', 'Zebra']), `Úkol (název) vzestupně: ${podleNazvu}`);
  await klikHlavicku(page, 'Stav'); await sleep(400);
  const podleStavu = await radky(page, R);
  expect(JSON.stringify(podleStavu) === JSON.stringify(['Zebra', 'Okurka', 'Cibule', 'Paprika', 'Mrkev']), `Stav vzestupně (Založeno → Probíhá → Hotovo, uvnitř stavu pořadí z mapy): ${podleStavu}`);
  await klikHlavicku(page, 'Komu'); await sleep(400);
  const podleKomu = await radky(page, R);
  expect(JSON.stringify(podleKomu.slice(0, 2).sort()) === JSON.stringify(['Mrkev', 'Okurka']), `Komu vzestupně: nejdřív úkoly Kolegy, pak Šéfa (${podleKomu})`);
  expect((await radky(page, ['Projekt Razeni']))[0] === 'Projekt Razeni' && await page.evaluate(() => { const t = [...document.querySelectorAll('tbody tr')].map((tr) => tr.innerText || ''); return t.findIndex((x) => x.includes('Projekt Razeni')) < t.findIndex((x) => x.includes('Mrkev')); }), 'osnova drží: hlavní cíl zůstal nad svými kroky');

  console.log('== F3-04: řádková akce nepřestaví stránku (žádné kolečko, tabulka je týž prvek, rolování drží) ==');
  const hodne = [];
  for (let i = 1; i <= 45; i++) hodne.push(uzel(`h${i}`, `Radek-${String(i).padStart(2, '0')}`, { owner: SEF, deadline: den(i) }));
  const Dm = await mapa('Projekt Dlouhy', hodne);
  await otevri(`/tasks?map=${Dm.id}`, 'Radek-45');
  await page.evaluate(() => { document.querySelector('table').setAttribute('data-znacka', 'puvodni'); });
  const cil = await page.evaluateHandle(() => [...document.querySelectorAll('tbody tr')].find((tr) => (tr.innerText || '').includes('Radek-40')) || null);
  await cil.asElement().evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await sleep(300);
  const yPred = await page.evaluate(() => window.scrollY);
  expect(yPred > 300, `stránka je odrolovaná dolů k řádku 40 (scrollY ${yPred})`);
  await cil.asElement().hover();
  const plan = await cil.asElement().$('button[aria-label="Naplánovat, kdy to řešit"]');
  expect(!!plan, 'řádek má akci „Naplánovat, kdy to řešit“');
  await plan.click();
  await sleep(400);
  dotazy.length = 0;
  // sample the page from the click on: spinner in the content, the marked table, scroll position
  await page.evaluate(() => {
    window.__vzorky = [];
    const iv = setInterval(() => {
      window.__vzorky.push({
        kolecko: !!document.querySelector('[data-testid="obsah"] .animate-spin'),
        znacka: !!document.querySelector('table[data-znacka="puvodni"]'),
        y: window.scrollY,
      });
      if (window.__vzorky.length >= 80) clearInterval(iv);
    }, 50);
  });
  const zitra = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Zítra' && b.offsetParent !== null) || null);
  expect(!!zitra.asElement(), 'nabídka plánu nabízí „Zítra“');
  await zitra.asElement().click();
  expect(await E.cekej(async () => (await S.toasty()).some((x) => /Naplánováno na zítra/.test(x)), 10000, 'toast'), 'akce proběhla („Naplánováno na zítra“)');
  await sleep(4200);
  const vz = await page.evaluate(() => window.__vzorky);
  expect(vz.length >= 60, `stránka vzorkována ${vz.length}× po 50 ms`);
  expect(vz.filter((v) => v.kolecko).length === 0, `po řádkové akci se neukázalo kolečko načítání (vzorků s kolečkem: ${vz.filter((v) => v.kolecko).length}/${vz.length})`);
  expect(vz.every((v) => v.znacka), `tabulka zůstala týmž prvkem — nepřestavěla se (vzorků bez označené tabulky: ${vz.filter((v) => !v.znacka).length}/${vz.length})`);
  const yMin = Math.min(...vz.map((v) => v.y)), yKonec = await page.evaluate(() => window.scrollY);
  expect(Math.abs(yKonec - yPred) < 80 && yMin > yPred - 80, `stránka neodrolovala nahoru (před ${yPred}, nejméně ${yMin}, na konci ${yKonec})`);
  const zapsano = E.uzel(await E.mapaZDb(inst, T, Dm.id), 'h40');
  expect(!!zapsano && zapsano.data.plannedOn === den(1), `plán je v databázi (${zapsano && zapsano.data.plannedOn})`);
  expect(await page.evaluate(() => { const tr = [...document.querySelectorAll('tbody tr')].find((x) => (x.innerText || '').includes('Radek-40')); return !!tr && !!tr.querySelector('button[aria-label="Naplánováno na zítra"]'); }), 'řádek po obnově na pozadí ukazuje nový plán („Naplánováno na zítra“)');

  console.log('== F3-05: nepodařené načtení map = chyba se „Zkusit znovu“, ne „Zatím nemáte žádné úkoly“ ==');
  selhaniMap = true;
  await page.goto(`${inst.base}/tasks`, { waitUntil: 'networkidle2' });
  expect(await E.cekej(() => page.$('[data-testid="tasks-load-error"]').then((x) => !!x), 15000, 'pruh chyby'), 'stránka ukázala chybu načtení');
  const txtChyba = await textStranky(page);
  expect(/Úkoly se nepodařilo načíst/.test(txtChyba), 'chyba říká „Úkoly se nepodařilo načíst.“');
  expect(!/Zatím nemáte žádné úkoly/.test(txtChyba) && !/Vytvořit první úkol/.test(txtChyba), 'stránka netvrdí „Zatím nemáte žádné úkoly“');
  expect(!!(await page.$('[data-testid="tasks-load-retry"]')), 'chyba má tlačítko „Zkusit znovu“');
  selhaniMap = false;
  const znovu = await page.$('[data-testid="tasks-load-retry"]');
  if (znovu) await znovu.click();
  expect(await E.cekej(async () => (await radky(page, [M1])).length === 1, 15000, 'řádky po Zkusit znovu'), 'po „Zkusit znovu“ se úkoly načetly');
  expect(await E.cekej(() => page.$('[data-testid="tasks-load-error"]').then((x) => !x), 8000, 'pruh zmizel'), 'po úspěšném načtení chyba zmizela');
  // the second (large) query alone fails: the metadata of the first phase carry no nodes
  let fazeDve = 0;
  page.removeAllListeners('request');
  page.on('request', (rq) => {
    const u = rq.url();
    if (rq.method() === 'GET') dotazy.push(u);
    if (rq.method() === 'GET' && /\/api\/collections\/goalmaps\/records\?/.test(u) && !/fields=/.test(u)) {
      fazeDve++;
      rq.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ status: 500, message: 'Chyba.', data: {} }) }).catch(() => {});
      return;
    }
    rq.continue().catch(() => {});
  });
  await page.goto(`${inst.base}/tasks`, { waitUntil: 'networkidle2' });
  expect(await E.cekej(() => page.$('[data-testid="tasks-load-error"]').then((x) => !!x), 15000, 'pruh chyby'), `selže-li jen druhý dotaz (celé mapy, ${fazeDve}×), stránka také ukáže chybu`);
  expect(!/Zatím nemáte žádné úkoly/.test(await textStranky(page)), 'ani tehdy netvrdí „Zatím nemáte žádné úkoly“');
  page.removeAllListeners('request');
  page.on('request', (rq) => { if (rq.method() === 'GET') dotazy.push(rq.url()); rq.continue().catch(() => {}); });

  console.log('== F3-06: půlnoc při otevřené stránce ==');
  // table: "Moje úkoly + Dnes" — a task with tomorrow's deadline appears after midnight
  const ZITRA = 'TERMIN-ZITRA-QWE', DNES = 'TERMIN-DNES-QWE';
  const Em = await mapa('Projekt Pulnoc', [
    uzel('z1', ZITRA, { owner: SEF, deadline: den(1) }),
    uzel('z0', DNES, { owner: SEF, deadline: den(0) }),
  ]);
  await otevri(`/tasks?map=${Em.id}&assignee=me&deadline=today`, DNES);
  const predPulnoci = await radky(page, [ZITRA, DNES]);
  expect(JSON.stringify(predPulnoci) === JSON.stringify([DNES]), `před půlnocí filtr „Dnes“ ukazuje dnešní úkol (${predPulnoci})`);
  // the "Po termínu" counter of My day (my own work): today's task becomes overdue at midnight
  const poTerminu = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^Po termínu/.test((x.innerText || '').trim()));
    return b ? Number(((b.innerText || '').match(/(\d+)/) || [])[1]) : null;
  });
  const poTerminuPred = await poTerminu();
  expect(poTerminuPred === 1, `Můj den před půlnocí: „Po termínu ${poTerminuPred}“ (čeká se 1)`);
  const pulnocStranky = async () => {
    await page.evaluate(() => { window.__posunHodin = 24 * 3600 * 1000; window.dispatchEvent(new Event('focus')); });
    await sleep(1500);
  };
  await pulnocStranky();
  const poPulnoci = await radky(page, [ZITRA, DNES]);
  expect(JSON.stringify(poPulnoci) === JSON.stringify([ZITRA]), `po půlnoci (hodiny stránky +1 den, návrat do karty) filtr „Dnes“ ukazuje úkol s termínem nového dne (${JSON.stringify(poPulnoci)})`);
  // (the request itself goes through the service worker, so the panel is read, not the network)
  expect(await E.cekej(async () => (await poTerminu()) === poTerminuPred + 1, 10000, 'Můj den po půlnoci'), `Můj den se po půlnoci přepočítal: „Po termínu“ ${poTerminuPred} → ${await poTerminu()} (čeká se ${poTerminuPred + 1})`);

  // timeline, scale Days: the highlighted "today" column
  await page.evaluate(() => { window.__posunHodin = 0; });
  await otevri(`/tasks?view=timeline&map=${Em.id}`, ZITRA);
  const dny = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Dny') || null);
  expect(!!dny.asElement(), 'časová osa má měřítko „Dny“');
  await dny.asElement().click();
  await sleep(600);
  // the day cell of "today" carries the filled circle with the day number
  const dnesNaOse = () => page.evaluate(() => [...document.querySelectorAll('span.rounded-full.bg-primary.text-primary-foreground')].map((s) => (s.innerText || '').trim()).filter((x) => /^\d{1,2}$/.test(x)));
  const cisloDne = (posun) => String(Number(den(posun).slice(8)));
  const osaPred = await dnesNaOse();
  expect(osaPred.length === 1 && osaPred[0] === cisloDne(0), `osa před půlnocí zvýrazňuje dnešek (${osaPred} / čeká se ${cisloDne(0)})`);
  await pulnocStranky();
  const osaPo = await dnesNaOse();
  expect(osaPo.length === 1 && osaPo[0] === cisloDne(1), `osa po půlnoci zvýrazňuje nový den (${JSON.stringify(osaPo)} / čeká se ${cisloDne(1)})`);
  expect(await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => (b.innerText || '').trim() === 'Dny' && /secondary/.test(b.className))), 'osa se při tom nepřestavěla — měřítko zůstalo na „Dny“');

  const vazne = chyby.filter((c) => !/503|500|Failed to load resource|ERR_/.test(c));
  expect(vazne.length === 0, `konzole bez chyb (mimo podvržené odpovědi serveru): ${JSON.stringify(vazne.slice(0, 3)).slice(0, 300)}`);
}, { nazev: 'UI-CHYBY4-UKOLY' });
