// UI e2e (headless Chrome, own temporary profile) against a FAKE ollama: the assistant panel does
// not lose the conversation, the typed message or the stored memory when a request fails (code
// analysis 4, F2-01, F2-02, F2-03).
//
// Before the fix:
//   · a short outage while sending: the panel "forgot" the conversation (and `kb-chat-id`), the
//     typed message was gone and the next one started a new conversation without history;
//   · a message the server refused (hourly cap 429, 402, 400) vanished from the field and the screen;
//   · the memory: a failed load looked like an empty memory with Save enabled (saving replaced
//     the stored one), a failed save said nothing.
// The person's path: real typing and clicks; the outage is the browser's offline mode, a server
// refusal is the real hourly cap plus forged answers. The model is only the mock.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

let odpovedi = 0;
const mockHandler = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  odpovedi += 1;
  res.end(JSON.stringify({ message: { role: 'assistant', content: `ODPOVED-${odpovedi}.` }, prompt_eval_count: 100, eval_count: 20, done: true }));
};

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ui-chyby4-asistent', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 3,
  } });
  await inst.register('sef@example.com', { name: 'Šéf' });
  const ST = await inst.superuser();
  const { browser } = await H.browser();
  const S = await E.clovek(browser, inst, 'sef@example.com', null, { viewport: { width: 1400, height: 900 } });
  const { page } = S;

  // forged answers: podvrh = [{ method, url: RegExp, status, body, abort }]
  let podvrh = [];
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    const p = podvrh.find((x) => x.method === rq.method() && x.url.test(rq.url()));
    if (p && p.abort) { rq.abort('failed').catch(() => {}); return; }
    if (p) { rq.respond({ status: p.status, contentType: 'application/json', body: JSON.stringify(p.body || {}) }).catch(() => {}); return; }
    rq.continue().catch(() => {});
  });

  const cekejSel = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const textPanelu = () => page.evaluate(() => document.querySelector('[data-testid="chat-panel"]')?.innerText || '');
  const cekejText = (s, ms = 20000) => E.cekej(async () => (await textPanelu()).includes(s), ms, `text ${s}`);
  const napis = async (t) => { await page.click('[data-testid="chat-input"]'); await page.keyboard.type(t); await page.keyboard.press('Enter'); };
  const pole = () => page.$eval('[data-testid="chat-input"]', (el) => el.value);
  const chybaTxt = () => page.evaluate(() => (document.querySelector('[data-testid="chat-chyba"]') || {}).textContent || '');
  const lsChat = () => page.evaluate(() => localStorage.getItem('kb-chat-id') || '');
  const chaty = async () => (await inst.api('GET', '/api/collections/ai_chats/records?perPage=50', { token: ST })).json.items || [];
  const zpravyUzivatele = (rec) => ((rec && rec.messages) || []).filter((m) => m.role === 'user').map((m) => m.content);
  const otevriPanel = async () => {
    await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
    if (!(await cekejSel('[data-testid="chat-panel"]', 4000))) { await cekejSel('[data-testid="chat-tab"]'); await (await page.$('[data-testid="chat-tab"]')).click(); }
    const ok = await cekejSel('[data-testid="chat-input"]');
    if (await page.$('[data-testid="chat-porada-ne"]')) { await page.click('[data-testid="chat-porada-ne"]'); await sleep(400); }
    return ok;
  };
  // Enter on what is in the field, until the reply is there (after an outage the panel first re-checks the AI)
  const odesliZPole = async (cekanyText, ms = 40000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if ((await textPanelu()).includes(cekanyText)) return true;
      if (await pole()) { await page.click('[data-testid="chat-input"]'); await page.keyboard.press('Enter'); }
      await sleep(1500);
    }
    return (await textPanelu()).includes(cekanyText);
  };

  console.log('== F2-01: krátký výpadek sítě při odeslání zprávy ==');
  expect(await otevriPanel(), 'panel asistenta otevřený');
  await napis('Ahoj, první zpráva');
  expect(await cekejText('ODPOVED-1.'), 'první odpověď v panelu');
  const chatId = await lsChat();
  expect(!!chatId, 'panel drží id rozhovoru');
  await page.setOfflineMode(true);
  await napis('Druhá zpráva při výpadku');
  expect(await E.cekej(async () => (await chybaTxt()) !== '', 10000, 'hláška'), 'výpadek: panel ukázal hlášku');
  const hlaska = await chybaTxt();
  expect(/neodešla/.test(hlaska) && /spojení/.test(hlaska), `výpadek: hláška je srozumitelná („${hlaska.slice(0, 110)}“)`);
  expect((await pole()) === 'Druhá zpráva při výpadku', `výpadek: napsaná zpráva je zpátky v políčku („${await pole()}“)`);
  const panelOff = await textPanelu();
  expect(panelOff.includes('Ahoj, první zpráva') && panelOff.includes('ODPOVED-1.'), 'výpadek: rozhovor v panelu zůstal');
  expect((await lsChat()) === chatId, `výpadek: panel si dál pamatuje TENTÝŽ rozhovor (kb-chat-id „${await lsChat()}“)`);
  await page.setOfflineMode(false);
  // the browser's `online` event: headless offline emulation flips navigator.onLine but does not fire it
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  expect(await E.cekej(() => page.evaluate(() => !/AI teď neodpovídá/.test(document.querySelector('[data-testid="chat-panel"]').innerText)), 10000, 'pruh výpadku pryč'), 'po návratu spojení pruh „AI teď neodpovídá“ zmizí sám (bez čekání 2 minuty)');
  expect(await odesliZPole('ODPOVED-2.'), 'po návratu spojení jde tatáž zpráva odeslat a asistent odpoví');
  expect((await lsChat()) === chatId, 'odpověď přišla do TÉHOŽ rozhovoru');
  let vsechny = await chaty();
  expect(vsechny.length === 1, `na serveru je pořád jeden rozhovor (${vsechny.length})`);
  const u1 = zpravyUzivatele(vsechny.find((c) => c.id === chatId));
  expect(u1.length === 2 && u1[0] === 'Ahoj, první zpráva' && u1[1] === 'Druhá zpráva při výpadku', `rozhovor nese obě zprávy, každou jednou (${JSON.stringify(u1)})`);
  const posledni = JSON.parse(mock.pozadavky[mock.pozadavky.length - 1].body || '{}');
  expect(JSON.stringify(posledni.messages || []).includes('Ahoj, první zpráva'), 'model dostal s druhou zprávou i historii rozhovoru');

  console.log('== F2-01: obnovení stránky ve chvíli, kdy server rozhovor nevydá ==');
  podvrh = [{ method: 'GET', url: /\/api\/kb\/chat\/[a-z0-9]{15}(\?|$)/, abort: true }];
  expect(await otevriPanel(), 'stránka obnovena, panel otevřený (načtení rozhovoru selhalo)');
  await sleep(1500);
  expect((await lsChat()) === chatId, `panel rozhovor nezapomněl (kb-chat-id „${await lsChat()}“)`);
  podvrh = [];
  await napis('Třetí zpráva po obnovení');
  expect(await cekejText('ODPOVED-3.'), 'třetí zpráva odešla a asistent odpověděl');
  vsechny = await chaty();
  expect(vsechny.length === 1 && zpravyUzivatele(vsechny[0]).length === 3, `třetí zpráva šla do téhož rozhovoru (rozhovorů ${vsechny.length}, zpráv uživatele ${zpravyUzivatele(vsechny[0]).length})`);
  expect((await textPanelu()).includes('Ahoj, první zpráva'), 'panel po odpovědi ukazuje celý rozhovor i s historií');

  console.log('== F2-02: zpráva odmítnutá serverem (skutečný hodinový strop 429) ==');
  await napis('Čtvrtá zpráva nad hodinový strop');
  expect(await E.cekej(async () => /hodinový strop/.test(await chybaTxt()), 10000, 'hláška stropu'), `429: hláška říká proč („${(await chybaTxt()).slice(0, 80)}“)`);
  expect((await pole()) === 'Čtvrtá zpráva nad hodinový strop', `429: text je zpátky v políčku („${await pole()}“)`);
  expect((await textPanelu()).includes('ODPOVED-3.') && (await lsChat()) === chatId, '429: rozhovor zůstal');
  expect(zpravyUzivatele((await chaty())[0]).length === 3, '429: na serveru odmítnutá zpráva není (nic se nezdvojí)');

  console.log('== F2-02: další odmítnutí (podvržená odpověď 402 a 400) ==');
  await page.click('[data-testid="chat-input"]', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  podvrh = [{ method: 'POST', url: /\/api\/kb\/chat$/, status: 402, body: { error: 'Předplatné skončilo. Obnovte ho ve Správě.' } }];
  await napis('Pátá zpráva bez předplatného');
  expect(await E.cekej(async () => /Předplatné skončilo/.test(await chybaTxt()), 10000, 'hláška 402'), `402: panel ukázal větu serveru („${(await chybaTxt()).slice(0, 60)}“)`);
  expect((await pole()) === 'Pátá zpráva bez předplatného', `402: text je zpátky v políčku („${await pole()}“)`);
  podvrh = [{ method: 'POST', url: /\/api\/kb\/chat$/, status: 400, body: { error: 'Zpráva je příliš dlouhá.' } }];
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.press('Enter');
  expect(await E.cekej(async () => /příliš dlouhá/.test(await chybaTxt()), 10000, 'hláška 400'), '400: panel ukázal větu serveru');
  expect((await pole()) === 'Pátá zpráva bez předplatného', `400: text v políčku zůstal („${await pole()}“)`);
  podvrh = [];
  await page.click('[data-testid="chat-input"]', { clickCount: 3 });
  await page.keyboard.press('Backspace');

  console.log('== F2-03: paměť asistenta — chyba načtení a chyba uložení ==');
  const PAMET = 'KLIENT NOVAK PLATI DO 14 DNU. Preferuji strucne odpovedi.';
  expect((await inst.api('POST', '/api/kb/chat/pamet', { token: S.token, body: { text: PAMET } })).status === 200, 'paměť uložena přes API');
  const pametServer = async () => ((await inst.api('GET', '/api/kb/chat/pamet', { token: S.token })).json || {}).text || '';
  podvrh = [{ method: 'GET', url: /\/api\/kb\/chat\/pamet/, status: 500, body: { error: 'Chyba serveru.' } }];
  await page.click('[data-testid="chat-dokumenty-btn"]');
  await cekejSel('[data-testid="chat-dokumenty"]');
  if (await page.$('[data-testid="chat-dok-zpet"]')) await page.click('[data-testid="chat-dok-zpet"]');
  expect(await cekejSel('[data-testid="chat-dok-pamet"]'), 'v Dokumentech je odkaz na paměť');
  await page.click('[data-testid="chat-dok-pamet"]');
  expect(await cekejSel('[data-testid="chat-pamet"]'), 'pohled paměti otevřen (načtení selhalo: 500)');
  expect(await cekejSel('[data-testid="chat-pamet-chyba"]', 8000), 'nepovedené načtení se ukáže jako CHYBA');
  expect(!(await page.$('[data-testid="chat-pamet-text"]')), 'prázdný formulář („Zatím nic…“) se neukáže');
  expect(await page.$eval('[data-testid="chat-pamet-uloz"]', (b) => b.disabled), '„Uložit“ je zakázané, dokud se paměť nenačte');
  expect((await pametServer()) === PAMET, 'paměť na serveru je netknutá');
  podvrh = [];
  await page.click('[data-testid="chat-pamet-znovu"]');
  expect(await cekejSel('[data-testid="chat-pamet-text"]', 8000) && (await page.$eval('[data-testid="chat-pamet-text"]', (el) => el.value)) === PAMET, '„Zkusit znovu“ paměť načte i s uloženým textem');
  expect(!(await page.$eval('[data-testid="chat-pamet-uloz"]', (b) => b.disabled)), 'po načtení je „Uložit“ povolené');
  podvrh = [{ method: 'POST', url: /\/api\/kb\/chat\/pamet/, status: 500, body: { error: 'Chyba serveru.' } }];
  await page.click('[data-testid="chat-pamet-text"]');
  await page.keyboard.press('End');
  await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control');
  await page.keyboard.type(' Rikej mi Petre.');
  await page.click('[data-testid="chat-pamet-uloz"]');
  expect(await cekejSel('[data-testid="chat-pamet-chyba-ulozeni"]', 8000), 'nepovedené uložení je VIDĚT');
  expect((await page.$eval('[data-testid="chat-pamet-text"]', (el) => el.value)) === `${PAMET} Rikej mi Petre.`, 'napsaný text v poli zůstal');
  expect((await pametServer()) === PAMET, 'na serveru je dál původní paměť');
  podvrh = [];
  await page.click('[data-testid="chat-pamet-uloz"]');
  expect(await E.cekej(async () => (await pametServer()) === `${PAMET} Rikej mi Petre.`, 8000, 'uložení paměti'), 'druhý pokus paměť uložil');
  expect(await E.cekej(async () => !(await page.$('[data-testid="chat-pamet-chyba-ulozeni"]')), 5000, 'hláška pryč'), 'hláška o chybě uložení zmizela');
}, { nazev: 'UI-CHYBY4-ASISTENT' });
