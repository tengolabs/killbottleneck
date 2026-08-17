// UI e2e: TICHÝ MERGE zásahu automatizace do rozepsané práce.
//
// Richardův nález na cloudu (17. 8.): uživatel označí kanbanovou kartu Hotovo,
// server ji pravidlem správně přesune — ale editor zásah vyhodnotí jako cizí
// změnu a ukáže pruh „Mapu mezitím změnil někdo jiný". Kanban PŮSOBÍ rozbitě,
// i když funguje.
//
// ⚠️⚠️ CELÁ SADA JEDE SE SIMULOVANOU CLOUDOVOU LATENCÍ. Kód je lokálně i na
// cloudu bit po bitu stejný — rozdíl dělá LATENCE: lokálně se uložení vrátí
// dřív, než uživatel cokoli rozepíše, na cloudu (stovky ms) je při návratu
// odpovědi rozepsaný skoro vždycky, a tím padal do bezpečné větve s pruhem.
// Klik-testy jedou proti localhostu, proto vadu nikdy nechytily. Bez emulace
// latence tenhle test o cloudu LŽE — přesně tak vada unikla.
//
// Hlídá se obojí:
//   POZITIVNÍ — zásah pravidla, kterého se uživatel nedotkl, se slije tiše
//   NEGATIVNÍ — skutečná kolize (obě strany na témže uzlu) i cizí LIDSKÁ
//               změna dál končí pruhem/dialogem; jinak by se tichý merge stal
//               tichým přepisem
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'flowmap-e2e-tichy-merge';
const PORT = 20536;
// REŽIM „PROTI OSTRÉ INSTANCI": `KB_E2E_BASE=https://test.killbottleneck.com`
// (+ KB_E2E_EMAIL, KB_E2E_PW). Nezvedá se docker a NEEMULUJE se latence —
// měří se ta skutečná. Právě proto tenhle režim existuje: vada je latencí
// volená větev a emulace je jen náhražka za ostrý provoz.
const VZDALENE = !!process.env.KB_E2E_BASE;
const BASE = process.env.KB_E2E_BASE || `http://127.0.0.1:${PORT}`;
const UCET = process.env.KB_E2E_EMAIL || 'a@e2e.cz';
const PW = process.env.KB_E2E_PW || 'testheslo123';
// RTT simulované cloudové linky (zadání: ~200–400 ms); vzdáleně se needituje
const RTT_MS = 300;

let pass = 0; let fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, p, { token, body } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};

const freshMap = async (token, id) => (await api('GET', `/api/collections/goalmaps/records/${id}`, { token })).json;
const parentOf = (m, id) => { const e = (m.edges || []).find((x) => x.target === id); return e ? e.source : ''; };
const titleOf = (m, id) => ((m.nodes || []).find((n) => n.id === id) || {}).data?.title || '';

(async () => {
  let browser; let uklidMapa = null;
  try {
    if (!VZDALENE) {
      execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
      execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
      for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
      await api('POST', '/api/collections/users/records', { body: { email: UCET, password: PW, passwordConfirm: PW } });
    }
    const A = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: UCET, password: PW } })).json.token;

    // Kanbanová mapa: sloupce D1/D2, karta K1 pod D1, a jeden uzel, který si
    // bude uživatel rozepisovat.
    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Kanban souběh',
      nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Proces', title: 'Proces', status: 'todo' } },
        { id: 'D1', type: 'goalNode', position: { x: 0, y: 120 }, data: { title: 'Sloupec Dělá se', status: 'todo' } },
        { id: 'D2', type: 'goalNode', position: { x: 300, y: 120 }, data: { title: 'Sloupec Hotovo', status: 'todo' } },
        { id: 'K1', type: 'goalNode', position: { x: 0, y: 260 }, data: { title: 'Karta jedna', status: 'todo', owner: 'a@e2e.cz' } },
        { id: 'K2', type: 'goalNode', position: { x: 150, y: 260 }, data: { title: 'Karta dvě', status: 'todo', owner: 'a@e2e.cz' } },
        { id: 'K3', type: 'goalNode', position: { x: 300, y: 260 }, data: { title: 'Karta tři', status: 'todo', owner: 'a@e2e.cz' } },
        { id: 'muj', type: 'goalNode', position: { x: 600, y: 120 }, data: { title: 'Můj krok', status: 'todo', owner: 'a@e2e.cz' } },
      ],
      edges: [
        { id: 'e1', source: 'root', target: 'D1' }, { id: 'e2', source: 'root', target: 'D2' },
        { id: 'e3', source: 'D1', target: 'K1' }, { id: 'e4', source: 'root', target: 'muj' },
        { id: 'e5', source: 'D1', target: 'K2' }, { id: 'e6', source: 'D1', target: 'K3' },
      ],
    } })).json;

    // SKUTEČNÉ kanbanové pravidlo (přes session routu = stejná cesta jako builder):
    // karta pod D1 označená Hotovo se přesune pod D2. Přesun mění hranu I pozice
    // (pravidla ukládají s přerovnáním) — přesně to, co dřív vždycky vyrobilo pruh.
    const rule = (await api('POST', '/api/kb/rules/save', { token: A, body: {
      map: map.id,
      name: 'Kanban: hotová karta jde do D2',
      trigger: { type: 'node_status_changed', status: 'done' },
      conditions: [{ field: 'parent', op: 'eq', value: 'D1' }],
      actions: [{ type: 'move_node', to: 'D2' }],
    } })).json;
    expect(!!(rule && rule.rule && rule.rule.id), 'kanbanové pravidlo založeno');
    uklidMapa = () => api('DELETE', `/api/collections/goalmaps/records/${map.id}`, { token: A });

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    const errs = [];
    // Chyby z GOOGLE FONTS nejsou vada aplikace (viz ui-conflict-merge.js) —
    // adresa je v m.location().url, ne v textu hlášky.
    const cizihoPuvodu = (m) => {
      const u = (m.location() && m.location().url) || '';
      return /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u);
    };
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', UCET);
    await page.type('#password', PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1500);
    await page.goto(`${BASE}/map/${map.id}`, { waitUntil: 'networkidle2' });
    await sleep(2500);

    // POŘADÍ JE PODSTATNÉ: nechat doběhnout úvodní autosave po načtení, teprve
    // pak pouštět „automatizaci" — jinak by zásah přepsal mapu zastaralými uzly
    // a vyrobil falešnou kolizi obsahu (test by měřil něco jiného, než má).
    await sleep(3000);

    // ⚠️ TEĎ ZAPNOUT CLOUDOVOU LATENCI. Až tady, ať se načítání nevleče.
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    const latenceZap = async (ms) => (VZDALENE ? null : cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: ms, downloadThroughput: 1.5 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8,
    }));
    await latenceZap(RTT_MS);
    console.log(VZDALENE
      ? `  · ostrá instance ${BASE} — měří se SKUTEČNÁ latence, nic se neemuluje`
      : `  · zapnuta simulovaná cloudová latence ${RTT_MS} ms RTT`);

    const otevriUzel = async (text) => page.evaluate((txt) => {
      const h = [...document.querySelectorAll('h3')].find((x) => new RegExp(txt).test(x.innerText || ''));
      if (!h) return false;
      h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    }, text);
    const prepisNazev = async (novy) => {
      // ⚠️ Vymazat pole přes `i.value = ''` NESTAČÍ — React o tom neví a nový
      // text se jen přilepí za starý (v druhém kole to vyrobilo „PRVNÍ
      // ÚPRAVADRUHÁ ÚPRAVA" a vypadalo to jako vada produktu).
      await page.focus('#title');
      await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.type('#title', novy);
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /^(Uložit|Save)/.test((x.innerText || '').trim()));
        if (b) b.click();
      });
    };
    const telo = () => page.evaluate(() => document.body.innerText);
    const pruh = async () => /Mapu mezitím změnil někdo jiný/i.test(await telo());
    const dialog = async () => /Mapa byla mezitím změněna/i.test(await telo());

    // ================= 1. POZITIVNÍ: pravidlo přesune kartu, já mezitím píšu ==========
    console.log('\n== 1. kanbanový přesun pravidlem + moje rozepsaná změna jinde ==');
    {
      const m = await freshMap(A, map.id);
      await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: {
        nodes: m.nodes.map((n) => (n.id === 'K1' ? { ...n, data: { ...n.data, status: 'done' } } : n)),
        edges: m.edges,
        base_updated: m.updated,
      } });
      await sleep(600);
      const poPravidle = await freshMap(A, map.id);
      expect(parentOf(poPravidle, 'K1') === 'D2', `pravidlo kartu na serveru přesunulo (rodič ${parentOf(poPravidle, 'K1')})`);

      // ...a TEĎ uživatel rozepíše svou změnu na JINÉM uzlu, aniž by o tom věděl
      expect(await otevriUzel('Můj krok'), 'otevřen dialog mého cíle');
      await sleep(1200);
      await prepisNazev('Můj krok ROZEPSANÝ');
      await sleep(6000);

      expect(!(await pruh()), 'NEVYSKOČIL pruh „Mapu mezitím změnil někdo jiný"');
      expect(!(await dialog()), 'nevyskočil ani dialog konfliktu');
      const t = await telo();
      expect(/ROZEPSANÝ/.test(t), 'moje rozepsaná změna zůstala v mapě');

      // karta odjela před očima: plátno ji kreslí pod D2 (ne jen databáze)
      const hran = await page.evaluate(() => document.querySelectorAll('.react-flow__edge').length);
      expect(hran >= 4, `plátno dál kreslí hrany (${hran}) — nezmizely při převzetí`);

      await sleep(3000);
      const po = await freshMap(A, map.id);
      expect(titleOf(po, 'muj') === 'Můj krok ROZEPSANÝ', `moje změna se uložila (${titleOf(po, 'muj')})`);
      expect(parentOf(po, 'K1') === 'D2', `přesun od pravidla se nepřepsal zpátky (rodič ${parentOf(po, 'K1')})`);
    }

    // ========== 1b. TOTÉŽ, ale odklikne to UŽIVATEL SÁM (Richardova cesta) ==========
    // Rozdíl proti bodu 1: pravidlo tu spouští MOJE uložení, takže se nejde přes
    // 409, ale přes kontrolu verze hned po autosave. Přesně tady Richardův případ
    // padal do pruhu — a jen tady, protože jinou větev latence nevolí.
    console.log('\n== 1b. Hotovo odklikne uživatel v UI, a hned píše jinde ==');
    {
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForSelector('.react-flow__node', { timeout: 45000 });
      await sleep(3500);
      // ⚠️ Pomalejší linka schválně: okno mezi odesláním PATCHe a dorovnáním
      // musí být tak široké, aby se do něj vešlo lidské psaní. Na rychlé lince
      // by test proklouzl tichou větví a NIC BY NEDOKAZOVAL.
      await latenceZap(800);
      const cyklus = async () => page.evaluate(() => {
        const uzel = [...document.querySelectorAll('.react-flow__node')].find((n) => (n.textContent || '').includes('Karta dvě'));
        const b = uzel && uzel.querySelector('button');
        if (b) b.click();
        return !!b;
      });
      expect(await cyklus(), 'našel jsem stavový odznak karty');   // → Probíhá
      await sleep(900);
      await cyklus();                                              // → Hotovo (spustí pravidlo)
      // ...a než se uložení vrátí, uživatel rozepisuje jiný uzel
      await sleep(300);
      expect(await otevriUzel('Můj krok'), 'otevřen dialog jiného cíle během letícího uložení');
      await sleep(900);
      await page.evaluate(() => { const i = document.querySelector('#title'); if (i) i.value = ''; });
      await page.type('#title', 'Můj krok BĚHEM UKLÁDÁNÍ');
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /^(Uložit|Save)/.test((x.innerText || '').trim()));
        if (b) b.click();
      });
      await sleep(9000);

      expect(!(await pruh()), 'NEVYSKOČIL pruh „Mapu mezitím změnil někdo jiný" (Richardův případ)');
      expect(!(await dialog()), 'nevyskočil ani dialog konfliktu');
      const po = await freshMap(A, map.id);
      expect(parentOf(po, 'K2') === 'D2', `karta odjela do D2 (rodič ${parentOf(po, 'K2')})`);
      expect(titleOf(po, 'muj') === 'Můj krok BĚHEM UKLÁDÁNÍ', `moje rozepsaná změna se uložila (${titleOf(po, 'muj')})`);
      await latenceZap(RTT_MS);
    }

    // ================= 2. NEGATIVNÍ: obě strany na TÉMŽE uzlu ==========
    console.log('\n== 2. skutečná kolize: obě ruce na jednom uzlu ==');
    {
      expect(await otevriUzel('Můj krok BĚHEM UKLÁDÁNÍ'), 'otevřen dialog téhož cíle');
      await sleep(1200);
      // cizí klient přepíše TENTÝŽ uzel dřív, než své uložím
      const m = await freshMap(A, map.id);
      await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: {
        nodes: m.nodes.map((n) => (n.id === 'muj' ? { ...n, data: { ...n.data, title: 'Můj krok OD KOLEGY' } } : n)),
        edges: m.edges,
        base_updated: m.updated,
      } });
      await prepisNazev('Můj krok ODE MĚ');
      await sleep(6000);
      expect((await pruh()) || (await dialog()), 'kolize na témže uzlu DÁL končí pruhem/dialogem');
      expect(/ODE MĚ/.test(await telo()), 'moje rozepsaná změna se přitom nezahodila');
    }

    // ================= 3. NEGATIVNÍ: cizí LIDSKÁ změna bez pravidla ==========
    // Strukturální změna, které se nedotýkám, ale nestojí za ní žádné pravidlo →
    // pruh musí zůstat. Bez téhle podmínky by tichý merge polykal práci kolegů.
    console.log('\n== 3. cizí lidská změna struktury (bez pravidla) → pruh zůstává ==');
    {
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(3500);
      await latenceZap(RTT_MS);
      const m = await freshMap(A, map.id);
      // kolega přepojí kartu K1 zpátky pod D1 RUČNĚ (žádný trigger stavu → žádné pravidlo)
      await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: {
        nodes: m.nodes,
        edges: m.edges.map((e) => (e.target === 'K1' ? { ...e, source: 'D1' } : e)),
        base_updated: m.updated,
      } });
      await sleep(600);
      expect(await otevriUzel('Můj krok'), 'otevřen dialog mého cíle');
      await sleep(1200);
      await prepisNazev('Můj krok DRUHÉ KOLO');
      await sleep(6000);
      expect((await pruh()) || (await dialog()), 'cizí lidská změna struktury dál hlásí pruh/dialog');
    }

    // ========== 4. Editace PŘÍMO BĚHEM okna slévání ==========
    // Mezi snímkem plátna a jeho nasazením proběhne pár síťových kol. Kdyby se
    // nasadil zastaralý snímek, uživatelova práce z toho okna se ZTRATÍ — a to
    // je nejhorší možný následek celé téhle změny. Na pomalé lince je okno
    // široké, takže se do něj druhá úprava spolehlivě trefí.
    console.log('\n== 4. píšu PŘÍMO BĚHEM slévání → nic se nesmí ztratit ==');
    {
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForSelector('.react-flow__node', { timeout: 45000 });
      await sleep(3500);
      await latenceZap(1200);
      const m = await freshMap(A, map.id);
      await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: {
        nodes: m.nodes.map((n) => (n.id === 'K3' ? { ...n, data: { ...n.data, status: 'done' } } : n)),
        edges: m.edges,
        base_updated: m.updated,
      } });
      await sleep(300);
      // první úprava rozjede slévání…
      expect(await otevriUzel('Můj krok'), 'otevřen dialog mého cíle');
      await sleep(1500);
      await prepisNazev('PRVNÍ ÚPRAVA');
      // …a druhá dopadne doprostřed jeho síťových kol
      await sleep(1800);
      expect(await otevriUzel('PRVNÍ ÚPRAVA'), 'otevřen dialog podruhé, uprostřed slévání');
      await sleep(1200);
      await prepisNazev('DRUHÁ ÚPRAVA BĚHEM SLÉVÁNÍ');
      await sleep(12000);

      const t2 = await telo();
      expect(/DRUHÁ ÚPRAVA BĚHEM SLÉVÁNÍ/.test(t2), 'druhá úprava se na plátně NEZTRATILA');
      expect(!/PRVNÍ ÚPRAVA(?!\w)/.test(t2.replace(/DRUHÁ ÚPRAVA BĚHEM SLÉVÁNÍ/g, '')), 'plátno se nevrátilo k zastaralému snímku');
      const po4 = await freshMap(A, map.id);
      const ulozeno = titleOf(po4, 'muj');
      expect(ulozeno === 'DRUHÁ ÚPRAVA BĚHEM SLÉVÁNÍ' || /Mapu mezitím změnil/.test(t2),
        `práce z okna slévání se buď uložila, nebo se poctivě přiznal pruh (uloženo: ${ulozeno})`);
      await latenceZap(RTT_MS);
    }

    const real = errs.filter((e) => !/favicon|Failed to load resource/i.test(e));
    expect(real.length === 0, `konzole bez chyb (${real.slice(0, 2).join(' | ') || 'čistá'})`);
  } catch (err) {
    fail++;
    console.log('  ❌ výjimka: ' + (err && err.stack ? err.stack : err));
  } finally {
    if (browser) await browser.close();
    // po sobě uklidit i na ostré instanci — testovací mapa tam zůstat nemá
    if (VZDALENE && uklidMapa) { try { await uklidMapa(); } catch { /* nevadí */ } }
    if (!VZDALENE) { try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch { /* už je pryč */ } }
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} UI TICHÝ MERGE PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
