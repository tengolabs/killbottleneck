// UI e2e: KANBANOVÁ ŠABLONA očima uživatele (Richard 15. 8. 2026):
//  - dialog Nový projekt → Ze šablony: „8D report — kanban" je v nabídce
//    a přiznává odznak „vč. 7 pravidel automatizace"
//  - založení projektu ze šablony DOOPRAVDY založí pravidla (FE cesta
//    createProjectFromTemplate → /rules/save) — přehled ⚡ ukazuje 7 pravidel
//  - mapa ze šablony jede rovnou v kanban režimu (lišta: indikátor Kanban)
//  - kanban FUNGUJE: karta pod D1 → odznak stavu → done → karta pod D2
//    + návrat na Založeno (ověřeno čerstvým čtením mapy z API, ne echem UI)
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const NAME = 'kb-e2e-ui-sablony';
const PORT = 20996;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: 'sef@example.com', password: PW, passwordConfirm: PW } });
    const SEF = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'sef@example.com', password: PW } })).json.token;

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1000 });
    const errs = [];
    const cizihoPuvodu = (m) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test((m.location() && m.location().url) || '');
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })), SEF);

    console.log('== Nový projekt → Ze šablony: kanban šablona v nabídce s odznakem pravidel ==');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    // čekat na vykreslenou hlavičku, ne pevný spánek (lekce flaku ui-kanban)
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Nový projekt/.test(b.textContent || '')), { timeout: 45000 });
    ok(await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Nový projekt/.test(x.textContent || ''));
      b && b.click();
      return !!b;
    }), 'tlačítko Nový projekt na Home');
    await page.waitForFunction(() => [...document.querySelectorAll('[role="tab"]')].some((x) => /Ze šablony/.test(x.textContent || '')), { timeout: 15000 });
    // Radix tab nereaguje na programový .click() (poslouchá pointer eventy)
    // → skutečný klik myší přes souřadnice
    const tabBox = await page.evaluate(() => {
      const t = [...document.querySelectorAll('[role="tab"]')].find((x) => /Ze šablony/.test(x.textContent || ''));
      const r = t.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(tabBox.x, tabBox.y);
    // šablony se donačítají ze serveru (a odznak pravidel čeká na lazy ns)
    await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some((x) => (x.textContent || '').includes('8D report — kanban')), { timeout: 15000 });
    await page.waitForFunction(() => !!document.querySelector('[data-testid="tpl-rules-badge"]'), { timeout: 15000 });
    const tplBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => (x.textContent || '').includes('8D report — kanban'));
      if (!b) return null;
      return { badge: !!b.querySelector('[data-testid="tpl-rules-badge"]'), badgeText: b.querySelector('[data-testid="tpl-rules-badge"]')?.textContent || '' };
    });
    ok(!!tplBtn, 'šablona „8D report — kanban" je v nabídce');
    ok(tplBtn && tplBtn.badge && /7/.test(tplBtn.badgeText), `odznak „vč. 7 pravidel automatizace" (${tplBtn && tplBtn.badgeText})`);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => (x.textContent || '').includes('8D report — kanban'));
      b && b.click();
    });
    await sleep(400);
    await page.evaluate((v) => {
      const i = document.querySelector('#project-name');
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, v);
      i.dispatchEvent(new Event('input', { bubbles: true }));
    }, 'Reklamační kanban');
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Založit projekt/.test(x.textContent || ''));
      b && b.click();
    });
    // založení mapy + 7× POST /rules/save proběhne sekvenčně — počkat na editor
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    await sleep(2500);

    console.log('== pravidla DOOPRAVDY vznikla a míří na reálné uzly mapy ==');
    const maps = (await api('GET', '/api/collections/goalmaps/records?perPage=50', { token: SEF })).json.items || [];
    const mapa = maps.find((x) => x.title === 'Reklamační kanban');
    ok(!!mapa, 'projekt „Reklamační kanban" existuje');
    const rules = (await api('GET', `/api/kb/rules?map=${mapa.id}`, { token: SEF })).json.rules || [];
    ok(rules.length === 7, `mapa má 7 pravidel (${rules.length})`);
    const idSet = new Set((mapa.nodes || []).map((n) => n.id));
    ok(rules.every((r) => r.conditions.every((c) => c.field !== 'parent' || idSet.has(c.value))
      && r.actions.every((a) => a.type !== 'move_node' || idSet.has(a.to))), 'odkazy pravidel remapnuté na id TÉTO mapy');
    ok(rules.every((r) => r.enabled), 'pravidla jsou zapnutá');
    ok(rules.some((r) => /Kanban: D1 – Sestavení týmu → D2/.test(r.name)), 'název pravidla nese názvy sloupců (CZ)');

    console.log('== mapa ze šablony jede rovnou v kanban režimu; přehled ukazuje pravidla ==');
    ok(await page.evaluate(() => {
      const b = document.querySelector('[data-testid="toolbar-kanban-mode"]');
      return !!b && /Kanban/.test(b.textContent || '');
    }), 'lišta ukazuje indikátor „Kanban" místo Zarovnat');
    await page.evaluate(() => document.querySelector('[data-testid="toolbar-rules"]')?.click());
    await sleep(1000);
    ok(await page.evaluate(() => document.querySelectorAll('[data-testid="rule-row"]').length === 7),
      'přehled ⚡ ukazuje 7 pravidel');
    await page.keyboard.press('Escape');
    await sleep(600);

    console.log('== kanban ze šablony FUNGUJE: karta pod D1 → done → pod D2 + Založeno ==');
    const d1 = (mapa.nodes || []).find((n) => String((n.data || {}).title || '').startsWith('D1'));
    const d2 = (mapa.nodes || []).find((n) => String((n.data || {}).title || '').startsWith('D2'));
    const f = (await api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: SEF })).json;
    const r = await api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, { token: SEF, body: {
      nodes: f.nodes.concat([{ id: 'karta1', type: 'goalNode', position: { x: (d1.position || {}).x || 0, y: ((d1.position || {}).y || 0) + 320 }, data: { title: 'Reklamace1', status: 'todo' } }]),
      edges: f.edges.concat([{ id: 'ek1', source: d1.id, target: 'karta1' }]),
      base_updated: f.updated,
    } });
    ok(r.status === 200, `karta pod D1 založena (${r.status})`);
    await page.goto(`${BASE}/map/${mapa.id}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    await sleep(1500);
    const cyklus = async () => page.evaluate(() => {
      const uzel = [...document.querySelectorAll('.react-flow__node')].find((n) => (n.textContent || '').includes('Reklamace1'));
      const b = uzel && uzel.querySelector('button');
      b && b.click();
      return !!b;
    });
    ok(await cyklus(), 'odznak stavu karty jde kliknout'); await sleep(1200); // → in_progress
    await cyklus(); await sleep(3000); // → done → pravidlo šablony přesune
    const po = (await api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: SEF })).json;
    const rodic = (po.edges.find((e) => e.target === 'karta1') || {}).source;
    const k1 = po.nodes.find((n) => n.id === 'karta1');
    ok(rodic === d2.id, `karta je po Hotovo pod D2 (${rodic === d2.id ? 'ano' : rodic})`);
    ok(k1?.data.status === 'todo', 'stav se vrátil na Založeno');

    console.log('== galerie Šablony (Richardova cesta „nic to nedělá"): sekce Kanban → náhled → Použít šablonu → pravidla JSOU ==');
    await page.goto(`${BASE}/?view=templates`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Kanban'), { timeout: 45000 });
    ok(true, 'galerie má vlastní sekci (chip) Kanban');
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Kanban');
      chip && chip.click();
    });
    await sleep(600);
    const kartyVSekci = await page.evaluate(() => [...document.querySelectorAll('button')]
      .filter((b) => /Otevřít šablonu/.test(b.textContent || '')).length);
    ok(kartyVSekci === 2, `sekce Kanban ukazuje právě 2 šablony (${kartyVSekci})`);
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('div')].find((d) => d.className.includes('rounded-xl') && (d.textContent || '').includes('8D report — kanban'));
      const b = card && [...card.querySelectorAll('button')].find((x) => /Otevřít šablonu/.test(x.textContent || ''));
      b && b.click();
    });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Použít šablonu/.test(b.textContent || '')), { timeout: 15000 });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Použít šablonu/.test(x.textContent || ''));
      b && b.click();
    });
    // založení mapy + POSTy pravidel — počkat, až zmizí banner náhledu
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /Použít šablonu/.test(b.textContent || '')), { timeout: 45000 });
    await sleep(2500);
    const maps2 = (await api('GET', '/api/collections/goalmaps/records?perPage=50&sort=-created', { token: SEF })).json.items || [];
    const zGalerie = maps2.find((x) => x.title === '8D report — kanban');
    ok(!!zGalerie, 'projekt z galerie existuje');
    const rulesG = (await api('GET', `/api/kb/rules?map=${zGalerie.id}`, { token: SEF })).json.rules || [];
    ok(rulesG.length === 7, `mapa z galerie MÁ 7 pravidel — „nic to nedělá" opraveno (${rulesG.length})`);
    // kanban DESKA: 8 sloupců v JEDNÉ řadě (stejné y), žádné dvouřadé balení
    const sloupceY = [...new Set((zGalerie.nodes || [])
      .filter((n) => /^D\d/.test(String((n.data || {}).title || '')))
      .map((n) => Math.round(n.position.y)))];
    ok(sloupceY.length === 1, `sloupce D1–D8 jsou v jedné řadě (${sloupceY.length} úrovní y)`);

    console.log('== náhled šablony je DEMO: co v něm nakliknu, se do projektu NEPŘENESE ==');
    // Richardova cesta 17. 8.: v náhledu si přepnul kartu na Hotovo, aby vyzkoušel
    // kanban. Mapa ale ještě neexistovala, takže se karta narodila hotová a žádné
    // pravidlo ji nikdy neposunulo (0 běhů). Projekt proto vzniká VŽDY z čisté
    // šablony — jen název si uživatel ponechá.
    await page.goto(`${BASE}/?view=templates`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Kanban'), { timeout: 45000 });
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Kanban');
      chip && chip.click();
    });
    await sleep(600);
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('div')].find((d) => d.className.includes('rounded-xl') && (d.textContent || '').includes('8D report — kanban'));
      const b = card && [...card.querySelectorAll('button')].find((x) => /Otevřít šablonu/.test(x.textContent || ''));
      b && b.click();
    });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    await sleep(1500);
    ok(/neukládá se/.test(await page.evaluate(() => document.body.innerText)),
      'lišta náhledu říká, že se NEUKLÁDÁ (ne „neuloženo")');
    // v náhledu přepnout kartu D1 na Hotovo — přesně to, co vadu vyrábělo
    const cyklusNahled = async () => page.evaluate(() => {
      const uzel = [...document.querySelectorAll('.react-flow__node')].find((n) => (n.textContent || '').includes('D1 – Sestavení týmu'));
      const b = uzel && uzel.querySelector('button');
      if (b) b.click();
      return !!b;
    });
    ok(await cyklusNahled(), 'v náhledu jde klikat (demo se nezamyká — záměr)');
    await sleep(700); await cyklusNahled(); await sleep(900);
    // POZITIVNÍ tvrzení: karta v náhledu OPRAVDU stojí na Hotovo. Bez něj by
    // „projekt vznikl čistý" dokazovala jen mutace na starém obrazu — kdyby se
    // někdy rozbilo samotné přepínání stavu, sada by zezelenala z nesprávného
    // důvodu (nic se nepřeplo → nic se nepřeneslo).
    const stavD1Nahled = await page.evaluate(() => {
      const uzel = [...document.querySelectorAll('.react-flow__node')].find((n) => (n.textContent || '').includes('D1 – Sestavení týmu'));
      return uzel ? (uzel.querySelector('button')?.textContent || '').trim() : '(uzel nenalezen)';
    });
    ok(/Hotovo/.test(stavD1Nahled), `v náhledu je karta D1 přepnutá na Hotovo (${stavD1Nahled})`);
    // ...a přejmenovat, protože NÁZEV je jediné, co si uživatel ponechá.
    //
    // ⚠️ Od 18. 8. 2026 je název v klidu TEXT a pole se otevře až klikem (dřív to
    // bylo široké průhledné pole přes plátno, které polykalo myš). Sada proto
    // dělá SKUTEČNÉ gesto — klikne a píše. Původní syntetický zápis do `input`
    // by dnes tiše neudělal nic (pole neexistuje) a navíc obcházel `readOnly`,
    // takže by prošel i tehdy, kdyby přejmenování člověku vůbec nešlo.
    const otevrenoKPrejmenovani = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('8D report'));
      if (!b) return false;
      b.click();
      return true;
    });
    ok(otevrenoKPrejmenovani, 'klik na název v náhledu otevřel přejmenování');
    await sleep(500);
    const lzePsat = await page.evaluate(() => {
      const i = [...document.querySelectorAll('input')].find((x) => (x.value || '').includes('8D report'));
      if (!i || i.readOnly) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, 'Reklamace 12');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    ok(lzePsat, 'název v náhledu jde doopravdy přepsat (pole není jen na oko)');
    await sleep(600);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Použít šablonu/.test(x.textContent || ''));
      b && b.click();
    });
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /Použít šablonu/.test(b.textContent || '')), { timeout: 45000 });
    await sleep(3000);
    const vsechny = (await api('GET', '/api/collections/goalmaps/records?perPage=50&sort=-created', { token: SEF })).json.items || [];
    // hledat PODLE NÁZVU, ne vsechny[0]: při selhání zakládání by „nejnovější
    // mapa" byla cizí záznam a test by spadl na TypeError místo čitelného ❌
    const novy = vsechny.find((m) => m.title === 'Reklamace 12');
    ok(!!novy, `název z náhledu si uživatel ponechal — projekt „Reklamace 12" existuje (${novy ? 'ano' : 'nejnovější je ' + ((vsechny[0] || {}).title || '—')})`);
    if (!novy) throw new Error('projekt z náhledu nevznikl — další tvrzení nemají co měřit');
    const hotoveVNovem = (novy.nodes || []).filter((n) => (n.data || {}).status === 'done');
    ok(hotoveVNovem.length === 0,
      `projekt vznikl ČISTÝ — žádná karta se nenarodila hotová (${hotoveVNovem.map((n) => n.data.title).join(', ') || 'žádná'})`);
    ok((novy.nodes || []).length === (zGalerie.nodes || []).length,
      `stejná struktura jako vzorová šablona (${(novy.nodes || []).length} vs ${(zGalerie.nodes || []).length} uzlů)`);
    const rulesNovy = (await api('GET', `/api/kb/rules?map=${novy.id}`, { token: SEF })).json.rules || [];
    ok(rulesNovy.length === 7, `a pravidla se založila (${rulesNovy.length})`);
    // A teď to hlavní: v PROJEKTU už kanban jede. ⚠️ Karta se musí přidat POD
    // sloupec — pravidlo má podmínku `parent = D1`, takže přepnutí samotného
    // sloupce nic nespustí (na tohle jsem si sám naběhl: falešně rudý test).
    const d1Novy = (novy.nodes || []).find((n) => /D1 – Sestavení týmu/.test((n.data || {}).title || ''));
    const sKartou = {
      nodes: [...novy.nodes, { id: 'karta-e2e', type: 'goalNode', position: { x: d1Novy.position.x, y: d1Novy.position.y + 200 },
        data: { title: 'Reklamace v projektu', status: 'todo' } }],
      edges: [...novy.edges, { id: 'e-karta-e2e', source: d1Novy.id, target: 'karta-e2e' }],
    };
    await api('PATCH', `/api/collections/goalmaps/records/${novy.id}`, { token: SEF, body: sKartou });
    await sleep(800);
    const cerstva = (await api('GET', `/api/collections/goalmaps/records/${novy.id}`, { token: SEF })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${novy.id}`, { token: SEF, body: {
      nodes: cerstva.nodes.map((n) => (n.id === 'karta-e2e' ? { ...n, data: { ...n.data, status: 'done' } } : n)),
      edges: cerstva.edges, base_updated: cerstva.updated,
    } });
    await sleep(2000);
    const poPosunu = (await api('GET', `/api/collections/goalmaps/records/${novy.id}`, { token: SEF })).json;
    const rodicKarty = (poPosunu.edges || []).find((e) => e.target === 'karta-e2e');
    const d2Novy = (poPosunu.nodes || []).find((n) => /D2 – Popis problému/.test((n.data || {}).title || ''));
    ok(rodicKarty && d2Novy && rodicKarty.source === d2Novy.id,
      'v projektu už kanban jede — karta pod D1 po Hotovo odjela do D2');

    console.log('== projekt z náhledu se NASDÍLÍ lidem přiřazeným v šabloně (parita s dialogem) ==');
    // Richard 17. 8.: obě cesty šablona→projekt mají sdílet stejně. Cesta z náhledu
    // dřív shared_with neposílala vůbec — přiřazený kolega se k projektu nedostal
    // a nepřišla mu notifikace. Vlastní šablona s přiřazenou osobou je na to
    // jediná poctivá zkouška: systémové kanbanové šablony osoby NEMAJÍ.
    await api('POST', '/api/collections/users/records', { body: { email: 'kolega@example.com', password: PW, passwordConfirm: PW } });
    await api('POST', '/api/collections/templates/records', { token: SEF, body: {
      title: 'Nábor s kolegou', node_type: 'mise', visibility: 'personal',
      ai_nodes: [
        { id: 'k1', title: 'Nábor', parentId: null },
        { id: 'k2', title: 'Pohovory', parentId: 'k1', owner: 'kolega@example.com' },
      ],
    } });
    await page.goto(`${BASE}/?view=templates`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Nábor s kolegou'), { timeout: 45000 });
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('div')].find((d) => d.className.includes('rounded-xl') && (d.textContent || '').includes('Nábor s kolegou'));
      const b = card && [...card.querySelectorAll('button')].find((x) => /Otevřít šablonu/.test(x.textContent || ''));
      b && b.click();
    });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    await sleep(1500);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Použít šablonu/.test(x.textContent || ''));
      b && b.click();
    });
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /Použít šablonu/.test(b.textContent || '')), { timeout: 45000 });
    await sleep(2500);
    const poNaboru = (await api('GET', '/api/collections/goalmaps/records?perPage=50&sort=-created', { token: SEF })).json.items || [];
    const nabor = poNaboru.find((m) => m.title === 'Nábor s kolegou');
    ok(!!nabor, `projekt z vlastní šablony vznikl (${nabor ? 'ano' : 'ne'})`);
    ok(nabor && (nabor.shared_with_edit || []).includes('kolega@example.com'),
      `přiřazený kolega má na projekt edit (${JSON.stringify((nabor || {}).shared_with_edit || [])})`);
    ok(nabor && (nabor.shared_with || []).includes('kolega@example.com'),
      `a je i ve sdílení (${JSON.stringify((nabor || {}).shared_with || [])})`);

    console.log('== nezaložená pravidla se PŘIZNAJÍ (projekt bez pravidel = mrtvý kanban) ==');
    // Šablona se dvěma pravidly, z toho jedno míří na neexistující uzel → server
    // ho odmítne. Projekt vznikne (mapa už existuje, to je záměr), ale hláška to
    // NESMÍ zamlčet. ⚠️ Text žije v líném ns `rules` a UVNITŘ objektu `rules`
    // (klíč je tedy `rules:rules.templateRulesFailed`) — obojí jsem si při psaní
    // spletl a v toastu se ukázal holý klíč. Proto se to tady čte z obrazovky.
    await api('POST', '/api/collections/templates/records', { token: SEF, body: {
      title: 'Vadná pravidla', node_type: 'mise', visibility: 'personal',
      ai_nodes: [
        { id: 'a1', title: 'Kořen', parentId: null },
        { id: 'a2', title: 'Krok 1', parentId: 'a1' },
        { id: 'a3', title: 'Krok 2', parentId: 'a1' },
      ],
      rules: [
        { id: 'r1', name: 'Platné: Krok 1 → Krok 2', trigger: { type: 'node_status_changed', status: 'done' },
          conditions: [{ field: 'parent', op: 'eq', value: 'a1' }], actions: [{ type: 'move_node', to: 'a3' }] },
        { id: 'r2', name: 'Vadné: cíl neexistuje', trigger: { type: 'node_status_changed', status: 'done' },
          conditions: [], actions: [{ type: 'move_node', to: 'uzel-ktery-neexistuje' }] },
      ],
    } });
    await page.goto(`${BASE}/?view=templates`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Vadná pravidla'), { timeout: 45000 });
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('div')].find((d) => d.className.includes('rounded-xl') && (d.textContent || '').includes('Vadná pravidla'));
      const b = card && [...card.querySelectorAll('button')].find((x) => /Otevřít šablonu/.test(x.textContent || ''));
      b && b.click();
    });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    await sleep(1500);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Použít šablonu/.test(x.textContent || ''));
      b && b.click();
    });
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /Použít šablonu/.test(b.textContent || '')), { timeout: 45000 });
    await sleep(2500);
    // Odmítnuté pravidlo je ZÁMĚR téhle scény, takže server vrátí 400 a prohlížeč
    // si ho zapíše do konzole. Odebrat je z `errs` ADRESNĚ (jen 400) a rovnou
    // ověřit, že tam opravdu byly — paušální umlčení konzole by zakrylo i cizí
    // chyby a ze závěrečného tvrzení by udělalo vždy-zelené.
    const ctyristovky = errs.filter((e) => /400/.test(e));
    ok(ctyristovky.length > 0, `server vadné pravidlo ODMÍTL (${ctyristovky.length}× 400, čekáno)`);
    for (const e of ctyristovky) errs.splice(errs.indexOf(e), 1);
    const toastVadne = await page.evaluate(() => document.body.innerText.replace(/\n/g, ' | '));
    ok(/nepodařilo založit/.test(toastVadne),
      `hláška přiznala nezaložené pravidlo (${(toastVadne.match(/Projekt vznikl[^|]*/) || ['— nic takového v textu'])[0].trim().slice(0, 90)})`);
    ok(!/templateRulesFailed/.test(toastVadne), 'a je to PŘELOŽENÝ text, ne holý klíč');
    const mapyVadne = (await api('GET', '/api/collections/goalmaps/records?perPage=50&sort=-created', { token: SEF })).json.items || [];
    const vadnyProjekt = mapyVadne.find((m) => m.title === 'Vadná pravidla');
    const pravidlaVadne = vadnyProjekt ? ((await api('GET', `/api/kb/rules?map=${vadnyProjekt.id}`, { token: SEF })).json.rules || []) : [];
    ok(!!vadnyProjekt && pravidlaVadne.length === 1,
      `projekt přesto vznikl a platné pravidlo se založilo (${pravidlaVadne.length} ze 2)`);

    console.log('== export/import PROKLIKEM: soubor z REÁLNÉ buildMapExport → dialog Importovat → souhrn s počty ==');
    // export skládá skutečná FE funkce (jako tlačítko v editoru), soubor se
    // nahraje přes dialog; navíc 1 vadné pravidlo → musí se ukázat i jantarová
    // řádka o přeskočení
    const mp = await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/mapPortable.js')).href);
    const rulesExp = (await api('GET', `/api/kb/rules?map=${zGalerie.id}`, { token: SEF })).json.rules || [];
    const exportObj = mp.buildMapExport({
      map: { title: 'Import proklikem', description: '' },
      nodes: zGalerie.nodes, edges: zGalerie.edges, tasks: [],
      rules: rulesExp.concat([{ name: 'Vadné', trigger: { type: 'node_status_changed' }, actions: [{ type: 'move_node', to: 'neexistuje' }] }]),
      includePeople: true, exportedBy: 'sef@example.com',
    });
    const soubor = path.join(os.tmpdir(), 'kb-ui-import-test.kb.json');
    fs.writeFileSync(soubor, JSON.stringify(exportObj));
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Nový projekt/.test(b.textContent || '')), { timeout: 45000 });
    // šipka vedle Nový projekt → Radix menu → Importovat (vše skutečnou myší)
    const sipka = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Nový projekt/.test(x.textContent || ''));
      const arrow = b && b.parentElement.querySelector('button[aria-label]');
      if (!arrow) return null;
      const r = arrow.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    ok(!!sipka, 'šipka nabídky vedle Nový projekt');
    await page.mouse.click(sipka.x, sipka.y);
    await page.waitForFunction(() => [...document.querySelectorAll('[role="menuitem"]')].some((m) => /Importovat/.test(m.textContent || '')), { timeout: 15000 });
    const polozka = await page.evaluate(() => {
      const m = [...document.querySelectorAll('[role="menuitem"]')].find((x) => /Importovat/.test(x.textContent || ''));
      const r = m.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(polozka.x, polozka.y);
    await page.waitForSelector('input[type="file"]', { timeout: 15000 });
    const vstup = await page.$('input[type="file"]');
    await vstup.uploadFile(soubor);
    await page.waitForFunction(() => /pravidel automatizace|pravidlo automatizace/.test(document.body.innerText || ''), { timeout: 30000 });
    const souhrn = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || '');
    ok(/Naimportován[oa]? 7 pravidel automatizace/.test(souhrn), `souhrn ukazuje 7 importovaných pravidel (${(souhrn.match(/Naimportov[^\n]*/) || [''])[0]})`);
    ok(/1 pravidlo jsme přeskočili/.test(souhrn), 'jantarová řádka přiznává 1 přeskočené pravidlo');
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Otevřít projekt/.test(x.textContent || ''));
      b && b.click();
    });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    const maps3 = (await api('GET', '/api/collections/goalmaps/records?perPage=50&sort=-created', { token: SEF })).json.items || [];
    const importovana = maps3.find((x) => x.title === 'Import proklikem');
    const rulesImp = (await api('GET', `/api/kb/rules?map=${importovana.id}`, { token: SEF })).json.rules || [];
    ok(rulesImp.length === 7, `importovaná mapa má 7 pravidel (${rulesImp.length})`);
    fs.unlinkSync(soubor);

    ok(errs.length === 0, `konzole bez chyb (${errs.length}${errs.length ? ': ' + errs[0].slice(0, 120) : ''})`);
  } catch (err) {
    console.error('SADA SPADLA:', err);
    fail++;
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} UI-SABLONY-KANBAN PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
