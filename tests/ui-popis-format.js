// Formátovaný popis uzlu OČIMA UŽIVATELE.
//
// Parser hlídá popis-format.js; tady jde o to, co člověk naklikne: lišta nad
// polem, náhled, a hlavně VLOŽENÍ ODKAZU Z PŘÍLOH — kvůli tomu celá funkce
// vznikla (Richard 18. 8. 2026: v popisu má být „evidence", ne stránka dlouhé
// adresy z Google Sheets).
//
// Sada jde přes CELOU cestu: naklikat → uložit → znovu načíst stránku →
// ověřit, že se to opravdu zapsalo do mapy a že karta v mapě ukazuje čistý
// text. Kdyby se ověřovalo jen DOM po kliknutí, prošlo by i uložení, které
// nic neuloží.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-popis-format';
const PORT = 20531;
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

const otevriUzel = async (page, nazev) => page.evaluate((n) => {
  const cil = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.textContent || '').includes(n));
  if (!cil) return false;
  const tuzka = [...cil.querySelectorAll('button')]
    .find((b) => /lucide-pencil/.test(b.querySelector('svg')?.getAttribute('class') || ''));
  if (!tuzka) return false;
  tuzka.click();
  return true;
}, nazev);

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: 'admin@example.com', password: PW, passwordConfirm: PW } });
    const auth = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@example.com', password: PW } });
    const token = auth.json.token;
    const mapa = await api('POST', '/api/collections/goalmaps/records', {
      token, body: { title: 'Dokumentace procesu', edges: [], nodes: [
        { id: 'root', type: 'apex', position: { x: 0, y: 0 }, data: { apexText: 'Cíl' } },
        { id: 'n1', type: 'goal', position: { x: 0, y: 200 }, data: { title: 'Krok s popisem', status: 'todo' } },
      ] },
    });
    const mapId = mapa.json.id;

    // příloha odkazem — z ní se bude v popisu dělat pojmenovaný odkaz
    const DLOUHA = 'https://docs.google.com/spreadsheets/d/1a2B3c4D5e6F7g8H9i0J/edit#gid=0';
    await api('POST', '/api/collections/node_files/records', {
      token, body: { map: mapId, node_id: 'n1', url: DLOUHA, name: 'evidence', size: 0 },
    });

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 950 });
    const errs = [];
    // písma z Google Fonts nejsou vada aplikace (viz ui-node-links.js)
    const cizihoPuvodu = (m) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test((m.location() && m.location().url) || '');
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })), token);

    await page.goto(`${BASE}/map/${mapId}`, { waitUntil: 'networkidle2' });
    await sleep(2500);

    ok(await otevriUzel(page, 'Krok s popisem'), 'uzel jde otevřít');
    await sleep(1500);
    const dialogOtevren = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
    ok(dialogOtevren, 'detail uzlu se otevřel');
    if (!dialogOtevren) throw new Error('detail uzlu se neotevřel — další kontroly by měřily prázdno');

    console.log('== psaní do prázdného popisu (tichá ztráta dat) ==');
    // ⚠️⚠️ Sada tohle MUSÍ psát skutečnou klávesnicí, ne nastavením value.
    // Zámek popisu si první napsaný znak spletl s načtením textu ze serveru,
    // pole se odmountovalo a zbytek věty padal do prázdna — v poli zůstalo
    // jedno písmeno. Programové nastavení hodnoty to nechytí (nález panelu
    // 19. 8. 2026, sadu tehdy shodilo až psaní znak po znaku).
    await page.click('#description');
    await page.keyboard.type('Postup krok za krokem', { delay: 15 });
    await sleep(500);
    const napsano = await page.evaluate(() => {
      const ta = document.querySelector('[role="dialog"] #description');
      return ta ? ta.value : null;
    });
    ok(napsano === 'Postup krok za krokem',
      `celá napsaná věta zůstane v poli (${JSON.stringify(napsano)})`);
    // uklidit, ať zbytek sady začíná z čistého
    await page.evaluate(() => {
      const ta = document.querySelector('[role="dialog"] #description');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(300);

    console.log('== lišta formátování ==');
    const listaOk = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return !!d.querySelector('#description') && !!d.querySelector('[data-popis-odkaz]');
    });
    ok(listaOk, 'nad popisem je lišta s tlačítkem odkazu');

    // napsat text a označit slovo → kliknout na tučné
    await page.evaluate(() => {
      const ta = document.querySelector('[role="dialog"] #description');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'Postup krok za krokem');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(400);
    await page.evaluate(() => {
      const ta = document.querySelector('[role="dialog"] #description');
      ta.focus();
      ta.setSelectionRange(0, 6);   // slovo „Postup"
      const b = [...document.querySelectorAll('[role="dialog"] button')]
        .find((x) => /lucide-bold/.test(x.querySelector('svg')?.getAttribute('class') || ''));
      b?.click();
    });
    await sleep(500);
    const poTucnem = await page.evaluate(() => document.querySelector('[role="dialog"] #description')?.value || '');
    ok(poTucnem.startsWith('**Postup**'), `tlačítko B obalilo označené slovo (${poTucnem.slice(0, 24)})`);

    console.log('== odkaz z přílohy uzlu ==');
    await page.evaluate(() => {
      const ta = document.querySelector('[role="dialog"] #description');
      ta.focus();
      const konec = ta.value.length;
      ta.setSelectionRange(konec, konec);
      document.querySelector('[role="dialog"] [data-popis-odkaz]')?.click();
    });
    await sleep(700);
    const nabidka = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-radix-popper-content-wrapper] button')]
        .find((x) => (x.textContent || '').includes('evidence'));
      if (!b) return { videt: false, texty: [...document.querySelectorAll('[data-radix-popper-content-wrapper] button')].map((x) => x.textContent) };
      b.click();
      return { videt: true };
    });
    ok(nabidka.videt, `příloha „evidence" se nabízí k vložení (${nabidka.videt ? 'ano' : JSON.stringify(nabidka.texty)})`);
    await sleep(600);

    const sOdkazem = await page.evaluate(() => document.querySelector('[role="dialog"] #description')?.value || '');
    ok(/\[evidence\]\(https:\/\/docs\.google\.com/.test(sOdkazem),
      `v popisu je pojmenovaný odkaz, ne holá adresa (${sOdkazem.slice(-60)})`);

    console.log('== náhled ==');
    const nahledOk = await page.evaluate(() => {
      const b = document.querySelector('[role="dialog"] [data-popis-nahled]');
      if (!b) return null;
      b.click();
      return true;
    });
    ok(nahledOk, 'přepínač náhledu se nabízí, když je co ukázat');
    await sleep(500);
    const nahled = await page.evaluate(() => {
      const o = document.querySelector('[data-popis-nahled-obsah]');
      if (!o) return null;
      return {
        tucne: !!o.querySelector('strong'),
        odkaz: o.querySelector('a')?.getAttribute('href') || '',
        cil: o.querySelector('a')?.getAttribute('target') || '',
        rel: o.querySelector('a')?.getAttribute('rel') || '',
        text: o.innerText,
      };
    });
    ok(nahled?.tucne, 'náhled vykreslil tučné');
    ok(nahled?.odkaz.includes('docs.google.com'), 'náhled vykreslil odkaz na správnou adresu');
    ok(nahled?.cil === '_blank' && /noopener/.test(nahled?.rel || ''), 'odkaz se otevře v novém okně a s noopener');
    ok(nahled && !nahled.text.includes('**'), 'v náhledu nejsou vidět značky');
    ok(nahled?.text.includes('evidence') && !nahled.text.includes('spreadsheets'),
      'v náhledu je vidět POPISEK, ne dlouhá adresa');

    console.log('== uložení a skutečný zápis do mapy ==');
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /^(Uložit|Save)$/i.test((x.textContent || '').trim()));
      b?.click();
    });
    await sleep(2000);

    const ulozeno = await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token });
    const uzel = (ulozeno.json.nodes || []).find((n) => n.id === 'n1');
    ok(/\*\*Postup\*\*/.test(uzel?.data?.description || ''), 'značky se DOOPRAVDY uložily do mapy');
    ok(/\[evidence\]\(/.test(uzel?.data?.description || ''), 'pojmenovaný odkaz se uložil');

    console.log('== karta v mapě ukazuje čistý text ==');
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2500);
    const naKarte = await page.evaluate(() => {
      const cil = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.textContent || '').includes('Krok s popisem'));
      const p = cil?.querySelector('[data-popis-uzlu]');
      return p ? p.textContent : null;
    });
    ok(naKarte !== null, 'popis je na kartě vidět');
    ok(naKarte !== null && !naKarte.includes('**'), `na kartě NEJSOU vidět značky (${naKarte})`);
    ok(naKarte !== null && naKarte.includes('evidence') && !naKarte.includes('docs.google.com'),
      'na kartě je „evidence", ne dlouhá adresa — kvůli tomu to celé vzniklo');

    ok(errs.length === 0, `konzole bez chyb (${errs.length ? errs[0].slice(0, 120) : 'čistá'})`);
  } catch (e) {
    fail++;
    console.log(`  ❌ výjimka: ${e.message}`);
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} ${pass} OK, ${fail} chyb`);
  process.exit(fail === 0 ? 0 : 1);
})();
