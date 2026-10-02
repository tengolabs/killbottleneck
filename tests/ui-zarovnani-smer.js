// Zarovnání × směr zobrazení: cyklení stylů NESMÍ přeházet pořadí sourozenců.
//
// Nález Richarda 11. 8. 2026: ve vodorovném view po kombinaci směru a stylů
// „se podcíl dostal doprostřed mapy" — svislý (kanonický) přepočet řadil
// sourozence podle X, což je ve vodorovném view HLOUBKA, ne pořadí v řadě.
// Jakmile sevřené styly daly sourozencům různou hloubku, pořadí se rozsypalo.
// Oprava: layoutAllForView pro svislý průchod prohazuje osy.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const { vyberZListy } = require('./_harness');

const NAME = 'kb-e2e-zarovnani-smer';
const PORT = 20595;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -e TZ=Europe/Prague -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await fetch(`${BASE}/api/collections/users/records`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'r@test.cz', password: PW, passwordConfirm: PW }),
    });
    const auth = await (await fetch(`${BASE}/api/collections/users/auth-with-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: 'r@test.cz', password: PW }),
    })).json();

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 950 });
    await page.evaluateOnNewDocument((t, r) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: r }));
      localStorage.setItem('kb-lang', 'cs');
    }, auth.token, auth.record);
    // úvodní mapa admina = 5 sekcí s listy — přesně tvar, na kterém se to rozbilo
    const mapy = await (await fetch(`${BASE}/api/collections/goalmaps/records?perPage=1&filter=${encodeURIComponent('title="Zavedení killBottlenecku"')}`, { headers: { Authorization: auth.token } })).json();
    await page.goto(`${BASE}/map/${mapy.items[0].id}`, { waitUntil: 'networkidle2' });
    // čekat na VYKRESLENÉ uzly — pevný spánek v souběhu s dalšími sadami nestačil
    // (plátno se načetlo později a sada měřila prázdno)
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 20, { timeout: 45000 }).catch(() => {});
    await sleep(1500);

    // pořadí sekcí podle příčné osy daného směru (svisle zleva, vodorovně shora)
    const poradi = (horiz) => page.evaluate((horiz) => {
      const sekce = ['Nastavit si prostředí', 'Zapojit tým', 'Rozjet první projekt', 'Den pod kontrolou', 'Vyzkoušet AI pomocníka'];
      const found = [];
      for (const el of document.querySelectorAll('.react-flow__node')) {
        const t = (el.textContent || '');
        const s = sekce.find((x) => t.includes(x));
        if (!s) continue;
        const r = el.getBoundingClientRect();
        found.push({ s, k: horiz ? r.top : r.left });
      }
      return found.sort((a, b) => a.k - b.k).map((f) => f.s.split(' ')[0]).join(' ');
    }, horiz);
    // Zarovnat je od 1. 10. 2026 nabídka (Richard: měnící se popisek hýbal
    // lištou). Styl se čte z data-atributu viditelného tlačítka — popisek je
    // pevný „Zarovnat". Bez argumentu se vybere DALŠÍ styl v původním pořadí
    // (do šířky → kompaktně → kolem středu), ať sada dál prochází všechny styly.
    const STYLY = ['classic', 'compact', 'bands'];
    const stylNaListe = () => page.evaluate(() => [...document.querySelectorAll('[data-align-style]')].find((x) => x.offsetParent)?.getAttribute('data-align-style') || null);
    const zarovnat = async (styl) => {
      if (!styl) { const ted = await stylNaListe(); styl = STYLY.includes(ted) ? STYLY[(STYLY.indexOf(ted) + 1) % STYLY.length] : 'classic'; }
      ok(await vyberZListy(page, 'zarovnat', `[data-styl="${styl}"]`), `Zarovnat: v nabídce vybrán styl ${styl}`);
      // ⚠️ pevných 1 200 ms = přesně debounce autosave → sada měřila plátno
      // uprostřed uložení a náhodně viděla prázdno (padalo i na v0.46.1).
      // Počkat, až „Ukládání…" zhasne, a pak ještě chvíli na překreslení.
      await sleep(1300);
      await page.waitForFunction(() => !(document.body.innerText || '').includes('Ukládání'), { timeout: 15000 }).catch(() => {});
      await sleep(400);
    };

    console.log('== vodorovné view: 4× zarovnat (celý cyklus stylů) ==');
    await page.evaluate(() => document.querySelector('button[data-dir="horizontal"]')?.click());
    await sleep(1500);
    const pred = await poradi(true);
    ok(pred.split(' ').length === 5, `všech 5 sekcí na plátně (${pred})`);
    for (let i = 1; i <= 4; i++) {
      await zarovnat();
      const ted = await poradi(true);
      // i s počtem — prázdné '' === '' by jinak zezelenalo naprázdno
      ok(ted === pred && ted.split(' ').length === 5, `po stisku ${i} pořadí drží (${ted})`);
    }

    console.log('== návrat na svislé view: pořadí zleva sedí ==');
    await page.evaluate(() => document.querySelector('button[data-dir="vertical"]')?.click());
    await sleep(1500);
    ok((await poradi(false)) === pred, `svisle stejné pořadí (${await poradi(false)})`);
    await zarovnat();
    ok((await poradi(false)) === pred, 'a drží i po dalším zarovnání ve svislém view');

    // Richard 15. 9. 2026: po sevřeném stylu (část karet o patro níž) přepnutí
    // Na šířku poslalo spadlé karty na KONEC řady a zpět už se to nevrátilo.
    // ⚠️ Sekce úvodní mapy jsou SKUPINY (v řadě zůstávají, padají jen jejich
    // listy) — hlídat se musí řada LISTŮ: vlastní mapa vrchol + 6 karet.
    console.log('== řada listů: kompakt + přepnutí směru tam a zpět drží pořadí ==');
    const listMapa = await (await fetch(`${BASE}/api/collections/goalmaps/records`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth.token },
      body: JSON.stringify({ title: 'SMER-LISTY', nodes: [
        { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Vrchol', title: 'Vrchol', status: 'todo' } },
        ...['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((t, i) => ({ id: t, type: 'goalNode', position: { x: -700 + i * 270, y: 380 }, data: { title: `Karta ${t}`, status: 'todo' } })),
      ], edges: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((t) => ({ id: 'e' + t, source: 'apex', target: t })) }),
    })).json();
    await page.goto(`${BASE}/map/${listMapa.id}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 7, { timeout: 30000 }).catch(() => {});
    await sleep(1500);
    const poradiListu = (horiz) => page.evaluate((horiz) => {
      const found = [];
      for (const el of document.querySelectorAll('.react-flow__node')) {
        const m = (el.textContent || '').match(/Karta (L\d)/);
        if (!m) continue;
        const r = el.getBoundingClientRect();
        found.push({ s: m[1], k: horiz ? r.top : r.left });
      }
      return found.sort((a, b) => a.k - b.k).map((f) => f.s).join(' ');
    }, horiz);
    await zarovnat('compact');
    ok((await stylNaListe()) === 'compact', 'svisle nastaven styl kompaktně');
    const vysky = await page.evaluate(() => new Set([...document.querySelectorAll('.react-flow__node')].filter((el) => /Karta L/.test(el.textContent || '')).map((el) => Math.round(el.getBoundingClientRect().top / 10))).size);
    ok(vysky === 2, `kompakt dal 6 karet do dvou pater (${vysky})`);
    const predSmer = await poradiListu(false);
    ok(predSmer === 'L1 L2 L3 L4 L5 L6', `svisle čtení zleva L1…L6 (${predSmer})`);
    await page.evaluate(() => document.querySelector('button[data-dir="horizontal"]')?.click());
    await sleep(1500);
    ok((await poradiListu(true)) === predSmer, `Na šířku drží pořadí karet (${await poradiListu(true)})`);
    await page.evaluate(() => document.querySelector('button[data-dir="vertical"]')?.click());
    await sleep(1500);
    ok((await poradiListu(false)) === predSmer, `Na výšku zpět drží pořadí karet (${await poradiListu(false)})`);
    // zpět na úvodní mapu pro další sekce sady
    await page.goto(`${BASE}/map/${mapy.items[0].id}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 20, { timeout: 45000 }).catch(() => {});
    await sleep(1500);

    // ---- POPISEK PATŘÍ MAPĚ, NE PROHLÍŽEČI (Richard 11. 8. 2026 v noci) ----
    // „U mapy, kterou otevírám poprvé, mám nahoře stav zarovnat…, ale je to
    // ten první stav. Pak zmáčknu tlačítko a mapa je pořád stejná, jen se to
    // konečně jmenuje správně." Příčina: styl si pamatoval JEDEN klíč pro
    // všechny mapy, takže čerstvá mapa zdědila popisek odjinud a lhala.
    console.log('== popisek Zarovnat patří mapě, ne prohlížeči ==');
    // „popisek" = styl, který tlačítko hlásí (ikonou a data-align-style)
    const popisek = stylNaListe;
    const otevri = async () => {
      await page.goto(`${BASE}/map/${mapy.items[0].id}`, { waitUntil: 'networkidle2' });
      await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 5, { timeout: 45000 }).catch(() => {});
      await sleep(1200);
    };
    // stav „na jiné mapě jsem naposledy mačkal kolem středu"
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (k.startsWith('kb-zarovnat-styl')) localStorage.removeItem(k);
      localStorage.setItem('kb-zarovnat-styl', 'bands');
    });
    await otevri();
    const prvni = await popisek();
    ok(prvni === 'none', `poprvé otevřená mapa nehlásí cizí styl (${prvni})`);
    await zarovnat();
    const poStisku = await popisek();
    ok(STYLY.includes(poStisku), `po výběru tlačítko styl hlásí (${poStisku})`);
    await otevri();
    ok((await popisek()) === poStisku, `a TAHLE mapa si ho pamatuje i po znovuotevření (${await popisek()})`);

    // ---- STYL PŘEŽIJE PŘEPNUTÍ SMĚRU (Richard 11. 8. v noci) ----
    // „Jsem v PC režimu dle kategorií, přepnu na mobilní a neudrží to,
    // dá do šířky." Přepínač směru layoutoval bez stylu, takže ho zahodil.
    console.log('== zvolený styl přežije přepnutí směru ==');
    const sloupcuX = () => page.evaluate(() => {
      const xs = [...document.querySelectorAll('.react-flow__node')]
        .map((e) => Math.round(e.getBoundingClientRect().left / 25));
      return new Set(xs).size;
    });
    await page.evaluate(() => document.querySelector('button[data-dir="vertical"]')?.click());
    await sleep(1500);
    // „kolem středu" (bands) dělá nejvýraznější tvar
    await zarovnat('bands');
    ok((await popisek()) === 'bands', `nastaven styl kolem středu (${await popisek()})`);
    const sloupcuSvisle = await sloupcuX();
    await page.evaluate(() => document.querySelector('button[data-dir="horizontal"]')?.click());
    await sleep(2000);
    ok((await popisek()) === 'bands', `po přepnutí směru popisek drží (${await popisek()})`);
    // ⚠️ Práh „> 1" NEMĚL SÍLU — mapa má vždy aspoň tři úrovně, takže projde
    // i bez stylu (mutace jím prošla, panel /checkup 12. 8.). Porovnává se
    // proto s KLASICKÝM stylem v témže směru: musí vyjít jinak.
    const sloupcuStyl = await sloupcuX();
    await zarovnat('classic');
    const sloupcuKlasika = await sloupcuX();
    ok(sloupcuStyl !== sloupcuKlasika,
      `styl se po přepnutí směru opravdu projevil: kolem středu ${sloupcuStyl} sloupců vs klasika ${sloupcuKlasika} (svisle ${sloupcuSvisle})`);
    await page.evaluate(() => document.querySelector('button[data-dir="vertical"]')?.click());
    await sleep(1500);

    // ---- ČERSTVÁ MAPA: PRVNÍ stisk už musí něco udělat ----
    // Richard 12. 8.: „u úplně nové mapy 2× zmáčknu, než se to změní."
    // Mapa vznikala klasicky, ale popisek byl prázdný → první stisk ji
    // „přepnul" do stylu, ve kterém už byla, a nic se nestalo.
    console.log('== čerstvá mapa: první stisk mapou pohne ==');
    {
      const novaMapa = await (await fetch(`${BASE}/api/collections/goalmaps/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth.token },
        body: JSON.stringify({
          title: 'Čerstvá mapa',
          nodes: [{ id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { title: 'Nový projekt', nodeType: 'apex' } },
            ...Array.from({ length: 6 }, (_, i) => ({ id: `k${i}`, type: 'goalNode', position: { x: i * 280, y: 380 }, data: { title: `Bod ${i + 1}` } }))],
          edges: Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, source: 'apex', target: `k${i}`, type: 'deletable' })),
        }),
      })).json();
      await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('kb-zarovnat')) localStorage.removeItem(k); });
      await page.goto(`${BASE}/map/${novaMapa.id}`, { waitUntil: 'networkidle2' });
      await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 5, { timeout: 45000 }).catch(() => {});
      await sleep(1500);
      const pozice = () => page.evaluate(() => [...document.querySelectorAll('.react-flow__node')]
        .map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)}`; }).join('|'));
      const pred1 = await pozice();
      await zarovnat('classic');
      const po1 = await pozice();
      ok(pred1 !== po1, 'PRVNÍ výběr na čerstvé mapě rozložení změní');
      await zarovnat('compact');
      ok((await pozice()) !== po1, 'a druhý (jiný styl) taky');
    }

    // ---- ZÁMEČEK: zamčený styl platí pro všechny mapy ----
    // Richard 11. 8. v noci: „na jedné to prokliká, zjistí, že se mu to líbí,
    // a pak dá zámeček". Vědomě zvolil, že zámek přerovná mapu VŽDY při
    // otevření — i tam, kde jsou uzly posunuté ručně. Sada to drží, aby se to
    // nikdy nezměnilo omylem, ale jen rozhodnutím.
    console.log('== zámeček drží styl přes všechny mapy ==');
    const zamekStav = () => page.evaluate(() => {
      const b = document.querySelector('button[data-align-lock]');
      return b ? b.getAttribute('data-align-lock') : null;
    });
    // zámek = zaškrtávací položka v nabídce Zarovnat (do 1. 10. 2026 podržení
    // tlačítka; s rozbalovací nabídkou se podržení pralo)
    const prepniZamek = async () => {
      ok(await vyberZListy(page, 'zarovnat', '[data-align-lock-item]'), 'nabídka Zarovnat má položku zámku');
      await sleep(800);
    };
    ok((await zamekStav()) === 'off', 'zámek je ve výchozím stavu vypnutý');
    const stylKZamceni = await popisek();
    // zamčené tlačítko je plné (bez rámečku) — musí zůstat stejně široké i na
    // stejném místě, jinak lišta zarovnaná doprava uskočí o 2 px
    const rozmerZarovnat = () => page.evaluate(() => { const b = [...document.querySelectorAll('[data-align-style]')].find((x) => x.offsetParent); const r = b.getBoundingClientRect(); return `${Math.round(r.left * 10) / 10}+${Math.round(r.width * 10) / 10}`; });
    const zarovnatOdemcene = await rozmerZarovnat();
    await prepniZamek();
    ok((await zamekStav()) !== 'off', `položka v nabídce zamkla styl (${await zamekStav()})`);
    ok((await rozmerZarovnat()) === zarovnatOdemcene, `zamčené Zarovnat je stejně široké a na stejném místě (${zarovnatOdemcene} → ${await rozmerZarovnat()})`);
    ok(await page.evaluate(() => !!localStorage.getItem('kb-zarovnat-zamek')), 'zamčený styl si prohlížeč pamatuje');
    // ⭐ ZÁMEK PATŘÍ ÚČTU, NE PROHLÍŽEČI (Richard 12. 8.: „udělej to stejně
    // jako skin"). Dřív žil jen v localStorage, takže na mobilu neplatil.
    await sleep(1200);   // uložení na účet
    const ucet = await (await fetch(`${BASE}/api/collections/users/records/${auth.record.id}`, { headers: { Authorization: auth.token } })).json();
    ok(!!ucet.align_lock, `zámek je uložený na ÚČTU, ne jen v prohlížeči (align_lock=${ucet.align_lock || 'prázdné'})`);
    // simulace JINÉHO zařízení: prohlížeč nic neví, zámek musí přijít z účtu
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('kb-zarovnat')) localStorage.removeItem(k); });
    await otevri();
    ok((await zamekStav()) !== 'off', `na „jiném zařízení" (prázdný prohlížeč) zámek platí dál (${await zamekStav()})`);

    // ruční posun uzlu rovnou v datech — po otevření ho zámek musí srovnat zpět
    const mapaId = mapy.items[0].id;
    const predZamkem = await (await fetch(`${BASE}/api/collections/goalmaps/records/${mapaId}`, { headers: { Authorization: auth.token } })).json();
    const rozbal = (v) => (typeof v === 'string' ? JSON.parse(v || '[]') : (v || []));
    const uzly = rozbal(predZamkem.nodes);
    const uzel = uzly.find((n) => n.type !== 'note' && n.position);
    const puvodni = uzel && { ...uzel.position };
    if (uzel) {
      uzel.position = { x: 9999, y: 9999 };
      await fetch(`${BASE}/api/collections/goalmaps/records/${mapaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: auth.token },
        body: JSON.stringify({ nodes: uzly }),
      });
    }
    await otevri();
    await sleep(2500); // autosave po přerovnání
    ok((await popisek()) === stylKZamceni, `po otevření drží zamčený styl (${await popisek()})`);
    const poZamku = await (await fetch(`${BASE}/api/collections/goalmaps/records/${mapaId}`, { headers: { Authorization: auth.token } })).json();
    const uzelPo = uzel && rozbal(poZamku.nodes).find((n) => n.id === uzel.id);
    // ⚠️ ZÁMEK PŘEKRESLUJE, ALE DO DAT NESAHÁ (panel /checkup 12. 8.).
    // Dřív efekt neměl pojistku proti automatickému ukládání, takže otevření
    // mapy uložilo přerovnání — a protože právo editace platí i pro CIZÍ
    // sdílenou mapu, přepsalo by to rozmístění jejímu vlastníkovi. Richard
    // schvaloval „mapa se otevře v mém stylu", ne zápis do cizích dat.
    ok(uzelPo && uzelPo.position.x === 9999 && uzelPo.position.y === 9999,
      `zámek NEPŘEPSAL uložená data (${uzelPo ? Math.round(uzelPo.position.x) + ',' + Math.round(uzelPo.position.y) : 'chybí'})`);
    // na plátně je ale mapa srovnaná — kdyby uzel zůstal na 9999, vycentrování
    // by mapu zmenšilo na nečitelnou drobotinu
    const velikostKarty = await page.evaluate(() => {
      const e = document.querySelector('.react-flow__node');
      return e ? Math.round(e.getBoundingClientRect().width) : 0;
    });
    ok(velikostKarty > 30, `a přesto je na plátně srovnaná (karta ${velikostKarty} px široká)`);

    const stylPredPustenim = await popisek();
    await zarovnat(stylPredPustenim);   // TENTÝŽ styl znovu = jen srovná, zámek drží
    ok((await zamekStav()) === stylPredPustenim, `výběr zamčeného stylu zámek nechá (${await zamekStav()})`);
    await zarovnat();   // JINÝ styl zámek pustí a rovnou ho použije
    ok((await zamekStav()) === 'off', 'výběr jiného stylu zámek pustí');
    ok((await popisek()) !== stylPredPustenim, `a rovnou přepne styl (${stylPredPustenim} → ${await popisek()})`);
    ok(!(await page.evaluate(() => localStorage.getItem('kb-zarovnat-zamek'))), 'po vypnutí se zamčený styl nepamatuje');
    // a odškrtnutím v nabídce: zámek pryč, styl na mapě zůstane
    await prepniZamek();
    ok((await zamekStav()) !== 'off', 'znovu zamčeno');
    const stylPredOdskrtnutim = await popisek();
    await prepniZamek();
    ok((await zamekStav()) === 'off', 'odškrtnutí položky zámek vypne');
    ok((await popisek()) === stylPredOdskrtnutim, `a styl na mapě nechá (${await popisek()})`);

    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    console.error('CHYBA SADY:', e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
})();
