// UI e2e: automatizace doběhne, zatímco mám otevřený editor a rozepsanou změnu.
//
// Callback agenta zapíše uzel jako hotový, čímž posune verzi mapy. Autosave
// editoru pak narazí na 409 a DŘÍV vyskočil tvrdý dotaz „mapa byla změněna,
// načíst znovu?" — tedy ztráta rozepsané práce, a to zrovna ve scénáři, kvůli
// kterému se automatizace zavádějí (proces běží, lidé se dívají do mapy).
//
// Když je cizí změna JEN posun stavu uzlu, musí se slít tiše: rozepsaná změna
// zůstane, nový stav se objeví a nic se uživatele neptá.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'flowmap-e2e-conflict';
const PORT = 20518;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

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

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: 'a@e2e.cz', password: PW, passwordConfirm: PW } });
    const A = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@e2e.cz', password: PW } })).json.token;
    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Souběh',
      nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Proces', title: 'Proces', status: 'todo' } },
        { id: 'auto', type: 'goalNode', position: { x: 0, y: 120 }, data: { title: 'Dělá to stroj', status: 'in_progress', owner: 'a@e2e.cz' } },
        { id: 'muj', type: 'goalNode', position: { x: 260, y: 120 }, data: { title: 'Můj krok', status: 'todo', owner: 'a@e2e.cz' } },
      ],
      edges: [{ id: 'e1', source: 'root', target: 'auto' }, { id: 'e2', source: 'root', target: 'muj' }],
    } })).json;

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
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

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', 'a@e2e.cz');
    await page.type('#password', PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1500);
    await page.goto(`${BASE}/map/${map.id}`, { waitUntil: 'networkidle2' });
    await sleep(2500);

    // POŘADÍ JE PODSTATNÉ. Nejdřív necháme editor doběhnout (úvodní autosave po
    // načtení), pak teprve „doběhne automatizace" — jinak by simulace callbacku
    // přepsala mapu zastaralými uzly a vyrobila falešnou kolizi obsahu, kterou
    // slévat NEMÁME (a test by měřil něco jiného, než měl).
    await sleep(3000);

    // automatizace doběhla: server označí svůj uzel za hotový (jako agent-callback)
    const fresh = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: {
      nodes: fresh.nodes.map((n) => (n.id === 'auto' ? { ...n, data: { ...n.data, status: 'done' } } : n)),
      edges: fresh.edges,
    } });
    await sleep(300);

    // ...a TEĎ uživatel rozepíše svou změnu, aniž by o tom věděl
    const renamed = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h3')].find((x) => /Můj krok/.test(x.innerText || ''));
      if (!h) return false;
      h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    });
    expect(renamed, 'otevřen dialog mého cíle');
    await sleep(1000);
    await page.evaluate(() => { const i = document.querySelector('#title'); if (i) i.value = ''; });
    await page.type('#title', 'Můj krok ROZEPSANÝ');
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /^(Uložit|Save)/.test((x.innerText || '').trim()));
      if (b) b.click();
    });
    await sleep(5000);

    const body = await page.evaluate(() => document.body.innerText);
    expect(!/načíst znovu|Načíst znovu|reload/i.test(body), 'nevyskočil tvrdý dotaz na přenačtení');
    expect(/ROZEPSANÝ/.test(body), 'rozepsaná změna zůstala v mapě');

    // a doputovala i na server (autosave po slití proběhl)
    await sleep(2500);
    const after = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
    expect(after.nodes.find((n) => n.id === 'muj').data.title === 'Můj krok ROZEPSANÝ',
      `rozepsaná změna se uložila (${after.nodes.find((n) => n.id === 'muj').data.title})`);
    expect(after.nodes.find((n) => n.id === 'auto').data.status === 'done',
      `stav od automatizace se nepřepsal zpátky (${after.nodes.find((n) => n.id === 'auto').data.status})`);

    const real = errs.filter((e) => !/favicon|Failed to load resource/i.test(e));
    expect(real.length === 0, `konzole bez chyb (${real.slice(0, 2).join(' | ') || 'čistá'})`);
  } catch (err) {
    fail++;
    console.log('  ❌ výjimka: ' + (err && err.stack ? err.stack : err));
  } finally {
    if (browser) await browser.close();
    try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch { /* už je pryč */ }
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} UI CONFLICT MERGE PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
