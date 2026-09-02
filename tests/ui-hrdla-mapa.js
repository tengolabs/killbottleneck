// UI e2e: ÚZKÁ HRDLA V MAPĚ (v2 — poctivá verze, 9/2026).
//
// Reálné hrdlo (červený odznak, svítí i bez přepínače) = nehotový uzel po
// termínu; potenciální (oranžové, jen při zapnutém 🔥) = nehotový uzel
// s ≥2 nehotovými navazujícími kroky. Kritická cesta (červené čárkované hrany,
// data-stav-hrany="bottleneck") se kreslí jen k reálným. Počítadlo na tlačítku
// = počet REÁLNÝCH. Tlačítko po načtení NENÍ zvýrazněné jako zapnuté
// (data-zapnuto="0") — obrácené podsvícení byl nález revize odrazového
// konceptu (1. 9. 2026). Stagnační větev hrdel hlídá ui-organizace-hrdla.js.
//
// Fixtura: apex → HRDLO PO TERMINU (včera, 2 nehotové podkroky) → real;
// VETVENI BEZ TERMINU (2 nehotové podkroky, bez termínu) → potential;
// HOTOVY UZEL (done, 1 podkrok) → nic; SAMOTNY LIST → nic.
//
// MUTAČNÍ DŮKAZ: na image z main sada ČERVENÁ — tlačítko ani odznaky neexistují.
const H = require('./_harness');
const { expect, sleep } = H;

const UCET = 'hrdla@e2e.cz';
const den = (posun) => {
  const d = new Date();
  d.setDate(d.getDate() + posun);
  return d.toISOString().slice(0, 10);
};

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'hrdla-mapa', env: { KB_UVODNI_MAPA: 0 } });

  const reg = await inst.register(UCET);
  expect(reg.status === 200, `účet založen (${reg.status})`);
  const T = await inst.login(UCET);

  const mapa = (await inst.api('POST', '/api/collections/goalmaps/records', { token: T, body: {
    title: 'Hrdla mapa',
    nodes: [
      { id: 'apex', type: 'apexNode', position: { x: 400, y: 0 }, data: { nodeType: 'apex', apexText: 'PROJEKT HRDLA', title: 'PROJEKT HRDLA', status: 'todo' } },
      { id: 'real1', type: 'goalNode', position: { x: 100, y: 300 }, data: { title: 'HRDLO PO TERMINU', status: 'in_progress', deadline: den(-3), owner: UCET } },
      { id: 'r1a', type: 'goalNode', position: { x: 0, y: 600 }, data: { title: 'Podkrok A', status: 'todo' } },
      { id: 'r1b', type: 'goalNode', position: { x: 200, y: 600 }, data: { title: 'Podkrok B', status: 'todo' } },
      { id: 'pot1', type: 'goalNode', position: { x: 500, y: 300 }, data: { title: 'VETVENI BEZ TERMINU', status: 'todo' } },
      { id: 'p1a', type: 'goalNode', position: { x: 420, y: 600 }, data: { title: 'Vetev A', status: 'todo' } },
      { id: 'p1b', type: 'goalNode', position: { x: 600, y: 600 }, data: { title: 'Vetev B', status: 'todo' } },
      { id: 'done1', type: 'goalNode', position: { x: 850, y: 300 }, data: { title: 'HOTOVY UZEL', status: 'done', deadline: den(-9), owner: UCET } },
      { id: 'd1a', type: 'goalNode', position: { x: 850, y: 600 }, data: { title: 'Po hotovem', status: 'todo' } },
      { id: 'list1', type: 'goalNode', position: { x: 1050, y: 300 }, data: { title: 'SAMOTNY LIST', status: 'todo' } },
    ],
    edges: [
      { id: 'e1', source: 'apex', target: 'real1' }, { id: 'e2', source: 'real1', target: 'r1a' },
      { id: 'e3', source: 'real1', target: 'r1b' }, { id: 'e4', source: 'apex', target: 'pot1' },
      { id: 'e5', source: 'pot1', target: 'p1a' }, { id: 'e6', source: 'pot1', target: 'p1b' },
      { id: 'e7', source: 'apex', target: 'done1' }, { id: 'e8', source: 'done1', target: 'd1a' },
      { id: 'e9', source: 'apex', target: 'list1' },
    ],
  } })).json;
  expect(!!mapa.id, 'mapa s hrdly založena');

  const { page, chyby } = await H.browser();
  await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email');
  await page.type('#email', UCET);
  await page.type('#password', H.PW);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1200);

  console.log('== otevřená mapa: reálné hrdlo svítí, potenciální ne, tlačítko zhasnuté ==');
  await page.goto(`${inst.base}/map/${mapa.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="toolbar-bottlenecks"]', { timeout: 20000 });
  await sleep(1500);

  const stav0 = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="toolbar-bottlenecks"]');
    const text = document.body.innerText || '';
    return {
      zapnuto: btn ? btn.dataset.zapnuto : null,
      pocitadlo: btn ? (btn.textContent || '').replace(/\D+/g, '') : '',
      realBadge: (text.match(/Úzké hrdlo/g) || []).length,
      potBadge: (text.match(/Potenciální hrdlo/g) || []).length,
      kritHrany: document.querySelectorAll('[data-stav-hrany="bottleneck"]').length,
    };
  });
  expect(stav0.zapnuto === '0', `tlačítko po načtení NENÍ zapnuté (data-zapnuto=${stav0.zapnuto})`);
  expect(stav0.pocitadlo === '1', `počítadlo = 1 reálné hrdlo (${stav0.pocitadlo})`);
  expect(stav0.realBadge >= 1, `červený odznak „Úzké hrdlo" svítí bez přepínače (${stav0.realBadge}×)`);
  expect(stav0.potBadge === 0, `oranžové odznaky před zapnutím NEsvítí (${stav0.potBadge}×)`);
  expect(stav0.kritHrany === 0, `kritická cesta se před zapnutím nekreslí (${stav0.kritHrany} hran)`);

  console.log('== zapnout 🔥: oranžová + kritická cesta jen k reálnému ==');
  const btn = await page.$('[data-testid="toolbar-bottlenecks"]');
  await btn.click();
  await sleep(1000);
  const stav1 = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="toolbar-bottlenecks"]');
    const text = document.body.innerText || '';
    return {
      zapnuto: b ? b.dataset.zapnuto : null,
      potBadge: (text.match(/Potenciální hrdlo/g) || []).length,
      kritHrany: document.querySelectorAll('[data-stav-hrany="bottleneck"]').length,
      hotovyOznacen: /HOTOVY UZEL/.test(text),
    };
  });
  expect(stav1.zapnuto === '1', `tlačítko po kliknutí zapnuté (data-zapnuto=${stav1.zapnuto})`);
  expect(stav1.potBadge === 1, `právě 1 potenciální hrdlo — větvení ≥2 (${stav1.potBadge}×)`);
  // hrany apex→real1, real1→r1a, real1→r1b se dotýkají reálného hrdla = 3;
  // k potenciálnímu (pot1) se kritická cesta NEkreslí
  expect(stav1.kritHrany === 3, `kritická cesta jen k reálnému hrdlu (${stav1.kritHrany} hran, čeká se 3)`);
  expect(stav1.hotovyOznacen, 'hotový uzel v mapě je (jen bez odznaku)');

  // hotový uzel ani samotný list odznak nemají — celkem odznaků = 1 červený + 1 oranžový
  const odznaky = await page.evaluate(() => (document.body.innerText.match(/Úzké hrdlo|Potenciální hrdlo/g) || []).length);
  expect(odznaky === 2, `celkem právě 2 odznaky — hotový uzel a list nic (${odznaky})`);

  console.log('== vypnout 🔥: oranžová zmizí, červená zůstane ==');
  await btn.click();
  await sleep(800);
  const stav2 = await page.evaluate(() => ({
    potBadge: ((document.body.innerText || '').match(/Potenciální hrdlo/g) || []).length,
    realBadge: ((document.body.innerText || '').match(/Úzké hrdlo/g) || []).length,
    kritHrany: document.querySelectorAll('[data-stav-hrany="bottleneck"]').length,
  }));
  expect(stav2.potBadge === 0 && stav2.kritHrany === 0, `po vypnutí oranžová i cesta pryč (${stav2.potBadge}/${stav2.kritHrany})`);
  expect(stav2.realBadge >= 1, 'červené hrdlo svítí dál i po vypnutí');

  expect(chyby.length === 0, `konzole bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 160) : ''})`);
}, { nazev: 'UI-HRDLA-MAPA' });
