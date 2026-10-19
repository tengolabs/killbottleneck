// Asistent bez fungující AI (19. 10. 2026, Richard: „když nefungují hlasovky nebo AI, není vidět celý asistent —
// mohl by být vidět aspoň jako historie a hlásit, že je nefunkční, i kvůli rybkám“). Klikací sada (Puppeteer):
//   A) cloud (KB_HOSTED=1), AI za podvrženou ollamou, která „spadne“: tlačítko v hlavičce zůstane s tečkou,
//      panel ukáže pruh výpadku, historie jde otevřít, „relax“ spustí akvárium, jiný text NEodejde (zůstane v políčku,
//      pruh blikne), čipy porady / AI blok / hlasovka / sponka nejsou; „Roztřídit s AI“ zmizí; po návratu AI
//      „Zkusit znovu“ vrátí plný asistent.
//   B) vlastní instalace bez AI: pruh „AI ještě není připojená“, správce „Připojit AI“ → Správa organizace #ai,
//      člen jen větu o správci; žádné ouško ani spodní lišta (i na telefonu), tlačítko v hlavičce ano.
//   C) cloud bez asistenta: tlačítko se neukáže (výpadek by lhal).
// Texty a rozložení = schválený náhled 8099/kb-asistent-bez-ai.
const H = require('./_harness');
const { expect, sleep } = H;

let dole = false;   // podvržená ollama: true = /api/tags i chat vrací 503
const fronta = [];
const volani = [];
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (dole) { res.statusCode = 503; res.end('{"error":"down"}'); return; }
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  volani.push(JSON.parse(body || '{}'));
  const content = fronta.shift() || '(fronta prázdná)';
  res.end(JSON.stringify({ message: { role: 'assistant', content }, prompt_eval_count: 100, eval_count: 20, done: true }));
};

H.beh(async () => {
  // kontrast textu vůči skutečnému pozadí (složené přes průhledné vrstvy) — klik-test 19. 10.: pevné světlé pozadí
  // pruhu dávalo na tmavém výchozím skinu světlý text na světlém (1,2 : 1); testy „prvek tam je“ to nechytily
  const kontrastPruhu = (page) => page.$eval('[data-testid="chat-stav"]', (e) => {
    const rgb = (x) => (x.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const pozadi = (n) => { const v = []; for (let x = n; x; x = x.parentElement) { const c = rgb(getComputedStyle(x).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0)) { v.push(c); if (c[3] === undefined || c[3] >= 1) break; } } let o = [255, 255, 255]; for (const c of v.reverse()) { const a = c[3] === undefined ? 1 : c[3]; o = o.map((q, i) => q * (1 - a) + c[i] * a); } return o; };
    const k = (n) => { const a = lum(rgb(getComputedStyle(n).color)) + 0.05; const b = lum(pozadi(n)) + 0.05; return Math.max(a, b) / Math.min(a, b); };
    return [...e.querySelectorAll('p, button')].map(k).reduce((m, x) => Math.min(m, x), 99);
  });
  const cekejNa = (page) => async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const prihlas = async (page, token) => page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); }, token);

  // ───────────────────────── A) cloud — výpadek AI ─────────────────────────
  console.log('== A) cloud: AI běží → rozhovor do historie ==');
  const mock = await H.httpMock(mockHandler);
  const ai = { KB_AI_PROVIDER: 'ollama', KB_AI_URL: mock.base, KB_AI_MODEL: 'm-a', KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0 };
  const cloud = await H.startInstance({ slug: 'ui-bezai-cloud', addHostGateway: true, env: { ...ai, KB_HOSTED: 1, KB_SETUP_CODE: 'BEZAI-KOD' } });
  // hostovaná instance pustí první registraci jen s kódem
  const reg = await cloud.register('admin@example.com', { name: 'Petr Novák', setup_code: 'BEZAI-KOD' });
  expect(reg.status === 200, `registrace v cloudu (${reg.status})`);
  const A = await cloud.login('admin@example.com');
  // dva nápady v zásobníku → na domovské stránce se nabízí „Roztřídit s AI“
  const meId = (await cloud.api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@example.com', password: H.PW } })).json.record.id;
  for (const t of ['Koupit lak', 'Zavolat Novákovi']) await cloud.api('POST', '/api/collections/buffer_nodes/records', { token: A, body: { title: t, owner: meId } });
  // mapa: na úzkém okně se otevře v plné aplikaci (domovská stránka by přešla do /lite) → lišta asistenta dole
  const mapaA = (await cloud.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Truhlářství', nodes: [
    { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň', title: 'Kuchyň', status: 'todo' } }], edges: [] } })).json;

  const { page, chyby } = await H.browser();
  const cekej = cekejNa(page);
  await prihlas(page, A);
  // ráno by se samo spustilo akvárium a nabídla porada — tady překáží, den je „už otevřený“
  await page.evaluateOnNewDocument(() => { const d = new Date().toLocaleDateString('en-CA'); for (const k of Object.keys(localStorage)) if (/^kb-relax-rano:|^kb-chat-porada-ne:/.test(k)) localStorage.setItem(k, d); });
  await page.goto(`${cloud.base}/`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-toggle"][data-stav="funkcni"]'), 'AI běží: tlačítko Asistent ve stavu funkční');
  await page.click('[data-testid="chat-toggle"]');
  expect(await cekej('[data-testid="chat-panel"]'), 'panel otevřen');
  if (await page.$('[data-testid="relax-konec"]')) await page.click('[data-testid="relax-konec"]');
  if (await page.$('[data-testid="chat-porada-ne"]')) await page.click('[data-testid="chat-porada-ne"]');
  expect((await page.$('[data-testid="chat-stav"]')) === null, 'funkční asistent nemá pruh stavu');
  fronta.push('HISTORIE-MOCK: kroky pro Dílnu jsou připravené.');
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Rozděl mi projekt Dílna na kroky');
  await page.keyboard.press('Enter');
  const t0 = Date.now(); let odpoved = false;
  while (Date.now() - t0 < 15000 && !odpoved) { odpoved = (await page.evaluate(() => document.querySelector('[data-testid="chat-panel"]')?.innerText || '')).includes('HISTORIE-MOCK'); if (!odpoved) await sleep(300); }
  expect(odpoved, 'asistent odpověděl (rozhovor je na serveru)');
  // zásobník je zavřený panel vlevo — otevřít a najít „Roztřídit s AI“ (2 nápady)
  const otevriZasobnik = async () => { if (!(await page.$('[data-testid="buffer-panel"]'))) { await page.click('[data-testid="buffer-toggle"]'); await cekej('[data-testid="buffer-panel"]', 5000); } await cekej('[data-testid="buffer-item"]', 5000); };
  await otevriZasobnik();
  expect(await cekej('[data-testid="buffer-roztridit"]', 5000), 'AI běží: v zásobníku je „Roztřídit s AI“');

  console.log('== A) AI spadne → po vypršení cache serveru (60 s) a reloadu výpadek ==');
  dole = true;
  await sleep(61000);
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-toggle"][data-stav="vypadek"]'), 'tlačítko Asistent ZŮSTALO, stav výpadek');
  expect(!!(await page.$('[data-testid="chat-toggle-vypadek"]')), 'na tlačítku oranžová tečka');
  const popis = await page.$eval('[data-testid="chat-toggle"]', (b) => b.getAttribute('title'));
  expect(popis === 'Asistent – dočasný výpadek AI', `popisek tlačítka (${popis})`);
  await otevriZasobnik();
  expect((await page.$$('[data-testid="buffer-item"]')).length >= 2, 'zásobník s nápady je vidět i při výpadku');
  expect((await page.$('[data-testid="buffer-roztridit"]')) === null, '„Roztřídit s AI“ se při výpadku schová');
  if (!(await page.$('[data-testid="chat-panel"]'))) await page.click('[data-testid="chat-toggle"]');
  expect(await cekej('[data-testid="chat-stav"][data-stav="vypadek"][data-druh="vypadek"]'), 'pruh výpadku (cloud)');
  const pruh = await page.$eval('[data-testid="chat-stav"]', (e) => e.innerText);
  expect(pruh.includes('Asistent má teď výpadek') && pruh.includes('Historie rozhovorů, Dokumenty a relax fungují dál'), `text pruhu podle náhledu (${pruh.slice(0, 80)}…)`);
  expect(!!(await page.$('[data-testid="chat-stav-zkusit"]')) && !!(await page.$('[data-testid="chat-stav-relax"]')) && !(await page.$('[data-testid="chat-stav-pripojit"]')), 'tlačítka Zkusit znovu + Relax (bez Připojit AI)');
  for (const tema of ['light', 'dark']) {
    await page.evaluate((tm) => { document.documentElement.classList.toggle('dark', tm === 'dark'); }, tema);
    await sleep(200);
    const kp = await kontrastPruhu(page);
    expect(kp >= 4.5, `pruh čitelný ve vzhledu ${tema} (nejhorší kontrast ${kp.toFixed(1)} : 1)`);
  }
  // historie rovnou v panelu (náhled) — klik na položku otevře rozhovor
  expect(await cekej('[data-testid="chat-stav-historie"]'), 've výpadku je seznam historie přímo v panelu');
  await page.click('[data-testid="chat-novy"]');
  await sleep(400);
  await page.click('[data-testid="chat-stav-historie-polozka"]');
  const t3 = Date.now(); let otevren = false;
  while (Date.now() - t3 < 5000 && !otevren) { otevren = (await page.$eval('[data-testid="chat-panel"]', (e) => e.innerText)).includes('HISTORIE-MOCK'); if (!otevren) await sleep(200); }
  expect(otevren, 'klik na rozhovor v historii ho otevře');
  // zavřený panel → ouško na kraji s oranžovou tečkou, otevře ho znovu
  await page.click('[data-testid="chat-zavrit"]');
  expect(await cekej('[data-testid="chat-tab-vypadek"]', 3000), 'zavřený panel: ouško s oranžovou tečkou');
  await page.click('[data-testid="chat-tab"]');
  expect(await cekej('[data-testid="chat-panel"]'), 'ouško panel znovu otevře');
  // otevřený rozhovor z minula je vidět (obnovil se po reloadu)
  const vPanelu = await page.$eval('[data-testid="chat-panel"]', (e) => e.innerText);
  expect(vPanelu.includes('HISTORIE-MOCK'), 'starý rozhovor je vidět i při výpadku');
  // historie v nabídce
  await page.click('[data-testid="chat-historie"]');
  await sleep(400);
  const polozky = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((x) => x.innerText));
  expect(polozky.length >= 1, `historie rozhovorů se načetla (${polozky.length})`);
  await page.keyboard.press('Escape');
  for (const [sel, co] of [['[data-testid="chat-chipy"]', 'čipy'], ['[data-testid="chat-nocni-nabidka"]', 'noční plánování'], ['[data-testid="chat-hlas"]', 'hlasovka'], ['[data-testid="chat-obrazek"]', 'sponka'], ['[data-testid="chat-porada-nabidka"]', 'nabídka porady']]) {
    expect((await page.$(sel)) === null, `při výpadku není ${co}`);
  }
  const ph = await page.$eval('[data-testid="chat-input"]', (e) => e.getAttribute('placeholder'));
  expect(ph === 'Asistent teď neodpovídá · „relax“ funguje', `placeholder políčka (${ph})`);

  console.log('== A) jiný text neodejde, zůstane v políčku, pruh blikne ==');
  const volaniPred = volani.length;
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Co mám dnes dělat?');
  await page.keyboard.press('Enter');
  await sleep(200);
  expect(await page.$eval('[data-testid="chat-input"]', (e) => e.value) === 'Co mám dnes dělat?', 'text zůstal v políčku');
  expect(await page.$eval('[data-testid="chat-stav"]', (e) => e.className.includes('animate-pulse')), 'pruh stavu bliká');
  expect(volani.length === volaniPred, 'nic nešlo modelu');

  // kontrolní panel 19. 10.: když nedorazí ani /api/kb/config (výpadek signálu), asistent dřív úplně zmizel až do reloadu
  console.log('== A) spojení se serverem vypadne: asistent nezmizí ==');
  const chybPred = chyby.length;
  await page.setOfflineMode(true);
  await page.click('[data-testid="chat-stav-zkusit"]');
  await sleep(1500);
  expect(!!(await page.$('[data-testid="chat-stav"][data-stav="vypadek"]')) && !!(await page.$('[data-testid="chat-toggle"][data-stav="vypadek"]')), 'bez spojení zůstane panel s pruhem i tlačítko');
  await page.setOfflineMode(false);
  chyby.splice(chybPred); // nepovedené požadavky bez sítě patří k scénáři

  // kontrolní panel 19. 10.: z lišty na telefonu Enter „nic neudělal“ — pruh v liště není; teď se panel rozbalí
  console.log('== A) úzké okno: mapa, lišta dole při výpadku, Enter rozbalí panel s pruhem ==');
  await page.setViewport({ width: 400, height: 800 });
  await page.evaluate(() => localStorage.setItem('kb-chat-open', '0'));
  await page.goto(`${cloud.base}/map/${mapaA.id}`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="toolbar-asistent-mobil"][data-stav="vypadek"]'), 'mapa: tlačítko Asistent v liště i při výpadku');
  expect(await cekej('[data-testid="chat-bar-vypadek"]'), 'lišta dole s tečkou výpadku');
  await page.click('[data-testid="chat-bar-input"]');
  await page.keyboard.type('Naplánuj mi den');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-panel"] [data-testid="chat-stav"][data-stav="vypadek"]', 3000), 'Enter v liště rozbalil panel s pruhem výpadku');
  expect(await page.$eval('[data-testid="chat-input"]', (e) => e.value) === 'Naplánuj mi den', 'text zůstal v políčku panelu');
  expect(volani.length === volaniPred, 'ani z lišty nic nešlo modelu');
  await page.setViewport({ width: 1400, height: 900 });
  await page.evaluate(() => localStorage.setItem('kb-chat-open', '1'));
  await page.goto(`${cloud.base}/`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-stav"][data-stav="vypadek"]'), 'zpět na počítači: panel s pruhem');

  console.log('== A) „relax“ funguje i bez AI ==');
  await page.click('[data-testid="chat-input"]', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type('relax');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="relax-vrstva"]'), 'slovo „relax“ spustilo relax');
  expect(await cekej('[data-testid="relax-vrstva"][data-nacteno="1"]', 20000), 'scéna se načetla');
  await page.click('[data-testid="relax-konec"]');
  await sleep(300);
  await page.click('[data-testid="chat-stav-relax"]');
  expect(await cekej('[data-testid="relax-vrstva"]'), 'tlačítko Relax v pruhu spustilo relax');
  await page.click('[data-testid="relax-konec"]');
  await sleep(300);

  console.log('== A) AI se vrátí → „Zkusit znovu“ vrátí plný asistent ==');
  dole = false;
  await sleep(61000); // cache zdraví na serveru
  await page.click('[data-testid="chat-stav-zkusit"]');
  const t1 = Date.now(); let zpet = false;
  while (Date.now() - t1 < 10000 && !zpet) { zpet = (await page.$('[data-testid="chat-stav"]')) === null; if (!zpet) await sleep(300); }
  expect(zpet, 'pruh výpadku zmizel');
  expect(await cekej('[data-testid="chat-toggle"][data-stav="funkcni"]'), 'tlačítko zpět ve stavu funkční (bez reloadu)');
  fronta.push('ZPET-MOCK: jsem zpátky.');
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Co mám dnes dělat?');
  await page.keyboard.press('Enter');
  const t2 = Date.now(); let ok2 = false;
  while (Date.now() - t2 < 15000 && !ok2) { ok2 = (await page.$eval('[data-testid="chat-panel"]', (e) => e.innerText)).includes('ZPET-MOCK'); if (!ok2) await sleep(300); }
  expect(ok2, 'po návratu AI zpráva odešla a asistent odpověděl');
  expect(chyby.length === 0, `konzole bez chyb (${chyby.slice(0, 3).join(' | ')})`);
  cloud.stop();

  // ───────────────────────── B) vlastní instalace bez AI ─────────────────────────
  console.log('== B) vlastní instalace bez AI: správce ==');
  const self = await H.startInstance({ slug: 'ui-bezai-self', env: { KB_UVODNI_MAPA: 0 } });
  await self.register('admin@example.com', { name: 'Jana Správcová' });
  await self.register('clen@example.com', { name: 'Karel Člen' });
  const SA = await self.login('admin@example.com');
  const SC = await self.login('clen@example.com');
  const b2 = await H.browser();
  const p2 = b2.page; const cekej2 = cekejNa(p2);
  await prihlas(p2, SA);
  await p2.goto(`${self.base}/`, { waitUntil: 'networkidle2' });
  expect(await cekej2('[data-testid="chat-toggle"][data-stav="nepripojeno"]'), 'bez AI je tlačítko Asistent vidět (stav nepřipojeno)');
  expect((await p2.$('[data-testid="chat-toggle-vypadek"]')) === null, 'bez tečky');
  expect((await p2.$('[data-testid="chat-tab"]')) === null, 'žádné ouško na kraji');
  await p2.click('[data-testid="chat-toggle"]');
  expect(await cekej2('[data-testid="chat-stav"][data-stav="nepripojeno"]'), 'pruh „AI ještě není připojená“');
  const pruh2 = await p2.$eval('[data-testid="chat-stav"]', (e) => e.innerText);
  expect(pruh2.includes('AI ještě není připojená') && pruh2.includes('Po připojení AI za vás bude zakládat projekty'), 'text pozvánky podle náhledu');
  expect(!!(await p2.$('[data-testid="chat-stav-pripojit"]')) && !!(await p2.$('[data-testid="chat-stav-relax"]')) && !(await p2.$('[data-testid="chat-stav-zkusit"]')), 'správce: Připojit AI + Relax');
  const kp2 = await kontrastPruhu(p2);
  expect(kp2 >= 4.5, `pozvánka čitelná (nejhorší kontrast ${kp2.toFixed(1)} : 1)`);
  expect((await p2.$('[data-testid="chat-chipy"]')) === null && (await p2.$('[data-testid="chat-obrazek"]')) === null, 'bez čipů a sponky');
  await p2.click('[data-testid="chat-dokumenty-btn"]');
  expect(await cekej2('[data-testid="chat-dok-filtr"]', 5000), 'Dokumenty jdou otevřít (seznam se načetl)');
  await p2.click('[data-testid="chat-dokumenty-btn"]');
  // Dokumenty leží NAD relaxem „vedle“ (klik-test 19. 10.: akvárium je zakrylo)
  await p2.click('[data-testid="chat-stav-relax"]');
  expect(await cekej2('[data-testid="relax-vrstva"]'), 'relax vedle chatu běží');
  await p2.click('[data-testid="chat-dokumenty-btn"]');
  expect(await cekej2('[data-testid="chat-dok-filtr"]', 5000), 'Dokumenty se otevřely i při relaxu');
  const navrchu = await p2.$eval('[data-testid="chat-dok-filtr"]', (f) => { const r = f.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!el && (el === f || f.contains(el) || el.contains(f)); });
  expect(navrchu, 'Dokumenty jsou nad akváriem (dají se kliknout)');
  expect(!!(await p2.$('[data-testid="relax-vrstva"]')), 'relax přitom dál běží');
  await p2.click('[data-testid="chat-dokumenty-btn"]');
  // klik-test 19. 10.: ranní akvárium vedle chatu zakrylo Správu organizace a „Připojit AI“ vypadalo, že nic nedělá
  await p2.click('[data-testid="chat-stav-relax"]');
  expect(await cekej2('[data-testid="relax-vrstva"]'), 'relax běží vedle chatu');
  await p2.click('[data-testid="chat-stav-pripojit"]');
  await sleep(500);
  expect((await p2.$('[data-testid="relax-vrstva"]')) === null, 'Připojit AI relax ukončí (nastavení není zakryté)');
  expect(await cekej2('#ai'), 'Připojit AI → sekce AI ve Správě organizace');
  expect(p2.url().endsWith('/admin/users#ai'), `adresa ${p2.url()}`);
  await sleep(500);
  const viditelna = await p2.$eval('#ai', (e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; });
  expect(viditelna, 'stránka se posunula na sekci AI');
  // kontrolní panel 19. 10.: mapa nemá hlavičku a tlačítko v liště editoru čekalo na zdravou AI → bez AI se tam asistent nedal otevřít
  const mapaS = (await self.api('POST', '/api/collections/goalmaps/records', { token: SA, body: { title: 'Dílna', nodes: [
    { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Dílna', title: 'Dílna', status: 'todo' } }], edges: [] } })).json;
  await p2.setViewport({ width: 400, height: 800 });
  await p2.evaluate(() => localStorage.setItem('kb-chat-open', '0'));
  await p2.goto(`${self.base}/map/${mapaS.id}`, { waitUntil: 'networkidle2' });
  expect(await cekej2('[data-testid="toolbar-asistent-mobil"][data-stav="nepripojeno"]'), 'mapa bez AI: tlačítko Asistent v liště editoru');
  await p2.click('[data-testid="toolbar-asistent-mobil"]');
  expect(await cekej2('[data-testid="chat-stav"][data-stav="nepripojeno"]'), 'mapa bez AI: tlačítko otevře panel s pozvánkou');
  expect(b2.chyby.length === 0, `konzole bez chyb (${b2.chyby.slice(0, 3).join(' | ')})`);

  console.log('== B) člen: bez tlačítka Připojit, s větou o správci ==');
  const b3 = await H.browser();
  const p3 = b3.page; const cekej3 = cekejNa(p3);
  await prihlas(p3, SC);
  await p3.goto(`${self.base}/`, { waitUntil: 'networkidle2' });
  expect(await cekej3('[data-testid="chat-toggle"][data-stav="nepripojeno"]'), 'člen vidí tlačítko Asistent');
  await p3.click('[data-testid="chat-toggle"]');
  expect(await cekej3('[data-testid="chat-stav-clen"]'), 'člen: „Připojit ji může správce vaší organizace.“');
  expect((await p3.$('[data-testid="chat-stav-pripojit"]')) === null, 'člen nemá Připojit AI');
  const ph3 = await p3.$eval('[data-testid="chat-input"]', (e) => e.getAttribute('placeholder'));
  expect(ph3 === 'Bez AI asistent neodpoví · „relax“ funguje', `placeholder bez AI (${ph3})`);
  expect(b3.chyby.length === 0, `konzole bez chyb (${b3.chyby.slice(0, 3).join(' | ')})`);

  console.log('== B) telefon: žádná spodní lišta, tlačítko v hlavičce ==');
  const b4 = await H.browser({ mobil: true });
  const p4 = b4.page; const cekej4 = cekejNa(p4);
  await prihlas(p4, SC);
  await p4.goto(`${self.base}/`, { waitUntil: 'networkidle2' });
  // telefon se sám přepne do zjednodušeného zobrazení (/lite) — tam má asistent vlastní tlačítko v hlavičce
  const tlacitko4 = '[data-testid="chat-toggle"][data-stav="nepripojeno"], [data-testid="lite-asistent"][data-stav="nepripojeno"]';
  expect(await cekej4(tlacitko4), `telefon: tlačítko Asistent v hlavičce (${new URL(p4.url()).pathname})`);
  await sleep(800);
  expect((await p4.$('[data-testid="chat-bar"]')) === null && (await p4.$('[data-testid="chat-tab"]')) === null, 'telefon: bez spodní lišty a ouška asistenta');
  await p4.click(tlacitko4);
  expect(await cekej4('[data-testid="chat-stav"][data-stav="nepripojeno"]'), 'telefon: panel s pruhem');
  expect(b4.chyby.length === 0, `konzole bez chyb (${b4.chyby.slice(0, 3).join(' | ')})`);
  self.stop();

  // ───────────────────────── C) cloud bez asistenta ─────────────────────────
  console.log('== C) cloud bez nastaveného asistenta: tlačítko se neukáže ==');
  const holy = await H.startInstance({ slug: 'ui-bezai-holy', env: { KB_HOSTED: 1, KB_SETUP_CODE: 'BEZAI-KOD', KB_UVODNI_MAPA: 0 } });
  await holy.register('admin@example.com', { name: 'Eva', setup_code: 'BEZAI-KOD' });
  const HA = await holy.login('admin@example.com');
  const b5 = await H.browser();
  await prihlas(b5.page, HA);
  await b5.page.goto(`${holy.base}/`, { waitUntil: 'networkidle2' });
  await sleep(1500);
  expect((await b5.page.$('[data-testid="chat-toggle"]')) === null && (await b5.page.$('[data-testid="chat-tab"]')) === null, 'cloud bez asistenta: žádné tlačítko ani ouško');
  holy.stop();
}, { nazev: 'ui-ai-chat-bez-ai' });
