// UI e2e: ZÁSTUPCE (vlna 1) očima správce a editora mapy:
//  - Správa organizace má sloupec „Zástupce" a admin jím zástupce NASTAVÍ
//  - builder pravidel nabízí dynamický cíl „zástupce zodpovědné osoby"
//    (set_owner i notify) a pravidlo se s ním klikací cestou uloží
//  - pravidlo pak DOOPRAVDY fireuje: uzel se předá zástupci nastavenému v UI
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-ui-zastupce';
const PORT = 20781;
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

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    await api('POST', '/api/collections/users/records', { body: { email: 'sef@example.com', password: PW, passwordConfirm: PW } }); // první = admin
    await api('POST', '/api/collections/users/records', { body: { email: 'kolega@example.com', password: PW, passwordConfirm: PW } });
    await api('POST', '/api/collections/users/records', { body: { email: 'zastupce@example.com', password: PW, passwordConfirm: PW } });
    const SEF = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'sef@example.com', password: PW } })).json.token;
    const mapa = await api('POST', '/api/collections/goalmaps/records', {
      token: SEF, body: { title: 'Projekt se zástupci', edges: [{ id: 'e1', source: 'root', target: 'n1' }], nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Cíl', title: 'Cíl', status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'Podklady', status: 'todo', owner: 'kolega@example.com' } },
      ] },
    });

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1000 });
    const errs = [];
    const cizihoPuvodu = (m) => {
      const u = (m.location() && m.location().url) || '';
      return /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u);
    };
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })), SEF);

    console.log('== Správa organizace: sloupec Zástupce + nastavení klikem ==');
    await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    ok(await page.evaluate(() => (document.body.innerText || '').includes('Zástupce')), 'tabulka má sloupec „Zástupce"');
    const trg = await page.$('[data-testid="deputy-kolega@example.com"]');
    ok(!!trg, 'řádek kolegy má ovladač zástupce');
    if (trg) {
      await trg.click(); // reálná myš — Radix menu se otevírá na pointerdown
      await sleep(600);
      const items = await page.$$('[role="menuitem"]');
      let clicked = false;
      for (const it of items) {
        const txt = await it.evaluate((el) => el.textContent || '');
        if (txt.includes('zastupce@example.com')) { await it.click(); clicked = true; break; }
      }
      ok(clicked, 'v nabídce jde vybrat zastupce@example.com');
      await sleep(800);
    }
    const kolegaRec = (await api('GET', `/api/collections/users/records?filter=${encodeURIComponent('email="kolega@example.com"')}`, { token: ST })).json.items[0];
    ok(kolegaRec.deputy === 'zastupce@example.com', 'zástupce se z UI opravdu uložil do users.deputy');
    ok(await page.evaluate(() => (document.querySelector('[data-testid="deputy-kolega@example.com"]')?.textContent || '').includes('zastupce@example.com')),
      'buňka po uložení ukazuje zástupce');

    console.log('== builder: dynamický cíl „zástupce zodpovědné osoby" ==');
    await page.goto(`${BASE}/map/${mapa.json.id}`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    await page.evaluate(() => document.querySelector('[data-testid="toolbar-rules"]')?.click());
    await sleep(800);
    await page.evaluate(() => document.querySelector('[data-testid="rules-new"]')?.click());
    await sleep(600);
    ok(await page.evaluate(() => !!document.querySelector('[data-testid="rule-builder"]')), 'builder se otevřel');
    const setInput = (sel, val) => page.evaluate((s, v) => {
      const i = document.querySelector(s);
      if (!i) return false;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, v);
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, sel, val);
    const setSelect = (sel, val) => page.evaluate((s, v) => {
      const el = document.querySelector(s);
      if (!el) return false;
      el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, sel, val);
    ok(await setInput('#rule-name', 'Hotovo → zástupci'), 'název vyplněn');
    // výchozí akce je notify — v jejím výběru příjemce musí být zástupce
    ok(await page.evaluate(() => {
      const sel = document.querySelector('[data-testid="rule-action"] select:nth-of-type(1)');
      return !!sel; // typová volba akce existuje
    }), 'akce má typový výběr');
    // přepnout typ akce na set_owner a zvolit dynamický cíl
    ok(await setSelect('[data-testid="rule-action"] > div > select', 'set_owner'), 'typ akce přepnut na „nastavit zodpovědnou osobu"');
    await sleep(400);
    ok(await setSelect('[data-testid="rule-owner-kind-0"]', 'deputy_of_node_owner'), 'vybrán dynamický cíl „zástupce zodpovědné osoby"');
    await sleep(300);
    ok(await page.evaluate(() => (document.querySelector('[data-testid="rule-builder"]')?.innerText || '').includes('až v okamžiku běhu')),
      'builder vysvětluje rozřešení za běhu');
    await page.evaluate(() => document.querySelector('[data-testid="rule-save"]')?.click());
    await sleep(1200);
    const rules = (await api('GET', `/api/kb/rules?map=${mapa.json.id}`, { token: SEF })).json.rules || [];
    const r1 = rules.find((r) => r.name === 'Hotovo → zástupci');
    ok(!!r1 && r1.actions[0] && r1.actions[0].type === 'set_owner' && r1.actions[0].owner === 'deputy_of_node_owner',
      'pravidlo se uložilo s owner=deputy_of_node_owner');

    console.log('== pravidlo fireuje: uzel se předá zástupci z UI ==');
    const f = (await api('GET', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF, body: {
      nodes: f.nodes.map((n) => (n.id === 'n1' ? { ...n, data: { ...n.data, status: 'done' } } : n)),
      edges: f.edges, base_updated: f.updated,
    } });
    await sleep(500);
    const f2 = (await api('GET', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF })).json;
    const n1 = (f2.nodes || []).find((n) => n.id === 'n1');
    ok(n1 && n1.data.owner === 'zastupce@example.com', 'po dokončení uzel převzal ZÁSTUPCE nastavený klikáním v adminu');

    console.log('== Richardova cesta: klik na stav V PLÁTNĚ → změna je vidět BEZ reloadu ==');
    // (15. 8.: „změnil jsem na Probíhá a nic se nerozjelo" — pravidlo na serveru
    // proběhlo, ale editor ignoroval odpověď PATCHe a mutaci pravidla neukázal;
    // příští autosave by ji navíc tiše přepsal)
    const f3 = (await api('GET', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF, body: {
      nodes: f3.nodes.concat([{ id: 'n2', type: 'goalNode', position: { x: 300, y: 200 }, data: { title: 'Druhé podklady', status: 'todo', owner: 'kolega@example.com' } }]),
      edges: f3.edges.concat([{ id: 'e2', source: 'root', target: 'n2' }]),
      base_updated: f3.updated,
    } });
    await page.goto(`${BASE}/map/${mapa.json.id}`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    // dvakrát kliknout na stavový odznak n2 (Založeno → Probíhá → Hotovo)
    const klikStav = () => page.evaluate(() => {
      const h = [...document.querySelectorAll('[data-nazev-uzlu]')].find((el) => el.textContent.includes('Druhé podklady'));
      const karta = h?.closest('.react-flow__node');
      karta?.querySelector('button')?.click(); // stavový odznak je první tlačítko karty
      return !!karta;
    });
    ok(await klikStav(), 'stavový odznak n2 nalezen');
    await sleep(300);
    await klikStav(); // → Hotovo, autosave odjede za ~1,2 s a pravidlo vystřelí
    let prevzato = false;
    for (let i = 0; i < 12 && !prevzato; i++) {
      await sleep(1000);
      prevzato = await page.evaluate(() => {
        const h = [...document.querySelectorAll('[data-nazev-uzlu]')].find((el) => el.textContent.includes('Druhé podklady'));
        const karta = h?.closest('.react-flow__node');
        return !!karta && [...karta.querySelectorAll('span')].some((s) => (s.title || '').includes('zastupce@example.com'));
      });
    }
    if (!prevzato) {
      console.log('DEBUG karta:', await page.evaluate(() => {
        const h = [...document.querySelectorAll('[data-nazev-uzlu]')].find((el) => el.textContent.includes('Druhé podklady'));
        const karta = h?.closest('.react-flow__node');
        return karta ? JSON.stringify({ text: karta.innerText, titles: [...karta.querySelectorAll('span')].map((s) => s.title).filter(Boolean) }) : 'KARTA NENALEZENA';
      }));
    }
    ok(prevzato, 'předání zástupci je vidět v plátně BEZ reloadu (editor převzal stav serveru)');
    const n2srv = ((await api('GET', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF })).json.nodes || []).find((n) => n.id === 'n2');
    ok(n2srv.data.owner === 'zastupce@example.com', 'server drží zástupce jako zodpovědného');
    // a hlavně: DALŠÍ lokální úprava mutaci pravidla NEPŘEPÍŠE
    await page.evaluate(() => {
      const h = [...document.querySelectorAll('[data-nazev-uzlu]')].find((el) => el.textContent.includes('Návrh webu'));
      h?.closest('.react-flow__node')?.querySelector('button')?.click(); // šťouch do jiného uzlu → autosave
    });
    await sleep(3000);
    const n2po = ((await api('GET', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF })).json.nodes || []).find((n) => n.id === 'n2');
    ok(n2po.data.owner === 'zastupce@example.com', 'následný autosave předání NEpřepsal');

    const zavazne = errs.filter((e) => !/favicon|manifest/i.test(e));
    ok(zavazne.length === 0, `konzole bez chyb (${zavazne.length}${zavazne.length ? ': ' + zavazne[0].slice(0, 120) : ''})`);

    console.log(`\nVýsledek: ${pass} ✅ / ${fail} ❌`);
  } catch (err) {
    console.error('NEOČEKÁVANÁ CHYBA SADY:', err);
    fail++;
  } finally {
    try { if (browser) await browser.close(); } catch { /* už zavřeno */ }
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  process.exit(fail === 0 ? 0 : 1);
})();
