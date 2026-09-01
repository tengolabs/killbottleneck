// Zjednodušený (lite) režim MUSÍ ZŮSTAT LEHKÝ.
//
// Celý jeho smysl je telefon: první načtení plné appky na 4G ze studené cache
// trvalo 11,5 s (product/tests/scale-limits.js). Lehkost je aktivum, které se
// ztrácí nepozorovaně — stačí v lite komponentě sáhnout po hotovém dialogu
// z components/ui/ a přiteče s ním Radix, nebo po náhledu mapy a přiteče
// ReactFlow. Tenhle test to nedovolí.
//
// Měří se DVĚ věci:
//   1) staticky: co si lite strom dovoluje importovat,
//   2) skutečně přenesené bajty na /light v prohlížeči (chytí i to, co se
//      přilepí přes sdílené moduly — statická kontrola na to nestačí).
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:20514';
const NAME = 'flowmap-e2e-lite-bundle';
const SRC = path.join(__dirname, '../frontend/src');
// Strop se měří na ROZBALENÉM JS — to je práce, kterou telefon musí odvést
// bez ohledu na to, jestli je vpředu komprimující proxy. (Přenesené bajty se
// vypisují taky, ale samotný PocketBase nekomprimuje — viz poznámka
// v server/pb_hooks/main.pb.js.) Po dietě 4. 8. 2026 ~453 kB, strop drží
// úsporu zamčenou: s původními 560 by balík mohl tiše vyrůst zpátky o 100+ kB
// a test by mlčel. Rezerva je na růst lite režimu, ne na přilepení knihoven
// plné verze — samotný ReactFlow má 670 kB.
// 11. 8. 2026: 480 → 490. Vlna externích kontaktů + tří stylů zarovnání přidala
// ~3 kB ČISTĚ i18n textů do sdíleného jazykového balíku (žádná knihovna —
// všechny kontroly těžkých závislostí výše drží; naměřeno 483). Strop záměrně
// jen o 10 kB, ať tlak na dietu zůstává.
// 18. 8. 2026: 490 → 495. Svátek v hlavičce lite (Richard: „v režimu lite se
// nezobrazuje svátek") přinesl do balíku český jmenný kalendář. Cena se nejdřív
// osekala: data se přepsala z klíčů '1-15' na dvanáct řádků po měsících, což
// ušetřilo ~3 kB — plná appka díky tomu ZHUBLA 898 → 895 kB. Zbylé +3 kB jsou
// holá data kalendáře, levněji to nejde bez druhé kopie na serveru (= drift).
// Naměřeno 494 (opakovaně, stabilně) → do stropu zbývá 1 kB, ne 5. Jedna delší
// věta v hlavním jazykovém balíku sadu zase shodí; nové texty patří do lazy ns.
// 19. 8. 2026: 495 → 500. Barva čar podle stavu cíle (hotovo / po termínu) přidala
// do KAŽDÉHO z 11 vestavěných skinů dva tokeny × light/dark = 44 položek,
// tj. +1,6 kB HOLÝCH DAT v skins.js (naměřeno 496). Texty funkce se do lite
// nedostaly vůbec — hromadné akce i životopis mají vlastní lazy namespace
// (hromadne, historie), protože plátno mapy v lite není. Cena je čistě za skiny.
// ⚠️ Zvažováno a ZAMÍTNUTO: definovat tokeny jen u skinů, kde generická zelená
// a červená nesedí (Terminál, Les, Rubín, Vysoký kontrast, Broskev, Grafit),
// a zbytek nechat spadnout na index.css. Ušetřilo by to ~0,7 kB, tedy pořád
// přes strop — a rozbilo by to jednotnost („skin buď barvy má, nebo ne").
// Strop opět jen +5 kB, ať tlak na dietu zůstává.
// 1. 9. 2026: 500 → 505. v0.53 přidal do rychlých akcí zámek verze (ulozDoMapy v lib/mapNodes
// + taskActions) — a lite ho POUŽÍVÁ (LiteQuickAdd → addNodeToMap), takže +1 kB je funkce, ne
// balast (naměřeno 501; ušlo pozornosti, protože cílená sada lowercase lite-bundle neobsahovala —
// příště: každá změna v lib/, které se lite dotýká, = lite-bundle do cílené sady).
// Strop opět jen +5 kB, ať tlak na dietu zůstává.
const MAX_KB = Number(process.env.LITE_MAX_KB || 505);

// Balíky, které do lite režimu NESMÍ. ReactFlow = plátno mapy, Radix = dialogy
// plné verze, recharts/jspdf/html2canvas = grafy a export.
const FORBIDDEN = ['@xyflow', '@radix-ui', 'recharts', 'jspdf', 'html2canvas', 'html-to-image', '@dnd-kit'];

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// projde lite strom a všechny jeho lokální (@/…) závislosti do hloubky
const collectLocalGraph = (entryFiles) => {
  const seen = new Set();
  const stack = [...entryFiles];
  const externals = new Map(); // balík → soubor, který ho přitáhl
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith('@/')) {
        const rel = path.join(SRC, spec.slice(2));
        const cand = [rel, rel + '.js', rel + '.jsx', path.join(rel, 'index.js'), path.join(rel, 'index.jsx')];
        const hit = cand.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
        if (hit) stack.push(hit);
      } else if (spec.startsWith('.')) {
        const rel = path.resolve(path.dirname(file), spec);
        const cand = [rel, rel + '.js', rel + '.jsx', path.join(rel, 'index.js'), path.join(rel, 'index.jsx')];
        const hit = cand.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
        if (hit) stack.push(hit);
      } else if (!externals.has(spec)) {
        externals.set(spec, file);
      }
    }
  }
  return { files: seen, externals };
};

(async () => {
  console.log('== staticky: co lite strom importuje ==');
  const liteDir = path.join(SRC, 'lite');
  const entries = fs.readdirSync(liteDir).map((f) => path.join(liteDir, f));
  const { files, externals } = collectLocalGraph(entries);
  console.log(`   lite strom = ${files.size} souborů, ${externals.size} externích balíků`);
  for (const bad of FORBIDDEN) {
    const hit = [...externals.entries()].find(([spec]) => spec === bad || spec.startsWith(bad + '/'));
    expect(!hit, hit
      ? `${bad} NESMÍ do lite režimu — přitáhl ho ${path.relative(SRC, hit[1])}`
      : `${bad} v lite režimu není`);
  }

  let browser;
  try {
    console.log('== skutečně přenesené bajty na /light ==');
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p 20514:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

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

    // Přihlášení si odsud přeneseme do čistého kontextu měření.
    const auth = await page.evaluate(() => localStorage.getItem('pocketbase_auth'));

    // Měří se SKUTEČNĚ PŘENESENÉ bajty (transferSize z Resource Timing), ne
    // velikost po rozbalení — server odpovědi komprimuje a rozdíl je
    // trojnásobný (488 kB → 157 kB). puppeteerí response.buffer() vrací
    // rozbalená data, proto tudy ne.
    //
    // Každé měření běží ve VLASTNÍM anonymním kontextu. Jinak by soubory
    // podstrčil service worker z cache (transferSize = 0) a měřili bychom
    // opakovanou návštěvu místo té první — tedy přesně to, co nás nezajímá.
    // Registraci SW proto v měřicí stránce ještě navíc vypínáme.
    const measure = async (url) => {
      const ctx = await browser.createBrowserContext();
      const p = await ctx.newPage();
      await p.evaluateOnNewDocument((token) => {
        localStorage.setItem('pocketbase_auth', token);
        try { Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined }); } catch (e) { /* starší Chrome */ }
      }, auth);
      await p.goto(url, { waitUntil: 'networkidle2' });
      await sleep(2500); // doběhnutí lazy chunků po prvním vykreslení
      const res = await p.evaluate(() => {
        const js = performance.getEntriesByType('resource').filter((r) => /\.js(\?|$)/.test(r.name));
        return {
          transfer: js.reduce((s, r) => s + (r.transferSize || 0), 0),
          decoded: js.reduce((s, r) => s + (r.decodedBodySize || 0), 0),
          fromCache: js.filter((r) => !r.transferSize).length,
        };
      });
      const txt = await p.evaluate(() => document.body.innerText || '');
      await ctx.close();
      return { kb: Math.round(res.transfer / 1024), rawKb: Math.round(res.decoded / 1024), fromCache: res.fromCache, txt };
    };

    const lite = await measure(`${BASE}/lite`);
    const full = await measure(`${BASE}/`);
    console.log(`   /lite: ${lite.kb} kB přeneseno (${lite.rawKb} kB po rozbalení)`);
    console.log(`   /     : ${full.kb} kB přeneseno (${full.rawKb} kB po rozbalení)`);
    expect(lite.fromCache === 0 && full.fromCache === 0,
      `měřena PRVNÍ návštěva, nic z cache (lite ${lite.fromCache}, plná ${full.fromCache} souborů z cache)`);
    expect(lite.rawKb > 0 && lite.rawKb <= MAX_KB,
      `/lite zpracuje do ${MAX_KB} kB JS (naměřeno ${lite.rawKb} kB)`);
    expect(lite.rawKb < full.rawKb * 0.7,
      `lite režim je výrazně lehčí než plná appka (${lite.rawKb} vs ${full.rawKb} kB)`);
    expect(lite.txt.length > 0, 'lite režim se vykreslil');

    // „lite" (zjednodušený režim) × „light" (světlý motiv) jsou DVĚ RŮZNÉ VĚCI.
    // Hromadné přejmenování 27. 7. 2026 přepsalo hodnotu motivu na 'lite' a
    // nic to nechytilo — přesně proto tu ta kontrola je.
    const theme = fs.readFileSync(path.join(SRC, 'lib/theme.js'), 'utf8');
    expect(/'light'/.test(theme) && !/'lite'/.test(theme),
      "světlý motiv se ukládá jako 'light', ne 'lite' (jsou to dvě různé věci)");

    const relevant = errors.filter((e) => !e.includes('favicon') && !e.includes('ERR_NETWORK_CHANGED'));
    expect(relevant.length === 0, `konzole bez chyb (${relevant.length}${relevant.length ? ': ' + relevant[0].slice(0, 120) : ''})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
