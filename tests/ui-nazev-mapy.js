// UI e2e: NÁZEV PROJEKTU V MAPĚ — vlastní pruh pod lištou.
//
// Richard 18. 8. 2026: „název mapy (projektu) je málo viditelný a když je
// dlouhý, schová se." Do té doby to byl úzký input vmáčknutý mezi ikony horní
// lišty, který dlouhý název ořízl po pár znacích.
//
// Sada hlídá tři věci, které se dají rozbít každá zvlášť:
//  1) název JE vidět a je VĚTŠÍ než dřív (měří se skutečná šířka a font-size),
//  2) dlouhý název se vejde řádově jinak než do lišty (žádných ~150 px),
//  3) přejmenování rovnou tady se DOOPRAVDY uloží (čte se z API, ne z UI),
//  4) nepřekrývá levou lištu ikon (ta začíná na top-16 = 64 px),
//  5) ⚠️ NEKRADE MYŠ PLÁTNU. První pokus byl široký průhledný `input` přes celé
//     plátno — vypadal správně, ale v pruhu 960 × 38 px nešlo chytit uzel ani
//     táhnout plátnem. Sada to nechytila, protože měřila jen pozici a písmo
//     (nález panelu /checkup 18. 8. 2026). Proto se sem měří i tažení.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-ui-nazev';
const PORT = 20990;
const BASE = `http://127.0.0.1:${PORT}`;
const UCET = 'sef@e2e.cz';
const PW = 'testheslo123';
const DLOUHY = 'Zavedení killBottlenecku do firmy — pilotní provoz na obchodním oddělení 2026';

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

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: UCET, password: PW, passwordConfirm: PW } });
    const A = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: UCET, password: PW } })).json.token;
    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: DLOUHY,
      nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Zavedení', title: 'Zavedení', status: 'todo' } },
        { id: 'k1', type: 'goalNode', position: { x: 0, y: 240 }, data: { title: 'Krok', status: 'todo' } },
      ],
      edges: [{ id: 'e1', source: 'root', target: 'k1' }],
    } })).json;
    ok(!!map.id, 'mapa s dlouhým názvem založena');

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    const errs = [];
    const cizihoPuvodu = (m) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test((m.location() && m.location().url) || '');
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', UCET);
    await page.type('#password', PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(2000);
    await page.goto(`${BASE}/map/${map.id}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    await sleep(2500);

    // V KLIDU je název tlačítko (šířka podle textu), pole až při přejmenování.
    const poleNazvu = async () => page.evaluate((t) => {
      const el = [...document.querySelectorAll('button, input')]
        .find((i) => (i.tagName === 'INPUT' ? i.value : i.textContent) === t);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { tag: el.tagName, x: r.x, y: r.y, sirka: Math.round(r.width), spodek: Math.round(r.y + r.height), pismo: Math.round(parseFloat(cs.fontSize)) };
    }, DLOUHY);

    console.log('== název je vidět, velký a na vlastním řádku ==');
    const p = await poleNazvu();
    ok(!!p, 'název projektu je v mapě k nalezení');
    ok(p && p.pismo >= 16, `písmo názvu je čitelné, ne drobné (${p && p.pismo} px; v liště bývalo 14)`);
    ok(p && p.sirka >= 600, `dlouhý název má kam růst (${p && p.sirka} px místo úzké mezery v liště)`);

    console.log('== stojí POD lištou a NAD levou lištou ikon ==');
    const listaSpodek = await page.evaluate(() => Math.round(document.querySelector('header')?.getBoundingClientRect().bottom || 0));
    ok(!!p && p.y >= listaSpodek, `název začíná pod horní lištou (název ${p && Math.round(p.y)} px, lišta končí ${listaSpodek} px)`);
    // ⚠️ Práh `y > 100` dřív vynechal NEJBLIŽŠÍHO souseda — ouško zásobníku sedí
    // na top-16, tedy 64 px. A `prvniIkona === null || …` byla vždy-zelená větev:
    // kdyby lišta ikon zmizela úplně, kontrola by prošla. Obojí z /checkup.
    const prvniIkona = await page.evaluate((spodekListy) => {
      const b = [...document.querySelectorAll('button')]
        .map((x) => x.getBoundingClientRect())
        .filter((r) => r.x < 60 && r.y > spodekListy && r.width < 60);
      return b.length ? Math.round(Math.min(...b.map((r) => r.y))) : null;
    }, listaSpodek);
    ok(prvniIkona !== null, `levá lišta ikon je na svém místě (první ikona ${prvniIkona} px)`);
    ok(prvniIkona !== null && p && p.spodek <= prvniIkona,
      `nepřekrývá levou lištu ikon (název končí ${p && p.spodek} px, ikony začínají ${prvniIkona} px)`);

    console.log('== plátno pod proužkem NENÍ mrtvé (regrese 18. 8. 2026) ==');
    const posun = () => page.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
    const vedleNazvu = await page.evaluate((t) => {
      const el = [...document.querySelectorAll('button, input')]
        .find((i) => (i.tagName === 'INPUT' ? i.value : i.textContent) === t);
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width + 120), y: Math.round(r.y + r.height / 2) };
    }, DLOUHY);
    const pred = await posun();
    await page.mouse.move(vedleNazvu.x, vedleNazvu.y);
    await page.mouse.down();
    await page.mouse.move(vedleNazvu.x - 180, vedleNazvu.y + 220, { steps: 10 });
    await page.mouse.up();
    await sleep(800);
    ok((await posun()) !== pred,
      `plátno jde táhnout ve výšce názvu (x=${vedleNazvu.x}, y=${vedleNazvu.y})`);
    const podMysi = await page.evaluate((bod) => {
      const el = document.elementFromPoint(bod.x, bod.y);
      return el ? `${el.tagName}.${String(el.className).split(' ')[0]}` : '?';
    }, vedleNazvu);
    ok(/react-flow/.test(podMysi), `vedle názvu je plátno, ne neviditelné pole (${podMysi})`);

    console.log('== přejmenování z nového místa se DOOPRAVDY uloží ==');
    await page.evaluate((t) => {
      const el = [...document.querySelectorAll('button')].find((b) => (b.textContent || '') === t);
      el.click();   // klik na název otevře přejmenování
    }, DLOUHY);
    await sleep(600);
    const jePole = await page.evaluate((t) => {
      const el = [...document.querySelectorAll('input')].find((i) => i.value === t);
      if (!el) return false;
      el.focus();
      el.setSelectionRange(0, el.value.length);
      return true;
    }, DLOUHY);
    ok(jePole, 'klik na název otevřel pole k přepsání');
    await page.keyboard.type('Přejmenováno proklikem');
    await page.keyboard.press('Enter');
    await sleep(4000); // autosave
    const ulozeno = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
    ok(ulozeno.title === 'Přejmenováno proklikem', `nový název je i v datech („${ulozeno.title}")`);

    console.log('== a totéž na telefonu (Android appka = WebView nad tímhle webem) ==');
    // Appka v product/mobile je Capacitor WebView nad stejným frontendem, takže
    // dostane tuhle změnu bez vlastní úpravy — ale na 390 px se lišta láme do
    // dvou řádků a proužek s názvem sedí jinde než na počítači. Richard 18. 8.
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await page.goto(`${BASE}/map/${map.id}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    await sleep(2500);
    const t = await page.evaluate(() => {
      const nadpis = [...document.querySelectorAll('button, input')]
        .find((i) => /Přejmenováno proklikem/.test(i.tagName === 'INPUT' ? i.value : (i.textContent || '')));
      const h = document.querySelector('header').getBoundingClientRect();
      if (!nadpis) return null;
      const r = nadpis.getBoundingClientRect();
      const ikony = [...document.querySelectorAll('button')].map((b) => b.getBoundingClientRect())
        .filter((b) => b.x < 60 && b.y > h.bottom && b.width < 60);
      return {
        y: Math.round(r.y), spodek: Math.round(r.y + r.height), sirka: Math.round(r.width),
        listaSpodek: Math.round(h.bottom),
        prvniIkona: ikony.length ? Math.round(Math.min(...ikony.map((i) => i.y))) : null,
        prectec: Math.round(window.innerWidth),
      };
    });
    ok(!!t, 'název je vidět i na telefonu');
    ok(t && t.y >= t.listaSpodek, `na telefonu je pod (dvouřádkovou) lištou (název ${t && t.y}, lišta končí ${t && t.listaSpodek})`);
    ok(t && t.sirka <= t.prectec, `nepřetéká z displeje (${t && t.sirka} px na ${t && t.prectec} px širokém)`);
    ok(t && t.prvniIkona !== null && t.spodek <= t.prvniIkona,
      `nepřekrývá ikony ani na telefonu (končí ${t && t.spodek}, ikony ${t && t.prvniIkona})`);

    ok(errs.length === 0, `konzole bez chyb (${errs.length}${errs.length ? ': ' + errs[0].slice(0, 160) : ''})`);
  } catch (err) {
    console.error('SADA SPADLA:', err);
    fail++;
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} UI-NAZEV-MAPY PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
