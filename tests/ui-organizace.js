// UI e2e: přehled „Organizace" (P2-02 + P3-03, rozhodnutí 25. 8. 2026) —
// admin má položku v liště a stránku s dlaždicemi, projekty a lidmi; člen
// položku NEMÁ a přímá adresa /organizace skončí na „bez oprávnění"; klik na
// projekt vede do jeho dashboardu; odkaz u člověka vede na Úkoly s předfiltrem.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20566';
const NAME = 'flowmap-e2e-ui-organizace';
const PW = 'testheslo123';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (offset) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA'); };
const api = async (path, { token, bearer, body, method } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = token;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  let json = null; try { json = await res.json(); } catch { /* prázdné */ }
  return { status: res.status, json: json || {} };
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_UVODNI_MAPA=0 -e KB_PURPOSE_ASK=0 -p 20566:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    // data přes API: admin + člen, týmová mapa s propadlým uzlem člena, adminova soukromá s propadlým uzlem
    const reg = async (email) => {
      await api('/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
      const r = await api('/api/collections/users/auth-with-password', { body: { identity: email, password: PW } });
      const klic = (await api('/api/kb/api-keys', { token: r.json.token, body: { label: 'seed', scope: 'read_write' } })).json.token;
      return { token: r.json.token, email, klic };
    };
    const admin = await reg('admin@e2e.cz');
    const clen = await reg('clen@e2e.cz');
    const tymova = (await api('/api/kb/v1/maps', { bearer: admin.klic, body: { title: 'TYMOVY PROJEKT', tree: [
      { title: 'PROPADLA VEC', owner: clen.email, deadline: day(-4) },
      { title: 'HOTOVA VEC', owner: clen.email, status: 'done' },
    ] } })).json;
    await api('/api/kb/share', { token: admin.token, body: { mapId: tymova.id, action: 'set_team_access', access: 'read' } });
    await api('/api/kb/v1/maps', { bearer: admin.klic, body: { title: 'SOUKROMY PROJEKT', tree: [{ title: 'SOUKROMA PROPADLA', owner: admin.email, deadline: day(-9) }] } });

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const login = async (page, email) => {
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('#email');
      await page.type('#email', email); await page.type('#password', PW);
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
      await sleep(1200);
    };

    console.log('== admin: položka v liště + stránka ==');
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await login(page, admin.email);
    let nav = await page.$$eval('nav button', (els) => els.map((e) => e.dataset.nav));
    expect(nav.includes('organizace'), `admin má v liště „Organizace" (${nav.join(',')})`);
    expect(nav.indexOf('organizace') === nav.indexOf('mymap') + 1, 'položka stojí hned za „Moje mapa"');
    await page.click('nav button[data-nav="organizace"]');
    await page.waitForSelector('[data-testid="organizace-kpis"]', { timeout: 10000 });
    expect(page.url().endsWith('/organizace'), `klik vede na /organizace (${page.url()})`);
    // číslo dlaždice má vlastní testid — regex nad celým textem dlaždice by prošel i pro 10/11
    const kpi = (k) => page.$eval(`[data-testid="organizace-kpi-${k}-n"]`, (e) => e.textContent.trim());
    expect((await kpi('overdue')) === '1', `dlaždice Po termínu = 1 (jen týmová mapa; soukromá propadlá se nepočítá) (${await kpi('overdue')})`);
    expect((await kpi('projects')) === '1', `dlaždice Projektů = 1 (${await kpi('projects')})`);
    expect((await kpi('people')) === '1' && (await kpi('stuck')) === '0', `lidí s resty 1, nehýbe se 0 (${await kpi('people')}/${await kpi('stuck')})`);
    const text = await page.$eval('[data-testid="organizace-page"]', (e) => e.textContent);
    expect(text.includes('PROPADLA VEC') && text.includes('TYMOVY PROJEKT'), 'tabulka po termínu nese položku i projekt');
    expect(!text.includes('SOUKROMA PROPADLA'), 'soukromá propadlá položka na stránce NENÍ');
    expect(text.includes('SOUKROMY PROJEKT'), 'patička přiznává nezapočítaný soukromý projekt');
    expect(/50\s*%/.test(text), '% hotovo projektu = 50 % (1 ze 2 listů)');
    const personRows = await page.$$eval('[data-testid="organizace-person"]', (els) => els.map((e) => e.textContent));
    expect(personRows.length === 1 && /clen@e2e\.cz|CL/.test(personRows[0]), `tabulka lidí: 1 řádek (člen) (${personRows.length})`);
    expect(!!(await page.$('[data-testid="organizace-report"]')), 'tlačítko Report je na stránce');

    console.log('== kliky: položka → uzel v mapě, projekt → dashboard, člověk → Úkoly ==');
    // klik na položku po termínu vede PŘÍMO NA UZEL (deep-link ?node=), ne jen na mapu (Richard 25. 8.)
    const itemHref = await page.$eval('[data-testid="organizace-item"]', (a) => a.getAttribute('href'));
    expect(new RegExp(`^/map/${tymova.id}\\?node=node-`).test(itemHref), `položka odkazuje na uzel v mapě (${itemHref})`);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('[data-testid="organizace-item"]')]);
    await sleep(1500);
    expect(page.url().includes('?node=node-'), `editor otevřen s deep-linkem na uzel (${page.url()})`);
    const selected = await page.$$eval('.react-flow__node.selected, .react-flow__node[aria-selected="true"]', (els) => els.length).catch(() => 0);
    expect(selected >= 1, `uzel je v mapě zvýrazněný/vybraný (${selected})`);
    await page.goto(`${BASE}/organizace`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-testid="organizace-project"]');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('[data-testid="organizace-project"]')]);
    expect(page.url().includes(`/map/${tymova.id}`) && page.url().includes('view=dashboard'), `projekt vede do dashboardu projektu (${page.url()})`);
    await page.goto(`${BASE}/organizace`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-testid="organizace-person"] a');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('[data-testid="organizace-person"] a')]);
    await sleep(1500);
    expect(page.url().includes('/tasks'), `člověk vede na Úkoly (${page.url()})`);
    // předfiltr musí SEDNOUT, ne jen otevřít stránku: řádky Úkolů obsahují jen práci člena
    const tasksText = await page.evaluate(() => document.body.textContent);
    expect(tasksText.includes('PROPADLA VEC') && !tasksText.includes('SOUKROMA PROPADLA'),
      'Úkoly předfiltrované na člena: jeho práce ano, adminova soukromá ne');
    await page.close();

    console.log('== mobil 390 px: pátá položka lišty nesmí roztáhnout stránku ==');
    const pm = await browser.newPage();
    await pm.setViewport({ width: 390, height: 844 });
    await login(pm, admin.email);
    await pm.goto(`${BASE}/organizace`, { waitUntil: 'networkidle2' });
    await pm.waitForSelector('[data-testid="organizace-kpis"]', { timeout: 10000 });
    const sirky = await pm.evaluate(() => ({ body: document.body.scrollWidth, doc: document.documentElement.scrollWidth, win: window.innerWidth, nav: [...document.querySelectorAll('header nav button')].length }));
    expect(sirky.nav === 5 && sirky.body <= sirky.win && sirky.doc <= sirky.win, `admin má 5 položek a stránka nemá vodorovný posun (${JSON.stringify(sirky)})`);
    await pm.close();

    console.log('== člen: bez položky, /organizace = bez oprávnění ==');
    const p2 = await browser.newPage();
    await p2.setViewport({ width: 1280, height: 900 });
    await login(p2, clen.email);
    nav = await p2.$$eval('nav button', (els) => els.map((e) => e.dataset.nav));
    expect(!nav.includes('organizace'), `člen položku v liště NEMÁ (${nav.join(',')})`);
    await p2.goto(`${BASE}/organizace`, { waitUntil: 'networkidle2' });
    await p2.waitForSelector('[data-testid="organizace-noperm"]', { timeout: 10000 });
    expect(!!(await p2.$('[data-testid="organizace-noperm"]')), 'přímá adresa /organizace hlásí „bez oprávnění"');
    expect(!(await p2.$('[data-testid="organizace-kpis"]')), 'žádná čísla se členovi nevykreslí');

    console.log('== přepnutí jazyka po otevření stránky s líným namespace (nález panelu 25. 8.) ==');
    await p2.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await p2.click('[data-user-menu]');
    await p2.waitForSelector('[role="menuitem"]');
    const errs = [];
    p2.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    const klik = await p2.evaluate(() => {
      const it = [...document.querySelectorAll('[role="menuitem"]')].find((e) => /English|Česky/.test(e.textContent));
      if (it) it.click();
      return !!it;
    });
    expect(klik, 'položka přepnutí jazyka existuje');
    await sleep(2500);
    const navEn = await p2.$$eval('nav button', (els) => els.map((e) => e.textContent.trim()));
    expect(navEn.includes('Projects'), `jazyk se přepnul na EN (lišta: ${navEn.join(',')})`);
    expect(!errs.some((e) => /jazyk se nepodařilo|not valid JSON/.test(e)), `přepnutí neshodí chybu „not valid JSON" (${errs.length} chyb)`);
  } catch (e) {
    fail++; console.log('  ❌ výjimka', e.message);
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} ui-organizace: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
