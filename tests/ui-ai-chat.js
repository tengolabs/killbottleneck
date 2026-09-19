// AI chat na boku — klikací sada (Puppeteer) proti PODVRŽENÉ ollamě (fronta
// odpovědí jako v ai-chat.js). Měří UI: ouško → panel, stav přežije reload,
// psaní KLÁVESNICÍ, čipy otázek, karta akce Ano → uzel v mapě, karta skinu
// (+ Vrátit), tažení šířky, paměť, kontext mapy z editoru, konzole bez chyb.
const H = require('./_harness');
const { expect, sleep } = H;

const fronta = [];
const volani = [];
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const text = (s) => ({ content: s });
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }, { name: 'm-b' }] })); return; }
  const b = JSON.parse(body);
  volani.push(b);
  const o = fronta.shift() || text('(fronta prázdná)');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 100, eval_count: 20, done: true }));
};
const systemZ = (v) => (v.messages.find((m) => m.role === 'system') || {}).content || '';

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  // vision model pro přepis obrázku — vlastní mock a fronta (16. 9. 2026)
  const frontaVize = [];
  const volaniVize = [];
  let vizeSelhani = 0;
  const vize = await H.httpMock((req, res, body) => {
    res.setHeader('Content-Type', 'application/json');
    volaniVize.push(JSON.parse(body || '{}'));
    if (vizeSelhani > 0) { vizeSelhani--; res.statusCode = 503; res.end('{"error":"karta nestíhá"}'); return; }
    res.end(JSON.stringify({ message: { role: 'assistant', content: frontaVize.shift() || '(žádný text)' }, prompt_eval_count: 452, eval_count: 30, done: true }));
  });
  const inst = await H.startInstance({ slug: 'ui-chat', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0,
    KB_VISION_PROVIDER: 'ollama', KB_VISION_URL: vize.base, KB_VISION_MODEL: 'vize-a', KB_VISION_POKUSY: 0,
  } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  const A = await inst.login('admin@example.com');
  const me = (await inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@example.com', password: H.PW } })).json.record;
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Truhlářství', nodes: [
      { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň Dvořákovi', title: 'Kuchyň Dvořákovi', status: 'todo' } },
      { id: 'n1', type: 'goalNode', position: { x: 0, y: 700 }, data: { title: 'Poslat poptávku', status: 'todo', owner: 'admin@example.com' } },
    ], edges: [{ id: 'e1', source: 'root', target: 'n1' }] } })).json;
  const napad = (await inst.api('POST', '/api/collections/buffer_nodes/records', { token: A, body: { title: 'Koupit novou pilu', owner: me.id } })).json;
  expect(!!map.id && !!napad.id, 'mapa a nápad založeny');

  const { page, chyby } = await H.browser();
  await page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); }, A);
  const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const textPanelu = () => page.evaluate(() => document.querySelector('[data-testid="chat-panel"]')?.innerText || '');
  const cekejText = async (s, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await textPanelu()).includes(s)) return true; await sleep(300); } return false; };

  console.log('== ouško → panel, stav přežije reload ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-tab"]'), 'zavřený panel = ouško na pravém okraji');
  await (await page.$('[data-testid="chat-tab"]')).click();
  expect(await cekej('[data-testid="chat-panel"]'), 'kliknutí na ouško otevře panel');
  expect(await cekejText('S čím pomoct?'), 'prázdný panel nabízí úvod a čipy');
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-panel"]'), 'po reloadu zůstal panel otevřený');
  const box0 = await (await page.$('[data-testid="chat-panel"]')).boundingBox();
  expect(box0.width >= 320 && box0.x + box0.width >= 1390, `panel je vpravo, šířka ${Math.round(box0.width)} px`);

  console.log('== nabídka ranní porady při prvním otevření, „Dnes ne" drží ==');
  expect(await cekej('[data-testid="chat-porada-nabidka"]'), 'první otevření dne → nabídka ranní porady');
  await page.click('[data-testid="chat-porada-ne"]');
  await sleep(300);
  expect((await page.$('[data-testid="chat-porada-nabidka"]')) === null, 'Dnes ne → nabídka zmizela');
  await page.reload({ waitUntil: 'networkidle2' });
  await cekej('[data-testid="chat-panel"]');
  expect((await page.$('[data-testid="chat-porada-nabidka"]')) === null, 'odmítnutí přežije reload');
  expect(await cekej('[data-testid="chat-chip-porada"]') && !!(await page.$('[data-testid="chat-chip-rozbor"]')), 'čipy Ranní porada a Rozebrat projekt v prázdném stavu');

  console.log('== psaní klávesnicí → odpověď ==');
  fronta.push(text('ODPOVED-MOCK: dobrý den.'));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Ahoj, co umíš?');
  await page.keyboard.press('Enter');
  expect(await cekejText('ODPOVED-MOCK'), 'odpověď modelu se ukázala v panelu');
  expect((await textPanelu()).includes('Ahoj, co umíš?'), 'zpráva uživatele zůstala v rozhovoru');
  expect(await page.evaluate(() => document.querySelectorAll('[data-testid="chat-msg"][data-role="user"]').length) === 1, 'jedna bublina uživatele (žádná duplicita po odpovědi)');
  expect(await page.evaluate(() => document.querySelector('[data-testid="chat-panel"]').innerText.includes('Ahoj, co umíš?')) && (await page.$('[data-testid="chat-chip"]')) === null, 'čipy zmizely po první zprávě');
  expect(/Truhlářství/.test(systemZ(volani[0])) && /^\[Uživatel je právě na přehledu projektů\]/.test(volani[0].messages.filter((m) => m.role === 'user').pop().content), 'server dostal kontext: seznam map + „na přehledu projektů"');

  console.log('== čipy „co dál" → klik pošle zprávu ==');
  fronta.push(nastroj('suggest_next', { suggestions: ['Ukaž mi zásobník', 'Napiš poptávku'] }), text('Sekce jedna:\n- bod\n\nNAVRHY-MOCK.'));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Co dál?');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-navrh"]'), 'čipy návrhů se ukázaly');
  expect(await page.evaluate(() => !!document.querySelector('[data-testid="chat-msg"][data-role="assistant"] .font-semibold')), 'název sekce je polotučně');
  fronta.push(text('PO-NAVRHU.'));
  await (await page.$('[data-testid="chat-navrh"]')).click();
  expect(await cekejText('PO-NAVRHU'), 'klik na čip poslal zprávu a přišla odpověď');
  expect(volani[volani.length - 1].messages.some((m) => m.role === 'user' && /\nUkaž mi zásobník$/.test(m.content)), 'text čipu šel modelu jako zpráva uživatele (za závorkou kontextu)');
  expect((await page.$$('[data-testid="chat-navrh"]')).length === 0, 'starší čipy už nejsou klikací');

  console.log('== koncept e-mailu: pole s kopírováním ==');
  fronta.push(nastroj('draft_text', { kind: 'email', title: 'Poptávka', text: 'Předmět: Poptávka\n\nDobrý den, KONCEPT-MOCK.' }), text('Tady je koncept.'));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Napiš poptávku');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-koncept"][data-kind="email"]'), 'karta konceptu e-mailu');
  expect(await page.$eval('[data-testid="chat-koncept-text"]', (el) => el.textContent.includes('KONCEPT-MOCK')), 'text konceptu v poli');
  await page.click('[data-testid="chat-koncept-kopirovat"]');
  expect(await cekejText('Zkopírováno', 3000), 'tlačítko potvrdí zkopírování');
  await page.click('[data-testid="chat-koncept-do-projektu"]');
  expect(await cekej('[data-testid="chat-koncept-mapa"]'), 'výběr projektu pro uložení');
  await page.click('[data-testid="chat-koncept-ulozit"]');
  expect(await cekejText('Uloženo v poznámkách projektu Truhlářství', 5000), 'koncept uložen do poznámek projektu');
  const pamPo = (await inst.api('GET', '/api/kb/chat/pamet', { token: A })).json;
  expect((pamPo.projekty || []).some((p) => p.title === 'Truhlářství' && /KONCEPT-MOCK/.test(p.text)), 'poznámky projektu obsahují text konceptu');
  await page.click('[data-testid="chat-pamet-btn"]');
  expect(await cekej('[data-testid="chat-pamet-projekt"]'), 'pohled paměti ukazuje poznámky k projektu');
  expect(await page.$eval('[data-testid="chat-pamet-projekt-text"]', (el) => el.value.includes('KONCEPT-MOCK')), 'text konceptu je v poznámkách vidět a jde upravit');
  await page.click('[data-testid="chat-pamet-btn"]');
  await cekej('[data-testid="chat-input"]');

  console.log('== otázky s volbami ==');
  fronta.push(nastroj('ask_user', { questions: [{ text: 'Kam s pilou?', options: ['Truhlářství', 'Nový projekt'] }] }));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Zařaď mi pilu');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-otazky"]'), 'karta otázek se ukázala');
  const volby = await page.$$('[data-testid="chat-otazka-volba"]');
  expect(volby.length === 2, 'dvě volby');
  await volby[0].click();
  fronta.push(text('PO-OTAZKACH: dám to do Truhlářství.'));
  await page.click('[data-testid="chat-otazky-odeslat"]');
  expect(await cekejText('PO-OTAZKACH'), 'po odeslání odpovědí model dopověděl');
  const vAsk = volani[volani.length - 1];
  expect(vAsk.messages.some((m) => m.role === 'tool' && /Odpovědi uživatele: 1\) Truhlářství/.test(m.content)), 'odpověď z čipu šla modelu jako výsledek ask_user');
  expect((await page.$$('[data-testid="chat-otazka-volba"]')).length === 0, 'starší otázky už nejsou aktivní (bez čipů)');

  console.log('== akce → karta → Ano → uzel v mapě ==');
  fronta.push(nastroj('add_idea_to_map', { idea_id: napad.id, map_id: map.id, parent_id: 'apex' }));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Vlož ji tam');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-akce"][data-stav="ceka"]'), 'karta akce čeká na potvrzení');
  expect((await textPanelu()).includes('Koupit novou pilu') && (await textPanelu()).includes('Truhlářství'), 'karta popisuje akci lidsky');
  fronta.push(text('VLOZENO.'));
  await page.click('[data-testid="chat-akce-ano"]');
  expect(await cekej('[data-testid="chat-akce"][data-stav="hotovo"]', 15000), 'po Ano je karta hotovo');
  expect(await cekej('[data-testid="chat-akce-odkaz"]'), 'karta nabízí odkaz do projektu');
  const mapPo = (await inst.api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
  expect(mapPo.nodes.length === 3 && mapPo.nodes.some((n) => n.data.title === 'Koupit novou pilu'), 'uzel je v mapě');

  console.log('== zásobník nápadů se po zásahu asistenta obnoví sám (bez reloadu) ==');
  // 13. 9. 2026 na tengo: asistent řekl „nápad je v zásobníku“, v DB byl, ale panel
  // zásobníku držel seznam z načtení stránky → vypadalo to jako lež modelu.
  await page.click('[data-testid="buffer-toggle"]');
  expect(await cekej('[data-testid="buffer-panel"]'), 'panel zásobníku otevřen');
  const polozky = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="buffer-item"]')].map((e) => e.innerText));
  const cekejPolozku = async (re, ma, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await polozky()).some((x) => re.test(x)) === ma) return true; await sleep(200); } return false; };
  expect(await cekejPolozku(/Koupit novou pilu/, false), 'nápad přesunutý do mapy už v zásobníku není (panel se obnovil sám)');
  fronta.push(nastroj('add_idea', { title: 'Promazat všechny projekty' }), text('NAPAD-MOCK.'));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Ulož do zásobníku. Promazat všechny projekty');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-napad-karta"]'), 'karta „Do zásobníku nápadů: …“');
  expect(await cekejPolozku(/Promazat všechny projekty/, true), 'nový nápad se v panelu zásobníku objevil BEZ reloadu stránky');
  const vDb = (await inst.api('GET', '/api/collections/buffer_nodes/records?filter=' + encodeURIComponent('title="Promazat všechny projekty"'), { token: A })).json;
  expect((vDb.items || []).length === 1, 'a je i v databázi (server uložil)');
  await page.click('[data-testid="buffer-panel"] .h-12 > button');
  expect(await cekej('[data-testid="buffer-toggle"]'), 'panel zásobníku zavřen');

  console.log('== skin: karta + Vrátit ==');
  fronta.push(nastroj('set_skin', { skin_id: 'sepia' }), text('SKIN-MOCK.'));
  await page.click('[data-testid="chat-input"]');
  // „vzhled“ = klíčové slovo skupiny nástrojů (chat.js SKUPINY_KLICE.vzhled); bez něj server
  // set_skin nenabídne, pojistka volání zopakuje a podvržená fronta vydá text místo karty
  await page.keyboard.type('Přepni vzhled na sépii');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-skin"]'), 'karta skinu');
  await sleep(300);
  const cacheSkin = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('kb-skin-cache') || '{}').id || ''; } catch { return ''; } });
  expect(cacheSkin === 'sepia' && !!(await page.$('#kb-skin')), `skin sépie aplikován v prohlížeči (${cacheSkin})`);
  expect((await inst.api('GET', `/api/collections/users/records/${me.id}`, { token: A })).json.skin_id === 'sepia', 'skin uložen na účtu');
  await page.click('[data-testid="chat-skin-vratit"]');
  await sleep(500);
  const cacheZpet = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('kb-skin-cache') || '{}').id || ''; } catch { return ''; } });
  expect(cacheZpet !== 'sepia', `Vrátit přepnul skin zpět (${cacheZpet})`);
  const uPo = (await inst.api('GET', `/api/collections/users/records/${me.id}`, { token: A })).json;
  expect(uPo.skin_id !== 'sepia', `Vrátit uložil původní skin na účet (${uPo.skin_id})`);

  console.log('== tažení šířky ==');
  const rez = await page.$('[data-testid="chat-resize"]');
  const rb = await rez.boundingBox();
  await page.mouse.move(rb.x + 1, rb.y + 200);
  await page.mouse.down();
  await page.mouse.move(rb.x - 120, rb.y + 200, { steps: 6 });
  await page.mouse.up();
  await sleep(300);
  const box1 = await (await page.$('[data-testid="chat-panel"]')).boundingBox();
  expect(Math.round(box1.width) >= Math.round(box0.width) + 100, `panel širší o tažení (${Math.round(box0.width)} → ${Math.round(box1.width)})`);
  await page.reload({ waitUntil: 'networkidle2' });
  await cekej('[data-testid="chat-panel"]');
  const box2 = await (await page.$('[data-testid="chat-panel"]')).boundingBox();
  expect(Math.abs(box2.width - box1.width) < 4, 'šířka přežila reload');
  expect(await cekejText('VLOZENO'), 'po reloadu se rozhovor načetl ze serveru');

  console.log('== paměť ==');
  await page.click('[data-testid="chat-pamet-btn"]');
  expect(await cekej('[data-testid="chat-pamet-text"]'), 'pohled paměti');
  await page.click('[data-testid="chat-pamet-text"]');
  await page.keyboard.type('- Píšu stručně');
  await page.click('[data-testid="chat-pamet-uloz"]');
  await sleep(600);
  const pamet = (await inst.api('GET', '/api/kb/chat/pamet', { token: A })).json;
  expect(/Píšu stručně/.test(pamet.text), 'paměť uložena přes UI');
  await page.click('[data-testid="chat-pamet-btn"]');
  expect(await cekej('[data-testid="chat-input"]'), 'zpět do rozhovoru');

  console.log('== přepínač v hlavičce, editor mapy s kontextem ==');
  await page.click('[data-testid="chat-toggle"]');
  expect(await cekej('[data-testid="chat-tab"]'), 'tlačítko v hlavičce panel zavře (ouško zpět)');
  await page.goto(`${inst.base}/map/${map.id}`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-tab"]'), 'ouško i v editoru mapy');
  await (await page.$('[data-testid="chat-tab"]')).click();
  await cekej('[data-testid="chat-panel"]');
  fronta.push(text('Z-MAPY.'));
  await page.click('[data-testid="chat-novy"]');
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Kde jsem?');
  await page.keyboard.press('Enter');
  expect(await cekejText('Z-MAPY'), 'odpověď v editoru');
  const vMapa = volani[volani.length - 1];
  const uzivMapa = vMapa.messages.filter((m) => m.role === 'user').pop().content;
  expect(/^\[Uživatel je právě v mapě „Truhlářství“\]\nKde jsem\?$/.test(uzivMapa), `server ví, že uživatel je v mapě Truhlářství (závorka u zprávy: ${uzivMapa.slice(0, 80)})`);

  console.log('== vybraný uzel v editoru → asistent ho zná; odznačení ho zapomene ==');
  const boxUzlu = await page.evaluate(() => {
    const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.textContent || '').includes('Poslat poptávku'));
    if (!n) return null; const b = n.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + 24 };
  });
  expect(!!boxUzlu, 'uzel „Poslat poptávku“ je na plátně');
  await page.mouse.click(boxUzlu.x, boxUzlu.y);
  await sleep(300);
  expect(await page.evaluate(() => !!document.querySelector('.react-flow__node.selected')), 'klepnutí uzel vybralo');
  fronta.push(text('KROK-MOCK.'));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Rozepiš tenhle krok');
  await page.keyboard.press('Enter');
  expect(await cekejText('KROK-MOCK'), 'odpověď s vybraným uzlem');
  const uzivUzel = volani[volani.length - 1].messages.filter((m) => m.role === 'user').pop().content;
  expect(/^\[Uživatel je právě v mapě „Truhlářství“, vybraný uzel „Poslat poptávku“\]\nRozepiš tenhle krok$/.test(uzivUzel), `server dostal vybraný uzel podle názvu v závorce u zprávy (${uzivUzel.slice(0, 100)})`);
  expect(systemZ(volani[volani.length - 1]) === systemZ(vMapa), 'systémová zpráva se výběrem uzlu nezměnila (cache prefixu)');
  const boxPlatna = await page.evaluate(() => { const p = document.querySelector('.react-flow__pane'); if (!p) return null; const b = p.getBoundingClientRect(); return { x: b.x + 30, y: b.y + b.height - 40 }; });
  await page.mouse.click(boxPlatna.x, boxPlatna.y);
  await sleep(300);
  expect(await page.evaluate(() => !document.querySelector('.react-flow__node.selected')), 'klepnutí na plátno uzel odznačilo');
  fronta.push(text('BEZ-KROKU.'));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('A teď?');
  await page.keyboard.press('Enter');
  expect(await cekejText('BEZ-KROKU'), 'odpověď bez uzlu');
  expect(!/vybraný uzel/.test(volani[volani.length - 1].messages.filter((m) => m.role === 'user').pop().content), 'po odznačení uzel v závorce není');

  console.log('== „kdy to budu řešit“ přes asistenta → karta s odkazem na uzel, v mapě štítek Plán ==');
  // Richard 14. 9. 2026: plán z Mého dne v mapě nebyl vidět; karta po naplánování „nenabídla ukázat uzel“
  const zitra = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  fronta.push(nastroj('update_node', { map_id: 'Truhlářství', node_id: 'Poslat poptávku', planned_on: zitra }));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Poptávku budu řešit zítra');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-akce"][data-stav="ceka"]'), 'karta plánu čeká na potvrzení');
  const popisPlanu = await page.evaluate(() => document.querySelector('[data-testid="chat-akce"][data-stav="ceka"]')?.innerText || '');
  expect(/Naplánovat „Poslat poptávku“/.test(popisPlanu) && /termín se nemění/.test(popisPlanu), `karta říká, že jde o plán, ne termín (${popisPlanu.slice(0, 80)})`);
  fronta.push(text('NAPLANOVANO.'));
  await page.click('[data-testid="chat-akce"][data-stav="ceka"] [data-testid="chat-akce-ano"]');
  expect(await cekejText('NAPLANOVANO'), 'model dopověděl');
  // toast „mapa sloučena“ po akci asistenta nesmí zakrýt políčko chatu (dřív psaní šlo do toastu)
  const toastVsInput = await page.evaluate(() => { const v = document.querySelector('[data-testid="toast-viewport"]'); const i = document.querySelector('[data-testid="chat-input"]').getBoundingClientRect(); const p = document.querySelector('[data-testid="chat-panel"]').getBoundingClientRect(); const vb = v ? v.getBoundingClientRect() : null; return { right: v ? getComputedStyle(v).right : null, prekryv: vb ? vb.right > i.left + 1 && vb.bottom > i.top : null, panelLeft: Math.round(p.left), viewportRight: vb ? Math.round(vb.right) : null }; });
  expect(toastVsInput.prekryv === false && toastVsInput.viewportRight <= toastVsInput.panelLeft + 1, `výřez toastů je vlevo od otevřeného panelu, nekryje políčko chatu (${JSON.stringify(toastVsInput)})`);
  const posledniKarta = await page.evaluate(() => { const k = [...document.querySelectorAll('[data-testid="chat-akce"]')].pop(); return k ? { stav: k.getAttribute('data-stav'), odkaz: k.querySelector('[data-testid="chat-akce-odkaz"]')?.innerText || '', href: k.querySelector('[data-testid="chat-akce-odkaz"]')?.getAttribute('href') || '' } : null; });
  expect(!!posledniKarta && posledniKarta.stav === 'hotovo' && /Ukázat/.test(posledniKarta.odkaz) && /\?node=n1$/.test(posledniKarta.href), `hotová karta plánu nabízí odkaz na UZEL (${JSON.stringify(posledniKarta)})`);
  const stitek = async () => page.evaluate(() => { const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.textContent || '').includes('Poslat poptávku')); return n?.querySelector('[data-testid="node-planned"]')?.innerText || ''; });
  let planStitek = ''; for (let i = 0; i < 40 && !planStitek; i++) { planStitek = await stitek(); if (!planStitek) await sleep(250); }
  expect(/Plán/.test(planStitek), `uzel v mapě ukazuje štítek Plán s datem (${planStitek})`);
  const mapPlan = (await inst.api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
  expect(mapPlan.nodes.some((n) => n.id === 'n1' && n.data.plannedOn === zitra), 'plán je uložený v uzlu mapy (plannedOn)');
  expect(await page.evaluate(() => !document.querySelector('[data-testid="chat-model"]')), 'přepínač modelu v panelu není (model se řídí v pozadí)');

  console.log('== akce z chatu se v OTEVŘENÉM editoru projeví bez reloadu ==');
  const napad2 = (await inst.api('POST', '/api/collections/buffer_nodes/records', { token: A, body: { title: 'Objednat dýhu', owner: me.id } })).json;
  const uzluPred = await page.evaluate(() => document.querySelectorAll('.react-flow__node').length);
  fronta.push(nastroj('add_idea_to_map', { idea_id: 'Objednat dýhu', map_id: 'Truhlářství', parent_id: 'Poslat poptávku' }));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Vlož dýhu k poptávce');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-akce"][data-stav="ceka"]'), 'karta akce v editoru');
  fronta.push(text('VLOZENO-EDITOR.'));
  await page.click('[data-testid="chat-akce-ano"]');
  expect(await cekej('[data-testid="chat-akce"][data-stav="hotovo"]', 15000), 'akce provedena');
  let uzluPo = uzluPred;
  for (let i = 0; i < 40 && uzluPo <= uzluPred; i++) { await sleep(250); uzluPo = await page.evaluate(() => document.querySelectorAll('.react-flow__node').length); }
  expect(uzluPo === uzluPred + 1, `nový uzel se na plátně objevil sám (${uzluPred} → ${uzluPo}, bez reloadu)`);
  expect(await page.evaluate(() => document.body.innerText.includes('Objednat dýhu')), 'uzel má název nápadu');
  // v rozhovoru už je i hotová karta plánu s odkazem → klikat na POSLEDNÍ odkaz (na nový uzel)
  const odkazy = await page.$$('[data-testid="chat-akce-odkaz"]');
  await odkazy[odkazy.length - 1].click();
  await sleep(1200);
  expect(/\?node=/.test(page.url()), `odkaz z karty vede na ?node= (${page.url().slice(-40)})`);
  expect(await page.evaluate(() => [...document.querySelectorAll('.react-flow__node.selected')].some((n) => n.innerText.includes('Objednat dýhu'))), 'editor najel na nový uzel a označil ho (mapa byla otevřená)');
  expect(!!napad2.id, 'nápad pro editor založen');

  console.log('== čip Ranní porada → nový rozhovor v režimu ==');
  await page.click('[data-testid="chat-novy"]');
  fronta.push(text('PORADA-UI-MOCK.'));
  await page.click('[data-testid="chat-chip-porada"]');
  expect(await cekejText('PORADA-UI-MOCK'), 'porada odpověděla');
  expect(await cekejText('Ranní porada'), 'titulek rozhovoru = Ranní porada');
  const vP = volani[volani.length - 1];
  expect(/RANNÍ PORADA/.test(systemZ(vP)) && vP.messages.some((m) => m.role === 'user' && /ranní poradu/.test(m.content)), 'server dostal režim porada a složil úvodní zprávu');

  console.log('== obrázek: Ctrl+V, sponka, přetažení → přepis → karta se všemi položkami → zásobník ==');
  await page.click('[data-testid="chat-novy"]');
  // skutečný obrázek s textem (canvas v prohlížeči musí jít zmenšit — 1×1 px by nic nedokázal)
  const pngB64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 1600;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 900, 1600); x.fillStyle = '#000'; x.font = '60px sans-serif';
    x.fillText('- koupit pilu', 60, 200); x.fillText('- web pro dílnu', 60, 300);
    return c.toDataURL('image/png').split(',')[1];
  });
  const vlozDo = (sel, druh) => page.evaluate((b64, sel2, druh2) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'poznamky.png', { type: 'image/png' }));
    const el = document.querySelector(sel2);
    if (!el) return false;
    if (druh2 === 'paste') el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    else { el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }
    return true;
  }, pngB64, sel, druh);
  const nahledVPolicku = () => page.evaluate(() => !!document.querySelector('[data-testid="chat-obrazek-nahled"] img'));

  expect(!!(await page.$('[data-testid="chat-obrazek"]')), 'u políčka je tlačítko Vložit obrázek');
  expect(await vlozDo('[data-testid="chat-input"]', 'paste'), 'Ctrl+V (událost vložení) do políčka odeslána');
  expect(await cekej('[data-testid="chat-obrazek-nahled"] img'), 'vložení ze schránky ukáže náhled nad políčkem');
  await page.click('[data-testid="chat-obrazek-zrus"]');
  await sleep(300);
  expect(!(await nahledVPolicku()), 'Odebrat obrázek náhled zruší');

  expect(await vlozDo('[data-testid="chat-form"]', 'drop'), 'přetažení souboru na políčko odesláno');
  expect(await cekej('[data-testid="chat-obrazek-nahled"] img'), 'přetažený obrázek ukáže náhled');
  // přetažení PDF: prohlížeč ho NEotevře (stránka zůstane). Od 18. 9. 2026 se PDF přijímá jako
  // příloha (text stran) — tenhle „soubor“ jsou jen 4 bajty hlavičky, takže se nepřečte a panel to řekne
  const urlPred = page.url();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([37, 80, 68, 70])], 'smlouva.pdf', { type: 'application/pdf' }));
    const el = document.querySelector('[data-testid="chat-form"]');
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    window.__pdfDropZachycen = ev.defaultPrevented;
  });
  await sleep(400);
  expect(await page.evaluate(() => window.__pdfDropZachycen === true) && page.url() === urlPred, 'přetažené PDF aplikace zachytí (prohlížeč ho neotevře)');
  expect(await cekej('[data-testid="chat-obrazek-chyba"]', 15000) && /Tohle není PDF/.test(await page.$eval('[data-testid="chat-obrazek-chyba"]', (el) => el.innerText)), 'u souboru, který není PDF, hláška „Tohle není PDF“ (skutečné PDF testuje ui-ai-chat-pdf.js)');
  await page.click('[data-testid="chat-obrazek-zrus"]');
  await sleep(300);

  const pngSoubor = `/tmp/kb-ui-chat-obrazek-${process.pid}.png`;
  require('fs').writeFileSync(pngSoubor, Buffer.from(pngB64, 'base64'));
  await (await page.$('[data-testid="chat-obrazek-input"]')).uploadFile(pngSoubor);
  expect(await cekej('[data-testid="chat-obrazek-nahled"] img'), 'výběr souboru sponkou ukáže náhled');
  require('fs').unlinkSync(pngSoubor);
  expect(await page.evaluate(() => !document.querySelector('[data-testid="chat-send"]').disabled), 'Odeslat jde i bez textu, jen s obrázkem');

  // přepis selže (karta nestíhá, záloha není) → chyba a obrázek i text zůstanou v políčku
  vizeSelhani = 1;
  const chybPred = chyby.length;
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('z tabule');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-chyba"]'), 'selhání přepisu = chyba v panelu');
  await sleep(500);
  expect(await nahledVPolicku() && await page.$eval('[data-testid="chat-input"]', (el) => el.value) === 'z tabule', 'po selhání se obrázek i text vrátily do políčka');
  // záměrná 502 z tohohle kroku se do „konzole bez chyb“ nepočítá — jiné chyby ano
  const zKroku = chyby.splice(chybPred);
  chyby.push(...zKroku.filter((c) => !/status of 502/.test(c)));

  const predVizeUI = volaniVize.length;
  const predUI = volani.length;
  frontaVize.push('- koupit pilu\n- web pro dílnu');
  fronta.push(nastroj('add_ideas', { items: [{ title: 'koupit pilu' }, { title: 'web pro dílnu' }] }));
  await page.click('[data-testid="chat-send"]');
  expect(await cekej('[data-testid="chat-akce"]', 20000), 'po přepisu karta k potvrzení');
  expect(await cekej('[data-testid="chat-zprava-obrazek"]'), 'u zprávy uživatele je náhled obrázku');
  const prepisUI = await page.$eval('[data-testid="chat-zprava-prepis"]', (el) => el.innerText).catch(() => '');
  expect(/Přečteno z obrázku/.test(prepisUI) && /koupit pilu/.test(prepisUI), `přepis je vidět v bublině (${prepisUI.replace(/\n/g, ' | ').slice(0, 80)})`);
  expect(!(await textPanelu()).includes('[Přepis obrázku]'), 'technická značka přepisu se uživateli neukazuje');
  expect(/z tabule/.test(await page.$eval('[data-testid="chat-msg"][data-role="user"]', (el) => el.innerText)), 'doprovodný text je v bublině');
  expect(!(await nahledVPolicku()) && await page.$eval('[data-testid="chat-input"]', (el) => el.value) === '', 'po odeslání je políčko prázdné');
  const detailUI = await page.$eval('[data-testid="chat-akce-detail"]', (el) => el.innerText).catch(() => '');
  expect(/koupit pilu/.test(detailUI) && /web pro dílnu/.test(detailUI), `karta vypíše všechny položky (${detailUI})`);
  const vImg = volaniVize.slice(predVizeUI).pop();
  const vImgUser = vImg && vImg.messages.filter((m) => m.role === 'user').pop();
  expect(!!vImgUser && Array.isArray(vImgUser.images) && /^\/9j\//.test(vImgUser.images[0]), 'vision model dostal obrázek zmenšený prohlížečem na JPEG');
  expect(volani.slice(predUI).every((v) => v.messages.every((m) => !m.images)), 'chat model obrázek nedostal');
  fronta.push(text('ULOZENO-OBRAZEK-MOCK'));
  await page.click('[data-testid="chat-akce-ano"]');
  expect(await cekejText('ULOZENO-OBRAZEK-MOCK'), 'potvrzení → model dopověděl');
  const zasobnikUI = ((await inst.api('GET', '/api/collections/buffer_nodes/records?perPage=200', { token: A })).json.items || []).map((x) => x.title);
  expect(zasobnikUI.includes('koupit pilu') && zasobnikUI.includes('web pro dílnu'), 'položky z obrázku jsou v zásobníku nápadů');
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-zprava-obrazek"]'), 'náhled obrázku přežije reload (je uložený u zprávy)');

  // založený projekt: pod závěrečnou odpovědí tlačítko Otevřít projekt (Richard 16. 9. 2026)
  fronta.push(nastroj('create_project', { title: 'Projekt z obrázku', goal: 'Zkouška', outline: [{ title: 'koupit pilu' }] }));
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Založ z toho nový projekt');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-akce"][data-stav="ceka"]', 15000), 'karta Založit projekt');
  fronta.push({ content: 'PROJEKT-HOTOV-MOCK', tool_calls: [{ function: { name: 'suggest_next', arguments: { suggestions: ['Rozplánuj kroky'] } } }] });
  await page.click('[data-testid="chat-akce"][data-stav="ceka"] [data-testid="chat-akce-ano"]');
  expect(await cekej('[data-testid="chat-otevrit-projekt"]', 15000), 'pod odpovědí je tlačítko Otevřít projekt');
  expect(/Projekt z obrázku/.test(await page.$eval('[data-testid="chat-otevrit-projekt"]', (el) => el.innerText)), 'tlačítko nese název projektu');
  expect(await page.evaluate(() => (document.querySelector('[data-testid="chat-panel"]').innerText.match(/PROJEKT-HOTOV-MOCK/g) || []).length === 1), 'závěrečná odpověď jen jednou');
  // čipy pod odpovědí, která skončila textem + suggest_next, musí jít kliknout (Richard 16. 9.: „nelze klikat")
  // neaktivní čip je jen text (span), aktivní je tlačítko chat-navrh
  const klikaci = await page.$$eval('[data-testid="chat-navrh"]', (els) => els.map((x) => x.innerText));
  expect(klikaci.includes('Rozplánuj kroky'), `čip „co dál" pod takovou odpovědí je klikací tlačítko (${JSON.stringify(klikaci)})`);
  const predCip = volani.length;
  fronta.push(text('CIP-KLIK-MOCK'));
  const rozplanuj = (await page.$$('[data-testid="chat-navrh"]')).pop();
  if (rozplanuj) await rozplanuj.click();
  expect(await cekejText('CIP-KLIK-MOCK') && volani.length > predCip, 'klik na čip pošle zprávu');
  await page.click('[data-testid="chat-otevrit-projekt"]');
  await sleep(1500);
  expect(/\/map\/[a-z0-9]+/.test(page.url()), `tlačítko otevře mapu projektu (${page.url().slice(-30)})`);
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  // další sekce hledá první odkaz v rozhovoru → začít čistý rozhovor
  if (await cekej('[data-testid="chat-novy"]')) await page.click('[data-testid="chat-novy"]');

  console.log('== telefon: minimalizovaný chat = lišta dole, psaní panel otevře, odkaz z karty panel schová ==');
  await page.setViewport({ width: 400, height: 800 });
  await page.evaluate(() => localStorage.setItem('kb-chat-open', '0'));
  await page.goto(`${inst.base}/map/${map.id}`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-bar"]'), 'na úzkém displeji je dole lišta chatu');
  fronta.push(text('MOBIL-MOCK.'));
  await page.click('[data-testid="chat-bar-rozbalit"]');
  expect(await cekej('[data-testid="chat-panel"]'), 'šipka nahoru v liště otevře panel');
  await sleep(300);
  expect(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid') === 'chat-input'), 'fokus přešel do políčka panelu (klávesnice zůstane)');
  await page.keyboard.type('Ahoj z mobilu');
  await page.keyboard.press('Enter');
  expect(await cekejText('MOBIL-MOCK'), 'odpověď v panelu na mobilu');
  fronta.push(nastroj('add_idea_to_map', { idea_id: 'Koupit novou pilu', map_id: 'Truhlářství', parent_id: 'apex' }));
  await inst.api('POST', '/api/collections/buffer_nodes/records', { token: A, body: { title: 'Koupit novou pilu', owner: me.id } });
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Vlož pilu');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-akce"][data-stav="ceka"]'), 'karta akce na mobilu');
  fronta.push(text('VLOZENO-MOBIL.'));
  await page.click('[data-testid="chat-akce-ano"]');
  expect(await cekej('[data-testid="chat-akce-odkaz"]', 15000), 'odkaz Ukázat v mapě');
  await page.click('[data-testid="chat-akce-odkaz"]');
  expect(await cekej('[data-testid="chat-bar"]'), 'na mobilu odkaz z karty panel schová (lišta dole, mapa vidět)');
  expect(/\?node=/.test(page.url()), 'a adresa vede na uzel');
  await page.click('[data-testid="chat-bar-rozbalit"]');
  expect(await cekej('[data-testid="chat-panel"]'), 'šipka nahoru v liště panel rozbalí');
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('Rozepsan');
  await page.click('[data-testid="chat-zmensit"]');
  expect(await cekej('[data-testid="chat-bar"]'), 'šipka dolů u políčka chat zmenší do lišty');
  await sleep(300);
  expect(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid') === 'chat-bar-input'), 'fokus přešel do políčka lišty (klávesnice zůstane)');
  expect(await page.$eval('[data-testid="chat-bar-input"]', (el) => el.value) === 'Rozepsan', 'rozepsaný text přežil zmenšení');
  await page.keyboard.type('á zpráva z lišty');
  fronta.push(text('Z-LISTY-MOCK odpověď.'));
  await page.keyboard.press('Enter');
  let barText = '';
  for (let i = 0; i < 40; i++) { barText = await page.$eval('[data-testid="chat-bar-text"]', (el) => el.textContent).catch(() => ''); if (barText.includes('Z-LISTY-MOCK')) break; await sleep(250); }
  expect(barText.includes('Z-LISTY-MOCK') && !(await page.$('[data-testid="chat-panel"]')), 'odeslání z lišty: odpověď v liště, panel zůstal zmenšený (mapa vidět)');
  fronta.push(nastroj('ask_user', { questions: [{ text: 'Z lišty?', options: ['Ano', 'Ne'] }] }));
  await page.click('[data-testid="chat-bar-input"]');
  await page.keyboard.type('Zeptej se');
  await page.keyboard.press('Enter');
  expect(await cekej('[data-testid="chat-bar-karta"]'), 'čekající otázky hlásí lišta tečkou');
  await page.click('[data-testid="chat-bar-otevrit"]');
  expect(await cekej('[data-testid="chat-otazky"]'), 'klepnutí na řádek lišty otevře panel s otázkami');

  expect(chyby.length === 0, `konzole bez chyb (${chyby.slice(0, 2).join(' | ').slice(0, 160)})`);
}, { nazev: 'UI-AI-CHAT' });
