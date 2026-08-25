// Google OAuth — konfiguračně řízené zobrazení tlačítka + zachování cizích providerů.
// Ověřuje: (1) „Přihlásit se přes Google" se ukáže JEN když má instance nastavené
// KB_GOOGLE_CLIENT_ID/_SECRET (backend to promítne do auth-methods); (2) onBootstrap
// NEsmaže ručně nastavené jiné OAuth providery — ani při zapnutí Googlu, ani při jeho
// vypnutí; (3) na instanci s registračním klíčem se Google tlačítko na /register
// ZOBRAZUJE (kód se předává přes createData), ale je neaktivní, dokud kód není vyplněný.
// Samotný OAuth round-trip s vynucením setup_code/KB_MAX_USERS testuje oauth-mutace.js.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const runContainer = (name, port, env, vol) => {
  execSync(`docker rm -f ${name} 2>/dev/null; true`);
  execSync(`docker run -d --name ${name} -e KB_PURPOSE_ASK=0 -p ${port}:8090 ${vol ? `-v ${vol}:/app/pb_data` : ''} ${env} ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
};
const waitReady = async (port) => {
  for (let i = 0; i < 30; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {} await sleep(1000); }
};
const authMethods = async (port) => (await fetch(`http://127.0.0.1:${port}/api/collections/users/auth-methods`)).json();
const pageHasGoogle = async (browser, port, path) => {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  const txt = await page.evaluate(() => document.body.innerText);
  await page.close();
  return /přes Google/i.test(txt);
};

(async () => {
  let browser;
  const ON = 'flowmap-e2e-goog-on', OFF = 'flowmap-e2e-goog-off', KEEP = 'flowmap-e2e-goog-keep', CODE = 'flowmap-e2e-goog-code';
  const VOL = 'flowmap-e2e-goog-vol';
  const GOOG = '-e KB_GOOGLE_CLIENT_ID=dummy.apps.googleusercontent.com -e KB_GOOGLE_CLIENT_SECRET=dummy';
  try {
    runContainer(ON, 20495, GOOG);
    runContainer(OFF, 20496, '');
    await waitReady(20495); await waitReady(20496);

    console.log('== backend auth-methods ==');
    const on = await authMethods(20495);
    const off = await authMethods(20496);
    expect(on.oauth2.enabled && on.oauth2.providers.some((p) => p.name === 'google'), 'S credentials: auth-methods hlásí google');
    expect(!off.oauth2.enabled, 'Bez credentials: oauth2 vypnuté');

    console.log('== UI tlačítko ==');
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    expect(await pageHasGoogle(browser, 20495, '/login'), 'S credentials: Login ukazuje tlačítko Google');
    expect(!(await pageHasGoogle(browser, 20496, '/login')), 'Bez credentials: Login tlačítko Google NEukazuje (žádná regrese)');

    console.log('== zachování cizích providerů přes restart (onBootstrap nesmí mazat) ==');
    execSync(`docker volume rm ${VOL} 2>/dev/null; true`);
    runContainer(KEEP, 20497, GOOG, VOL);
    await waitReady(20497);
    // ručně (superuserem) přidat druhý provider vedle googlu — jako by ho admin naklikal v /_/
    execSync(`docker exec ${KEEP} /app/pocketbase superuser upsert su@e2e.cz superheslo123`, { stdio: 'ignore' });
    const su = await (await fetch('http://127.0.0.1:20497/api/collections/_superusers/auth-with-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: 'su@e2e.cz', password: 'superheslo123' }),
    })).json();
    const usersCol = await (await fetch('http://127.0.0.1:20497/api/collections/users', { headers: { Authorization: su.token } })).json();
    usersCol.oauth2.providers.push({ name: 'github', clientId: 'gh-dummy', clientSecret: 'gh-dummy' });
    const patched = await fetch('http://127.0.0.1:20497/api/collections/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: su.token },
      body: JSON.stringify({ oauth2: usersCol.oauth2 }),
    });
    expect(patched.ok, 'Cizí provider (github) se podařilo přidat superuserem');
    // restart S google env → musí zůstat OBA
    execSync(`docker rm -f ${KEEP}`, { stdio: 'ignore' });
    runContainer(KEEP, 20497, GOOG, VOL);
    await waitReady(20497);
    let m = await authMethods(20497);
    // clientId přežití ověřujeme přes authUrl (auth-methods NEvrací pole clientId
    // ani clientSecret — clientId je zapečený v authUrl jako client_id=…).
    const ghPo = m.oauth2.providers.find((p) => p.name === 'github');
    expect(m.oauth2.providers.some((p) => p.name === 'google') && ghPo
      && /client_id=gh-dummy/.test(ghPo.authUrl || ghPo.authURL || ''),
      'Restart s credentials: github (jméno+clientId v authUrl) přežil vedle googlu');
    // ⚠️ clientSecret cizího provideru přes restart NEověřujeme: PocketBase ho
    // maskuje při čtení (API i JSVM model). To, že se nakonfigurovaný secret
    // REÁLNĚ posílá na token endpoint (ne vakuózní „figuruje"), dokazuje
    // oauth-mutace.js zachycením Basic auth na mocku. Tady onBootstrap garantuje
    // zachování PŘÍTOMNOSTI cizího provideru (jméno+clientId) místo dřívějšího
    // úplného smazání. (Google navíc funguje i proto, že secret vždy vloží z env.)
    // restart BEZ google env → google pryč, github zůstává, oauth2 zůstává zapnuté
    execSync(`docker rm -f ${KEEP}`, { stdio: 'ignore' });
    runContainer(KEEP, 20497, '', VOL);
    await waitReady(20497);
    m = await authMethods(20497);
    expect(!m.oauth2.providers.some((p) => p.name === 'google'), 'Restart bez credentials: google odebrán');
    expect(m.oauth2.enabled && m.oauth2.providers.some((p) => p.name === 'github'), 'Restart bez credentials: github zůstal a oauth2 jede dál');

    console.log('== Register s aktivačním kódem: tlačítko JE, ale čeká na kód ==');
    runContainer(CODE, 20498, `${GOOG} -e KB_SETUP_CODE=KB-TEST-1234`);
    await waitReady(20498);
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:20498/register', { waitUntil: 'networkidle2' });
    await sleep(1200);
    const stav = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /přes Google/i.test(b.innerText));
      return { existuje: !!btn, disabled: btn ? btn.disabled : null };
    });
    expect(stav.existuje, 'Register se setup_code: Google tlačítko se ZOBRAZUJE');
    expect(stav.disabled === true, 'Register se setup_code: tlačítko je neaktivní bez kódu');
    // vyplnění kódu tlačítko odemkne
    await page.evaluate(() => {
      const inp = document.getElementById('setup-code');
      if (inp) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, 'KB-TEST-1234');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(400);
    const poKodu = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /přes Google/i.test(b.innerText));
      return btn ? btn.disabled : null;
    });
    expect(poKodu === false, 'Register se setup_code: po vyplnění kódu je tlačítko aktivní');
    await page.close();
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', e.message.slice(0, 160));
  } finally {
    execSync(`docker rm -f ${ON} ${OFF} ${KEEP} ${CODE} 2>/dev/null; true`);
    execSync(`docker volume rm ${VOL} 2>/dev/null; true`);
    if (browser) await browser.close();
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
