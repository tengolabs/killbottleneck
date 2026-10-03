// UI e2e: ARCHIV — číslo projektu na kartě a hledací políčko (Richard 2. 10. 2026).
//
// Hlídá: (1) odznak # v archivu = ČÍSLO PROJEKTU (ne pořadí v řadě), (2) políčko filtruje podle názvu
// bez diakritiky i podle „#N“, (3) prázdný výsledek to řekne, (4) smazání dotazu vrátí všechno.
// ⚠️ Píše se KLÁVESNICÍ (page.type), ne nastavením value — zámek pole by psaní spolkl (past 29. 9. 2026).
// Mutace M11: filtr ignorující „#n“ → spadne kontrola (2).
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ui-archiv-hledani.js
const H = require('./_harness');
const { expect } = H;

const mapa = (title, krok) => ({
  title,
  nodes: [
    { id: 'r', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: title, title, status: 'done' } },
    { id: 'a', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: krok, status: 'done' } },
  ],
  edges: [{ id: 'e', source: 'r', target: 'a' }],
});

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-archiv', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register('sef@example.com', { name: 'Šéf' });
  const A = await inst.login('sef@example.com');
  const zaloz = async (title, krok) => {
    const m = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: mapa(title, krok) })).json;
    await inst.api('PATCH', `/api/collections/goalmaps/records/${m.id}`, { token: A, body: { archived: true } }); // create archivaci vynuluje
    return (await inst.api('GET', `/api/collections/goalmaps/records/${m.id}`, { token: A })).json;
  };
  const plot = await zaloz('Zahradní plot', 'Faktura za pletivo');
  const kuchyn = await zaloz('Nová kuchyň', 'Montáž linky');
  const aktivni = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: mapa('Aktivní dílna', 'Krok') })).json;
  expect(plot.archived && kuchyn.archived && plot.project_number === 1 && kuchyn.project_number === 2 && aktivni.project_number === 3, `seed: #1 plot, #2 kuchyň archivované, #3 aktivní (${plot.project_number},${kuchyn.project_number},${aktivni.project_number})`);

  const { page, chyby } = await H.browser();
  await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email');
  await page.type('#email', 'sef@example.com');
  await page.type('#password', H.PW);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await page.goto(`${inst.base}/archive`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="archive-search"]', { timeout: 30000 });
  const karty = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="archive-project-number"]')]
    .map((b) => ({ cislo: b.textContent.trim(), karta: (b.closest('.rounded-xl') || {}).innerText || '' })));

  console.log('== odznak = číslo projektu ==');
  let k = await karty();
  expect(k.length === 2 && k.some((x) => x.cislo === '1' && /Zahradní plot/.test(x.karta)) && k.some((x) => x.cislo === '2' && /Nová kuchyň/.test(x.karta)), `dvě archivované karty s #1 a #2 (${JSON.stringify(k.map((x) => x.cislo))})`);
  expect(!k.some((x) => /Aktivní dílna/.test(x.karta)), 'aktivní projekt v archivu není');
  const titul = await page.evaluate(() => document.querySelector('[data-testid="archive-project-number"]').getAttribute('title'));
  expect(titul === 'Číslo projektu', `popisek odznaku říká, co to je („${titul}“)`);

  console.log('== hledání podle názvu bez diakritiky (klávesnicí) ==');
  await page.click('[data-testid="archive-search"]');
  await page.type('[data-testid="archive-search"]', 'zahrad');
  await H.sleep(300);
  k = await karty();
  expect(k.length === 1 && /Zahradní plot/.test(k[0].karta), `„zahrad“ → jen Zahradní plot (${k.length})`);

  console.log('== hledání podle čísla „#2“ ==');
  await page.click('[data-testid="archive-search"]', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type('[data-testid="archive-search"]', '#2');
  await H.sleep(300);
  k = await karty();
  expect(k.length === 1 && /Nová kuchyň/.test(k[0].karta), `„#2“ → jen Nová kuchyň (${k.length})`);
  await page.click('[data-testid="archive-search"]', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type('[data-testid="archive-search"]', '1');
  await H.sleep(300);
  k = await karty();
  expect(k.length === 1 && /Zahradní plot/.test(k[0].karta), `holé „1“ = číslo projektu → Zahradní plot (${k.length})`);

  console.log('== nic nenalezeno + smazání dotazu ==');
  await page.click('[data-testid="archive-search"]', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type('[data-testid="archive-search"]', 'xyzneexistuje');
  await H.sleep(300);
  k = await karty();
  const prazdno = await page.evaluate(() => (document.querySelector('[data-testid="archive-search-empty"]') || {}).textContent || '');
  expect(k.length === 0 && /xyzneexistuje/.test(prazdno), `prázdný výsledek to říká („${prazdno}“)`);
  await page.click('[data-testid="archive-search"]', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await H.sleep(300);
  k = await karty();
  expect(k.length === 2, `po smazání dotazu zpět obě karty (${k.length})`);
  expect(chyby.length === 0, `konzole bez chyb (${chyby.slice(0, 2).join(' | ')})`);
}, { nazev: 'UI-ARCHIV-HLEDANI' });
