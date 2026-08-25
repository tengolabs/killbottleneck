// Odkaz jako příloha OČIMA UŽIVATELE + hostovaná verze bez nahrávání.
//
// Serverovou stranu hlídá node-links.js. Tady jde o to, co člověk vidí a naklikne:
// v hostované verzi nesmí být tlačítko, které by stejně skončilo chybou, a přidání
// odkazu musí projít celou cestou od kliknutí po položku v seznamu.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'flowmap-e2e-node-links';
const PORT = 20524;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};

// text všech tlačítek v otevřeném dialogu
const tlacitka = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[role="dialog"] button')].map((b) => (b.textContent || '').trim()).filter(Boolean));

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    // hostovaná verze: nahrávání vypnuté, přílohy jen jako odkaz
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p ${PORT}:8090 -e FLOWMAP_FILES_MB=0 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: 'admin@example.com', password: PW, passwordConfirm: PW } });
    const auth = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@example.com', password: PW } });
    const token = auth.json.token;
    const mapa = await api('POST', '/api/collections/goalmaps/records', {
      token, body: { title: 'Projekt s přílohami', edges: [], nodes: [
        { id: 'root', type: 'apex', position: { x: 0, y: 0 }, data: { apexText: 'Cíl' } },
        { id: 'n1', type: 'goal', position: { x: 0, y: 200 }, data: { title: 'Krok s podklady', status: 'todo' } },
      ] },
    });

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 950 });
    const errs = [];
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
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })), token);

    await page.goto(`${BASE}/map/${mapa.json.id}`, { waitUntil: 'networkidle2' });
    await sleep(2500);

    // otevřít detail uzlu = dvojklik na uzel (stejná cesta jako v aplikaci)
    // Detail se otevírá tužkou v liště uzlu. (Dvojklik na kartu funguje taky, ale
    // handler visí na vnitřním prvku — dispatch na kořen uzlu se k němu nedostane,
    // což vypadalo jako „dialog se neotevřel".)
    const otevreno = await page.evaluate(() => {
      const uzly = [...document.querySelectorAll('.react-flow__node')];
      const cil = uzly.find((n) => (n.textContent || '').includes('Krok s podklady'));
      if (!cil) return false;
      const tuzka = [...cil.querySelectorAll('button')]
        .find((b) => /lucide-pencil/.test(b.querySelector('svg')?.getAttribute('class') || ''));
      if (!tuzka) return false;
      tuzka.click();
      return true;
    });
    ok(otevreno, 'uzel je na plátně a jde otevřít');
    await sleep(1500);

    const dialogOtevren = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
    ok(dialogOtevren, 'detail uzlu se otevřel');
    // bez dialogu by zbytek sady procházel z prázdna („tlačítko se neukazuje",
    // protože se neukazuje nic) — radši rovnou stop
    if (!dialogOtevren) throw new Error('detail uzlu se neotevřel — další kontroly by měřily prázdno');

    // editor mapy má od 14. 8. 2026 VELKÉ okno s kategoriemi — přílohy bydlí
    // v kategorii „Přílohy", je potřeba na ni nejdřív kliknout
    const kategorieOk = await page.evaluate(() => {
      const b = document.querySelector('[role="dialog"] [data-cat="files"]');
      if (!b) return false;
      b.click();
      return true;
    });
    ok(kategorieOk, 'kategorie Přílohy existuje v levém menu');
    await sleep(600);

    const b1 = await tlacitka(page);
    ok(b1.some((t) => /Přidat odkaz/i.test(t)), `nabízí se „Přidat odkaz" (${b1.filter((t) => /odkaz|přílohu/i.test(t)).join(', ') || '—'})`);
    // nezávisle na překladu: v hostované verzi nesmí být vstup na soubor vůbec
    const maVstupSouboru = await page.evaluate(() => !!document.querySelector('[role="dialog"] input[type=file]'));
    ok(!maVstupSouboru, 'v hostované verzi není v dialogu ani vstup pro soubor');
    // ⚠️ Hledat KONKRÉTNÍ větu, ne slovo „odkaz" v celém dialogu — to tam je
    // i z tlačítka „Přidat odkaz", takže by kontrola nemohla selhat (nález panelu).
    const vysvetleni = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText || ''));
    ok(/instanci se soubory nenahrávají/i.test(vysvetleni),
      `uživatel se dozví, PROČ tam nahrávání není (${/nenahrávají/i.test(vysvetleni) ? 'věta nalezena' : vysvetleni.slice(0, 80)})`);

    // přidat odkaz celou klikací cestou
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Přidat odkaz/i.test(x.textContent || ''));
      b && b.click();
    });
    await sleep(600);
    const poleOk = await page.evaluate(() => {
      const vstupy = [...document.querySelectorAll('[role="dialog"] input')].filter((i) => i.type !== 'file');
      const adresa = vstupy.find((i) => /https/i.test(i.placeholder || ''));
      if (!adresa) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(adresa, 'https://drive.google.com/file/d/zkouska/view');
      adresa.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    ok(poleOk, 'formulář na odkaz se rozbalil');
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Uložit odkaz/i.test(x.textContent || ''));
      b && b.click();
    });
    await sleep(1800);

    // Odkaz na Disk bez vlastního názvu dostává od 11. 8. 2026 lidský název
    // „Soubor na Disku Google" (dřív se ukazovalo useknuté URL) — v seznamu se
    // proto hledá název; že se uložila SPRÁVNÁ adresa, hlídá kontrola serveru níž.
    const vSeznamu = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText || '').includes('Soubor na Disku Google'));
    ok(vSeznamu, 'odkaz se objevil v seznamu příloh (s lidským názvem Disku)');

    const ulozeno = await api('GET', `/api/collections/node_files/records?filter=(map='${mapa.json.id}')`, { token });
    ok(ulozeno.json?.items?.[0]?.url?.includes('drive.google.com'), 'a doopravdy se uložil na server');
    ok(ulozeno.json?.items?.[0]?.size === 0, 'nezabírá místo (size 0)');

    const real = errs.filter((e) => !/favicon|Failed to load resource/i.test(e));
    ok(real.length === 0, `konzole bez chyb (${real.slice(0, 2).join(' | ') || 'čistá'})`);
  } catch (e) {
    fail++; console.log(`  ❌ výjimka: ${e.message}`);
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${pass} OK, ${fail} chyb`);
  process.exit(fail ? 1 : 0);
})();
