// UI e2e: OPAKOVÁNÍ NA CÍLECH (v0.35, Richard 17. 8. 2026) — přepínač v detailu
// cíle (kategorie Zadání) spravuje obyčejné automatizační pravidlo:
//   zapnout → pravidlo vznikne (trigger done → set_status todo + set_deadline advance)
//   a na kartě cíle svítí 🔁; vypnout → pravidlo i odznak zmizí;
//   ručně upravené pravidlo přepínač přizná jako „vlastní" a NEsahá na něj.
// Výpočet termínů testuje rules-engine.js — tady jde o UI správu pravidla.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-ui-opakovani';
const PORT = 20624;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';
const EMAIL = 'a@e2e.cz';

let pass = 0, fail = 0;
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

const cizihoPuvodu = (m) => {
  const u = (m.location() && m.location().url) || '';
  return /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u);
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -e KB_UVODNI_MAPA=0 -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: EMAIL, password: PW, passwordConfirm: PW } });
    const T = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: EMAIL, password: PW } })).json.token;
    const mapa = (await api('POST', '/api/collections/goalmaps/records', { token: T, body: {
      title: 'Opakování mapa',
      nodes: [
        { id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'PROVOZ', title: 'PROVOZ', status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 300, y: 380 }, data: { title: 'Týdenní report', status: 'todo', deadline: '2026-09-07' } },
      ],
      edges: [{ id: 'e1', source: 'apex', target: 'n1' }],
    } })).json;
    expect(!!mapa.id, 'mapa založena');
    const rulesOf = async () => ((await api('GET', `/api/kb/rules?map=${mapa.id}`, { token: T })).json || {}).rules || [];

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', EMAIL);
    await page.type('#password', PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1500);

    await page.goto(`${BASE}/map/${mapa.id}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 2, { timeout: 45000 }).catch(() => {});
    await sleep(1500);

    const dblclickNa = (hledany) => page.evaluate((h) => {
      const el = [...document.querySelectorAll('.react-flow__node *')].find((x) => (x.innerText || '').trim() === h);
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    }, hledany);
    const otevriKategorii = (id) => page.evaluate((k) => {
      const b = document.querySelector(`[role="dialog"] [data-cat="${k}"]`);
      if (!b) return false;
      b.click();
      return true;
    }, id);

    console.log('== zapnout Týdně → vznikne pravidlo + 🔁 ==');
    expect(await dblclickNa('Týdenní report'), 'otevřen dialog cíle');
    await sleep(1000);
    expect(await otevriKategorii('assignment'), 'kategorie Zadání existuje');
    await sleep(600);
    let telo = await page.evaluate(() => document.body.innerText);
    expect(/Opakování/.test(telo) && /Neopakuje se/.test(telo), 'přepínač Opakování je v Zadání a stojí na „Neopakuje se"');
    // otevřít select (shadcn combobox) a vybrat Týdně
    const otevriSwitch = () => page.evaluate(() => {
      const trig = document.querySelector('[role="dialog"] [data-testid="recurrence-switch"]');
      if (!trig) return false;
      trig.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      trig.click();
      return true;
    });
    expect(await otevriSwitch(), 'přepínač jde otevřít');
    await sleep(600);
    await page.evaluate(() => {
      const o = [...document.querySelectorAll('[role="option"]')].find((x) => /Týdně/.test(x.innerText || ''));
      if (o) o.click();
    });
    await sleep(1500);
    let pravidla = await rulesOf();
    const opak = pravidla.find((r) => r.node_id === 'n1' && (r.actions || []).some((a) => a.type === 'set_deadline' && a.advance === 'weekly'));
    expect(!!opak, `pravidlo s advance: weekly vzniklo (${pravidla.length} pravidel)`);
    expect((opak?.actions || []).some((a) => a.type === 'set_status' && a.status === 'todo'), 'a vrací cíl na todo');
    await page.keyboard.press('Escape');
    await sleep(800);
    expect(!!(await page.$('[data-testid="node-recurrence-badge"]')), 'na kartě cíle svítí 🔁');

    console.log('== přepínač si stav pamatuje; vypnutí pravidlo smaže ==');
    expect(await dblclickNa('Týdenní report'), 'dialog znovu otevřen');
    await sleep(1000);
    await otevriKategorii('assignment');
    await sleep(600);
    telo = await page.evaluate(() => document.body.innerText);
    expect(/Týdně/.test(telo), 'přepínač ukazuje Týdně');
    expect(await otevriSwitch(), 'přepínač jde otevřít podruhé');
    await sleep(600);
    await page.evaluate(() => {
      const o = [...document.querySelectorAll('[role="option"]')].find((x) => /Neopakuje se/.test(x.innerText || ''));
      if (o) o.click();
    });
    await sleep(1500);
    pravidla = await rulesOf();
    expect(!pravidla.some((r) => r.node_id === 'n1'), `vypnutí pravidlo smazalo (${pravidla.length})`);
    await page.keyboard.press('Escape');
    await sleep(800);
    expect(!(await page.$('[data-testid="node-recurrence-badge"]')), '🔁 zmizel');

    console.log('== ručně upravené pravidlo přepínač přizná a nesahá na něj ==');
    const vlastni = (await api('POST', '/api/kb/rules/save', { token: T, body: {
      map: mapa.id, name: 'Vlastní opakování', node_id: 'n1',
      trigger: { type: 'node_status_changed', status: 'done' },
      conditions: [{ field: 'owner', op: 'empty' }],
      actions: [{ type: 'set_status', status: 'todo' }, { type: 'set_deadline', advance: 'weekly' }],
    } })).json.rule;
    expect(!!vlastni?.id, 'vlastní (upravené) pravidlo založeno přes API');
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2000);
    expect(await dblclickNa('Týdenní report'), 'dialog otevřen potřetí');
    await sleep(1000);
    await otevriKategorii('assignment');
    // pravidla mapy se načítají asynchronně — počkat, až dialog přepne na hlášení
    let vlastniHlaseni = false;
    for (let i = 0; i < 20 && !vlastniHlaseni; i++) {
      await sleep(500);
      telo = await page.evaluate(() => document.body.innerText);
      vlastniHlaseni = /upravené pravidlo/i.test(telo) && !(await page.$('[role="dialog"] [data-testid="recurrence-switch"]'));
    }
    expect(vlastniHlaseni, 'místo přepínače je poctivé hlášení o vlastním pravidle');
    pravidla = await rulesOf();
    expect(pravidla.length === 1 && pravidla[0].id === vlastni.id, 'vlastní pravidlo zůstalo nedotčené');

    expect(errs.length === 0, `konzole bez chyb (${errs.slice(0, 2).join(' | ') || 'čistá'})`);
  } catch (err) {
    fail++;
    console.log('  ❌ výjimka: ' + (err && err.stack ? err.stack : err));
  } finally {
    if (browser) await browser.close();
    try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch { /* už je pryč */ }
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} UI OPAKOVÁNÍ PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
