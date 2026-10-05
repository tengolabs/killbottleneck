// Asistent ve ZJEDNODUŠENÉM zobrazení (lite) — klikací sada (Puppeteer, telefon
// 390×844) proti PODVRŽENÉ ollamě (fronta odpovědí jako v ui-ai-chat.js).
//
// Richard 4. 10. 2026: „asistenta tam potřebujeme". Lite má rozpočet prvního
// načtení (tests/lite-bundle.js), proto se panel asistenta (líný chunk
// AsistentPanel-*.js + jazykový balík asistent) NESMÍ stáhnout, dokud uživatel
// neklepne na tlačítko v hlavičce lite. Tahle sada hlídá právě to — a k tomu, že
// zavřený panel v lite nekreslí lištu dole (kolidovala by s navigací lite), že
// se po dalším klepnutí vrátí TENTÝŽ rozhovor (je na serveru) a že v širokém
// okně je lite chat přes celou obrazovku (rozhodnutí Richarda 4. 10.).
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
  const inst = await H.startInstance({ slug: 'ui-lite-asistent', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0,
  } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  const A = await inst.login('admin@example.com');
  const me = (await inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@example.com', password: H.PW } })).json.record;
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Truhlářství', nodes: [
      { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň Dvořákovi', title: 'Kuchyň Dvořákovi', status: 'todo' } },
      { id: 'n1', type: 'goalNode', position: { x: 0, y: 700 }, data: { title: 'Poslat poptávku', status: 'todo', owner: 'admin@example.com' } },
    ], edges: [{ id: 'e1', source: 'root', target: 'n1' }] } })).json;
  const napad = (await inst.api('POST', '/api/collections/buffer_nodes/records', { token: A, body: { title: 'Koupit novou pilu', owner: me.id } })).json;
  expect(!!map.id && !!napad.id, 'mapa a nápad založeny');

  const { page, chyby } = await H.browser({ mobil: true });
  // lite zvolené výslovně + panel plné appky „otevřený" (kb-chat-open=1): lite ho NESMÍ zdědit
  await page.evaluateOnNewDocument((tk) => {
    localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} }));
    localStorage.setItem('kb-mode', 'lite');
    localStorage.setItem('kb-chat-open', '1');
  }, A);
  const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const textPanelu = () => page.evaluate(() => document.querySelector('[data-testid="chat-panel"]')?.innerText || '');
  const cekejText = async (s, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await textPanelu()).includes(s)) return true; await sleep(300); } return false; };
  const chunkPanelu = () => page.evaluate(() => performance.getEntriesByType('resource').some((r) => /AsistentPanel-[^/]*\.js/.test(r.name)));
  const ls = (k) => page.evaluate((kk) => localStorage.getItem(kk), k);

  console.log('== studené /lite: tlačítko Asistent je, panel ani jeho chunk NE ==');
  await page.goto(`${inst.base}/lite`, { waitUntil: 'networkidle2' });
  await sleep(1500);
  expect(await cekej('[data-testid="lite-asistent"]'), 'v hlavičce lite je tlačítko Asistent (server nabízí chat_panel)');
  expect((await page.$('[data-testid="chat-panel"]')) === null && (await page.$('[data-testid="chat-bar"]')) === null && (await page.$('[data-testid="chat-tab"]')) === null,
    'bez klepnutí žádný panel, lišta ani ouško (kb-chat-open plné appky se v lite nedědí)');
  expect(!(await chunkPanelu()), 'chunk AsistentPanel-*.js se NEstáhl (rozpočet lite)');
  expect((await page.evaluate(() => document.body.innerText)).includes('Co mám dnes dělat'), 'seznam lite je vidět');

  console.log('== klepnutí: panel přes celou šířku, chunk teď ano, odpověď z mocku ==');
  await page.click('[data-testid="lite-asistent"]');
  expect(await cekej('[data-testid="chat-panel"]'), 'panel se otevřel');
  expect(await chunkPanelu(), 'chunk AsistentPanel-*.js se stáhl až teď');
  const box = await (await page.$('[data-testid="chat-panel"]')).boundingBox();
  const okno = await page.evaluate(() => window.innerWidth);
  expect(box && Math.round(box.width) === okno, `panel je přes celou šířku telefonu (${box && Math.round(box.width)} / ${okno})`);
  expect((await page.$('[data-testid="chat-resize"]')) === null, 'bez úchytu šířky (telefonní rozvržení)');
  fronta.push(text('LITE-ODPOVED.'));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Co mám dnes dělat?');
  await page.keyboard.press('Enter');
  expect(await cekejText('LITE-ODPOVED'), 'odpověď v panelu');
  const posledni = volani[volani.length - 1];
  const userZ = posledni && [...posledni.messages].reverse().find((m) => m.role === 'user');
  expect(!!userZ && /zjednodušeném zobrazení/.test(userZ.content), `server řekl modelu, kde uživatel je (${userZ && userZ.content.slice(-90).replace(/\n/g, ' ')})`);
  const pocetVolani = volani.length;

  console.log('== zavřít = nic; znovu otevřít = TENTÝŽ rozhovor ==');
  await page.click('[data-testid="chat-zavrit"]');
  await sleep(500);
  expect((await page.$('[data-testid="chat-panel"]')) === null && (await page.$('[data-testid="chat-bar"]')) === null, 'po zavření žádný panel ani lišta');
  expect((await page.evaluate(() => document.body.innerText)).includes('Co mám dnes dělat'), 'seznam lite je zase vidět');
  expect((await ls('kb-chat-open')) === '1', 'zavření v lite nepřepsalo volbu plné appky (kb-chat-open)');
  await page.click('[data-testid="lite-asistent"]');
  expect(await cekej('[data-testid="chat-panel"]') && (await cekejText('LITE-ODPOVED')), 'po dalším klepnutí je v panelu předchozí odpověď');
  expect(volani.length === pocetVolani, `znovuotevření nevolalo model (${volani.length} = ${pocetVolani})`);

  console.log('== karta akce a odkaz do mapy: panel pryč, volba lite zůstává ==');
  fronta.push(nastroj('add_idea_to_map', { idea_id: 'Koupit novou pilu', map_id: 'Truhlářství', parent_id: 'apex' }));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Vlož pilu do projektu');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-akce"][data-stav="ceka"]'), 'karta akce k potvrzení');
  fronta.push(text('VLOZENO.'));
  await page.click('[data-testid="chat-akce-ano"]');
  expect(await cekej('[data-testid="chat-akce-odkaz"]', 15000), 'odkaz Ukázat v mapě');
  await page.click('[data-testid="chat-akce-odkaz"]');
  const t0 = Date.now();
  while (Date.now() - t0 < 10000 && !/\/map\//.test(page.url())) await sleep(200);
  expect(/\/map\//.test(page.url()), `odkaz otevřel mapu v celé aplikaci (${page.url().replace(inst.base, '')})`);
  await sleep(1500);
  // v celé aplikaci platí její vlastní stav (kb-chat-open=1 z přípravy) → panel plné appky je otevřený; lite stav se nepřenáší
  expect(!!(await page.$('[data-testid="chat-panel"]')), 'v celé aplikaci se řídí panel vlastní volbou (kb-chat-open=1 → otevřený)');
  expect((await ls('kb-mode')) === 'lite', 'odkaz NEpřepsal volbu zobrazení (kb-mode zůstal lite)');
  // zpět do lite: panel se NESMÍ otevřít sám (liteOpen se při odchodu z lite vynuluje)
  await page.goto(`${inst.base}/lite`, { waitUntil: 'networkidle2' });
  await sleep(1500);
  expect((await page.$('[data-testid="chat-panel"]')) === null && !!(await page.$('[data-testid="lite-asistent"]')), 'po návratu do lite je panel zavřený a tlačítko zpět na místě');

  console.log('== široké okno s lite: chat přes celou obrazovku (lite = produkt pro telefon) ==');
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(`${inst.base}/lite`, { waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.click('[data-testid="lite-asistent"]');
  expect(await cekej('[data-testid="chat-panel"]'), 'panel v širokém lite okně');
  const boxW = await (await page.$('[data-testid="chat-panel"]')).boundingBox();
  expect(boxW && Math.round(boxW.width) === 1400, `i v širokém okně přes celou šířku (${boxW && Math.round(boxW.width)})`);
  await page.click('[data-testid="chat-zavrit"]');
  await sleep(500);
  expect((await page.$('[data-testid="chat-tab"]')) === null, 'po zavření v širokém lite okně není ouško plné appky');

  console.log('== karta „celá aplikace" z lite odvede do plné appky ==');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${inst.base}/lite`, { waitUntil: 'networkidle2' });
  await sleep(1000);
  await page.click('[data-testid="lite-asistent"]');
  expect(await cekej('[data-testid="chat-panel"]'), 'panel znovu');
  fronta.push(nastroj('set_preference', { co: 'mode', hodnota: 'full' }), text('PLNA.'));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Přepni mě do celé aplikace');
  await page.keyboard.press('Enter');
  const t1 = Date.now();
  while (Date.now() - t1 < 15000 && /\/lite/.test(page.url())) await sleep(200);
  expect(!/\/lite/.test(page.url()) && (await ls('kb-mode')) === 'full', `přepnutí kartou odvedlo z lite (${page.url().replace(inst.base, '')}, kb-mode ${await ls('kb-mode')})`);

  expect(chyby.length === 0, `konzole bez chyb (${chyby.slice(0, 3).join(' | ')})`);
}, { nazev: 'UI-LITE-ASISTENT' });
