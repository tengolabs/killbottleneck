// B2 — KDE FLOWMAP PRASKNE. Není to funkce, je to MĚŘENÍ.
//
// Proč: ClickUp podle recenzí zpomaluje nad ~1000 úkoly, Notion nad ~500 řádky
// databáze, Jira u velkých backlogů. Je to stejná třída problému, jakou máme my:
// `goalmaps.nodes` je JEDEN JSON blob (limit 5 MB) a „Můj den" i /tasks dnes
// počítají všechno v prohlížeči z kompletně stažených dat. Dokud nemáme vlastní
// číslo, NESMÍME v marketingu slibovat nic o velkých týmech.
//
// Test nasype 500 uzlů / 2000 úkolů, změří dobu do použitelné stránky na
// desktopu i na mobilní šířce a zapíše naměřené hodnoty do
// /tmp/flowmap-scale-limits.json. PADÁ jen tehdy, když se něco skutečně rozbije
// (chyba v konzoli, nedoručený obsah, překročený strop SLOW_MS) — samotná čísla
// jsou výstup k rozhodnutí, ne kritérium.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const fs = require('fs');

const BASE = 'http://127.0.0.1:20512';
const NAME = 'flowmap-e2e-scale';
const OUT = '/tmp/flowmap-scale-limits.json';

const MAPS = Number(process.env.SCALE_MAPS || 10);
const NODES_PER_MAP = Number(process.env.SCALE_NODES_PER_MAP || 50);   // 10 × 50 = 500 uzlů
const TASKS = Number(process.env.SCALE_TASKS || 2000);
// Strop „ještě použitelné" stránky. Vyšší číslo neznamená chybu v kódu, ale
// znamená, že se limit MUSÍ deklarovat a řešit (serverová agregace) — proto pád.
const SLOW_MS = Number(process.env.SCALE_SLOW_MS || 15000);

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let browser;
  const measured = {};
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 20512:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
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

    console.log(`== nasypání dat: ${MAPS} map × ${NODES_PER_MAP} uzlů = ${MAPS * NODES_PER_MAP} uzlů, ${TASKS} zbytkových položek ==`);
    // SLOVNÍK 17. 8. 2026: položky nejde založit uživatelem — dávky sází superuser
    // (zátěž tabulky zbytkovými řádky se pořád měří, jen se sází povolenou cestou)
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const seedStart = Date.now();
    const seed = await page.evaluate(async (MAPS, NODES_PER_MAP, TASKS) => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { 'Content-Type': 'application/json', Authorization: auth.token };
      const me = 'admin@e2e.cz';
      const su = await (await fetch('/api/collections/_superusers/auth-with-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: 'su@e2e.local', password: 'supersu12345' }) })).json();
      const HS = { 'Content-Type': 'application/json', Authorization: su.token };
      const myId = auth.record && auth.record.id;
      const day = (offset) => {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA');
      };
      const mapIds = [];
      let blobMax = 0;
      for (let m = 0; m < MAPS; m++) {
        const nodes = [{ id: 'apex', type: 'apexNode', position: { x: 0, y: 0 },
          data: { nodeType: 'apex', apexText: `Projekt ${m}`, title: `Projekt ${m}`, status: 'todo', owner: me } }];
        const edges = [];
        for (let n = 1; n < NODES_PER_MAP; n++) {
          nodes.push({ id: `n${n}`, type: 'goalNode', position: { x: n * 60, y: 300 },
            data: {
              title: `Cíl ${m}-${n}`, status: n % 3 === 0 ? 'done' : 'todo',
              description: 'Popis kroku, aby uzel nebyl prázdný a blob měl realistickou velikost.',
              // část uzlů přiřazená mně s termínem → zátěž pro „Můj den"
              owner: n % 2 === 0 ? me : '', deadline: n % 5 === 0 ? day((n % 14) - 3) : '',
            } });
          edges.push({ id: `e${n}`, source: 'apex', target: `n${n}` });
        }
        const body = JSON.stringify({ title: `Projekt ${m}`, nodes, edges });
        blobMax = Math.max(blobMax, new Blob([JSON.stringify(nodes)]).size);
        const r = await (await fetch('/api/collections/goalmaps/records', { method: 'POST', headers: H, body })).json();
        if (r.id) mapIds.push(r.id);
      }
      // úkoly po dávkách (sériově by 2000 requestů trvalo věčnost)
      let made = 0;
      const BATCH = 25;
      for (let i = 0; i < TASKS; i += BATCH) {
        const chunk = [];
        for (let k = 0; k < BATCH && i + k < TASKS; k++) {
          const idx = i + k;
          chunk.push(fetch('/api/collections/tasks/records', {
            method: 'POST', headers: HS,
            body: JSON.stringify({
              owner: myId, owner_email: me,
              title: `Úkol ${idx}`,
              status: idx % 4 === 0 ? 'done' : 'todo',
              assignee_email: me,
              map: mapIds[idx % mapIds.length],
              // úkol musí viset na konkrétním NE-vrcholovém uzlu; n1 je LICHÝ
              // (owner '', bez termínu), takže se úkol nesloží do „mého" uzlu
              // a měřená zátěž Můj den zůstává stejná
              node_id: 'n1',
              deadline: idx % 3 === 0 ? day((idx % 21) - 5) : '',
            }),
          }).then((r) => (r.ok ? 1 : 0)).catch(() => 0));
        }
        made += (await Promise.all(chunk)).reduce((a, b) => a + b, 0);
      }
      return { mapIds, tasksCreated: made, blobMaxBytes: blobMax };
    }, MAPS, NODES_PER_MAP, TASKS);
    const seedSec = Math.round((Date.now() - seedStart) / 1000);
    console.log(`   nasypáno za ${seedSec}s — map: ${seed.mapIds.length}, úkolů: ${seed.tasksCreated}, ` +
      `největší JSON blob uzlů: ${Math.round(seed.blobMaxBytes / 1024)} kB (limit pole je 5 MB)`);
    expect(seed.mapIds.length === MAPS, `založeno ${seed.mapIds.length}/${MAPS} map`);
    expect(seed.tasksCreated >= TASKS * 0.98, `založeno ${seed.tasksCreated}/${TASKS} úkolů`);

    // Doba do POUŽITELNÉ stránky: čeká se na skutečný obsah, ne na networkidle
    // (ten u SPA nastane dřív, než se dopočítá „Můj den" z dat v prohlížeči).
    const timeTo = async (path, marker, label) => {
      errors.length = 0;
      const t0 = Date.now();
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
      let ok = false;
      for (let i = 0; i < 120; i++) {
        ok = await page.evaluate((m) => (document.body.innerText || '').includes(m), marker).catch(() => false);
        if (ok) break;
        await sleep(250);
      }
      const ms = Date.now() - t0;
      measured[label] = { path, ms, rendered: ok };
      const relevant = errors.filter((e) => !e.includes('favicon') && !e.includes('ERR_NETWORK_CHANGED'));
      console.log(`   ${label}: ${ms} ms ${ok ? '' : '(NEDOKRESLENO!)'}${relevant.length ? ` — ${relevant.length} chyb v konzoli` : ''}`);
      expect(ok, `${label}: obsah se vykreslil`);
      expect(ms < SLOW_MS, `${label}: do ${SLOW_MS} ms (naměřeno ${ms} ms)`);
      expect(relevant.length === 0, `${label}: konzole bez chyb${relevant.length ? ` (${relevant[0].slice(0, 100)})` : ''}`);
      return ms;
    };

    console.log('== desktop (1280×900) ==');
    await page.setViewport({ width: 1280, height: 900 });
    await timeTo('/', 'Můj den', 'home-desktop');
    await timeTo('/tasks', 'Úkoly', 'tasks-desktop');
    await timeTo(`/map/${seed.mapIds[0]}`, 'Projekt 0', 'map-desktop');
    // marker = záložka osobní mapy; text „Moje mapa" je jen v navigaci, ne na plátně
    await timeTo('/my-map', 'Mám udělat', 'mymap-desktop');

    console.log('== mobilní šířka (390×844, jako telefon) ==');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    // Na úzkém displeji vede „/" do zjednodušeného režimu — proto se plná appka
    // měří s vynucenou volbou 'full', ať se porovnává totéž co na desktopu.
    await page.evaluate(() => localStorage.setItem('kb-mode', 'full'));
    await timeTo('/', 'Můj den', 'home-mobile');
    await timeTo('/tasks', 'Úkoly', 'tasks-mobile');
    await timeTo(`/map/${seed.mapIds[0]}`, 'Projekt 0', 'map-mobile');
    await page.evaluate(() => localStorage.removeItem('kb-mode'));
    await timeTo('/lite', 'Co mám dnes dělat', 'light-mobile');

    // Telefon na mobilních datech — přesně ten platící zákazník z byznys plánu
    // (netechnický člověk s telefonem). Na localhostu je všechno rychlé; teprve
    // s reálnou linkou je vidět, co stojí stahování celých map a úkolů.
    console.log('== telefon na pomalé lince (4× CPU, ~1,6 Mb/s, 150 ms RTT) ==');
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    // BEZ cache = první návštěva z telefonu. S teplou cache by čísla lhala:
    // 1,7 MB JS bundle by se nestahoval a měřili bychom jen data.
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    // Přesně scénář platícího zákazníka z byznys plánu: netechnický člověk,
    // telefon, mobilní data, poprvé.
    await timeTo('/lite', 'Co mám dnes dělat', 'light-mobile-3g');
    await page.evaluate(() => localStorage.setItem('kb-mode', 'full'));
    await timeTo('/', 'Můj den', 'home-mobile-3g');
    await timeTo('/tasks', 'Úkoly', 'tasks-mobile-3g');
    await page.evaluate(() => localStorage.removeItem('kb-mode'));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });

    // Kolik dat si stránka vůbec stáhne — tohle je ta skutečná mobilní bolest,
    // ne velikost JS bundlu. Limity výpisů: mapy 200, úkoly 1000 (base44Client).
    const payload = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { Authorization: auth.token };
      const size = async (url) => {
        const r = await fetch(url, { headers: H });
        return (await r.text()).length;
      };
      return {
        mapsBytes: await size('/api/collections/goalmaps/records?perPage=200&sort=-updated'),
        tasksBytes: await size('/api/collections/tasks/records?perPage=1000&sort=-created'),
      };
    });
    const totalKb = Math.round((payload.mapsBytes + payload.tasksBytes) / 1024);
    measured.payload = { ...payload, totalKb };
    console.log(`   plná appka stáhne na stránku mapy ${Math.round(payload.mapsBytes / 1024)} kB ` +
      `+ úkoly ${Math.round(payload.tasksBytes / 1024)} kB = ${totalKb} kB ` +
      `(sám „Můj den" už ne — má serverový endpoint; tohle spotřebují seznam projektů a tabulka úkolů)`);
    // Strop výpisu úkolů je 1000. `|| true` tu bývalo, takže kontrola nemohla
    // NIKDY spadnout — vypadala jako pojistka a nebyla. Měření nad stropem je
    // ale legitimní (schválně sáháme za hranu), takže se to jen HLÁSÍ, ne testuje.
    if (TASKS > 1000) {
      console.log(`   ⚠️ úkolů je ${TASKS}, klient jich načítá max 1000 — nad tím tabulka nevidí všechno`);
    }

    fs.writeFileSync(OUT, JSON.stringify({
      when: new Date().toISOString(),
      scale: { maps: MAPS, nodesPerMap: NODES_PER_MAP, nodesTotal: MAPS * NODES_PER_MAP, tasks: seed.tasksCreated },
      blobMaxBytes: seed.blobMaxBytes,
      measured,
    }, null, 2));
    console.log(`\n   naměřené hodnoty uloženy do ${OUT}`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
