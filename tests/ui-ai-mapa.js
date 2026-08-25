// AI mapa end-to-end: přijetí náhledu NESMÍ nechat projekt v DB prázdný (task #17).
//
// Tři Richardovy nálezy z klik-testu 7. 8.:
//  1) „Mapa z textu" → projekt v DB s 0 uzly (obsah jel přes location.state
//     + debounced autosave editoru a při rychlém odchodu se ztratil).
//     Oprava: mapa se zakládá ROVNOU s obsahem → tady se hned po přijetí
//     náhledu odchází na Home a kontroluje DB.
//  2) AI mapa „na šířku" rozhozená: vodorovné (mobilní) pozice se ukládaly
//     jako kanonické svislé. Kontrola: pozice v DB jsou svislé (děti POD
//     rodičem) a otevření mapy na mobilu je nesmí přepsat.
//  3) Klik na oranžový odznak úkolů uzlu shodil aplikaci (zastíněná
//     překladová funkce `t` → TypeError → černá obrazovka). Kontrola: dialog
//     se otevře, ukáže úkol a v konzoli není TypeError.
//
// AI se mockuje: provider=api a FLOWMAP_AI_URL míří na místní HTTP server
// (vzor ui-ai-outage.js; 172.17.0.1 = docker bridge → host).
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const http = require('http');

const NAME = 'flowmap-e2e-ai-mapa';
const IMAGE = process.env.KB_TEST_IMAGE || 'product-flowmap'; // vlastní tag pro vývoj vedle jiných sessionů
// 20522 měly node-links a notify-budget (leaklý kontejner = matoucí červená)
const PORT = 20527;
const MOCK_PORT = 20533;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
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

// skutečný myší klik na element podle textu — Radix (dropdown) syntetický
// el.click() ignoruje, potřebuje pointer eventy (vzor ui-myday.js)
const clickText = async (page, text, sel = 'button, [role="menuitem"], span, a') => {
  for (const h of await page.$$(sel)) {
    const t = await h.evaluate((el) => (el.innerText || el.textContent || '').trim());
    if (t === text) {
      try { await h.click(); return true; } catch { /* mimo viewport apod. */ }
    }
  }
  return false;
};

(async () => {
  let browser; let mock;
  try {
    // mock AI brány: from_text vrací pevný náhled se 4 uzly (kontrakt n8n kb-advisor)
    mock = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (ch) => { raw += ch; });
      req.on('end', () => {
        let body = {}; try { body = JSON.parse(raw); } catch { /* nevalidní */ }
        res.setHeader('Content-Type', 'application/json');
        if (body.mode === 'from_text' && /CYKLUS/.test(body.text || '')) {
          // zlobivá AI: duplicitní id, vzájemný cyklus, self-parent
          res.end(JSON.stringify({
            schema_version: 1,
            nodes: [
              { id: 'x', title: 'Cyklus A', parentId: 'y' },
              { id: 'y', title: 'Cyklus B', parentId: 'x' },
              { id: 'y', title: 'Duplikát', parentId: 'x' },
              { id: 'z', title: 'Sám sobě rodičem', parentId: 'z' },
            ],
          }));
        } else if (body.mode === 'from_text' || body.mode === 'generate') {
          res.end(JSON.stringify({
            schema_version: 1,
            nodes: [
              { id: 'r', title: 'Koupit krám', description: 'hlavní cíl' },
              { id: 'a', parentId: 'r', title: 'Najít prostor' },
              { id: 'b', parentId: 'r', title: 'Zajistit financování' },
              { id: 'c', parentId: 'r', title: 'Otevřít' },
            ],
          }));
        } else {
          res.end(JSON.stringify({ schema_version: 1, nodes: [] }));
        }
      });
    });
    // bind jen na docker bridge — kontejner na něj dosáhne, LAN ne
    await new Promise((r) => mock.listen(MOCK_PORT, '172.17.0.1', r));

    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p ${PORT}:8090 ` +
             `-e FLOWMAP_AI_PROVIDER=api -e FLOWMAP_AI_URL=http://172.17.0.1:${MOCK_PORT}/v1/advisor ` +
             `-e FLOWMAP_AI_TOKEN=fm_test -e KB_UVODNI_MAPA=0 ${IMAGE}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: 'admin@example.com', password: PW, passwordConfirm: PW } });
    const auth = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@example.com', password: PW } });
    const token = auth.json.token;
    // ať Home nerenderuje uvítací stav bez lišty (gotcha z myday klik-testu)
    await api('POST', '/api/collections/goalmaps/records', {
      token, body: { title: 'Projekt', nodes: [{ id: 'root', type: 'apex', position: { x: 0, y: 0 }, data: { apexText: 'Cíl' } }], edges: [] },
    });

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    const chyby = [];
        // Chyby z GOOGLE FONTS nejsou vada aplikace. `index.css:1` tahá písma
    // z internetu a při bourání docker kontejnerů se požadavek utne — sada
    // pak padala na „konzole bez chyb" pokaždé jinde (nález 12. 8. 2026).
    // ⚠️ Vyloučen je JEN tenhle známý původce, ne „všechno cizí": jinak by
    // regrese přestala hlídat i chyby cloudové brány api.killbottleneck.com,
    // tedy zrovna to, na čem cloud stojí. Adresa NENÍ v textu hlášky, je
    // v m.location().url — starý filtr na 'favicon' proto nikdy nic nefiltroval.
    const cizihoPuvodu = (m) => {
      const u = (m.location() && m.location().url) || '';
      return /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u);
    };
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) chyby.push(m.text()); });
    page.on('pageerror', (e) => chyby.push(String(e)));

    await page.evaluateOnNewDocument((tk) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} }));
    }, token);

    // ---------- 1) Mapa z textu → obsah je v DB HNED, i při okamžitém odchodu ----------
    console.log('— Mapa z textu: obsah v DB hned po přijetí —');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    expect(await clickText(page, 'S pomocí AI'), 'lišta má tlačítko „S pomocí AI"');
    await sleep(400);
    expect(await clickText(page, 'Mapa z textu'), 'nabídka má „Mapa z textu"');
    await sleep(600);
    const ta = await page.$('textarea');
    expect(!!ta, 'dialog Mapa z textu je otevřený (textarea)');
    // text >100 znaků — kratší vstup se od sjednoceného dialogu ZÁMĚRNĚ
    // přepíná na otázky (to hlídá sada ui-ai-dialog.js), tady testujeme from_text
    await ta.type('Chci koupit krám na rohu a rozjet v něm obchod se smíšeným zbožím. '
      + 'Mám rozjednaný prostor, potřebuju financování, vybavení a otevírací plán na první měsíc.');
    expect(await clickText(page, 'Vytvořit mapu'), 'kliknuto na „Vytvořit mapu"');
    // počkat jen na přechod do editoru…
    for (let i = 0; i < 30 && !page.url().includes('/map/'); i++) await sleep(300);
    const mapUrl = page.url();
    expect(mapUrl.includes('/map/'), `po přijetí náhledu jsme v editoru (${mapUrl})`);
    // …a OKAMŽITĚ odejít na Home — dřív právě tohle nechalo projekt prázdný
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

    const maps = (await api('GET', '/api/collections/goalmaps/records?perPage=50', { token })).json;
    const aiMapa = (maps.items || []).find((m) => m.title === 'Koupit krám');
    expect(!!aiMapa, 'projekt „Koupit krám" v DB existuje');
    const nodes = aiMapa ? (aiMapa.nodes || []) : [];
    const edges = aiMapa ? (aiMapa.edges || []) : [];
    expect(nodes.length === 4, `projekt má v DB 4 uzly i po okamžitém odchodu (má ${nodes.length})`);
    expect(edges.length === 3, `projekt má v DB 3 hrany (má ${edges.length})`);
    const apex = nodes.find((n) => n.type === 'apexNode' || (n.data || {}).nodeType === 'apex');
    expect(!!apex, 'kořen je vrchol (apex)');
    expect(!!apex && (apex.data || {}).apexText === 'Koupit krám', 'vrchol nese text cíle');

    // ---------- 1b) server ořezává texty i při CREATE (dřív jen update) ----------
    console.log('— Trim délek při zakládání mapy —');
    const dlouhy = await api('POST', '/api/collections/goalmaps/records', {
      token, body: { title: 'Trim test', edges: [], nodes: [{
        id: 'n1', type: 'apexNode', position: { x: 0, y: 0 },
        data: { nodeType: 'apex', apexText: 'T', title: 'T'.repeat(600), description: 'D'.repeat(20000), status: 'todo' },
      }] },
    });
    const trimNode = ((dlouhy.json || {}).nodes || [])[0] || {};
    expect((trimNode.data?.title || '').length === 500, `title ořezán na 500 při create (má ${(trimNode.data?.title || '').length})`);
    expect((trimNode.data?.description || '').length === 10000, `description ořezán na 10000 při create (má ${(trimNode.data?.description || '').length})`);

    // ---------- 1c) zlobivá AI: duplicitní id / cyklus / self-parent ----------
    console.log('— Obrana proti vadnému náhledu z AI —');
    await sleep(1500); // Home po návratu dorenderovat
    expect(await clickText(page, 'S pomocí AI'), 'znovu: tlačítko „S pomocí AI"');
    await sleep(400);
    await clickText(page, 'Mapa z textu');
    await sleep(600);
    const ta2 = await page.$('textarea');
    await ta2.type('CYKLUS pokus o rozbití náhledu zlobivou odpovědí AI — duplicitní id, vzájemný cyklus '
      + 'a uzel, který je sám sobě rodičem. Text je schválně delší než sto znaků, ať jde cestou from_text.');
    await clickText(page, 'Vytvořit mapu');
    for (let i = 0; i < 30 && !page.url().includes('/map/'); i++) await sleep(300);
    const maps2 = (await api('GET', '/api/collections/goalmaps/records?perPage=50', { token })).json;
    const zla = (maps2.items || []).find((m) => (m.title || '').startsWith('CYKLUS'));
    expect(!!zla, 'mapa ze zlobivého náhledu vznikla');
    const zlaN = zla ? (zla.nodes || []) : [];
    const zlaE = zla ? (zla.edges || []) : [];
    expect(zlaN.length === 3, `duplicitní id zahozeno: 3 uzly ze 4 (má ${zlaN.length})`);
    expect(zlaE.every((e2) => e2.source !== e2.target), 'žádná hrana sám-na-sebe');
    const pozice = new Set(zlaN.map((n) => `${Math.round(n.position.x)},${Math.round(n.position.y)}`));
    expect(pozice.size === zlaN.length, `uzly nejsou přes sebe na 0,0 (${[...pozice].join(' | ')})`);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

    // ---------- 2) pozice v DB jsou KANONICKÉ SVISLÉ (děti POD rodičem) ----------
    console.log('— Kanonické svislé pozice —');
    const deti = nodes.filter((n) => n !== apex);
    expect(!!apex && deti.length > 0 && deti.every((n) => n.position.y > apex.position.y),
      'všechny děti jsou POD vrcholem (svislý kanonický layout)');
    const xs = deti.map((n) => Math.round(n.position.x));
    expect(deti.length > 0 && new Set(xs).size === deti.length,
      `sourozenci jsou vedle sebe, ne přes sebe (x: ${xs.join(', ') || 'žádní'})`);

    // otevření mapy na MOBILU (vodorovné view) nesmí kanonické pozice přepsat
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}/map/${aiMapa.id}`, { waitUntil: 'networkidle2' });
    await sleep(3500); // dost času, aby případný (chybný) autosave stihl doběhnout
    const poMobilu = (await api('GET', `/api/collections/goalmaps/records/${aiMapa.id}`, { token })).json;
    const apex2 = (poMobilu.nodes || []).find((n) => n.type === 'apexNode' || (n.data || {}).nodeType === 'apex');
    const deti2 = (poMobilu.nodes || []).filter((n) => n !== apex2);
    expect(!!apex2 && deti2.length > 0 && deti2.every((n) => n.position.y > apex2.position.y),
      'po otevření na mobilu jsou pozice v DB pořád svislé (vodorovné view je nepřepsalo)');

    // ---------- 3) odznak úkolů uzlu: dialog se otevře a NESPADNE (mobil, dark) ----------
    console.log('— Odznak úkolů uzlu (mobil, tmavý režim) —');
    const uzelSUkolem = deti2[0] || apex2;
    if (!uzelSUkolem) throw new Error('mapa nemá žádný uzel — část 3 nemá na čem testovat');
    // SLOVNÍK 17. 8. 2026: DETEKTOR — zbytkovou položku sází superuser; badge
    // 0/1 a dialog ji musí ukázat a nespadnout (uživatelský create je 403)
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    const uidMe = ((await api('GET', `/api/collections/users/records?filter=${encodeURIComponent("email='admin@example.com'")}`, { token: ST })).json.items || [])[0];
    await api('POST', '/api/collections/tasks/records', {
      token: ST, body: { title: 'UKOL-NA-UZLU', status: 'todo', map: aiMapa.id, node_id: uzelSUkolem.id, owner: uidMe && uidMe.id, owner_email: uidMe && uidMe.email },
    });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.goto(`${BASE}/map/${aiMapa.id}`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    chyby.length = 0; // zajímají nás jen chyby od teď (klik na odznak)
    const badgeOk = await clickText(page, '0/1');
    expect(badgeOk, 'odznak úkolů (0/1) je na uzlu vidět a jde kliknout');
    await sleep(1200);
    const dialogText = await page.evaluate(() => document.body.innerText || '');
    expect(dialogText.includes('UKOL-NA-UZLU'), 'dialog úkolů uzlu ukazuje úkol (žádná černá obrazovka)');
    const tErr = chyby.filter((c) => /is not a function|TypeError/i.test(c));
    expect(tErr.length === 0, `po kliku žádný TypeError v konzoli${tErr.length ? ` (${tErr[0].slice(0, 120)})` : ''}`);
    const zije = await page.evaluate(() => !!document.querySelector('#root') && document.querySelector('#root').childElementCount > 0);
    expect(zije, 'aplikace po kliku pořád žije (React strom stojí)');

    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    console.error('NEČEKANÁ CHYBA SADY:', e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (mock) mock.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
})();
