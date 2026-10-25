// Stránky asistenta (14. 10. 2026) — klikací sada (Puppeteer) proti PODVRŽENÉ ollamě.
// Měří: tah s create_page → karta v chatu + panel Stránek se sám otevře (stav „píše se“) → prohlížeč
// sám spustí writer → stránka hotová v SANDBOXOVANÉM iframu (sandbox přesně, bez allow-same-origin,
// localStorage uvnitř hodí SecurityError) → Sdílet odkazem → /p/<token> v NEpřihlášeném kontextu
// 200 + sandbox (localStorage SecurityError, bez cookies) → Nový odkaz (starý 404) → Vidí tým (člen
// vidí přes API) → Zrušit odkaz (404) → Otevřít /stranka/:id → záložky Dokumenty | Stránky →
// writer bez HTML → „Zkusit znovu“ → Smazat.
const H = require('./_harness');
const { expect, sleep } = H;

const fronta = [];
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const text = (s) => ({ content: s });
const HTML = (zn) => `<!doctype html>\n<html lang="cs"><head><meta charset="utf-8"><title>${zn}</title></head><body><h1 id="h">${zn}</h1><nav><a id="kotva" href="#konec">Konec</a></nav><div style="height:3000px"></div><h2 id="konec">KONEC-${zn}</h2><script>document.getElementById('h').dataset.js='ran'</script></body></html>`;
const blok = (zn) => text('Here it is:\n```html\n' + HTML(zn) + '\n```\n');
const volani = [];
let zdrzeniWriteru = 0; // ms zdržení volání BEZ nástrojů (writer) — ať jde v panelu zachytit průběh po částech
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) { b = {}; }
  b._url = req.url; volani.push(b);
  const o = fronta.shift() || text('(fronta prázdná)');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  const odpoved = () => res.end(JSON.stringify({ message, prompt_eval_count: 100, eval_count: 20, done: true }));
  if (!b.tools && zdrzeniWriteru) setTimeout(odpoved, zdrzeniWriteru); else odpoved();
};

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ui-stranky', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0,
  } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  await inst.register('clen@example.com', { name: 'Jana' });
  const A = await inst.login('admin@example.com');
  const B = await inst.login('clen@example.com');
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Truhlářství', nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň', title: 'Kuchyň', status: 'todo' } }], edges: [] } })).json;
  expect(!!map.id, 'mapa založena');

  const { page } = await H.browser();
  await page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); }, A);
  const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const textPanel = () => page.evaluate(() => document.querySelector('[data-testid="chat-dokumenty"]')?.innerText || '');
  const cekejText = async (s, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await textPanel()).includes(s)) return true; await sleep(250); } return false; };
  const napis = async (s) => { await page.click('[data-testid="chat-input"]'); await page.keyboard.type(s); await page.keyboard.press('Enter'); };
  const ramec = () => page.frames().find((f) => f.parentFrame() && f.url().startsWith('about:')) || page.frames().find((f) => f !== page.mainFrame());
  const bezAuth = async (url) => {
    const b = page.browser();
    const ctx = b.createBrowserContext ? await b.createBrowserContext() : await b.createIncognitoBrowserContext();
    const p2 = await ctx.newPage();
    const res = await p2.goto(url, { waitUntil: 'load' }).catch(() => null);
    const out = { status: res ? res.status() : 0, text: await p2.evaluate(() => document.body ? document.body.innerText : '').catch(() => ''),
      ls: await p2.evaluate(() => { try { localStorage.getItem('x'); return 'ok'; } catch (e) { return e.name; } }).catch((e) => String(e)),
      // v sandboxu (cizí původ) čtení document.cookie samo hodí SecurityError — to je ještě pevnější zeď než prázdný řetězec
      cookie: await p2.evaluate(() => { try { return document.cookie; } catch (e) { return e.name; } }).catch(() => 'ERR'),
      csp: res ? (res.headers()['content-security-policy'] || '') : '' };
    await ctx.close();
    return out;
  };

  console.log('== tah s create_page → karta + panel Stránek se sám otevře, prohlížeč spustí writer → hotovo v sandboxu ==');
  await page.goto(`${inst.base}/map/${map.id}`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => { localStorage.setItem('kb-chat-open', '1'); });
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-panel"]'), 'panel asistenta otevřený');
  fronta.push(nastroj('create_page', { title: 'Prezentace Q4', brief: 'tři slajdy', content: 'tržby 12,4 mil.' }), text('Stránku píšu.'), blok('STR-UI-1'));
  await napis('Udělej mi prezentaci výsledků Q4');
  expect(await cekej('[data-testid="chat-stranka-karta"][data-akce="nova"]', 15000), 'v chatu karta stránky „píše se, otevřít“');
  expect(await cekej('[data-testid="chat-str-detail"]', 15000), 'panel Stránek se sám otevřel s detailem');
  expect(await cekej('[data-testid="chat-str-detail"][data-stav="hotovo"]', 20000), 'prohlížeč spustil writer → stránka hotová (realtime)');
  expect(await cekej('[data-testid="chat-str-iframe"]'), 'náhled v iframu');
  const sandbox = await page.$eval('[data-testid="chat-str-iframe"]', (f) => f.getAttribute('sandbox'));
  expect(sandbox === 'allow-scripts allow-forms allow-popups allow-modals', `iframe sandbox přesně, BEZ allow-same-origin (${sandbox})`);
  await sleep(500);
  const fr = ramec();
  expect(!!fr, 'rámec náhledu existuje');
  const uvnitr = fr ? await fr.evaluate(() => ({ h: document.getElementById('h')?.textContent, js: document.getElementById('h')?.dataset.js, ls: (() => { try { localStorage.getItem('x'); return 'ok'; } catch (e) { return e.name; } })() })).catch((e) => ({ err: String(e) })) : {};
  expect(uvnitr.h === 'STR-UI-1' && uvnitr.js === 'ran', `uvnitř rámce běží HTML i skript (${JSON.stringify(uvnitr)})`);
  expect(uvnitr.ls === 'SecurityError', `localStorage uvnitř rámce = SecurityError (stránka nedosáhne na přihlášení) (${uvnitr.ls})`);
  // /checkup 25. 10. 2026: náhled nese meta CSP form-action/connect-src 'none' → stránka od agenta nemůže odeslat data ven (ani zpět na instanci)
  const cspN = fr ? await fr.evaluate(async (u) => { let f; try { await fetch(u); f = 'ok'; } catch (e) { f = e.name; } return { meta: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'), f }; }, `${inst.base}/api/health`) : null;
  expect(cspN && cspN.meta && cspN.f === 'TypeError', `náhled: meta CSP + fetch z rámce zablokovaný (${JSON.stringify(cspN)})`);
  // klik-test 25. 10. 2026: odkaz „#sekce“ v náhledu (navigace stránky) nechal v srcdoc rámci prázdno (about:blank#…);
  // náhled vkládá skript, který klik převede na posun (klik myší přes souřadnice rámce v panelu je nespolehlivý → click() na kotvě:
  // i ten má u <a> výchozí navigaci, kterou skript musí zastavit)
  await fr.evaluate(() => document.getElementById('kotva').click());
  await sleep(1200);
  const poKliku = ramec() ? await ramec().evaluate(() => ({ url: location.href.slice(0, 12), h: document.getElementById('h')?.textContent || null, y: window.scrollY, skript: !!document.querySelector('script[data-kb="nahled-kotvy"]') })) : null;
  expect(poKliku && poKliku.url === 'about:srcdoc' && poKliku.skript && poKliku.h === 'STR-UI-1' && poKliku.y > 1000, `klik na kotvu v náhledu posune na sekci, stránka zůstane (${JSON.stringify(poKliku)})`);
  const idStr = await page.$eval('[data-testid="chat-str-detail"]', (el) => el.dataset.id);
  const cast = fronta.length;
  expect(cast === 0, 'writer spotřeboval odpověď modelu z fronty (volal se právě jednou)');

  console.log('== sdílet odkazem → /p/<token> bez přihlášení: 200, sandbox, žádné cookies ==');
  await page.click('[data-testid="chat-str-sdilet"]');
  expect(await cekej('[data-testid="chat-str-odkaz"]'), 'po zapnutí pole s odkazem');
  const url1 = await page.$eval('[data-testid="chat-str-odkaz"]', (i) => i.value);
  expect(/\/p\/[a-z0-9]{32}$/.test(url1), `odkaz /p/<32 znaků> (${url1})`);
  let v = await bezAuth(url1);
  expect(v.status === 200 && /STR-UI-1/.test(v.text), `nepřihlášený návštěvník odkaz otevře (${v.status})`);
  expect(/^sandbox /.test(v.csp) && !/allow-same-origin/.test(v.csp), `CSP sandbox na veřejné stránce (${v.csp})`);
  expect(v.ls === 'SecurityError' && (v.cookie === '' || v.cookie === 'SecurityError'), `veřejná stránka: localStorage SecurityError, cookies nedostupné (${v.ls}, "${v.cookie}")`);
  expect(/form-action 'none'/.test(v.csp) && /connect-src 'none'/.test(v.csp) && /frame-ancestors 'none'/.test(v.csp), `veřejná stránka: CSP form-action/connect-src/frame-ancestors 'none' (${v.csp})`);
  await page.click('[data-testid="chat-str-novy-odkaz"]');
  await sleep(600);
  const url2 = await page.$eval('[data-testid="chat-str-odkaz"]', (i) => i.value);
  expect(url2 !== url1 && /\/p\/[a-z0-9]{32}$/.test(url2), 'Nový odkaz → jiný token');
  expect((await bezAuth(url1)).status === 404 && (await bezAuth(url2)).status === 200, 'starý odkaz 404, nový 200');
  console.log('== Lidé: výběr člena jako u sdílení mapy, pak celý tým ==');
  await page.click('[data-testid="chat-str-lide-prepinac"]');
  expect(await cekej('[data-testid="chat-str-lide-vyber"]'), 'sekce Lidé s výběrem členů');
  await sleep(500);
  const volby = await page.$$eval('[data-testid="chat-str-lide-vyber"] option', (os) => os.map((o) => o.textContent));
  expect(volby.some((v) => /Jana \(clen@example.com\)/.test(v)) && !volby.some((v) => /admin@example.com/.test(v)), `v nabídce je Jana, ne já (${volby.join(' | ')})`);
  const hodnotaJana = await page.$$eval('[data-testid="chat-str-lide-vyber"] option', (os) => (os.find((o) => /Jana/.test(o.textContent)) || {}).value);
  await page.select('[data-testid="chat-str-lide-vyber"]', hodnotaJana);
  await page.click('[data-testid="chat-str-lide-pridat"]');
  expect(await cekej('[data-testid="chat-str-clovek"]'), 'Jana v seznamu lidí');
  let tym = (await inst.api('GET', '/api/kb/chat/stranky?skupina=tym', { token: B })).json.stranky;
  expect(tym.length === 1 && tym[0].id === idStr && tym[0].owner_name === 'Petr Novák' && !('share_token' in tym[0]), 'Jana stránku vidí v „sdílené se mnou“ (bez tokenu)');
  expect((await page.$eval('[data-testid="chat-str-lide-prepinac"]', (b) => b.textContent)).trim() === '1 člověk', `tlačítko ukazuje počet lidí (${await page.$eval('[data-testid="chat-str-lide-prepinac"]', (b) => b.textContent)})`);
  await page.click('[data-testid="chat-str-clovek-odebrat"]');
  await sleep(600);
  expect(!(await page.$('[data-testid="chat-str-clovek"]')) && (await inst.api('GET', '/api/kb/chat/stranky?skupina=tym', { token: B })).json.stranky.length === 0, 'Odebrat → Jana už nevidí');
  await page.click('[data-testid="chat-str-tym"]');
  await sleep(600);
  expect(await page.$eval('[data-testid="chat-str-tym"]', (b) => b.checked), 'Celý tým zapnuto');
  tym = (await inst.api('GET', '/api/kb/chat/stranky?skupina=tym', { token: B })).json.stranky;
  expect(tym.length === 1 && tym[0].id === idStr, 'člen stránku vidí přes celý tým');
  await page.click('[data-testid="chat-str-zrusit-odkaz"]');
  await sleep(600);
  expect(!(await page.$('[data-testid="chat-str-odkaz"]')) && (await bezAuth(url2)).status === 404, 'Zrušit odkaz → pole zmizí, odkaz 404');

  console.log('== Otevřít přes /stranka/:id (přihlášený, sandbox) ==');
  const href = await page.$eval('[data-testid="chat-str-otevrit"]', (a) => a.getAttribute('href'));
  expect(href === `/stranka/${idStr}` && (await page.$eval('[data-testid="chat-str-otevrit"]', (a) => a.getAttribute('target'))) === '_blank', `Otevřít = /stranka/<id> v nové kartě (${href})`);
  // klik-test 25. 10. 2026: běžící relax (stav v localStorage) zakryl i novou kartu s oknem stránky → okno /stranka/:id vrstvu nekreslí
  const uidA = (await inst.api('POST', '/api/collections/users/auth-refresh', { token: A })).json.record.id;
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ scena: 'akvarium', minut: 0, start: Date.now(), konecV: 0, rozlozeni: 'cela', zamek: '', hotovo: false, pokusy: 0, blokDo: 0 })), `kb-relax:${uidA}`);
  await page.goto(`${inst.base}${href}`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="stranka-iframe"]'), 'okno stránky s rámcem');
  await sleep(800);
  expect(!(await page.$('[data-testid="relax-vrstva"]')) && !(await page.$('[data-testid="relax-zavoj"]')), 'běžící relax okno stránky NEzakrývá (vrstva se na /stranka/:id nekreslí)');
  expect(!(await page.$('[data-testid="chat-panel"]')) && !(await page.$('[data-testid="chat-dokumenty"]')), 'okno stránky je bez asistenta i panelu Dokumentů (jen čtení a sdílení)');
  await page.goto(`${inst.base}/map/${map.id}`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="relax-vrstva"]', 15000), 'kontrola stavu: tentýž relax se v mapě kreslí (stav v localStorage platí)');
  await page.evaluate((k) => localStorage.removeItem(k), `kb-relax:${uidA}`);
  await page.goto(`${inst.base}${href}`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="stranka-iframe"]'), 'okno stránky znovu (bez relaxu)');
  expect((await page.$eval('[data-testid="stranka-iframe"]', (f) => f.getAttribute('sandbox'))) === 'allow-scripts allow-forms allow-popups allow-modals', 'rámec v okně stránky má stejný sandbox');
  expect((await page.$eval('[data-testid="stranka-titulek"]', (e) => e.textContent)) === 'Prezentace Q4', 'titulek stránky');
  const vB = page.browser();
  const ctxB = vB.createBrowserContext ? await vB.createBrowserContext() : await vB.createIncognitoBrowserContext();
  const pB = await ctxB.newPage();
  await pB.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); }, B);
  await pB.goto(`${inst.base}${href}`, { waitUntil: 'networkidle2' });
  expect(await pB.waitForSelector('[data-testid="stranka-iframe"]', { timeout: 10000 }).then(() => true).catch(() => false), 'člen týmu stránku v okně otevře (vidí tým)');
  await ctxB.close();

  console.log('== záložky Dokumenty | Stránky, seznam, Tým ==');
  await page.goto(`${inst.base}/map/${map.id}`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-dokumenty"]'), 'panel dokumentů zůstal otevřený');
  if (await page.$('[data-testid="chat-dok-zpet"]')) await page.click('[data-testid="chat-dok-zpet"]');
  expect(await cekej('[data-testid="chat-dok-zalozky"]'), 'hlavička má záložky');
  await page.click('[data-testid="chat-dok-zalozka"][data-zalozka="stranky"]');
  expect(await cekej('[data-testid="chat-str-polozka"][data-stav="hotovo"]'), 'záložka Stránky → seznam s hotovou stránkou');
  await page.click('[data-testid="chat-str-filtr"][data-skupina="tym"]');
  expect(await cekej('[data-testid="chat-str-prazdno"]'), 'Tým: vlastní stránka tam není (seznam prázdný)');
  await page.click('[data-testid="chat-str-filtr"][data-skupina="moje"]');
  await page.click('[data-testid="chat-dok-zalozka"][data-zalozka="dokumenty"]');
  expect(await cekej('[data-testid="chat-dok-seznam"]'), 'zpět na Dokumenty');

  console.log('== Nová stránka ze šablony: formulář složí zprávu → chat → create_page; psaní po částech je vidět (kroky, kód) ==');
  await page.click('[data-testid="chat-dok-zalozka"][data-zalozka="stranky"]');
  expect(await cekej('[data-testid="chat-str-nova"]'), 'tlačítko Nová stránka');
  await page.click('[data-testid="chat-str-nova"]');
  expect(await cekej('[data-testid="chat-str-nova-form"]'), 'formulář šablon');
  const sablony = await page.$$eval('[data-testid="chat-str-sablona"]', (bs) => bs.map((b) => b.dataset.sablona));
  expect(sablony.join() === 'vedeni,tym,zakaznik,osa,report,checklist,volne', `7 šablon (${sablony.join()})`);
  expect(await cekej('[data-testid="chat-str-nova-projekt"] option[value="' + map.id + '"]'), 'výběr projektu nabízí mapu');
  expect((await page.$eval('[data-testid="chat-str-nova-projekt"]', (s) => s.value)) === map.id, 'projekt z adresy předvybraný');
  await page.click('[data-testid="chat-str-sablona"][data-sablona="report"]');
  await page.click('[data-testid="chat-str-styl"][data-styl="tmavy"]');
  await page.click('[data-testid="chat-str-nova-text"]'); await page.keyboard.type('zdůrazni zpoždění');
  const KOSTRA_UI = '<!doctype html>\n<html lang="cs"><head><meta charset="utf-8"><title>Report</title></head><body><main>\n<section id="sec-uvod"><!--SEKCE:uvod--></section>\n<section id="sec-semafor"><!--SEKCE:semafor--></section>\n</main></body></html>';
  fronta.push(nastroj('create_page', { title: 'Report stavu', brief: 'semafor', content: 'Kuchyň: todo' }), text('Píšu report.'),
    text('{"style": "tmavý", "sections": [{"id": "uvod", "heading": "Úvod", "content": "x"}, {"id": "semafor", "heading": "Semafor", "content": "y"}]}'),
    text('```html\n' + KOSTRA_UI + '\n```'), text('```html\n<h2 id="h">UI-CAST-UVOD</h2>\n```'), text('```html\n<h2>Semafor</h2><p>UI-CAST-SEMAFOR</p>\n```'));
  zdrzeniWriteru = 1500;
  const predF = volani.length;
  await page.click('[data-testid="chat-str-nova-odeslat"]');
  expect(await cekej('[data-testid="chat-stranka-karta"][data-akce="nova"]', 15000), 'zpráva ze šablony odeslána → karta stránky');
  // karta „nova“ v chatu může být ještě z dřívějšího kroku → počkat, až odeslaná zpráva skutečně dorazí k modelu
  let zprava = '';
  for (const t0 = Date.now(); Date.now() - t0 < 15000 && !zprava; await sleep(250)) {
    const uzivatelske = volani.slice(predF).flatMap((v) => (v.messages || []).filter((m) => m.role === 'user').map((m) => String(m.content || '')));
    zprava = uzivatelske.find((c) => /Udělej mi stránku/.test(c)) || '';
  }
  expect(/Udělej mi stránku: jednostránkový report stavu projektu se semaforem/.test(zprava) && /Vycházej z projektu „Truhlářství“/.test(zprava) && /Vzhled: tmavý/.test(zprava) && /Doplnění: zdůrazni zpoždění/.test(zprava), `složená zpráva: šablona + projekt + vzhled + doplnění (${zprava.slice(0, 200) || JSON.stringify(volani.slice(predF).map((v) => ({ url: v._url, role: (v.messages || []).map((m) => m.role).join('>') }))).slice(0, 300)})`);
  expect(await cekej('[data-testid="chat-str-detail"][data-stav="pise"]', 15000), 'detail nové stránky: píše se');
  expect(await cekej('[data-testid="chat-str-kroky"]', 8000), 'seznam kroků psaní');
  expect(await cekej('[data-testid="chat-str-krok"][data-stav="bezi"]', 8000), 'běžící krok je vidět');
  const krokyTxt = await page.$eval('[data-testid="chat-str-kroky"]', (e) => e.innerText);
  expect(/Osnova stránky/.test(krokyTxt), `kroky: osnova… (${krokyTxt.replace(/\n/g, ' | ')})`);
  await page.click('[data-testid="chat-str-kod-prepinac"]');
  expect(await cekej('[data-testid="chat-str-kod"]', 5000), 'přepínač Kód ukáže vznikající HTML');
  const kodOk = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 10000) { const s = await page.$eval('[data-testid="chat-str-kod"]', (e) => e.textContent).catch(() => ''); if (/SEKCE:semafor|UI-CAST-UVOD/.test(s)) return true; await sleep(200); } return false; })();
  expect(kodOk, 'v kódu se objevila kostra se značkami / první část');
  expect(await cekej('[data-testid="chat-str-detail"][data-stav="hotovo"]', 20000), 'stránka ze šablony hotová');
  zdrzeniWriteru = 0;
  await sleep(500);
  const fr2 = ramec();
  const uvnitr2 = fr2 ? await fr2.evaluate(() => document.body.innerText).catch(() => '') : '';
  expect(/UI-CAST-UVOD/.test(uvnitr2) && /UI-CAST-SEMAFOR/.test(uvnitr2), `náhled hotové stránky má obě části (${uvnitr2.replace(/\n/g, ' ').slice(0, 80)})`);
  expect(fronta.length === 0, 'writer spotřeboval osnovu, kostru a obě části');
  await page.click('[data-testid="chat-dok-zpet"]');
  expect(await cekej('[data-testid="chat-str-polozka"][data-stav="hotovo"]'), 'zpět na seznam');
  await page.click('[data-testid="chat-dok-zalozka"][data-zalozka="dokumenty"]');

  console.log('== writer bez HTML → selhání + Zkusit znovu → hotovo; Smazat ==');
  fronta.push(nastroj('create_page', { title: 'Ceník', brief: 'tabulka' }), text('Píšu.'), text('Nope, no HTML here.'), text('Still nothing.'));
  await napis('Udělej stránku s ceníkem');
  expect(await cekej('[data-testid="chat-str-detail"][data-stav="chyba"]', 20000), 'writer bez HTML → stav „nepovedlo se“');
  expect(await cekej('[data-testid="chat-str-znovu"]'), 'tlačítko Zkusit znovu');
  fronta.push(blok('STR-UI-2'));
  await page.click('[data-testid="chat-str-znovu"]');
  expect(await cekej('[data-testid="chat-str-detail"][data-stav="hotovo"]', 20000), 'Zkusit znovu → hotovo');
  expect(await cekejText('Ceník'), 'detail ceníku');
  await page.click('[data-testid="chat-str-smazat"]');
  expect(await cekej('[data-testid="chat-str-smazat-potvrzeni"]'), 'dotaz před smazáním');
  await page.click('[data-testid="chat-str-smazat-ano"]');
  expect(await cekej('[data-testid="chat-str-seznam"]'), 'po smazání seznam stránek');
  const zbyle = (await inst.api('GET', '/api/kb/chat/stranky', { token: A })).json.stranky.map((s) => s.title).sort();
  expect(zbyle.join() === 'Prezentace Q4,Report stavu', `zbyly dvě stránky: prezentace + report ze šablony (${zbyle.join(' | ')})`);
  void mock;
}, { nazev: 'UI-STRANKY' });
