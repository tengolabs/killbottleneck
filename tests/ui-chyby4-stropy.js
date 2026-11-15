// UI e2e (headless Chrome): project pickers and lists show EVERY project, not the first 200 / 50
// (code analysis 4, wave 7 — the same silent limit as F5-06 on the home page, in seven more places).
//
// Before the fix each of these asked for ONE page of the most recently changed maps, archived ones
// included, and filtered in the browser: with more maps than the limit the older projects were
// missing without a word, and after a round of archiving the archived maps took the whole window.
//
// Fixture: 205 live projects (each with one step assigned to the person), then 205 projects archived
// AFTER them. The person's path: archive + its search, quick add in lite, "My map", the timer's
// project list, the assistant's "New document" and "New page" forms.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

const SEF = 'sef@example.com';
const N = 205;
const c3 = (i) => String(i).padStart(3, '0');
const mockHandler = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  res.end(JSON.stringify({ message: { role: 'assistant', content: '(test)' }, prompt_eval_count: 1, eval_count: 1, done: true }));
};

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ui-chyby4-stropy', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0,
  } });
  await inst.register(SEF, { name: 'Šéf' });
  const T = await inst.login(SEF);
  const zaloz = async (title, krok) => (await inst.api('POST', '/api/collections/goalmaps/records', { token: T, body: { title, edges: [{ id: 'e1', source: 'root', target: 'k1' }], nodes: [
    { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', title, apexText: title, status: 'todo' } },
    { id: 'k1', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: krok, status: 'todo', owner: SEF } },
  ] } })).json;
  let zivych = 0, archivnich = 0, posledni = '';
  for (let i = 1; i <= N; i++) { const m = await zaloz(`Zivy-${c3(i)}`, `Krok-${c3(i)}`); if (m.id) { zivych++; posledni = m.id; } }
  await sleep(1100); // the archived ones are changed LATER than every live one
  const stare = [];
  for (let i = 1; i <= N; i++) { const m = await zaloz(`Stary-${c3(i)}`, `Davno-${c3(i)}`); if (m.id) stare.push(m.id); }
  for (const id of stare) { const r = await inst.api('PATCH', `/api/collections/goalmaps/records/${id}`, { token: T, body: { archived: true } }); if (r.status === 200) archivnich++; }
  expect(zivych === N && archivnich === N, `fixtura: ${zivych} živých projektů, ${archivnich} archivovaných po nich`);

  const { browser } = await H.browser();
  const chyby = [];
  const S = await E.clovek(browser, inst, SEF, chyby);
  const { page } = S;
  const ruzne = (re) => page.evaluate((src) => [...new Set(document.body.innerText.match(new RegExp(src, 'g')) || [])].length, re);
  const volby = (sel) => page.$$eval(`${sel} option`, (os) => os.map((o) => o.textContent.trim()));
  const zivePocet = (list) => list.filter((x) => /^Zivy-\d{3}$/.test(x)).length;

  console.log('== archiv: všechny archivované projekty, hledání najde i ten nejstarší ==');
  await page.goto(`${inst.base}/archive`, { waitUntil: 'networkidle2' });
  await E.cekej(() => page.evaluate(() => /Stary-\d{3}/.test(document.body.innerText)), 20000, 'archiv');
  await E.cekej(async () => (await ruzne('Stary-\\d{3}')) === N, 15000, 'celý archiv');
  const vArchivu = await ruzne('Stary-\\d{3}');
  expect(vArchivu === N, `archiv ukazuje všech ${N} archivovaných projektů (vidět ${vArchivu})`);
  await page.type('[data-testid="archive-search"]', 'Stary-001');
  await sleep(600);
  expect(await page.evaluate(() => document.body.innerText.includes('Stary-001')), 'hledání v archivu najde nejdéle archivovaný projekt „Stary-001“');
  expect(!(await page.$('[data-testid="archive-search-empty"]')), 'a neříká „nic nenalezeno“');

  console.log('== rychlé přidání v lite: nabídka projektů je celá ==');
  await page.goto(`${inst.base}/lite`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('button[aria-label="Nový úkol"]', { timeout: 20000 });
  await page.click('button[aria-label="Nový úkol"]');
  await page.waitForSelector('form select', { timeout: 15000 });
  await E.cekej(async () => zivePocet(await volby('form select')) === N, 10000, 'nabídka lite');
  let v = await volby('form select');
  expect(zivePocet(v) === N, `rychlé přidání nabízí všech ${N} živých projektů (nabízí ${zivePocet(v)})`);
  expect(v.includes('Zivy-001'), 'včetně nejdéle neupraveného „Zivy-001“');
  expect(!v.some((x) => x.startsWith('Stary-')), 'archivované projekty v nabídce nejsou');

  console.log('== Moje mapa: kroky ze všech projektů ==');
  await page.goto(`${inst.base}/my-map`, { waitUntil: 'networkidle2' });
  await E.cekej(() => page.evaluate(() => document.querySelectorAll('.react-flow__node').length > 5), 30000, 'moje mapa');
  await sleep(2500);
  const kroky = await page.evaluate(() => [...new Set([...document.querySelectorAll('.react-flow__node')].map((n) => ((n.innerText || '').match(/Krok-\d{3}/) || [''])[0]).filter(Boolean))]);
  expect(kroky.length === N, `Moje mapa ukazuje můj krok z každého z ${N} projektů (vidět ${kroky.length})`);
  expect(kroky.includes('Krok-001'), 'včetně kroku z nejdéle neupraveného projektu');
  expect(await page.evaluate(() => ![...document.querySelectorAll('.react-flow__node')].some((n) => /Davno-\d{3}/.test(n.innerText || ''))), 'kroky archivovaných projektů v Moje mapa nejsou');

  console.log('== stopky v hlavičce: nabídka projektů je celá ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  const tlacitkoStopek = () => page.evaluateHandle(() => { const i = document.querySelector('header svg.lucide-timer') || document.querySelector('svg.lucide-timer'); return i ? i.closest('button') : null; });
  await E.cekej(async () => !!(await tlacitkoStopek()).asElement(), 15000, 'stopky');
  await (await tlacitkoStopek()).asElement().click(); // start
  await E.cekej(() => page.evaluate(() => !!document.querySelector('svg.lucide-timer.animate-pulse')), 10000, 'běžící stopky');
  await (await tlacitkoStopek()).asElement().click(); // open the popover
  await page.waitForSelector('[role="combobox"]', { timeout: 10000 });
  await sleep(1500); // the lists load when the popover opens
  await page.click('[role="combobox"]');
  await page.waitForSelector('[role="option"]', { timeout: 10000 });
  const uStopek = await page.$$eval('[role="option"]', (os) => os.map((o) => (o.textContent || '').trim()));
  expect(zivePocet(uStopek) === N, `stopky nabízejí všech ${N} živých projektů (nabízejí ${zivePocet(uStopek)})`);
  expect(uStopek.includes('Zivy-001') && !uStopek.some((x) => x.startsWith('Stary-')), 'včetně „Zivy-001“, bez archivovaných');
  await page.keyboard.press('Escape'); await sleep(300); await page.keyboard.press('Escape');
  const bezici = (await inst.api('GET', '/api/collections/time_entries/records?perPage=5', { token: T })).json;
  for (const z of (bezici.items || [])) await inst.api('DELETE', `/api/collections/time_entries/records/${z.id}`, { token: T });

  console.log('== asistent: „Nový dokument“ a „Nová stránka“ nabízejí všechny živé projekty ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => { localStorage.setItem('kb-chat-open', '1'); });
  await page.reload({ waitUntil: 'networkidle2' });
  const cekej = (sel, ms = 15000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  expect(await cekej('[data-testid="chat-panel"]'), 'panel asistenta otevřený');
  if (!(await page.$('[data-testid="chat-dokumenty"]'))) await page.click('[data-testid="chat-dokumenty-btn"]');
  expect(await cekej('[data-testid="chat-dok-novy"]'), 'tlačítko Nový v seznamu dokumentů');
  await page.click('[data-testid="chat-dok-novy"]');
  expect(await cekej('[data-testid="chat-dok-novy-form"]'), 'formulář Nový dokument');
  await page.click('[data-testid="chat-dok-druh"][data-druh="presentation"]');
  await cekej('[data-testid="chat-dok-novy-form"] select');
  await E.cekej(async () => zivePocet(await volby('[data-testid="chat-dok-novy-form"] select')) > 0, 10000, 'nabídka dokumentu');
  await sleep(1000);
  v = await volby('[data-testid="chat-dok-novy-form"] select');
  expect(zivePocet(v) === N, `Nový dokument nabízí všech ${N} živých projektů (nabízí ${zivePocet(v)})`);
  expect(v.includes('Zivy-001') && !v.some((x) => x.startsWith('Stary-')), 'včetně „Zivy-001“, bez archivovaných');
  await page.click('[data-testid="chat-dok-novy-zpet"]');
  await page.click('[data-testid="chat-dok-zalozka"][data-zalozka="stranky"]');
  expect(await cekej('[data-testid="chat-str-nova"]'), 'tlačítko Nová stránka');
  await page.click('[data-testid="chat-str-nova"]');
  expect(await cekej('[data-testid="chat-str-nova-projekt"]'), 'formulář Nová stránka');
  await E.cekej(async () => zivePocet(await volby('[data-testid="chat-str-nova-projekt"]')) > 0, 10000, 'nabídka stránky');
  await sleep(1000);
  v = await volby('[data-testid="chat-str-nova-projekt"]');
  expect(zivePocet(v) === N, `Nová stránka nabízí všech ${N} živých projektů (nabízí ${zivePocet(v)})`);
  expect(v.includes('Zivy-001') && !v.some((x) => x.startsWith('Stary-')), 'včetně „Zivy-001“, bez archivovaných');
  expect((await page.$eval('[data-testid="chat-str-nova-projekt"]', (s) => s.selectedOptions[0] && s.selectedOptions[0].textContent)) === `Zivy-${c3(N)}`, 'předvybraný je naposledy upravený živý projekt');
  void posledni;

  expect(chyby.length === 0, `konzole bez chyb: ${JSON.stringify(chyby.slice(0, 3)).slice(0, 300)}`);
}, { nazev: 'UI-CHYBY4-STROPY' });
