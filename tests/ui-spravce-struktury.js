// UI e2e: SPRÁVA ORGANIZACE OČIMA SPRÁVCE STRUKTURY (Richard 17. 8. 2026).
//
// Zadání: „dal bych jí přístup do správy organizace, ale měla by tam jen tyhle
// 2 okna. Nemohla by měnit role ani správce, ale mohla by dávat zástupce,
// vlastně i zvát uživatele a měnit hesla."
//
// ⚠️ PAST, na kterou jsem sám naběhl: tvrzení typu „sloupec NEVIDÍ" projdou
// i nad PRÁZDNOU tabulkou. Správce nesmí číst kolekci users (adminská
// listRule), takže se mu seznam nenačetl vůbec — a sada přesto svítila zeleně.
// Proto se tady NEJDŘÍV kontroluje, že tabulka má řádky, a teprve pak, co v ní
// chybí. Bez toho tahle sada nedokazuje nic.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-ui-spravce-struktury';
const PORT = 20794;
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
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await reg('admin@example.com');           // první = admin
    const rH = await reg('hr@example.com');   // správce struktury
    await reg('petr@example.com');            // běžný člen (řádek s obnovou hesla)
    const A = await login('admin@example.com');

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const errs = [];
    const cizihoPuvodu = (m) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test((m.location() && m.location().url) || '');

    console.log('== admin jmenuje správce struktury ==');
    const jmen = await api('PATCH', `/api/collections/users/records/${rH.json.id}`, { token: A, body: { is_org_manager: true } });
    ok(jmen.status === 200 && jmen.json.is_org_manager === true, 'příznak nastaven');
    await sleep(500);
    const H = await login('hr@example.com');

    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1200 });
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })), H);

    console.log('== oznámení o jmenování vede do Správy organizace, ne do úkolů ==');
    await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    ok(/správcem organizační struktury/.test(await page.evaluate(() => document.body.innerText)),
      'oznámení o jmenování je na seznamu');
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('*')].find((x) => /správcem organizační struktury/.test(x.textContent || '') && x.children.length === 0);
      let n = el;
      while (n && n !== document.body) {
        if (n.onclick || n.getAttribute('role') === 'button' || n.tagName === 'BUTTON' || String(n.className).includes('cursor-pointer')) { n.click(); return; }
        n = n.parentElement;
      }
      el && el.click();
    });
    await sleep(3000);
    ok(page.url().includes('/admin/users'),
      `klik na oznámení vede do Správy organizace (${page.url().replace(BASE, '') || '/'}; dřív padal do /tasks)`);

    console.log('== Správa organizace: DVĚ okna a nic víc ==');
    await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle2' });
    await sleep(3500);
    // ⚠️ NEJDŘÍV řádky: nad prázdnou tabulkou by všechna „NEVIDÍ" tvrzení
    // prošla, i kdyby se seznam vůbec nenačetl (přesně to se mi stalo)
    const radku = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
    ok(radku >= 3, `tabulka lidí je NAPLNĚNÁ (${radku} řádků) — jinak nic z níže uvedeného nic nedokazuje`);
    const txt = await page.evaluate(() => document.body.innerText);
    ok(!/Nemáte oprávnění/i.test(txt), 'správce se na stránku dostane');
    ok(/Organizační struktura a zastupování/.test(txt), 'okno Organizační struktura a zastupování je tam');
    ok(/Zástupce/.test(txt), 'sloupec Zástupce je tam (personální agenda)');

    console.log('== ale páky, které mu nepatří, nevidí ==');
    ok(!/Správce AI/.test(txt), 'sloupec Správce AI NEVIDÍ');
    ok(!/Správce struktury/.test(txt), 'sloupec Správce struktury NEVIDÍ (nejmenuje si nástupce)');
    ok(!/Název organizace/.test(txt), 'název a logo organizace NEVIDÍ');
    ok(!/Fakturační|Členství/i.test(txt), 'fakturaci ani členství NEVIDÍ');
    ok(!/Vzhled instance/i.test(txt), 'vzhled instance NEVIDÍ');
    const prepinace = await page.evaluate(() => document.querySelectorAll('button[role="switch"]').length);
    ok(prepinace === 0, `v tabulce nejsou žádné přepínače správcovství (${prepinace})`);
    const kose = await page.evaluate(() => document.querySelectorAll('svg.lucide-trash-2').length);
    ok(kose === 0, `mazání účtů nenabízí (${kose})`);

    console.log('== co naopak umět MÁ ==');
    const klice = await page.evaluate(() => document.querySelectorAll('svg.lucide-key-round').length);
    ok(klice > 0, `obnovu hesla nabízí (${klice}× — u admina a u sebe ne, to je záměr)`);
    ok(/Pozvat/i.test(txt), 'pozvat uživatele může');

    console.log('== admin má pořád všechno ==');
    const pageA = await browser.newPage();
    await pageA.setViewport({ width: 1600, height: 1200 });
    await pageA.evaluateOnNewDocument((t) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })), A);
    await pageA.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle2' });
    await sleep(3500);
    const txtA = await pageA.evaluate(() => document.body.innerText);
    ok(/Správce AI/.test(txtA) && /Správce struktury/.test(txtA), 'admin oba sloupce správcovství vidí');
    ok(/Název organizace/.test(txtA), 'a nastavení organizace taky');
    const radkuA = await pageA.evaluate(() => document.querySelectorAll('tbody tr').length);
    ok(radkuA >= 3, `a jeho tabulka je taky naplněná (${radkuA})`);

    const zavazne = errs.filter((e) => !/favicon|manifest/i.test(e));
    ok(zavazne.length === 0, `konzole bez chyb (${zavazne.length}${zavazne.length ? ': ' + zavazne[0].slice(0, 120) : ''})`);
  } catch (err) {
    console.error('NEOČEKÁVANÁ CHYBA SADY:', err);
    fail++;
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} UI-SPRAVCE-STRUKTURY PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
