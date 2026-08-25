// UI e2e — anglická lokalizace. Čerstvý kontejner na :20498. Ověří, že po přepnutí
// na EN nezůstane v hlavních obrazovkách čeština, klíčové anglické texty se ukážou,
// a volba jazyka se propíše k účtu (users.language). Doplňuje i18n-catalog.js (ten
// hlídá katalogy staticky; tenhle skutečně vyrenderuje appku v EN).
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20498';
const NAME = 'flowmap-e2e-en';
const CZ = /[ěščřžýáíéůúňťďĚŠČŘŽÝÁÍÉŮÚŇŤĎ]/;
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// najde česká slova ve viditelném textu (diakritika nestačí — „Projekty" má být „Projects")
const czechWords = (txt) => (txt.match(/\b(Projekty|Úkoly|Šablony|Nový projekt|Přihlásit|Registrace|Odhlásit|Zrušit|Uložit|Můj den)\b/g) || []);

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p 20498:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
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
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    // jazyk EN vynutíme přes localStorage PŘED načtením appky (robustní, nezávislé na dropdownu)
    // Schválně STARÝ klíč `flowmap-lang`: appka ho po přejmenování musí přebrat
    // (storageKeys.js). Kdyby přechod přestal fungovat, celá sada se přepne do
    // češtiny a zčervená — což je přesně to hlášení, které chceme.
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem('flowmap-lang', 'en'); } catch (e) {} });

    console.log('== registrace v EN ==');
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle2' });
    await sleep(600);
    let body = await page.evaluate(() => document.body.innerText);
    expect(!CZ.test(body), `registrační stránka bez české diakritiky ${CZ.test(body) ? '(' + (body.match(new RegExp('.{0,15}' + CZ.source + '.{0,15}'))?.[0] || '') + ')' : ''}`);
    await page.waitForSelector('#email');
    await page.type('#email', 'admin@en.cz');
    await page.type('#password', 'testheslo123');
    await page.type('#confirm', 'testheslo123');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await sleep(1800);
    expect(!page.url().endsWith('/register'), `po registraci přesměrováno (${page.url().replace(BASE, '') || '/'})`);

    console.log('== domovská stránka v EN ==');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(1200);
    body = await page.evaluate(() => document.body.innerText);
    expect(/New project/i.test(body), 'Home ukazuje „New project"');
    const cw = czechWords(body);
    expect(cw.length === 0, `Home bez českých slov ${cw.length ? JSON.stringify([...new Set(cw)]) : ''}`);
    expect(!CZ.test(body), `Home bez české diakritiky ${CZ.test(body) ? '(' + (body.match(new RegExp('.{0,20}' + CZ.source + '.{0,20}'))?.[0] || '') + ')' : ''}`);

    console.log('== stránka úkolů v EN ==');
    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
    await sleep(1200);
    body = await page.evaluate(() => document.body.innerText);
    const cw2 = czechWords(body);
    expect(cw2.length === 0, `/tasks bez českých slov ${cw2.length ? JSON.stringify([...new Set(cw2)]) : ''}`);
    expect(!CZ.test(body), `/tasks bez české diakritiky`);

    console.log('== světlý režim v EN ==');
    // /lite přibyl až po rešerši konkurence — do téhle sady se nikdy nedostal,
    // takže angličtinu v něm nikdo nekontroloval.
    await page.goto(`${BASE}/lite`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    body = await page.evaluate(() => document.body.innerText);
    const cwL = czechWords(body);
    expect(cwL.length === 0, `/lite bez českých slov ${cwL.length ? JSON.stringify([...new Set(cwL)]) : ''}`);
    expect(!CZ.test(body), `/lite bez české diakritiky ${CZ.test(body) ? '(' + (body.match(new RegExp('.{0,20}' + CZ.source + '.{0,20}'))?.[0] || '') + ')' : ''}`);

    console.log('== notifikace v EN ==');
    // ⚠️ Poučení z klik-testu v0.9: dvě vady prošly 44 zelenými sadami právě
    // proto, že TEXTY notifikací nikdo nekontroloval.
    await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle2' });
    await sleep(1200);
    body = await page.evaluate(() => document.body.innerText);
    const cwN = czechWords(body);
    expect(cwN.length === 0, `/notifications bez českých slov ${cwN.length ? JSON.stringify([...new Set(cwN)]) : ''}`);
    expect(!CZ.test(body), `/notifications bez české diakritiky`);

    console.log('== detail uzlu v EN (přílohy jako odkaz) ==');
    // Nejnovější funkce vůbec: přílohy odkazem. Dialog je i místo, kde se
    // uživatel dozvídá, PROČ v hostované verzi nejde nahrávat.
    const auth = await (await fetch(`${BASE}/api/collections/users/auth-with-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@en.cz', password: 'testheslo123' }),
    })).json();
    const mapa = await (await fetch(`${BASE}/api/collections/goalmaps/records`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth.token },
      body: JSON.stringify({ title: 'English project', edges: [], nodes: [
        { id: 'root', type: 'apex', position: { x: 0, y: 0 }, data: { apexText: 'Goal' } },
        { id: 'n1', type: 'goal', position: { x: 0, y: 200 }, data: { title: 'Step with materials', status: 'todo' } },
      ] }),
    })).json();
    await page.goto(`${BASE}/map/${mapa.id}`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    const otevren = await page.evaluate(() => {
      const cil = [...document.querySelectorAll('.react-flow__node')].find((n) => (n.textContent || '').includes('Step with materials'));
      const tuzka = cil && [...cil.querySelectorAll('button')]
        .find((b) => /lucide-pencil/.test(b.querySelector('svg')?.getAttribute('class') || ''));
      if (!tuzka) return false;
      tuzka.click();
      return true;
    });
    expect(otevren, 'detail uzlu se otevřel');
    await sleep(1500);
    const dialog = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || '');
    expect(dialog.length > 0, 'dialog má obsah');
    const cwD = czechWords(dialog);
    expect(cwD.length === 0, `detail uzlu bez českých slov ${cwD.length ? JSON.stringify([...new Set(cwD)]) : ''}`);
    expect(!CZ.test(dialog), `detail uzlu bez české diakritiky ${CZ.test(dialog) ? '(' + (dialog.match(new RegExp('.{0,25}' + CZ.source + '.{0,25}'))?.[0] || '') + ')' : ''}`);
    expect(/Add link|Attachments/i.test(dialog), `nabízí přílohy anglicky (${(dialog.match(/Add link|Attachments/i) || ['—'])[0]})`);

    console.log('== persistence jazyka k účtu ==');
    // AuthContext při přihlášení účtu bez jazyka uloží aktuální (en) na server
    const login = await (await fetch(`${BASE}/api/collections/users/auth-with-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@en.cz', password: 'testheslo123' }),
    })).json();
    expect(login?.record?.language === 'en', `users.language propsáno na 'en' (dostal '${login?.record?.language}')`);

    console.log('== běhové chyby konzole ==');
    // ERR_NETWORK_CHANGED = síťový flake prostředí (stejně filtruje ui-myday.js)
    const realErrors = errors.filter((e) => !/favicon|manifest|ERR_NETWORK_CHANGED|Failed to load resource.*404/i.test(e));
    expect(realErrors.length === 0, `žádné běhové chyby (${realErrors.length}${realErrors.length ? ': ' + realErrors[0].slice(0, 90) : ''})`);
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', e.message.slice(0, 160));
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
