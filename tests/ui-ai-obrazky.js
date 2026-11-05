// Karta obrázku v asistentovi (29. 10. 2026) — klikací sada proti podvržené ollamě a podvržené bráně (mode=image).
//
// Co hlídá (nálezy vlastního průchodu zkušebky :8183): karta po tahu obrázek SAMA nakreslí a ukáže; během kreslení
// má zástupný rámeček STEJNOU šířku jako hotový obrázek (bublina se dřív smrskla na malý čtvereček); Nakreslit znovu
// dá nový obrázek; po reloadu se karta načte z historie a NEkreslí znovu; výpadek = hláška na kartě + Zkusit znovu;
// telefon (Lite) kartu vykreslí; konzole čistá.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ui-ai-obrazky.js
const H = require('./_harness');
const { expect, sleep } = H;

// 16×16 JPEG — prohlížeč ho roztáhne na šířku karty (w-full); rozměr rámečku dává preset, ne soubor
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDPooorhPqD/9k=', 'base64');

const fronta = [];
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const text = (s) => ({ content: s });
const chatHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  JSON.parse(body);
  const o = fronta.shift() || text('(fronta prázdná)');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 100, eval_count: 20, done: true }));
};
let rezimBrany = 'ok';     // ok | down
let zdrzeniBrany = 1500;   // ms — ať je stav „kreslím“ vidět
let kresleni = 0;
const branaHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  const b = JSON.parse(body || '{}');
  if (b.mode !== 'image') { res.statusCode = 400; res.end('{}'); return; }
  kresleni++;
  setTimeout(() => {
    if (rezimBrany === 'down') { res.statusCode = 502; res.end('{"detail":{"error":"x","code":"image_unavailable"}}'); return; }
    res.end(JSON.stringify({ image_base64: JPEG.toString('base64'), mime: 'image/jpeg', model: b.model, seed: 7 + kresleni, size: '1024x1024', gen_s: 1.2, schema_version: 1 }));
  }, zdrzeniBrany);
};

H.beh(async () => {
  const mock = await H.httpMock(chatHandler);
  const brana = await H.httpMock(branaHandler);
  const inst = await H.startInstance({ slug: 'ui-obrazky', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
    KB_IMAGE_URL: brana.base + '/v1/advisor', KB_IMAGE_TOKEN: 'img_tok',
  } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  const A = await inst.login('admin@example.com');
  const { page, chyby } = await H.browser();
  await page.evaluateOnNewDocument((tk) => {
    localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} }));
    try { const uid = JSON.parse(atob(tk.split('.')[1])).id; const d = new Date().toLocaleDateString('en-CA'); for (const k of ['kb-relax-rano', 'kb-chat-porada-ne']) localStorage.setItem(`${k}:${uid}`, d); } catch { /* bez uid */ }
  }, A);
  const cekej = async (sel, ms = 15000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const sirka = (sel) => page.$eval(sel, (el) => Math.round(el.getBoundingClientRect().width)).catch(() => 0);
  const obrazekNacten = (ms = 15000) => page.waitForFunction(() => { const i = document.querySelector('[data-testid="chat-obrazek-img"]'); return i && i.complete && i.naturalWidth > 0; }, { timeout: ms }).then(() => true).catch(() => false);

  console.log('== tah → karta sama nakreslí, rámeček má šířku hotového obrázku ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  if (!(await page.$('[data-testid="chat-input"]'))) await page.click('[data-testid="chat-tab"]');
  await cekej('[data-testid="chat-input"]');
  fronta.push(nastroj('generate_image', { prompt: 'a small carpentry team planning at a whiteboard, no text', title: 'Tým v dílně' }), text('Kreslím ilustraci.'));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Nakresli mi tým v dílně');
  await page.click('[data-testid="chat-send"]');
  expect(await cekej('[data-testid="chat-obrazek-karta"][data-stav="pise"]', 20000), 'po tahu karta ukazuje „Kreslím obrázek…“ (kreslí sama, bez dalšího kliknutí)');
  const wKresli = await sirka('[data-testid="chat-obrazek-karta"]');
  expect(await obrazekNacten(), 'obrázek se na kartě zobrazil');
  const wHotovo = await sirka('[data-testid="chat-obrazek-karta"]');
  expect(wKresli >= 280 && Math.abs(wKresli - wHotovo) <= 2, `rámeček při kreslení má šířku hotové karty (${wKresli} vs ${wHotovo} px; dřív se bublina smrskla)`);
  expect(kresleni === 1, `brána volána jednou (${kresleni})`);
  expect(!!(await page.$('[data-testid="chat-obrazek-stahnout"]')) && !!(await page.$('[data-testid="chat-obrazek-znovu"]')), 'hotová karta: Stáhnout + Nakreslit znovu');

  console.log('== Nakreslit znovu → nový obrázek ==');
  const src1 = await page.$eval('[data-testid="chat-obrazek-img"]', (i) => i.src);
  await page.click('[data-testid="chat-obrazek-znovu"]');
  expect(await cekej('[data-testid="chat-obrazek-karta"][data-stav="pise"]', 5000), 'Nakreslit znovu → karta kreslí');
  const ok = await page.waitForFunction((s) => { const i = document.querySelector('[data-testid="chat-obrazek-img"]'); return i && i.src !== s && i.complete && i.naturalWidth > 0; }, { timeout: 15000 }, src1).then(() => true).catch(() => false);
  expect(ok && kresleni === 2, `nový obrázek s jinou adresou (${kresleni}× brána)`);

  console.log('== reload: karta z historie, nekreslí znovu ==');
  await page.reload({ waitUntil: 'networkidle2' });
  if (!(await page.$('[data-testid="chat-input"]'))) { const t = await page.$('[data-testid="chat-tab"]'); if (t) await t.click(); }
  expect(await cekej('[data-testid="chat-obrazek-img"]') && await obrazekNacten(), 'po reloadu karta ukazuje hotový obrázek');
  await sleep(1500);
  expect(kresleni === 2, `reload NEkreslí znovu (${kresleni}× brána)`);

  expect(chyby.length === 0, `konzole bez chyb do výpadku (${chyby.slice(0, 3).join(' | ')})`);
  const chybPred = chyby.length;
  console.log('== výpadek: hláška na kartě a Zkusit znovu ==');
  rezimBrany = 'down';
  fronta.push(nastroj('generate_image', { prompt: 'a red bicycle, no text', title: 'Kolo' }), text('Kreslím.'));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Ještě nakresli kolo');
  await page.click('[data-testid="chat-send"]');
  const chybaVidet = await page.waitForFunction(() => { const k = [...document.querySelectorAll('[data-testid="chat-obrazek-karta"]')].pop(); return k && k.dataset.stav === 'chyba' && /nejdou/.test(k.innerText); }, { timeout: 20000 }).then(() => true).catch(() => false);
  expect(chybaVidet, 'výpadek → karta ukáže „Obrázky teď nejdou…“');
  rezimBrany = 'ok';
  await page.evaluate(() => { const k = [...document.querySelectorAll('[data-testid="chat-obrazek-karta"]')].pop(); k.querySelector('[data-testid="chat-obrazek-znovu"]').click(); });
  const opraveno = await page.waitForFunction(() => { const k = [...document.querySelectorAll('[data-testid="chat-obrazek-karta"]')].pop(); const i = k && k.querySelector('[data-testid="chat-obrazek-img"]'); return k.dataset.stav === 'hotovo' && i && i.complete && i.naturalWidth > 0; }, { timeout: 20000 }).then(() => true).catch(() => false);
  expect(opraveno, 'Zkusit znovu po výpadku → obrázek');

  console.log('== telefon (Lite): karta z historie ==');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  for (const sel of ['chat-tab', 'chat-toggle', 'chat-bar', 'lite-asistent']) {
    if (await page.$('[data-testid="chat-input"]')) break;
    const t = await page.$(`[data-testid="${sel}"]`);
    if (t && await t.boundingBox()) { await t.click(); await sleep(800); }
  }
  expect(await cekej('[data-testid="chat-obrazek-img"]'), 'na telefonu karta s obrázkem');
  const wMobil = await sirka('[data-testid="chat-obrazek-karta"]');
  expect(wMobil > 200 && wMobil <= 390, `karta se vejde na telefon (${wMobil} px)`);

  // jediná dovolená chyba: odpověď 502 vytvořit ve scénáři výpadku (prohlížeč ji hlásí jako nenačtený zdroj)
  const dalsi = chyby.slice(chybPred).filter((c) => !/status of 502/.test(c));
  expect(dalsi.length === 0 && chyby.length - chybPred <= 1, `konzole po výpadku: jen očekávaná 502 (${chyby.slice(chybPred).join(' | ')})`);
}, { nazev: 'UI-AI-OBRAZKY' });
