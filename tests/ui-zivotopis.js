// UI e2e: ŽIVOTOPIS CÍLE v okně cíle (Richard 19. 8. 2026: „spíš bych to viděl
// v detailu uzlu… potřebuji tam ne jen datumy, ale i časy a všechny změny").
//
// Hlídá to, co odlišuje životopis od souhrnu na dashboardu:
//   • je v okně cíle jako vlastní kategorie,
//   • každá událost nese ČAS, ne jen datum,
//   • ukazuje i to, co se dosud nikde nezobrazovalo (zadání, ikona, barva),
//   • komentář se objeví, aniž by se kvůli tomu cokoli logovalo dopředu.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'flowmap-e2e-zivotopis';
const PORT = 20523;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdná odpověď */ }
  return { status: res.status, json };
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -e TZ=Europe/Prague -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: 'zivot@e2e.cz', password: PW, passwordConfirm: PW } });
    const auth = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'zivot@e2e.cz', password: PW } })).json;

    const uzel = (id, title, x, extra) => ({ id, type: 'goalNode', position: { x, y: 320 },
      data: Object.assign({ title, status: 'todo', description: '', collapsed: false, color: '',
        nodeType: 'normal', goalType: '', apexText: '', deadline: '', owner: '' }, extra) });
    const mapa = (await api('POST', '/api/collections/goalmaps/records', {
      token: auth.token,
      body: {
        title: 'Zivotopis', owner: auth.record.id, owner_email: auth.record.email,
        nodes: [
          { id: 'R', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'Vrchol', title: '', status: 'todo' } },
          uzel('c1', 'Sledovany cil', 0),
          uzel('c2', 'Cisty cil', 300),
        ],
        edges: [{ id: 'e1', source: 'R', target: 'c1' }, { id: 'e2', source: 'R', target: 'c2' }],
      },
    })).json;
    ok(!!mapa.id, `mapa založená (${mapa.id || 'CHYBA'})`);

    // pohyb, který má být v životopisu vidět
    const m = (await api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: auth.token })).json;
    for (const n of m.nodes) if (n.id === 'c1') {
      n.data.status = 'in_progress'; n.data.description = 'Nove zadani'; n.data.icon = '📌';
    }
    await api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, { token: auth.token, body: { nodes: m.nodes, edges: m.edges } });
    await sleep(400);
    await api('POST', '/api/collections/comments/records', {
      token: auth.token, body: { goalmap: mapa.id, node_id: 'c1', text: 'Poznamka k cili' },
    });
    await sleep(400);

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1000 });
    const chyby = [];
    const cizihoPuvodu = (x) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test((x.location() && x.location().url) || '');
    page.on('console', (x) => { if (x.type() === 'error' && !cizihoPuvodu(x)) chyby.push(x.text()); });
    page.on('pageerror', (e) => chyby.push(String(e)));

    await page.evaluateOnNewDocument((t, r) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: r }));
      localStorage.setItem('kb-lang', 'cs');
    }, auth.token, auth.record);

    await page.goto(`${BASE}/map/${mapa.id}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 3, { timeout: 45000 }).catch(() => {});
    await sleep(1500);
    ok(await page.evaluate(() => document.querySelectorAll('.react-flow__node').length) === 3, 'mapa je živá (3 uzly)');

    // Okno cíle otevírá tlačítko „Upravit" na kartě. Dvojklik funguje taky, ale
    // jen na vnitřním bloku karty — syntetická událost na kořeni uzlu bublá
    // NAHORU, takže se k němu nedostane (spolklo to první běh sady).
    const otevriCil = async (nadpis) => {
      const bod = await page.evaluate((n) => {
        const el = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes(n));
        if (!el) return null;
        const b = [...el.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '') === 'Upravit');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, nadpis);
      if (!bod) return false;
      await page.mouse.click(bod.x, bod.y);
      await sleep(1400);
      return true;
    };

    ok(await otevriCil('Sledovany cil'), 'cíl „Sledovany cil" jde otevřít');
    await page.waitForSelector('[data-cat="history"]', { timeout: 15000 });
    ok(true, 'okno cíle nabízí kategorii Životopis');

    await page.click('[data-cat="history"]');
    await page.waitForSelector('[data-section="historie"]', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-historie-radek]').length > 0, { timeout: 15000 }).catch(() => {});
    await sleep(600);

    const zivot = await page.evaluate(() => {
      const radky = [...document.querySelectorAll('[data-historie-radek]')];
      return {
        pocet: radky.length,
        text: radky.map((r) => r.innerText).join('\n'),
        casy: [...document.querySelectorAll('[data-historie-cas]')].map((c) => c.innerText),
      };
    });

    ok(zivot.pocet >= 4, `životopis má řádky (${zivot.pocet})`);
    ok(/Stav/.test(zivot.text), 'je v něm změna stavu');
    ok(/zadání|zadani/i.test(zivot.text), 'je v něm změna zadání (dřív nikde nebyla vidět)');
    ok(/ikon/i.test(zivot.text), 'je v něm změna ikony');
    ok(/koment/i.test(zivot.text), 'je v něm přidaný komentář');
    // text komentáře se v životopisu NEUKAZUJE (rozhodnutí 19. 8. 2026) —
    // a hlavně ani nepřijde ze serveru, což hlídá node-history.js
    ok(!/Poznamka k cili/.test(zivot.text), 'ale NE jeho text — ten patří do Úkolů a komentářů');

    console.log('== JÁDRO: čas, ne jen datum ==');
    const sCasem = zivot.casy.filter((c) => /\d{1,2}:\d{2}/.test(c));
    ok(zivot.casy.length > 0 && sCasem.length === zivot.casy.length,
      `všechna razítka nesou i čas (${zivot.casy.length}/${zivot.casy.length}, např. „${zivot.casy[0] || '—'}")`);

    console.log('== cíl bez historie nelže ==');
    await page.keyboard.press('Escape');
    await sleep(800);
    ok(await otevriCil('Cisty cil'), 'cíl „Cisty cil" jde otevřít');
    await page.waitForSelector('[data-cat="history"]', { timeout: 15000 });
    await page.click('[data-cat="history"]');
    await page.waitForSelector('[data-section="historie"]', { timeout: 15000 });
    await sleep(900);
    const cisty = await page.evaluate(() => ({
      radky: document.querySelectorAll('[data-historie-radek]').length,
      text: document.querySelector('[data-section="historie"]').innerText,
    }));
    // ⚠️ Kotva proti „zelené na prázdné stránce": prázdno se musí PŘIZNAT větou,
    // ne jen nepřítomností řádků (ta by prošla i při rozbitém načítání).
    ok(cisty.radky === 0, `nedotčený cíl nemá řádky (${cisty.radky})`);
    ok(/Zatím se tu nic nestalo/.test(cisty.text), 'a říká to větou, ne prázdnem');

    ok(chyby.length === 0, `konzole bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 140) : ''})`);
  } catch (err) {
    fail++; console.log('  ❌ výjimka:', err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
