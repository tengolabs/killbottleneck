// AI kredity ve Správě organizace — klikací sada (Puppeteer): sekce se ukáže
// adminovi, čísla po lidech odpovídají spotřebě chatu, kvótu a podíl správců
// nastaví KLÁVESNICÍ, uložení přežije reload, rozdělení kreditů se přepočítá,
// vyčerpaná kvóta se v panelu asistenta ukáže lidskou hláškou, konzole bez chyb.
const H = require('./_harness');
const { expect, sleep } = H;

const fronta = [];
const text = (s) => ({ content: s });
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  JSON.parse(body);
  const o = fronta.shift() || text('ODPOVED.');
  res.end(JSON.stringify({ message: { role: 'assistant', content: o.content || '' }, prompt_eval_count: 111, eval_count: 22, done: true }));
};

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ui-kredity', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0, KB_AI_MAX_PER_HOUR: 500,
  } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  await inst.register('clen@example.com', { name: 'Jana Malá' });
  const A = await inst.login('admin@example.com');
  const B = await inst.login('clen@example.com');
  for (let i = 0; i < 3; i++) await inst.api('POST', '/api/kb/chat', { token: B, body: { message: 'Ahoj ' + i, context: { route: '/' } } });
  await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Ahoj', context: { route: '/' } } });

  const { page, chyby } = await H.browser();
  await page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); }, A);
  const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const txt = (sel) => page.evaluate((s) => document.querySelector(s)?.innerText || '', sel);
  const cekejText = async (sel, re, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await txt(sel))) return true; await sleep(200); } return false; };

  console.log('== sekce AI kredity ve Správě organizace ==');
  await page.goto(`${inst.base}/admin/users`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="ai-kredity"]'), 'sekce AI kredity je na stránce');
  expect(await cekej('[data-testid="ai-kredity-lide"]'), 'tabulka po lidech');
  expect(await cekejText('[data-testid="ai-kredity-celkem-n"]', /0[,.]19/), `celek organizace 4 tahy ≈ 0,19 kreditu (${await txt('[data-testid="ai-kredity-celkem-n"]')})`);
  const radky = await page.$$('[data-testid="ai-kredity-clovek"]');
  expect(radky.length === 2, `dva lidé v tabulce (${radky.length})`);
  const prvni = await page.evaluate(() => document.querySelector('[data-testid="ai-kredity-clovek"]')?.getAttribute('data-email'));
  expect(prvni === 'clen@example.com', 'Jana (3 tahy) je první');
  const janaKr = await page.evaluate(() => document.querySelector('[data-testid="ai-kredity-clovek"] [data-testid="ai-kredity-clovek-kredity"]')?.innerText);
  expect(/0[,.]14/.test(janaKr), `Jana 3 tahy ≈ 0,14 kreditu (${janaKr})`);
  expect(/bez stropu|no limit/i.test(await txt('[data-testid="ai-kredity-rozdeleni"]')), 'výchozí = bez stropu');
  expect(/1 lidí|1 people/.test(await txt('[data-testid="ai-kredity-admin"]')) && /1 lidí|1 people/.test(await txt('[data-testid="ai-kredity-ostatni"]')), 'skupiny správci 1 · ostatní 1');

  console.log('== nastavení kvóty klávesnicí, uložení přežije reload ==');
  await page.click('[data-testid="ai-kredity-kvota"]', { clickCount: 3 });
  await page.keyboard.type('100');
  await page.click('[data-testid="ai-kredity-podil"]', { clickCount: 3 });
  await page.keyboard.type('30');
  expect(await cekejText('[data-testid="ai-kredity-rozdeleni"]', /30.*70/), `rozdělení se přepočítá živě: správci 30 · ostatní 70 (${await txt('[data-testid="ai-kredity-rozdeleni"]')})`);
  await page.click('[data-testid="ai-kredity-ulozit"]');
  expect(await cekejText('[data-testid="ai-kredity-ulozit"]', /Uloženo|Saved/), 'tlačítko potvrdí Uloženo');
  expect(await cekejText('[data-testid="ai-kredity-admin-n"]', /z 30|of 30/), `skupina správců ukazuje strop 30 (${await txt('[data-testid="ai-kredity-admin-n"]')})`);
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="ai-kredity-kvota"]'), 'po reloadu formulář');
  const hodnoty = await page.evaluate(() => [document.querySelector('[data-testid="ai-kredity-kvota"]').value, document.querySelector('[data-testid="ai-kredity-podil"]').value]);
  expect(hodnoty[0] === '100' && hodnoty[1] === '30', `hodnoty po reloadu 100 / 30 (${hodnoty.join(' / ')})`);
  const ulozeno = (await inst.api('GET', '/api/kb/ai-kredity', { token: A })).json;
  expect(ulozeno.kvota === 100 && ulozeno.podil_admin === 30, 'server drží 100 / 30');

  console.log('== podíl správců 0 % = skupina blokovaná, karta to ukáže (ne „bez stropu“) ==');
  await inst.api('POST', '/api/kb/ai-kredity/nastaveni', { token: A, body: { kvota_tyden: 100, podil_admin: 0 } });
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekejText('[data-testid="ai-kredity-admin-n"]', /z 0 kreditů|of 0 credits/), `správci s podílem 0 % ukazují „x z 0“, ne bez stropu (${await txt('[data-testid="ai-kredity-admin-n"]')})`);

  console.log('== vyčerpaná kvóta v panelu asistenta = lidská hláška ==');
  await inst.api('POST', '/api/kb/ai-kredity/nastaveni', { token: A, body: { kvota_tyden: 1, podil_admin: 1 } });   // správci 0,01 kr → Petr už je nad
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-tab"]'), 'ouško asistenta');
  await page.click('[data-testid="chat-tab"]');
  expect(await cekej('[data-testid="chat-panel"]'), 'panel otevřen');
  if (await page.$('[data-testid="chat-porada-ne"]')) { await page.click('[data-testid="chat-porada-ne"]'); await sleep(200); }
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Ahoj');
  await page.keyboard.press('Enter');
  expect(await cekejText('[data-testid="chat-panel"]', /kvóta AI kreditů pro správce je vyčerpána/, 10000), 'panel ukáže hlášku o vyčerpané kvótě správců (ne obecný hodinový strop)');

  // 429 z vyčerpané kvóty je záměr téhle sady — prohlížeč ho hlásí jako „Failed to load resource“
  const cizi = chyby.filter((c) => !/429/.test(c));
  expect(cizi.length === 0, `konzole bez chyb mimo záměrné 429 (${cizi.slice(0, 2).join(' | ').slice(0, 160)})`);
}, { nazev: 'UI-AI-KREDITY' });
