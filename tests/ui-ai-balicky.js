// AI blok v asistentovi + Nový projekt s AI + Roztřídit s AI — klik v prohlížeči (fáze C plánu AI funkcí,
// 1. 10. 2026). Nahrazuje ui-ai-mapa.js (starý dialog Poradce je pryč); z ní přebírá kontroly, které
// platí pro každou AI mapu: pozice v DB jsou kanonické svislé, otevření na telefonu je nepřepíše
// a odznak úkolů uzlu aplikaci neshodí (task #17).
// Podvržený model vrací odpovědi z FRONTY — sada řídí, co „model“ udělá, a měří, co z toho udělá produkt.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ui-ai-balicky.js
const H = require('./_harness');
const { expect, sleep } = H;
const fs = require('fs');
const os = require('os');
const path = require('path');

const fronta = [];
const volani = [];
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const text = (s) => ({ content: s });
const chatHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end('{"models":[{"name":"m-a"}]}'); return; }
  const b = JSON.parse(body || '{}');
  volani.push(b);
  const o = fronta.shift() || text('Hotovo.');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 10, eval_count: 5, done: true }));
};
const systemZ = () => ((volani.at(-1) || {}).messages || []).find((m) => m.role === 'system')?.content || '';

H.beh(async () => {
  const chat = await H.httpMock(chatHandler);
  const env = { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: chat.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600, KB_PURPOSE_ASK: 0 };
  // hlavní instance má i obecnou AI (povzbuzení v Mém dni → odkaz „Probrat na ranní poradě“, fáze D)
  const inst = await H.startInstance({ slug: 'ui-balicky', addHostGateway: true, env: Object.assign({ KB_AI_PROVIDER: 'ollama', KB_AI_URL: chat.base, KB_AI_MODEL: 'm-a' }, env) });
  await inst.register('a@example.com', { name: 'Anna' });
  const A = await inst.login('a@example.com');
  // instance BEZ AI hned na začátku (ne uprostřed): start kontejneru mění síť a Chrome by v otevřených
  // stránkách hlásil net::ERR_NETWORK_CHANGED
  const bez = await H.startInstance({ slug: 'ui-balicky-bez-ai', env: { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0 } });
  await bez.register('b@example.com', { name: 'Bára' });
  const B = await bez.login('b@example.com');
  await sleep(3000);
  // ať Home nerenderuje uvítací stav bez lišty
  await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Dílna', nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Dílna', title: 'Dílna', status: 'todo' } }], edges: [] } });
  await bez.api('POST', '/api/collections/goalmaps/records', { token: B, body: { title: 'Sklad', nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Sklad', title: 'Sklad', status: 'todo' } }], edges: [] } });

  const { browser, page, chyby, novaStranka } = await H.browser();
  const priprav = async (p, tk) => p.evaluateOnNewDocument((t) => {
    localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} }));
    localStorage.setItem('kb-mode', 'full');
    // povzbuzení v Mém dni se negeneruje (brzda 1×/min na účet → každá další záložka by dostala 429);
    // karta s odkazem na poradu se ukáže i bez něj
    sessionStorage.setItem('kb-summary-autogen', '1');
  }, tk);
  await priprav(page, A);
  const cekej = async (sel, ms = 10000, p = page) => p.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const otevriPanel = async (p = page, base = inst.base) => {
    await p.goto(`${base}/`, { waitUntil: 'networkidle2' });
    if (!(await cekej('[data-testid="chat-panel"]', 3000, p))) { await cekej('[data-testid="chat-tab"], [data-testid="chat-bar-otevrit"]', 10000, p); await p.click('[data-testid="chat-tab"], [data-testid="chat-bar-otevrit"]'); }
    return cekej('[data-testid="chat-panel"]', 10000, p);
  };
  const klikText = async (p, t, sel = 'button') => p.evaluate((tt, s) => { const el = [...document.querySelectorAll(s)].find((e) => (e.innerText || '').trim() === tt && e.offsetParent); if (el) el.click(); return !!el; }, t, sel);
  const nazevPanelu = async () => page.$eval('[data-testid="chat-panel"] .h-12 span.font-semibold', (el) => el.innerText).catch(() => '');

  console.log('== počítač: AI blok pod Nočním plánováním (mřížka, bez sbalení) ==');
  expect(await otevriPanel(), 'panel asistenta je otevřený');
  expect(await cekej('[data-testid="chat-ai-blok"]'), 'v prázdném rozhovoru je AI blok');
  const poloha = await page.evaluate(() => {
    const n = document.querySelector('[data-testid="chat-nocni-nabidka"]'); const b = document.querySelector('[data-testid="chat-ai-blok"]');
    return n && b ? { nocni: n.getBoundingClientRect().bottom, blok: b.getBoundingClientRect().top } : null;
  });
  expect(!!poloha && poloha.blok >= poloha.nocni, `AI blok je POD rámečkem Nočního plánování (${JSON.stringify(poloha)})`);
  const tlacitka = await page.$$eval('[data-testid^="chat-blok-"]', (els) => els.map((e) => e.getAttribute('data-testid')));
  expect(tlacitka.join(',') === 'chat-blok-trideni,chat-blok-novy-projekt,chat-blok-po-schuzce,chat-blok-revize,chat-blok-priprava,chat-blok-tym', `tlačítka pomocníků — správce vidí i Týmovou poradu (${tlacitka.join(',')})`);
  expect(!(await page.$('[data-testid="chat-ai-blok-rozbalit"]')), 'na počítači se blok nesbaluje');
  const blokText = await page.$eval('[data-testid="chat-ai-blok"]', (el) => el.innerText);
  expect(/AI pomocníci/.test(blokText) && /Roztřídit poznámky/.test(blokText) && /Nový projekt s AI/.test(blokText) && /Po schůzce/.test(blokText) && /Týdenní revize/.test(blokText), 'blok: nadpis a názvy pomocníků');

  console.log('== Roztřídit poznámky z bloku → úvod hned od aplikace, model až s poznámkami (Richard 1. 10. 2026) ==');
  const predTrid = volani.length;
  await page.click('[data-testid="chat-blok-trideni"]');
  expect(await cekej('[data-testid="chat-otazky"]', 5000), 'po kliknutí je otázka tu hned');
  const uvodTrid = await page.$eval('[data-testid="chat-panel"]', (el) => el.innerText);
  expect(/Vypište všechny poznámky a nápady/.test(uvodTrid) && /Máte poznámky\?/.test(uvodTrid) && /Napíšu nápady/.test(uvodTrid) && volani.length === predTrid, `úvod třídění složila aplikace bez modelu (volání ${volani.length - predTrid})`);
  expect(/^Třídění poznámek/.test(await nazevPanelu()), `název rozhovoru „Třídění poznámek …“ (${await nazevPanelu()})`);
  expect(!(await page.$('[data-testid="chat-ai-blok"]')), 'v rozběhnutém rozhovoru už blok není');
  expect(await klikText(page, 'Napíšu nápady', '[data-testid="chat-otazka-volba"]'), 'volba „Napíšu nápady“ jde kliknout');
  await page.click('[data-testid="chat-otazky-odeslat"]');
  const cekaniOk = await page.waitForFunction(() => (document.querySelector('[data-testid="chat-panel"]') || {}).innerText.includes('Sem s tím, čekám na text.'), { timeout: 5000 }).then(() => true).catch(() => false);
  expect(cekaniOk && volani.length === predTrid, `po „Napíšu nápady“ aplikace hned odpoví a čeká, bez modelu (volání ${volani.length - predTrid})`);
  expect(await cekej('[data-testid="chat-navrh"]', 3000) && (await page.$$eval('[data-testid="chat-navrh"]', (els) => els.map((e) => e.innerText))).includes('Nic nemám'), 'i při čekání je na co kliknout (čip „Nic nemám“)');
  fronta.push(text('TRIDENI-MOCK.'));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('koupit pilu, web pro dílnu');
  await page.keyboard.press('Enter');
  const tridOk = await page.waitForFunction(() => (document.querySelector('[data-testid="chat-panel"]') || {}).innerText.includes('TRIDENI-MOCK.'), { timeout: 15000 }).then(() => true).catch(() => false);
  expect(tridOk && /REŽIM ROZTŘÍDIT POZNÁMKY/.test(systemZ()) && /koupit pilu/.test(JSON.stringify(volani.at(-1).messages)), 'poznámky jdou modelu v režimu trideni');
  await page.click('[data-testid="chat-novy"]');
  expect(await cekej('[data-testid="chat-ai-blok"]'), 'Nový rozhovor → blok je zpět');

  console.log('== Nový projekt s AI z bloku: hned formulář (cíl + podrobnost), bez čekání na model ==');
  const predForm = volani.length;
  await page.click('[data-testid="chat-blok-novy-projekt"]');
  expect(await cekej('[data-testid="chat-otazky"]', 5000), 'formulář je tu hned');
  const formOtazky = await page.$$eval('[data-testid="chat-otazka"]', (els) => els.map((e) => e.innerText.split('\n').find((r) => r.trim().length > 2) || ''));
  expect(formOtazky.length === 2 && /Jaký je cíl projektu\?/.test(formOtazky.join(' ')) && /Jak podrobný má plán být\?/.test(formOtazky.join(' ')) && volani.length === predForm, `formulář: cíl + podrobnost, model nevolán (${formOtazky.join(' / ')})`);
  await page.click('[data-testid="chat-novy"]');
  expect(await cekej('[data-testid="chat-ai-blok"]'), 'Nový rozhovor → blok je zpět');

  console.log('== .txt do chatu → obsah do políčka ==');
  const txt = path.join(os.tmpdir(), `kb-podklady-${process.pid}.txt`);
  fs.writeFileSync(txt, 'Kavárna u nádraží\r\n- najít prostor\r\n- kávovar\r\n');
  const vstupSouboru = await page.$('[data-testid="chat-obrazek-input"]');
  await vstupSouboru.uploadFile(txt);
  await sleep(600);
  const policko = await page.$eval('[data-testid="chat-input"]', (el) => el.value);
  expect(policko === 'Kavárna u nádraží\n- najít prostor\n- kávovar', `text souboru je v políčku (${JSON.stringify(policko)})`);
  const prijima = await page.$eval('[data-testid="chat-obrazek-input"]', (el) => el.accept);
  expect(/\.txt/.test(prijima) && /\.md/.test(prijima), `výběr souboru bere .txt a .md (${prijima})`);
  await page.$eval('[data-testid="chat-input"]', (el) => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); });

  console.log('== Nový projekt: odkaz v dialogu → asistent, 4 otázky, celý strom, projekt s barvou z dialogu ==');
  await page.click('[data-testid="chat-zavrit"]');
  await sleep(400);
  expect(await klikText(page, 'Nový projekt'), 'lišta: „Nový projekt“');
  expect(await cekej('#project-name'), 'dialog Nový projekt je otevřený');
  await page.type('#project-name', 'Kavárna u nádraží');
  const barva = await page.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((e) => e.style.backgroundColor === 'rgb(59, 130, 246)'); if (b) b.click(); return !!b; });
  expect(barva, 'v dialogu vybrána modrá barva');
  expect(await cekej('[data-testid="create-project-ai"]'), 'dialog má odkaz „Nebo nechte projekt navrhnout s AI…“');
  fronta.push(nastroj('ask_user', { questions: [
    { text: 'Do kdy má kavárna otevřít?', options: ['Do měsíce', 'Do čtvrt roku', 'Bez termínu'] },
    { text: 'Pro koho je?', options: ['Cestující', 'Místní', 'Obojí'] },
    { text: 'Co už máte?', options: ['Nic', 'Prostor', 'Rozpočet'] },
  ] }));
  await page.click('[data-testid="create-project-ai"]');
  expect(await cekej('[data-testid="chat-otazky"]', 15000), 'odkaz otevřel asistenta s otázkami');
  // dialog mizí animací (~200 ms) a podvržený model odpoví rychleji — počkat, jinak by skutečný klik dostal
  // mizející překryv dialogu
  const zavreno = await page.waitForFunction(() => !document.querySelector('#project-name'), { timeout: 3000 }).then(() => true).catch(() => false);
  expect(zavreno, 'dialog Nový projekt se zavřel');
  const otazky = await page.$$eval('[data-testid="chat-otazka"]', (els) => els.map((e) => e.innerText));
  expect(otazky.length === 4 && /Jak podrobný má plán být\?/.test(otazky[3]) && /Detailní – 3 oblasti po 2–3 krocích \(doporučuji\)/.test(otazky[3]), `4 otázky, poslední na podrobnost (${otazky.length})`);
  expect(/^Nový projekt: Kavárna u nádraží/.test(await nazevPanelu()), `název rozhovoru z cíle (${await nazevPanelu()})`);
  const detail = (await inst.api('GET', '/api/kb/chat/seznam', { token: A })).json.chats.find((c) => c.mode === 'novy_projekt');
  const tg = detail ? (await inst.api('GET', `/api/kb/chat/detail/${detail.id}`, { token: A })).json.chat.target : {};
  expect(tg.cil === 'Kavárna u nádraží' && (tg.meta || {}).color === '#3b82f6', `cíl a barva z dialogu došly serveru (${JSON.stringify(tg)})`);
  // vybrat odpovědi: první volba každé otázky, u podrobnosti „Detailní“
  await page.evaluate(() => {
    const qs = [...document.querySelectorAll('[data-testid="chat-otazka"]')];
    qs.forEach((q, i) => { const volby = [...q.querySelectorAll('[data-testid="chat-otazka-volba"]')]; (i === 3 ? volby.find((v) => /Detailní/.test(v.innerText)) : volby[0]).click(); });
  });
  fronta.push(nastroj('create_project', { title: 'Kavárna u nádraží', goal: 'Otevřít kavárnu u nádraží do měsíce', outline: [
    { title: 'Prostor', children: [{ title: 'Najít nájem' }, { title: 'Podepsat smlouvu' }] },
    { title: 'Vybavení', children: [{ title: 'Kávovar' }, { title: 'Nábytek' }] },
    { title: 'Otevření', children: [{ title: 'Nábor obsluhy' }, { title: 'Slavnostní den' }] },
  ] }));
  await page.click('[data-testid="chat-otazky-odeslat"]');
  expect(await cekej('[data-testid="chat-akce-strom"]', 15000), 'karta s celým stromem');
  const uzly = await page.$$eval('[data-testid="chat-akce-strom-uzel"]', (els) => els.map((e) => `${e.getAttribute('data-uroven')}:${e.innerText.trim()}`));
  expect(uzly.length === 9 && uzly[0].startsWith('0:') && /Prostor/.test(uzly[0]) && uzly[1].startsWith('1:'), `strom 3 oblasti × 2 kroky s úrovněmi (${uzly.length})`);
  await page.click('[data-testid="chat-akce-ano"]');
  await cekej('[data-testid="chat-otevrit-projekt"], [data-testid="chat-akce-odkaz"]', 15000);
  await sleep(800);
  const nova = ((await inst.api('GET', '/api/collections/goalmaps/records?filter=' + encodeURIComponent('title="Kavárna u nádraží"'), { token: A })).json.items || [])[0];
  const vrchol = nova ? (nova.nodes || []).find((n) => n.type === 'apexNode' || (n.data || {}).nodeType === 'apex') : null;
  expect(!!nova && nova.color === '#3b82f6' && (nova.nodes || []).length === 10 && vrchol && vrchol.data.apexText === 'Otevřít kavárnu u nádraží do měsíce', `projekt v DB: 10 uzlů, barva z dialogu, cíl na vrcholu (${nova && nova.color} / ${nova && (nova.nodes || []).length})`);

  console.log('== AI mapa: kanonické svislé pozice, telefon je nepřepíše, odznak úkolů nespadne (z ui-ai-mapa) ==');
  const deti = (nova.nodes || []).filter((n) => n !== vrchol);
  expect(deti.length > 0 && deti.every((n) => n.position.y > vrchol.position.y), 'všechny uzly jsou POD vrcholem (svislý layout)');
  const oblasti = deti.filter((n) => (nova.edges || []).some((e) => e.source === vrchol.id && e.target === n.id));
  expect(oblasti.length === 3 && new Set(oblasti.map((n) => Math.round(n.position.x))).size === 3, 'sourozenci vedle sebe, ne přes sebe');
  const mobil = await novaStranka();
  await mobil.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await priprav(mobil, A);
  await mobil.goto(`${inst.base}/map/${nova.id}`, { waitUntil: 'networkidle2' });
  await sleep(3500);
  const poMobilu = (await inst.api('GET', `/api/collections/goalmaps/records/${nova.id}`, { token: A })).json;
  const vrchol2 = (poMobilu.nodes || []).find((n) => n.type === 'apexNode');
  expect((poMobilu.nodes || []).filter((n) => n !== vrchol2).every((n) => n.position.y > vrchol2.position.y), 'po otevření na telefonu jsou pozice v DB pořád svislé');
  const ST = await inst.superuser();
  const ja = ((await inst.api('GET', `/api/collections/users/records?filter=${encodeURIComponent("email='a@example.com'")}`, { token: ST })).json.items || [])[0];
  await inst.api('POST', '/api/collections/tasks/records', { token: ST, body: { title: 'UKOL-NA-UZLU', status: 'todo', map: nova.id, node_id: oblasti[0].id, owner: ja && ja.id, owner_email: 'a@example.com' } });
  await mobil.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await mobil.goto(`${inst.base}/map/${nova.id}`, { waitUntil: 'networkidle2' });
  await sleep(2500);
  chyby.length = 0;
  expect(await klikText(mobil, '0/1', 'button, span'), 'odznak úkolů (0/1) je na uzlu a jde kliknout');
  await sleep(1200);
  expect((await mobil.evaluate(() => document.body.innerText)).includes('UKOL-NA-UZLU'), 'dialog úkolů uzlu ukazuje úkol');
  expect(!chyby.some((c) => /is not a function|TypeError/i.test(c)), 'po kliku žádný TypeError');

  console.log('== Můj den → asistent: „Probrat na ranní poradě“ a u úkolu po termínu „Zasekl ses?“ (fáze D) ==');
  const vcera = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
  await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Sklad', nodes: [
    { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Sklad', title: 'Sklad', status: 'todo' } },
    { id: 's1', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'Inventura regálů', status: 'todo', owner: 'a@example.com', deadline: vcera } },
  ], edges: [{ id: 's-e1', source: 'root', target: 's1' }] } });
  // telefonní stránka je vpředu — stránka v pozadí nekreslí snímky (rAF) a čekání na prvek by viselo
  await page.bringToFront();
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  if (await page.$('[data-testid="chat-panel"]')) { await page.click('[data-testid="chat-zavrit"]'); await sleep(300); }
  expect(await cekej('[data-testid="myday-porada"]'), 'povzbuzení v Mém dni má odkaz „Probrat na ranní poradě“');
  const predMd = volani.length;
  await page.click('[data-testid="myday-porada"]');
  expect(await cekej('[data-testid="chat-panel"]', 5000) && await cekej('[data-testid="chat-otazky"]', 5000) && volani.length === predMd, `odkaz otevřel asistenta s poradou — úvod od aplikace hned (volání ${volani.length - predMd})`);
  expect(/^Ranní porada/.test(await nazevPanelu()), `rozhovor „Ranní porada …“ (${await nazevPanelu()})`);
  await page.click('[data-testid="chat-zavrit"]'); await sleep(300);
  expect(await cekej('[data-testid="myday-zasekl"]'), 'úkol po termínu má „Zasekl ses?“');
  fronta.push(text('Rozebereme inventuru.'));
  await page.click('[data-testid="myday-zasekl"]');
  expect(await cekej('[data-testid="chat-panel"]', 5000) && await cekej('[data-testid="chat-msg"]', 15000), '„Zasekl ses?“ otevřel asistenta');
  // počkat na NOVÝ rozhovor: panel chvíli ukazuje ještě předchozí (ranní poradu, jejíž úvod je teď hotový hned) —
  // čtení názvu bez čekání bylo závod (1. 10. 2026)
  const rozborNacten = await page.waitForFunction(() => /^Rozbor: Inventura regálů \(Sklad\)/.test((document.querySelector('[data-testid="chat-panel"] .h-12 span.font-semibold') || {}).innerText || ''), { timeout: 20000 }).then(() => true).catch(() => false);
  expect(rozborNacten && /Inventura regálů/.test(systemZ()), `rozbor právě toho uzlu (${await nazevPanelu()})`);
  await page.click('[data-testid="chat-zavrit"]'); await sleep(300);

  console.log('== telefon: blok sbalený do řádku, rozbalení si pamatuje účet ==');
  await mobil.bringToFront();
  await mobil.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  await otevriPanel(mobil);
  await mobil.click('[data-testid="chat-novy"]').catch(() => {});
  expect(await cekej('[data-testid="chat-ai-blok-rozbalit"]', 10000, mobil), 'telefon: řádek „AI pomocníci (6)“');
  const radek = await mobil.$eval('[data-testid="chat-ai-blok-rozbalit"]', (el) => el.innerText.trim());
  expect(radek === 'AI pomocníci (6)' && !(await mobil.$('[data-testid="chat-blok-trideni"]')), `sbaleno: jen řádek, tlačítka schovaná (${radek})`);
  await mobil.click('[data-testid="chat-ai-blok-rozbalit"]');
  expect(await cekej('[data-testid="chat-blok-novy-projekt"]', 3000, mobil), 'po klepnutí se blok rozbalí');
  const sirka = await mobil.$eval('[data-testid="chat-ai-blok"]', (el) => ({ w: el.scrollWidth, c: el.clientWidth }));
  expect(sirka.w <= sirka.c + 1, `rozbalený blok nepřetéká do strany (${sirka.w}/${sirka.c})`);
  await mobil.reload({ waitUntil: 'networkidle2' });
  await otevriPanel(mobil);
  expect(await cekej('[data-testid="chat-blok-novy-projekt"]', 5000, mobil), 'po načtení znovu zůstal rozbalený (paměť účtu)');
  await mobil.close();
  await page.bringToFront();

  console.log('== zásobník: „Roztřídit s AI“ až od 2 nápadů → rozhovor ze zásobníku ==');
  await inst.api('POST', '/api/collections/buffer_nodes/records', { token: A, body: { title: 'Web dílny', owner: ja.id } });
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  if (await page.$('[data-testid="chat-panel"]')) { await page.click('[data-testid="chat-zavrit"]'); await sleep(300); }
  await cekej('[data-testid="buffer-toggle"]');
  if (!(await page.$('[data-testid="buffer-panel"]'))) await page.click('[data-testid="buffer-toggle"]');
  expect(await cekej('[data-testid="buffer-panel"]'), 'zásobník je otevřený');
  await sleep(500);
  expect(!(await page.$('[data-testid="buffer-roztridit"]')), '1 nápad → tlačítko „Roztřídit s AI“ není');
  await inst.api('POST', '/api/collections/buffer_nodes/records', { token: A, body: { title: 'Nový kávovar', owner: ja.id } });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('kb-buffer-changed')));
  expect(await cekej('[data-testid="buffer-roztridit"]', 5000), '2 nápady → tlačítko je vidět');
  fronta.push(text('Doporučuji nechat oba nápady v zásobníku.'));
  await page.click('[data-testid="buffer-roztridit"]');
  expect(await cekej('[data-testid="chat-panel"]', 5000) && await cekej('[data-testid="chat-msg"]', 15000), 'otevřel se asistent a odpověděl');
  expect(/REŽIM ROZTŘÍDIT ZÁSOBNÍK/.test(systemZ()), 'server dostal třídění zásobníku');
  expect(/^Třídění zásobníku/.test(await nazevPanelu()), `název rozhovoru „Třídění zásobníku …“ (${await nazevPanelu()})`);

  console.log('== smazání nápadů asistentem: karta vypíše každý nápad, po Ano zmizí i z panelu zásobníku (Richard 1. 10. 2026) ==');
  fronta.push(nastroj('delete_ideas', { all: true }));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Vymaž celý zásobník');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-akce"][data-stav="ceka"]', 15000), 'mazání čeká na kartě');
  const kartaMaz = await page.$eval('[data-testid="chat-akce"][data-stav="ceka"]', (el) => el.innerText);
  expect(/Smazat ze zásobníku 2 nápady — nejde vrátit/.test(kartaMaz) && /Web dílny/.test(kartaMaz) && /Nový kávovar/.test(kartaMaz), `karta jmenuje oba nápady a říká, že to nejde vrátit (${kartaMaz.replace(/\s+/g, ' ').slice(0, 140)})`);
  fronta.push(text('Zásobník je prázdný.'));
  await page.click('[data-testid="chat-akce"][data-stav="ceka"] [data-testid="chat-akce-ano"]');
  expect(await cekej('[data-testid="chat-akce"][data-stav="hotovo"]', 15000), 'po Ano je karta hotová');
  const zbylo = ((await inst.api('GET', '/api/collections/buffer_nodes/records', { token: A })).json.items || []).length;
  expect(zbylo === 0, `nápady jsou smazané i na serveru (${zbylo})`);
  const vPanelu = await page.waitForFunction(() => document.querySelectorAll('[data-testid="buffer-item"]').length === 0, { timeout: 6000 }).then(() => true).catch(() => false);
  expect(vPanelu, 'panel zásobníku se po smazání sám obnovil (žádná položka)');
  // popis nového kroku (měřitelný cíl) je na kartě vidět PŘED potvrzením
  fronta.push(nastroj('add_nodes', { map_id: 'Dílna', parent_id: 'apex', items: [{ title: 'Tištěné dokumenty', description: 'Měřitelný cíl: projít 100 % šanonů do pátku.' }] }));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Přidej krok s měřitelným cílem');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-akce-strom-popis"]', 15000), 'karta nového kroku ukazuje jeho popis');
  expect(/Měřitelný cíl: projít 100 % šanonů do pátku\./.test(await page.$eval('[data-testid="chat-akce-strom-popis"]', (el) => el.innerText)), 'popis je celý čitelný na kartě');

  console.log('== člen (ne správce/vedoucí): Týmovou poradu v AI bloku nevidí (fáze E) ==');
  await inst.register('clen@example.com', { name: 'Člen' });
  const Cl = await inst.login('clen@example.com');
  // jiný člověk = vlastní (anonymní) kontext prohlížeče — sdílené úložiště by mu podstrčilo poslední rozhovor
  // správce (kb-chat-id; při skutečném přepnutí účtu ho maže odhlášení)
  const kontextClena = await browser.createBrowserContext();
  const pc = await kontextClena.newPage();
  await pc.setViewport({ width: 1400, height: 900 });
  pc.on('console', (m) => { if (m.type() === 'error' && !H.cizihoPuvodu(m)) chyby.push(m.text()); });
  pc.on('pageerror', (e) => chyby.push(String(e)));
  await priprav(pc, Cl);
  expect(await otevriPanel(pc), 'člen: panel asistenta');
  expect(await cekej('[data-testid="chat-ai-blok"]', 10000, pc), 'člen: AI blok');
  const tlacClen = await pc.$$eval('[data-testid^="chat-blok-"]', (els) => els.map((e) => e.getAttribute('data-testid')));
  expect(tlacClen.length === 5 && !tlacClen.includes('chat-blok-tym') && tlacClen.includes('chat-blok-priprava'), `člen: 5 pomocníků, bez Týmové porady (${tlacClen.join(',')})`);
  await pc.close();
  await kontextClena.close();
  await page.bringToFront();

  console.log('== instance bez asistenta: odkaz v Novém projektu ani tlačítko v zásobníku nejsou ==');
  const p2 = await novaStranka();
  await priprav(p2, B);
  await p2.goto(`${bez.base}/`, { waitUntil: 'networkidle2' });
  await sleep(1500);
  expect(await klikText(p2, 'Nový projekt'), 'bez AI: „Nový projekt“');
  expect(await cekej('#project-name', 5000, p2), 'bez AI: dialog otevřen');
  await sleep(500);
  expect(!(await p2.$('[data-testid="create-project-ai"]')), 'bez asistenta dialog odkaz na AI nemá');
  await p2.close();

  expect(!chyby.some((c) => !/ERR_NETWORK_CHANGED/.test(c)), `konzole bez chyb (${chyby.filter((c) => !/ERR_NETWORK_CHANGED/.test(c)).slice(0, 2).join(' | ')})`);
}, { nazev: 'UI-AI-BALICKY' });
