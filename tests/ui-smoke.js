// UI smoke e2e — čerstvý kontejner na :20492, ověří propojení frontend↔backend v prohlížeči:
// registrace prvního účtu → založení projektu → editor mapy → stránka úkolů. Doplňuje api-rls.js
// (ten jede jen přes API). Gotchas z paměti: networkidle2 (realtime SSE drží spojení),
// reálné puppeteer kliky (Radix nereaguje na el.click() v evaluate).
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20492';
const NAME = 'flowmap-e2e-ui';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p 20492:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
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

    console.log('== registrace prvního účtu (UI) ==');
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', 'admin@e2e.cz');
    await page.type('#password', 'testheslo123');
    await page.type('#confirm', 'testheslo123');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await sleep(1500);
    const afterReg = page.url();
    expect(!afterReg.endsWith('/register'), `po registraci přesměrováno z /register (${afterReg.replace(BASE, '') || '/'})`);

    console.log('== domovská stránka ==');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(1000);
    let body = await page.evaluate(() => document.body.innerText);
    expect(/Nový projekt/i.test(body), 'Home ukazuje tlačítko „Nový projekt"');
    expect(/Moje projekty|Kde působím|projekt/i.test(body), 'Home ukazuje sekce projektů');

    console.log('== založení projektu ==');
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Nový projekt/i.test(x.textContent));
      if (b) { b.click(); return true; } return false;
    });
    expect(clicked, 'kliknuto na Nový projekt');
    await sleep(900);
    // dialog CreateProjectDialog: input má autoFocus + placeholder „Např. …"; Enter = handleCreate
    const nameInput = await page.$('input[placeholder^="Např."]') || await page.$('input:not([type="password"]):not([type="email"])');
    expect(!!nameInput, 'dialog projektu má pole názvu');
    if (nameInput) { await nameInput.click({ clickCount: 3 }); await nameInput.type('E2E projekt'); }
    await sleep(300);
    // potvrzovací tlačítko „Založit projekt" (reálný klik přes ElementHandle)
    const btn = await page.evaluateHandle(() =>
      [...document.querySelectorAll('button')].find((x) => /Založit projekt/i.test(x.textContent)));
    const created = btn && (await btn.evaluate((b) => !!b).catch(() => false));
    if (created) await btn.asElement()?.click();
    expect(!!created, 'kliknuto na „Založit projekt"');
    await sleep(3000);
    const url = page.url();
    expect(/\/map\//.test(url) || /E2E projekt/.test(await page.evaluate(() => document.body.innerText)),
      `projekt otevřen v editoru nebo viditelný na Home (${url.replace(BASE, '')})`);

    console.log('== editor mapy (ReactFlow) ==');
    if (/\/map\//.test(url)) {
      await sleep(1500);
      const hasCanvas = await page.$('.react-flow');
      expect(!!hasCanvas, 'ReactFlow plátno se vykreslilo');
    } else {
      // otevřít z Home klikem na kartu
      await page.evaluate(() => {
        const card = [...document.querySelectorAll('a,button,[role="button"]')].find((x) => /E2E projekt/.test(x.textContent));
        card?.click();
      });
      await sleep(2000);
      expect(/\/map\//.test(page.url()), `karta projektu otevře editor (${page.url().replace(BASE, '')})`);
    }

    console.log('== Přidat cíl → Zpět (handleAddGoal plní historii) ==');
    // regrese z analýzy kódu: handleAddGoal nevolal pushHistory() → po
    // „Přidat cíl" bylo tlačítko Zpět šedé a uzel nešel vzít zpět
    await page.setViewport({ width: 1920, height: 1000 }); // široká lišta: Zpět je tlačítko, ne ⋮ menu
    await sleep(800);
    const pocetUzlu = () => page.evaluate(() => document.querySelectorAll('.react-flow__node').length);
    const predPridanim = await pocetUzlu();
    const klikZpet = () => page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        (x.getAttribute('title') || '') === 'Vrátit zpět' && !x.disabled && x.offsetParent !== null);
      if (!b) return false; b.click(); return true;
    });
    expect(await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        /Přidat cíl/.test(x.textContent) && !x.disabled && x.offsetParent !== null);
      if (!b) return false; b.click(); return true;
    }), 'kliknuto na „Přidat cíl" v liště');
    await sleep(1000);
    await page.keyboard.press('Escape'); // dialog nového uzlu zavřít bez uložení
    await sleep(600);
    const poPridani = await pocetUzlu();
    expect(poPridani === predPridanim + 1, `uzel přibyl (${predPridanim} → ${poPridani})`);
    expect(await klikZpet(), 'tlačítko Zpět je po „Přidat cíl" aktivní a kliknuto');
    await sleep(800);
    const poZpet = await pocetUzlu();
    expect(poZpet === predPridanim, `Zpět přidaný uzel odebralo (${poPridani} → ${poZpet})`);

    console.log('== stránka úkolů ==');
    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
    await sleep(1200);
    body = await page.evaluate(() => document.body.innerText);
    expect(/Úkol|úkol|Nový|Zásobník|projekt/i.test(body), 'stránka /tasks se načetla s obsahem');

    console.log('== běhové chyby konzole ==');
    // ERR_NETWORK_CHANGED = přepnutí sítě pod běžícím prohlížečem (stává se to při
    // souběhu s dockerem), ne chyba aplikace — ostatní sady ho
    // filtrují taky. Bez toho sada náhodně padá na cizí příčinu.
    const realErrors = errors.filter((e) => !/favicon|manifest|Failed to load resource.*404|ERR_NETWORK_CHANGED/i.test(e));
    expect(realErrors.length === 0, `žádné běhové chyby v konzoli (${realErrors.length}${realErrors.length ? ': ' + realErrors[0].slice(0, 90) : ''})`);
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', e.message.slice(0, 160));
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
