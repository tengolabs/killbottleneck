// Kancelář v asistentovi (14. 10. 2026) — klikací sada (headless Chrome, podvržený model).
//
// Co hlídá: tah s draft_presentation → karta `soubor` v chatu (Stáhnout PowerPoint / PDF) + panel Dokumentů se sám
// otevře na prezentaci; SKUTEČNÉ stažení PPTX (zip se snímky), PDF (strany 16:9, text) a Wordu (document.xml) z karty
// i z panelu; náhled první strany; úprava podtitulu v panelu (meta) → uloženo; přání: šablona a barva se ukládají do
// meta (ověřeno přes API), fotka z disku jde do PDF (neukládá se nikam), stažené PDF má rozměr šablony; filtr
// „Kancelář“; AI blok: Prezentace, přání, pozvánka → formulář Nový dokument v Kanceláři (0 volání modelu); formulář složí zprávu
// (pozvánka: akce, kdy, kde, odkaz, tón) → karta soubor; tlačítko Nový v každé podsekci + čipy druhů v prázdném filtru; PDF jako
// záložka Kanceláře (ikonka v hlavičce chatu pryč, 1. 11. 2026); konzole bez chyb.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ui-ai-kancelar.js
const H = require('./_harness');
const { expect, sleep } = H;
// barva v PDF: rozbalí FlateDecode proudy a hledá operátor „r g b rg/RG“ blízko zadané barvy (pdf-lib píše desetinné podíly)
const zlib = require('zlib');
function pdfMaBarvu(cesta, rgbCil) {
  const raw = fs.readFileSync(cesta).toString('latin1'); const texty = [raw];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g; let m;
  while ((m = re.exec(raw))) { try { texty.push(zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1')); } catch (e) { /* nekomprimovaný proud */ } }
  const cil = rgbCil.map((x) => x / 255);
  for (const t of texty) { const r2 = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(?:rg|RG)\b/g; let k; while ((k = r2.exec(t))) { if ([1, 2, 3].every((j) => Math.abs(Number(k[j]) - cil[j - 1]) < 0.01)) return true; } }
  return false;
}
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

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
const FE = path.join(__dirname, '../frontend');
const balik = (p) => import(pathToFileURL(path.join(FE, 'node_modules', p)).href);
const OSNOVA = '# Kuchyň Truhlářství\nStav pro klienta\n## Cíl\n- Linka do 30. 11. 2026\n- Dub masiv\n> Cena bez spotřebičů.\n## Kde jsme\n- Návrh hotový\n## Další kroky\n- 5. 11. montáž korpusů';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

H.beh(async () => {
  const pdfjs = await balik('pdfjs-dist/legacy/build/pdf.mjs');
  const JSZip = (await balik('jszip/dist/jszip.min.js')).default;
  const pdfInfo = async (soubor) => {
    const d = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(soubor)), useSystemFonts: true }).promise;
    const strany = [];
    for (let i = 1; i <= d.numPages; i++) strany.push((await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(' '));
    const v = (await d.getPage(1)).getViewport({ scale: 1 });
    return { strany, w: Math.round(v.width), h: Math.round(v.height) };
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-kancelar-'));
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
  const fotka = path.join(tmp, 'fotka.png'); fs.writeFileSync(fotka, PNG);

  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ui-kancelar', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
  } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  const A = await inst.login('admin@example.com');
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Truhlářství', nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň', title: 'Kuchyň', status: 'todo' } }], edges: [] } })).json;
  expect(!!map.id, 'mapa založena');

  const { page, chyby } = await H.browser();
  await page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); localStorage.setItem('kb-chat-porada-ne', new Date().toLocaleDateString('en-CA')); localStorage.setItem('kb-chat-open', '1'); }, A);
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: stazene, eventsEnabled: true });
  const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const textDok = () => page.evaluate(() => document.querySelector('[data-testid="chat-dokumenty"]')?.innerText || '');
  const cekejTextDok = async (s, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await textDok()).includes(s)) return true; await sleep(250); } return false; };
  const napis = async (s) => { await page.click('[data-testid="chat-input"]'); await page.keyboard.type(s); await page.keyboard.press('Enter'); };
  const dokApi = async (id) => (await inst.api('GET', `/api/kb/chat/dokument/${id}`, { token: A })).json.dokument;

  console.log('== prezentace: karta soubor + Dokumenty se otevřou na prezentaci ==');
  await page.goto(`${inst.base}/map/${map.id}`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-panel"]'), 'panel asistenta otevřený');
  fronta.push(nastroj('draft_presentation', { title: 'Kuchyň Truhlářství', subtitle: 'Stav pro klienta', map: 'Truhlářství', text: OSNOVA }), text('Prezentace je v Dokumentech.'));
  await napis('Udělej prezentaci projektu Truhlářství pro klienta');
  expect(await cekej('[data-testid="chat-soubor"][data-druh="presentation"]', 15000), 'karta soubor (prezentace) v chatu');
  const tlacitka = await page.$$eval('[data-testid="chat-soubor"] button', (els) => els.map((e) => e.getAttribute('data-testid')));
  expect(tlacitka.includes('chat-soubor-pptx') && tlacitka.includes('chat-soubor-pdf') && !tlacitka.includes('chat-soubor-docx') && tlacitka.includes('chat-soubor-otevrit'), `karta: Stáhnout PowerPoint + PDF + Otevřít vedle (${tlacitka.join(',')})`);
  expect(/3 snímků/.test(await page.$eval('[data-testid="chat-soubor"]', (el) => el.innerText)), 'karta ukazuje počet snímků');
  expect(await cekej('[data-testid="chat-dok-detail"][data-kind="presentation"]', 15000), 'panel Dokumentů se sám otevřel na prezentaci');
  const docId = await page.$eval('[data-testid="chat-dok-detail"]', (el) => el.getAttribute('data-id'));
  expect(await cekejTextDok('Stav pro klienta') && await cekejTextDok('Podtitul'), 'detail ukazuje podtitul z meta');
  expect(!(await page.$('[data-testid="chat-dok-obrazky"]')), 'bez služby obrázků (KB_IMAGE_*) panel sekci Obrázky nenabízí');
  expect(await cekej('[data-testid="chat-dok-kancelar"]') && !!(await page.$('[data-testid="chat-dok-soubor-pptx"]')) && !!(await page.$('[data-testid="chat-dok-soubor-pdf"]')) && !!(await page.$('[data-testid="chat-dok-soubor-docx"]')), 'panel: Stáhnout jako PowerPoint / PDF / Word');

  console.log('== skutečná stažení z karty a z panelu ==');
  const predStazenim = volani.length;
  vyprazdni();
  await page.click('[data-testid="chat-soubor-pptx"]');
  let soubor = await cekejSoubor('.pptx');
  expect(!!soubor && /Kuchyň Truhlářství\.pptx$/.test(soubor), `PPTX staženo z karty (${path.basename(soubor || '—')})`);
  if (soubor) {
    const zip = await JSZip.loadAsync(fs.readFileSync(soubor));
    const snimky = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    const s2 = snimky.length > 1 ? await zip.file('ppt/slides/slide2.xml').async('string') : '';
    const pozn = (await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f)).map((f) => zip.file(f).async('string')))).join(' ');
    expect(snimky.length === 4 && /Linka do 30\. 11\. 2026/.test(s2) && /Cena bez spotřebičů/.test(pozn), `PPTX: titulní + 3 snímky, odrážky, poznámky řečníka (${snimky.length})`);
  }
  vyprazdni();
  await page.click('[data-testid="chat-dok-soubor-pdf"]');
  soubor = await cekejSoubor('.pdf');
  expect(!!soubor, `PDF staženo z panelu (${path.basename(soubor || '—')})`);
  if (soubor) { const i = await pdfInfo(soubor); expect(i.strany.length === 4 && i.w === 960 && i.h === 540 && /Kuchyň Truhlářství/.test(i.strany[0]) && /Stav pro klienta/.test(i.strany[0]) && /Dub masiv/.test(i.strany[1]), `PDF: 4 strany 16:9, titul, podtitul, odrážky (${i.strany.length}, ${i.w}×${i.h})`); }
  vyprazdni();
  await page.click('[data-testid="chat-dok-soubor-docx"]');
  soubor = await cekejSoubor('.docx');
  expect(!!soubor, `Word stažen z panelu (${path.basename(soubor || '—')})`);
  if (soubor) { const zip = await JSZip.loadAsync(fs.readFileSync(soubor)); const d = await zip.file('word/document.xml').async('string'); expect(/1\. Cíl/.test(d) && /Dub masiv/.test(d) && /Poznámky řečníka/.test(d), 'Word: osnova s číslovanými snímky a poznámkami'); }
  expect(volani.length === predStazenim, 'stažení nešla přes model ani server (žádné další volání)');

  console.log('== náhled první strany; úprava podtitulu (meta) v panelu ==');
  await page.click('[data-testid="chat-dok-nahled"]');
  expect(await cekej('[data-testid="chat-dok-nahled-obrazek"]', 20000) && /^data:image\/png/.test(await page.$eval('[data-testid="chat-dok-nahled-obrazek"]', (el) => el.getAttribute('src'))), 'náhled = PNG první strany');
  await page.click('[data-testid="chat-dok-upravit"]');
  expect(await cekej('[data-testid="chat-dok-meta-subtitle"]') && !!(await page.$('[data-testid="chat-dok-meta-audience"]')) && !(await page.$('[data-testid="chat-dok-meta-date"]')), 'úprava prezentace: pole Podtitul a Pro koho (ne Kdy/Kde)');
  expect(await cekejTextDok('Osnova: „# Název“'), 'nápověda k formátu osnovy');
  await page.click('[data-testid="chat-dok-meta-subtitle"]', { clickCount: 3 });
  await page.keyboard.type('Pro jednání 20. 10.');
  await page.click('[data-testid="chat-dok-ulozit"]');
  expect(await cekejTextDok('Uloženo.'), 'uloženo');
  let dok = await dokApi(docId);
  expect(dok.meta.subtitle === 'Pro jednání 20. 10.' && dok.text === OSNOVA && dok.ma_predchozi, `meta podtitul uložen, text beze změny, předchozí verze (${JSON.stringify(dok.meta)})`);
  expect(await cekej('[data-testid="chat-dok-meta-cteni"]') && await cekejTextDok('Pro jednání 20. 10.'), 'čtení ukazuje nový podtitul');

  console.log('== přání: šablona, barva a fotka v panelu; PDF má rozměr šablony ==');
  await page.click('[data-testid="chat-novy"]');
  fronta.push(nastroj('draft_card', { kind: 'greeting', title: 'PF 2027', text: 'Děkujeme za spolupráci.', signature: 'Tým Truhlářství' }), text('Přání je hotové.'));
  await napis('Napiš PF 2027 pro klienty');
  expect(await cekej('[data-testid="chat-soubor"][data-druh="card"][data-template="greeting"]', 15000), 'karta soubor (přání greeting)');
  expect(!(await page.$('[data-testid="chat-soubor"][data-druh="card"] [data-testid="chat-soubor-pptx"]')), 'přání nenabízí PowerPoint');
  expect(await cekej('[data-testid="chat-dok-detail"][data-kind="card"]', 15000), 'Dokumenty se otevřely na přání');
  const kartaId = await page.$eval('[data-testid="chat-dok-detail"]', (el) => el.getAttribute('data-id'));
  expect(await cekej('[data-testid="chat-dok-sablona"]') && !!(await page.$('[data-testid="chat-dok-barva"]')) && !!(await page.$('[data-testid="chat-dok-fotka"]')), 'ovládání: šablona, barva, fotka');
  await page.select('[data-testid="chat-dok-sablona"]', 'poster');
  await sleep(800);
  dok = await dokApi(kartaId);
  expect(dok.meta.template === 'poster' && dok.meta.signature === 'Tým Truhlářství', `šablona Plakát uložena do meta, podpis zůstal (${JSON.stringify(dok.meta)})`);
  await page.evaluate(() => { const el = document.querySelector('[data-testid="chat-dok-barva"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '#b91c1c'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(800);
  dok = await dokApi(kartaId);
  expect(dok.meta.color === '#b91c1c' && dok.meta.template === 'poster', `barva uložena do meta (${dok.meta.color})`);
  expect(await cekej('[data-testid="chat-dok-barva-vzhled"]'), 'nabídka „Barva vzhledu“ (návrat k akcentu skinu)');
  // /checkup 2. 11. 2026: stažení z KARTY v chatu (panel barvu neposílá) musí barvu z meta také použít
  vyprazdni();
  await page.click('[data-testid="chat-soubor"][data-druh="card"] [data-testid="chat-soubor-pdf"]');
  soubor = await cekejSoubor('.pdf');
  expect(!!soubor && pdfMaBarvu(soubor, [0xb9, 0x1c, 0x1c]), `PDF stažené z karty v chatu má barvu z meta #b91c1c, ne akcent skinu (${path.basename(soubor || '—')})`);
  await (await page.$('[data-testid="chat-dok-fotka"]')).uploadFile(fotka);
  expect(await cekejTextDok('fotka.png') && await cekej('[data-testid="chat-dok-fotka-pryc"]'), 'vybraná fotka je vidět, jde ji odebrat');
  vyprazdni();
  await page.click('[data-testid="chat-dok-soubor-pdf"]');
  soubor = await cekejSoubor('.pdf');
  expect(!!soubor && /PF 2027\.pdf$/.test(soubor), `PDF přání staženo (${path.basename(soubor || '—')})`);
  if (soubor) { const i = await pdfInfo(soubor); expect(i.strany.length === 1 && i.w === 595 && i.h === 842 && /PF 2027/.test(i.strany[0]) && /Děkujeme za spolupráci/.test(i.strany[0]) && /Tým Truhlářství/.test(i.strany[0]), `plakát A4 s nadpisem, textem a podpisem (${i.w}×${i.h})`); }
  dok = await dokApi(kartaId);
  expect(!JSON.stringify(dok).includes('fotka') && !('photo' in dok.meta), 'fotka se na server neukládá');
  await page.click('[data-testid="chat-dok-barva-vzhled"]');
  await sleep(800);
  dok = await dokApi(kartaId);
  expect(!dok.meta.color, '„Barva vzhledu“ barvu z meta odstraní');

  console.log('== filtr Kancelář; AI blok → formulář od aplikace ==');
  await page.click('[data-testid="chat-dok-zpet"]');
  expect(await cekej('[data-testid="chat-dok-filtr"][data-skupina="kancelar"]'), 'filtr Kancelář v seznamu');
  await page.click('[data-testid="chat-dok-filtr"][data-skupina="kancelar"]');
  await sleep(600);
  const druhy = await page.$$eval('[data-testid="chat-dok-polozka"]', (els) => els.map((e) => e.getAttribute('data-kind')));
  expect(druhy.length === 2 && druhy.every((k) => k === 'presentation' || k === 'card'), `filtr Kancelář = prezentace + přání (${druhy.join(',')})`);
  await page.click('[data-testid="chat-novy"]');
  expect(await cekej('[data-testid="chat-blok-kancelar"]'), 'AI blok nabízí Prezentace, přání, pozvánka');
  const predForm = volani.length;
  await page.click('[data-testid="chat-blok-kancelar"]');
  // od 1. 11. 2026 pomocník otevře formulář „Nový dokument“ v panelu Kancelář (jeden průvodce pro tlačítko i AI blok, 0 volání modelu)
  expect(await cekej('[data-testid="chat-dok-novy-form"]', 5000), 'pomocník otevře formulář Nový dokument v Kanceláři');
  expect(volani.length === predForm, 'formulář je od aplikace — model nevolán');
  const druhy2 = await page.$$eval('[data-testid="chat-dok-druh"]', (els) => els.map((e) => e.getAttribute('data-druh')));
  expect(druhy2.length === 11 && druhy2.slice(0, 5).join(',') === 'presentation,greeting,invitation,poster,certificate' && druhy2.includes('email') && druhy2.includes('faktura') && druhy2.includes('volne'), `dlaždice: 5 kancelářských + e-mail, porada, poznámka, souhrn, faktura, volně (${druhy2.length})`);

  console.log('== Nový dokument: pozvánka přes formulář → složená zpráva → model → karta soubor ==');
  await page.click('[data-testid="chat-dok-druh"][data-druh="invitation"]');
  expect(await page.$eval('[data-testid="chat-dok-novy-odeslat"]', (b) => b.disabled), 'bez názvu akce nejde odeslat (povinné pole)');
  await page.type('[data-testid="chat-dok-novy-akce"]', 'Vánoční večírek');
  await page.type('[data-testid="chat-dok-novy-kdy"]', '12. 12. 2026 v 18:00');
  await page.type('[data-testid="chat-dok-novy-kde"]', 'dílna, Dlouhá 12');
  await page.type('[data-testid="chat-dok-novy-odkaz"]', 'https://example.com/vecirek');
  await page.click('[data-testid="chat-dok-novy-ton"][data-volba="slavnostni"]');
  expect(!(await page.$eval('[data-testid="chat-dok-novy-odeslat"]', (b) => b.disabled)), 'po vyplnění jde odeslat');
  fronta.push(nastroj('draft_card', { kind: 'invitation', title: 'Vánoční večírek', text: 'Přijďte.', date: '12. 12. 2026 18:00', place: 'dílna, Dlouhá 12', link: 'https://example.com/vecirek' }), text('Pozvánka je hotová.'));
  const predOdeslanim = volani.length;
  await page.click('[data-testid="chat-dok-novy-odeslat"]');
  expect(await cekej('[data-testid="chat-soubor"][data-druh="card"]', 15000), 'karta soubor (pozvánka) v chatu');
  const zprava = String(((volani[predOdeslanim] || {}).messages || []).filter((m) => m.role === 'user').pop()?.content || '');
  expect(/Udělej pozvánku jako PDF\./.test(zprava) && /Akce: Vánoční večírek\./.test(zprava) && /Kdy: 12\. 12\. 2026 v 18:00\./.test(zprava) && /Kde: dílna, Dlouhá 12\./.test(zprava) && /QR kód: https:\/\/example\.com\/vecirek/.test(zprava) && /Tón: Slavnostní\./.test(zprava), `zpráva složená aplikací: druh + akce + kdy + kde + odkaz + tón (${zprava.slice(0, 160)})`);
  const nastrojeOdeslani = ((volani[predOdeslanim] || {}).tools || []).map((x) => x.function.name);
  expect(nastrojeOdeslani.includes('draft_card') && nastrojeOdeslani.includes('draft_presentation'), 'slovo „pozvánku“ ve složené zprávě otevřelo skupinu kancelar');

  console.log('== tlačítko Nový v seznamu (v každé podsekci) + čipy druhů v prázdném filtru ==');
  if (!(await page.$('[data-testid="chat-dokumenty"]'))) await page.click('[data-testid="chat-dokumenty-btn"]');
  if (await page.$('[data-testid="chat-dok-zpet"]')) await page.click('[data-testid="chat-dok-zpet"]');
  expect(await cekej('[data-testid="chat-dok-novy"]'), 'tlačítko Nový v hlavičce seznamu');
  await page.click('[data-testid="chat-dok-filtr"][data-skupina="emaily"]');
  expect(await cekej('[data-testid="chat-dok-prazdno-sablony"]', 5000), 'prázdný filtr E-maily nabízí čip druhu');
  const cipy = await page.$$eval('[data-testid="chat-dok-sablona-cip"]', (els) => els.map((e) => e.getAttribute('data-druh')));
  expect(cipy.join(',') === 'email', `čipy podle filtru: E-maily → jen e-mail (${cipy.join(',')})`);
  await page.click('[data-testid="chat-dok-novy"]');
  expect(await cekej('[data-testid="chat-dok-novy-form"][data-druh="email"]', 5000), 'Nový ve filtru E-maily předvolí e-mail');
  await page.click('[data-testid="chat-dok-novy-zpet"]');
  await page.click('[data-testid="chat-dok-filtr"][data-skupina="faktury"]');
  expect(await cekej('[data-testid="chat-dok-novy"]'), 'Nový je i v podsekci Faktury');
  await page.click('[data-testid="chat-dok-novy"]');
  expect(await cekej('[data-testid="chat-dok-novy-form"][data-druh="faktura"]', 5000), 'Nový ve Fakturách předvolí fakturu');
  await page.click('[data-testid="chat-dok-novy-zpet"]');
  const zalozky = await page.$$eval('[data-testid="chat-dok-zalozka"]', (els) => els.map((e) => e.getAttribute('data-zalozka')));
  expect(zalozky.includes('dokumenty') && zalozky.includes('pdf'), `panel Kancelář má záložky Dokumenty a PDF (${zalozky.join(',')})`);
  await page.click('[data-testid="chat-dok-zalozka"][data-zalozka="pdf"]');
  expect(await cekej('[data-testid="chat-dokumenty"] [data-testid="chat-pdf"]', 5000), 'záložka PDF je uvnitř Kanceláře');
  expect(!(await page.$('[data-testid="chat-pdf-btn"]')), 'samostatná ikonka PDF v hlavičce chatu zmizela');
  expect(chyby.length === 0, `konzole bez chyb (${chyby.slice(0, 3).join(' | ')})`);
}, { nazev: 'UI-AI-KANCELAR' });
