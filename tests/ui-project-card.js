// UI e2e: dlaždice projektu na titulce.
//
// Hlídá rozvržení, na kterém se Richard 27. 7. 2026 domluvil:
//   • nahoře jen INFORMACE, dole jen AKCE (dřív stály vedle sebe a člověk
//     mířil na jedno a trefil druhé),
//   • koš je odsazený co nejdál od nejčastější akce (Dashboard),
//   • archivace se ptá stejně jako mazání — jinak je to omylem jedno kliknutí,
//   • Dashboard z dlaždice vede rovnou do přehledu projektu („šéf se ptá,
//     v jaké fázi to je").
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20517';
const NAME = 'flowmap-e2e-ui-card';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 20517:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
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
    // šířka pod 1850 px = běžný notebook, kde je tlačítko Dashboard v liště mapy
    // schované v ⋮ menu — právě proto musí vést cesta i z dlaždice
    await page.setViewport({ width: 1280, height: 900 });

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

    await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { 'Content-Type': 'application/json', Authorization: auth.token };
      await fetch('/api/collections/goalmaps/records', {
        method: 'POST', headers: H,
        body: JSON.stringify({
          title: 'PROJEKT-KARTA',
          nodes: [
            { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'PROJEKT-KARTA', title: 'PROJEKT-KARTA', status: 'todo' } },
            { id: 'n1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Krok', status: 'todo', owner: 'admin@e2e.cz' } },
          ],
          edges: [{ id: 'e1', source: 'apex', target: 'n1' }],
        }),
      });
      // druhý projekt: název je zkratka, hlavní cíl je věta — přesně případ,
      // kvůli kterému se hlavní cíl na kartu přidával (18. 8. 2026)
      await fetch('/api/collections/goalmaps/records', {
        method: 'POST', headers: H,
        body: JSON.stringify({
          title: 'FMEA — kanban',
          nodes: [
            { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Snížit počet reklamací z výroby na polovinu', title: 'Snížit počet reklamací z výroby', status: 'todo' } },
            { id: 'n1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Sběr dat', status: 'todo' } },
          ],
          edges: [{ id: 'e1', source: 'apex', target: 'n1' }],
        }),
      });
    });

    // vrátit se na plnou titulku (na užším okně by naskočil lite režim)
    await page.evaluate(() => localStorage.setItem('flowmap-mode', 'full'));
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2000);

    // pomocník: najdi kartu projektu podle názvu (nejvnitřnější .rounded-xl)
    const cardInfo = () => page.evaluate((title) => {
      const els = [...document.querySelectorAll('div')]
        .filter((e) => (e.innerText || '').includes(title) && e.className.includes('rounded-xl'));
      const card = els[els.length - 1];
      if (!card) return null;
      const btns = [...card.querySelectorAll('button')].map((b) => ({
        label: (b.getAttribute('aria-label') || b.innerText || '').trim(),
        x: b.getBoundingClientRect().x, y: b.getBoundingClientRect().y,
      }));
      const box = card.getBoundingClientRect();
      return { btns, cardTop: box.y, cardBottom: box.y + box.height, cardMid: box.y + box.height / 2 };
    }, 'PROJEKT-KARTA');

    console.log('== pod názvem projektu je vidět hlavní cíl (vrcholový uzel) ==');
    // Richard 18. 8. 2026: „v moje projekty by uživatelé chtěli vidět pod
    // názvem projektu název hlavního uzlu." Karta ho bere z apexText.
    const textKarty = (title) => page.evaluate((tt) => {
      const els = [...document.querySelectorAll('div')]
        .filter((e) => (e.innerText || '').includes(tt) && e.className.includes('rounded-xl'));
      const card = els[els.length - 1];
      return card ? (card.innerText || '') : '';
    }, title);
    const kartaFmea = await textKarty('FMEA — kanban');
    expect(/Snížit počet reklamací z výroby na polovinu/.test(kartaFmea),
      `karta ukazuje hlavní cíl pod názvem („${kartaFmea.split('\n').slice(0, 3).join(' / ')}")`);
    // ⚠️ Pořadí NEporovnávat holým indexOf — chybějící text dá −1, které je
    // menší než cokoliv, a kontrola svítí zeleně i když řádek vůbec není
    // (chyceno mutací 18. 8. 2026). Proto se napřed trvá na tom, že tam je.
    const poradi = (a, b) => {
      const ia = kartaFmea.indexOf(a), ib = kartaFmea.indexOf(b);
      return ia >= 0 && ib >= 0 && ia < ib;
    };
    expect(poradi('FMEA — kanban', 'Snížit počet reklamací'),
      'hlavní cíl je POD názvem projektu, ne nad ním');
    expect(poradi('Snížit počet reklamací', ' cílů'),
      'hlavní cíl stojí nad řádkem s počtem cílů');
    // shoda názvů = řádek se neopakuje (dvakrát totéž pod sebou je šum)
    const kartaStejna = await textKarty('PROJEKT-KARTA');
    expect((kartaStejna.match(/PROJEKT-KARTA/g) || []).length === 1,
      `když se hlavní cíl rovná názvu, řádek se NEZDVOJUJE (výskytů: ${(kartaStejna.match(/PROJEKT-KARTA/g) || []).length})`);

    console.log('== akce jsou vidět BEZ najetí myší (tablet/telefon hover nemá) ==');
    const visible = await page.evaluate((title) => {
      const els = [...document.querySelectorAll('div')]
        .filter((e) => (e.innerText || '').includes(title) && e.className.includes('rounded-xl'));
      const card = els[els.length - 1];
      const btn = [...card.querySelectorAll('button')].find((b) => /Dashboard/i.test(b.innerText || ''));
      if (!btn) return null;
      const cs = getComputedStyle(btn.parentElement);
      const r = btn.getBoundingClientRect();
      return { opacity: Number(cs.opacity), visibility: cs.visibility, width: r.width, height: r.height };
    }, 'PROJEKT-KARTA');
    expect(visible && visible.opacity === 1 && visible.visibility === 'visible',
      `lišta akcí svítí i bez hoveru (opacity ${visible && visible.opacity})`);
    expect(visible && visible.width > 0 && visible.height > 0, 'tlačítka mají rozměr, nejsou schovaná');

    console.log('== informace nahoře, akce dole ==');
    const info = await cardInfo();
    expect(!!info, 'karta projektu je na titulce');
    const dash = info.btns.find((b) => /Dashboard/i.test(b.label));
    const trash = info.btns.find((b) => /Smazat|Delete/i.test(b.label));
    const arch = info.btns.find((b) => /rchiv/i.test(b.label));
    expect(!!dash && !!trash && !!arch, `karta má Dashboard, Archivovat i Smazat (${info.btns.map((b) => b.label).join(', ')})`);
    expect(dash.y > info.cardMid, 'akce jsou v DOLNÍ polovině karty, ne mezi štítky nahoře');

    console.log('== koš je co nejdál od nejčastější akce ==');
    expect(trash.x > dash.x + 120, `koš je odsazený od Dashboardu (rozestup ${Math.round(trash.x - dash.x)} px)`);
    expect(trash.x > arch.x, 'koš je až za archivací, tedy úplně vpravo');

    console.log('== archivace se ptá (stejně jako mazání) ==');
    let asked = null;
    page.on('dialog', async (d) => { asked = d.message(); await d.dismiss(); });
    await page.evaluate((title) => {
      const els = [...document.querySelectorAll('div')]
        .filter((e) => (e.innerText || '').includes(title) && e.className.includes('rounded-xl'));
      const card = els[els.length - 1];
      [...card.querySelectorAll('button')].find((b) => /rchiv/i.test(b.getAttribute('aria-label') || ''))?.click();
    }, 'PROJEKT-KARTA');
    await sleep(1200);
    expect(!!asked && /archiv/i.test(asked), `archivace se zeptá („${(asked || '').slice(0, 60)}")`);
    await sleep(800);
    const stale = await cardInfo();
    expect(!!stale, 'po odmítnutí dotazu projekt na titulce ZŮSTAL');

    console.log('== Dashboard z dlaždice vede do přehledu projektu ==');
    await page.evaluate((title) => {
      const els = [...document.querySelectorAll('div')]
        .filter((e) => (e.innerText || '').includes(title) && e.className.includes('rounded-xl'));
      const card = els[els.length - 1];
      [...card.querySelectorAll('button')].find((b) => /Dashboard/i.test(b.innerText || ''))?.click();
    }, 'PROJEKT-KARTA');
    await sleep(3000);
    expect(/\/map\/.*view=dashboard/.test(page.url()), `deep-link na dashboard (${page.url().replace(BASE, '')})`);
    const txt = await page.evaluate(() => document.body.innerText);
    expect(txt.includes('Co se změnilo') || txt.includes('Celkové splnění'),
      'otevřel se rovnou přehled projektu, ne plátno mapy');

    const relevant = errors.filter((e) => !e.includes('favicon') && !e.includes('ERR_NETWORK_CHANGED'));
    expect(relevant.length === 0, `konzole bez chyb (${relevant.length}${relevant.length ? ': ' + relevant[0].slice(0, 120) : ''})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
