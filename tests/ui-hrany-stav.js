// UI e2e: BARVA A ANIMACE ČAR podle stavu CÍLOVÉHO cíle (Richard 19. 8. 2026).
//   • čára do HOTOVÉHO cíle = --canvas-edge-done a NEHÝBE SE,
//   • čára do cíle PO TERMÍNU = --canvas-edge-late a běží rychleji,
//   • všechno ostatní = --canvas-edge, beze změny.
//
// Barvy jsou TOKENY SKINU, ne pevné hodnoty: v Lese je neutrální čára zelená
// a v Rubínu červená, takže natvrdo zapsaná zelená/červená by v půlce vzhledů
// nic neodlišila. Test proto porovnává s ROZLOŽENOU hodnotou tokenu, ne s hex.
//
// ⚠️ Pozitivní protikontrola je součástí zadání: neutrální čára MUSÍ zůstat
// na --canvas-edge. Kód, který obarví všechno stejně, tudy neprojde.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'flowmap-e2e-hrany-stav';
const PORT = 20521;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const den = (posun) => new Date(Date.now() + posun * 86400000).toISOString().slice(0, 10);

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e TZ=Europe/Prague -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await fetch(`${BASE}/api/collections/users/records`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'hrany@e2e.cz', password: PW, passwordConfirm: PW }),
    });
    const auth = await (await fetch(`${BASE}/api/collections/users/auth-with-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: 'hrany@e2e.cz', password: PW }),
    })).json();

    // Uzly ROZTAŽENÉ do šířky: při těsném rozestupu se čáry překrývají a přes sebe,
    // takže rozdíl barev ani tloušťky není spolehlivě měřitelný — a člověku na
    // snímku připadá rozbitý, i když je v pořádku (Richard 19. 8. 2026 při klik-testu).
    const uzel = (id, title, x, extra) => ({ id, type: 'goalNode', position: { x: x * 2.2, y: 520 },
      data: Object.assign({ title, status: 'todo', description: '', collapsed: false, color: '', nodeType: 'normal', goalType: '', apexText: '', deadline: '', owner: '' }, extra) });
    const mapa = await (await fetch(`${BASE}/api/collections/goalmaps/records`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth.token },
      body: JSON.stringify({
        title: 'Hrany',
        nodes: [
          { id: 'R', type: 'apexNode', position: { x: 990, y: 0 }, data: { nodeType: 'apex', apexText: 'Vrchol', title: '', status: 'todo' } },
          uzel('bezny', 'Bezny cil', 0),
          uzel('hotovy', 'Hotovy cil', 300, { status: 'done' }),
          uzel('propadly', 'Propadly cil', 600, { deadline: den(-3) }),
          // hotový A ZÁROVEŇ po termínu → musí vyhrát ZELENÁ (dodělané se nehlásí
          // jako zpožděné; getDeadlineStatus u done vrací 'normal')
          uzel('oboji', 'Hotovy po terminu', 900, { status: 'done', deadline: den(-5) }),
        ],
        edges: [
          { id: 'e1', source: 'R', target: 'bezny' }, { id: 'e2', source: 'R', target: 'hotovy' },
          { id: 'e3', source: 'R', target: 'propadly' }, { id: 'e4', source: 'R', target: 'oboji' },
        ],
      }),
    })).json();
    ok(!!mapa.id, `mapa založená (${mapa.id || JSON.stringify(mapa).slice(0, 80)})`);

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1000 });

    const chyby = [];
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

    await page.goto(`${BASE}/map/${mapa.id}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__edge').length >= 4, { timeout: 45000 }).catch(() => {});
    await sleep(1500);

    // KOTVA PROTI ZELENÉ NA PRÁZDNÉ STRÁNCE: bez živé mapy nedokazuje nic dalšího
    const pocty = await page.evaluate(() => ({
      uzly: document.querySelectorAll('.react-flow__node').length,
      hrany: document.querySelectorAll('.react-flow__edge').length,
    }));
    ok(pocty.uzly === 5 && pocty.hrany === 4, `mapa je živá: 5 uzlů, 4 hrany (${pocty.uzly}/${pocty.hrany})`);

    const stav = await page.evaluate(() => {
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      const resolve = (v) => { probe.style.color = v; return getComputedStyle(probe).color; };
      const out = { want: {}, hrany: {} };
      out.want.normal = resolve('hsl(var(--canvas-edge))');
      out.want.done = resolve('hsl(var(--canvas-edge-done))');
      out.want.late = resolve('hsl(var(--canvas-edge-late))');
      for (const g of document.querySelectorAll('.react-flow__edge[data-stav-hrany]')) {
        const path = g.querySelector('.react-flow__edge-path');
        out.hrany[g.getAttribute('data-id')] = {
          stav: g.getAttribute('data-stav-hrany'),
          stroke: path ? getComputedStyle(path).stroke : null,
          // animace: xyflow dává animovaným hranám třídu `animated`; hotová ji
          // nesmí mít vůbec, propadlá ji má se zkrácenou dobou z index.css
          animated: g.classList.contains('animated'),
          doba: path ? getComputedStyle(path).animationDuration : null,
          tloustka: path ? getComputedStyle(path).strokeWidth : null,
        };
      }
      probe.remove();
      return out;
    });

    ok(Object.keys(stav.hrany).length === 4, `všechny hrany nesou data-stav-hrany (${Object.keys(stav.hrany).length})`);
    ok(stav.want.done !== stav.want.normal && stav.want.late !== stav.want.normal,
      'tokeny done/late se ve výchozím vzhledu liší od neutrálního');

    const e1 = stav.hrany.e1 || {}, e2 = stav.hrany.e2 || {}, e3 = stav.hrany.e3 || {}, e4 = stav.hrany.e4 || {};

    console.log('== neutrální čára se NEMĚNÍ (pozitivní protikontrola) ==');
    ok(e1.stav === 'normal', 'čára k běžnému cíli má stav normal');
    ok(e1.stroke === stav.want.normal, `a barvu --canvas-edge (${e1.stroke})`);
    ok(e1.animated === true, 'a pořád se hýbe');

    console.log('== HOTOVO: zelená a bez pohybu ==');
    ok(e2.stav === 'done', 'čára k hotovému cíli má stav done');
    ok(e2.stroke === stav.want.done, `a barvu --canvas-edge-done (${e2.stroke})`);
    ok(e2.animated === false, 'a NEHÝBE se (práce doběhla)');

    console.log('== PO TERMÍNU: červená a rychleji ==');
    ok(e3.stav === 'late', 'čára k propadlému cíli má stav late');
    ok(e3.stroke === stav.want.late, `a barvu --canvas-edge-late (${e3.stroke})`);
    ok(e3.animated === true, 'a hýbe se');
    ok(e3.doba === '0.2s', `rychleji než neutrální (${e3.doba} vs ${e1.doba})`);

    console.log('== hotové PO TERMÍNU je pořád hotové (zelená vyhrává) ==');
    ok(e4.stav === 'done', 'hotový cíl s propadlým termínem má čáru done, ne late');

    console.log('== vybranou čáru dělá TLOUŠŤKA, ne barva ==');
    // ⚠️ Střed OBDÉLNÍKU obepínajícího čáru NENÍ bod na čáře: hrany jsou zalomené
    // („L"), takže u roztažených uzlů leží střed bboxu v prázdnu a klik mine.
    // Bereme bod v polovině DÉLKY dráhy a převedeme ho do souřadnic obrazovky.
    const vybrana = await page.evaluate(() => {
      const p = document.querySelector('.react-flow__edge[data-id="e1"] .react-flow__edge-path');
      if (!p) return null;
      const bod = p.getPointAtLength(p.getTotalLength() / 2);
      const m = p.getScreenCTM();
      return { x: bod.x * m.a + bod.y * m.c + m.e, y: bod.x * m.b + bod.y * m.d + m.f };
    });
    if (vybrana) {
      await page.mouse.click(vybrana.x, vybrana.y);
      await sleep(500);
      const po = await page.evaluate(() => {
        const p = document.querySelector('.react-flow__edge[data-id="e1"] .react-flow__edge-path');
        const g = document.querySelector('.react-flow__edge[data-id="e1"]');
        return {
          stroke: p ? getComputedStyle(p).stroke : null,
          sirka: p ? getComputedStyle(p).strokeWidth : null,
          vybrana: !!(g && g.classList.contains('selected')),
        };
      });
      // ⚠️ ŽÁDNÁ úniková větev `ok(true)`: dřív tady byla a dělala tvrzení VŽDY
      // zeleným, když se klik nepovedl — přesně past „vždy zelená". Když klik
      // hranu nevybere, je to CHYBA sady, ne důvod k prominutí.
      ok(po.vybrana, 'klik na čáru ji vybral');
      // Vybranou hranu dělá TLOUŠŤKA, ne barva (rozhodnutí Richarda 19. 8. 2026):
      // `--ring` je ve 12 z 22 variant skinů shodná s `--canvas-edge`, takže
      // barevné zvýraznění by v půlce vzhledů nebylo vidět.
      ok(po.stroke === e1.stroke, `vybraná čára si nechává barvu stavu (${po.stroke})`);
      ok(parseFloat(po.sirka) > parseFloat(e1.tloustka || '2'),
        `a je ZNATELNĚ silnější než nevybraná (${po.sirka} vs ${e1.tloustka})`);
    } else {
      ok(false, 'čára e1 nebyla na plátně k nalezení');
    }

    ok(chyby.length === 0, `konzole bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 120) : ''})`);
  } catch (err) {
    fail++; console.log('  ❌ výjimka:', err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
