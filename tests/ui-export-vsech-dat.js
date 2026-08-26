// UI e2e: „Stáhnout všechna moje data" — položka v menu účtu stáhne JSON přes
// GET /api/kb/export; po vypršení zkušebky je odkaz „Stáhnout data" přímo v pruhu.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20568';
const NAME = 'flowmap-e2e-ui-export';
const VOLUME = 'flowmap-e2e-ui-export-data';
const PW = 'testheslo123';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const start = async (env) => {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  execSync(`docker run -d --name ${NAME} -v ${VOLUME}:/app/pb_data -e KB_UVODNI_MAPA=0 -e KB_PURPOSE_ASK=0 ${env || ''} -p 20568:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* startuje */ } await sleep(1000); }
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; docker volume rm -f ${VOLUME} 2>/dev/null; true`);
    await start('');
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', 'admin@e2e.cz'); await page.type('#password', PW); await page.type('#confirm', PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1500);

    console.log('== Můj účet → Moje data → Stáhnout všechna moje data (v menu pod panáčkem NENÍ) ==');
    const exportResponses = [];
    page.on('response', (res) => { if (res.url().includes('/api/kb/export')) exportResponses.push(res.status()); });
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/flowmap-e2e-ui-export-dl' });
    await page.click('[data-user-menu]');
    await page.waitForSelector('[role="menuitem"]');
    expect(!(await page.$('[data-testid="menu-export-all"]')), 'v menu pod panáčkem položka NENÍ (Richard 26. 8.: dělá se jednou nebo nikdy)');
    await page.evaluate(() => { const it = [...document.querySelectorAll('[role="menuitem"]')].find((e) => /Můj účet|My account/.test(e.textContent)); it && it.click(); });
    await page.waitForSelector('[data-testid="account-export-all"]', { timeout: 8000 });
    const label = await page.$eval('[data-testid="account-export-all"]', (e) => e.textContent.trim());
    expect(/Stáhnout všechna moje data|Download all my data/.test(label), `tlačítko v Můj účet (${label})`);
    expect(!!(await page.$('[data-testid="account-import-all"]')), 'vedle něj „Nahrát data z exportu"');
    await page.click('[data-testid="account-export-all"]');
    for (let i = 0; i < 20 && !exportResponses.length; i++) await sleep(250);
    expect(exportResponses[0] === 200, `klik zavolal GET /api/kb/export → 200 (${exportResponses[0]})`);
    await sleep(1500);
    const errs = await page.evaluate(() => document.body.textContent.includes('nepodařilo') || document.body.textContent.includes('failed'));
    expect(!errs, 'bez chybové hlášky');
    const fs = require('fs');
    let soubory = [];
    for (let i = 0; i < 20; i++) { try { soubory = fs.readdirSync('/tmp/flowmap-e2e-ui-export-dl').filter((f) => /^killbottleneck-export-\d{4}-\d{2}-\d{2}\.json$/.test(f)); } catch { /* ještě ne */ } if (soubory.length) break; await sleep(250); }
    expect(soubory.length === 1, `soubor se skutečně stáhl (${soubory.join(',')})`);
    if (soubory.length) { const j = JSON.parse(fs.readFileSync('/tmp/flowmap-e2e-ui-export-dl/' + soubory[0], 'utf8')); expect(j.format === 'killbottleneck.export/1', 'stažený soubor je platný export'); }

    console.log('== nahrát stažený soubor zpět ==');
    const importResponses = [];
    page.on('response', (res) => { if (res.url().includes('/api/kb/import-all')) importResponses.push(res.status()); });
    const input = await page.$('[data-testid="account-import-file"]');
    await input.uploadFile('/tmp/flowmap-e2e-ui-export-dl/' + soubory[0]);
    for (let i = 0; i < 40 && !importResponses.length; i++) await sleep(250);
    expect(importResponses[0] === 200, `nahrání zavolalo POST /api/kb/import-all → 200 (${importResponses[0]})`);
    await sleep(1000);
    const toastText = await page.evaluate(() => document.body.textContent);
    expect(/Nahráno: \d+ projekt|Uploaded: \d+ project/.test(toastText), 'hláška „Nahráno: N projektů"');

    console.log('== po vypršení zkušebky je v pruhu „Stáhnout data" ==');
    await browser.close(); browser = null;
    await start('-e KB_TRIAL_UNTIL=2020-01-01');
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const p2 = await browser.newPage();
    await p2.setViewport({ width: 1280, height: 900 });
    await p2.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await p2.waitForSelector('#email');
    await p2.type('#email', 'admin@e2e.cz'); await p2.type('#password', PW);
    await Promise.all([p2.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p2.click('button[type="submit"]')]);
    await sleep(2000);
    await p2.waitForSelector('[data-testid="trial-export"]', { timeout: 8000 }).catch(() => {});
    const btn = await p2.$('[data-testid="trial-export"]');
    expect(!!btn, 'pruh vypršelé zkušebky nese odkaz „Stáhnout data"');
    const resp2 = [];
    p2.on('response', (res) => { if (res.url().includes('/api/kb/export')) resp2.push(res.status()); });
    if (btn) { await btn.click(); for (let i = 0; i < 20 && !resp2.length; i++) await sleep(250); }
    expect(resp2[0] === 200, `export po vypršení z pruhu → 200 (${resp2[0]})`);
  } catch (e) {
    fail++; console.log('  ❌ výjimka', e.message);
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; docker volume rm -f ${VOLUME} 2>/dev/null; rm -rf /tmp/flowmap-e2e-ui-export-dl; true`);
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} ui-export-vsech-dat: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
