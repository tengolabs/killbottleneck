// UI e2e: MAPA JE STROM — spojení, které by udělalo kruh nebo uzlu druhého
// rodiče, nesmí jít NAKLIKAT, a člověk musí dostat vysvětlení (ne tiché nic).
//
// Vada z 13. 8. 2026: mapu s kruhem šlo naklikat myší i uložit přes API.
// Rozvržení je algoritmus pro STROM a na takové mapě se zacyklilo — karta
// prohlížeče zatuhla na 100 % procesoru a mapa nešla otevřít. Zámek stylu
// (v0.25) to zesílil: layout se počítá už PŘI OTEVŘENÍ mapy, takže poškozená
// mapa vyzamkla uživatele na všech jeho zařízeních. Strop kroků v `apportion`
// je jen pojistka (radši křivý layout než zamrznutí); příčinu zavírá tohle.
//
// ⚠️ MUTAČNĚ OVĚŘENO 13. 8. 2026: se `spojeniPovoleno` vráceným na `() => null`
// (tedy „povol všechno", stav před opravou) sada spadla 10× z 18 kontrol —
// hrana přibyla, hláška nepřišla a v konzoli se objevil `RangeError: Invalid
// array length` s mapou o 0 hranách, tedy přesně to zamrznutí, kvůli kterému
// tohle vzniklo. Bez mutace by sada nedokazovala nic.
//
// Sada schválně obsahuje POZITIVNÍ protikontroly (povolené spojení MUSÍ projít) —
// kód, který zakazuje úplně všechno, tudy neprojde.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'flowmap-e2e-spojeni';
const PORT = 20567;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e TZ=Europe/Prague -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await fetch(`${BASE}/api/collections/users/records`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'strom@e2e.cz', password: PW, passwordConfirm: PW }),
    });
    const auth = await (await fetch(`${BASE}/api/collections/users/auth-with-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: 'strom@e2e.cz', password: PW }),
    })).json();

    // Mapa: vrchol → Alfa, vrchol → Beta; Gama visí VOLNĚ (bez rodiče).
    // Gama je nosič pozitivní protikontroly — pověsit ji jde, a musí to projít.
    const uzel = (id, title, x) => ({ id, type: 'goalNode', position: { x, y: 300 },
      data: { title, status: 'todo', description: '', collapsed: false, color: '', nodeType: 'normal', goalType: '', apexText: '' } });
    const mapa = await (await fetch(`${BASE}/api/collections/goalmaps/records`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth.token },
      body: JSON.stringify({
        title: 'Strom',
        nodes: [
          { id: 'R', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'Vrchol', title: '', status: 'todo' } },
          uzel('a', 'Alfa', 0), uzel('b', 'Beta', 300), uzel('c', 'Gama', 600),
        ],
        edges: [{ id: 'e1', source: 'R', target: 'a' }, { id: 'e2', source: 'R', target: 'b' }],
      }),
    })).json();
    ok(!!mapa.id, `mapa založená (${mapa.id || JSON.stringify(mapa).slice(0, 80)})`);

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    // ≥1850 px: tlačítko Zpět je pod tuhle šířku schované v menu (viz toolbar)
    await page.setViewport({ width: 1920, height: 1000 });

    const chyby = [];
    // Chyby z GOOGLE FONTS nejsou vada aplikace (index.css:1 tahá písma z
    // internetu a při bourání kontejnerů se požadavek utne — nález 12. 8. 2026).
    // Vyloučen je JEN tenhle původce, ne „všechno cizí"; adresa je v
    // m.location().url, ne v textu hlášky.
    const cizihoPuvodu = (m) => {
      const u = (m.location() && m.location().url) || '';
      return /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u);
    };
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) chyby.push(m.text()); });
    page.on('pageerror', (e) => chyby.push(String(e)));

    await page.evaluateOnNewDocument((t, r) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: r }));
      localStorage.setItem('kb-lang', 'cs');
    }, auth.token, auth.record);

    const otevri = async () => {
      await page.goto(`${BASE}/map/${mapa.id}`, { waitUntil: 'networkidle2' });
      await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 4, { timeout: 45000 }).catch(() => {});
      await sleep(1500);
    };
    await otevri();

    const pocetHran = () => page.evaluate(() => document.querySelectorAll('.react-flow__edge').length);
    // ⚠️ KOTVA PROTI ZELENÉ NA PRÁZDNÉ STRÁNCE (past z 13. 8. 2026, nález panelu
    // v sousední větvi): tvrzení „hrana nepřibyla" projde i tehdy, když se mapa
    // vůbec nevykreslí — 0 se rovná 0. Každý zákaz proto navíc trvá na tom, že
    // uzly na plátně JSOU a hran je přesně tolik, kolik má být.
    const pocetUzlu = () => page.evaluate(() => document.querySelectorAll('.react-flow__node').length);
    const zivaMapa = async (kolikHran) => (await pocetUzlu()) === 4 && (await pocetHran()) === kolikHran;
    // Střed konektoru daného uzlu: 'bottom' = odkud se táhne (nadřazený),
    // 'top' = kam se pouští (podřízený). Uzel se hledá podle nadpisu.
    const konektor = (nadpis, kde) => page.evaluate((nadpis, kde) => {
      const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes(nadpis));
      if (!n) return null;
      const h = n.querySelector(`.react-flow__handle-${kde}`);
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, nadpis, kde);

    const tahni = async (zNadpis, doNadpis) => {
      const z = await konektor(zNadpis, 'bottom');
      const do_ = await konektor(doNadpis, 'top');
      if (!z || !do_) return false;
      await page.mouse.move(z.x, z.y);
      await page.mouse.down();
      await page.mouse.move((z.x + do_.x) / 2, (z.y + do_.y) / 2, { steps: 8 });
      await page.mouse.move(do_.x, do_.y, { steps: 8 });
      await sleep(200);
      await page.mouse.up();
      await sleep(900);
      return true;
    };
    const text = () => page.evaluate(() => document.body.innerText);

    ok(await pocetUzlu() === 4, `mapa se vykreslila: 4 uzly (${await pocetUzlu()})`);
    ok(await pocetHran() === 2, `výchozí stav: 2 hrany (${await pocetHran()})`);
    ok(!!(await konektor('Alfa', 'top')) && !!(await konektor('Beta', 'bottom')),
      'konektory uzlů jsou na plátně (tažení má za co vzít)');

    console.log('== druhý rodič: Beta → Alfa (Alfa už visí pod vrcholem) ==');
    {
      const pred = await pocetHran();
      const slo = await tahni('Beta', 'Alfa');
      ok(slo, 'tažení proběhlo (konektory nalezeny)');
      const po = await pocetHran();
      // kotva PŘED měřeným tvrzením a zvlášť — z jedné spojené hlášky by nešlo
      // poznat, jestli přibyla hrana, nebo se mapa nevykreslila
      ok(await zivaMapa(2), `mapa se pořád kreslí (${await pocetUzlu()} uzlů / ${await pocetHran()} hran)`);
      ok(po === pred, `hrana NEPŘIBYLA (${pred} → ${po})`);
      ok((await text()).includes('Cíl už někde visí'), 'člověk dostal vysvětlení, ne tiché nic');
    }

    console.log('== kruh: Alfa → vrchol (vrchol je předek Alfy) ==');
    {
      const pred = await pocetHran();
      await tahni('Alfa', 'Vrchol');
      const po = await pocetHran();
      ok(await zivaMapa(2), `mapa se pořád kreslí (${await pocetUzlu()} uzlů / ${await pocetHran()} hran)`);
      ok(po === pred, `hrana NEPŘIBYLA (${pred} → ${po})`);
      ok((await text()).includes('kruh'), 'hláška mluví o kruhu');
    }

    console.log('== POZITIVNÍ protikontrola: Beta → Gama (Gama nikde nevisí) ==');
    {
      const pred = await pocetHran();
      await tahni('Beta', 'Gama');
      const po = await pocetHran();
      ok(po === pred + 1, `povolená hrana PŘIBYLA (${pred} → ${po})`);
      // a smí se i uložit — server nesmí odmítnout poctivý strom
      await sleep(2500);
      const ulozena = await (await fetch(`${BASE}/api/collections/goalmaps/records/${mapa.id}`, { headers: { Authorization: auth.token } })).json();
      ok((ulozena.edges || []).length === 3, `server uložil 3 hrany (${(ulozena.edges || []).length})`);
    }

    ok(chyby.length === 0, `konzole bez chyb${chyby.length ? ' — ' + chyby.slice(0, 3).join(' | ').slice(0, 300) : ''}`);

    console.log('== už poškozená mapa: nabídne se OPRAVA a jde vzít Zpět ==');
    {
      // Poškozenou mapu už do databáze přes API nedostaneš (hooky ji odmítnou),
      // takže se podvrhne až v odpovědi serveru — přesně jako mapa, která v DB
      // leží z doby PŘED touhle kontrolou.
      await page.setRequestInterception(true);
      const podvrh = async (req) => {
        const url = req.url();
        if (req.method() !== 'GET' || !url.includes('/api/collections/goalmaps/records')) return req.continue();
        try {
          const res = await fetch(url, { headers: { Authorization: auth.token } });
          const body = await res.json();
          const rozbij = (m) => {
            if (!m || m.id !== mapa.id) return m;
            m.edges = [...(m.edges || []), { id: 'ex', source: 'c', target: 'a' }]; // Alfa dostane druhého rodiče
            return m;
          };
          if (Array.isArray(body.items)) body.items = body.items.map(rozbij); else rozbij(body);
          return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        } catch {
          return req.continue();
        }
      };
      page.on('request', podvrh);
      const chybPred = chyby.length;
      await otevri();
      ok((await text()).includes('poškozené spojení'), 'poškozená mapa se ohlásí');
      const predOpravou = await pocetHran();
      ok(predOpravou === 4, `podvržená mapa má 4 hrany (${predOpravou})`);
      const kliklOpravit = await page.evaluate(() => {
        const b = document.querySelector('[data-repair-map]');
        if (!b) return false;
        if ((b.innerText || '').trim() !== 'Opravit') return false;
        b.click();
        return true;
      });
      ok(kliklOpravit, 'tlačítko Opravit je vidět a jde zmáčknout');
      await sleep(1200);
      ok(await pocetHran() === 3, `oprava odpojila hranu navíc (${await pocetHran()})`);
      // Zpět ji musí vrátit — oprava není nevratná
      const zpet = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Zpět');
        if (!b) return 'chybí';
        if (b.disabled) return 'zašedlé';
        b.click();
        return 'kliknuto';
      });
      ok(zpet === 'kliknuto', `tlačítko Zpět je aktivní (${zpet})`);
      await sleep(1000);
      ok(await pocetHran() === 4, `Zpět vrátilo stav před opravou (${await pocetHran()})`);
      // ⚠️ POCTIVÝ CAVEAT: poškození se podvrhuje jen v ODPOVĚDI serveru, v databázi
      // leží mapa čistá. Autosave takové mapy proto dostane 400 „má více rodičů" —
      // je to artefakt podvrhu, ne vada: u mapy, která je poškozená i v DB, server
      // uložení pustí (ověřeno v cleanmap-parity.js, „už poškozená mapa se dál uloží").
      const noveChyby = chyby.slice(chybPred).filter((c) => !/Neplatn|Invalid map data|400 \(Bad Request\)/.test(c));
      ok(noveChyby.length === 0, `konzole bez chyb (kromě očekávaného 400 z podvrhu)${noveChyby.length ? ' — ' + noveChyby.slice(0, 3).join(' | ').slice(0, 300) : ''}`);
      page.off('request', podvrh);
      await page.setRequestInterception(false);
    }
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', String(e.message || e).slice(0, 200));
  } finally {
    if (browser) await browser.close().catch(() => {});
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
