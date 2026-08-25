// UI: pruh o zkušební době. Server data posílá v /api/kb/config od 6. 8. 2026,
// ale bez tohohle pruhu se o konci zkušebky zákazník dozví až ve chvíli, kdy mu
// poprvé neprojde uložení — tedy v nejhorší možný okamžik.
//
// Mutačně (ne jen „něco se ukáže"):
//  · poslední týden zkušebky → pruh JE, s počtem dní — a vidí ho i ČLEN
//  · uprostřed zkušebky → SPRÁVCE vidí nenápadný odpočet (klik-test 7. 8.:
//    Richard odpočet „nikde neviděl"), ČLEN nevidí nic (neotravovat)
//  · po vypršení → pruh JE, mluví o pozastaveném zápisu, ne o smazání
//  · instance BEZ zkušebky (self-host, placené) → pruh NIKDY
// První registrovaný účet = admin (main.pb.js), další samoregistrace = user.
const { execSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const NAME = 'kb-e2e-trial-banner';
const PORT = 20544;
const BASE = `http://127.0.0.1:${PORT}`;
const HESLO = 'TestHeslo.2026';
const EMAIL = 'majitel@e2e.cz';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));

const den = (posun) => new Date(Date.now() + posun * 86400000).toISOString().slice(0, 10);

const VOLUME = 'kb-e2e-banner-data';

async function start(env, { volume = false } = {}) {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  const v = volume ? `-v ${VOLUME}:/app/pb_data` : '';
  execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 ${v} ${env} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch (e) { /* ještě ne */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('kontejner nenaskočil');
}

async function ucet(email = EMAIL) {
  await fetch(`${BASE}/api/collections/users/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: HESLO, passwordConfirm: HESLO }),
  });
}

async function textPoPrihlaseni(browser, email = EMAIL) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.type('input[type="email"]', email, { delay: 10 });
  await page.type('input[type="password"]', HESLO, { delay: 10 });
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.includes('/login'), { timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  const text = await page.evaluate(() => document.body.innerText);
  await page.close();
  return text;
}

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });

    console.log('== poslední týden zkušebky ==');
    await start(`-e KB_TRIAL_UNTIL=${den(3)}`);
    await ucet();
    let t = await textPoPrihlaseni(browser);
    expect(/Zkušební verze/.test(t), 'pruh se ukazuje');
    expect(/zbýv/i.test(t), 'říká, kolik dní zbývá');
    expect(/Vybrat tarif/.test(t), 'nabízí, co s tím (odkaz na ceník)');
    // mutačně k roli: výrazný pruh posledního týdne NENÍ jen pro správce
    await ucet('clen@e2e.cz');
    t = await textPoPrihlaseni(browser, 'clen@e2e.cz');
    expect(/Zkušební verze/.test(t), 'poslední týden vidí pruh i člen (ne jen správce)');

    console.log('== uprostřed zkušebky ==');
    await start(`-e KB_TRIAL_UNTIL=${den(20)}`);
    await ucet();
    t = await textPoPrihlaseni(browser);
    expect(/Zkušební verze/.test(t), 'správce vidí odpočet i uprostřed zkušebky');
    expect(/zbýv/i.test(t), '…včetně počtu dní');
    await ucet('clen@e2e.cz');
    t = await textPoPrihlaseni(browser, 'clen@e2e.cz');
    expect(!/Zkušební verze/.test(t), 'člen uprostřed zkušebky odpočet NEMÁ (neotravuje)');

    console.log('== po vypršení ==');
    // Účet MUSÍ vzniknout ještě za běhu zkušebky — registrace po vypršení je
    // zápis a zámek ji právem odmítne (402). Kdyby test zakládal účet až potom,
    // testoval by nesmysl a pruh by nikdy neuviděl.
    execSync(`docker volume rm ${VOLUME} 2>/dev/null; true`);
    await start(`-e KB_TRIAL_UNTIL=${den(2)}`, { volume: true });
    await ucet();
    await start(`-e KB_TRIAL_UNTIL=${den(-2)}`, { volume: true });
    t = await textPoPrihlaseni(browser);
    expect(/Zkušební doba skončila/.test(t), 'pruh o konci zkušebky');
    expect(/data jsou v bezpečí/i.test(t), 'uklidňuje, že data zůstala');
    expect(!/smaz/i.test(t), 'NEmluví o mazání — nic se nemaže');

    console.log('== instance bez zkušebky ==');
    await start('');
    await ucet();
    t = await textPoPrihlaseni(browser);
    expect(!/Zkušební/.test(t), 'self-host / placená instance pruh nevidí');

    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
  } catch (err) {
    console.error('CHYBA BĚHU:', err.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker volume rm ${VOLUME} 2>/dev/null; true`);
  }
})();
