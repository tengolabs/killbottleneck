// UI e2e: dialog „API klíče" — blok „Připojení klienta" (adresa instance + hotový
// příkaz claude mcp add) a tlačítka KOPÍROVAT přes záložní cestu execCommand.
// Nález Richarda 25. 8. 2026 na stagingu (http = ne-secure context): tlačítka
// nic nezkopírovala — Radix dialog drží fokusovou past a pomocná textarea
// v <body> byla „venku", fokus se vrátil na tlačítko. Test měří, co by
// execCommand skutečně kopíroval (aktivní prvek + délka výběru), ne jen toast.
// Secure context se vypíná podvržením isSecureContext (127.0.0.1 je jinak secure).
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20562';
const NAME = 'flowmap-e2e-ui-apiklice';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -e KB_UVODNI_MAPA=0 -p 20562:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    // ne-secure context jako na self-hostu přes LAN http → jde se záložní cestou
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(window, 'isSecureContext', { get: () => false });
      window.__copy = [];
      const orig = document.execCommand.bind(document);
      document.execCommand = (cmd) => {
        const ae = document.activeElement;
        window.__copy.push({ cmd, tag: ae && ae.tagName, sel: ae && ae.value !== undefined ? ae.value.slice(ae.selectionStart, ae.selectionEnd) : '' });
        return orig(cmd);
      };
    });
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', 'admin@e2e.cz');
    await page.type('#password', 'testheslo123');
    await page.type('#confirm', 'testheslo123');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1500);
    expect(await page.evaluate(() => window.isSecureContext) === false, 'stránka běží jako ne-secure context (záložní cesta kopírování)');

    console.log('== otevření dialogu API klíče ==');
    await page.click('[data-user-menu]');
    await page.waitForSelector('[role="menuitem"]');
    const klik = await page.evaluate(() => {
      const it = [...document.querySelectorAll('[role="menuitem"]')].find((e) => /API klíče|API keys/.test(e.textContent));
      if (it) it.click();
      return !!it;
    });
    expect(klik, 'položka menu „API klíče" existuje');
    await page.waitForSelector('[data-testid="api-keys-connect"]', { timeout: 5000 });
    const url = await page.$eval('[data-testid="api-keys-url"]', (e) => e.textContent);
    expect(url === BASE, `adresa instance = origin (${url})`);
    const cmd = await page.$eval('[data-testid="api-keys-mcp-cmd"]', (e) => e.textContent);
    expect(cmd.startsWith('claude mcp add killbottleneck') && cmd.includes(`KB_URL=${BASE}`) && cmd.includes('npx -y killbottleneck-mcp'),
      'příkaz claude mcp add nese adresu i balíček');
    expect(cmd.includes('kb_user_…'), 'bez čerstvého klíče je v příkazu zástupný kb_user_…');

    console.log('== kopírování přes záložní cestu ==');
    const btns = await page.$$('[data-testid="api-keys-connect"] button');
    await btns[0].click(); await sleep(300);
    let z = await page.evaluate(() => window.__copy);
    expect(z.length === 1 && z[0].tag === 'TEXTAREA', `execCommand běží s fokusem v pomocné textarea (${(z[0] || {}).tag})`);
    expect(z.length === 1 && z[0].sel === url, 'označený = celá adresa (dřív fokus vrácen na tlačítko, výběr prázdný)');
    await btns[1].click(); await sleep(300);
    z = await page.evaluate(() => window.__copy);
    expect(z.length === 2 && z[1].sel === cmd, 'druhé tlačítko kopíruje celý příkaz');

    console.log('== nový klíč → příkaz nese token ==');
    await page.type('#key-label', 'klik');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid="api-keys-mcp-cmd"]')?.textContent.includes('KB_API_KEY=kb_user_') && !document.querySelector('[data-testid="api-keys-mcp-cmd"]').textContent.includes('kb_user_…'), { timeout: 8000 });
    const cmd2 = await page.$eval('[data-testid="api-keys-mcp-cmd"]', (e) => e.textContent);
    expect(/KB_API_KEY=kb_user_[A-Za-z0-9]{20,}/.test(cmd2), 'po vytvoření klíče je v příkazu skutečný token');
    const btns2 = await page.$$('[data-testid="api-keys-connect"] button');
    await btns2[1].click(); await sleep(300);
    z = await page.evaluate(() => window.__copy);
    expect(z[z.length - 1].sel === cmd2, 'zkopírovaný příkaz obsahuje token');
  } catch (e) {
    fail++; console.log('  ❌ výjimka', e.message);
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} ui-api-klice: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
