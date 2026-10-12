// UI e2e: z mapy do seznamu úkolů JEN tohoto projektu a zpět do mapy (telefon).
// Ikona „Úkoly projektu" v levé liště mapy vede na /tasks?map=<id>; stránka Úkoly
// ukáže pruh s názvem projektu + „Zpět do mapy" (a šipku v hlavičce), zpět
// vede na /map/<id>. × v pruhu vrátí seznam na všechny projekty a uklidí ?map=.
// (Richard 10. 10. 2026: na telefonu se ze seznamu úkolů nešlo vrátit do mapy.)
const { expect, sleep, startInstance, browser, beh } = require('./_harness');

const registrace = async (page, base, email) => {
  await page.goto(`${base}/register`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email');
  await page.type('#email', email);
  await page.type('#password', 'testheslo123');
  await page.type('#confirm', 'testheslo123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1200);
};

const zalozMapu = (page, title) => page.evaluate(async (title) => {
  const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
  const r = await fetch('/api/collections/goalmaps/records', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth.token },
    body: JSON.stringify({
      title,
      nodes: [
        { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: title, title, status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Krok projektu ' + title, status: 'todo' } },
      ],
      edges: [{ id: 'e1', source: 'apex', target: 'n1', type: 'deletable' }],
    }),
  });
  return (await r.json()).id;
}, title);

beh(async () => {
  const inst = await startInstance({ slug: 'ukoly-projektu', env: { KB_UVODNI_MAPA: 0 } });
  const { page, chyby } = await browser({ mobil: true });
  await registrace(page, inst.base, 'admin@e2e.cz');
  const idA = await zalozMapu(page, 'Pekarna ZALEZ');
  const idB = await zalozMapu(page, 'Kavarna JINA');
  expect(idA && idB, 'dvě mapy založené přes API');

  // 1) v mapě je ikona Úkoly projektu v levé liště
  await page.goto(`${inst.base}/map/${idA}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="rail-ukoly-projektu"]', { visible: true, timeout: 15000 });
  const titulek = await page.$eval('[data-testid="rail-ukoly-projektu"]', (b) => b.title);
  expect(titulek.startsWith('Úkoly tohoto projektu'), `ikona má popisek „Úkoly tohoto projektu" (${titulek})`);

  // 2) klik → /tasks?map=<id>, pruh s názvem projektu, seznam jen tohoto projektu
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('[data-testid="rail-ukoly-projektu"]')]);
  await page.waitForSelector('[data-testid="tasks-projekt-pruh"]', { visible: true, timeout: 15000 });
  expect(page.url().includes(`/tasks?map=${idA}`), `adresa nese projekt (${page.url()})`);
  const nazev = await page.$eval('[data-testid="tasks-projekt-nazev"]', (e) => e.textContent.trim());
  expect(nazev === 'Pekarna ZALEZ', `pruh ukazuje název projektu (${nazev})`);
  await sleep(800);
  const text = await page.evaluate(() => document.body.innerText);
  expect(text.includes('Krok projektu Pekarna ZALEZ'), 'v seznamu je krok tohoto projektu');
  expect(!text.includes('Krok projektu Kavarna JINA'), 'krok DRUHÉHO projektu v seznamu není');
  // šipka v hlavičce (backTo) vede do mapy — hlavička má jen jednu ikonovou šipku vlevo
  const sipka = await page.evaluate(() => !!document.querySelector('[data-app-header] button svg.lucide-arrow-left'));
  expect(sipka, 'hlavička má šipku zpět');

  // 3) Zpět do mapy → /map/<id>
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('[data-testid="tasks-zpet-do-mapy"]')]);
  await sleep(500);
  expect(page.url().includes(`/map/${idA}`), `Zpět do mapy vede do TÉŽE mapy (${page.url()})`);
  await page.waitForSelector('[data-testid="editor-koren"]', { timeout: 15000 });

  // 4) × „Všechny projekty" uklidí filtr i adresu
  await page.goto(`${inst.base}/tasks?map=${idB}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="tasks-vsechny-projekty"]', { visible: true, timeout: 15000 });
  await page.click('[data-testid="tasks-vsechny-projekty"]');
  await sleep(600);
  expect(!(await page.$('[data-testid="tasks-projekt-pruh"]')), 'po × pruh zmizel');
  expect(!page.url().includes('map='), `po × je adresa bez ?map= (${page.url()})`);
  const textVse = await page.evaluate(() => document.body.innerText);
  expect(textVse.includes('Krok projektu Pekarna ZALEZ') && textVse.includes('Krok projektu Kavarna JINA'), 'seznam zase ukazuje oba projekty');

  // 5) počítač: pruh i tam, hlavička se šipkou
  const { page: pc } = await browser({});
  await registrace(pc, inst.base, 'druhy@e2e.cz');
  const idC = await zalozMapu(pc, 'Pocitac MAPA');
  await pc.goto(`${inst.base}/map/${idC}`, { waitUntil: 'networkidle2' });
  await pc.waitForSelector('[data-testid="rail-ukoly-projektu"]', { visible: true, timeout: 15000 });
  await Promise.all([pc.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), pc.click('[data-testid="rail-ukoly-projektu"]')]);
  await pc.waitForSelector('[data-testid="tasks-projekt-pruh"]', { visible: true, timeout: 15000 });
  expect(pc.url().includes(`/tasks?map=${idC}`), 'počítač: ikona vede na úkoly projektu');

  expect(chyby.length === 0, `bez chyb v konzoli (${chyby.slice(0, 2).join(' | ')})`);
}, { nazev: 'UI úkoly projektu ↔ mapa' });
