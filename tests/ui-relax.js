// Relax (14.–15. 10. 2026) — klikací sada (Puppeteer) proti PODVRŽENÉ ollamě: slovo „relax 5“ spustí pauzu BEZ modelu, holé „relax“ a přepínač v hlavičce bez odpočtu,
// iframe scény se načte (akvárium → úl), rozložení „vedle“ nechá chat klikací (psaní KLÁVESNICÍ), +5 min, zámek PINem
// přežije reload a zakryje aplikaci, špatný PIN odmítne, doběhnutí = hotovo + „Ještě 5 min“, čip v prázdném chatu,
// nástroj start_relax od modelu, nabídka po 50 minutách práce, čip „Relax“ po větším tahu, telefon jen celá obrazovka,
// konzole bez chyb.
const H = require('./_harness');
const { expect, sleep } = H;

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
const jmenaNastroju = (v) => ((v && v.tools) || []).map((t) => t.function && t.function.name);

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ui-relax', addHostGateway: true, env: { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_START_RELAX: 1 } }); // start s akváriem zapnutý i přes KB_PURPOSE_ASK=0 harnessu
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  const A = await inst.login('admin@example.com');
  const me = (await inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@example.com', password: H.PW } })).json.record;
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Truhlářství', nodes: [
      { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň', title: 'Kuchyň', status: 'todo' } },
      { id: 'n1', type: 'goalNode', position: { x: 0, y: 700 }, data: { title: 'Poslat poptávku', status: 'todo' } },
    ], edges: [{ id: 'e1', source: 'root', target: 'n1' }] } })).json;
  expect(!!map.id, 'mapa založena');

  const { page, chyby } = await H.browser();
  // předvolba rozložení „cela“: první kroky měří celou obrazovku (výchozí bez předvolby je od 15. 10. „vedle“)
  await page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); if (!localStorage.getItem('kb-relax-rozlozeni')) localStorage.setItem('kb-relax-rozlozeni', 'cela'); }, A);
  const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const textPanelu = () => page.evaluate(() => document.querySelector('[data-testid="chat-panel"]')?.innerText || '');
  const cekejText = async (s, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await textPanelu()).includes(s)) return true; await sleep(300); } return false; };
  const atr = (sel, a) => page.evaluate((s, x) => document.querySelector(s)?.getAttribute(x), sel, a);
  const odpocet = () => page.evaluate(() => document.querySelector('[data-testid="relax-odpocet"]')?.textContent || '');
  const vrstva = () => page.$('[data-testid="relax-vrstva"]');
  // ukotvená horní lišta (27. 10. 2026): scéna „vedle“ i telefonní „nad“ začínají pod její spodní hranou
  const spodekListy = () => page.evaluate(() => Math.round(document.querySelector('[data-app-header]')?.getBoundingClientRect().bottom ?? -1));
  const listaKlikaci = () => page.evaluate(() => {
    const h = document.querySelector('[data-app-header]'); if (!h) return { zvonek: false, panacek: false };
    const nahore = (b) => { if (!b) return false; const x = b.getBoundingClientRect(); const el = document.elementFromPoint(x.x + x.width / 2, x.y + x.height / 2); return !!el && b.contains(el); };
    return { zvonek: nahore([...h.querySelectorAll('button')].find((b) => b.querySelector('svg.lucide-bell'))), panacek: nahore(h.querySelector('button[data-user-menu]')) };
  });
  const klicRelax = `kb-relax:${me.id}`;
  const klicAktivita = `kb-relax-aktivita:${me.id}`;
  const napis = async (s) => { await page.click('[data-testid="chat-input"]'); await page.keyboard.type(s); await page.keyboard.press('Enter'); };

  console.log('== start aplikace: asistent otevřený + akvárium vedle (Richard 25. 10. 2026), křížek ve scéně, F5 ho nevrátí ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-panel"]', 15000), 'po spuštění je panel asistenta otevřený sám (bez kliku na ouško)');
  expect(await cekej('[data-testid="relax-vrstva"][data-rozlozeni="vedle"][data-scena="akvarium"]', 15000), 'po spuštění běží akvárium vedle chatu (bez odpočtu)');
  expect(await cekej('[data-testid="relax-vrstva"][data-nacteno="1"]', 20000), 'scéna se načetla');
  expect((await odpocet()) === '', `bez odpočtu (${await odpocet()})`);
  {
    // Richard 27. 10. 2026: lišta s panáčkem a zvonečkem je vidět a klikací i při startu s akváriem (ruší 15. 10. „na vodu je pruh aplikace“)
    const sp = await spodekListy(); const bv0 = await (await vrstva()).boundingBox(); const bp0 = await (await page.$('[data-testid="chat-panel"]')).boundingBox(); const kl = await listaKlikaci();
    expect(sp > 0 && Math.abs(bv0.y - sp) <= 1 && Math.abs(bp0.y - sp) <= 1, `akvárium i panel začínají pod horní lištou (lišta do ${sp}, scéna od ${Math.round(bv0.y)}, panel od ${Math.round(bp0.y)})`);
    expect(kl.zvonek && kl.panacek, 'zvonek i panáček v liště jsou při akváriu klikací (nic je nezakrývá)');
  }
  if (await page.$('[data-testid="chat-porada-ne"]')) await page.click('[data-testid="chat-porada-ne"]');
  // křížek přímo ve scéně (vedle „Denní světlo“): scéna pošle rodiči kb-relax-zavrit
  const scenaFr = page.frames().find((f) => /\/relax\/akvarium\.html/.test(f.url()));
  expect(!!scenaFr && (await scenaFr.$eval('#close-embed', (b) => !b.hidden)), 've scéně je tlačítko Zavřít (v embedu odkryté)');
  await scenaFr.click('#close-embed');
  await sleep(500);
  expect((await vrstva()) === null, 'křížek ve scéně relax ukončil');
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-panel"]'), 'po F5 panel');
  await sleep(1500);
  expect((await vrstva()) === null, 'po F5 se akvárium nevrátilo (jednou za kartu prohlížeče)');
  expect(await cekej('[data-testid="chat-chip-relax"]'), 'čip „🐟 Relax“ mezi čipy prázdného chatu');
  expect((await vrstva()) === null, 'bez relaxu žádná vrstva (nulová zátěž)');

  console.log('== „relax 5“ klávesnicí → vrstva přes celou obrazovku, akvárium v iframe, odpočet, model se NEVOLÁ ==');
  const volaniPred = volani.length;
  await napis('relax 5');
  expect(await cekej('[data-testid="relax-vrstva"]'), 'vrstva relaxu se ukázala');
  expect((await atr('[data-testid="relax-vrstva"]', 'data-rozlozeni')) === 'cela' && (await atr('[data-testid="relax-vrstva"]', 'data-scena')) === 'akvarium', 'předvolba celá obrazovka + akvárium');
  const src = await atr('[data-testid="relax-iframe"]', 'src');
  expect(/\/relax\/akvarium\.html\?embed=1&v=\d+$/.test(src), `iframe míří na statickou scénu (${src})`);
  expect(await cekej('[data-testid="relax-vrstva"][data-nacteno="1"]', 20000), 'scéna ohlásila kb-relax-ready (soubor se načetl a spustil)');
  const o1 = await odpocet();
  expect(/^(5:00|4:5\d)$/.test(o1), `odpočet začíná na 5 minutách (${o1})`);
  expect(volani.length === volaniPred, 'slovo „relax“ nešlo modelu (0 tokenů)');
  expect(await page.evaluate(() => document.querySelectorAll('[data-testid="chat-msg"]').length) === 0, 'v rozhovoru nevznikla zpráva');
  expect(!!(await page.$('[data-testid="chat-relax-stav"]')), 'panel ukazuje stav „Relax běží“');
  const box = await (await vrstva()).boundingBox();
  expect(box.x === 0 && box.y === 0 && box.width >= 1390 && box.height >= 890, `vrstva zakrývá celé okno (${Math.round(box.width)}×${Math.round(box.height)})`);
  const frame = page.frames().find((f) => /\/relax\/akvarium\.html/.test(f.url()));
  expect(!!frame, 'iframe scény je v dokumentu');
  const uvnitr = frame ? await frame.evaluate(() => ({ canvas: !!document.querySelector('canvas'), fs: document.getElementById('fullscreen')?.hidden === true, bezi: !!(window.aquarium && !window.aquarium.paused) })) : {};
  expect(uvnitr.canvas && uvnitr.fs && uvnitr.bezi, `scéna kreslí, vlastní tlačítko celé obrazovky skryté (embed), akvárium běží (${JSON.stringify(uvnitr)})`);

  console.log('== klid: po 4 s bez pohybu ztlumí jen tlačítka, odpočet zůstane čitelný ==');
  await page.mouse.move(700, 450);
  await sleep(4600);
  const klid = await page.evaluate(() => { const o = document.querySelector('[data-testid="relax-ovladani"]'); const k = document.querySelector('[data-testid="relax-konec"]'); const c = document.querySelector('[data-testid="relax-odpocet"]'); return { ztl: o?.dataset.ztlumeno, konec: getComputedStyle(k).opacity, odpocet: getComputedStyle(c).opacity, lista: getComputedStyle(document.querySelector('[data-testid="relax-lista"]')).opacity }; });
  expect(klid.ztl === '1' && Number(klid.konec) <= 0.35 && Number(klid.odpocet) >= 0.99 && Number(klid.lista) >= 0.99, `v klidu tlačítka 30 %, odpočet i lišta 100 % (${JSON.stringify(klid)})`);
  await page.mouse.move(720, 460);
  await sleep(400);
  expect((await page.evaluate(() => document.querySelector('[data-testid="relax-ovladani"]')?.dataset.ztlumeno)) === '0', 'pohyb myši tlačítka vrátí');

  console.log('== přepnutí scény na včelí úl ==');
  await page.click('[data-testid="relax-scena-ul"]');
  expect(await cekej('[data-testid="relax-vrstva"][data-scena="ul"]'), 'scéna = úl');
  expect(/\/relax\/vceli-ul\.html/.test(await atr('[data-testid="relax-iframe"]', 'src')), 'iframe míří na úl');
  expect(await cekej('[data-testid="relax-vrstva"][data-nacteno="1"]', 20000), 'úl ohlásil kb-relax-ready');
  expect(await page.evaluate(() => localStorage.getItem('kb-relax-scena')) === 'ul', 'scéna se pamatuje jako předvolba');
  const sloupec = await page.$$eval('[data-testid="relax-sceny"] button', (b) => b.map((x) => ({ w: x.getBoundingClientRect().width, h: x.getBoundingClientRect().height, text: x.textContent })));
  expect(sloupec.length === 3 && sloupec.every((b) => b.w >= 60 && b.h >= 60) && sloupec.map((b) => b.text).join('|') === 'Akvárium|Včelí úl|Mraveniště', `výběr scén = sloupec 3 větších tlačítek s popisky (${JSON.stringify(sloupec.map((b) => b.text))})`);
  const bs = await (await page.$('[data-testid="relax-sceny"]')).boundingBox();
  expect(bs.x + bs.width >= 1380 && bs.y > 200 && bs.y + bs.height < 700, `sloupec scén u pravého okraje uprostřed (x ${Math.round(bs.x)}, y ${Math.round(bs.y)})`);
  await page.click('[data-testid="relax-scena-mraveniste"]');
  expect(await cekej('[data-testid="relax-vrstva"][data-scena="mraveniste"][data-nacteno="1"]', 20000), 'mraveniště (Astra) se načetlo a ohlásilo');
  const frameM = page.frames().find((f) => /\/relax\/mraveniste\.html/.test(f.url()));
  const uvnitrM = frameM ? await frameM.evaluate(() => ({ zen: getComputedStyle(document.getElementById('zen')).display === 'none', bezi: !!(window.antColony && window.antColony.getState && !window.antColony.getState().paused) })) : {};
  expect(uvnitrM.zen && uvnitrM.bezi, `mraveniště: vlastní „Nerušit“ skryté, kolonie běží (${JSON.stringify(uvnitrM)})`);
  await page.click('[data-testid="relax-scena-ul"]');
  expect(await cekej('[data-testid="relax-vrstva"][data-scena="ul"][data-nacteno="1"]', 20000), 'zpět na úl');

  console.log('== rozložení „vedle“: vlevo scéna, vpravo chat — psaní do chatu funguje ==');
  await page.click('[data-testid="relax-rozlozeni"]');
  expect(await cekej('[data-testid="relax-vrstva"][data-rozlozeni="vedle"]'), 'rozložení vedle');
  const bv = await (await vrstva()).boundingBox();
  const bp = await (await page.$('[data-testid="chat-panel"]')).boundingBox();
  const spV = await spodekListy();
  expect(bv.x === 0 && spV > 0 && Math.abs(bv.y - spV) <= 1 && Math.abs(bv.x + bv.width - bp.x) <= 1, `scéna od spodní hrany lišty až k levé hraně chatu (vrstva do ${Math.round(bv.x + bv.width)}, chat od ${Math.round(bp.x)}, y ${Math.round(bv.y)} / lišta ${spV})`);
  fronta.push(text('VEDLE-MOCK: rybičky plavou, pracujeme dál.'));
  await napis('Co mám dnes dělat?');
  expect(await cekejText('VEDLE-MOCK'), 'chat vedle scény odpovídá (zpráva šla modelu)');
  expect(!!(await page.$('[data-testid="chat-relax-odpocet"]')), 'u chatu je vidět odpočet pauzy');

  console.log('== tažení šířky chatu NAD scénou: pouštění myši nad iframe tah ukončí, holý pohyb pak panel nemění ==');
  const sirkaPred = (await (await page.$('[data-testid="chat-panel"]')).boundingBox()).width;
  const uchyt = await (await page.$('[data-testid="chat-resize"]')).boundingBox();
  await page.mouse.move(uchyt.x + 1, uchyt.y + 300);
  await page.mouse.down();
  await page.mouse.move(uchyt.x - 60, uchyt.y + 300, { steps: 6 });   // nad iframe scény
  await page.mouse.up();                                                 // puštěno NAD iframe
  await sleep(200);
  const sirkaPo = (await (await page.$('[data-testid="chat-panel"]')).boundingBox()).width;
  expect(Math.abs(sirkaPo - (sirkaPred + 60)) <= 2, `tah rozšířil chat o 60 px (${Math.round(sirkaPred)} → ${Math.round(sirkaPo)})`);
  await page.mouse.move(uchyt.x - 300, uchyt.y + 300, { steps: 5 });   // jen pohyb bez tlačítka
  await page.mouse.move(uchyt.x + 100, uchyt.y + 300, { steps: 5 });
  await sleep(200);
  const sirkaPoPohybu = (await (await page.$('[data-testid="chat-panel"]')).boundingBox()).width;
  expect(Math.abs(sirkaPoPohybu - sirkaPo) <= 1 && !(await page.evaluate(() => document.body.classList.contains('kb-tah'))), `pohyb myši bez tlačítka šířku nemění (${Math.round(sirkaPoPohybu)}), tah uklizen`);
  const bv2 = await (await vrstva()).boundingBox();
  expect(Math.abs(bv2.x + bv2.width - (1400 - sirkaPoPohybu)) <= 2, 'scéna vedle chatu sleduje novou šířku');

  console.log('== dočasné zvětšení z „vedle“: křížek vrátí vedle chatu, relax neukončí; předvolba zůstane vedle ==');
  await page.click('[data-testid="relax-rozlozeni"]');
  expect(await cekej('[data-testid="relax-vrstva"][data-rozlozeni="cela"]'), 'zvětšeno přes celou obrazovku');
  expect(!!(await page.$('[data-testid="relax-zpet-vedle"]')) && (await page.$('[data-testid="relax-konec"]')) === null, 'místo ✕ je „Zpět vedle chatu“');
  expect(await page.evaluate(() => localStorage.getItem('kb-relax-rozlozeni')) === 'vedle', 'předvolba rozložení zůstala „vedle“');
  await page.click('[data-testid="relax-zpet-vedle"]');
  expect(await cekej('[data-testid="relax-vrstva"][data-rozlozeni="vedle"]') && !!(await page.$('[data-testid="relax-konec"]')), 'zpět vedle chatu, relax běží dál, ✕ je zpět');

  console.log('== +5 minut ==');
  await page.click('[data-testid="relax-prodlouzit"]');
  await sleep(300);
  const o2 = await odpocet();
  expect(/^(9|10):\d\d$/.test(o2), `po +5 zbývá ~10 minut (${o2})`);

  console.log('== zámek PINem: 2× zadat, vynutí celou obrazovku, přežije reload, špatný PIN odmítne ==');
  await page.click('[data-testid="relax-zamknout"]');
  expect(await cekej('[data-testid="relax-pin-nastavit"]'), 'dialog volby PINu');
  await page.type('[data-testid="relax-pin"]', '1234');
  await sleep(300);
  await page.type('[data-testid="relax-pin"]', '1234');
  expect(await cekej('[data-testid="relax-vrstva"][data-zamek="1"]'), 'zamčeno');
  expect((await atr('[data-testid="relax-vrstva"]', 'data-rozlozeni')) === 'cela', 'zámek vynutí celou obrazovku');
  expect((await page.$('[data-testid="relax-konec"]')) === null && !!(await page.$('[data-testid="relax-zamceno"]')), 'zamčená lišta nemá ✕ ani přepínače, jen odpočet a Odemknout');
  const ulozeno = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), klicRelax);
  expect(typeof ulozeno.zamek === 'string' && ulozeno.zamek.length >= 8 && ulozeno.zamek !== '1234', 'v úložišti je otisk PINu, ne PIN');
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="relax-vrstva"][data-zamek="1"]', 15000), 'po reloadu je obrazovka dál zamčená');
  const bz = await (await vrstva()).boundingBox();
  expect(bz.x === 0 && bz.y === 0 && bz.width >= 1390, 'zamčená vrstva zakrývá aplikaci přes celé okno');
  await page.click('[data-testid="relax-odemknout"]');
  expect(await cekej('[data-testid="relax-pin-odemknout"]'), 'pole PIN k odemknutí');
  await page.type('[data-testid="relax-pin"]', '9999');
  await sleep(1400);
  expect(!!(await page.$('[data-testid="relax-pin-chyba"]')) && (await atr('[data-testid="relax-vrstva"]', 'data-zamek')) === '1', 'špatný PIN: hláška, dál zamčeno');
  await page.type('[data-testid="relax-pin"]', '1234');
  expect(await cekej('[data-testid="relax-vrstva"][data-zamek="0"]'), 'správný PIN odemkl');
  expect(!!(await page.$('[data-testid="relax-konec"]')), 'lišta je zpět celá');

  console.log('== doběhnutí: hotovo, scéna ztlumená, „Ještě 5 min“ prodlouží, Pokračuji ukončí ==');
  await page.evaluate((k) => { const r = JSON.parse(localStorage.getItem(k)); r.konecV = Date.now() + 2500; localStorage.setItem(k, JSON.stringify(r)); }, klicRelax);
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="relax-vrstva"]', 15000), 'relax po reloadu pokračuje');
  expect(await cekej('[data-testid="relax-vrstva"][data-hotovo="1"]', 12000), 'odpočet doběhl → hotovo');
  expect(await cekej('[data-testid="relax-hotovo"]') && (await odpocet()) === '0:00', 'nabídka návratu + odpočet 0:00');
  expect((await atr('[data-testid="relax-iframe"]', 'class') || '').includes('opacity-40'), 'scéna je ztlumená');
  expect(await cekej('[data-testid="chat-relax-stav"][data-hotovo="1"]') && !!(await page.$('[data-testid="chat-relax-pokracuji"]')), 'i panel chatu říká, že pauza skončila');
  const popisky = await page.evaluate(() => ['relax-pokracuji', 'relax-jeste', 'relax-dal'].map((id) => document.querySelector(`[data-testid="${id}"]`)?.textContent));
  expect(popisky.join('|') === 'Zpět k práci|Ještě 5 min|Relaxovat dál', `tlačítka po doběhnutí: ${popisky.join(' · ')} (ne „Pokračuji“)`);
  await page.click('[data-testid="relax-dal"]');
  expect(await cekej('[data-testid="relax-vrstva"][data-hotovo="0"]') && !!(await page.$('[data-testid="relax-bez-odpoctu"]')), '„Relaxovat dál“ → scéna běží bez odpočtu');
  await page.evaluate((k) => { const r = JSON.parse(localStorage.getItem(k)); r.konecV = Date.now() + 1500; localStorage.setItem(k, JSON.stringify(r)); }, klicRelax);
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="relax-vrstva"][data-hotovo="1"]', 15000), 'znovu doběhlo');
  await cekej('[data-testid="relax-jeste"]');
  await page.click('[data-testid="relax-jeste"]');
  expect(await cekej('[data-testid="relax-vrstva"][data-hotovo="0"]'), '„Ještě 5 min“ → běží dál');
  const o3 = await odpocet();
  expect(/^(5:00|4:5\d)$/.test(o3), `nový odpočet 5 minut (${o3})`);
  await page.click('[data-testid="relax-konec"]');
  await sleep(300);
  expect((await vrstva()) === null && (await page.$('[data-testid="chat-relax-stav"]')) === null, 'ukončení: vrstva i stav v panelu pryč');
  expect(await page.evaluate((k) => localStorage.getItem(k), klicRelax) === null, 'úložiště pauzy vyčištěno');

  console.log('== bez odpočtu: holé „relax“, čip v prázdném chatu, přepínač v hlavičce; „+5“ odpočet teprve zapne ==');
  if (!(await page.$('[data-testid="chat-input"]'))) await page.click('[data-testid="chat-toggle"]');
  await cekej('[data-testid="chat-input"]');
  await napis('relax');
  expect(await cekej('[data-testid="relax-vrstva"]'), 'holé „relax“ spustí scénu');
  expect(await cekej('[data-testid="relax-bez-odpoctu"]') && (await page.$('[data-testid="relax-odpocet"]')) === null, 'bez odpočtu (5 min je bonus)');
  expect(await cekej('[data-testid="chat-relax-odpocet"][data-odpocet="0"]'), 'panel: „Relax běží“ bez času');
  expect(!!(await page.$('[data-testid="relax-odpocet-5"]')) && !!(await page.$('[data-testid="relax-odpocet-30"]')) && (await page.$('[data-testid="relax-prodlouzit"]')) === null, 'lišta bez odpočtu nabízí šablony 5 · 15 · 30');
  // panel je pod celou obrazovkou → šablony v panelu jsou k ruce v rozložení vedle (předvolba může být už „vedle“)
  if ((await atr('[data-testid="relax-vrstva"]', 'data-rozlozeni')) !== 'vedle') await page.click('[data-testid="relax-rozlozeni"]');
  await cekej('[data-testid="relax-vrstva"][data-rozlozeni="vedle"]');
  expect(!!(await page.$('[data-testid="chat-relax-sablona-5"]')) && !!(await page.$('[data-testid="chat-relax-sablona-30"]')), 'panel bez odpočtu nabízí šablony 5 · 15 · 30');
  await page.click('[data-testid="chat-relax-sablona-15"]');
  expect(await cekej('[data-testid="relax-odpocet"]') && /^(15:00|14:5\d)$/.test(await odpocet()), `šablona „15 min“ v panelu zapne odpočet 15 minut (${await odpocet()})`);
  expect(await cekej('[data-testid="relax-prodlouzit"]') && !!(await page.$('[data-testid="chat-relax-plus5"]')), 's odpočtem je v liště i panelu „+5“');
  await page.click('[data-testid="chat-relax-plus5"]');
  await sleep(300);
  expect(/^(20:00|19:5\d)$/.test(await odpocet()), `„+5“ v panelu prodlouží na 20 (${await odpocet()})`);
  await page.click('[data-testid="relax-konec"]');
  await sleep(300);
  await napis('relax');
  await cekej('[data-testid="relax-odpocet-5"]');
  await page.click('[data-testid="relax-odpocet-5"]');
  expect(await cekej('[data-testid="relax-odpocet"]') && /^(5:00|4:5\d)$/.test(await odpocet()), `šablona „5“ v liště zapne odpočet 5 minut (${await odpocet()})`);
  await page.click('[data-testid="relax-konec"]');
  await sleep(300);
  await page.click('[data-testid="chat-novy"]');
  expect(await cekej('[data-testid="chat-chip-relax"]'), 'čip Relax po novém rozhovoru');
  await page.click('[data-testid="chat-chip-relax"]');
  expect(await cekej('[data-testid="relax-vrstva"]') && !!(await page.$('[data-testid="relax-bez-odpoctu"]')), 'čip spustil relax bez odpočtu');
  await page.click('[data-testid="relax-konec"]');
  await sleep(300);
  expect(await cekej('[data-testid="chat-relax-toggle"][aria-pressed="false"]'), 'přepínač rybiček v hlavičce asistenta (vypnutý)');
  await page.click('[data-testid="chat-relax-toggle"]');
  expect(await cekej('[data-testid="relax-vrstva"][data-rozlozeni="vedle"]') && !!(await page.$('[data-testid="relax-bez-odpoctu"]')), 'přepínač: rybičky místo mapy, vedle chatu, bez odpočtu');
  expect(await cekej('[data-testid="chat-relax-toggle"][aria-pressed="true"]'), 'přepínač svítí');
  await page.click('[data-testid="chat-relax-toggle"]');
  await sleep(300);
  expect((await vrstva()) === null, 'druhý klik vrátí mapu');

  console.log('== /checkup: zámek BEZ odpočtu z „vedle“ přežije reload, aplikace pod závěsem je inert, po odemknutí zpět vedle ==');
  await page.click('[data-testid="chat-relax-toggle"]');
  await cekej('[data-testid="relax-vrstva"][data-rozlozeni="vedle"]');
  await page.click('[data-testid="relax-zamknout"]');
  await cekej('[data-testid="relax-pin-nastavit"]');
  await page.type('[data-testid="relax-pin"]', '4321');
  await sleep(300);
  await page.type('[data-testid="relax-pin"]', '4321');
  expect(await cekej('[data-testid="relax-vrstva"][data-zamek="1"][data-rozlozeni="cela"]'), 'zamčeno bez odpočtu → celá obrazovka');
  expect(await page.evaluate(() => localStorage.getItem('kb-relax-rozlozeni')) === 'vedle', 'zamknutí z „vedle“ nepřepsalo předvolbu rozložení');
  const inertPred = await page.evaluate(() => ({ n: document.querySelectorAll('[inert]').length, vrstva: document.querySelector('[data-testid="relax-vrstva"]').closest('[inert]') !== null, panel: document.querySelector('[data-testid="chat-panel"]').closest('[inert]') !== null }));
  expect(inertPred.n >= 1 && !inertPred.vrstva && inertPred.panel, `aplikace pod závěsem je inert (${JSON.stringify(inertPred)}), vrstva ne`);
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="relax-vrstva"][data-zamek="1"]', 15000) && !!(await page.$('[data-testid="relax-bez-odpoctu"]')), 'po F5 je zámek bez odpočtu dál zamčený (dřív zmizel)');
  await page.click('[data-testid="relax-odemknout"]');
  await cekej('[data-testid="relax-pin-odemknout"]');
  await page.type('[data-testid="relax-pin"]', '4321');
  expect(await cekej('[data-testid="relax-vrstva"][data-zamek="0"][data-rozlozeni="vedle"]'), 'po odemknutí zpět vedle chatu');
  expect((await page.evaluate(() => document.querySelectorAll('[inert]').length)) === 0, 'inert po odemknutí sundán');
  await page.click('[data-testid="relax-konec"]');
  await sleep(300);

  console.log('== /checkup: service worker neuloží scénu pod „/“; anglická scéna existuje ==');
  await napis('relax');
  await cekej('[data-testid="relax-vrstva"][data-nacteno="1"]', 20000);
  await page.click('[data-testid="relax-konec"]');
  await sleep(500);
  const shell = await page.evaluate(async () => { const ks = await caches.keys(); for (const k of ks) { const c = await caches.open(k); const r = await c.match('/'); if (r) return { k, text: await r.text() }; } return null; });
  expect(!shell || !/relax|Pod hladinou|aquariumCanvas|id="water"/.test(shell.text), `offline shell „/“ je aplikace, ne scéna (${shell ? shell.k : 'cache bez /'})`);
  const en = await page.evaluate(async () => { const r = await fetch('/relax/akvarium-en.html'); const t = await r.text(); return { status: r.status, lang: /<html[^>]*lang="en"/.test(t), cz: /lang="cs"/.test(t) }; });
  expect(en.status === 200 && en.lang && !en.cz, `anglická scéna /relax/akvarium-en.html (${JSON.stringify(en)})`);

  console.log('== nástroj start_relax od modelu (únava otevře skupinu relax) ==');
  const pred = volani.length;
  fronta.push(nastroj('start_relax', { minutes: 15 }), text('RELAX-MOCK: dobrou pauzu.'));
  await napis('Jsem hrozně unavený, dej mi pauzu');
  expect(await cekejText('RELAX-MOCK'), 'odpověď modelu po nástroji');
  expect(jmenaNastroju(volani[pred]).includes('start_relax'), 'slovo „unavený“ otevřelo skupinu relax (model dostal start_relax)');
  expect(await cekej('[data-testid="chat-relax-karta"][data-minut="15"]'), 'karta „Relax na 15 min spuštěn“');
  expect(await cekej('[data-testid="relax-vrstva"]'), 'vrstva se spustila z karty');
  const o4 = await odpocet();
  expect(/^(15:00|14:5\d)$/.test(o4), `odpočet 15 minut (${o4})`);
  await sleep(2500); // ať odpočet prokazatelně uběhl, než se obnoví stránka (jinak 15:00 i bez opakovaného spuštění)
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="relax-vrstva"]', 15000), 'relax z nástroje přežil reload');
  const o5 = await odpocet();
  expect(/^14:/.test(o5), `odpočet pokračuje, karta se po reloadu neprojevila podruhé (${o5})`);
  await page.click('[data-testid="relax-konec"]');
  await sleep(300);

  console.log('== nabídka po 50 minutách práce (hlídač), tečka na oušku ==');
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ start: Date.now() - 51 * 60000, posledni: Date.now() - 60000, nabidnuto: 0, posledniRelax: Date.now() - 2 * 3600000 })), klicAktivita);
  await page.reload({ waitUntil: 'networkidle2' });
  await cekej('[data-testid="chat-panel"]');
  expect((await page.$('[data-testid="chat-relax-nabidka"]')) === null, 'bez aktivity se nabídka neukáže');
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.type('a');
  expect(await cekej('[data-testid="chat-relax-nabidka"]'), 'po klávese: „Pracuješ už 50 minut v kuse…“');
  await page.click('[data-testid="chat-zavrit"]');
  expect(await cekej('[data-testid="chat-tab-relax"]'), 'zavřený panel: tečka na oušku');
  await page.click('[data-testid="chat-tab"]');
  await cekej('[data-testid="chat-relax-nabidka"]');
  await page.click('[data-testid="chat-relax-ne"]');
  await sleep(200);
  expect((await page.$('[data-testid="chat-relax-nabidka"]')) === null, '„Teď ne“ nabídku schová');
  await page.keyboard.type('b');
  await sleep(300);
  expect((await page.$('[data-testid="chat-relax-nabidka"]')) === null, 'po odmítnutí se do hodiny znovu nenabízí');
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ start: Date.now() - 51 * 60000, posledni: Date.now() - 60000, nabidnuto: Date.now() - 61 * 60000, posledniRelax: Date.now() - 2 * 3600000 })), klicAktivita);
  await page.reload({ waitUntil: 'networkidle2' });
  await cekej('[data-testid="chat-input"]');
  await page.click('[data-testid="chat-input"]');
  await page.keyboard.press('Backspace');
  expect(await cekej('[data-testid="chat-relax-nabidka"]'), 'po hodině zase nabídne');
  await page.click('[data-testid="chat-relax-15"]');
  expect(await cekej('[data-testid="relax-vrstva"]'), '„15 minut“ spustí relax');
  expect(/^(15:00|14:5\d)$/.test(await odpocet()), 'na 15 minut');
  await page.click('[data-testid="relax-konec"]');
  await sleep(300);

  console.log('== čip „🐟 Relax 5 min“ mezi „co dál“ po větším tahu (≥ 3 nástroje), klik bez modelu ==');
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ posledniRelax: Date.now() - 2 * 3600000 })), klicAktivita);
  await page.click('[data-testid="chat-novy"]');
  fronta.push(nastroj('list_maps', {}), nastroj('list_maps', {}), nastroj('list_maps', {}), nastroj('suggest_next', { suggestions: ['Rozebrat Truhlářství'] }), text('VELKY-TAH: prošel jsem to.'));
  await napis('Projdi mi všechno');
  expect(await cekejText('VELKY-TAH', 20000), 'odpověď po velkém tahu');
  expect(await cekej('[data-testid="chat-navrh-relax"]'), 'mezi návrhy je čip Relax od aplikace');
  const pred2 = volani.length;
  await page.click('[data-testid="chat-navrh-relax"]');
  expect(await cekej('[data-testid="relax-vrstva"]'), 'čip spustil relax');
  await sleep(500);
  expect(volani.length === pred2, 'klik na čip nešel modelu');
  await page.click('[data-testid="relax-konec"]');
  await sleep(300);
  expect((await page.$('[data-testid="chat-navrh-relax"]')) === null, 'hned po pauze se čip znovu nenabízí');

  console.log('== nová karta, když relax UŽ běží (stav sdílený v localStorage): start je vyřízený, po zavření se akvárium nevrací (/checkup 25. 10.) ==');
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ scena: 'akvarium', minut: 0, start: Date.now(), konecV: 0, rozlozeni: 'vedle', zamek: '', hotovo: false, pokusy: 0, blokDo: 0 })), klicRelax);
  const pageR = await page.browser().newPage();
  await pageR.setViewport({ width: 1280, height: 900 });
  await pageR.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); }, A);
  await pageR.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  expect(await pageR.waitForSelector('[data-testid="relax-vrstva"]', { timeout: 15000 }).then(() => true).catch(() => false), 'nová karta vidí běžící relax');
  await pageR.click('[data-testid="relax-konec"]');
  await sleep(1500);
  expect((await pageR.$('[data-testid="relax-vrstva"]')) === null, 'po zavření se akvárium v téže kartě hned znovu neotevřelo');
  await pageR.close();

  console.log('== nová karta prohlížeče = start aplikace znovu: akvárium vedle chatu bez odpočtu (sessionStorage je na kartu) ==');
  const page2 = await page.browser().newPage();
  await page2.setViewport({ width: 1280, height: 900 });
  await page2.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); }, A);
  await page2.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  expect(await page2.waitForSelector('[data-testid="relax-vrstva"][data-rozlozeni="vedle"][data-scena="akvarium"]', { timeout: 15000 }).then(() => true).catch(() => false) && !!(await page2.$('[data-testid="relax-bez-odpoctu"]')), 'nová karta: akvárium vedle chatu bez odpočtu');
  expect(!!(await page2.$('[data-testid="chat-panel"]')), 'nová karta: panel asistenta otevřený');
  // stav relaxu je v localStorage společný pro karty → v nové kartě ho ukončit, jinak by ho původní karta po reloadu právem ukázala
  await page2.click('[data-testid="relax-konec"]');
  await sleep(300);
  await page2.close();
  // v původní kartě (start už proběhl) akvárium po reloadu nenaskočí
  await page.reload({ waitUntil: 'networkidle2' });
  await cekej('[data-testid="chat-panel"]');
  await sleep(1500);
  expect((await vrstva()) === null, 'původní karta: po reloadu se akvárium nevrací');
  await page.click('[data-testid="chat-porada-ne"]').catch(() => {});

  console.log('== mikrofon úplně vlevo (když je přepis k dispozici) ==');
  const mik = await page.evaluate(() => { const m = document.querySelector('[data-testid="chat-form"] [data-testid="chat-hlas"]'); const i = document.querySelector('[data-testid="chat-input"]'); if (!m) return null; const a = m.getBoundingClientRect(), b = i.getBoundingClientRect(); return { vlevo: a.x < b.x, vyska: Math.abs(a.height - b.height) <= 2 }; });
  expect(mik === null || (mik.vlevo && mik.vyska), `mikrofon vlevo od políčka a stejně vysoký (${JSON.stringify(mik)} — null = instance bez přepisu)`);

  console.log('== telefon: jen celá obrazovka, bez přepínače rozložení ==');
  await page.setViewport({ width: 390, height: 844 });
  await sleep(300);
  if (!(await page.$('[data-testid="chat-input"]')) && (await page.$('[data-testid="chat-bar-input"]'))) {
    await page.click('[data-testid="chat-bar-input"]'); await page.keyboard.type('relax'); await page.keyboard.press('Enter');
  } else await napis('relax');
  expect(await cekej('[data-testid="relax-vrstva"][data-rozlozeni="nad"]'), 'na telefonu na výšku: scéna NAD chatem (dělené rozložení)');
  expect(!!(await page.$('[data-testid="relax-bez-odpoctu"]')), 'holé relax na telefonu = bez odpočtu');
  await page.click('[data-testid="relax-konec"]');
  await sleep(300);
  await page.click('[data-testid="chat-novy"]'); // prázdný chat = čipy
  await cekej('[data-testid="chat-chipy"]');
  await napis('relax');
  await cekej('[data-testid="relax-vrstva"][data-rozlozeni="nad"]');
  const kompakt = await page.evaluate(() => { const s = document.querySelector('[data-testid="chat-relax-stav"]').getBoundingClientRect(); const c = document.querySelector('[data-testid="chat-chipy"]'); return { stavH: s.height, chipyH: c ? c.getBoundingClientRect().height : 0, chipyScroll: c ? c.scrollWidth > c.clientWidth : false }; });
  expect(kompakt.stavH <= 44 && kompakt.chipyH <= 44 && kompakt.chipyScroll, `na telefonu: stav relaxu na jeden řádek (${Math.round(kompakt.stavH)} px), čipy v jednom posuvném řádku (${Math.round(kompakt.chipyH)} px)`);
  console.log('== telefon: zmenšený panel = lišta dole zůstane vidět, scéna nad ní ==');
  await page.evaluate(() => document.activeElement && document.activeElement.blur()); // nepíše se → zmenšení nesmí vyvolat klávesnici
  await sleep(1000); // blur starší než 0,8 s = uživatel nepsal
  await page.click('[data-testid="chat-zmensit"]');
  expect(await cekej('[data-testid="chat-bar"]'), 'panel zmenšen do lišty');
  await sleep(300);
  expect((await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'))) !== 'chat-bar-input', 'zmenšení bez psaní nepřesune fokus do políčka lišty (klávesnice nevyskočí)');
  expect(await cekej('[data-testid="relax-vrstva"][data-rozlozeni="nad"][data-nad-listou="1"]', 5000), 'scéna zůstala, nad lištou');
  const bl2 = await (await vrstva()).boundingBox();
  const bb = await (await page.$('[data-testid="chat-bar"]')).boundingBox();
  const spT = await spodekListy();
  expect(spT > 0 && Math.abs(bl2.y - spT) <= 1 && Math.abs(bl2.y + bl2.height - bb.y) <= 2 && bb.y + bb.height >= 840, `scéna od horní lišty (${spT}) do ${Math.round(bl2.y + bl2.height)} px, lišta chatu od ${Math.round(bb.y)} px do spodku (klikací, hlasovky dostupné)`);
  await page.click('[data-testid="chat-bar-otevrit"]');
  expect(await cekej('[data-testid="chat-panel"]') && await cekej('[data-testid="relax-vrstva"][data-rozlozeni="nad"][data-nad-listou="0"]', 5000), 'otevření z lišty → zpět 40 % nad chatem');
  const bn = await (await vrstva()).boundingBox();
  const bpn = await (await page.$('[data-testid="chat-panel"]')).boundingBox();
  expect(Math.abs(bn.y - spT) <= 1 && Math.abs(bn.height - 844 * 0.4) <= 2 && Math.abs(bpn.y - (bn.y + bn.height)) <= 2 && bpn.y + bpn.height >= 840, `scéna pod lištou (od ${Math.round(bn.y)}) 40 % výšky (${Math.round(bn.height)} px), chat od ${Math.round(bpn.y)} px do spodku`);
  await page.click('[data-testid="relax-rozlozeni"]');
  expect(await cekej('[data-testid="relax-vrstva"][data-rozlozeni="cela"]'), 'přepínač: přes celý displej');
  await page.click('[data-testid="relax-zpet-vedle"]');
  expect(await cekej('[data-testid="relax-vrstva"][data-rozlozeni="nad"]'), 'zpět nad chat');
  await page.setViewport({ width: 844, height: 390 });
  expect(await cekej('[data-testid="relax-vrstva"][data-rozlozeni="vedle"]', 5000), 'telefon na ležato: vedle sebe jako na počítači');
  await sleep(400);
  const lezato = await page.evaluate(() => { const l = document.querySelector('[data-testid="relax-lista"]').getBoundingClientRect(); const v = document.querySelector('[data-testid="relax-vrstva"]').getBoundingClientRect(); return { listaY: l.y, vrstvaY: v.y, listaW: l.width, vrstvaW: v.width, sloupec: !!document.querySelector('[data-testid="relax-sceny"]'), ikonaVListe: !!document.querySelector('[data-testid="relax-lista"] [data-testid="relax-scena-ul"]'), fokus: document.activeElement && document.activeElement.getAttribute('data-testid'), dotyk: matchMedia('(pointer: coarse)').matches }; });
  expect(lezato.vrstvaY > 0 && lezato.listaY === lezato.vrstvaY && Math.abs(lezato.listaW - lezato.vrstvaW) <= 1 && !lezato.sloupec && lezato.ikonaVListe, `na ležato je lišta jeden pruh na horní hraně scény (pod lištou aplikace) se scénami uvnitř, bez sloupce (${JSON.stringify(lezato)})`);
  expect(!lezato.dotyk || lezato.fokus !== 'chat-input', `po otočení se políčko chatu samo nezaostří (klávesnice nevyskočí) — dotyk ${lezato.dotyk}, fokus ${lezato.fokus}`);
  await page.setViewport({ width: 390, height: 844 });
  await cekej('[data-testid="relax-vrstva"][data-rozlozeni="nad"]', 5000);
  await page.click('[data-testid="relax-konec"]');
  await page.setViewport({ width: 1400, height: 900 });

  console.log('== lite (zjednodušené zobrazení): relax dělený = scéna nad lite asistentem ==');
  await page.goto(`${inst.base}/lite`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="lite-asistent"]'), 'lite: tlačítko Asistent v hlavičce');
  await page.click('[data-testid="lite-asistent"]');
  expect(await cekej('[data-testid="chat-input"]'), 'lite: panel asistenta otevřen');
  await napis('relax');
  expect(await cekej('[data-testid="relax-vrstva"][data-rozlozeni="nad"][data-nacteno="1"]', 20000), 'lite: scéna nad asistentem (dělené rozložení)');
  const bl = await (await vrstva()).boundingBox();
  const bpl = await (await page.$('[data-testid="chat-panel"]')).boundingBox();
  const vyska = page.viewport().height;
  expect(Math.abs(bl.height - vyska * 0.4) <= 2 && Math.abs(bpl.y - bl.height) <= 2, `lite: scéna 40 % výšky okna (${Math.round(bl.height)} z ${vyska}), panel od ${Math.round(bpl.y)}`);
  await page.click('[data-testid="relax-rozlozeni"]');
  expect(await cekej('[data-testid="relax-vrstva"][data-rozlozeni="cela"]'), 'lite: přes celý displej');
  await page.click('[data-testid="relax-zpet-vedle"]');
  expect(await cekej('[data-testid="relax-vrstva"][data-rozlozeni="nad"]'), 'lite: zpět nad asistenta');
  await page.click('[data-testid="relax-konec"]');
  await sleep(300);
  expect((await vrstva()) === null, 'lite: ukončeno');

  expect(chyby.length === 0, `konzole bez chyb (${chyby.slice(0, 3).join(' | ')})`);
}, { nazev: 'UI-RELAX' });
