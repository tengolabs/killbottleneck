// Jak vypadá výpadek AI OČIMA UŽIVATELE.
//
// Serverovou stranu (ai_healthy) hlídá hosted-guards.js. Tady jde o to, co je
// vidět: AI akce nesmí zůstat viset a padat na chybu, ale ani zmizet beze slova —
// v hostovaném provozu běží AI u poskytovatele a její výpadek je normální
// provozní stav, ne chyba zákazníka.
//
// Testuje se přes prohlížeč, protože rozhodnutí dělá frontend (hook useAiModes).
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'flowmap-e2e-ai-outage';
const PORT = 20521;
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

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    // AI je nastavená (provider api), ale adresa nikam nevede = výpadek služby
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p ${PORT}:8090 ` +
             `-e FLOWMAP_AI_PROVIDER=api -e FLOWMAP_AI_URL=https://ai-sluzba.invalid/v1/advisor ` +
             `-e FLOWMAP_AI_TOKEN=fm_test ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
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

    await page.evaluateOnNewDocument((t) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} }));
    }, token);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2500);

    const texty = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map((b) => b.textContent.trim()));
    const vsechno = texty.join(' | ');

    expect(!/Navrhnout s AI|S pomocí AI|Mapa z textu/.test(vsechno),
      'AI akce se nenabízejí, když služba neodpovídá');
    expect(/dočasně nedostupná/i.test(vsechno),
      `uživatel se DOZVÍ proč (nabídka: ${vsechno.slice(0, 120)}…)`);

    const zesedle = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).filter((b) => /dočasně nedostupná/i.test(b.textContent)).map((b) => b.disabled));
    expect(zesedle.length > 0 && zesedle.every(Boolean), 'tlačítko je zašedlé, ne klikací do prázdna');

    const napoveda = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => /dočasně nedostupná/i.test(x.textContent));
      return b ? b.getAttribute('title') || '' : '';
    });
    expect(/zbytek aplikace|rest of the app/i.test(napoveda), 'nápověda říká, že zbytek appky funguje');

    // to hlavní: bez AI musí jít pracovat
    const projekty = await page.evaluate(() => document.body.innerText.includes('Projekt'));
    expect(projekty, 'projekty se normálně zobrazují');
    expect(chyby.length === 0, `konzole čistá (${chyby.slice(0, 2).join(' / ') || 'bez chyb'})`);
  } catch (e) {
    fail++; console.log(`  ❌ výjimka: ${e.message}`);
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${pass} OK, ${fail} chyb`);
  process.exit(fail ? 1 : 0);
})();
