// Uložení dashboardu projektu do PDF — „stav projektu, který můžu poslat".
//
// Hlídá to, co se u exportu přes DOM→obrázek nejsnáz rozbije a na obrazovce
// to není vidět:
//   • soubor se opravdu stáhne a je to platné PDF,
//   • velikost je poslatelná (v PNG vycházelo přes 20 MB → nedá se poslat),
//   • v PDF je NÁZEV PROJEKTU (na obrazovce ho nese lišta editoru, v souboru
//     by chyběl a příjemce by nevěděl, čeho se týká),
//   • ovládací prvky (tlačítko Uložit PDF, přepínač rozsahu) v exportu NEJSOU,
//   • tmavý režim se po snímku vrátí (PDF musí být světlé i pro noční ptáky).
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const fs = require('fs');
const BASE = 'http://127.0.0.1:20518';
const NAME = 'flowmap-e2e-dash-pdf';
const DL = require('os').tmpdir() + '/flowmap-dl-dash-pdf';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p 20518:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
    fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });

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
    await page.setViewport({ width: 1400, height: 900 });
    const cdp = await page.createCDPSession();
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

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

    const mapId = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { 'Content-Type': 'application/json', Authorization: auth.token };
      const N = (id, d, x) => ({ id, type: id === 'apex' ? 'apexNode' : 'goalNode', position: { x, y: 300 }, data: d });
      const nodes = [N('apex', { nodeType: 'apex', apexText: 'PROJEKT-PDF', title: 'PROJEKT-PDF', status: 'todo' }, 0)];
      const edges = [];
      for (let i = 0; i < 6; i++) {
        nodes.push(N('n' + i, { title: 'Krok ' + i, status: i % 2 ? 'done' : 'todo', owner: 'admin@e2e.cz', deadline: '2026-08-0' + (i + 1) }, i * 150));
        edges.push({ id: 'e' + i, source: 'apex', target: 'n' + i });
      }
      const m = await (await fetch('/api/collections/goalmaps/records', {
        method: 'POST', headers: H, body: JSON.stringify({ title: 'PROJEKT-PDF', nodes, edges }),
      })).json();
      // pohyb, ať má sekce „Co se změnilo" co ukázat
      const moved = JSON.parse(JSON.stringify(nodes));
      moved[1].data.status = 'done';
      await fetch('/api/collections/goalmaps/records/' + m.id, { method: 'PATCH', headers: H, body: JSON.stringify({ nodes: moved, edges }) });
      return m.id;
    });

    // tmavý režim schválně zapnout — PDF musí být i tak světlé a režim se musí vrátit
    await page.evaluate(() => localStorage.setItem('kb-theme', 'dark'));
    await page.goto(`${BASE}/map/${mapId}?view=dashboard`, { waitUntil: 'networkidle2' });
    await sleep(3000);
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark')),
      'test běží v tmavém režimu');

    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Uložit PDF/.test(x.innerText || ''));
      if (b) { b.click(); return true; }
      return false;
    });
    expect(clicked, 'tlačítko Uložit PDF je v dashboardu');
    await sleep(10000);

    const files = fs.readdirSync(DL).filter((f) => f.endsWith('.pdf'));
    expect(files.length === 1, `stáhlo se právě jedno PDF (${files.join(', ')})`);
    expect(files[0] && files[0].includes('PROJEKT-PDF'), `název souboru nese projekt (${files[0]})`);
    const size = files[0] ? fs.statSync(`${DL}/${files[0]}`).size : 0;
    expect(size > 20 * 1024, `PDF není prázdné (${Math.round(size / 1024)} kB)`);
    // v PNG vycházel tenhle export přes 20 MB — takový soubor se nedá poslat
    expect(size < 3 * 1024 * 1024, `PDF je poslatelné, ne mnohaMB (${Math.round(size / 1024)} kB)`);
    const head = files[0] ? fs.readFileSync(`${DL}/${files[0]}`).subarray(0, 5).toString('latin1') : '';
    expect(head === '%PDF-', `je to platné PDF (hlavička "${head}")`);

    expect(await page.evaluate(() => document.documentElement.classList.contains('dark')),
      'tmavý režim se po exportu VRÁTIL (snímek ho jen dočasně vypnul)');

    // ovládací prvky nesmí zůstat součástí exportované oblasti
    const ignored = await page.evaluate(() => {
      const marked = [...document.querySelectorAll('.export-ignore')];
      return {
        count: marked.length,
        hasPdfButton: marked.some((e) => /Uložit PDF/.test(e.innerText || '')),
        hasRange: marked.some((e) => /7 dní/.test(e.innerText || '')),
      };
    });
    expect(ignored.hasPdfButton, 'tlačítko Uložit PDF je označené jako „do exportu nepatří"');
    expect(ignored.hasRange, 'přepínač rozsahu je označený jako „do exportu nepatří"');

    const relevant = errors.filter((e) => !e.includes('favicon') && !e.includes('ERR_NETWORK_CHANGED'));
    expect(relevant.length === 0, `konzole bez chyb (${relevant.length}${relevant.length ? ': ' + relevant[0].slice(0, 120) : ''})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
