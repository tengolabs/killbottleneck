// UI e2e: STROP 500 ÚKOLŮ S VIDITELNÝM DOTAŽENÍM (rozhodnutí vlastníka
// 1. 9. 2026; nález „strop 1000 úkolů" + externí audit 2).
//
// Dřív: Task.list('-created_date', 1000) — org s víc než 1000 úkoly TIŠE
// neviděla nejstarší a žádné místo v UI to neřeklo. Teď: stránka Úkoly načte
// prvních 500 přes listPage() (zná totalItems) a když je úkolů víc, ukáže
// pruh „Zobrazeno {{shown}} z {{total}} úkolů" s tlačítkem „Načíst vše",
// které dotáhne zbylé stránky a pruh zmizí.
//
// Fixtura: 520 úkolů přes SUPERUSERA (vytváření úkolů je pro uživatele
// zakázáno hookem — „úkol = uzel", superuser je výjimka pro fixtury) —
// stejný vzor jako suTask v ukoly-soukromi.js. Úkoly bez mapy → v tabulce
// jedna sekce „Bez mapy" s počtem, což dává druhé, datové počítadlo vedle
// počtu řádků v DOM.
//
// MUTAČNÍ DŮKAZ: na image z main (kb-strop-0) sada ČERVENÁ — pruh není
// a při 520 úkolech se zobrazí všech 520 (starý strop 1000).
const H = require('./_harness');
const { expect, sleep } = H;

const UCET = 'strop@e2e.cz';
const CELKEM = 520;
const PRVNI_STRANKA = 500;

H.beh(async () => {
  // bez úvodní mapy — sada počítá PŘESNÉ počty úkolů, výchozí obsah by je posunul
  const inst = await H.startInstance({ slug: 'strop-ukolu', env: { KB_UVODNI_MAPA: 0 } });

  const reg = await inst.register(UCET);
  const userId = reg.json?.id;
  expect(reg.status === 200 && !!userId, `účet založen (${reg.status})`);
  const SU = await inst.superuser();

  // 520 volných úkolů superuserem (owner = testovací účet); dávky po 20 —
  // sekvenčně by to trvalo zbytečně dlouho, plný paralelismus by zase mohl
  // vyčerpat spojení
  let zalozeno = 0;
  for (let od = 0; od < CELKEM; od += 20) {
    const davka = [];
    for (let i = od; i < Math.min(od + 20, CELKEM); i++) {
      davka.push(inst.api('POST', '/api/collections/tasks/records', { token: SU, body: {
        title: `Úkol ${String(i + 1).padStart(3, '0')}`,
        status: 'todo',
        owner: userId,
        owner_email: UCET,
      } }).then((r) => { if (r.status === 200) zalozeno++; }));
    }
    await Promise.all(davka);
  }
  expect(zalozeno === CELKEM, `založeno ${zalozeno}/${CELKEM} úkolů`);
  // kontrolní počet přímo z API (totalItems je zdroj čísla v pruhu)
  const vypis = await inst.api('GET', '/api/collections/tasks/records?page=1&perPage=1', { token: await inst.login(UCET) });
  expect(vypis.json?.totalItems === CELKEM, `API totalItems = ${vypis.json?.totalItems} (čeká se ${CELKEM})`);

  const { page, chyby } = await H.browser();
  await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email');
  await page.type('#email', UCET);
  await page.type('#password', H.PW);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1500);

  console.log('== /tasks: pruh o stropu + prvních 500 řádků ==');
  await page.goto(`${inst.base}/tasks`, { waitUntil: 'networkidle2' });
  // počkat, až se tabulka naplní (500 řádků chvíli renderuje)
  await page.waitForFunction(
    () => [...document.querySelectorAll('tbody tr')].filter((r) => /Úkol \d+/.test(r.textContent || '')).length >= 500,
    { timeout: 45000 },
  ).catch(() => {});
  await sleep(1000);

  const pruh = await page.$('[data-testid="tasks-strop"]');
  expect(!!pruh, 'pruh o stropu je vidět');
  const pruhText = pruh ? await page.evaluate((el) => el.innerText, pruh) : '';
  expect(new RegExp(`Zobrazeno\\s+${PRVNI_STRANKA}\\s+z\\s+${CELKEM}\\s+úkolů`).test(pruhText),
    `pruh říká „Zobrazeno ${PRVNI_STRANKA} z ${CELKEM} úkolů" (${pruhText.replace(/\n/g, ' · ') || 'prázdný'})`);
  expect(/Načíst vše/.test(pruhText), 'pruh nese tlačítko „Načíst vše"');

  const radkuPred = await page.evaluate(
    () => [...document.querySelectorAll('tbody tr')].filter((r) => /Úkol \d+/.test(r.textContent || '')).length,
  );
  expect(radkuPred === PRVNI_STRANKA, `tabulka má ${radkuPred} řádků úkolů (čeká se ${PRVNI_STRANKA})`);
  // datové počítadlo: badge sekce „Bez mapy" ukazuje počet NAČTENÝCH úkolů
  const badgePred = await page.evaluate(() => {
    const m = (document.body.innerText || '').match(/Bez mapy\s*\n?\s*(\d+)/);
    return m ? Number(m[1]) : -1;
  });
  expect(badgePred === PRVNI_STRANKA, `sekce „Bez mapy" počítá ${badgePred} (čeká se ${PRVNI_STRANKA})`);

  console.log('== klik „Načíst vše" → pruh zmizí, vidět všech 520 ==');
  await page.click('[data-testid="tasks-strop-nacist"]');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="tasks-strop"]'),
    { timeout: 30000 },
  ).catch(() => {});
  await page.waitForFunction(
    (n) => [...document.querySelectorAll('tbody tr')].filter((r) => /Úkol \d+/.test(r.textContent || '')).length >= n,
    { timeout: 45000 }, CELKEM,
  ).catch(() => {});
  await sleep(500);

  expect(!(await page.$('[data-testid="tasks-strop"]')), 'pruh po „Načíst vše" zmizel');
  const poNacteni = await page.evaluate(() => ({
    radku: [...document.querySelectorAll('tbody tr')].filter((r) => /Úkol \d+/.test(r.textContent || '')).length,
    badge: (() => { const m = (document.body.innerText || '').match(/Bez mapy\s*\n?\s*(\d+)/); return m ? Number(m[1]) : -1; })(),
  }));
  expect(poNacteni.radku === CELKEM, `po dotažení je vidět ${poNacteni.radku} úkolů (čeká se ${CELKEM})`);
  expect(poNacteni.badge === CELKEM, `sekce „Bez mapy" počítá ${poNacteni.badge} (čeká se ${CELKEM})`);
  // nejstarší úkol (č. 001, řazení -created) je vidět až PO dotažení — přesně
  // to, co starý tichý strop schovával
  expect(await page.evaluate(() => /Úkol 001/.test(document.body.innerText || '')), 'nejstarší úkol (001) je po dotažení vidět');

  // pruh se nevrací: refresh seznamu řádkovou akcí nesmí strop znovu zapnout —
  // simulace: reload stránky pruh ukázat SMÍ (nové sezení), ale refresh() v témže
  // sezení ne. To hlídá vseRef v hooku; tady stačí, že po dotažení pruh nestojí.

  expect(chyby.length === 0, `konzole bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 160) : ''})`);
}, { nazev: 'UI-STROP-UKOLU' });
