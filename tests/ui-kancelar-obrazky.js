// Obrázky v Kanceláři (3. 11. 2026) — klikací sada proti podvržené ollamě a podvržené bráně (mode=image).
//
// Co hlídá: tah s draft_presentation + picture / slide_pictures → karta `soubor` v chatu SAMA nakreslí oba obrázky
// (náhledy na kartě), stažení počká, než jsou hotové; stažené PDF má obrázek na titulní straně a u snímku, PPTX na
// titulním snímku; po reloadu se nekreslí znovu; panel Dokumentů: sekce Obrázky s náhledy, Nakreslit znovu (nový
// soubor), nový obrázek vlastním popisem ke zvolenému snímku, Odebrat (uloží se do meta), náhled PDF; přání s
// obrázkem → stažené PDF ho má; diplom sekci Obrázky nemá; obrázek, který karta nenakreslila (tah bez prohlížeče),
// panel po 30 s nakreslí sám — dřív ne, ať se s kartou nepřetahuje o zámek (409 v konzoli); konzole bez chyb.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ui-kancelar-obrazky.js
const H = require('./_harness');
const { expect, sleep } = H;
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

// 16×16 JPEG (červený / modrý) — střídají se, ať je po Nakreslit znovu vidět jiný soubor
const JPEG = [
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDPooorhPqD/9k=',
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDn6KKK+oMT/9k=',
];
const OSNOVA = '# Kuchyň Truhlářství\nStav pro klienta\n## Cíl\n- Linka do 30. 11. 2026\n- Dub masiv\n## Kde jsme\n- Návrh hotový\n## Další kroky\n- 5. 11. montáž korpusů';

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
const kresleni = [];
const branaHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  const b = JSON.parse(body || '{}');
  if (b.mode !== 'image') { res.statusCode = 400; res.end('{}'); return; }
  kresleni.push(b);
  const i = kresleni.length;
  setTimeout(() => res.end(JSON.stringify({ image_base64: JPEG[i % 2], mime: 'image/jpeg', model: b.model, seed: 7 + i, size: '512x896', gen_s: 0.9, schema_version: 1 })), 900);
};

const FE = path.join(__dirname, '../frontend');
const balik = (p) => import(pathToFileURL(path.join(FE, 'node_modules', p)).href);

H.beh(async () => {
  const PDFLib = await balik('pdf-lib/dist/pdf-lib.esm.js');
  const JSZip = (await balik('jszip/dist/jszip.min.js')).default;
  const xobjekty = async (soubor) => (await PDFLib.PDFDocument.load(fs.readFileSync(soubor))).getPages().map((pg) => {
    const x = pg.node.Resources() && pg.node.Resources().lookup(PDFLib.PDFName.of('XObject'));
    return x ? x.keys().length : 0;
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-kancelar-obr-'));
  const stazene = path.join(tmp, 'stazene'); fs.mkdirSync(stazene);
  const cekejSoubor = async (pripona, ms = 25000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const f = fs.readdirSync(stazene).filter((x) => x.endsWith(pripona) && !x.endsWith('.crdownload'));
      if (f.length) { await sleep(600); return path.join(stazene, f[0]); }
      await sleep(300);
    }
    return '';
  };
  const vyprazdni = () => { for (const f of fs.readdirSync(stazene)) fs.unlinkSync(path.join(stazene, f)); };

  const mock = await H.httpMock(chatHandler);
  const brana = await H.httpMock(branaHandler);
  const inst = await H.startInstance({ slug: 'ui-kancelar-obr', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
    KB_IMAGE_URL: brana.base + '/v1/advisor', KB_IMAGE_TOKEN: 'img_tok',
  } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  const A = await inst.login('admin@example.com');
  const dokApi = async (id) => (await inst.api('GET', `/api/kb/chat/dokument/${id}`, { token: A })).json.dokument;

  const { page, chyby } = await H.browser();
  await page.evaluateOnNewDocument((tk) => {
    localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} }));
    localStorage.setItem('kb-chat-open', '1');
    try { const uid = JSON.parse(atob(tk.split('.')[1])).id; const d = new Date().toLocaleDateString('en-CA'); for (const k of ['kb-relax-rano', 'kb-chat-porada-ne']) localStorage.setItem(`${k}:${uid}`, d); localStorage.setItem('kb-chat-porada-ne', d); } catch { /* bez uid */ }
  }, A);
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: stazene, eventsEnabled: true });
  const cekej = async (sel, ms = 15000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const napis = async (s) => { await page.click('[data-testid="chat-input"]'); await page.keyboard.type(s); await page.click('[data-testid="chat-send"]'); };
  const nactene = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((i) => i.complete && i.naturalWidth > 0).length, sel);
  const cekejNactene = async (sel, n, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await nactene(sel)) >= n) return true; await sleep(250); } return false; };

  console.log('== prezentace: karta sama nakreslí titulní obrázek i obrázek snímku ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  if (!(await page.$('[data-testid="chat-input"]'))) { const t = await page.$('[data-testid="chat-tab"]'); if (t) await t.click(); }
  expect(await cekej('[data-testid="chat-input"]'), 'asistent otevřený');
  fronta.push(nastroj('draft_presentation', { title: 'Kuchyň Truhlářství', text: OSNOVA, picture: 'a bright modern oak kitchen, flat illustration', slide_pictures: [{ slide: 'Cíl', prompt: 'a target with an arrow, flat illustration' }] }), text('Prezentace je v Dokumentech.'));
  await napis('Udělej prezentaci pro klienta');
  expect(await cekej('[data-testid="chat-soubor-obrazky"][data-stav="pise"]', 20000), 'karta prezentace: pás obrázků „Kreslím obrázky…“ hned po tahu (bez kliknutí)');
  const zakazano = await page.$eval('[data-testid="chat-soubor-pdf"]', (b) => b.disabled).catch(() => null);
  expect(zakazano === true, `během kreslení je stažení zakázané (soubor by byl bez obrázků) (${zakazano})`);
  expect(await cekejNactene('[data-testid="chat-soubor"] [data-testid="chat-soubor-obrazek"]', 2), 'na kartě 2 nakreslené náhledy');
  expect(await cekej('[data-testid="chat-soubor-obrazky"][data-stav="hotovo"]', 5000) && kresleni.length === 2 && kresleni.every((b) => b.preset === 'vysoky'), `brána volána 2×, preset vysoky (${kresleni.length})`);
  const docId = await page.$eval('[data-testid="chat-soubor"]', (el) => el.getAttribute('data-doc-id'));

  console.log('== stažení z karty: obrázky v PDF i PPTX ==');
  vyprazdni();
  await page.click('[data-testid="chat-soubor-pdf"]');
  let soubor = await cekejSoubor('.pdf');
  const x1 = soubor ? await xobjekty(soubor) : [];
  expect(JSON.stringify(x1) === '[1,1,0,0]', `PDF: obrázek na titulní straně a u snímku „Cíl“, jinde ne (${JSON.stringify(x1)})`);
  vyprazdni();
  await page.click('[data-testid="chat-soubor-pptx"]');
  soubor = await cekejSoubor('.pptx');
  let pics = [];
  if (soubor) { const zip = await JSZip.loadAsync(fs.readFileSync(soubor)); for (let n = 1; n <= 4; n++) pics.push(((await zip.file(`ppt/slides/slide${n}.xml`).async('string')).match(/<p:pic>/g) || []).length); }
  expect(JSON.stringify(pics) === '[1,1,0,0]', `PPTX: obrázek na titulním snímku a u „Cíl“ (${JSON.stringify(pics)})`);

  console.log('== reload: karta obrázky jen načte, nekreslí ==');
  await page.reload({ waitUntil: 'networkidle2' });
  if (!(await page.$('[data-testid="chat-input"]'))) { const t = await page.$('[data-testid="chat-tab"]'); if (t) await t.click(); }
  expect(await cekejNactene('[data-testid="chat-soubor"] [data-testid="chat-soubor-obrazek"]', 2), 'po reloadu karta ukazuje oba náhledy');
  await sleep(1200);
  expect(kresleni.length === 2, `reload nekreslí znovu (${kresleni.length}× brána)`);

  console.log('== panel Dokumentů: sekce Obrázky ==');
  await page.click('[data-testid="chat-soubor-otevrit"]');
  expect(await cekej('[data-testid="chat-dok-obrazky"]'), 'panel: sekce Obrázky');
  expect(await cekejNactene('[data-testid="chat-dok-obrazek-img"]', 2), 'panel: 2 náhledy obrázků');
  const sloty = await page.$$eval('[data-testid="chat-dok-obrazek"]', (els) => els.map((e) => e.dataset.slot));
  expect(JSON.stringify(sloty) === '["","Cíl"]' && /Titulní snímek/.test(await page.$eval('[data-testid="chat-dok-obrazky"]', (el) => el.innerText)), `panel: titulní snímek + „Cíl“ (${JSON.stringify(sloty)})`);
  // ⚠️ čekat na obrázek TITULNÍHO místa (slot ""): během kreslení ho nahradí točítko a první img v panelu je pak
  // snímek „Cíl“ s jiným src → čekání skončilo dřív, než požadavek došel k bráně (nestálý test, checkup 5. 11.)
  const TITULNI = '[data-testid="chat-dok-obrazek"][data-slot=""] [data-testid="chat-dok-obrazek-img"]';
  const src1 = await page.$eval(TITULNI, (i) => i.src);
  await page.click('[data-testid="chat-dok-obrazek"][data-slot=""] [data-testid="chat-dok-obrazek-znovu"]');
  const jiny = await page.waitForFunction((sel, s) => { const i = document.querySelector(sel); return i && i.src !== s && i.complete && i.naturalWidth > 0; }, { timeout: 15000 }, TITULNI, src1).then(() => true).catch(() => false);
  for (let i = 0; i < 50 && kresleni.length < 3; i++) await sleep(100);
  expect(jiny && kresleni.length === 3, `Nakreslit znovu → nový soubor (${kresleni.length}× brána)`);

  await page.select('[data-testid="chat-dok-obrazek-slot"]', 'Další kroky');
  await page.click('[data-testid="chat-dok-obrazek-popis"]');
  await page.keyboard.type('montéři skládají kuchyň, plochá ilustrace');
  await page.click('[data-testid="chat-dok-obrazek-pridat"]');
  expect(await cekejNactene('[data-testid="chat-dok-obrazek-img"]', 3), 'nový obrázek vlastním popisem se nakreslil v panelu');
  let d = await dokApi(docId);
  expect(d.meta.images.length === 3 && d.meta.images.some((x) => x.slot === 'Další kroky') && kresleni.length === 4 && /montéři skládají kuchyň, plochá ilustrace, no text, no letters/.test(kresleni[3].prompt),
    `uloženo k snímku „Další kroky“, brána dostala popis + „no text“ (${JSON.stringify(d.meta.images.map((x) => x.slot))})`);
  const kOdebrani = await page.$$('[data-testid="chat-dok-obrazek"][data-slot="Cíl"] [data-testid="chat-dok-obrazek-odebrat"]');
  await kOdebrani[0].click();
  const odebrano = await page.waitForFunction(() => !document.querySelector('[data-testid="chat-dok-obrazek"][data-slot="Cíl"]'), { timeout: 8000 }).then(() => true).catch(() => false);
  d = await dokApi(docId);
  expect(odebrano && d.meta.images.length === 2 && !d.meta.images.some((x) => x.slot === 'Cíl'), `Odebrat → obrázek „Cíl“ pryč z panelu i z meta (${JSON.stringify(d.meta.images.map((x) => x.slot))})`);
  await page.click('[data-testid="chat-dok-nahled"]');
  expect(await cekej('[data-testid="chat-dok-nahled-obrazek"]', 15000), 'náhled první strany s obrázkem se vykreslí');
  vyprazdni();
  await page.click('[data-testid="chat-dok-soubor-pdf"]');
  soubor = await cekejSoubor('.pdf');
  const x2 = soubor ? await xobjekty(soubor) : [];
  expect(JSON.stringify(x2) === '[1,0,0,1]', `PDF z panelu: titulní + „Další kroky“, „Cíl“ už ne (${JSON.stringify(x2)})`);

  console.log('== přání s obrázkem; diplom bez sekce Obrázky ==');
  fronta.push(nastroj('draft_card', { kind: 'greeting', title: 'PF 2027', text: 'Hodně zdraví v novém roce.', signature: 'Truhlářství Novák', picture: 'a snowy village at dusk, watercolor' }), text('Přání je hotové.'));
  await napis('Udělej přání PF 2027 pro klienty');
  const kartaPrani = '[data-testid="chat-soubor"][data-template="greeting"]';
  expect(await cekej(kartaPrani, 20000) && await cekejNactene(`${kartaPrani} [data-testid="chat-soubor-obrazek"]`, 1), 'karta přání nakreslila obrázek');
  await page.waitForFunction((s) => { const b = document.querySelector(`${s} [data-testid="chat-soubor-pdf"]`); return b && !b.disabled; }, { timeout: 10000 }, kartaPrani).catch(() => {});
  vyprazdni();
  await page.click(`${kartaPrani} [data-testid="chat-soubor-pdf"]`);
  soubor = await cekejSoubor('.pdf');
  const x3 = soubor ? await xobjekty(soubor) : [];
  expect(JSON.stringify(x3) === '[1]' && kresleni[kresleni.length - 1].preset === 'vysoky', `PDF přání má obrázek v pruhu (${JSON.stringify(x3)})`);
  fronta.push(nastroj('draft_card', { kind: 'certificate', title: 'Diplom', text: 'Jana Nováková\nza deset let', picture: 'a golden medal' }), text('Diplom je hotový.'));
  await napis('Udělej diplom pro Janu');
  const kartaDiplom = '[data-testid="chat-soubor"][data-template="certificate"]';
  expect(await cekej(kartaDiplom, 20000) && !(await page.$(`${kartaDiplom} [data-testid="chat-soubor-obrazky"]`)), 'karta diplomu bez obrázků');
  await page.click(`${kartaDiplom} [data-testid="chat-soubor-otevrit"]`);
  await cekej('[data-testid="chat-dok-detail"][data-kind="card"]');
  await sleep(800);
  expect(!(await page.$('[data-testid="chat-dok-obrazky"]')), 'diplom: sekce Obrázky v panelu není');

  console.log('== zapomenutý obrázek (tah bez prohlížeče): panel ho po 30 s nakreslí sám ==');
  fronta.push(nastroj('draft_card', { kind: 'poster', title: 'Den otevřených dveří', text: 'Přijďte se podívat do dílny.', picture: 'an open workshop door, sunny morning' }), text('Plakát je hotový.'));
  const rApi = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Udělej plakát na den otevřených dveří' } });
  const kPlakat = rApi.json.chat.messages.flatMap((m) => m.karty || []).find((k) => k.template === 'poster');
  const predPlakat = kresleni.length;
  await sleep(31000);
  expect(kresleni.length === predPlakat, 'bez prohlížeče nikdo nekreslí (karta nebyla vidět)');
  await page.reload({ waitUntil: 'networkidle2' });
  if (!(await page.$('[data-testid="chat-dok-polozka"]'))) { const b = await page.$('[data-testid="chat-dokumenty-btn"]'); if (b) await b.click(); }
  if (!(await page.$(`[data-testid="chat-dok-polozka"][data-id="${kPlakat.doc_id}"]`))) { const z = await page.$('[data-testid="chat-dok-zpet"]'); if (z) await z.click(); }
  expect(await cekej(`[data-testid="chat-dok-polozka"][data-id="${kPlakat.doc_id}"]`), 'plakát je v seznamu Dokumentů');
  await page.click(`[data-testid="chat-dok-polozka"][data-id="${kPlakat.doc_id}"]`);
  expect(await cekejNactene('[data-testid="chat-dok-obrazek-img"]', 1) && kresleni.length === predPlakat + 1 && kresleni[kresleni.length - 1].preset === 'hlavicka', `panel zapomenutý obrázek nakreslil (preset hlavicka) (${kresleni.length - predPlakat}×)`);

  expect(chyby.length === 0, `konzole bez chyb (${chyby.slice(0, 3).join(' | ')})`);
}, { nazev: 'UI-KANCELAR-OBRAZKY' });
