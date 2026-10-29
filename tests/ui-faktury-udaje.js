// UI e2e: údaje dodavatele pro celý svět (29. 10. 2026, nález /checkup „UI větve bez klik-testu“): výběr země ve Správě
// organizace předvyplní měnu a sazbu STEJNĚ jako server (jedna tabulka ZEME/PREDVOLBY), popisky IČO → EIN, volný text
// účtu jen mimo CZ/SK, BIC i pro slovenského dodavatele, „Jiná země“ dvoupísmenným kódem, uložení US profilu → server
// vrátí country/currency a po obnovení stránky formulář sedí. Spuštění: KB_TEST_IMAGE=<image> node product/tests/ui-faktury-udaje.js
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const path = require('path');
const BASE = 'http://127.0.0.1:20573';
const NAME = 'flowmap-e2e-ui-faktury-udaje';
const PW = 'testheslo123';
global.__hooks = path.join(__dirname, '..', 'server', 'pb_hooks');
const F = require(path.join(global.__hooks, 'faktury.js')); // předvolby serveru = očekávání pro UI
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, { token, body, method } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = token;
  const res = await fetch(BASE + p, { method: method || (body ? 'POST' : 'GET'), headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  let json = null; try { json = await res.json(); } catch { /* prázdné */ }
  return { status: res.status, json: json || {} };
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_UVODNI_MAPA=0 -e KB_PURPOSE_ASK=0 -p 20573:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
    await api('/api/collections/users/records', { body: { email: 'admin@e2e.cz', password: PW, passwordConfirm: PW } });
    const admin = (await api('/api/collections/users/auth-with-password', { body: { identity: 'admin@e2e.cz', password: PW } })).json;

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', 'admin@e2e.cz'); await page.type('#password', PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1200);
    const T = (id) => `[data-testid="invoicing-${id}"]`;
    const val = (id) => page.$eval(T(id), (el) => el.value);
    const tag = (id) => page.$eval(T(id), (el) => el.tagName);
    const je = async (id) => !!(await page.$(T(id)));
    const popisek = (f) => page.$eval(`label[for="${f}"]`, (el) => el.textContent.trim());
    const zeme = async (k) => { await page.select(T('country'), k); await sleep(150); };

    console.log('== Správa organizace → Vystavování faktur: výchozí = Česko ==');
    await page.goto(`${BASE}/admin/users?fakturace=1`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(T('country'), { timeout: 15000 });
    expect((await val('country')) === '' && !(await je('bic')) && !(await je('tax-label')) && (await tag('account')) === 'INPUT' && (await popisek('inv-ico')) === 'IČO', 'bez země: IČO, účet jedním řádkem, bez BIC a názvu daně (v0.86 1:1)');

    console.log('== změna země předvyplní měnu a sazbu přesně jako server (jedna tabulka) ==');
    for (const k of ['US', 'DE', 'PL', 'CH', 'GB', 'SK']) {
      await zeme(k);
      const pv = F.predvolba(k);
      expect((await val('currency')) === pv.currency && Number(await val('vat-rate')) === pv.vat_rate, `${k}: měna ${pv.currency}, sazba ${pv.vat_rate} % = předvolba serveru`);
    }
    await zeme('US');
    expect((await popisek('inv-ico')) === 'EIN' && (await popisek('inv-dic')) === 'Tax ID' && (await tag('account')) === 'TEXTAREA' && (await je('bic')) && (await je('tax-label')), 'USA: EIN / Tax ID, účet volným textem, BIC a název daně');
    await zeme('SK');
    expect((await popisek('inv-ico')) === 'IČO' && (await tag('account')) === 'INPUT' && (await je('bic')), 'Slovensko: IČO, účet české číslo/IBAN, ale BIC jde zadat (EPC QR)');

    console.log('== „Jiná země“ kódem ==');
    await zeme('__jina');
    expect(await je('country-code'), 'volba Jiná země ukáže pole pro kód');
    await page.type(T('country-code'), 'it'); await sleep(150);
    expect((await val('country-code')) === 'IT' && (await val('currency')) === 'EUR' && Number(await val('vat-rate')) === F.predvolba('IT').vat_rate && (await popisek('inv-ico')) === 'Reg. č.', 'IT: kód velkými, předvolba jiné země EU (EUR, 20 %), popisek Reg. č.');
    await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await sleep(150);
    expect((await je('country-code')) && (await val('country-code')) === '' && (await val('currency')) === 'CZK' && Number(await val('vat-rate')) === 21, 'smazání kódu: pole zůstává, předvolba se vrátí na CZK/21 (dřív skok na Česko s EUR)');

    console.log('== uložení amerického dodavatele → server country/currency, po novém otevření formulář sedí ==');
    await zeme('US');
    await page.type(T('name'), 'Acme Consulting LLC');
    await page.type(T('address'), '1 Main St\nAustin, TX 78701');
    await page.type(T('ico'), '12-3456789');
    await page.type(T('account'), 'Routing 021000021\nAccount 123456789');
    await page.type(T('bic'), 'chasus33');
    await page.click(T('save')); await sleep(1500);
    const prof = (await api('/api/kb/invoicing-profile', { token: admin.token })).json.profil || {};
    expect(prof.country === 'US' && prof.currency === 'USD' && prof.vat_rate === 0 && /Routing 021000021\nAccount 123456789/.test(prof.bank_account) && !prof.iban && prof.bic === 'CHASUS33' && prof.ico === '12-3456789', `uloženo: US, USD, volný účet, bez IBAN, BIC velkými (${JSON.stringify(prof).slice(0, 200)})`);
    // stránka parametr ?fakturace=1 po otevření z adresy odstraní → znovu přes adresu, ne reload
    await page.goto(`${BASE}/admin/users?fakturace=1`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(T('country'), { timeout: 15000 }); await sleep(300);
    expect((await val('country')) === 'US' && (await val('currency')) === 'USD' && (await tag('account')) === 'TEXTAREA' && (await val('bic')) === 'CHASUS33', 'po novém otevření: země USA, měna USD, účet textarea, BIC');
  } catch (e) { fail++; console.log('  ❌ výjimka:', e && e.stack ? e.stack : e); }
  finally { if (browser) await browser.close().catch(() => {}); execSync(`docker rm -f ${NAME} 2>/dev/null; true`); }
  console.log(`\n${fail ? '🔴' : '🟢'} UI-FAKTURY-UDAJE PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
