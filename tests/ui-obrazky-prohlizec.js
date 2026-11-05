// Záložka Obrázky a prohlížeč obrázku (4. 11. 2026) — klikací sada proti podvržené ollamě a podvržené bráně (mode=image).
//
// Co hlídá (Richard 4. 11.: „ne nové okno — vlevo místo mapy, nebo přes celou obrazovku jako akvárko s křížkem“):
// klik na obrázek v kartě chatu otevře prohlížeč VLEVO od chatu (žádná nová karta prohlížeče), ⛶ přes celou obrazovku
// a zpět, Esc zavře prohlížeč, ale ne Dokumenty pod ním; náhledy Kancelářské karty listují šipkami; záložka Obrázky
// mezi Dokumenty a Stránkami: použitý obrázek (prezentace) nejde smazat, nepoužitý ukáže den úklidu, Ponechat natrvalo
// se uloží (přežije reload), Smazat s potvrzením obrázek odstraní a karta v historii pak napíše „smazán“ (bez 404);
// na telefonu jen přes celou obrazovku; konzole bez chyb.
// 4. 11. večer 2 (Richard): popis přepíše asistent (jako prezentace), styl a formát podle účelu na klik, formulář zůstane vyplněný, Nakreslit znovu v prohlížeči
// (obrázek ve stránce ne). 4. 11. večer (Richard): „Nový obrázek“ v záložce (popis → nakreslit → otevře se v prohlížeči), dokument z Kanceláře
// (prezentace / pozvánka) jde otevřít vlevo stejně jako obrázek, stránka psaná s adresou 127.0.0.1 ukáže obrázek i z jiné adresy.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ui-obrazky-prohlizec.js
const H = require('./_harness');
const { expect, sleep } = H;

const JPEG = [
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDPooorhPqD/9k=',
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDn6KKK+oMT/9k=',
];
const OSNOVA = '# Kuchyň Truhlářství\nStav pro klienta\n## Cíl\n- Linka do 30. 11. 2026\n## Další kroky\n- 5. 11. montáž';

const fronta = [];
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const text = (s) => ({ content: s });
const chatHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  const b = JSON.parse(body);
  const sys = ((b.messages || [])[0] || {}).content || '';
  // Nový obrázek: asistent píše anglický popis (obrazky.napisPopis) → ozvěna zadání, ať test vidí popis, účel i styl
  const o = /You write prompts for the FLUX image model/.test(sys) ? text('Scene for FLUX. ' + (b.messages[1].content || '').replace(/\s+/g, ' ')) : fronta.shift() || text('(fronta prázdná)');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 100, eval_count: 20, done: true }));
};
let kresleno = 0;
const promptyBrany = [];
const branaHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  const b = JSON.parse(body || '{}');
  if (b.mode !== 'image') { res.statusCode = 400; res.end('{}'); return; }
  kresleno++;
  promptyBrany.push(b.prompt);
  res.end(JSON.stringify({ image_base64: JPEG[kresleno % 2], mime: 'image/jpeg', model: b.model, seed: 7 + kresleno, size: '1024x1024', gen_s: 0.5, schema_version: 1 }));
};

H.beh(async () => {
  const mock = await H.httpMock(chatHandler);
  const brana = await H.httpMock(branaHandler);
  const inst = await H.startInstance({ slug: 'ui-obrazky-prohlizec', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
    KB_IMAGE_URL: brana.base + '/v1/advisor', KB_IMAGE_TOKEN: 'img_tok',
  } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  const A = await inst.login('admin@example.com');
  const pripravStranku = async (p) => {
    await p.evaluateOnNewDocument((tk) => {
      if (window.top !== window) return; // náhled stránky = sandbox bez localStorage (jinak SecurityError testu v konzoli)
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} }));
      localStorage.setItem('kb-chat-open', '1');
      try { const uid = JSON.parse(atob(tk.split('.')[1])).id; const d = new Date().toLocaleDateString('en-CA'); for (const k of ['kb-relax-rano', 'kb-chat-porada-ne']) localStorage.setItem(`${k}:${uid}`, d); localStorage.setItem('kb-chat-porada-ne', d); } catch { /* bez uid */ }
    }, A);
  };
  const { browser, page, chyby, novaStranka } = await H.browser();
  await pripravStranku(page);
  const cekej = async (sel, ms = 15000, p = page) => p.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const zmizi = async (sel, ms = 5000, p = page) => p.waitForSelector(sel, { hidden: true, timeout: ms }).then(() => true).catch(() => false);
  const napis = async (s) => { await page.click('[data-testid="chat-input"]'); await page.keyboard.type(s); await page.click('[data-testid="chat-send"]'); };
  const box = (sel, p = page) => p.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; });
  const vrstva = (atr, p = page) => p.$eval('[data-testid="obrazek-vrstva"]', (el, a) => el.getAttribute(a), atr).catch(() => '');

  console.log('== karta obrázku v chatu: klik → prohlížeč vlevo od chatu, ne nové okno ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  if (!(await page.$('[data-testid="chat-input"]'))) { const t = await page.$('[data-testid="chat-tab"]'); if (t) await t.click(); }
  expect(await cekej('[data-testid="chat-input"]'), 'asistent otevřený');
  fronta.push(nastroj('generate_image', { prompt: 'a carpentry workshop at sunset, no text', title: 'Dílna při západu' }), text('Kreslím.'));
  await napis('Nakresli dílnu při západu slunce');
  expect(await cekej('[data-testid="chat-obrazek-karta"][data-stav="hotovo"] [data-testid="chat-obrazek-zvetsit"]', 20000), 'karta obrázek nakreslila, náhled jde zvětšit');
  const karet = (await browser.pages()).length;
  await page.click('[data-testid="chat-obrazek-zvetsit"]');
  expect(await cekej('[data-testid="obrazek-vrstva"]', 8000), 'klik na obrázek otevřel prohlížeč');
  await sleep(400);
  expect((await browser.pages()).length === karet, `žádná nová karta prohlížeče (${karet} → ${(await browser.pages()).length})`);
  const vb = await box('[data-testid="obrazek-vrstva"]'), cb = await box('[data-testid="chat-input"]');
  const okno = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  expect(await vrstva('data-rozlozeni') === 'vedle' && vb.x === 0 && vb.r <= cb.x && vb.y > 0, `prohlížeč vlevo od chatu pod lištou (${JSON.stringify(vb)}, chat od ${cb.x})`);
  expect(await page.$eval('[data-testid="obrazek-vrstva-nazev"]', (el) => el.textContent) === 'Dílna při západu' && await page.$eval('[data-testid="obrazek-vrstva-img"]', (i) => i.complete && i.naturalWidth > 0), 'prohlížeč ukazuje název a načtený obrázek');
  expect(!(await page.$('[data-testid="obrazek-vrstva-smazat"]')) && !(await page.$('[data-testid="obrazek-vrstva-predchozi"]')), 'z karty chatu bez správy (smazat) a bez šipek (jeden obrázek)');
  await page.click('[data-testid="obrazek-vrstva-cela"]');
  await sleep(300);
  const vc = await box('[data-testid="obrazek-vrstva"]');
  expect(await vrstva('data-rozlozeni') === 'cela' && vc.x === 0 && vc.y === 0 && vc.w === okno.w && vc.h === okno.h, `⛶ = přes celou obrazovku (${JSON.stringify(vc)})`);
  await page.click('[data-testid="obrazek-vrstva-cela"]');
  await sleep(300);
  expect(await vrstva('data-rozlozeni') === 'vedle', 'druhý klik = zpět vedle chatu');
  await page.click('[data-testid="obrazek-vrstva-zavrit"]');
  expect(await zmizi('[data-testid="obrazek-vrstva"]'), 'křížek prohlížeč zavře');

  console.log('== Kancelář: náhledy prezentace listují šipkami; Esc zavře prohlížeč, Dokumenty zůstanou ==');
  fronta.push(nastroj('draft_presentation', { title: 'Kuchyň Truhlářství', text: OSNOVA, picture: 'a bright oak kitchen, flat illustration', slide_pictures: [{ slide: 'Cíl', prompt: 'a target, flat illustration' }] }), text('Prezentace je hotová.'));
  await napis('Udělej prezentaci pro klienta');
  expect(await cekej('[data-testid="chat-soubor-obrazky"][data-stav="hotovo"]', 20000), 'karta prezentace nakreslila 2 obrázky');
  await sleep(800); // nový dokument panel Kancelář otevře sám (DokumentyPanel) — jinak ho otevřít
  if (!(await page.$('[data-testid="chat-dokumenty"]'))) await page.click('[data-testid="chat-dokumenty-btn"]');
  expect(await cekej('[data-testid="chat-dokumenty"]'), 'panel Kancelář otevřený');
  if (await page.$('[data-testid="chat-dok-zpet"]')) await page.click('[data-testid="chat-dok-zpet"]'); // ze detailu na seznam (záložky)
  await page.click('[data-testid="chat-soubor"] button:has(> [data-testid="chat-soubor-obrazek"])');
  expect(await cekej('[data-testid="obrazek-vrstva"]', 8000), 'klik na náhled prezentace otevřel prohlížeč');
  const vd = await box('[data-testid="obrazek-vrstva"]'), db = await box('[data-testid="chat-dokumenty"]');
  expect(vd.r <= db.x + 1, `prohlížeč vlevo od Dokumentů, nepřekrývá je (${vd.r} ≤ ${db.x})`);
  expect(await page.$eval('[data-testid="obrazek-vrstva-poradi"]', (el) => el.textContent.replace(/\s/g, '')) === '1/2', 'pořadí 1 / 2');
  const prvni = await vrstva('data-id');
  await page.keyboard.press('ArrowRight');
  await sleep(200);
  expect(await vrstva('data-id') !== prvni && (await page.$eval('[data-testid="obrazek-vrstva-poradi"]', (el) => el.textContent.replace(/\s/g, ''))) === '2/2', 'šipka → další obrázek');
  await page.keyboard.press('Escape');
  expect(await zmizi('[data-testid="obrazek-vrstva"]'), 'Esc zavřel prohlížeč');
  await sleep(300);
  expect(!!(await page.$('[data-testid="chat-dokumenty"]')), 'Esc nezavřel zároveň Dokumenty');

  console.log('== záložka Obrázky: mezi Dokumenty a Stránkami, použitý nejde smazat, natrvalo, smazat ==');
  const zalozky = await page.$$eval('[data-testid="chat-dok-zalozka"]', (els) => els.map((e) => e.getAttribute('data-zalozka')));
  expect(zalozky[0] === 'dokumenty' && zalozky[1] === 'obrazky', `záložka Obrázky hned za Dokumenty (${zalozky.join(',')})`);
  await page.click('[data-testid="chat-dok-zalozka"][data-zalozka="obrazky"]');
  expect(await cekej('[data-testid="chat-obr-polozka"]'), 'záložka ukáže obrázky');
  const polozky = await page.$$eval('[data-testid="chat-obr-polozka"]', (els) => els.map((e) => ({ id: e.dataset.id, p: e.dataset.pouzito, t: e.textContent })));
  expect(polozky.length === 3 && polozky.filter((x) => x.p === '1').length === 2 && polozky.some((x) => x.p === '0' && /Dílna při západu/.test(x.t)), `3 obrázky: 2 v prezentaci (použité), dílna nepoužitá (${JSON.stringify(polozky.map((x) => x.p))})`);
  const idDilna = polozky.find((x) => x.p === '0').id, idPouzity = polozky.find((x) => x.p === '1').id;
  await page.click(`[data-testid="chat-obr-polozka"][data-id="${idPouzity}"]`);
  expect(await cekej('[data-testid="obrazek-vrstva"]', 8000), 'klik v záložce otevře prohlížeč');
  expect(/Použito: Kuchyň Truhlářství/.test(await page.$eval('[data-testid="obrazek-vrstva-info"]', (el) => el.textContent).catch(() => '')) && await page.$eval('[data-testid="obrazek-vrstva-smazat"]', (b) => b.disabled), 'použitý obrázek: řekne kde, Smazat zakázané');
  await page.click('[data-testid="obrazek-vrstva-zavrit"]');
  await page.click(`[data-testid="chat-obr-polozka"][data-id="${idDilna}"]`);
  await cekej('[data-testid="obrazek-vrstva"]', 8000);
  const za90 = new Date(Date.now() + 90 * 86400000).toLocaleDateString('cs');
  expect((await page.$eval('[data-testid="obrazek-vrstva-info"]', (el) => el.textContent).catch(() => '')).includes(za90), `nepoužitý: „smaže se ${za90}“`);
  await page.click('[data-testid="obrazek-vrstva-natrvalo"]');
  expect(await cekej('[data-testid="obrazek-vrstva-natrvalo"][aria-pressed="true"]', 5000), 'Ponechat natrvalo se zapnulo');
  expect(await cekej(`[data-testid="chat-obr-polozka"][data-id="${idDilna}"][data-trvale="1"]`, 5000), 'záložka ukazuje špendlík (načetla se znovu)');
  await page.click('[data-testid="obrazek-vrstva-zavrit"]');
  await page.reload({ waitUntil: 'networkidle2' });
  if (!(await page.$('[data-testid="chat-dokumenty"]'))) await page.click('[data-testid="chat-dokumenty-btn"]');
  await page.click('[data-testid="chat-dok-zalozka"][data-zalozka="obrazky"]');
  expect(await cekej(`[data-testid="chat-obr-polozka"][data-id="${idDilna}"][data-trvale="1"]`, 8000), 'natrvalo přežije reload (uloženo na serveru)');
  await page.click(`[data-testid="chat-obr-polozka"][data-id="${idDilna}"]`);
  await cekej('[data-testid="obrazek-vrstva"]', 8000);
  await page.click('[data-testid="obrazek-vrstva-smazat"]');
  expect(await cekej('[data-testid="obrazek-vrstva-smazat-ano"]', 3000), 'Smazat se nejdřív zeptá (bez dialogu prohlížeče)');
  await page.click('[data-testid="obrazek-vrstva-smazat-ano"]');
  expect(await zmizi(`[data-testid="chat-obr-polozka"][data-id="${idDilna}"]`, 8000), 'smazaný obrázek zmizel ze záložky');
  const zaznam = await inst.api('GET', `/api/kb/chat/obrazek/${idDilna}`, { token: A });
  expect(zaznam.status === 200 && zaznam.json.obrazek === null, `i na serveru je pryč (${zaznam.status} ${JSON.stringify(zaznam.json)})`);
  expect(await vrstva('data-id') !== idDilna, 'prohlížeč přešel na jiný obrázek (nebo se zavřel)');
  if (await page.$('[data-testid="obrazek-vrstva"]')) await page.click('[data-testid="obrazek-vrstva-zavrit"]');
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej(`[data-testid="chat-obrazek-karta"][data-id="${idDilna}"] [data-testid="chat-obrazek-smazany"]`, 10000), 'karta smazaného obrázku v historii napíše „Obrázek byl smazán.“ (ne chybu, bez Nakreslit znovu)');
  expect(!(await page.$(`[data-testid="chat-obrazek-karta"][data-id="${idDilna}"] [data-testid="chat-obrazek-znovu"]`)), 'smazaný obrázek nejde „nakreslit znovu“');

  console.log('== Nový obrázek v záložce Obrázky: popis → Nakreslit → otevře se v prohlížeči se správou ==');
  if (!(await page.$('[data-testid="chat-dokumenty"]'))) await page.click('[data-testid="chat-dokumenty-btn"]');
  if (await page.$('[data-testid="chat-dok-zpet"]')) await page.click('[data-testid="chat-dok-zpet"]');
  await page.click('[data-testid="chat-dok-zalozka"][data-zalozka="obrazky"]');
  expect(await cekej('[data-testid="chat-obr-novy"]', 8000), 'záložka Obrázky má tlačítko Nový obrázek');
  await page.click('[data-testid="chat-obr-novy"]');
  expect(await cekej('[data-testid="chat-obr-novy-formular"]', 3000) && !(await page.$('[data-testid="chat-obr-novy-text"]')), 'formulář nového obrázku (bez pole Text — instance nemá FLUX 3)');
  expect(await page.$eval('[data-testid="chat-obr-novy-nakreslit"]', (b) => b.disabled && /Nejdřív napište/.test(b.title)), 'bez popisu nejde nakreslit a tlačítko řekne proč (styl je předvybraný)');
  const POPIS = 'vánoční stromek v truhlářské dílně, ploché ilustrace';
  await page.type('[data-testid="chat-obr-novy-popis"]', POPIS);
  await page.click('[data-testid="chat-obr-novy-format"][data-format="siroky"]');
  const predKresbou = kresleno;
  await page.click('[data-testid="chat-obr-novy-nakreslit"]');
  expect(await cekej('[data-testid="obrazek-vrstva"]', 15000), 'po nakreslení se obrázek sám otevřel v prohlížeči');
  expect(kresleno === predKresbou + 1, `brána kreslila jednou (${kresleno - predKresbou}×)`);
  expect(await page.$eval('[data-testid="obrazek-vrstva-nazev"]', (el) => el.textContent) === POPIS && await page.$eval('[data-testid="obrazek-vrstva-img"]', (i) => i.complete && i.naturalWidth > 0), 'prohlížeč: název = popis, obrázek načtený');
  expect(!!(await page.$('[data-testid="obrazek-vrstva-natrvalo"]')) && /smaže se/.test(await page.$eval('[data-testid="obrazek-vrstva-info"]', (el) => el.textContent).catch(() => '')), 'nový obrázek má správu (natrvalo) a den úklidu');
  const idNovy = await vrstva('data-id');
  const prvniVZalozce = await page.$eval('[data-testid="chat-obr-polozka"]', (el) => el.dataset.id).catch(() => '');
  const zustal = await page.$eval('[data-testid="chat-obr-novy-popis"]', (el) => el.value).catch(() => null);
  expect(prvniVZalozce === idNovy && zustal === POPIS, 'nový obrázek je v záložce první, formulář zůstal vyplněný (týž popis v jiném stylu)');
  const novyRec = (await inst.api('GET', `/api/kb/chat/obrazek/${idNovy}`, { token: A })).json.obrazek || {};
  expect(novyRec.preset === 'siroky', `formát Prezentace (na šířku) uložen (${novyRec.preset})`);
  const p1 = promptyBrany[promptyBrany.length - 1] || '';
  expect(p1.startsWith('Scene for FLUX.') && p1.includes(POPIS) && /detailed painterly illustration/.test(p1) && /no text$/.test(p1) && await page.$eval('[data-testid="chat-obr-novy-styl"][data-styl="malba"]', (b) => b.getAttribute('aria-checked')) === 'true',
    `výchozí Malba (teplé světlo) předvybraná: brána dostala popis napsaný asistentem se stylem Malba (${p1.slice(0, 60)})`);

  console.log('== styl a formát na klik: Akvarel + E-mail (pruh) → druhý obrázek, starý zůstal ==');
  const stylyCipy = await page.$$eval('[data-testid="chat-obr-novy-styl"]', (els) => els.map((e) => e.textContent));
  const formatyCipy = await page.$$eval('[data-testid="chat-obr-novy-format"]', (els) => els.map((e) => e.textContent));
  expect(stylyCipy.length === 7 && stylyCipy[0] === 'Malba (teplé světlo)' && stylyCipy.includes('Ilustrace (jako v prezentaci)') && stylyCipy.includes('Fotografie'), `7 stylů na klik, první Malba, Ilustrace zůstala (${stylyCipy.join(', ')})`);
  expect(formatyCipy.join('|') === 'Prezentace (na šířku)|E-mail (pruh)|Příspěvek (čtverec)|Story (na výšku)', `formáty podle účelu (${formatyCipy.join(', ')})`);
  await page.click('[data-testid="chat-obr-novy-styl"][data-styl="akvarel"]');
  await page.click('[data-testid="chat-obr-novy-format"][data-format="banner"]');
  await page.click('[data-testid="chat-obr-novy-nakreslit"]');
  expect(await cekej(`[data-testid="obrazek-vrstva"]:not([data-id="${idNovy}"])`, 15000), 'druhý obrázek se otevřel v prohlížeči');
  const idAkvarel = await vrstva('data-id');
  const akv = (await inst.api('GET', `/api/kb/chat/obrazek/${idAkvarel}`, { token: A })).json.obrazek || {};
  expect(akv.preset === 'banner' && akv.title === POPIS && /soft watercolor painting/.test(promptyBrany[promptyBrany.length - 1] || ''), `uložen pruh, název = popis, brána dostala styl Akvarel (${akv.preset})`);
  expect(await cekej(`[data-testid="chat-obr-polozka"][data-id="${idNovy}"]`, 3000), 'první obrázek v záložce zůstal');

  console.log('== Nakreslit znovu v prohlížeči: týž obrázek, nový soubor, žádný nový záznam ==');
  const pocetPred = (await page.$$('[data-testid="chat-obr-polozka"]')).length;
  const srcPred = await page.$eval('[data-testid="obrazek-vrstva-img"]', (i) => i.src);
  const predZnovu = kresleno;
  expect(await page.$eval('[data-testid="obrazek-vrstva-znovu"]', (b) => !b.disabled), 'prohlížeč má Nakreslit znovu');
  await page.click('[data-testid="obrazek-vrstva-znovu"]');
  const poZnovu = await page.waitForFunction((s) => { const i = document.querySelector('[data-testid="obrazek-vrstva-img"]'); return i && i.src !== s && i.complete && i.naturalWidth > 0 && !document.querySelector('[data-testid="obrazek-vrstva-kreslim"]'); }, { timeout: 15000 }, srcPred).then(() => true).catch(() => false);
  expect(poZnovu && kresleno === predZnovu + 1 && await vrstva('data-id') === idAkvarel, `nový soubor načtený, brána jednou, týž obrázek (${kresleno - predZnovu}×)`);
  await sleep(500);
  expect((await page.$$('[data-testid="chat-obr-polozka"]')).length === pocetPred && /soft watercolor painting/.test(promptyBrany[promptyBrany.length - 1] || ''), 'v záložce žádný obrázek navíc, styl zůstal');
  await page.click('[data-testid="chat-obr-novy-zavrit"]');
  await page.click('[data-testid="obrazek-vrstva-zavrit"]');

  console.log('== dokument z Kanceláře (prezentace) se otevře vlevo jako obrázek: všechny snímky, šipky, bez Stáhnout ==');
  await page.click('[data-testid="chat-dok-zalozka"][data-zalozka="dokumenty"]');
  expect(await cekej('[data-testid="chat-dok-polozka"]', 8000), 'seznam dokumentů');
  await page.click('[data-testid="chat-dok-polozka"]');
  expect(await cekej('[data-testid="chat-dok-vlevo"]', 8000), 'detail prezentace má Otevřít vlevo');
  await page.click('[data-testid="chat-dok-vlevo"]');
  expect(await cekej('[data-testid="obrazek-vrstva"]', 20000), 'Otevřít vlevo → prohlížeč');
  const vdok = await box('[data-testid="obrazek-vrstva"]'), dbox = await box('[data-testid="chat-dokumenty"]');
  expect(await vrstva('data-rozlozeni') === 'vedle' && vdok.x === 0 && vdok.r <= dbox.x + 1, `dokument vlevo od Kanceláře (${vdok.r} ≤ ${dbox.x})`);
  const poradiDok = await page.$eval('[data-testid="obrazek-vrstva-poradi"]', (el) => el.textContent.replace(/\s/g, '')).catch(() => '');
  expect(/^1\/[3-9]$/.test(poradiDok), `všechny snímky prezentace, listuje se (${poradiDok})`);
  const snimek = await page.$eval('[data-testid="obrazek-vrstva-img"]', (i) => ({ ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth, src: i.src.slice(0, 23) }));
  expect(snimek.ok && snimek.w >= 800 && snimek.src === 'data:image/jpeg;base64,', `snímek vykreslený ostře (${snimek.w} px)`);
  expect(await page.$eval('[data-testid="obrazek-vrstva-nazev"]', (el) => el.textContent) === 'Kuchyň Truhlářství' && !(await page.$('[data-testid="obrazek-vrstva-stahnout"]')) && !(await page.$('[data-testid="obrazek-vrstva-smazat"]')), 'název dokumentu, bez Stáhnout a Smazat (dokument má svá tlačítka)');
  await page.keyboard.press('ArrowRight');
  await sleep(200);
  expect(/^2\//.test(await page.$eval('[data-testid="obrazek-vrstva-poradi"]', (el) => el.textContent.replace(/\s/g, ''))), 'šipka → další snímek');
  await page.click('[data-testid="obrazek-vrstva-cela"]');
  await sleep(300);
  expect(await vrstva('data-rozlozeni') === 'cela', '⛶ i u dokumentu přes celou obrazovku');
  await page.keyboard.press('Escape');
  expect(await zmizi('[data-testid="obrazek-vrstva"]') && !!(await page.$('[data-testid="chat-dok-detail"]')), 'Esc zavřel dokument, detail v Kanceláři zůstal');
  await page.click('[data-testid="chat-dok-nahled"]');
  expect(await cekej('[data-testid="chat-dok-nahled-zvetsit"]', 15000), 'malý náhled v panelu');
  await page.click('[data-testid="chat-dok-nahled-zvetsit"]');
  expect(await cekej('[data-testid="obrazek-vrstva"]', 20000), 'klik na malý náhled otevře dokument vlevo');
  await page.click('[data-testid="obrazek-vrstva-zavrit"]');
  await zmizi('[data-testid="obrazek-vrstva"]');

  console.log('== stránka psaná s adresou 127.0.0.1 (zkušebka 29. 10.): obrázek se načte i z jiné adresy ==');
  const su = await inst.superuser();
  const uid = JSON.parse(Buffer.from(A.split('.')[1], 'base64').toString()).id;
  const cesta = novyRec.url;
  const hStara = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Report</title></head><body><h1>Report dílny</h1><img data-testid="obr" src="http://127.0.0.1:1${cesta}" alt="Stromek" style="max-width:100%"></body></html>`;
  const rp = await inst.api('POST', '/api/collections/ai_pages/records', { token: su, body: { user: uid, title: 'Report se starou adresou', html: hStara, stav: 'hotovo' } });
  expect(rp.status === 200, `stránka se starou adresou založena (${rp.status})`);
  await page.click('[data-testid="chat-dok-zpet"]').catch(() => {});
  await page.click('[data-testid="chat-dok-zalozka"][data-zalozka="stranky"]');
  expect(await cekej(`[data-testid="chat-str-polozka"]`, 8000), 'záložka Stránky');
  const polStr = await page.$$('[data-testid="chat-str-polozka"]');
  for (const el of polStr) if (/Report se starou adresou/.test(await el.evaluate((e) => e.textContent))) { await el.click(); break; }
  expect(await cekej('[data-testid="chat-str-iframe"]', 8000), 'náhled stránky');
  await sleep(1200);
  const ramec = page.frames().find((f) => f !== page.mainFrame() && f.url() === 'about:srcdoc');
  const vRamci = ramec ? await ramec.$eval('[data-testid="obr"]', (i) => ({ ok: i.complete && i.naturalWidth > 0, src: i.getAttribute('src') })).catch((e) => ({ ok: false, src: String(e).slice(0, 80) })) : { ok: false, src: 'bez rámce' };
  expect(vRamci.ok && !/127\.0\.0\.1:1\//.test(vRamci.src), `obrázek ve stránce načtený z adresy instance (${vRamci.src.slice(0, 60)})`);
  // obrázek je teď ve stránce → Nakreslit znovu zakázané (stránka drží adresu souboru)
  for (const z of ['chat-str-zpet', 'chat-dok-zpet']) if (await page.$(`[data-testid="${z}"]`)) await page.click(`[data-testid="${z}"]`).catch(() => {});
  await page.click('[data-testid="chat-dok-zalozka"][data-zalozka="obrazky"]');
  await cekej(`[data-testid="chat-obr-polozka"][data-id="${idNovy}"][data-pouzito="1"]`, 8000);
  await page.click(`[data-testid="chat-obr-polozka"][data-id="${idNovy}"]`);
  expect(await cekej('[data-testid="obrazek-vrstva-znovu"]', 8000) && await page.$eval('[data-testid="obrazek-vrstva-znovu"]', (b) => b.disabled && /ve stránce/.test(b.title)), 'obrázek ve stránce: Nakreslit znovu zakázané s vysvětlením');
  await page.click('[data-testid="obrazek-vrstva-zavrit"]');

  console.log('== telefon: prohlížeč jen přes celou obrazovku ==');
  const m = await novaStranka();
  await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await pripravStranku(m);
  await m.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  // telefon = zjednodušené zobrazení (Lite): Asistent → Kancelář → záložka Obrázky → obrázek
  if (await m.$('[data-testid="lite-asistent"]')) await m.click('[data-testid="lite-asistent"]');
  expect(await cekej('[data-testid="chat-dokumenty-btn"]', 10000, m), 'telefon: asistent otevřený');
  await m.click('[data-testid="chat-dokumenty-btn"]');
  expect(await cekej('[data-testid="chat-dok-zalozka"][data-zalozka="obrazky"]', 8000, m), 'telefon: záložka Obrázky v Kanceláři');
  await m.click('[data-testid="chat-dok-zalozka"][data-zalozka="obrazky"]');
  expect(await cekej('[data-testid="chat-obr-polozka"][data-stav="hotovo"]', 8000, m), 'telefon: záložka ukáže obrázky');
  await m.click('[data-testid="chat-obr-polozka"][data-stav="hotovo"]');
  expect(await cekej('[data-testid="obrazek-vrstva"]', 8000, m), 'telefon: prohlížeč otevřený');
  const vm = await box('[data-testid="obrazek-vrstva"]', m);
  expect(await vrstva('data-rozlozeni', m) === 'cela' && vm.w === 390 && vm.h === 844 && !(await m.$('[data-testid="obrazek-vrstva-cela"]')), `telefon: přes celou obrazovku, bez přepínače (${JSON.stringify(vm)})`);
  await m.click('[data-testid="obrazek-vrstva-zavrit"]');
  expect(await zmizi('[data-testid="obrazek-vrstva"]', 5000, m), 'telefon: křížek zavře');

  expect(chyby.length === 0, `konzole bez chyb (${chyby.slice(0, 3).join(' | ')})`);
}, { nazev: 'UI-OBRAZKY-PROHLIZEC' });
