// UI e2e: deep-link /map/:id?node=<id> (klik na položku v „Můj den" / na úkol po
// termínu) musí ZAOSTŘIT na uzel a nechat vidět jeho okolí — ne ukázat celou mapu.
//
// Chránění regrese: o výřez se po načtení perou tři věci — fitView z onInit
// (120 ms), dofit po překlopení směru (80 ms) a centrování na uzel (60 ms od
// chvíle, kdy jsou data mapy). Podle toho, jestli data dorazí před initem plátna
// nebo po něm, jednou vyhrálo zaostření a podruhé celková mapa. Uzel se přitom
// VŽDY zvýraznil, takže na první pohled to vypadalo, že deep-link funguje.
// Proto se tu měří ZOOM a POČET viditelných uzlů, a to opakovaně.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20516', PW = 'testheslo123';
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
    execSync('docker rm -f flowmap-e2e-deeplink 2>/dev/null; true');
    execSync(`docker run -d --name flowmap-e2e-deeplink -e KB_PURPOSE_ASK=0 -p 20516:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* startuje */ } await sleep(1000); }
    await api('POST', '/api/collections/users/records', { body: { email: 'a@e2e.cz', password: PW, passwordConfirm: PW } });
    const A = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@e2e.cz', password: PW } })).json.token;

    // široká mapa: vrchol + 12 potomků, aby „celá mapa" byla výrazně oddálená
    const nodes = [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Proces', title: 'Proces', status: 'todo' } }];
    const edges = [];
    for (let i = 1; i <= 12; i++) {
      nodes.push({ id: 'n' + i, type: 'goalNode', position: { x: (i - 6) * 300, y: 400 }, data: { title: 'Krok ' + i, status: 'todo', owner: 'a@e2e.cz' } });
      edges.push({ id: 'e' + i, source: 'root', target: 'n' + i });
    }
    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Zoom test', nodes, edges } })).json;

    br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await br.newPage();
    await page.setViewport({ width: 1400, height: 900 });
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
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(BASE + '/login', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', 'a@e2e.cz');
    await page.type('#password', PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1500);

    const zoomOf = () => page.evaluate(() => {
      const v = document.querySelector('.react-flow__viewport');
      const m = v && v.style.transform.match(/scale\(([\d.]+)\)/);
      return m ? parseFloat(m[1]) : null;
    });
    const visibleNodes = () => page.evaluate(() => {
      const r = { w: window.innerWidth, h: window.innerHeight };
      return [...document.querySelectorAll('.react-flow__node')].filter((n) => {
        const b = n.getBoundingClientRect();
        return b.right > 0 && b.left < r.w && b.bottom > 0 && b.top < r.h && b.width > 4;
      }).length;
    });

    await page.goto(`${BASE}/map/${map.id}`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    const zAll = await zoomOf(), nAll = await visibleNodes();
    ok(zAll !== null, `plátno se vykreslilo (zoom ${zAll})`);
    ok(nAll >= 10, `bez deep-linku je vidět celá mapa (${nAll} uzlů)`);

    // opakovaně — závada byla načasovací, takže jeden průchod nic nedokazuje
    for (const attempt of [1, 2, 3]) {
      await page.goto(`${BASE}/map/${map.id}?node=n6`, { waitUntil: 'networkidle2' });
      await sleep(2800);
      const z = await zoomOf(), n = await visibleNodes();
      const sel = await page.evaluate(() => !!document.querySelector('.react-flow__node.selected'));
      ok(z > zAll * 1.3, `pokus ${attempt}: přiblíženo oproti celé mapě (${zAll} → ${z})`);
      ok(n >= 2 && n <= 8, `pokus ${attempt}: vidět cíl i okolí, ne jen jeden uzel (${n})`);
      ok(sel, `pokus ${attempt}: cílový uzel je zvýrazněný`);
    }

    const real = errs.filter((e) => !/favicon|Failed to load resource/i.test(e));
    ok(real.length === 0, `konzole bez chyb (${real.slice(0, 2).join(' | ') || 'čistá'})`);
  } catch (e) {
    fail++;
    console.log('  ❌ ' + e.stack);
  } finally {
    if (br) await br.close();
    try { execSync('docker rm -f flowmap-e2e-deeplink', { stdio: 'ignore' }); } catch { /* už je pryč */ }
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} DEEPLINK ZOOM PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
