// Výpadek AI BĚHEM požadavku: klient to musí po limitu vzdát sám a omluvit se.
//
// Richardův nález z klik-testu 7. 8.: v cloudovém režimu může AI krátkodobě
// vypadnout (internet, GPU) — a uživatel u „Spustit AI" koukal na spinner bez
// konce (žádný klientský timeout; serverový strop 120 s končil matoucí hláškou
// „Zkontrolujte konfiguraci serveru"). Ostatní sady (ui-ai-outage) kryjí jen
// preventivní schování tlačítek podle ai_healthy — TENTO stav (AI zdravá při
// otevření dialogu, mrtvá během generování) nekryl nikdo.
//
// Mock: /v1/status odpovídá hned (jinak by UI tlačítka schovalo), POST
// /v1/advisor drží spojení otevřené a NIKDY neodpoví. Klientský limit se
// testovacím přepínačem localStorage kb_ai_timeout_ms stáhne z 90 s na 3 s.
//
// Mutačně:
//  · během čekání spinner JE (generování opravdu běželo)
//  · po limitu je vidět omluva „Omlouváme se, pracujeme na nápravě…"
//  · spinner zmizel a „Spustit AI" jde použít znovu (dialog nezůstal zamrzlý)
//  · mock za celou dobu NEodpověděl — čekání ukončil KLIENT, ne odpověď
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const http = require('http');

const NAME = 'kb-e2e-ai-timeout';
const IMAGE = process.env.KB_TEST_IMAGE || 'product-flowmap';
const PORT = 20555;
const MOCK_PORT = 20557;
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

const clickText = async (page, text, sel = 'button, [role="menuitem"], [role="tab"], span, a') => {
  for (const h of await page.$$(sel)) {
    const t = await h.evaluate((el) => (el.innerText || el.textContent || '').trim());
    if (t === text || t.split('\n')[0].trim() === text) {
      try { await h.click(); return true; } catch { /* mimo viewport apod. */ }
    }
  }
  return false;
};

(async () => {
  let browser; let mock;
  let advisorPozadavku = 0;   // kolik POSTů na advisor dorazilo
  const drzena = [];          // otevřené response objekty (zavře cleanup)
  try {
    mock = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (ch) => { raw += ch; });
      req.on('end', () => {
        if (req.method === 'GET' || req.url.includes('/v1/status')) {
          // health proba /api/kb/config — bez 200 by UI AI tlačítka schovalo
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ schema_version: 1, modes: ['questions', 'generate', 'from_text'] }));
          return;
        }
        // POST /v1/advisor: VÝPADEK = spojení visí, odpověď nikdy nepřijde
        advisorPozadavku++;
        drzena.push(res);
      });
    });
    mock.requestTimeout = 0;   // Node by jinak visící request sám zabil (default 300 s)
    mock.headersTimeout = 0;
    await new Promise((r) => mock.listen(MOCK_PORT, '172.17.0.1', r));

    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p ${PORT}:8090 ` +
             `-e FLOWMAP_AI_PROVIDER=api -e FLOWMAP_AI_URL=http://172.17.0.1:${MOCK_PORT}/v1/advisor ` +
             `-e FLOWMAP_AI_TOKEN=fm_test -e KB_UVODNI_MAPA=0 ${IMAGE}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: 'admin@example.com', password: PW, passwordConfirm: PW } });
    const auth = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@example.com', password: PW } });
    const token = auth.json.token;
    // ať Home nerenderuje uvítací stav bez lišty
    await api('POST', '/api/collections/goalmaps/records', {
      token, body: { title: 'Projekt', nodes: [{ id: 'root', type: 'apex', position: { x: 0, y: 0 }, data: { apexText: 'Cíl' } }], edges: [] },
    });

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.evaluateOnNewDocument((tk) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} }));
      localStorage.setItem('kb_ai_timeout_ms', '3000'); // testovací zkratka (90 s → 3 s)
    }, token);

    console.log('— AI umře během generování: spinner → omluva → dialog žije dál —');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    expect(await clickText(page, 'S pomocí AI'), 'AI dialog jde otevřít (AI se hlásí jako zdravá)');
    await sleep(600);
    await page.type('textarea', 'Prodej parku v Rohlíku');
    expect(await clickText(page, 'Spustit AI'), 'kliknuto na „Spustit AI"');
    await sleep(1200);
    let telo = await page.evaluate(() => document.body.innerText || '');
    expect(/Načítání/.test(telo), 'během čekání běží spinner (požadavek opravdu odešel)');
    expect(!/Omlouváme se/.test(telo), 'omluva se NEukazuje předčasně');

    await sleep(4000); // limit 3 s + rezerva
    telo = await page.evaluate(() => document.body.innerText || '');
    expect(/Omlouváme se, pracujeme na nápravě/.test(telo), 'po limitu je vidět omluva');
    expect(/Zkuste to prosím později/.test(telo), '…s výzvou zkusit to později');
    expect(!/Načítání/.test(telo), 'spinner po limitu zmizel');
    expect(!/Zkontrolujte konfiguraci serveru/.test(telo), 'matoucí serverová hláška se NEukázala');

    // dialog nezůstal zamrzlý — tlačítko jde stisknout znovu
    expect(await clickText(page, 'Spustit AI'), '„Spustit AI" jde použít znovu');
    await sleep(1200);
    telo = await page.evaluate(() => document.body.innerText || '');
    expect(/Načítání/.test(telo), 'druhý pokus zase běží (dialog se zotavil)');

    // čekání ukončil klient, ne mock: advisor požadavky dorazily a VŠECHNY
    // pořád visí bez odpovědi (kdyby mock omylem odpovídal, UI by neukázalo
    // omluvu, ale odpověď/chybu kontraktu — a tahle kontrola by to prozradila)
    expect(advisorPozadavku >= 1, `mock advisor požadavky dostal (${advisorPozadavku})`);
    expect(drzena.length === advisorPozadavku && drzena.every((r) => !r.writableEnded),
      'žádný požadavek nebyl zodpovězen — čekání ukončil KLIENT');

    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    console.error('NEČEKANÁ CHYBA SADY:', e);
    process.exitCode = 1;
  } finally {
    for (const r of drzena) { try { r.destroy(); } catch { /* už zavřené */ } }
    if (browser) await browser.close().catch(() => {});
    if (mock) mock.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
})();
