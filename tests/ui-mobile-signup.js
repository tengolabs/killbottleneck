// UI e2e: registrace nové organizace z NATIVNÍHO OBALU (Play Store scénář).
// Nováček bez instance dřív skončil na volbě serveru chybou „organizaci se
// nedaří najít" a neměl kudy dál — tohle hlídá celý nový vstup: odkaz na
// volbě serveru → formulář → „zkontrolujte e-mail" → předvyplněné jméno
// organizace. Endpoint je mockovaný (reálný signup zakládá instanci!).
//
// Nativní obal se podvrhává: window.Capacitor.isNativePlatform() = true
// (isNativeShell → true), ale BEZ isPluginAvailable — wrapper nativeHttp tím
// spadne do fetch větve a request jde zachytit interception. Reálnou
// CapacitorHttp větev kryje ruční smoke na emulátoru, tady nejde spustit.
//
// Slugy ve fixtures jsou vygenerované REFERENČNÍM algoritmem ze
// cloud/auto/signup.py (python) — hlídá se parita JS portu, ne jen „něco".
const { execSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const NAME = 'kb-e2e-mobile-signup';
const PORT = 20547;
const BASE = `http://127.0.0.1:${PORT}`;
const SIGNUP_URL = 'https://api.killbottleneck.com/signup';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));

// vstup → slug podle signup.py (fixtures z pythonu, viz hlavička)
const SLUG_FIXTURES = [
  ['Šťastná Kavárna s.r.o.', 'stastna-kavarna'],
  ['Novák & Syn, spol. s r.o.', 'novak-syn'],
  ['Dlouhé Jméno Firmy Které Přeteče Třicet Znaků', 'dlouhe-jmeno-firmy-ktere-prete'],
  ['Železárny a.s.', 'zelezarny'],
];

async function start() {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch (e) { /* ještě ne */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('kontejner nenaskočil');
}

// mock: proměnná řídí odpověď signup endpointu; OPTIONS preflight vždy projde
let mock = { status: 200, body: { ok: true } };
let lastRequestBody = null;

async function nativePage(browser, { native = true } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 860 });
  if (native) {
    await page.evaluateOnNewDocument(() => {
      // Fake nativního obalu: samotné window.Capacitor NESTAČÍ — boot natáhne
      // chunk nativeApp → runtime @capacitor/core si platformu určí podle
      // bridge objektů a isNativePlatform() by PŘEPSAL zpět na false.
      // androidBridge → platforma „android"; bez PluginHeaders je zároveň
      // isPluginAvailable('CapacitorHttp') false → nativeHttp jde přes fetch
      // a request se dá zachytit interception.
      window.androidBridge = { postMessage: () => {} };
      window.Capacitor = { isNativePlatform: () => true };
    });
  }
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (!req.url().startsWith(SIGNUP_URL)) return req.continue();
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (req.method() === 'OPTIONS') {
      return req.respond({ status: 204, headers: cors });
    }
    if (mock.abort) return req.abort('internetdisconnected');
    lastRequestBody = req.postData();
    return req.respond({
      status: mock.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify(mock.body),
    });
  });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0', timeout: 60000 });
  return page;
}

const bodyText = (page) => page.evaluate(() => document.body.innerText);
const clickByText = async (page, selector, text) => {
  const ok = await page.evaluate((sel, txt) => {
    const el = [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(txt));
    if (el) { el.click(); return true; }
    return false;
  }, selector, text);
  if (!ok) throw new Error(`nenašel jsem „${text}"`);
};

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    await start();

    console.log('== web (bez obalu): nic mobilního nevytéká ==');
    let page = await nativePage(browser, { native: false });
    let t = await bodyText(page);
    expect(!t.includes('Připojit k organizaci'), 'web nevidí volbu serveru');
    expect(!t.includes('Vyzkoušet zdarma'), 'web nevidí odkaz na registraci z obalu');
    await page.close();

    console.log('== nativní obal: volba serveru → formulář ==');
    page = await nativePage(browser);
    t = await bodyText(page);
    expect(t.includes('Připojit k organizaci'), 'obal bez serveru začíná volbou serveru');
    expect(t.includes('Vyzkoušet zdarma'), 'nováček vidí odkaz „Vyzkoušet zdarma"');
    await clickByText(page, 'button', 'Vyzkoušet zdarma');
    await page.waitForSelector('#signup-company', { timeout: 10000 });
    t = await bodyText(page);
    expect(t.includes('Zkušební verze killBottleneck na 30 dní'), 'formulář říká, co si člověk zakládá');
    const honeypot = await page.evaluate(() => {
      const inp = [...document.querySelectorAll('input')].find((i) => i.closest('[aria-hidden="true"]'));
      if (!inp) return { existuje: false };
      const r = inp.getBoundingClientRect();
      return { existuje: true, mimoObrazovku: r.right < 0 || r.bottom < 0 };
    });
    expect(honeypot.existuje && honeypot.mimoObrazovku, 'honeypot existuje a je mimo obrazovku');

    console.log('== náhled adresy = parita se signup.py ==');
    // React-controlled input: mazat klávesnicí (přímý zápis .value React nevidí)
    const prepis = async (sel, text) => {
      await page.click(sel, { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type(sel, text, { delay: 5 });
    };
    for (const [vstup, slug] of SLUG_FIXTURES) {
      await prepis('#signup-company', vstup);
      const nahled = await page.evaluate(() => document.body.innerText.match(/[a-z0-9-]+\.killbottleneck\.com/)?.[0] || '');
      expect(nahled === `${slug}.killbottleneck.com`, `„${vstup}" → ${slug}.killbottleneck.com (je: ${nahled || 'nic'})`);
    }

    // slug kratší než server pustí (min 3) → žádný náhled adresy (a bez
    // předvyplňování torza) — server by ho stejně odmítl 400
    await prepis('#signup-company', 'A1');
    const kratky = await page.evaluate(() => document.body.innerText.match(/[a-z0-9-]+\.killbottleneck\.com/)?.[0] || '');
    expect(kratky === '', 'slug pod 3 znaky neukazuje náhled adresy');

    console.log('== chyby serveru a offline ==');
    await prepis('#signup-company', 'Šťastná Kavárna s.r.o.');
    await page.type('#signup-email', 'test@e2e.cz', { delay: 5 });

    // souhlas s VOP: bez zaškrtnutí nativní validace formulář vůbec nepustí
    lastRequestBody = null;
    await page.click('button[type="submit"]');
    await new Promise((r) => setTimeout(r, 400));
    expect(lastRequestBody === null, 'bez zaškrtnutého souhlasu se POST neodešle');
    await page.click('#signup-consent');

    mock = { status: 503, body: { error: 'Zrovna nemáme volnou kapacitu. Napište prosím na info@killbottleneck.com.' } };
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => document.body.innerText.includes('kapacitu'), { timeout: 10000 });
    t = await bodyText(page);
    expect(t.includes('info@killbottleneck.com'), '503 → serverový text s kontaktem');
    expect(await page.evaluate(() => document.querySelector('#signup-email').value) === 'test@e2e.cz', 'formulář po chybě drží vyplněné hodnoty');

    mock = { status: 429, body: { error: 'Příliš mnoho pokusů z této adresy, zkuste to za hodinu.' } };
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => document.body.innerText.includes('mnoho pokusů'), { timeout: 10000 });
    expect(true, '429 → serverová hláška o limitu');

    mock = { abort: true };
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => document.body.innerText.includes('Zkontrolujte připojení'), { timeout: 10000 });
    expect(true, 'výpadek sítě → lidská hláška o připojení');

    console.log('== úspěch: kroky + předvyplněné jméno organizace ==');
    mock = { status: 200, body: { ok: true, message: 'Poslali jsme vám potvrzovací e-mail.' } };
    lastRequestBody = null;
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => document.body.innerText.includes('Zkontrolujte si e-mail'), { timeout: 10000 });
    const telo = JSON.parse(lastRequestBody || '{}');
    expect(telo.company === 'Šťastná Kavárna s.r.o.' && telo.email === 'test@e2e.cz', 'POST nese company + email');
    expect(typeof telo.website === 'string' && telo.website === '', 'honeypot se posílá prázdný');
    expect(telo.consent === true, 'POST nese consent: true (souhlas s VOP)');
    t = await bodyText(page);
    expect(t.includes('Potvrďte e-mail') && t.includes('aktivačním kódem') && t.includes('aktivační kód'), 'tři kroky: potvrzení → kód → účet');
    expect(t.includes('stastna-kavarna.killbottleneck.com'), 'ukazuje pravděpodobnou adresu');
    expect(/uvítacím e-mailu/.test(t), 'říká, že přesná adresa je v e-mailu (kolize jmen)');

    await clickByText(page, 'button', 'Zadat jméno organizace');
    await page.waitForFunction(() => document.body.innerText.includes('Připojit k organizaci'), { timeout: 10000 });
    const predvyplneno = await page.evaluate(() => document.querySelector('#server')?.value);
    expect(predvyplneno === 'stastna-kavarna', `volba serveru má předvyplněno jméno organizace (je: ${predvyplneno})`);
    await page.close();

    console.log('== hardwarové zpět z formuláře = návrat na volbu serveru ==');
    page = await nativePage(browser);
    await clickByText(page, 'button', 'Vyzkoušet zdarma');
    await page.waitForSelector('#signup-company', { timeout: 10000 });
    await page.evaluate(() => window.history.back()); // to samé dělá nativeApp.js pro backButton
    await page.waitForFunction(() => document.body.innerText.includes('Připojit k organizaci'), { timeout: 10000 });
    expect(true, 'zpět neminimalizuje, vrací na volbu serveru');
    await page.close();

    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
  } catch (err) {
    console.error('CHYBA BĚHU:', err.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
})();
