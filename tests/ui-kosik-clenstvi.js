// UI: košík členství v Nastavení organizace (/admin/users) na hostované instanci.
// Do 14. 10. 2026 nabízel srpnové tarify (Privát 249/490 Kč, Lite 290 Kč/rok) a kartu
// nikde. Od té doby (rozhodnutí Richarda 14. 10.): samoobsluha kartou/převodem JEN
// zkušebka → Cloud Start; Pro / AI Agent (stěhování na vlastní server) a změna tarifu
// u instance, která už platí, přes „Napsat nám" — jinak by si platící zákazník koupil
// druhé předplatné a přechod na vlastní server by po platbě neproběhl.
// Hlídá se, že to správce opravdu VIDÍ a že tlačítka vedou tam, kam mají:
// Od 12. 11. 2026 košík zrcadlí veřejný ceník: Neomezená AI (1 / do 5 / do 12 lidí) + KB Cloud
// Lite, Pro a AI Agent schované; delší období se ukazuje jako cena ZA MĚSÍC s celkovou částkou
// menším písmem pod ní; zkušebka zaplatí kartou i Neomezenou AI (zůstává na sdíleném serveru).
//  · nabídka jako web (4 karty, žádný Pro/Agent/Privát); pod každou, co obsahuje; odkaz na ceník
//  · ročně: přeškrtnutá měsíční cena, přepočet na měsíc, pod tím „… Kč ročně“; čtvrtletí stejně
//  · zkušebka + Lite: karta → link <tarif>-<období> s client_reference_id a předvyplněným
//    e-mailem; ročně i převodem
//  · zkušebka + Neomezená AI: karta → link tarifu, převod NE, žádné „Napsat nám“
//  · zvolené čtvrtletí + přepnutí na Neomezenou AI → období spadne na rok (žádná cena „undefined“)
//  · instance, která už platí: žádná karta ani převod u žádného tarifu
//  · bez linků: Lite převod ano, Neomezená AI „Napsat nám“; věty si neodporují
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
  'cloud-pro-month', 'cloud-pro-year', 'cloud-ai-agent-month', 'cloud-ai-agent-year',
  ...[1, 5, 12].flatMap((n) => [`ai-unlimited-${n}-month`, `ai-unlimited-${n}-year`])]
  .map((k) => [k, `https://buy.stripe.com/test_${k.replace(/-/g, '_')}`]));
const SNIMKY = process.env.SNIMKY || '';
const den = (posun) => new Date(Date.now() + posun * 86400000).toISOString().slice(0, 10);

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));

async function start(env) {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  execSync(`docker run -d -e KB_RATE_LIMITS=0 --name ${NAME} -e KB_PURPOSE_ASK=0 -e KB_HOSTED=1 -e KB_SETUP_CODE=e2e-kod ${env} `
    + `-p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch (e) { /* ještě ne */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await fetch(`${BASE}/api/collections/users/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: HESLO, passwordConfirm: HESLO, language: 'cs', setup_code: 'e2e-kod' }),
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
  // networkidle2, ne 0: Správa organizace má od 27. 10. 2026 horní lištu se zvonečkem (trvalé realtime spojení) → „nula spojení“ nikdy nenastane
  // od 29. 10. 2026 je Správa organizace v oddílech — košík je v „Předplatné a faktury“ (odkaz ze zkušebního pruhu míří sem)
  await page.goto(`${BASE}/admin/users?oddil=platby`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('[data-testid="membership-section"]', { visible: true, timeout: 20000 });
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
// cena na kartě tarifu: { velka: 'přeškrtnutá? + přepočet za měsíc', celkem: 'malý řádek pod ní' }
const cena = async (page, tarif) => ({
  velka: (await page.$eval(`[data-testid="price-${tarif}"]`, (el) => el.innerText)).replace(/\s+/g, ' ').trim(),
  skrt: await page.$eval(`[data-testid="was-${tarif}"]`, (el) => (el.querySelector('s') || {}).innerText || ''),
  celkem: (await page.$eval(`[data-testid="total-${tarif}"]`, (el) => el.innerText)).replace(/\s+/g, ' ').trim(),
});

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });

    console.log('== zkušebka: výchozí Lite ročně ==');
    await start(`-e KB_TRIAL_UNTIL=${den(20)} ${linkyEnv(LINKY)}`);
    let { page, ctx } = await kosik(browser);
    let t = await sekce(page);
    expect(/KB Cloud Start/.test(t) && /Neomezená AI · 1 člověk/.test(t) && /Neomezená AI · tým do 5 lidí/.test(t)
      && /Neomezená AI · firma do 12 lidí/.test(t), 'nabídka jako web: Neomezená AI ×3 + KB Cloud Start');
    expect(!(await je(page, 'plan-cloud-pro')) && !(await je(page, 'plan-cloud-ai-agent')) && !/KB Cloud Pro|AI Agent/.test(t),
      'Pro a AI Agent schované (jako na webu)');
    expect(!/Privát|(^|[^0-9])(249|290|490) Kč/.test(t), 'žádný Privát ani srpnové ceny (249 / 290 / 490 Kč)');
    let c = await cena(page, 'cloud-lite');
    expect(c.velka === '83 Kč za měsíc' && c.skrt === '99 Kč' && c.celkem === '990 Kč ročně',
      `Lite ročně: přeškrtnuto 99, 83 Kč za měsíc, pod tím 990 Kč ročně („${c.velka}“ / „${c.celkem}“)`);
    c = await cena(page, 'ai-unlimited-1');
    expect(c.velka === '324 Kč za měsíc' && c.skrt === '389 Kč' && c.celkem === '3 890 Kč ročně',
      `Neomezená AI 1 ročně: 324 Kč za měsíc, 3 890 Kč ročně („${c.velka}“ / „${c.celkem}“)`);
    c = await cena(page, 'ai-unlimited-5');
    const c12 = await cena(page, 'ai-unlimited-12');
    expect(c.velka === '908 Kč za měsíc' && c.skrt === '1 089 Kč' && c.celkem === '10 890 Kč ročně'
      && c12.velka === '1 741 Kč za měsíc' && c12.skrt === '2 089 Kč' && c12.celkem === '20 890 Kč ročně',
    `Neomezená AI 5 a 12 ročně: 908 / 1 741 Kč za měsíc („${c.velka}“, „${c12.velka}“)`);
    expect(/Lidí neomezeně/.test(t) && /Až 5 lidí píše asistentovi bez kvóty/.test(t) && /KB Cloud Start se všemi funkcemi v ceně/.test(t),
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
    c = await cena(page, 'cloud-lite');
    expect(c.velka === '93 Kč za měsíc' && c.skrt === '99 Kč' && c.celkem === '279 Kč čtvrtletně',
      `čtvrtletí: 93 Kč za měsíc, pod tím 279 Kč čtvrtletně („${c.velka}“ / „${c.celkem}“)`);
    c = await cena(page, 'ai-unlimited-1');
    expect(c.velka === '324 Kč za měsíc' && c.celkem === '3 890 Kč ročně', 'Neomezená AI čtvrtletí nemá → ukazuje roční cenu');
    expect(!(await je(page, 'order-transfer')), 'čtvrtletí převodem NE');
    h = await href(page, 'pay-card');
    expect(h && h.startsWith(LINKY['cloud-lite-quarter']), 'karta → link Lite čtvrtletně');

    console.log('== zkušebka: přepnutí na Neomezenou AI ze čtvrtletí ==');
    await klik(page, 'plan-ai-unlimited-5');
    t = await sekce(page);
    expect(!(await je(page, 'period-quarter')), 'Neomezená AI nemá čtvrtletí');
    expect(await page.$eval('[data-testid="period-year"]', (el) => el.getAttribute('aria-checked')) === 'true',
      'období spadlo na rok');
    expect(!/undefined|NaN/.test(t), 'žádná rozbitá cena');
    h = await href(page, 'pay-card');
    expect(h && h.startsWith(LINKY['ai-unlimited-5-year'] + '?') && /client_reference_id=/.test(h)
      && h.includes(`prefilled_email=${encodeURIComponent(EMAIL)}`),
    'Neomezená AI ze zkušebky: karta → link tarifu ročně s client_reference_id a e-mailem');
    expect(!(await je(page, 'order-transfer')) && !(await je(page, 'write-us')), 'převod ani „Napsat nám“ se nenabízí (jde to samo kartou)');
    const pozn = await page.$eval('[data-testid="membership-note"]', (el) => el.innerText);
    expect(/e-mail, se kterým jste instanci zakládali/.test(pozn) && !/převodem/.test(pozn),
      'řekne, jakým e-mailem platit, a nemluví o převodu');
    await snimek(page, '2-zkusebka-neomezena-ai');

    console.log('== zkušebka: Neomezená AI pro 12 měsíčně ==');
    await klik(page, 'plan-ai-unlimited-12');
    await klik(page, 'period-month');
    c = await cena(page, 'ai-unlimited-12');
    const cl = await cena(page, 'cloud-lite');
    expect(c.velka === '2 089 Kč za měsíc' && c.skrt === '' && c.celkem === '' && cl.velka === '99 Kč za měsíc' && cl.celkem === '',
      `měsíčně: plná měsíční cena bez přeškrtnutí a bez řádku pod ní („${c.velka}“, „${cl.velka}“)`);
    h = await href(page, 'pay-card');
    expect(h && h.startsWith(LINKY['ai-unlimited-12-month'] + '?'), 'karta → link Neomezené AI 12 měsíčně');

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
    // placená instance: karty tarifů sbalené, rozbalí je až „Porovnat a změnit tarif“ (ve zkušebce rozbalené rovnou)
    expect(!(await je(page, 'plan-cloud-lite')), 'aktivní členství: karty tarifů jsou sbalené');
    await klik(page, 'tarify-toggle');
    expect(await je(page, 'plan-cloud-lite'), '„Porovnat a změnit tarif“ karty rozbalí');
    for (const tarif of ['ai-unlimited-1', 'ai-unlimited-5', 'ai-unlimited-12', 'cloud-lite']) {
      await klik(page, `plan-${tarif}`);
      expect(!(await je(page, 'pay-card')) && !(await je(page, 'order-transfer')) && await je(page, 'write-us'),
        `${tarif}: žádný druhý nákup, jen „Napsat nám“`);
    }
    expect(/ať neplatíte dvakrát/.test(await sekce(page)), 'vysvětlí proč (žádné druhé předplatné)');
    await klik(page, 'plan-ai-unlimited-1');
    h = await href(page, 'write-us');
    expect(h && h.startsWith('mailto:support@killbottleneck.com') && decodeURIComponent(h).includes('Neomezená AI · 1 člověk'),
      '„Napsat nám“ → e-mail na support s tarifem v předmětu');
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
    await klik(page, 'plan-ai-unlimited-1');
    t = await sekce(page);
    expect(!(await je(page, 'pay-card')) && !(await je(page, 'order-transfer')) && await je(page, 'write-us')
      && /napište nám prosím/.test(t) && !/převodem/.test(await page.$eval('[data-testid="membership-note"]', (el) => el.innerText)),
    'Neomezená AI bez linku: „Napsat nám“, o převodu ani slovo');
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
