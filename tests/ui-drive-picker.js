// Google Drive picker — „Vybrat z Disku" vloží přílohu ODKAZEM.
// Ověřuje: (1) bez klíčů v env tlačítko NENÍ (self-host beze změny), (2) s klíči
// tlačítko JE a /api/kb/config nese google_picker, (3) externí Google skripty se
// NEnačítají před kliknutím (kdo picker nepoužije, nestáhne z Googlu nic),
// (4) unit: pickedDocToLink (doc → {url, name}), (5) regrese: ruční „Přidat
// odkaz" zůstává vedle pickeru.
// Skutečné otevření Pickeru vyžaduje živý Google účet → Richardův klik-test.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const path = require('path');

const S = { name: 'flowmap-e2e-drive-on', port: 20525 };
const BEZ = { name: 'flowmap-e2e-drive-off', port: 20526 };
const PW = 'testheslo123';
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (base, method, p, { token, body } = {}) => {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

// otevře editor mapy a detail uzlu; vrátí {mapevidence síťových požadavků na Google}
async function otevriDialog(browser, base, token, mapId) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 950 });
  const googleRequests = [];
  // jen picker skripty (gapi + GIS) — fonty z gstatic si app tahá nezávisle na pickeru
  page.on('request', (r) => { if (/apis\.google\.com\/js|accounts\.google\.com\/gsi/.test(r.url())) googleRequests.push(r.url()); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })), token);
  await page.goto(`${base}/map/${mapId}`, { waitUntil: 'networkidle2' });
  await sleep(2500);
  await page.evaluate(() => {
    const uzly = [...document.querySelectorAll('.react-flow__node')];
    const cil = uzly.find((n) => (n.textContent || '').includes('Krok s podklady'));
    const tuzka = cil && [...cil.querySelectorAll('button')]
      .find((b) => /lucide-pencil/.test(b.querySelector('svg')?.getAttribute('class') || ''));
    tuzka && tuzka.click();
  });
  await sleep(1500);
  // editor mapy má od 14. 8. 2026 VELKÉ okno s kategoriemi — přílohy (a tedy
  // i picker) bydlí v kategorii „Přílohy"
  await page.evaluate(() => document.querySelector('[role="dialog"] [data-cat="files"]')?.click());
  await sleep(600);
  return { page, googleRequests };
}
const pripravMapu = async (base) => {
  await api(base, 'POST', '/api/collections/users/records', { body: { email: 'admin@example.com', password: PW, passwordConfirm: PW } });
  const token = (await api(base, 'POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@example.com', password: PW } })).json.token;
  const mapa = await api(base, 'POST', '/api/collections/goalmaps/records', {
    token, body: { title: 'Projekt s přílohami', edges: [], nodes: [
      { id: 'root', type: 'apex', position: { x: 0, y: 0 }, data: { apexText: 'Cíl' } },
      { id: 'n1', type: 'goal', position: { x: 0, y: 200 }, data: { title: 'Krok s podklady', status: 'todo' } },
    ] },
  });
  return { token, mapId: mapa.json.id };
};

(async () => {
  let browser;
  try {
    console.log('== unit: pickedDocToLink ==');
    const { pickedDocToLink } = await import(path.join(__dirname, '../frontend/src/lib/drivePicker.js'));
    const l1 = pickedDocToLink({ url: ' https://drive.google.com/file/d/abc/view ', name: '  Podklady.pdf ' });
    ok(l1.url === 'https://drive.google.com/file/d/abc/view' && l1.name === 'Podklady.pdf', 'doc → {url, name} s ořezem mezer');
    ok(pickedDocToLink(undefined).url === '' && pickedDocToLink({}).name === '', 'prázdný/chybějící doc nespadne');
    ok(pickedDocToLink({ url: 'https://x', name: 'a'.repeat(300) }).name.length === 255, 'název se stříhá na 255 (limit kolekce)');

    execSync(`docker rm -f ${S.name} ${BEZ.name} 2>/dev/null; true`);
    execSync(`docker run -d --name ${S.name} -p ${S.port}:8090 -e KB_GOOGLE_CLIENT_ID=dummy.apps.googleusercontent.com -e KB_GOOGLE_CLIENT_SECRET=dummy -e KB_GOOGLE_PICKER_API_KEY=dummy-picker-key ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    execSync(`docker run -d --name ${BEZ.name} -p ${BEZ.port}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    const BS = `http://127.0.0.1:${S.port}`, BB = `http://127.0.0.1:${BEZ.port}`;
    for (const b of [BS, BB]) for (let i = 0; i < 40; i++) { try { if ((await fetch(`${b}/api/health`)).ok) break; } catch {} await sleep(1000); }

    console.log('== config flag ==');
    const cfgOn = (await api(BS, 'GET', '/api/kb/config')).json;
    ok(cfgOn.google_picker && cfgOn.google_picker.client_id === 'dummy.apps.googleusercontent.com'
      && cfgOn.google_picker.api_key === 'dummy-picker-key', 'config s klíči nese google_picker');
    const cfgOff = (await api(BB, 'GET', '/api/kb/config')).json;
    ok(!cfgOff.google_picker, 'config bez klíčů google_picker NEnese');

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });

    console.log('== instance S klíči ==');
    const a = await pripravMapu(BS);
    const { page: p1, googleRequests: g1 } = await otevriDialog(browser, BS, a.token, a.mapId);
    const maTlacitko = await p1.evaluate(() => !!document.querySelector('[role="dialog"] [data-testid="drive-picker"]'));
    ok(maTlacitko, 'v dialogu uzlu je tlačítko „Vybrat z Disku"');
    const maRucni = await p1.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].some((b) => /Přidat odkaz/i.test(b.textContent || '')));
    ok(maRucni, 'ruční „Přidat odkaz" zůstává vedle pickeru (regrese)');
    ok(g1.length === 0, `Google skripty se před kliknutím NEnačítají (${g1.length} požadavků)`);
    await p1.close();

    console.log('== instance BEZ klíčů ==');
    const b = await pripravMapu(BB);
    const { page: p2, googleRequests: g2 } = await otevriDialog(browser, BB, b.token, b.mapId);
    const dialogJe = await p2.evaluate(() => !!document.querySelector('[role="dialog"]'));
    ok(dialogJe, 'dialog uzlu se otevřel');
    const bezTlacitka = await p2.evaluate(() => !document.querySelector('[role="dialog"] [data-testid="drive-picker"]'));
    ok(bezTlacitka, 'bez klíčů tlačítko NENÍ (self-host beze změny)');
    ok(g2.length === 0, 'bez klíčů žádné požadavky na Google');
    await p2.close();
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', e.message.slice(0, 200));
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${S.name} ${BEZ.name} 2>/dev/null; true`);
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
