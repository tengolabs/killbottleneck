// UI e2e: TITULEK OKNA PROHLÍŽEČE (panel, hlavní lišta systému, záložka).
//
// Richard 18. 8. 2026: „v horní liště bych chtěl vidět název organizace na
// prvním místě. Příklad: Duve killBottleneck." Do té doby byl titulek natvrdo
// v index.html, takže všechna okna vypadala stejně.
//
// Sada tvrdí obojí — že se firma DOPLNÍ, i že se NEDOPLNÍ tam, kde nemá:
// nepřihlášený a instance bez vyplněné firmy musí zůstat u holého produktu.
// Kontroluje se i mapa a lite režim: obojí kreslí vlastní hlavičku a titulek
// by v nich klidně mohl chybět, kdyby seděl v AppHeaderu.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-ui-titulek';
const PORT = 20987;
const BASE = `http://127.0.0.1:${PORT}`;
const UCET = 'admin@e2e.cz';
const PW = 'testheslo123';
const PRODUKT = 'killBottleneck';

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
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: UCET, password: PW, passwordConfirm: PW } });
    const A = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: UCET, password: PW } })).json.token;
    ok(!!A, 'první účet (admin) přihlášen');

    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Projekt s titulkem',
      nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Hlavní cíl', title: 'Hlavní cíl', status: 'todo' } }],
      edges: [],
    } })).json;

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    const errs = [];
    const cizihoPuvodu = (m) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test((m.location() && m.location().url) || '');
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));
    const titulek = () => page.evaluate(() => document.title);
    // Radix menu se otevírá pointerdown → musí to být skutečný klik myší.
    const klikPodleTextu = async (re) => {
      const menu = (await page.$$('button')).filter(Boolean);
      const popisky = await page.evaluate(() => [...document.querySelectorAll('button')]
        .map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()));
      const iMenu = popisky.findIndex((x) => /Uživatelské menu|User menu/.test(x));
      if (iMenu >= 0) { await menu[iMenu].click(); await sleep(800); }
      const polozky = await page.$$('[role="menuitem"]');
      const texty = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')]
        .map((x) => x.textContent || ''));
      const i = texty.findIndex((tx) => re.test(tx));
      if (i < 0) return false;
      await polozky[i].click();
      return true;
    };

    console.log('== nepřihlášený: holý název produktu ==');
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    ok(await titulek() === PRODUKT, `přihlašovací stránka má „${PRODUKT}" (je „${await titulek()}")`);

    console.log('== přihlášený, firma zatím nevyplněná: pořád holý produkt ==');
    await page.waitForSelector('#email');
    await page.type('#email', UCET);
    await page.type('#password', PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(2500);
    ok(await titulek() === PRODUKT, `bez vyplněné firmy zůstává „${PRODUKT}" (je „${await titulek()}")`);

    console.log('== s firmou: název organizace je PRVNÍ ==');
    const r = await api('POST', '/api/collections/org_settings/records', { token: A, body: { name: 'DUVE' } });
    ok(r.status === 200, `organizace pojmenována (${r.status})`);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    const t1 = await titulek();
    ok(t1 === `DUVE ${PRODUKT}`, `titulek je „DUVE ${PRODUKT}" (je „${t1}")`);
    ok(t1.indexOf('DUVE') === 0, 'firma stojí na PRVNÍM místě, ne za produktem');

    console.log('== drží i tam, kde appka vlastní hlavičku nemá ==');
    await page.goto(`${BASE}/map/${map.id}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    await sleep(1500);
    ok(await titulek() === `DUVE ${PRODUKT}`, `v mapě „DUVE ${PRODUKT}" (je „${await titulek()}")`);
    await page.goto(`${BASE}/lite`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    ok(await titulek() === `DUVE ${PRODUKT}`, `v lite režimu „DUVE ${PRODUKT}" (je „${await titulek()}")`);

    console.log('== po odhlášení firma z titulku zmizí ==');
    // Na sdíleném počítači nesmí název firmy zůstat dalšímu člověku.
    //
    // ⚠️ POCTIVĚ: tenhle krok NEDOKAZUJE, že na to reaguje DocumentTitle.
    // `logout()` dělá tvrdé přesměrování (base44Client `window.location.href =
    // '/login'`), takže titulek přijde z index.html, kde „killBottleneck" stojí
    // natvrdo — projde to i s komponentou, která na odhlášení nesahá.
    // Ověřeno mutací 18. 8. 2026: vypnutá větev `if (!user)` sadu NEZČERVENALA.
    // Necháváme to tu jako tvrzení o CHOVÁNÍ (firma je pryč, ať už díky komukoli),
    // ne jako kontrolu komponenty — a hlavně ať to příště nikdo „neopraví"
    // v domnění, že jde o díru v pokrytí. Větev `!user` je čistě pojistka:
    // nepřihlášený má správný titulek už z index.html.
    // ⚠️ Předchozí krok skončil v LITE režimu, kde uživatelské menu plné verze
    // není — bez návratu na titulku se odhlášení nenajde (chyceno prokliknutím
    // celé sady, ne čtením).
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    const odhlaseno = await klikPodleTextu(/Odhlásit|Log out|Sign out/);
    ok(odhlaseno, 'odhlášení je v uživatelském menu k nalezení');
    await sleep(2500);
    const poOdhlaseni = await titulek();
    ok(poOdhlaseni === PRODUKT, `po odhlášení v titulku není firma (je „${poOdhlaseni}")`);
    ok(!/DUVE/.test(poOdhlaseni), 'název organizace v liště nezůstal');

    ok(errs.length === 0, `konzole bez chyb (${errs.length}${errs.length ? ': ' + errs[0].slice(0, 160) : ''})`);
  } catch (err) {
    console.error('SADA SPADLA:', err);
    fail++;
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} UI-TITULEK-OKNA PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
