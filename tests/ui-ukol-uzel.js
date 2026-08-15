// UI e2e: úkol vždy na KONKRÉTNÍM uzlu — vrchol úkoly nepřijímá (13. 8. 2026).
// Dialog úkolu nenabízí vrchol, bez vybraného cíle nejde uložit; dialog vrcholu
// nemá sekci „Úkol k tomuto uzlu". Server odmítá úkol bez uzlu i na vrcholu
// (to jistí api-rls.js — tady se hlídá, že UI ten stav vůbec neumožní).
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-ukol-uzel';
const PORT = 20622;
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
    execSync(`docker run -d --name ${NAME} -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: EMAIL, password: PW, passwordConfirm: PW } });
    const T = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: EMAIL, password: PW } })).json.token;
    const mapa = (await api('POST', '/api/collections/goalmaps/records', { token: T, body: {
      title: 'Uzel je úkol',
      nodes: [
        { id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'VRCHOL PROJEKT', title: 'VRCHOL PROJEKT', status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 100, y: 380 }, data: { title: 'Objednávky', status: 'todo' } },
        { id: 'n2', type: 'goalNode', position: { x: 500, y: 380 }, data: { title: 'Web a marketing', status: 'todo' } },
      ],
      edges: [{ id: 'e1', source: 'apex', target: 'n1' }, { id: 'e2', source: 'apex', target: 'n2' }],
    } })).json;
    expect(!!mapa.id, 'mapa založena');

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

    console.log('== dialog úkolu: vrchol se nenabízí, bez cíle nejde uložit ==');
    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Nový úkol/.test(x.innerText || ''));
      if (b) b.click();
    });
    await page.waitForSelector('#task-title', { timeout: 8000 }).catch(() => {});
    expect(!!(await page.$('#task-title')), 'dialog úkolu se otevřel');
    await page.type('#task-title', 'Zkouška pravidla');

    // shadcn selecty nemají id — hledá se combobox vedle popisku (Label)
    const otevriSelect = async (popisek) => {
      const ok = await page.evaluate((lbl) => {
        const label = [...document.querySelectorAll('[role="dialog"] label')].find((x) => (x.innerText || '').trim() === lbl);
        const trig = label && label.parentElement.querySelector('[role="combobox"]');
        if (!trig) return false;
        trig.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        trig.click();
        return true;
      }, popisek);
      await sleep(600);
      return ok;
    };
    expect(await otevriSelect('Mapa'), 'otevřen výběr projektu');
    await page.evaluate(() => {
      const o = [...document.querySelectorAll('[role="option"]')].find((x) => /Uzel je úkol/.test(x.innerText || ''));
      if (o) o.click();
    });
    await sleep(600);

    expect(await otevriSelect('Uzel mapy'), 'otevřen výběr cíle');
    const moznosti = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => (o.innerText || '').trim()));
    expect(moznosti.includes('Objednávky') && moznosti.includes('Web a marketing'),
      `nabídka obsahuje běžné cíle (${moznosti.join(' | ')})`);
    expect(!moznosti.some((m) => /VRCHOL PROJEKT/.test(m)), 'VRCHOL se v nabídce cílů NEnabízí');

    // zavřít nabídku bez výběru → uložení musí být zamčené
    await page.keyboard.press('Escape');
    await sleep(400);
    const ulozitDisabled = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /^(Vytvořit|Uložit|Create|Save)$/.test((x.innerText || '').trim()));
      return b ? b.disabled : null;
    });
    expect(ulozitDisabled === true, `bez vybraného cíle je Uložit zamčené (${ulozitDisabled})`);

    // vybrat cíl → uložit → úkol má v databázi správný uzel
    expect(await otevriSelect('Uzel mapy'), 'znovu otevřen výběr cíle');
    await page.evaluate(() => {
      const o = [...document.querySelectorAll('[role="option"]')].find((x) => /Objednávky/.test(x.innerText || ''));
      if (o) o.click();
    });
    await sleep(400);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /^(Vytvořit|Uložit|Create|Save)$/.test((x.innerText || '').trim()));
      if (b) b.click();
    });
    await sleep(1500);
    const ulozene = (await api('GET', `/api/collections/tasks/records?filter=${encodeURIComponent(`title='Zkouška pravidla'`)}`, { token: T })).json;
    const zaznam = (ulozene.items || [])[0];
    expect(zaznam && zaznam.node_id === 'n1', `úkol se uložil na vybraný cíl (${zaznam && zaznam.node_id})`);

    console.log('== dialog vrcholu nemá „Úkol k tomuto uzlu" ==');
    await page.goto(`${BASE}/map/${mapa.id}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 3, { timeout: 45000 }).catch(() => {});
    expect(await page.evaluate(() => document.querySelectorAll('.react-flow__node').length) === 3, 'vykresleny 3 uzly');
    await sleep(1500);

    const dblclickNa = (hledany) => page.evaluate((h) => {
      const el = [...document.querySelectorAll('.react-flow__node *')].find((x) => (x.innerText || '').trim() === h);
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    }, hledany);

    // editor mapy má od 14. 8. 2026 VELKÉ okno s kategoriemi — nabídka úkolu
    // bydlí v kategorii „Úkoly a komentáře", je potřeba na ni kliknout
    const otevriKategorii = (id) => page.evaluate((k) => {
      const b = document.querySelector(`[role="dialog"] [data-cat="${k}"]`);
      if (!b) return false;
      b.click();
      return true;
    }, id);

    expect(await dblclickNa('Objednávky'), 'otevřen dialog běžného cíle');
    await sleep(1000);
    expect(await otevriKategorii('tasks'), 'kategorie Úkoly a komentáře existuje');
    await sleep(600);
    let telo = await page.evaluate(() => document.body.innerText);
    expect(/Úkol k tomuto uzlu/.test(telo), 'běžný cíl nabídku úkolu MÁ');
    await page.keyboard.press('Escape');
    await sleep(600);

    expect(await dblclickNa('VRCHOL PROJEKT'), 'otevřen dialog vrcholu');
    await sleep(1000);
    await otevriKategorii('tasks'); // vrchol kategorii má, ale úkolovou nabídku v ní NE
    await sleep(600);
    telo = await page.evaluate(() => document.body.innerText);
    expect(!/Úkol k tomuto uzlu/.test(telo), 'vrchol nabídku úkolu NEMÁ');

    expect(errs.length === 0, `konzole bez chyb (${errs.slice(0, 2).join(' | ') || 'čistá'})`);
  } catch (err) {
    fail++;
    console.log('  ❌ výjimka: ' + (err && err.stack ? err.stack : err));
  } finally {
    if (browser) await browser.close();
    try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch { /* už je pryč */ }
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} UI UZEL=ÚKOL PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
