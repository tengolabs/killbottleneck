// První spuštění OČIMA UŽIVATELE: panensky čistá instance nesmí vítat „zpět".
//
// Richard 11. 8. 2026 při instalaci: „proč to poprvé nejde rovnou na registraci?"
// Server ví, že tu ještě nikdo není (public /config, claimed) → /login přesměruje
// na /register s titulkem „Založte svou instanci". Jakmile první účet existuje,
// /login zůstává loginem — přesměrování nesmí vystrnadit přihlašování.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-first-run';
const PORT = 20592;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    const cfg = await (await fetch(`${BASE}/api/kb/config`)).json();
    ok(cfg.claimed === false, `čistá instance hlásí claimed=false (${cfg.claimed})`);

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    console.log('== čistá instance: /login přesměruje na registraci správce ==');
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    ok(page.url().includes('/register'), `z /login jsem na registraci (${page.url()})`);
    const text1 = await page.evaluate(() => document.body.innerText);
    ok(text1.includes('Založte svou instanci'), 'titulek říká „Založte svou instanci"');
    ok(text1.includes('První účet se stane správcem'), 'a vysvětluje, že první účet = správce');
    ok(!text1.includes('Vítejte zpět'), '„Vítejte zpět" na čisté instanci není');

    console.log('== po založení prvního účtu zůstává /login loginem ==');
    await fetch(`${BASE}/api/collections/users/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: PW, passwordConfirm: PW }),
    });
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    ok(page.url().includes('/login'), `login se už nepřesměrovává (${page.url()})`);
    const text2 = await page.evaluate(() => document.body.innerText);
    ok(text2.includes('Vítejte zpět'), 'a vítá zpět, protože už je koho');

    console.log('== HOSTOVANÝ box BEZ aktivačního kódu: registrace FAIL-CLOSED ==');
    // Richard 11. 8.: „ideálně by ani neměla být aktivní možnost registrace,
    // když to neprošlo naším formulářem." Špatně vyprovisionovaný box (KB_HOSTED
    // bez SETUP_CODE) nesmí nikoho zvát — server registraci odmítá a login
    // na /register vůbec neposílá.
    const NAME2 = NAME + '-hosted';
    execSync(`docker rm -f ${NAME2} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME2} -e KB_HOSTED=1 -p ${PORT + 1}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    const BASE2 = `http://127.0.0.1:${PORT + 1}`;
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE2}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
    const reg2 = await fetch(`${BASE2}/api/collections/users/records`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'vetrelec@example.com', password: PW, passwordConfirm: PW }),
    });
    ok(reg2.status >= 400, `self-registrace na hostovaném boxu bez kódu ODMÍTNUTA (${reg2.status})`);
    await page.goto(`${BASE2}/login`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    ok(page.url().includes('/login'), `login NEposílá na registraci (${page.url()})`);
    execSync(`docker rm -f ${NAME2} 2>/dev/null; true`);

    console.log('== HOSTOVANÝ box S kódem: redirect ano, registrace jen s kódem ==');
    const NAME3 = NAME + '-kod';
    execSync(`docker rm -f ${NAME3} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME3} -e KB_HOSTED=1 -e KB_SETUP_CODE=tajny-kod-123 -p ${PORT + 2}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    const BASE3 = `http://127.0.0.1:${PORT + 2}`;
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE3}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
    const regBez = await fetch(`${BASE3}/api/collections/users/records`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: PW, passwordConfirm: PW }),
    });
    ok(regBez.status >= 400, `bez aktivačního kódu registrace neprojde (${regBez.status})`);
    const regS = await fetch(`${BASE3}/api/collections/users/records`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: PW, passwordConfirm: PW, setup_code: 'tajny-kod-123' }),
    });
    ok(regS.status === 200, `s kódem projde (${regS.status})`);
    await page.goto(`${BASE3}/login`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    ok(page.url().includes('/login'), 'po založení účtu s kódem login zůstává loginem');
    execSync(`docker rm -f ${NAME3} 2>/dev/null; true`);

    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    console.error('CHYBA SADY:', e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    execSync(`docker rm -f ${NAME} ${NAME}-hosted ${NAME}-kod 2>/dev/null; true`);
  }
})();
