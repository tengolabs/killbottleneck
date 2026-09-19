// PDF v asistentovi (18. 9. 2026) — klikací sada (Puppeteer) proti podvržené ollamě:
// záložka PDF (výběr souborů, sloučit / rozdělit / vyjmout / odebrat = stažené soubory se
// znovu otevřou a mají správný počet stran), „Opravit s asistentem“ → příloha v chatu →
// karta s náhradami → oprava V PROHLÍŽEČI → náhled + stažení opraveného PDF (nový text
// v něm pdf.js přečte) → server dostal výsledek; karta po reloadu si vyžádá soubor znovu.
const H = require('./_harness');
const { expect, sleep } = H;
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
const FONT = path.join(FE, 'public/fonts/pdf/LiberationSans-Regular.ttf');

H.beh(async () => {
  const PDFLib = await balik('pdf-lib/dist/pdf-lib.esm.js');
  const fontkit = (await balik('@pdf-lib/fontkit/dist/fontkit.es.js')).default;
  const pdfjs = await balik('pdfjs-dist/legacy/build/pdf.mjs');
  const vyrob = async (strany) => {
    const doc = await PDFLib.PDFDocument.create();
    doc.registerFontkit(fontkit);
    const f = await doc.embedFont(new Uint8Array(fs.readFileSync(FONT)), { subset: true });
    for (const radky of strany) {
      const p = doc.addPage([595, 842]);
      let y = 760;
      for (const t of radky) { p.drawText(t, { x: 50, y, size: 12, font: f }); y -= 18; }
    }
    return Buffer.from(await doc.save());
  };
  const pocetStran = async (soubor) => (await PDFLib.PDFDocument.load(fs.readFileSync(soubor))).getPageCount();
  const textPdf = async (soubor) => {
    const d = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(soubor)) }).promise;
    let out = '';
    for (let i = 1; i <= d.numPages; i++) { const tc = await (await d.getPage(i)).getTextContent(); out += tc.items.map((x) => x.str).join(' ') + '\n'; }
    await d.destroy();
    return out;
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-ui-pdf-'));
  const nabidka = path.join(tmp, 'nabidka.pdf');
  const priloha = path.join(tmp, 'priloha.pdf');
  fs.writeFileSync(nabidka, await vyrob([['Nabídka č. 2026/118', 'Dodavatel: Truhlářství Novák, Dlouhá 12,', 'Praha 4', 'Cena celkem: 12 500 Kč'], ['Strana dvě nabídky – technický popis dubové desky']]));
  fs.writeFileSync(priloha, await vyrob([['Příloha: obchodní podmínky platné od 1. 1. 2026'], ['Příloha strana 2 – reklamační řád'], ['Příloha strana 3 – kontakty']]));
  const stazene = path.join(tmp, 'stazene');
  fs.mkdirSync(stazene);
  const cekejSoubory = async (n, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const f = fs.readdirSync(stazene).filter((x) => x.endsWith('.pdf'));
      if (f.length >= n) { await sleep(500); return f.sort(); }
      await sleep(300);
    }
    return fs.readdirSync(stazene).filter((x) => x.endsWith('.pdf')).sort();
  };
  const vyprazdni = () => { for (const f of fs.readdirSync(stazene)) fs.unlinkSync(path.join(stazene, f)); };

  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ui-chat-pdf', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0,
  } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  const A = await inst.login('admin@example.com');

  const { page, chyby } = await H.browser();
  await page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); localStorage.setItem('kb-chat-porada-ne', new Date().toLocaleDateString('en-CA')); }, A);
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: stazene, eventsEnabled: true });
  const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const textPanelu = () => page.evaluate(() => document.querySelector('[data-testid="chat-panel"]')?.innerText || '');
  const cekejText = async (s, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await textPanelu()).includes(s)) return true; await sleep(300); } return false; };
  const cekejStav = async (stav, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.$(`[data-testid="chat-akce"][data-stav="${stav}"]`)) return true; await sleep(300); } return false; };

  console.log('== záložka PDF: soubory, počty stran, sloučení ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  await cekej('[data-testid="chat-tab"]');
  await page.click('[data-testid="chat-tab"]');
  expect(await cekej('[data-testid="chat-pdf-btn"]'), 'v hlavičce panelu je tlačítko PDF');
  await page.click('[data-testid="chat-pdf-btn"]');
  expect(await cekej('[data-testid="chat-pdf"]'), 'záložka PDF se otevře');
  expect(await cekejText('soubor nikam neodchází'), 'záložka říká, že soubor zůstává v prohlížeči');
  await (await page.$('[data-testid="chat-pdf-input"]')).uploadFile(nabidka, priloha);
  expect(await cekej('[data-testid="chat-pdf-seznam"]'), 'vybrané soubory jsou v seznamu');
  expect(await cekejText('3 strany'), 'počet stran se načte (příloha 3 strany)');
  const strany = await page.$$eval('[data-testid="chat-pdf-strany"]', (els) => els.map((e) => e.innerText));
  expect(strany.length === 2 && strany[0] === '2 strany' && strany[1] === '3 strany', `počty stran: ${strany.join(' | ')}`);
  // pořadí: přílohu posunout před nabídku, aby sloučený soubor začínal přílohou
  await (await page.$$('[data-testid="chat-pdf-nahoru"]'))[1].click();
  await sleep(200);
  const poradi = await page.$$eval('[data-testid="chat-pdf-soubor"]', (els) => els.map((e) => e.innerText.split('\n')[0]));
  expect(/priloha/.test(poradi[0]) && /nabidka/.test(poradi[1]), `pořadí po posunu: ${poradi.join(' → ')}`);
  vyprazdni();
  await page.click('[data-testid="chat-pdf-sloucit"]');
  expect(await cekejText('Hotovo – sloučeny 2 soubory'), 'hláška o sloučení');
  let soubory = await cekejSoubory(1);
  expect(soubory.length === 1 && /priloha-slouceno\.pdf$/.test(soubory[0]) && await pocetStran(path.join(stazene, soubory[0])) === 5, `sloučený soubor má 5 stran a jméno prvního (${soubory.join(',')})`);
  expect(/Příloha: obchodní podmínky/.test((await textPdf(path.join(stazene, soubory[0]))).split('\n')[0]), 'sloučený soubor začíná přílohou (pořadí ze seznamu)');
  expect(volani.length === 0, 'sloučení nešlo přes model ani server');

  console.log('== rozdělit / vyjmout / odebrat ==');
  await (await page.$$('[data-testid="chat-pdf-odebrat"]'))[0].click(); // pryč s přílohou, první = nabídka (2 strany)
  await sleep(200);
  expect(await cekejText('První soubor: nabidka.pdf (2 strany)'), 'první soubor = nabídka');
  vyprazdni();
  await page.click('[data-testid="chat-pdf-rozdelit"]');
  soubory = await cekejSoubory(2);
  expect(soubory.length === 2 && soubory.every((f) => /nabidka-str-[12]\.pdf$/.test(f)), `rozdělení bez zadání = každá strana zvlášť (${soubory.join(',')})`);
  expect(await pocetStran(path.join(stazene, soubory[0])) === 1 && /Nabídka č\. 2026\/118/.test(await textPdf(path.join(stazene, soubory[0]))), 'první díl = strana 1 s textem nabídky');
  vyprazdni();
  await page.click('[data-testid="chat-pdf-rozsah"]');
  await page.keyboard.type('2');
  await page.click('[data-testid="chat-pdf-vyjmout"]');
  soubory = await cekejSoubory(1);
  expect(soubory.length === 1 && /nabidka-str-2\.pdf$/.test(soubory[0]) && /Strana dvě/.test(await textPdf(path.join(stazene, soubory[0]))), `vyjmutí strany 2 (${soubory.join(',')})`);
  vyprazdni();
  await page.click('[data-testid="chat-pdf-odebrat-strany"]');
  soubory = await cekejSoubory(1);
  expect(soubory.length === 1 && /nabidka-bez-stran\.pdf$/.test(soubory[0]) && await pocetStran(path.join(stazene, soubory[0])) === 1 && /Nabídka č\./.test(await textPdf(path.join(stazene, soubory[0]))), `odebrání strany 2 → zůstala strana 1 (${soubory.join(',')})`);
  await page.click('[data-testid="chat-pdf-rozsah"]', { clickCount: 3 });
  await page.keyboard.type('7-9');
  await page.click('[data-testid="chat-pdf-vyjmout"]');
  expect(await cekej('[data-testid="chat-pdf-chyba"]') && /Špatně zadané strany/.test(await page.$eval('[data-testid="chat-pdf-chyba"]', (e) => e.innerText)), 'rozsah mimo dokument = srozumitelná chyba');

  console.log('== zamčené PDF (zákaz úprav) přes sponku = srozumitelná hláška hned ==');
  const zamcene = path.join(tmp, 'zamcene.pdf');
  fs.writeFileSync(zamcene, Buffer.from('JVBERi0xLjcKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDUxYjgzMDg3YmI+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCi9PdXRsaW5lcyA3IDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvUGFnZQovUmVzb3VyY2VzIDw8Ci9Gb250IDw8Ci9IZWx2ZXRpY2EtNzA5ODQ4MDc4OSA1IDAgUgo+PgovWE9iamVjdCA8PAo+PgovRXh0R1N0YXRlIDw8Cj4+Cj4+Ci9NZWRpYUJveCBbIDAgMCAzMDAgMjAwIF0KL0NvbnRlbnRzIFsgNiAwIFIgXQovUGFyZW50IDIgMCBSCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9UeXBlIC9Gb250Ci9TdWJ0eXBlIC9UeXBlMQovQmFzZUZvbnQgL0hlbHZldGljYQovRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZwo+PgplbmRvYmoKNiAwIG9iago8PAovRmlsdGVyIC9GbGF0ZURlY29kZQovTGVuZ3RoIDE1MQo+PgpzdHJlYW0KMILJJrA8GLf3gqd7LeMIfN58dsp9FUWLO10phNjlkPIh1CEIcg1NTSS+isMBSbSWcrl0viM0wWnKzFwt8NuSFJ7/2IVw7qseurD/yx++fdcLO8QMhABm4TizI3/n3iP58Xl7qncdB9V8FIOpxG3Q3d3+5JOQzeP+u1rE8z+S/fR8CaaBhlNawofLQEvEpq9HMhXQLfSc5QplbmRzdHJlYW0KZW5kb2JqCjcgMCBvYmoKPDwKPj4KZW5kb2JqCjggMCBvYmoKPDwKL1YgMgovUiAzCi9MZW5ndGggMTI4Ci9QIDQyOTQ5NjcyOTIKL0ZpbHRlciAvU3RhbmRhcmQKL08gPDA4OTkwNGY0OTFkMWJhOTA4YjUxYzM2OTJjYjNkYTcxNWUyNjdkOTc2OTg0YmFhZmM3Y2FlNGQyZDM2MjE0NTA+Ci9VIDwxZTJmODAwMDM0OTgyMGEyZDAxY2MyYzlmMGJhMjc5NjI4YmY0ZTVlNGU3NThhNDE2NDAwNGU1NmZmZmEwMTA4Pgo+PgplbmRvYmoKeHJlZgowIDkKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNTkgMDAwMDAgbiAKMDAwMDAwMDExOCAwMDAwMCBuIAowMDAwMDAwMTgzIDAwMDAwIG4gCjAwMDAwMDAzNjUgMDAwMDAgbiAKMDAwMDAwMDQ2MiAwMDAwMCBuIAowMDAwMDAwNjg1IDAwMDAwIG4gCjAwMDAwMDA3MDYgMDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSA5Ci9Sb290IDMgMCBSCi9JbmZvIDEgMCBSCi9JRCBbIDwzNTM5MzA2NDYyMzEzNjMxNjI2NDMyMzUzODY2NjYzOTY1Mzc2MzY2Mzk2NjY0MzMzMzY2NjE2NjY0NjIzNzM3PiA8MzUzOTMwNjQ2MjMxMzYzMTYyNjQzMjM1Mzg2NjY2Mzk2NTM3NjM2NjM5NjY2NDMzMzM2NjYxNjY2NDYyMzczNz4gXQovRW5jcnlwdCA4IDAgUgo+PgpzdGFydHhyZWYKOTIxCiUlRU9GCg==', 'base64'));
  await page.click('[data-testid="chat-pdf-zpet"]');
  await cekej('[data-testid="chat-obrazek-input"]');
  await (await page.$('[data-testid="chat-obrazek-input"]')).uploadFile(zamcene);
  expect(await cekej('[data-testid="chat-obrazek-chyba"]', 15000) && /zamčené heslem nebo má zakázané úpravy/.test(await page.$eval('[data-testid="chat-obrazek-chyba"]', (e) => e.innerText)), 'zamčené PDF: hláška o zákazu úprav při přiložení (ne až na kartě)');
  expect((await page.$('[data-testid="chat-pdf-priloha"]')) === null, 'zamčené PDF se nepřiložilo');
  await page.click('[data-testid="chat-pdf-btn"]');
  await cekej('[data-testid="chat-pdf"]');
  expect(await cekej('[data-testid="chat-pdf-opravit"]', 5000), 'seznam souborů v záložce přežil přepnutí do chatu a zpět');

  console.log('== Opravit s asistentem → příloha → karta → oprava v prohlížeči ==');
  await page.click('[data-testid="chat-pdf-opravit"]');
  expect(await cekej('[data-testid="chat-pdf-priloha"]'), 'přepnulo do chatu s přílohou PDF nad políčkem');
  expect(/nabidka\.pdf/.test(await page.$eval('[data-testid="chat-pdf-priloha"]', (e) => e.innerText)), 'příloha ukazuje název souboru');
  fronta.push(nastroj('pdf_replace_text', { file: 'nabidka.pdf', replacements: [{ page: 1, find: '12 500 Kč', replace: '13 200 Kč' }, { page: 1, find: 'Truhlářství Novák', replace: 'Truhlářství Nováková' }, { page: 2, find: 'neexistující věta', replace: 'x' }] }));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Oprav cenu na 13 200 Kč a jméno na Nováková');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-akce"][data-klient="pdf_nahrada"]', 20000), 'karta opravy PDF s náhradami');
  expect(await cekej('[data-testid="chat-zprava-pdf"]'), 'u zprávy uživatele je štítek PDF');
  expect(!(await textPanelu()).includes('[Text z PDF'), 'technická značka se uživateli neukazuje');
  const v = volani[volani.length - 1];
  expect(v.messages.some((m) => m.role === 'user' && /\[Text z PDF: nabidka\.pdf, 2 str\.\]/.test(m.content) && /12 500 Kč/.test(m.content)), 'model dostal text stran z prohlížeče');
  expect(!JSON.stringify(v).includes('JVBERi0'), 'k modelu ani na server nešly bajty PDF');
  const nahrady = await page.$$eval('[data-testid="chat-pdf-nahrady"] li', (els) => els.map((e) => e.innerText));
  expect(nahrady.length === 3 && /12 500 Kč/.test(nahrady[0]) && /13 200 Kč/.test(nahrady[0]), `karta vypisuje náhrady (${nahrady[0]})`);
  vyprazdni();
  fronta.push(text('Opravil jsem cenu a jméno, větu na straně 2 jsem nenašel.'));
  await page.click('[data-testid="chat-akce-ano"]');
  expect(await cekej('[data-testid="chat-pdf-nahled-strany"]', 30000), 'po opravě je náhled opravené strany');
  expect(await cekej('[data-testid="chat-pdf-stahnout"]'), 'tlačítko Stáhnout opravené PDF');
  expect(await cekejStav('hotovo'), 'karta ve stavu hotovo');
  expect(await cekejText('opraveno 2 z 3'), 'karta říká „opraveno 2 z 3“');
  expect(await cekejText('neexistující věta'), 'nenalezená náhrada je na kartě vypsaná');
  expect(await cekejText('Opravil jsem cenu a jméno'), 'model dopověděl podle výsledku');
  expect(await cekejText('původní text v souboru zůstává'), 'karta upozorňuje na přelepku');
  const potvrzeni = volani[volani.length - 1].messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n');
  expect(/Replaced 2 of 3/.test(potvrzeni) && /NOT done p\.2: "neexistující věta"/.test(potvrzeni), 'server dostal z prohlížeče poctivý výsledek');
  await page.click('[data-testid="chat-pdf-stahnout"]');
  soubory = await cekejSoubory(1);
  expect(soubory.length === 1 && /nabidka-opraveno\.pdf$/.test(soubory[0]), `stažený soubor (${soubory.join(',')})`);
  const opraveny = await textPdf(path.join(stazene, soubory[0]));
  expect(/13 200 Kč/.test(opraveny) && /Nováková/.test(opraveny) && /Strana dvě/.test(opraveny), `opravené PDF nese nový text a druhou stranu (${opraveny.replace(/\n/g, ' | ').slice(0, 120)})`);
  expect(/12 500 Kč/.test(opraveny), 'původní text zůstal pod přelepkou (známé omezení, karta ho hlásí)');

  console.log('== navazující oprava BEZ reloadu: druhý soubor obsahuje i první opravu ==');
  fronta.push(nastroj('pdf_replace_text', { file: 'nabidka.pdf', replacements: [{ page: 1, find: 'Praha 4', replace: 'Brno' }, { page: 1, find: 'Nabídka č. 2026/118', replace: 'Nabídka č. 2026/119' }] }));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('A ještě Praha na Brno a číslo nabídky na 119');
  await page.keyboard.press('Enter');
  expect(await cekejStav('ceka'), 'druhá karta čeká');
  // druhou náhradu (číslo nabídky) odškrtnout
  const vybery = await page.$$('[data-testid="chat-pdf-nahrada-vyber"]');
  await vybery[vybery.length - 1].click();
  vyprazdni();
  fronta.push(text('Hotovo, Brno; číslo nabídky jsem podle vás nechal.'));
  await page.click('[data-testid="chat-akce-ano"]');
  expect(await cekej('[data-testid="chat-pdf-vcetne-drivejsich"]', 30000), 'karta říká, že soubor obsahuje i dřívější opravy');
  expect(await cekejText('Hotovo, Brno'), 'model dopověděl');
  const potvrzeni2 = volani[volani.length - 1].messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n');
  expect(/Replaced 1 of 2/.test(potvrzeni2) && /unchecked 1/.test(potvrzeni2) && /confirmed earlier/.test(potvrzeni2), `server ví o odškrtnuté náhradě i dřívějších opravách: ${potvrzeni2.slice(0, 160)}`);
  await (await page.$$('[data-testid="chat-pdf-stahnout"]')).pop().click(); // poslední karta (starší si tlačítko drží)
  soubory = await cekejSoubory(1);
  const druhy = await textPdf(path.join(stazene, soubory[0]));
  expect(/Brno/.test(druhy) && /13 200 Kč/.test(druhy) && /Nováková/.test(druhy) && !/2026\/119/.test(druhy), `druhý stažený soubor má Brno I dřívější cenu a jméno, bez odškrtnuté náhrady (${[/Brno/.test(druhy), /13 200/.test(druhy), /Nováková/.test(druhy), !/119/.test(druhy)]} ${soubory.join(',')} ${druhy.replace(/\n/g, ' | ')})`);

  console.log('== reload: karta bez souboru si ho vyžádá ==');
  fronta.push(nastroj('pdf_replace_text', { file: 'nabidka.pdf', replacements: [{ page: 1, find: 'Cena celkem:', replace: 'Cena celkem s DPH:' }] }));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('A připiš k ceně s DPH');
  await page.keyboard.press('Enter');
  expect(await cekejStav('ceka'), 'třetí karta čeká');
  await page.reload({ waitUntil: 'networkidle2' });
  await cekej('[data-testid="chat-panel"]');
  expect(await cekej('[data-testid="chat-pdf-znovu"]', 15000), 'po reloadu karta žádá soubor znovu (bajty v prohlížeči nejsou)');
  expect(await page.$eval('[data-testid="chat-akce-ano"]', (e) => e.disabled), 'bez souboru nejde opravit');
  await (await page.$('[data-testid="chat-pdf-znovu-input"]')).uploadFile(priloha);
  expect(await cekej('[data-testid="chat-pdf-karta-chyba"]', 10000) && /jiný soubor/.test(await page.$eval('[data-testid="chat-pdf-karta-chyba"]', (e) => e.innerText)), 'jiný soubor (jiný počet stran) karta odmítne');
  await (await page.$('[data-testid="chat-pdf-znovu-input"]')).uploadFile(nabidka);
  await sleep(500);
  expect(await page.$eval('[data-testid="chat-akce-ano"]', (e) => !e.disabled), 'po výběru správného souboru jde opravit');
  vyprazdni();
  fronta.push(text('Hotovo, s DPH.'));
  await page.click('[data-testid="chat-akce-ano"]');
  // starší karty jsou hotovo už z dřívějška → čekat na tlačítko stažení (po reloadu ho má jen čerstvě opravená karta)
  expect(await cekej('[data-testid="chat-pdf-stahnout"]', 30000), 'oprava po reloadu proběhla (náhled + stažení)');
  const t0h = Date.now();
  while (Date.now() - t0h < 20000 && (await page.$$eval('[data-testid="chat-akce"][data-stav="hotovo"]', (els) => els.length)) < 3) await sleep(300);
  expect(await page.$$eval('[data-testid="chat-akce"][data-stav="hotovo"]', (els) => els.length) === 3, 'všechny tři karty hotovo');
  await (await page.$$('[data-testid="chat-pdf-stahnout"]')).pop().click();
  soubory = await cekejSoubory(1);
  const poReloadu = await textPdf(path.join(stazene, soubory[0]));
  // dřívější opravy se berou z rozhovoru na serveru → i po reloadu je soubor kompletní
  expect(/s DPH/.test(poReloadu) && /Brno/.test(poReloadu) && /13 200 Kč/.test(poReloadu) && /Nováková/.test(poReloadu), `po reloadu má stažené PDF novou i všechny dřívější opravy (${poReloadu.replace(/\n/g, ' | ').slice(0, 160)})`);
  expect(/3 opravy potvrzené dříve/.test(await page.$eval('[data-testid="chat-pdf-vcetne-drivejsich"]', (e) => e.innerText).catch(() => '')), 'karta po reloadu říká „obsahuje i 3 opravy potvrzené dříve“');

  console.log('== zamítnutí + konzole ==');
  fronta.push(nastroj('pdf_replace_text', { file: 'nabidka.pdf', replacements: [{ page: 1, find: 'Brno', replace: 'Ostrava' }] }));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Nebo Ostrava?');
  await page.keyboard.press('Enter');
  expect(await cekejStav('ceka'), 'čtvrtá karta čeká');
  fronta.push(text('Dobře, nechám Brno.'));
  await page.click('[data-testid="chat-akce-ne"]');
  expect(await cekejStav('zamitnuto'), 'Ne → zamítnuto');
  expect(chyby.length === 0, `konzole bez chyb (${chyby.slice(0, 3).join(' | ')})`);
  fs.rmSync(tmp, { recursive: true, force: true });
}, { nazev: 'UI-AI-CHAT-PDF' });
