// Dokumenty asistenta (30. 9. 2026) — klikací sada (Puppeteer) proti PODVRŽENÉ ollamě.
// Richard: „vedle ai asistenta bude možnost otevřít vlevo poznámky, emaily a sumáře …
// jak když v claude vidím plán vedle chatu; otevřené = vedle chatu přes mapu“.
// Měří: panel VLEVO od chatu a PŘES stránku (odsazení stránky = jen šířka chatu),
// samootevření po tahu s konceptem, „Otevřít vedle“, e-mail (Komu/Předmět, mailto),
// úprava psaná KLÁVESNICÍ → Uložit → přežije reload, Vrátit, filtr, BEZ ruční „Nové poznámky“,
// hlídání neuložených změn, přepis asistentem, smazání, šířka tažením, Esc, telefon.
const H = require('./_harness');
const { expect, sleep } = H;

const fronta = [];
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const text = (s) => ({ content: s });
const mockHandler = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  const o = fronta.shift() || text('(fronta prázdná)');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 100, eval_count: 20, done: true }));
};

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ui-dokumenty', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0,
  } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  const A = await inst.login('admin@example.com');
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Truhlářství', nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň', title: 'Kuchyň', status: 'todo' } }], edges: [] } })).json;
  expect(!!map.id, 'mapa založena');

  const { page, chyby } = await H.browser();
  await page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); }, A);
  const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const zmizi = async (sel, ms = 5000) => page.waitForSelector(sel, { hidden: true, timeout: ms }).then(() => true).catch(() => false);
  const textDok = () => page.evaluate(() => document.querySelector('[data-testid="chat-dokumenty"]')?.innerText || '');
  const cekejTextDok = async (s, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await textDok()).includes(s)) return true; await sleep(250); } return false; };
  const box = async (sel) => { const el = await page.$(sel); return el ? el.boundingBox() : null; };
  const napis = async (s) => { await page.click('[data-testid="chat-input"]'); await page.keyboard.type(s); await page.keyboard.press('Enter'); };

  console.log('== asistent napíše e-mail → Dokumenty se samy otevřou vlevo od chatu, přes mapu ==');
  await page.goto(`${inst.base}/map/${map.id}`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => { localStorage.setItem('kb-chat-open', '1'); });
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-panel"]'), 'panel asistenta otevřený');
  expect(!(await page.$('[data-testid="chat-dokumenty"]')), 'dokumenty zatím zavřené');
  fronta.push(nastroj('draft_text', { kind: 'email', title: 'Poptávka spárovek', subject: 'Poptávka – spárovky dub', to: 'drevo@example.com', text: 'Dobrý den,\nposílám poptávku.\nDOK-UI-1' }), text('Koncept je v dokumentech.'));
  await napis('Napiš poptávku na spárovky');
  expect(await cekej('[data-testid="chat-dok-detail"][data-kind="email"]', 15000), 'po tahu s konceptem se panel dokumentů sám otevřel na tom e-mailu');
  const bChat = await box('[data-testid="chat-panel"]');
  const bDok = await box('[data-testid="chat-dokumenty"]');
  expect(Math.abs(bDok.x + bDok.width - bChat.x) <= 2 && Math.abs(bDok.y + bDok.height - 900) <= 1, `dokumenty přiléhají k chatu zleva až dolů (dok ${Math.round(bDok.x)}+${Math.round(bDok.width)}, chat ${Math.round(bChat.x)})`);
  // horní lišta editoru (Sdílet, Export, asistent…) zůstává klikací: panel začíná pod ní
  const bLista = await box('[data-app-header]');
  expect(!!bLista && Math.abs(bDok.y - (bLista.y + bLista.height)) <= 1, `dokumenty začínají pod horní lištou (${Math.round(bDok.y)} × lišta dole ${bLista && Math.round(bLista.y + bLista.height)})`);
  const zakryto = await page.evaluate(() => [...document.querySelectorAll('[data-app-header] button')].filter((b) => { const r = b.getBoundingClientRect(); if (!r.width) return false; const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !b.contains(el); }).length);
  expect(zakryto === 0, `žádné tlačítko horní lišty není zakryté (${zakryto})`);
  const odsazeni = await page.evaluate(() => { const el = [...document.querySelectorAll('div[style]')].find((d) => d.style.paddingRight); return el ? parseFloat(el.style.paddingRight) : 0; });
  expect(Math.abs(odsazeni - bChat.width) <= 1, `stránka je odsazená JEN o chat (${odsazeni} px) — dokumenty mapu překrývají, nezužují`);
  expect(await cekejTextDok('Poptávka spárovek') && await cekejTextDok('drevo@example.com') && await cekejTextDok('Poptávka – spárovky dub') && await cekejTextDok('DOK-UI-1'), 'detail: název, Komu, Předmět, text');
  const href = await page.$eval('[data-testid="chat-dok-mailto"]', (a) => a.getAttribute('href'));
  expect(href.startsWith('mailto:drevo@example.com?subject=') && href.includes(encodeURIComponent('Poptávka – spárovky dub')) && href.includes('DOK-UI-1'), `Otevřít v poště = mailto s adresátem, předmětem a tělem (${href.slice(0, 70)})`);
  expect(await cekej('[data-testid="chat-koncept"] [data-testid="chat-koncept-otevrit"]'), 'karta konceptu v chatu má „Otevřít vedle“');
  expect(await page.$eval('[data-testid="chat-koncept-predmet"]', (el) => el.textContent.includes('Poptávka – spárovky dub')), 'karta konceptu ukazuje předmět zvlášť');
  const tlac = await page.$eval('[data-testid="chat-dokumenty-btn"]', (b) => b.getAttribute('aria-pressed'));
  expect(tlac === 'true', 'tlačítko Dokumenty v hlavičce svítí jako zapnuté');

  console.log('== úprava psaná klávesnicí → Uložit → přežije reload; Vrátit ==');
  await page.click('[data-testid="chat-dok-upravit"]');
  expect(await cekej('[data-testid="chat-dok-text"]'), 'Upravit → textové pole');
  await page.click('[data-testid="chat-dok-text"]');
  await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control');
  await page.keyboard.type('\nDOPSANO-KLAVESNICI');
  await page.click('[data-testid="chat-dok-ulozit"]');
  expect(await cekej('[data-testid="chat-dok-hlaska"]') && await cekejTextDok('Uloženo.'), 'uloženo');
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-dokumenty"]'), 'po reloadu jsou dokumenty pořád otevřené');
  expect(await cekej('[data-testid="chat-dok-polozka"]'), 'po reloadu seznam dokumentů');
  await page.click('[data-testid="chat-dok-polozka"]');
  expect(await cekejTextDok('DOPSANO-KLAVESNICI'), 'ruční úprava přežila reload');
  await page.click('[data-testid="chat-dok-vratit"]');
  expect(await cekejTextDok('Vrácena předchozí verze') && !(await textDok()).includes('DOPSANO-KLAVESNICI'), 'Vrátit předchozí verzi → text asistenta');

  console.log('== neuložené změny se neztratí mlčky ==');
  await page.click('[data-testid="chat-dok-upravit"]');
  await page.click('[data-testid="chat-dok-text"]');
  await page.keyboard.type('ROZEPSANO');
  await page.click('[data-testid="chat-dok-zpet"]');
  expect(await cekej('[data-testid="chat-dok-neulozeno"]'), 'odchod s neuloženými změnami → dotaz');
  expect(!!(await page.$('[data-testid="chat-dok-detail"]')), 'detail zůstal otevřený');
  await page.click('[data-testid="chat-dok-zahodit"]');
  expect(await cekej('[data-testid="chat-dok-seznam"]'), '„Zahodit změny“ → seznam');

  console.log('== asistent dokument přepíše → panel ukáže novou verzi ==');
  fronta.push(nastroj('update_document', { document: 'Poptávka spárovek', text: 'Vážený pane,\nFORMALNI-VERZE' }), text('Upraveno.'));
  await napis('Udělej tu poptávku formálnější');
  expect(await cekej('[data-testid="chat-dokument-karta"]', 15000), 'v chatu karta „Upravil jsem dokument …“');
  expect(await cekejTextDok('FORMALNI-VERZE'), 'panel se sám přepnul na přepsaný dokument');
  expect(!!(await page.$('[data-testid="chat-dok-vratit"]')), 'u přepsaného jde Vrátit');

  console.log('== rozepsaná úprava se neztratí (checkup 1. 10.) ==');
  const idA = await page.$eval('[data-testid="chat-dok-detail"]', (el) => el.dataset.id);
  await page.click('[data-testid="chat-dok-upravit"]');
  await page.click('[data-testid="chat-dok-text"]');
  await page.keyboard.type(' ROZEPSANO-A');
  // asistent mezitím napíše JINÝ dokument → panel na něj nepřeskočí a úpravu nezahodí
  fronta.push(nastroj('draft_text', { kind: 'note', title: 'Jiná poznámka B', text: 'DOK-B' }), text('Hotovo B.'));
  await napis('Napiš mi poznámku B');
  expect(await cekej('[data-testid="chat-koncept"][data-kind="note"]', 15000), 'asistent napsal dokument B');
  await sleep(800);
  expect(await page.$eval('[data-testid="chat-dok-detail"]', (el) => el.dataset.id) === idA && (await page.$eval('[data-testid="chat-dok-text"]', (el) => el.value)).includes('ROZEPSANO-A'), 'samootevření nepřepnulo z rozepsaného dokumentu, text zůstal');
  expect(!(await page.$('[data-testid="chat-dok-cizi"]')), 'u dokumentu A se neukáže „asistent ho mezitím upravil“ (měnil B)');
  // „Otevřít vedle“ u karty B, přepínač v hlavičce i minimalizace chatu se nejdřív zeptají
  await page.click('[data-testid="chat-koncept"][data-kind="note"] [data-testid="chat-koncept-otevrit"]');
  expect(await cekej('[data-testid="chat-dok-neulozeno"]'), '„Otevřít vedle“ při neuložené úpravě → dotaz');
  await page.click('[data-testid="chat-dok-neulozeno"] button');
  expect((await page.$eval('[data-testid="chat-dok-text"]', (el) => el.value)).includes('ROZEPSANO-A'), '„Pokračovat v úpravách“ nechá text');
  await page.click('[data-testid="chat-dokumenty-btn"]');
  expect(await cekej('[data-testid="chat-dok-neulozeno"]') && !!(await page.$('[data-testid="chat-dokumenty"]')), 'přepínač Dokumenty při neuložené úpravě → dotaz, panel zůstal');
  await page.click('[data-testid="chat-dok-neulozeno"] button');
  await page.click('[data-testid="chat-zavrit"]');
  expect(await cekej('[data-testid="chat-dok-neulozeno"]') && !!(await page.$('[data-testid="chat-panel"]')), 'minimalizace chatu při neuložené úpravě → dotaz, chat zůstal');
  await page.click('[data-testid="chat-dok-zahodit"]');
  expect(await zmizi('[data-testid="chat-panel"]'), '„Zahodit změny“ provede odložené zavření');
  await page.reload({ waitUntil: 'networkidle2' });
  await page.click('[data-testid="chat-tab"]');
  await cekej('[data-testid="chat-panel"]');
  if (!(await page.$('[data-testid="chat-dokumenty"]'))) await page.click('[data-testid="chat-dokumenty-btn"]');
  await cekej('[data-testid="chat-dokumenty"]');
  if (await page.$('[data-testid="chat-dok-zpet"]')) await page.click('[data-testid="chat-dok-zpet"]');
  await cekej('[data-testid="chat-dok-seznam"]');
  // smazat B ať dál sedí počty
  await page.click('[data-testid="chat-dok-polozka"][data-kind="note"]');
  await cekej('[data-testid="chat-dok-smazat"]'); await page.click('[data-testid="chat-dok-smazat"]');
  await cekej('[data-testid="chat-dok-smazat-ano"]'); await page.click('[data-testid="chat-dok-smazat-ano"]');
  await cekej('[data-testid="chat-dok-seznam"]');

  console.log('== potvrzení karty neotevře znovu starý koncept (checkup 1. 10.) ==');
  fronta.push({ tool_calls: [{ function: { name: 'draft_text', arguments: { kind: 'email', title: 'E-mail ke kuchyni', text: 'KUCHYNE-EMAIL' } } }, { function: { name: 'create_project', arguments: { title: 'Kuchyně Novák', outline: [{ title: 'Zaměřit' }] } } }] });
  await napis('Založ projekt Kuchyně Novák a napiš k tomu e-mail');
  expect(await cekej('[data-testid="chat-akce"][data-stav="ceka"]', 15000), 'tah s konceptem a kartou k potvrzení');
  await cekej('[data-testid="chat-dok-detail"]');
  await page.click('[data-testid="chat-dok-zavrit"]');
  expect(await zmizi('[data-testid="chat-dokumenty"]'), 'dokumenty zavřené');
  fronta.push(text('Projekt založen.'));
  await page.click('[data-testid="chat-akce-ano"]');
  expect(await cekej('[data-testid="chat-akce"][data-stav="hotovo"]', 15000), 'karta potvrzena');
  await sleep(800);
  expect(!(await page.$('[data-testid="chat-dokumenty"]')), 'po potvrzení karty se Dokumenty znovu neotevřely');
  await page.click('[data-testid="chat-dokumenty-btn"]');
  await cekej('[data-testid="chat-dokumenty"]');
  if (await page.$('[data-testid="chat-dok-zpet"]')) await page.click('[data-testid="chat-dok-zpet"]');
  await cekej('[data-testid="chat-dok-polozka"][data-kind="email"]');
  for (const el of await page.$$('[data-testid="chat-dok-polozka"]')) { if ((await el.evaluate((x) => x.innerText)).includes('E-mail ke kuchyni')) { await el.click(); break; } }
  await cekej('[data-testid="chat-dok-smazat"]'); await page.click('[data-testid="chat-dok-smazat"]');
  await cekej('[data-testid="chat-dok-smazat-ano"]'); await page.click('[data-testid="chat-dok-smazat-ano"]');
  await cekej('[data-testid="chat-dok-seznam"]');
  // detail zpět na e-mail ať navazující sekce začíná jako dřív
  expect(await cekej('[data-testid="chat-dok-polozka"][data-kind="email"]') && !(await textDok()).includes('E-mail ke kuchyni'), 'koncept z tohoto kroku smazán, původní e-mail zůstal');
  await page.click('[data-testid="chat-dok-polozka"][data-kind="email"]');
  await cekej('[data-testid="chat-dok-detail"]');

  console.log('== bez ruční „Nové poznámky“, filtr, smazání ==');
  await page.click('[data-testid="chat-dok-zpet"]');
  await cekej('[data-testid="chat-dok-seznam"]');
  expect(!(await page.$('[data-testid="chat-dok-novy"]')) && !(await textDok()).includes('Nová'), 'tlačítko „+ Nová“ v panelu NENÍ — dokumenty zakládá jen asistent (Richard 1. 10. 2026)');
  fronta.push(nastroj('draft_text', { kind: 'note', title: 'Rozměry kuchyně', text: 'Linka 3,2 m', map: 'Truhlářství' }), text('Zapsáno.'));
  await napis('Zapiš si rozměry kuchyně');
  expect(await cekej('[data-testid="chat-dok-detail"][data-kind="note"]', 15000), 'poznámka od asistenta se otevřela vedle');

  console.log('== dokument k projektu → odkaz na mapu (Richard 1. 10. 2026) ==');
  expect(await cekej('[data-testid="chat-dok-projekt"]') && (await page.$eval('[data-testid="chat-dok-projekt"]', (a) => a.textContent)).includes('Truhlářství'), 'detail: „Otevřít projekt „Truhlářství““');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-dok-polozka-projekt"]'), 'v seznamu je u poznámky název projektu');
  await page.click('[data-testid="chat-dok-polozka"][data-kind="note"]');
  await cekej('[data-testid="chat-dok-projekt"]');
  await page.click('[data-testid="chat-dok-projekt"]');
  let doMapy = false;
  for (let i = 0; i < 40 && !doMapy; i++) { doMapy = page.url().endsWith(`/map/${map.id}`); if (!doMapy) await sleep(250); }
  expect(doMapy, `klik otevře mapu projektu (${page.url().slice(-30)})`);
  expect(await cekej('.react-flow') && !!(await page.$('[data-testid="chat-dok-detail"][data-kind="note"]')), 'na počítači zůstane dokument otevřený vedle mapy');
  await page.click('[data-testid="chat-dok-zpet"]');
  expect(await cekej('[data-testid="chat-dok-polozka"][data-kind="note"]'), 'poznámka v seznamu');
  expect((await page.$$('[data-testid="chat-dok-polozka"]')).length === 2, 'v seznamu 2 dokumenty');
  await page.click('[data-testid="chat-dok-filtr"][data-skupina="emaily"]');
  await sleep(600);
  const emaily = await page.$$eval('[data-testid="chat-dok-polozka"]', (el) => el.map((x) => x.dataset.kind));
  expect(emaily.join() === 'email', `filtr E-maily (${emaily.join()})`);
  await page.click('[data-testid="chat-dok-filtr"][data-skupina="sumare"]');
  expect(await cekej('[data-testid="chat-dok-prazdno"]'), 'filtr Sumáře → prázdno');
  await page.click('[data-testid="chat-dok-filtr"][data-skupina="poznamky"]');
  await cekej('[data-testid="chat-dok-polozka"][data-kind="note"]');
  await page.click('[data-testid="chat-dok-polozka"][data-kind="note"]');
  await cekej('[data-testid="chat-dok-smazat"]');
  await page.click('[data-testid="chat-dok-smazat"]');
  expect(await cekej('[data-testid="chat-dok-smazat-potvrzeni"]'), 'smazání se potvrzuje v panelu (žádné okno prohlížeče)');
  await page.click('[data-testid="chat-dok-smazat-ano"]');
  expect(await cekej('[data-testid="chat-dok-prazdno"]'), 'smazáno → Poznámky prázdné');
  expect(!(await page.$('[data-testid="chat-dok-pamet"]')), 've filtru paměť připnutá není');
  await page.click('[data-testid="chat-dok-filtr"][data-skupina="vse"]');

  console.log('== paměť připnutá v Dokumentech (Richard 1. 10. 2026: bez vlastního tlačítka) ==');
  expect(!(await page.$('[data-testid="chat-pamet-btn"]')), 'tlačítko Paměť v hlavičce asistenta není');
  expect(await cekej('[data-testid="chat-dok-pamet"]'), 've „Vše“ je nahoře připnutá paměť');
  await page.click('[data-testid="chat-dok-pamet"]');
  expect(await cekej('[data-testid="chat-pamet-text"]'), 'klik otevře paměť v panelu dokumentů');
  await page.click('[data-testid="chat-dok-zpet"]');
  fronta.push(nastroj('remember', { text: '- Píšu stručné e-maily' }), text('Zapamatováno.'));
  await napis('Pamatuj si, že píšu stručně');
  expect(await cekej('[data-testid="chat-pamet-otevrit"]', 15000), 'karta „Zapamatoval jsem si“ má odkaz „Otevřít paměť“');
  await page.click('[data-testid="chat-pamet-otevrit"]');
  expect(await cekej('[data-testid="chat-pamet-text"]') && (await page.$eval('[data-testid="chat-pamet-text"]', (el) => el.value)).includes('Píšu stručné e-maily'), 'odkaz otevře paměť s novým zápisem');
  await page.click('[data-testid="chat-dok-zpet"]');

  console.log('== šířka tažením, tlačítko, Esc ==');
  const b1 = await box('[data-testid="chat-dokumenty"]');
  const h = await box('[data-testid="chat-dok-resize"]');
  await page.mouse.move(h.x + 2, h.y + 300); await page.mouse.down(); await page.mouse.move(h.x - 120, h.y + 300, { steps: 6 }); await page.mouse.up();
  const b2 = await box('[data-testid="chat-dokumenty"]');
  expect(b2.width - b1.width >= 80 && Math.abs(b2.x + b2.width - bChat.x) <= 2, `tažení za levou hranu rozšíří panel (${Math.round(b1.width)} → ${Math.round(b2.width)}) a zůstane u chatu`);
  await page.click('[data-testid="chat-dokumenty-btn"]');
  expect(await zmizi('[data-testid="chat-dokumenty"]'), 'tlačítko Dokumenty panel zavře');
  await page.click('[data-testid="chat-dokumenty-btn"]');
  expect(await cekej('[data-testid="chat-dokumenty"]'), 'a znovu otevře');
  await page.click('[data-testid="chat-dok-hledat"]'); await page.keyboard.press('Escape');
  expect(!!(await page.$('[data-testid="chat-dokumenty"]')), 'Esc v políčku panel nezavře');
  await page.click('[data-testid="chat-historie"]');
  expect(await cekej('[role="menu"]'), 'menu historie otevřené');
  await page.keyboard.press('Escape');
  expect(await zmizi('[role="menu"]') && !!(await page.$('[data-testid="chat-dokumenty"]')), 'Esc zavře jen menu historie, dokumenty zůstanou (Esc patří horní vrstvě)');
  await page.click('[data-testid="chat-dokumenty"] h2, [data-testid="chat-dok-seznam"]');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Escape');
  expect(await zmizi('[data-testid="chat-dokumenty"]'), 'Esc mimo políčko panel zavře');
  await page.reload({ waitUntil: 'networkidle2' });
  await cekej('[data-testid="chat-panel"]');
  expect(!(await page.$('[data-testid="chat-dokumenty"]')), 'zavřené dokumenty zůstanou po reloadu zavřené');

  console.log('== karta „Otevřít vedle“ ==');
  await page.click('[data-testid="chat-koncept-otevrit"]');
  expect(await cekej('[data-testid="chat-dok-detail"][data-kind="email"]'), '„Otevřít vedle“ otevře dokument z karty');

  console.log('== telefon: přes celou obrazovku nad chatem, samo se neotevírá ==');
  await page.setViewport({ width: 400, height: 800 });
  await page.evaluate(() => { localStorage.setItem('kb-chat-open', '1'); localStorage.setItem('kb-chat-dok-open', '0'); });
  await page.goto(`${inst.base}/map/${map.id}`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-panel"]'), 'telefon: panel asistenta');
  fronta.push(nastroj('draft_text', { kind: 'summary', title: 'Souhrn MOBIL', text: 'SOUHRN-MOBIL', map: 'Truhlářství' }), text('Souhrn je v dokumentech.'));
  await napis('Shrň mi to');
  expect(await cekej('[data-testid="chat-koncept"][data-kind="summary"]', 15000), 'telefon: koncept v chatu');
  await sleep(500);
  expect(!(await page.$('[data-testid="chat-dokumenty"]')), 'telefon: dokumenty se samy neotevřou (překryly by chat)');
  await page.click('[data-testid="chat-dokumenty-btn"]');
  expect(await cekej('[data-testid="chat-dokumenty"]'), 'telefon: tlačítko Dokumenty otevře panel');
  const bm = await box('[data-testid="chat-dokumenty"]');
  expect(bm.width >= 399 && bm.height >= 799, `telefon: dokumenty přes celou obrazovku (${Math.round(bm.width)}×${Math.round(bm.height)})`);
  expect(await cekejTextDok('Souhrn MOBIL'), 'telefon: nový souhrn v seznamu');
  await page.click('[data-testid="chat-dok-zpet-chat"]');
  expect(await zmizi('[data-testid="chat-dokumenty"]') && !!(await page.$('[data-testid="chat-panel"]')), '„Zpět do chatu“ vrátí rozhovor');
  // titulka na telefonu = lite (bez asistenta) → začít z jiné mapy
  const jina = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Jiný projekt', nodes: [], edges: [] } })).json;
  await page.evaluate(() => { localStorage.setItem('kb-chat-open', '1'); localStorage.setItem('kb-chat-dok-open', '1'); });
  await page.goto(`${inst.base}/map/${jina.id}`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-dokumenty"]'), 'telefon: dokumenty otevřené');
  await cekej('[data-testid="chat-dok-polozka"][data-kind="summary"]');
  await page.click('[data-testid="chat-dok-polozka"][data-kind="summary"]');
  await cekej('[data-testid="chat-dok-projekt"]');
  await page.click('[data-testid="chat-dok-projekt"]');
  let mapaM = false;
  for (let i = 0; i < 40 && !mapaM; i++) { mapaM = page.url().endsWith(`/map/${map.id}`); if (!mapaM) await sleep(250); }
  expect(mapaM && await zmizi('[data-testid="chat-dokumenty"]') && !(await page.$('[data-testid="chat-panel"]')), 'telefon: odkaz na projekt otevře mapu a schová dokumenty i chat (mapa je vidět)');

  expect(chyby.length === 0, `konzole bez chyb (${chyby.slice(0, 2).join(' | ').slice(0, 160)})`);
  void mock;
}, { nazev: 'UI-DOKUMENTY' });
