// Nabídka pod panáčkem je i v MAPĚ (reklamace z bety 12. 8. 2026).
//
// Uživatel měl ve zkušebním projektu úkol „Změnit si vzhled". Návod říkal
// „vpravo nahoře v nabídce", jenže mapa byla jediné místo bez hlavičky —
// panáček tam nebyl a vzhled se dělal paletou vlevo dole. Hledal správně
// a nenašel nic.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const NAME = 'kb-e2e-panacek', PORT = 20598, BASE = `http://127.0.0.1:${PORT}`, PW = 'testheslo123';
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -e TZ=Europe/Prague -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
    await fetch(`${BASE}/api/collections/users/records`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'r@test.cz', password: PW, passwordConfirm: PW }) });
    const auth = await (await fetch(`${BASE}/api/collections/users/auth-with-password`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: 'r@test.cz', password: PW }) })).json();
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 950 });
    await page.evaluateOnNewDocument((t, r) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: r }));
      localStorage.setItem('kb-lang', 'cs');
    }, auth.token, auth.record);

    // 1) panáček na domovské stránce (nesmí se rozbít tím, že se menu vytáhlo)
    await page.goto(BASE, { waitUntil: 'networkidle2' });
    await page.waitForSelector('button[data-user-menu]', { timeout: 20000 }).catch(() => {});
    await sleep(600);
    ok(await page.$('button[data-user-menu]') !== null, 'panáček je na domovské stránce');
    await page.click('button[data-user-menu]');
    await sleep(600);
    ok(await page.$('[data-skin-menu-item]') !== null, 'a je v něm Vzhled');
    await page.keyboard.press('Escape');

    // 2) TÝŽ panáček v mapě — jádro reklamace
    const mapy = await (await fetch(`${BASE}/api/collections/goalmaps/records?perPage=1`, { headers: { Authorization: auth.token } })).json();
    await page.goto(`${BASE}/map/${mapy.items[0].id}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 5, { timeout: 45000 }).catch(() => {});
    await sleep(1500);
    ok(await page.$('button[data-user-menu]') !== null, 'panáček je i v MAPĚ');
    await page.click('button[data-user-menu]');
    await sleep(600);
    ok(await page.$('[data-skin-menu-item]') !== null, 'a Vzhled je v něm i tady');

    // 3) vzhled z mapy opravdu funguje (dialog se otevře)
    await page.click('[data-skin-menu-item]');
    await sleep(1200);
    const dialog = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
    ok(dialog, 'kliknutí na Vzhled v mapě otevře výběr skinu');

    // ---- MOBIL: tlačítko „zpět do lite" v hlavičce ----
    // Je vidět jen pod 1024 px. Při vytažení menu do UserMenu zmizel import
    // saveMode/MODE_LITE a tlačítko spadlo na ReferenceError — build to
    // propustil a žádná sada na ně v úzkém okně neklikla (nález 12. 8. 2026).
    const chybyStranky = [];
    page.on('pageerror', (e) => chybyStranky.push(String(e).slice(0, 120)));
    // ⚠️ Aplikace se na úzkém displeji sama přepne do zjednodušeného zobrazení.
    // Tlačítko „zpět do lite" je ale v PLNÉ verzi na malém displeji — proto se
    // plná verze musí vynutit, jinak by sada testovala úplně jinou obrazovku.
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.evaluate(() => localStorage.setItem('kb-mode', 'full'));
    await page.goto(BASE, { waitUntil: 'networkidle2' });
    await page.waitForSelector('header button', { timeout: 20000 }).catch(() => {});
    await sleep(900);
    // hledá se podle popisku, ne podle třídy — ta se v sestaveném balíku
    // může lišit a kontrola by tiše minula
    const kliknuto = await page.evaluate(() => {
      const b = [...document.querySelectorAll('header button')]
        .find((x) => /zjednodu|lite/i.test((x.getAttribute('title') || '') + (x.getAttribute('aria-label') || '')));
      if (!b) return false;
      b.click();
      return true;
    });
    ok(kliknuto, 'na telefonu je v hlavičce tlačítko zpět do zjednodušeného zobrazení');
    await sleep(1500);
    const url = page.url();
    ok(url.includes('/lite'), `a klik na ně opravdu přepne (${url.replace(BASE, '') || '/'})`);
    ok(chybyStranky.length === 0, `bez chyby na stránce${chybyStranky.length ? ' — ' + chybyStranky[0] : ''}`);

    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) { console.error('CHYBA SADY:', e); process.exitCode = 1; }
  finally { if (browser) await browser.close().catch(() => {}); execSync(`docker rm -f ${NAME} 2>/dev/null; true`); }
})();
