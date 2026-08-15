// UI e2e: ROZDÍL mezi hostovanou a self-host instancí — jedna tabulka, dva běhy.
//
// Proč tahle sada existuje (Richard 8. 8. 2026): „dochází mi, že lokální
// a cloudová není ta samá — dokážeme to uhlídat?" killBottleneck je JEDEN strom
// a JEDEN image; rozdíl nese runtime přepínač KB_HOSTED. Jenže dokud to pravidlo
// žilo jen v komentářích u jednotlivých komponent, dalo se na něj zapomenout —
// a taky se zapomnělo: `BillingSection` (IČO, DIČ, adresa pro objednávku U NÁS)
// se vykresloval i na self-hostu, přestože komentář o dva řádky výš v
// UserAdmin.jsx tvrdil opak. Chytil to Richard proklikáním, ne test.
//
// Tahle sada je proto ZÁMĚRNĚ tabulka, ne seznam scénářů: každá sekce
// administrace má napsané, kde MÁ a kde NESMÍ být. Přidáváš cloudovou funkci?
// Přidej řádek. Pak se na ni nedá zapomenout — rozejde se to červeně.
//
// ⚠️ Kontroluje se OBOJÍ SMĚR. Test, který jen ověří, že se něco skryje, splní
// i appka, co neukáže nic; proto má každý řádek i instanci, kde sekce BÝT MUSÍ.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

// Hostovaná instance MUSÍ dostat registrační klíč — bez něj je registrace
// fail-closed zavřená úplně (main.pb.js, Richard 11. 8.) a testovala by se
// prázdná stránka (přesně to chytila pojistka na délku textu po merge).
const SETUP_CODE = 'FM-TEST-KOD1';
const HOSTED = { name: 'kb-e2e-rozdil-hosted', port: 20941, env: `-e KB_HOSTED=1 -e KB_SETUP_CODE=${SETUP_CODE}`, setupCode: SETUP_CODE };
const SELF = { name: 'kb-e2e-rozdil-self', port: 20942, env: '' };
const PW = 'TestHeslo.2026';

// Tabulka rozdílu. `hosted` / `self` = má tam ta sekce být?
const SEKCE = [
  { nadpis: 'Fakturační údaje',       hosted: true,  self: false, proc: 'self-host si u nás nic neobjednává — IČO a DIČ tam nedávají smysl' },
  { nadpis: 'Členství a platba',      hosted: true,  self: false, proc: 'košík je jen pro hostovanou službu' },
  { nadpis: 'AI funkce',              hosted: false, self: true,  proc: 'na hostované instanci AI dodáváme my; zákazník ji nesmí přesměrovat (SSRF na sousedy)' },
  { nadpis: 'Výchozí vzhled instance', hosted: true,  self: true,  proc: 'produktová funkce — patří do obou' },
];

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function nastartuj(inst) {
  execSync(`docker rm -f ${inst.name} 2>/dev/null; true`);
  execSync(`docker run -d --name ${inst.name} -p ${inst.port}:8090 ${inst.env} ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
  const base = `http://127.0.0.1:${inst.port}`;
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return base; } catch { /* startuje */ }
    await sleep(1000);
  }
  throw new Error(`${inst.name} nenaběhl`);
}

// Vrátí text celé stránky administrace po registraci prvního (= admin) účtu.
async function textAdministrace(browser, base, setupCode) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${base}/register`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email');
  await page.type('#email', 'sef@firma.cz');
  await page.type('#password', PW);
  // ⚠️ pole se jmenuje `confirm`, ne `passwordConfirm` — s tím špatným názvem
  // se registrace tiše NEODESLALA, /admin/users pak spadl na /login a stránka
  // byla prázdná. Proto níž ta pojistka na délku textu.
  await page.type('#confirm', PW);
  if (setupCode) {
    await page.waitForSelector('#setup-code');
    await page.type('#setup-code', setupCode);
  }
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
  await sleep(1500);
  await page.goto(`${base}/admin/users`, { waitUntil: "networkidle2" });
  // sekce se dotahují líně (lazy i18n namespace „billing") — počkat na doběhnutí
  await sleep(2500);
  const text = await page.evaluate(() => document.body.innerText);
  await page.close();
  return text;
}

(async () => {
  let browser;
  try {
    const baseH = await nastartuj(HOSTED);
    const baseS = await nastartuj(SELF);
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });

    console.log('== administrace: hostovaná vs self-host ==');
    const textH = await textAdministrace(browser, baseH, HOSTED.setupCode);
    const textS = await textAdministrace(browser, baseS, SELF.setupCode);

    // Pojistka, ať se netestuje prázdná stránka: kdyby administrace vůbec
    // nenaběhla, VŠECHNY „nesmí tam být" řádky by prošly a sada by svítila.
    expect(textH.length > 200 && textS.length > 200,
      `administrace se vůbec vykreslila (hosted ${textH.length} zn., self ${textS.length} zn.)`);

    for (const s of SEKCE) {
      const jeH = textH.includes(s.nadpis);
      const jeS = textS.includes(s.nadpis);
      expect(jeH === s.hosted, `hostovaná: „${s.nadpis}" ${s.hosted ? 'JE' : 'NENÍ'} (${s.proc})`);
      expect(jeS === s.self, `self-host: „${s.nadpis}" ${s.self ? 'JE' : 'NENÍ'} (${s.proc})`);
    }
  } catch (err) {
    fail++;
    console.log(`  ❌ výjimka: ${err && err.message}`);
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${HOSTED.name} ${SELF.name} 2>/dev/null; true`);
  }
  console.log(`\n${fail ? '🔴' : '🟢'} ROZDÍL HOSTED/SELF PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
