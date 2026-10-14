// UI: košík členství v Nastavení organizace (/admin/users) na hostované instanci.
// Do 14. 10. 2026 nabízel srpnové tarify (Privát 249/490 Kč, Lite 290 Kč/rok) a kartu
// nikde. Od té doby (rozhodnutí Richarda 14. 10.): samoobsluha kartou/převodem JEN
// zkušebka → Cloud Lite; Pro / AI Agent (stěhování na vlastní server) a změna tarifu
// u instance, která už platí, přes „Napsat nám" — jinak by si platící zákazník koupil
// druhé předplatné a přechod na vlastní server by po platbě neproběhl.
// Hlídá se, že to správce opravdu VIDÍ a že tlačítka vedou tam, kam mají:
//  · tři současné tarify, žádný Privát; pod každým, co obsahuje; odkaz na ceník webu
//  · zkušebka + Lite: karta → link <tarif>-<období> s client_reference_id a předvyplněným
//    e-mailem; ročně i převodem
//  · zkušebka + Pro/Agent: ŽÁDNÁ karta ani převod, „Napsat nám" s předmětem tarifu
//  · zvolené čtvrtletí + přepnutí na Pro → období spadne na rok (žádná cena „undefined")
//  · instance, která už platí: žádná karta ani převod u žádného tarifu
//  · bez linků: převod ano, věty si neodporují
// SNIMKY=<složka> uloží snímky (galerie ke klik-testu).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const NAME = 'kb-e2e-kosik';
const PORT = 20592;
const BASE = `http://127.0.0.1:${PORT}`;
const HESLO = 'TestHeslo.2026';
const EMAIL = 'spravce@kosik-e2e.cz';
// vymyšlené linky (skutečné drží provozní část repa; jejich shodu s webem hlídá jiný test)
const LINKY = Object.fromEntries(['cloud-lite-month', 'cloud-lite-quarter', 'cloud-lite-year',
  'cloud-pro-month', 'cloud-pro-year', 'cloud-ai-agent-month', 'cloud-ai-agent-year']
  .map((k) => [k, `https://buy.stripe.com/test_${k.replace(/-/g, '_')}`]));
const SNIMKY = process.env.SNIMKY || '';
const den = (posun) => new Date(Date.now() + posun * 86400000).toISOString().slice(0, 10);

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));

async function start(env) {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -e KB_HOSTED=1 -e KB_SETUP_CODE=e2e-kod ${env} `
    + `-p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch (e) { /* ještě ne */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await fetch(`${BASE}/api/collections/users/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: HESLO, passwordConfirm: HESLO, setup_code: 'e2e-kod' }),
  });
}
const linkyEnv = (linky) => `-e 'KB_PAYMENT_LINKS=${JSON.stringify(linky)}'`;

async function kosik(browser) {
  const ctx = await browser.createBrowserContext(); // čistý localStorage pro každou instanci
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.type('input[type="email"]', EMAIL, { delay: 10 });
  await page.type('input[type="password"]', HESLO, { delay: 10 });
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.includes('/login'), { timeout: 30000 }).catch(() => {});
  await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('[data-testid="membership-section"]', { timeout: 20000 });
  await page.$eval('[data-testid="membership-section"]', (el) => el.scrollIntoView());
  return { page, ctx };
}

const snimek = async (page, jmeno) => {
  if (!SNIMKY) return;
  fs.mkdirSync(SNIMKY, { recursive: true });
  const el = await page.$('[data-testid="membership-section"]');
  await (el || page).screenshot({ path: path.join(SNIMKY, `${jmeno}.png`) });
};
const klik = async (page, testid) => {
  await page.click(`[data-testid="${testid}"]`);
  await new Promise((r) => setTimeout(r, 200));
};
const sekce = (page) => page.$eval('[data-testid="membership-section"]', (el) => el.innerText);
const href = (page, testid) => page.$eval(`[data-testid="${testid}"]`, (a) => a.href).catch(() => null);
const je = async (page, testid) => (await page.$(`[data-testid="${testid}"]`)) !== null;

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });

    console.log('== zkušebka: výchozí Lite ročně ==');
    await start(`-e KB_TRIAL_UNTIL=${den(20)} ${linkyEnv(LINKY)}`);
    let { page, ctx } = await kosik(browser);
    let t = await sekce(page);
    expect(/KB Cloud Lite/.test(t) && /KB Cloud Pro/.test(t) && /KB Cloud AI Agent/.test(t), 'tři současné tarify');
    expect(!/Privát|(^|[^0-9])(249|290|490) Kč/.test(t), 'žádný Privát ani srpnové ceny (249 / 290 / 490 Kč)');
    expect(/990 Kč/.test(t) && /4490 Kč/.test(t) && /8900 Kč/.test(t), 'roční ceny 990 / 4490 / 8900 Kč');
    expect(/Lidí neomezeně/.test(t) && /Přílohy k úkolům do 5 GB/.test(t) && /Agent Hermes plní úkoly/.test(t),
      'pod tarify je vypsané, co obsahují');
    const web = await page.$eval('[data-testid="compare-plans"]', (a) => ({ href: a.href, target: a.target })).catch(() => null);
    expect(web && web.href === 'https://killbottleneck.cz/ceny' && web.target === '_blank',
      `odkaz „Porovnat tarify na webu“ → ceník v novém okně (${web && web.href})`);
    expect(await je(page, 'order-transfer'), 'Lite ročně: převodem jde objednat');
    let h = await href(page, 'pay-card');
    expect(h && h.startsWith(LINKY['cloud-lite-year']) && /client_reference_id=/.test(h)
      && h.includes(`prefilled_email=${encodeURIComponent(EMAIL)}`),
    'karta → link Lite ročně s client_reference_id a předvyplněným e-mailem');
    expect(/e-mail, se kterým jste instanci zakládali/.test(t), 'řekne, jakým e-mailem platit');
    expect(!(await je(page, 'write-us')), 'u Lite ve zkušebce není „Napsat nám“ (jde to samo)');
    await snimek(page, '1-zkusebka-lite-rocne');

    console.log('== zkušebka: Lite čtvrtletně ==');
    await klik(page, 'period-quarter');
    t = await sekce(page);
    expect(/279 Kč/.test(t), 'čtvrtletí 279 Kč');
    expect(!(await je(page, 'order-transfer')), 'čtvrtletí převodem NE');
    h = await href(page, 'pay-card');
    expect(h && h.startsWith(LINKY['cloud-lite-quarter']), 'karta → link Lite čtvrtletně');

    console.log('== zkušebka: přepnutí na Pro ze čtvrtletí ==');
    await klik(page, 'plan-cloud-pro');
    t = await sekce(page);
    expect(!(await je(page, 'period-quarter')), 'Pro nemá čtvrtletí');
    expect(await page.$eval('[data-testid="period-year"]', (el) => el.getAttribute('aria-checked')) === 'true',
      'období spadlo na rok');
    expect(!/undefined|NaN/.test(t), 'žádná rozbitá cena');
    expect(!(await je(page, 'pay-card')) && !(await je(page, 'order-transfer')),
      'Pro: ŽÁDNÁ karta ani převod (stěhování na vlastní server se domlouvá)');
    h = await href(page, 'write-us');
    expect(h && h.startsWith('mailto:support@killbottleneck.com') && decodeURIComponent(h).includes('KB Cloud Pro'),
      '„Napsat nám“ → e-mail na support s tarifem v předmětu');
    expect(/Přechod na vlastní server s vámi domluvíme e-mailem/.test(t), 'a vysvětlí proč');
    await snimek(page, '2-zkusebka-pro');

    console.log('== zkušebka: AI Agent měsíčně ==');
    await klik(page, 'plan-cloud-ai-agent');
    await klik(page, 'period-month');
    t = await sekce(page);
    expect(/890 Kč/.test(t) && /449 Kč/.test(t) && /99 Kč/.test(t), 'měsíční ceny 99 / 449 / 890 Kč');
    expect(!(await je(page, 'pay-card')), 'AI Agent: žádná karta');
    expect(decodeURIComponent((await href(page, 'write-us')) || '').includes('KB Cloud AI Agent'), '„Napsat nám“ s AI Agentem');

    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.setViewport({ width: 390, height: 844 });
    await page.$eval('[data-testid="membership-section"]', (el) => el.scrollIntoView());
    await snimek(page, '4-telefon');
    await ctx.close();

    console.log('== instance, která už platí (bez zkušebky) ==');
    await start(linkyEnv(LINKY));
    ({ page, ctx } = await kosik(browser));
    t = await sekce(page);
    expect(/Členství je aktivní/.test(t), 'řekne, že členství je aktivní');
    for (const tarif of ['cloud-lite', 'cloud-pro', 'cloud-ai-agent']) {
      await klik(page, `plan-${tarif}`);
      expect(!(await je(page, 'pay-card')) && !(await je(page, 'order-transfer')) && await je(page, 'write-us'),
        `${tarif}: žádný druhý nákup, jen „Napsat nám“`);
    }
    expect(/ať neplatíte dvakrát/.test(await sekce(page)), 'vysvětlí proč (žádné druhé předplatné)');
    await snimek(page, '3-aktivni-clenstvi');
    await ctx.close();

    console.log('== zkušebka bez linků ==');
    await start(`-e KB_TRIAL_UNTIL=${den(20)}`);
    ({ page, ctx } = await kosik(browser));
    t = await sekce(page);
    expect(!(await je(page, 'pay-card')) && await je(page, 'order-transfer'), 'Lite ročně: bez karty, převod ano');
    expect(/Platba kartou se připravuje/.test(t), 'řekne, že karta se připravuje');
    await klik(page, 'period-month');
    t = await sekce(page);
    expect(/zvolte roční platbu převodem/.test(t) && !/zatím prosím převodem \(roční\)/.test(t),
      'měsíčně: rada bez rozporu (převod jen ročně)');
    await ctx.close();
  } catch (err) {
    fail++;
    console.log(`  ❌ výjimka: ${err.message}`);
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
