// UI e2e: zvoneček a stránka /notifications.
// Hlídá tři konkrétní věci, které se dřív rozbíjely tiše:
//  1) čas u notifikace — PocketBase vrací „…Z" S MEZEROU, takže new Date() umí
//     dát Invalid Date; v UI se to projeví jako „NaN" nebo prázdno
//  2) počet nepřečtených — dřív se počítal z načtené dvacítky, takže při 35
//     nepřečtených ukazoval zvoneček špatné číslo
//  4) stránkování — starší notifikace byly dřív nedosažitelné
//  3) „označit vše přečtené" — dřív posílalo N PATCHů jen za načtenou dvacítku
// Slévání dávek (B1) je tu VYPNUTÉ env přepínačem KB_NOTIFY_COALESCE_MIN=0 —
// scénář potřebuje 35 samostatných řádků kvůli stránkování; rozpočet má
// vlastní sadu notify-budget.js. Zároveň se tím ověřuje, že přepínač funguje.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const BASE = 'http://127.0.0.1:20514';
const NAME = 'flowmap-e2e-ui-notifications';
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
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -e KB_NOTIFY_COALESCE_MIN=0 -p 20514:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    // admin (A) nasype příjemci (B) 35 notifikací — víc než se vejde do zvonečku (20)
    // i na jednu stránku (30), takže se otestuje i stránkování
    const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
    await reg('admin@e2e.cz');
    await reg('prijemce@e2e.cz');
    const A = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@e2e.cz', password: PW } })).json.token;
    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Zdroj notifikací',
      nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'C', title: 'C', status: 'todo' } },
        // úkol musí mít konkrétní uzel (13. 8.) — neutrální bez ownera
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Zázemí', status: 'todo' } },
      ],
      edges: [{ id: 'e1', source: 'root', target: 'n1' }],
    } })).json;
    // SLOVNÍK 17. 8. 2026: položky-úkoly už nevznikají — 35 notifikací nasype
    // superuser přímo do kolekce (sada testuje zvoneček/stránkování, ne zdroj)
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST0 = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    const prijemceId = ((await api('GET', `/api/collections/users/records?filter=${encodeURIComponent("email='prijemce@e2e.cz'")}`, { token: ST0 })).json.items || [])[0].id;
    for (let i = 0; i < 35; i++) {
      await api('POST', '/api/collections/notifications/records', { token: ST0, body: {
        user: prijemceId, type: 'task_assigned', text: `admin@e2e.cz vám přiřadil práci: Úkol ${i + 1}`,
        map: map.id, count: 1, read: false, dedup_key: '',
      } });
    }
    const B = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'prijemce@e2e.cz', password: PW } })).json.token;
    const unreadCount = async () => (await api('GET', `/api/collections/notifications/records?perPage=1&filter=${encodeURIComponent('read=false')}`, { token: B })).json.totalItems;
    expect(await unreadCount() === 35, `příjemce má 35 nepřečtených (${await unreadCount()})`);

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

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', 'prijemce@e2e.cz');
    await page.type('#password', PW);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await sleep(1500);

    console.log('== zvoneček ==');
    const badge = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.querySelector('svg.lucide-bell'));
      return b ? (b.innerText || '').trim() : null;
    });
    expect(badge === '9+', `badge při 35 nepřečtených ukazuje 9+ (${badge})`);

    await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle2' });
    await sleep(1200);

    console.log('== stránka /notifications ==');
    const body = await page.evaluate(() => document.body.innerText);
    expect(/Notifikace|Notifications/.test(body), 'stránka se vykreslila');
    expect(!/Invalid Date|NaN/.test(body), 'žádné Invalid Date ani NaN v časech');
    expect(/35/.test(body), 'hlavička ukazuje 35 nepřečtených');

    const rows = await page.evaluate(() => document.querySelectorAll('button svg.lucide-user-plus').length);
    expect(rows === 30, `první stránka má 30 položek (${rows})`);
    expect(/Strana 1 z 2|Page 1 of 2/.test(body), 'stránkování se objevilo (2 strany)');

    // druhá strana = zbylých 5 → dřív byly starší notifikace nedosažitelné
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Další|Next/.test(x.innerText || ''));
      if (b) b.click();
    });
    await sleep(1200);
    const rows2 = await page.evaluate(() => document.querySelectorAll('button svg.lucide-user-plus').length);
    expect(rows2 === 5, `druhá stránka má zbylých 5 položek (${rows2})`);
    await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle2' });
    await sleep(1200);

    console.log('== nastavení notifikací ==');
    const switches = await page.evaluate(() => document.querySelectorAll('[role="switch"]').length);
    expect(switches >= 12, `panel preferencí nabízí přepínač pro každý typ (${switches})`);
    const emailDisabled = await page.evaluate(() => /SMTP|e-mail|E-mail/.test(document.body.innerText));
    expect(emailDisabled, 'panel vysvětluje, že e-mail zatím není nastavený');

    // vypnout první typ a ověřit, že to přežije reload (uloženo na serveru)
    await page.evaluate(() => {
      const sw = document.querySelectorAll('[role="switch"]');
      if (sw.length) sw[0].click();
    });
    await sleep(1200);
    // Klik-test 27. 7. 2026: přepnutí bylo TICHÉ — člověk nevěděl, jestli se
    // uložilo, a přestával nastavení věřit. Klíč v katalogu byl, ale nikdo
    // ho nevolal; 44 zelených sad to nechytlo, protože nikdo nekontroloval
    // potvrzovací hlášky.
    const savedToast = await page.evaluate(() => document.body.innerText);
    expect(/Nastavení uloženo\.|Settings saved\./.test(savedToast),
      'uložení předvolby dá potvrzení');
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1200);
    const firstOff = await page.evaluate(() => {
      const sw = document.querySelectorAll('[role="switch"]');
      return sw.length ? sw[0].getAttribute('data-state') : null;
    });
    expect(firstOff === 'unchecked', `vypnutá předvolba přežila reload (${firstOff})`);

    console.log('== režim e-mailů (B1): radia jen se zapnutým SMTP ==');
    // bez SMTP sekce být nesmí (nemá co řídit)
    const modeHidden = await page.evaluate(() => !document.querySelector('[data-email-mode]'));
    expect(modeHidden, 'bez SMTP se sekce režimu e-mailů nenabízí');
    // superuser zapne SMTP (jen nastavení, nic se neposílá) → sekce se objeví
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.cz superheslo123`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.cz', password: 'superheslo123' } })).json.token;
    const sm = await api('PATCH', '/api/settings', { token: ST, body: { smtp: { enabled: true, host: '127.0.0.1', port: 2599 } } });
    expect(sm.status === 200, `SMTP zapnuto přes nastavení (${sm.status})`);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1200);
    const radios = await page.evaluate(() => document.querySelectorAll('[data-email-mode] input[type="radio"]').length);
    expect(radios === 3, `sekce nabízí 3 režimy: Hned / Denní souhrn / Nic (${radios})`);
    // přepnout na Denní souhrn → per-typ e-mailové přepínače zmizí (režim je přebíjí)
    const switchesBefore = await page.evaluate(() => document.querySelectorAll('[role="switch"]').length);
    await page.evaluate(() => document.querySelectorAll('[data-email-mode] input[type="radio"]')[1].click());
    await sleep(1200);
    const switchesAfter = await page.evaluate(() => document.querySelectorAll('[role="switch"]').length);
    expect(switchesBefore > switchesAfter && switchesAfter >= 12,
      `v režimu souhrnu zmizel e-mail sloupec přepínačů (${switchesBefore}→${switchesAfter})`);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1200);
    const digestChecked = await page.evaluate(() => {
      const r = document.querySelectorAll('[data-email-mode] input[type="radio"]');
      return r.length === 3 && r[1].checked;
    });
    expect(digestChecked, 'volba „Denní souhrn" přežila reload (uložena na účtu)');

    console.log('== označit vše přečtené ==');
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Označit vše|Mark all/.test(x.innerText || ''));
      if (b) b.click();
    });
    await sleep(1500);
    const left = await unreadCount();
    expect(left === 0, `read-all vynulovalo VŠECH 35, ne jen načtenou stránku (${left})`);

    const realErrors = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
    expect(realErrors.length === 0, `konzole bez chyb (${realErrors.slice(0, 2).join(' | ') || 'čistá'})`);
  } catch (err) {
    fail++;
    console.log('  ❌ výjimka: ' + (err && err.stack ? err.stack : err));
  } finally {
    if (browser) await browser.close();
    try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch { /* už je pryč */ }
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} UI NOTIFICATIONS PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
