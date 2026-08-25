// Sjednocený AI dialog: záložky, mobil, krátký text → otázky, přenos polí, scope.
//
// Richardův nález 7. 8. (druhé kolo): tři vstupní body AI zakládání se chovaly
// každý jinak. Po sjednocení hlídáme:
//  1) „S pomocí AI" otevře JEDEN dialog se záložkami Navrhnout s AI / Mapa z textu.
//  2) Odkaz v dialogu Nový projekt NEZAHODÍ vyplněný cíl a barvu — cíl se
//     předvyplní, mapa má po přijetí color v DB.
//  3) Krátký text (<100 znaků) v „Z textu" se přepne na otázky (z holého
//     názvu vznikaly vymyšlené mapy — „Prodej parku v Rohlíku") a NESE scope.
//  4) Na mobilu (<768 px) je AI dostupná z nabídky děleného tlačítka.
//  5) Lokální ollama provider RESPEKTUJE Rozsah mapy u from_text (hloubková
//     → 19 uzlů v promptu; dřív natvrdo 12) — mutačně červené na starém kódu.
//
// AI se mockuje: kontejner A provider=api (→ /v1/advisor), kontejner B
// provider=ollama (→ /api/chat); mock si zapisuje těla požadavků.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const http = require('http');

const NAME = 'flowmap-e2e-ai-dialog';
const IMAGE = process.env.KB_TEST_IMAGE || 'product-flowmap';
const PORT = 20551;        // kontejner A: provider=api
const PORT_OLLAMA = 20552; // kontejner B: provider=ollama
const MOCK_PORT = 20553;
const BASE = `http://127.0.0.1:${PORT}`;
const BASE_OLLAMA = `http://127.0.0.1:${PORT_OLLAMA}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (base, method, path, { token, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};

// skutečný myší klik podle textu (vzor ui-ai-mapa.js) — Radix chce pointer eventy.
// Porovnává se i první řádek (tlačítka rozsahu mají label + popisek pod sebou).
const clickText = async (page, text, sel = 'button, [role="menuitem"], [role="tab"], span, a') => {
  for (const h of await page.$$(sel)) {
    const t = await h.evaluate((el) => (el.innerText || el.textContent || '').trim());
    if (t === text || t.split('\n')[0].trim() === text) {
      try { await h.click(); return true; } catch { /* mimo viewport apod. */ }
    }
  }
  return false;
};

const NODES = [
  { id: 'r', title: 'Prodej parku', description: 'hlavní cíl' },
  { id: 'a', parentId: 'r', title: 'Ocenění parku' },
  { id: 'b', parentId: 'r', title: 'Najít kupce' },
  { id: 'c', parentId: 'r', title: 'Uzavřít smlouvu' },
];

(async () => {
  let browser; let mock;
  const advisorCalls = [];  // těla požadavků na /v1/advisor (provider api)
  const ollamaCalls = [];   // těla požadavků na /api/chat (provider ollama)
  try {
    mock = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (ch) => { raw += ch; });
      req.on('end', () => {
        let body = {}; try { body = JSON.parse(raw); } catch { /* nevalidní */ }
        res.setHeader('Content-Type', 'application/json');
        if (req.url.includes('/api/tags')) {
          // health proba provideru ollama — bez ní by UI AI schovalo
          res.end(JSON.stringify({ models: [{ name: 'gpt-oss:20b' }] }));
          return;
        }
        if (req.url.includes('/api/chat')) {
          // mock ollamy: vrací kontrakt {message:{content:...}}; zapisuje prompt
          ollamaCalls.push(body);
          res.end(JSON.stringify({ message: { content: JSON.stringify({ nodes: NODES }) } }));
          return;
        }
        advisorCalls.push(body);
        if (body.mode === 'questions') {
          res.end(JSON.stringify({ schema_version: 1, questions: ['Kdo je kupec?', 'Jaký je termín?', 'Jaká je cena?'] }));
        } else if (body.mode === 'generate' || body.mode === 'from_text') {
          res.end(JSON.stringify({ schema_version: 1, nodes: NODES }));
        } else {
          res.end(JSON.stringify({ schema_version: 1, nodes: [] }));
        }
      });
    });
    // bind jen na docker bridge — kontejnery na něj dosáhnou, LAN ne
    await new Promise((r) => mock.listen(MOCK_PORT, '172.17.0.1', r));

    execSync(`docker rm -f ${NAME} ${NAME}-ollama 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p ${PORT}:8090 ` +
             `-e FLOWMAP_AI_PROVIDER=api -e FLOWMAP_AI_URL=http://172.17.0.1:${MOCK_PORT}/v1/advisor ` +
             `-e FLOWMAP_AI_TOKEN=fm_test -e KB_UVODNI_MAPA=0 ${IMAGE}`, { stdio: 'ignore' });
    execSync(`docker run -d --name ${NAME}-ollama -e KB_PURPOSE_ASK=0 -p ${PORT_OLLAMA}:8090 ` +
             `-e FLOWMAP_AI_PROVIDER=ollama -e FLOWMAP_AI_URL=http://172.17.0.1:${MOCK_PORT} ` +
             `-e KB_UVODNI_MAPA=0 ${IMAGE}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE_OLLAMA}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api(BASE, 'POST', '/api/collections/users/records', { body: { email: 'admin@example.com', password: PW, passwordConfirm: PW } });
    const auth = await api(BASE, 'POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@example.com', password: PW } });
    const token = auth.json.token;
    // ať Home nerenderuje uvítací stav bez lišty
    await api(BASE, 'POST', '/api/collections/goalmaps/records', {
      token, body: { title: 'Projekt', nodes: [{ id: 'root', type: 'apex', position: { x: 0, y: 0 }, data: { apexText: 'Cíl' } }], edges: [] },
    });

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.evaluateOnNewDocument((tk) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} }));
    }, token);

    // ---------- 1) jeden dialog se záložkami ----------
    console.log('— „S pomocí AI" = jeden dialog se záložkami —');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    expect(await clickText(page, 'S pomocí AI'), 'lišta má tlačítko „S pomocí AI"');
    await sleep(600);
    const dlgText = await page.evaluate(() => document.body.innerText || '');
    expect(dlgText.includes('Vytvořit projekt s AI'), 'dialog má titulek „Vytvořit projekt s AI"');
    expect(dlgText.includes('Navrhnout s AI') && dlgText.includes('Mapa z textu'), 'dialog má OBĚ záložky');
    expect(dlgText.includes('Text (popis projektu)'), 'výchozí záložka je „Z cíle" (pole popisu)');
    await page.keyboard.press('Escape');
    await sleep(400);

    // ---------- 2) Nový projekt → odkaz na AI přenese cíl i barvu ----------
    console.log('— Přenos cíle a barvy z dialogu Nový projekt —');
    expect(await clickText(page, 'Nový projekt'), 'kliknuto na „Nový projekt"');
    await sleep(600);
    await page.type('#project-name', 'Prodej parku v Rohlíku');
    // modrá tečka z ProjectColorPickeru (#3b82f6)
    const colorClicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => b.style.backgroundColor === 'rgb(59, 130, 246)');
      if (btn) { btn.click(); return true; }
      return false;
    });
    expect(colorClicked, 'vybrána modrá barva projektu');
    expect(await clickText(page, 'Nebo nechte projekt navrhnout s AI…'), 'odkaz na AI v dialogu existuje');
    await sleep(600);
    const goalValue = await page.$eval('textarea', (el) => el.value);
    expect(goalValue === 'Prodej parku v Rohlíku', `cíl je předvyplněný (má „${goalValue}")`);
    expect(await clickText(page, 'Spustit AI'), 'kliknuto na „Spustit AI"');
    await sleep(1200);
    const qText = await page.evaluate(() => document.body.innerText || '');
    expect(qText.includes('Kdo je kupec?'), 'AI položila upřesňující otázky');
    for (const h of await page.$$('input[placeholder="Nebo napište vlastní odpověď..."]')) {
      await h.type('odpověď');
    }
    expect(await clickText(page, 'Generovat cíle'), 'kliknuto na „Generovat cíle"');
    await sleep(1200);
    expect(await clickText(page, 'Přijmout'), 'náhled jde přijmout');
    for (let i = 0; i < 30 && !page.url().includes('/map/'); i++) await sleep(300);
    expect(page.url().includes('/map/'), 'po přijetí jsme v editoru');
    const maps = (await api(BASE, 'GET', '/api/collections/goalmaps/records?perPage=50', { token })).json;
    const mapa = (maps.items || []).find((m) => m.title === 'Prodej parku v Rohlíku');
    expect(!!mapa, 'projekt „Prodej parku v Rohlíku" je v DB');
    expect(!!mapa && mapa.color === '#3b82f6', `barva z dialogu se přenesla (má „${mapa && mapa.color}")`);
    expect(!!mapa && (mapa.nodes || []).length === 4, `mapa má 4 uzly (má ${mapa && (mapa.nodes || []).length})`);

    // ---------- 3) krátký text → otázky, scope se nese ----------
    console.log('— Krátký text v „Z textu" se přepne na otázky —');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    await clickText(page, 'S pomocí AI');
    await sleep(600);
    expect(await clickText(page, 'Mapa z textu'), 'přepnuto na záložku „Mapa z textu"');
    await sleep(600);
    expect(await clickText(page, 'Hloubková'), 'vybrán rozsah „Hloubková"');
    await page.type('textarea', 'Prodej chaty u lesa');
    advisorCalls.length = 0;
    expect(await clickText(page, 'Vytvořit mapu'), 'kliknuto na „Vytvořit mapu"');
    await sleep(1200);
    const shortText = await page.evaluate(() => document.body.innerText || '');
    expect(shortText.includes('Text je krátký'), 'uživatel vidí hlášku o přepnutí na otázky');
    expect(shortText.includes('Kdo je kupec?'), 'místo generování rovnou přišly otázky');
    const qCall = advisorCalls.find((c) => c.mode === 'questions');
    expect(!!qCall, 'na bránu šel mode=questions (žádný from_text z pár slov)');
    expect(!!qCall && qCall.scope === 'hloubková', `scope „hloubková" se přenesl do otázek (má „${qCall && qCall.scope}")`);
    expect(!advisorCalls.some((c) => c.mode === 'from_text'), 'from_text se u krátkého textu NEvolal');

    // autoStart je one-shot: přepnutí záložek tam a zpět NESMÍ znovu odpálit
    // AI dotaz (nález checkupu — dřív každý návrat na „Z cíle" volal questions)
    await clickText(page, 'Mapa z textu');
    await sleep(500);
    await clickText(page, 'Navrhnout s AI');
    await sleep(1000);
    const qPocet = advisorCalls.filter((c) => c.mode === 'questions').length;
    expect(qPocet === 1, `přepnutí záložek tam a zpět NEvolá otázky znovu (volání: ${qPocet})`);
    const goalPoNavratu = await page.$eval('textarea', (el) => el.value);
    expect(goalPoNavratu === 'Prodej chaty u lesa', 'po návratu je cíl předvyplněný krátkým textem a jde upravit');

    // ---------- 4) dlouhý text jde dál rovnou na from_text (se scope) ----------
    console.log('— Dlouhý text jde rovnou, from_text nese scope —');
    await page.keyboard.press('Escape');
    await sleep(400);
    await clickText(page, 'S pomocí AI');
    await sleep(600);
    await clickText(page, 'Mapa z textu');
    await sleep(600);
    await clickText(page, 'Hloubková');
    await page.type('textarea', 'Chceme prodat městský park v Rohlíku včetně pozemků a mobiliáře. '
      + 'Je potřeba ocenění, právní prověrka, vyhlášení záměru, výběr kupce a schválení zastupitelstvem.');
    advisorCalls.length = 0;
    await clickText(page, 'Vytvořit mapu');
    for (let i = 0; i < 30 && !page.url().includes('/map/'); i++) await sleep(300);
    const ftCall = advisorCalls.find((c) => c.mode === 'from_text');
    expect(!!ftCall, 'dlouhý text šel na mode=from_text');
    expect(!!ftCall && ftCall.scope === 'hloubková', `from_text nese scope „hloubková" (má „${ftCall && ftCall.scope}")`);

    // ---------- 5) mobil: AI v nabídce děleného tlačítka ----------
    console.log('— Mobil: AI dostupná z nabídky u „Nový projekt" —');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    // úzký displej sám naskočí do LITE (ta AI nemá ZÁMĚRNĚ) — Richardův mobilní
    // scénář je PLNÁ verze na telefonu, takže volbu přepneme jako uživatel
    await page.evaluate(() => localStorage.setItem('kb-mode', 'full'));
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    expect(!page.url().includes('/lite'), 'jsme v plné verzi (kb-mode=full)');
    const aiButtonVisible = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => (b.innerText || '').trim() === 'S pomocí AI');
      return !!btn && btn.offsetParent !== null;
    });
    expect(!aiButtonVisible, 'samostatné AI tlačítko je na mobilu schované (jak má být)');
    const chevronOk = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Další možnosti"]');
      if (!btn) return false;
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      btn.click();
      return true;
    });
    expect(chevronOk, 'nabídka děleného tlačítka jde otevřít');
    await sleep(600);
    expect(await clickText(page, 'S pomocí AI'), 'nabídka má položku „S pomocí AI"');
    await sleep(600);
    const mobText = await page.evaluate(() => document.body.innerText || '');
    expect(mobText.includes('Vytvořit projekt s AI'), 'AI dialog se na mobilu otevřel');

    // ---------- 6) ollama provider respektuje scope u from_text (mutační) ----------
    console.log('— Lokální model: Rozsah mapy u from_text FUNGUJE —');
    await api(BASE_OLLAMA, 'POST', '/api/collections/users/records', { body: { email: 'admin2@example.com', password: PW, passwordConfirm: PW } });
    const auth2 = await api(BASE_OLLAMA, 'POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin2@example.com', password: PW } });
    const token2 = auth2.json.token;
    const dlouhyText = 'Dlouhý zdrojový text pro prověření rozsahu mapy u lokálního modelu. '.repeat(3);
    for (const [scope, count] of [['hloubková', 19], ['stručná', 7]]) {
      ollamaCalls.length = 0;
      const r = await api(BASE_OLLAMA, 'POST', '/api/kb/advisor', {
        token: token2, body: { mode: 'from_text', text: dlouhyText, scope },
      });
      expect(r.status === 200 && Array.isArray(r.json?.nodes), `from_text přes ollamu odpověděl (${scope})`);
      const prompt = ((ollamaCalls[0] || {}).messages || []).map((m) => m.content).join('\n');
      expect(prompt.includes(`přibližně ${count} uzlů`),
        `prompt pro „${scope}" říká přibližně ${count} uzlů (dřív natvrdo 12)`);
    }

    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    console.error('NEČEKANÁ CHYBA SADY:', e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (mock) mock.close();
    execSync(`docker rm -f ${NAME} ${NAME}-ollama 2>/dev/null; true`);
  }
})();
