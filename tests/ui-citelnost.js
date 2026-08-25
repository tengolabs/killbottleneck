// UI e2e: tlačítko Čitelnost — tři stupně velikosti písma v uzlech mapy.
//
// ⚠️ PROČ SE NEMĚŘÍ VELIKOST PÍSMA V CSS PIXELECH: mapa se vždy oddálí na celou
// obrazovku (fitView). Kdyby s písmem rostla i karta, mapa naroste, fitView
// o tolik víc oddálí a NA OBRAZOVCE je písmo stejně velké — funkce, která
// v CSS „funguje", by uživateli nedala nic. Proto se tu měří součin
//   velikost písma × přiblížení po oddálení na celou mapu,
// tedy skutečná velikost písma na obrazovce. (Táž past jako u zarovnání:
// „šířka mapy v pixelech NIC NEMĚŘÍ, po vycentrování se mapa roztáhne na okno.")
//
// Druhá polovina sady hlídá, že se to nezaplatí rozbitým rozvržením:
// rozestupy uzlů jsou v treeLayout.js PEVNÁ čísla a šířky karet do nich
// nevstupují, takže vyšší karta se dřív nebo později o sousedku otře.
// Rozpočet na výšku karty:
//   · svisle    ≤ 236 px = STEP 280 − ELBOW 44 (DeletableEdge; nad tím se hrany
//                přestanou lámat do společné sběrnice a vrátí se „schody"),
//   · vodorovně ≤ 250 px = SLOT vodorovného směru (nad tím se řady překryjí).
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-citelnost';
const PORT = 20597;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

// Stropy i očekávané výšky leží v jednom sdíleném souboru — tahle sada je
// jediná, která karty SKUTEČNĚ MĚŘÍ, takže tady se hlídá, že čísla platí;
// layout-parity.js jimi jen prohání layout (viz vysky-karet.js).
const { VYSKY_KARET, STROP_SVISLE, STROP_VODOROVNE, VYSKY_MOJE_MAPA, STROP_MOJE_VODOROVNE } = require('./vysky-karet');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (m, p, { token, body } = {}) => {
  const r = await fetch(BASE + p, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let j = null; try { j = await r.json(); } catch { /* prázdné */ }
  return { status: r.status, json: j };
};

(async () => {
  let br;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -e TZ=Europe/Prague -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: 'a@e2e.cz', password: PW, passwordConfirm: PW } });
    const A = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@e2e.cz', password: PW } })).json.token;

    // Mapa podle Richardova screenshotu „8D report": vrchol + 8 disciplín
    // s popiskem. První tři mají navíc garanta, termín a podcíl — z toho vznikne
    // pás odznaků i pruh pokroku, tedy NEJVYŠŠÍ karta, jaká na mapě vzniká.
    // Sada, která by měřila jen holé karty, by strop na výšku nikdy nenašla.
    const dnes = new Date();
    const termin = new Date(dnes.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const nodes = [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Problém (8D report)', title: 'Problém (8D report)', status: 'todo' } }];
    const edges = [];
    // ⚠️ První tři názvy jsou ZÁMĚRNĚ tak dlouhé, že se ořežou na dva řádky
    // v KAŽDÉM stupni — jinak by sada měřila krátké názvy, které se v malém
    // písmu vejdou na jeden řádek, a nejhorší případ by nikdy nenašla.
    const disciplíny = [
      ['D1 – Sestavení mezioborového týmu pro řešení reklamace', 'Sestav tým s potřebnými znalostmi a pravomocemi, včetně zástupce výroby a kvality.'],
      ['D2 – Přesný popis problému včetně rozsahu a dopadu', 'Přesně popiš problém — co, kde, kdy, jak často a koho se týká.'],
      ['D3 – Okamžitá dočasná opatření na ochranu zákazníka', 'Zaveď dočasná opatření, aby problém neškodil dál.'],
      ['D4 – Kořenová příčina', 'Urči a ověř skutečnou kořenovou příčinu.'],
      ['D5 – Trvalá náprava', 'Vyber trvalá nápravná opatření.'],
      ['D6 – Zavedení a ověření', 'Zaveď nápravu a ověř její účinnost.'],
      ['D7 – Prevence opakování', 'Uprav systém, aby se problém neopakoval.'],
      ['D8 – Uzavření a ocenění', 'Uzavři případ a oceň tým.'],
    ];
    disciplíny.forEach(([title, description], i) => {
      const id = 'n' + (i + 1);
      const tezka = i < 3; // garant + termín + podcíl → nejvyšší karta
      nodes.push({
        id, type: 'goalNode', position: { x: (i - 4) * 300, y: 380 },
        // těžká karta = pás odznaků (garant + termín + „blokuje") a pruh pokroku
        data: { title, description, status: 'todo', ...(tezka ? { owner: 'a@e2e.cz', deadline: termin, blocks: 'D4 – Kořenová příčina' } : {}) },
      });
      edges.push({ id: 'e' + id, source: 'root', target: id });
      if (tezka) {
        nodes.push({ id: id + 'a', type: 'goalNode', position: { x: (i - 4) * 300, y: 660 }, data: { title: 'Podkrok ' + (i + 1), description: 'Dílčí krok disciplíny.', status: 'todo' } });
        edges.push({ id: 'e' + id + 'a', source: id, target: id + 'a' });
      }
    });
    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: '8D report', nodes, edges } })).json;
    const POPISKU = nodes.filter((n) => n.data.description).length;

    br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await br.newPage();
    await page.setViewport({ width: 1920, height: 950 });
    await page.evaluateOnNewDocument((t, r) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: r }));
      localStorage.setItem('kb-lang', 'cs');
    }, A, (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@e2e.cz', password: PW } })).json.record);

    // ⚠️ VÝCHOZÍ STUPEŇ SE HLÍDÁ ZVLÁŠŤ, a to PŘED tím, než si ho sada přepne.
    // Richard 13. 8. 2026 rozhodl, že výchozí je „větší" — kdyby se to někdy
    // vrátilo na „normální", uživatel bez vlastního nastavení by zase dostal
    // nečitelnou mapu a NIC by to nenahlásilo: zbytek sady si stupeň nastavuje
    // sám, takže na výchozí hodnotě nezávisí.
    await page.goto(`${BASE}/map/${map.id}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 12, { timeout: 45000 });
    await sleep(1500);
    {
      const v = await page.evaluate(() => ({
        stupen: [...document.querySelectorAll('[data-citelnost]')].find((x) => x.offsetParent)?.getAttribute('data-citelnost') || '',
        ulozeno: localStorage.getItem('kb-citelnost'),
        pismo: parseFloat(getComputedStyle(document.querySelector('[data-nazev-uzlu]')).fontSize),
      }));
      ok(v.ulozeno === null, `bez uložené volby (v prohlížeči je ${v.ulozeno === null ? 'prázdno' : v.ulozeno})`);
      ok(v.stupen === 'large', `výchozí stupeň je „large", ne „normal" (${v.stupen})`);
      ok(v.pismo === 18, `a mapa se rovnou kreslí větším písmem (${v.pismo} px)`);
    }

    // od téhle chvíle si sada stupeň řídí sama, ať je nezávislá na výchozí volbě
    await page.evaluate(() => localStorage.setItem('kb-citelnost', 'normal'));
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 12, { timeout: 45000 });
    await sleep(1500);

    // ---- pomůcky ----
    const fit = async () => {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => (x.title || '').includes('Oddálit na celou mapu'));
        b && b.click();
      });
      await sleep(900);
    };
    // vše ve SVĚTĚ MAPY (pixely obrazovky vydělené přiblížením) — jinak by čísla
    // záležela na tom, jak moc je zrovna oddáleno, a nedala by se porovnávat
    const mereni = () => page.evaluate(() => {
      const v = document.querySelector('.react-flow__viewport');
      const m = v && v.style.transform.match(/scale\(([\d.]+)\)/);
      const zoom = m ? parseFloat(m[1]) : 1;
      const h3 = document.querySelector('[data-nazev-uzlu]');
      const pismo = h3 ? parseFloat(getComputedStyle(h3).fontSize) : 0;
      const karty = [];
      for (const el of document.querySelectorAll('.react-flow__node')) {
        const t = (el.style.transform || '').match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
        if (!t) continue;
        const r = el.getBoundingClientRect();
        karty.push({
          id: el.getAttribute('data-id') || '',
          // typ z třídy (react-flow__node-goalNode / -apexNode / -personalRoot):
          // rozpočet na rozměry platí pro KARTY, kruhový vrchol je pevných
          // 260 px a počítá se s ním zvlášť (APEX_STEP 380)
          typ: (el.className.match(/react-flow__node-(\w+)/) || [])[1] || '',
          x: parseFloat(t[1]), y: parseFloat(t[2]),
          w: r.width / zoom, h: r.height / zoom,
        });
      }
      return {
        zoom, pismo, karty,
        stupen: [...document.querySelectorAll('[data-citelnost]')].find((x) => x.offsetParent)?.getAttribute('data-citelnost') || '',
        popisku: document.querySelectorAll('[data-popis-uzlu]').length,
        znacek: document.querySelectorAll('[data-popis-skryt]').length,
      };
    });
    const prekryv = (karty) => {
      for (let i = 0; i < karty.length; i++) {
        for (let j = i + 1; j < karty.length; j++) {
          const a = karty[i], b = karty[j];
          if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return `${a.id} × ${b.id}`;
        }
      }
      return null;
    };
    // ⚠️ v liště jsou DVĚ tlačítka Čitelnost (široká a úzká varianta) — vždy
    // klikat na VIDITELNÉ, jinak by se na mobilu mačkalo to desktopové
    // a mobilní varianta by zůstala neproklikaná (nález panelu 13. 8. 2026)
    const prepni = async () => {
      await page.evaluate(() => [...document.querySelectorAll('[data-citelnost]')].find((x) => x.offsetParent)?.click());
      await sleep(700);
    };
    const smer = async (v) => {
      await page.evaluate((v) => document.querySelector(`button[data-dir="${v}"]`)?.click(), v);
      await sleep(1500);
    };

    // srovnat mapu skutečným algoritmem, ať se neměří na ručně nasypaných pozicích
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.title || '').startsWith('Zarovnat'));
      b && b.click();
    });
    await sleep(1500);
    await fit();

    // ======================= SVISLE (desktop) =======================
    console.log('== svislé zobrazení: tři stupně ==');
    const svisle = {};
    const pozicePrvni = {};
    for (const stupen of ['normal', 'large', 'titleOnly']) {
      await fit();
      const m = await mereni();
      ok(m.stupen === stupen, `tlačítko hlásí stupeň „${stupen}" (${m.stupen})`);
      svisle[stupen] = m;
      if (stupen === 'normal') for (const k of m.karty) pozicePrvni[k.id] = `${Math.round(k.x)},${Math.round(k.y)}`;
      if (stupen !== 'titleOnly') await prepni();
    }

    const naObrazovce = (m) => m.pismo * m.zoom;
    const n = naObrazovce(svisle.normal), v = naObrazovce(svisle.large), z = naObrazovce(svisle.titleOnly);
    console.log(`     písmo × přiblížení:  normální ${n.toFixed(2)} px · větší ${v.toFixed(2)} px · jen název ${z.toFixed(2)} px`);
    ok(v > n, `„větší" je na obrazovce skutečně větší než „normální" (${n.toFixed(2)} → ${v.toFixed(2)} px)`);
    ok(z > v, `„jen název" je na obrazovce největší (${v.toFixed(2)} → ${z.toFixed(2)} px)`);

    // Klíčové tvrzení návrhu: přepnutí čitelnosti uzly NEHÝBE. Kdyby hýbalo,
    // spustí se autosave a zapíše se to i do cizí sdílené mapy.
    for (const stupen of ['large', 'titleOnly']) {
      const zmeny = svisle[stupen].karty.filter((k) => pozicePrvni[k.id] && pozicePrvni[k.id] !== `${Math.round(k.x)},${Math.round(k.y)}`);
      ok(zmeny.length === 0, `stupeň „${stupen}" uzly neposunul (${zmeny.length} posunutých)`);
    }

    for (const stupen of ['normal', 'large', 'titleOnly']) {
      const m = svisle[stupen];
      const karty = m.karty.filter((k) => k.typ === 'goalNode');
      // ⚠️ POJISTKA PROTI ZELENÉ NA PRÁZDNÉ STRÁNCE (panel /checkup 13. 8. 2026):
      // `Math.max(...[])` je −Infinity (menší než každý strop), `[].every()` je
      // true a párový překryv prázdného seznamu nic nenajde — takže když se
      // karty PŘESTANOU vykreslovat, projde devět tvrzení zeleně. Přesně ten
      // pád, který mají chytit.
      ok(karty.length >= 11, `svisle: vykreslily se karty (${karty.length}, čekáno ≥ 11) (${stupen})`);
      const nejvyssi = Math.max(...karty.map((k) => k.h));
      ok(nejvyssi <= STROP_SVISLE, `svisle: nejvyšší karta ${nejvyssi.toFixed(0)} px ≤ ${STROP_SVISLE} (${stupen})`);
      const p = prekryv(m.karty);
      ok(!p, `svisle: žádný překryv (${stupen})${p ? ' — ' + p : ''}`);
      ok(karty.every((k) => Math.round(k.w) === 220), `svisle: šířka karty zůstala 220 px (${stupen})`);
      // ⚠️ Tímhle drží pohromadě sdílený seznam výšek pro layout-parity.js:
      // ta sada je nemá jak změřit (běží bez prohlížeče) a dřív je měla opsané,
      // takže mutace produkčního kódu ji nechala zelenou. Když se karta změní
      // (stačí přidat odznak), zčervená TADY a čísla se opraví vědomě.
      ok(Math.abs(nejvyssi - VYSKY_KARET[stupen]) <= 2,
        `svisle: naměřená karta ${nejvyssi.toFixed(0)} px sedí se sdíleným seznamem ${VYSKY_KARET[stupen]} px (${stupen})`);
    }

    console.log('== třetí stupeň: popisek skrytý, značka na místě ==');
    ok(svisle.titleOnly.popisku === 0, `žádný popisek v uzlech (${svisle.titleOnly.popisku})`);
    ok(svisle.titleOnly.znacek === POPISKU, `značka „…" u všech ${POPISKU} uzlů s popiskem (${svisle.titleOnly.znacek})`);
    ok(svisle.normal.popisku === POPISKU && svisle.normal.znacek === 0, 'v „normální" naopak popisky ano, značky ne');
    const bublina = await page.evaluate(() => document.querySelector('[data-popis-skryt]')?.getAttribute('title') || '');
    ok(bublina.length > 5, `bublina nese celý popisek („${bublina.slice(0, 40)}…")`);

    // ======================= VODOROVNĚ (mobil) =======================
    // Tady je rezerva nejmenší: příčná osa je VÝŠKA karty proti slotu 250 px.
    console.log('== vodorovné zobrazení: tříd se to musí vejít taky ==');
    await smer('horizontal');
    for (const stupen of ['normal', 'large', 'titleOnly']) {
      await prepni(); // z „titleOnly" cyklus přejde na „normal"
      await fit();
      const m = await mereni();
      ok(m.stupen === stupen, `vodorovně: stupeň „${stupen}" (${m.stupen})`);
      // ⚠️ Kotva i tady — svislá sekce a mobil ji měly, tahle na ni zapomněla
      // (nález panelu 13. 8.): bez ní by `Math.max(...[])` = −Infinity prošlo
      // pod strop a překryv prázdného seznamu nic nenajde, takže by sekce
      // zůstala zelená právě v tom pádu, který má chytit.
      const kartyV = m.karty.filter((k) => k.typ === 'goalNode');
      ok(kartyV.length >= 11, `vodorovně: karty se vykreslily (${kartyV.length}) (${stupen})`);
      const nejvyssi = Math.max(...kartyV.map((k) => k.h));
      ok(nejvyssi <= STROP_VODOROVNE, `vodorovně: nejvyšší karta ${nejvyssi.toFixed(0)} px ≤ ${STROP_VODOROVNE} (${stupen})`);
      const p = prekryv(m.karty);
      ok(!p, `vodorovně: žádný překryv (${stupen})${p ? ' — ' + p : ''}`);
    }
    await smer('vertical');
    const predchoziStupen = (await mereni()).stupen;

    // ======================= DO MAPY SE NIC NEUKLÁDÁ =======================
    // ⚠️ TOHLE JE TA DÍRA, KVŮLI KTERÉ VADA PROŠLA (panel /checkup 13. 8. 2026).
    // Sada ověřovala, že se uzly NEPOSUNOU — a z toho se usoudilo, že se tedy
    // nic neukládá. Neplatilo to: stupně mění VÝŠKU karty, ReactFlow na to
    // pošle `dimensions` change a autosave odešle PATCH s daty shodnými
    // s databází. Jediné, co se změnilo, bylo `updated` — a s ním pořadí map
    // a `base_updated` kolegy ve sdílené mapě (konflikt 409).
    // Pozice tedy NESTAČÍ. Měří se SÍŤ a razítko v databázi.
    console.log('== přepnutí NESMÍ nic uložit do mapy ==');
    {
      const pred = (await (await fetch(`${BASE}/api/collections/goalmaps/records/${map.id}`, { headers: { Authorization: A } })).json()).updated;
      const zapisy = [];
      const sledovat = (r) => {
        if (['PATCH', 'POST', 'PUT'].includes(r.method()) && r.url().includes('/goalmaps/records')) zapisy.push(`${r.method()} ${r.url().split('/').pop()}`);
      };
      page.on('request', sledovat);
      await prepni();
      await prepni();
      await sleep(3500);           // autosave má prodlevu 1200 ms — dát mu čas
      page.off('request', sledovat);
      const po = (await (await fetch(`${BASE}/api/collections/goalmaps/records/${map.id}`, { headers: { Authorization: A } })).json()).updated;
      ok(zapisy.length === 0, `dvě přepnutí neposlala do mapy žádný zápis (${zapisy.length ? zapisy.join(', ') : 'žádný'})`);
      ok(pred === po, `razítko „naposledy upraveno" se nehnulo (${pred === po ? 'beze změny' : pred + ' → ' + po})`);
      // pojistka, aby tvrzení výš neplatila jen proto, že se nic nestalo
      ok((await mereni()).stupen !== predchoziStupen, 'a přitom se stupeň OPRAVDU přepnul');
    }

    // ======================= KRUHOVÝ VRCHOL =======================
    // ⚠️ Tahle sekce chyběla úplně — sada měřila jen karty (`[data-nazev-uzlu]`),
    // takže mutace „smaž `jenNazevVrcholu`" nebo „`APEX_POSUN.titleOnly = 0`"
    // by ji nechala 100% ZELENOU. A přitom vrchol byla POLOVINA Richardovy
    // připomínky ze 13. 8. („měníme pouze uzly, ale ne ten hlavní kruhový").
    console.log('== kruhový vrchol se čitelnosti účastní taky ==');
    {
      const vrchol = () => page.evaluate(() => {
        const el = document.querySelector('.react-flow__node-apexNode');
        const v = document.querySelector('.react-flow__viewport');
        const zoom = parseFloat((v.style.transform.match(/scale\(([\d.]+)\)/) || [])[1]) || 1;
        const p = el && el.querySelector('p');
        return {
          pismo: p ? parseFloat(getComputedStyle(p).fontSize) : 0,
          zoom,
          orez: !!(p && p.scrollHeight > p.clientHeight + 1),
          text: el ? el.innerText.replace(/\s+/g, ' ') : '',
        };
      });
      const kruh = {};
      for (const stupen of ['normal', 'large', 'titleOnly']) {
        await page.evaluate((v) => localStorage.setItem('kb-citelnost', v), stupen);
        await page.reload({ waitUntil: 'networkidle2' });
        await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 12, { timeout: 45000 });
        await sleep(1500);
        await fit();
        kruh[stupen] = await vrchol();
        ok(kruh[stupen].pismo > 0, `vrchol se vykreslil (${stupen})`);
      }
      ok(kruh.large.pismo > kruh.normal.pismo,
        `vrchol roste s „větší" (${kruh.normal.pismo} → ${kruh.large.pismo} px)`);
      ok(kruh.titleOnly.pismo > kruh.large.pismo,
        `a ještě víc v „jen názvu" (${kruh.large.pismo} → ${kruh.titleOnly.pismo} px)`);
      // hierarchie: nejdůležitější text mapy nesmí být menší než cíle pod ním
      ok(kruh.titleOnly.pismo >= svisle.titleOnly.pismo,
        `vrchol NENÍ menší než cíle pod ním (${kruh.titleOnly.pismo} vs ${svisle.titleOnly.pismo} px)`);
      ok(!kruh.titleOnly.orez, 'a název projektu se do kruhu vejde, neořízne se');
      // v „jen názvu" zůstane v kruhu JEN název (Richard 13. 8.)
      ok(/Celkový pokrok|Projekt/.test(kruh.normal.text),
        `v „normální" kruh nese odznak i pokrok (${kruh.normal.text.slice(0, 40)})`);
      ok(!/Celkový pokrok/.test(kruh.titleOnly.text) && !/Projekt\b/.test(kruh.titleOnly.text),
        `v „jen názvu" zmizel odznak i celkový pokrok (${kruh.titleOnly.text.slice(0, 40)})`);
    }
    await page.evaluate(() => localStorage.setItem('kb-citelnost', 'titleOnly'));
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 12, { timeout: 45000 });
    await sleep(1200);

    // ======================= trvanlivost a práva =======================
    console.log('== volba přežije obnovení stránky, tlačítko je i v mapě jen ke čtení ==');
    const predReload = (await mereni()).stupen;
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 12, { timeout: 45000 });
    await sleep(1200);
    ok((await mereni()).stupen === predReload, `po obnovení drží stupeň „${predReload}"`);

    // „Moje mapa" je jen ke čtení (canEdit=false) — Zarovnat tam být nemusí,
    // Čitelnost ANO: zvětšit si písmo nesmí záviset na právu upravovat.
    await page.goto(`${BASE}/my-map`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    const readonly = await page.evaluate(() => ({
      citelnost: !!document.querySelector('[data-citelnost]'),
      uzly: document.querySelectorAll('.react-flow__node').length,
    }));
    ok(readonly.uzly > 0, `„Moje mapa" se vykreslila (${readonly.uzly} uzlů)`);
    ok(readonly.citelnost, 'tlačítko Čitelnost je i v mapě jen ke čtení');

    // ⚠️ „MOJE MAPA" SE MUSÍ MĚŘIT, ne jen otevřít (nález panelu 13. 8.).
    // Má VLASTNÍ rozestupy (`PERSONAL_LAYOUT`: svisle step 210, vodorovně
    // slot 120), takže stropy běžné mapy tam NEPLATÍ — je to nejtěsnější
    // rozvržení v aplikaci. Dosud se tu ověřovalo jen to, že se něco vykreslilo.
    // ⚠️ Vodorovná rezerva je minimální: naměřeno 108 / 116 / 120 px proti
    // stropu 120, tedy „jen název" sedí PŘESNĚ na hraně a výchozí „větší"
    // má 4 px. Jakýkoli další řádek v kompaktní kartě to přetáhne.
    for (const stupen of ['normal', 'large', 'titleOnly']) {
      await page.evaluate((v) => localStorage.setItem('kb-citelnost', v), stupen);
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 3, { timeout: 45000 });
      await sleep(2000);
      const m = await page.evaluate(() => {
        const v = document.querySelector('.react-flow__viewport');
        const z = parseFloat((v.style.transform.match(/scale\(([\d.]+)\)/) || [])[1]) || 1;
        const k = [...document.querySelectorAll('.react-flow__node-goalNode')].map((el) => el.getBoundingClientRect().height / z);
        return { pocet: k.length, max: k.length ? Math.max(...k) : 0 };
      });
      ok(m.pocet >= 3, `Moje mapa: karty se vykreslily (${m.pocet}) (${stupen})`);
      ok(Math.abs(m.max - VYSKY_MOJE_MAPA[stupen]) <= 2,
        `Moje mapa: ${m.max.toFixed(0)} px sedí se sdíleným seznamem ${VYSKY_MOJE_MAPA[stupen]} px (${stupen})`);
    }

    // ⚠️ A hlavně: SKUTEČNÝ překryv na TELEFONU. Samotné porovnání výšky se
    // stropem nestačí — ve stupni „jen název" karta sedí PŘESNĚ na 120 px
    // a starý slot byl taky 120, takže se dva uzly reálně překrývaly
    // (změřeno 13. 8. 2026). Slot se kvůli tomu v tomhle stupni zvětšil;
    // tohle tvrzení hlídá, že se to nevrátí.
    for (const stupen of ['normal', 'large', 'titleOnly']) {
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      await page.evaluate((v) => localStorage.setItem('kb-citelnost', v), stupen);
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 3, { timeout: 45000 });
      await sleep(2500);
      const m = await page.evaluate(() => {
        const v = document.querySelector('.react-flow__viewport');
        const z = parseFloat((v.style.transform.match(/scale\(([\d.]+)\)/) || [])[1]) || 1;
        const k = [...document.querySelectorAll('.react-flow__node')].map((el) => {
          const t = (el.style.transform || '').match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
          const b = el.getBoundingClientRect();
          return t ? { id: el.getAttribute('data-id'), x: +t[1], y: +t[2], w: b.width / z, h: b.height / z } : null;
        }).filter(Boolean);
        let kol = null;
        for (let i = 0; i < k.length && !kol; i++) for (let j = i + 1; j < k.length; j++) {
          const A = k[i], B = k[j];
          if (A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h) { kol = `${A.id}×${B.id}`; break; }
        }
        return { pocet: k.length, kol };
      });
      ok(m.pocet >= 3, `Moje mapa na telefonu: uzly se vykreslily (${m.pocet}) (${stupen})`);
      ok(!m.kol, `Moje mapa na telefonu: žádný překryv (${stupen})${m.kol ? ' — ' + m.kol : ''}`);
    }
    await page.setViewport({ width: 1920, height: 950 });

    // ======================= TELEFON =======================
    // ⚠️ Do 13. 8. 2026 běžela celá sada jen v okně 1920×950, takže mobilní
    // varianta tlačítka (`min-[1850px]:hidden`) se NIKDY nespustila — a mobil
    // je přitom hlavní důvod, proč funkce vznikla. V repu už jednou bylo
    // tlačítko mrtvé JEN na telefonu a build to nechytil.
    console.log('== telefon (390×844): tlačítko existuje a doopravdy přepíná ==');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}/map/${map.id}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 12, { timeout: 45000 });
    await sleep(2500);
    const mobilTlacitka = await page.evaluate(() => {
      const vse = [...document.querySelectorAll('[data-citelnost]')];
      const vidno = vse.filter((x) => x.offsetParent);
      return { celkem: vse.length, vidno: vidno.length, sirka: vidno[0]?.getBoundingClientRect().width || 0 };
    });
    ok(mobilTlacitka.vidno === 1, `na telefonu je vidět právě jedno tlačítko Čitelnost (${mobilTlacitka.vidno} z ${mobilTlacitka.celkem})`);
    ok(mobilTlacitka.sirka >= 32, `a je dost velké na prst (${Math.round(mobilTlacitka.sirka)} px)`);
    const mobilPred = (await mereni()).stupen;
    await prepni();
    const mobilPo = await mereni();
    ok(mobilPo.stupen !== mobilPred, `stisk na telefonu přepnul stupeň (${mobilPred} → ${mobilPo.stupen})`);
    const mobilKarty = mobilPo.karty.filter((k) => k.typ === 'goalNode');
    ok(mobilKarty.length >= 11, `telefon: karty se vykreslily (${mobilKarty.length})`);
    const mobilPrekryv = prekryv(mobilPo.karty);
    ok(!mobilPrekryv, `telefon: žádný překryv${mobilPrekryv ? ' — ' + mobilPrekryv : ''}`);

    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    console.error('CHYBA SADY:', e);
    process.exitCode = 1;
  } finally {
    if (br) await br.close().catch(() => {});
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
})();
