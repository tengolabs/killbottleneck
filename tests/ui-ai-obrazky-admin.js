// Obrázky v asistentovi z Administrace — klik v prohlížeči (30. 9. 2026, fáze A plánu AI funkcí).
//
// Self-host s klíčem OpenAI zadaným v Administraci dřív obrázky neměl (šly zapnout jen proměnnými
// KB_VISION_*). Nově: zaškrtnout „Asistent čte obrázky“ → Uložit → server zkusí vestavěný obrázek →
// jen když ho model přečte, panel asistenta fotku nabídne. Hodnoty se píšou KLÁVESNICÍ (zámek pole
// umí spolknout programové vyplnění) a Uložit se hledá V KARTĚ AI (na stránce je Uložit víckrát).
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ui-ai-obrazky-admin.js
const H = require('./_harness');
const { expect, sleep } = H;

let slepy = false;
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) { res.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-4o-mini' }] })); return; }
  if (!req.url.startsWith('/v1/chat/completions')) { res.statusCode = 404; res.end('{}'); return; }
  const b = JSON.parse(body || '{}');
  const sObrazkem = (b.messages || []).some((m) => Array.isArray(m.content) && m.content.some((c) => c && c.type === 'image_url'));
  const text = sObrazkem ? (slepy ? 'Nic tam není.' : 'KB 4729') : 'Dobrý den.';
  res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 5 } }));
};

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ui-ai-obrazky-admin', addHostGateway: true, env: { KB_UVODNI_MAPA: 0 } });
  await inst.register('admin@example.com', { name: 'Petr' });
  const A = await inst.login('admin@example.com');
  const { page, chyby } = await H.browser();
  await page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); localStorage.setItem('kb-chat-porada-ne', new Date().toLocaleDateString('en-CA')); }, A);
  const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const napis = async (sel, text) => { await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace'); await page.keyboard.type(text); };
  // tlačítko v KARTĚ AI (sourozenec „Otestovat připojení“), ne jiné Uložit na stránce
  const klikniVKarte = (popis) => page.evaluate((p) => {
    const karta = document.querySelector('#ai-url')?.closest('.rounded-xl');
    const b = karta && [...karta.querySelectorAll('button')].find((x) => x.innerText.trim() === p);
    if (b) b.click();
    return !!b;
  }, popis);

  console.log('== dlaždice OpenAI + zapnutí obrázků ==');
  await page.goto(`${inst.base}/admin/users`, { waitUntil: 'networkidle2' });
  const openai = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /OpenAI/.test(b.innerText)));
  expect(!!(await openai.asElement()), 'dlaždice OpenAI je v Administraci');
  await openai.asElement().click();
  expect(await cekej('#ai-url') && await cekej('[data-testid="ai-vision"]'), 'OpenAI ukáže pole i blok obrázků');
  await napis('#ai-url', mock.base + '/v1');
  await napis('#ai-model', 'gpt-4o-mini');
  await napis('#ai-token', 'sk-test-ui-klic');
  expect(!(await page.$('[data-testid="ai-vision-model"]')), 'pole modelu obrázků je skryté, dokud obrázky nejsou zapnuté');
  await page.click('[data-testid="ai-vision-zapnout"]');
  expect(await cekej('[data-testid="ai-vision-model"]') && await cekej('[data-testid="ai-vision-test"]'), 'po zaškrtnutí: model obrázků a Otestovat obrázek');
  expect(await klikniVKarte('Uložit'), 'Uložit v kartě AI');
  expect(await cekej('[data-testid="ai-vision-vysledek"]', 20000), 'po uložení výsledek testu obrázku');
  const vysl = await page.$eval('[data-testid="ai-vision-vysledek"]', (el) => el.innerText);
  expect(/Obrázek přečten/.test(vysl), `uložení = test vestavěného obrázku prošel („${vysl}“)`);

  console.log('== panel asistenta po uložení nabízí fotku ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  await cekej('[data-testid="chat-tab"]');
  await page.click('[data-testid="chat-tab"]');
  expect(await cekej('[data-testid="chat-obrazek-input"]'), 'panel asistenta je otevřený');
  const accept = await page.$eval('[data-testid="chat-obrazek-input"]', (el) => el.accept);
  expect(/image\/png/.test(accept) && /pdf/.test(accept), `sponka bere obrázky i PDF (${accept})`);

  console.log('== slepý model: Otestovat obrázek → obrázky zase vypnuté ==');
  slepy = true;
  await page.goto(`${inst.base}/admin/users`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="ai-vision-stav"]') && /Ověřeno/.test(await page.$eval('[data-testid="ai-vision-stav"]', (el) => el.innerText)), 'po návratu stav „Ověřeno“');
  await page.click('[data-testid="ai-vision-test"]');
  expect(await cekej('[data-testid="ai-vision-vysledek"]', 20000), 'výsledek testu obrázku');
  await sleep(300);
  const vysl2 = await page.$eval('[data-testid="ai-vision-vysledek"]', (el) => el.innerText);
  expect(/nepřečetl/.test(vysl2), `slepý model = srozumitelné „nepřečetl“ („${vysl2.slice(0, 90)}“)`);
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  // panel si pamatuje, že zůstal otevřený — ouško je vidět jen u zavřeného
  if (!(await cekej('[data-testid="chat-obrazek-input"]', 3000))) { await cekej('[data-testid="chat-tab"]'); await page.click('[data-testid="chat-tab"]'); }
  await cekej('[data-testid="chat-obrazek-input"]');
  const acceptPo = await page.$eval('[data-testid="chat-obrazek-input"]', (el) => el.accept);
  expect(/application\/pdf/.test(acceptPo) && !/image/.test(acceptPo), `po neúspěšném testu sponka nenabízí obrázky (${acceptPo})`);
  expect(chyby.length === 0, `konzole bez chyb (${chyby.slice(0, 3).join(' | ')})`);
}, { nazev: 'UI-AI-OBRAZKY-ADMIN' });
