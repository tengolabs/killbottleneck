// Potvrzení karty bez modelu (5. 10. 2026) — klikací sada (Puppeteer) proti PODVRŽENÉ ollamě.
// Produkční výchozí KB_CHAT_POTVRZENI=app: po „Ano“ u jednoduché akce (přidání kroků) aplikace sama
// dopoví „Hotovo.“ + čipy „Co dál?“ a model se nevolá; klik na čip pošle zprávu dál modelu.
// U akce, kde má dopovědět model (termín kroku → připomínka), se model volá jako dřív.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ui-ai-potvrzeni.js
const H = require('./_harness');
const { expect, sleep } = H;

const fronta = [];
const volani = [];
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const text = (s) => ({ content: s });
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  const b = JSON.parse(body);
  volani.push(b);
  const o = fronta.shift() || text('(fronta prázdná)');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 100, eval_count: 20, done: true }));
};

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ui-potvrzeni', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0,
    KB_CHAT_POTVRZENI: null, // produkční výchozí = app
  } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  const A = await inst.login('admin@example.com');
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Truhlářství', nodes: [
      { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň Dvořákovi', title: 'Kuchyň Dvořákovi', status: 'todo' } },
      { id: 'n1', type: 'goalNode', position: { x: 0, y: 700 }, data: { title: 'Poslat poptávku', status: 'todo', owner: 'admin@example.com' } },
    ], edges: [{ id: 'e1', source: 'root', target: 'n1' }] } })).json;
  expect(!!map.id, 'mapa založena');

  const { page, chyby } = await H.browser();
  await page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); localStorage.setItem('kb-chat-porada-ne', new Date().toISOString().slice(0, 10)); }, A);
  const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const textPanelu = () => page.evaluate(() => document.querySelector('[data-testid="chat-panel"]')?.innerText || '');
  const cekejText = async (s, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await textPanelu()).includes(s)) return true; await sleep(300); } return false; };

  console.log('== panel ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-tab"]'), 'ouško panelu');
  await (await page.$('[data-testid="chat-tab"]')).click();
  expect(await cekej('[data-testid="chat-panel"]'), 'panel otevřený');
  const nabidka = await page.$('[data-testid="chat-porada-ne"]');
  if (nabidka) { await nabidka.click(); await sleep(300); }

  console.log('== jednoduchá akce: karta → Ano → „Hotovo.“ od aplikace, model se nevolá ==');
  fronta.push(nastroj('add_nodes', { map_id: 'Truhlářství', parent_id: 'apex', items: [{ title: 'Objednat kování' }, { title: 'Objednat lak' }] }));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Přidej kroky Objednat kování a Objednat lak');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-akce"][data-stav="ceka"]'), 'karta akce čeká na potvrzení');
  const volaniPred = volani.length;
  await page.click('[data-testid="chat-akce-ano"]');
  expect(await cekej('[data-testid="chat-akce"][data-stav="hotovo"]', 15000), 'po Ano je karta hotovo');
  expect(await cekejText('Hotovo.'), 'panel ukazuje „Hotovo.“ od aplikace');
  await sleep(500);
  expect(volani.length === volaniPred, `model se po potvrzení nevolal (${volani.length - volaniPred} volání)`);
  expect(await cekej('[data-testid="chat-navrh"]'), 'pod „Hotovo.“ jsou čipy');
  const cipy = await page.$$eval('[data-testid="chat-navrh"]', (els) => els.map((x) => x.innerText.trim()));
  expect(cipy.includes('Co dál?'), `čip „Co dál?“ (${cipy.join(' | ')})`);
  const mapPo = (await inst.api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
  expect(mapPo.nodes.length === 4 && mapPo.nodes.some((n) => n.data.title === 'Objednat lak'), 'oba kroky jsou v mapě');
  expect(!(await page.$('[data-testid="chat-chyba"]')) && !(await textPanelu()).includes('Asistent neodpověděl'), 'žádná chyba v panelu');

  console.log('== klik na čip „Co dál?“ → zpráva modelu, model odpoví ==');
  fronta.push(text('NAVRH-MOCK: zavolat dodavateli.'));
  const chip = (await page.$$('[data-testid="chat-navrh"]')).pop();
  await chip.click();
  expect(await cekejText('NAVRH-MOCK'), 'po klepnutí na čip odpověděl model');
  const poslUser = volani[volani.length - 1].messages.filter((m) => m.role === 'user').pop();
  expect(/Co dál\?/.test(poslUser.content), 'čip poslal modelu zprávu „Co dál?“');
  expect(volani[volani.length - 1].messages.some((m) => m.role === 'assistant' && m.content === 'Hotovo.'), 'model vidí „Hotovo.“ aplikace v historii');

  console.log('== termín kroku → dopovídá model (jako dřív) ==');
  fronta.push(nastroj('update_node', { map_id: 'Truhlářství', node_id: 'Objednat kování', deadline: '2026-10-20' }));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Objednat kování do 20. 10.');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-akce"][data-stav="ceka"]'), 'karta termínu čeká');
  fronta.push(text('TERMIN-MOCK: nastaveno, chceš připomínku?'));
  const volaniPred2 = volani.length;
  await page.click('[data-testid="chat-akce-ano"]');
  expect(await cekejText('TERMIN-MOCK'), 'u termínu dopověděl model');
  expect(volani.length === volaniPred2 + 1, `model volán jednou (${volani.length - volaniPred2})`);

  console.log('== reload: „Hotovo.“ zůstává v historii rozhovoru ==');
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-panel"]'), 'panel po reloadu');
  expect(await cekejText('Hotovo.'), '„Hotovo.“ je v uložené historii');

  const vazne = chyby.filter((c) => !/favicon|net::ERR_ABORTED|404/.test(c));
  expect(vazne.length === 0, `konzole bez chyb (${vazne.slice(0, 2).join(' | ')})`);
});
