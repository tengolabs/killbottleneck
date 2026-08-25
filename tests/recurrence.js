// Opakování položek ZRUŠENO (slovník 17. 8. 2026) + C3 kalendář. Kontejner :20491.
// Ověřuje: dokončení zbytkové opakující se položky už NEZAKLÁDÁ další výskyt
// (opakování na uzlech = budoucí samostatné téma), a v UI zůstává záložka Kalendář.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20491';
const NAME = 'flowmap-e2e-recur';
const PW = 'testheslo123';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p 20491:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: 'a@x.cz', password: PW, passwordConfirm: PW } });
    const T = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@x.cz', password: PW } })).json.token;

    console.log('== opakování už neplodí další výskyt ==');
    const recMap = (await api('POST', '/api/collections/goalmaps/records', { token: T, body: { title: 'Rekurence mapa', nodes: [
      { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Rekurence mapa', title: 'Rekurence mapa', status: 'todo' } },
      { id: 'n1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Opakovaná práce', status: 'todo' } },
    ], edges: [{ id: 'e1', source: 'apex', target: 'n1' }] } })).json;
    const listByTitle = async (title) => (await api('GET', `/api/collections/tasks/records?perPage=200&filter=${encodeURIComponent(`title="${title}"`)}`, { token: T })).json.items;

    // založit položku uživatelem NEJDE (create hook 403) — zbytky sází superuser
    let r0 = await api('POST', '/api/collections/tasks/records', { token: T, body: { title: 'Opakuj', status: 'todo', map: recMap.id, node_id: 'n1', recurrence: 'weekly' } });
    expect(r0.status === 400 || r0.status === 403, `založení opakující se položky uživatelem neprojde (${r0.status})`);
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    const meId = ((await api('GET', `/api/collections/users/records?filter=${encodeURIComponent("email='a@x.cz'")}`, { token: ST })).json.items || [])[0].id;
    const addDaysUTC = (days) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
    const wk = (await api('POST', '/api/collections/tasks/records', { token: ST, body: { title: 'Týdenní', status: 'todo', map: recMap.id, node_id: 'n1', deadline: addDaysUTC(3), recurrence: 'weekly', owner: meId, owner_email: 'a@x.cz' } })).json;
    expect(wk.recurrence === 'weekly', `zbytková položka s recurrence založena superuserem (${wk.recurrence})`);
    let all = await listByTitle('Týdenní');
    expect(all.length === 1, `před dokončením 1 výskyt (${all.length})`);
    // dokončení UŽ NEZAKLÁDÁ další výskyt — opakování zaniklo s položkami
    const ru = await api('PATCH', `/api/collections/tasks/records/${wk.id}`, { token: T, body: { status: 'done' } });
    expect(ru.status === 200, `zbytek jde odbavit (${ru.status})`);
    await sleep(500);
    all = await listByTitle('Týdenní');
    expect(all.length === 1, `po dokončení NEVZNIKL další výskyt (${all.length})`);

    console.log('== kalendář v UI ==');
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    // přihlásit v prohlížeči přes localStorage token
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await page.type('#email', 'a@x.cz');
    await page.type('input[type="password"]', PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1500);
    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
    await sleep(1200);
    // reálný klik na tab (Radix TabsTrigger nereaguje na el.click() v evaluate)
    let calTab = null;
    for (const b of await page.$$('button')) {
      const txt = await b.evaluate((el) => el.textContent);
      if (/Kalendář/.test(txt)) { calTab = b; break; }
    }
    expect(!!calTab, 'záložka Kalendář je na /tasks');
    if (calTab) await calTab.click();
    await sleep(1200);
    const body = await page.evaluate(() => document.body.innerText);
    expect(/Po.*Út.*St.*Čt.*Pá.*So.*Ne/s.test(body), 'kalendář ukazuje mřížku dnů v týdnu');
    expect(/Dnes/.test(body), 'kalendář má tlačítko Dnes');
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', e.message.slice(0, 160));
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
