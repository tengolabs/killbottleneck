// C2 opakující se úkoly + C3 kalendář. Čerstvý kontejner na :20491.
// Ověřuje: dokončení opakujícího se úkolu vytvoří další výskyt s posunutým termínem
// (denně/týdně/měsíčně), podúkoly se neopakují, a v UI je záložka Kalendář s termíny.
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
    execSync(`docker run -d --name ${NAME} -p 20491:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: 'a@x.cz', password: PW, passwordConfirm: PW } });
    const T = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@x.cz', password: PW } })).json.token;

    console.log('== recurrence field ==');
    // úkol vždy patří do projektu (server volné úkoly odmítá) → společná mapa
    const recMap = (await api('POST', '/api/collections/goalmaps/records', { token: T, body: { title: 'Rekurence mapa', nodes: [
      { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Rekurence mapa', title: 'Rekurence mapa', status: 'todo' } },
      // úkol musí mít konkrétní uzel (13. 8.) — rekurence z něj dědí
      { id: 'n1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Opakovaná práce', status: 'todo' } },
    ], edges: [{ id: 'e1', source: 'apex', target: 'n1' }] } })).json;
    const mk = (extra) => api('POST', '/api/collections/tasks/records', { token: T, body: { title: 'Opakuj', status: 'todo', map: recMap.id, node_id: 'n1', ...extra } });
    const listByTitle = async (title) => (await api('GET', `/api/collections/tasks/records?perPage=200&filter=${encodeURIComponent(`title="${title}"`)}`, { token: T })).json.items;

    // posun jde od max(termín, dnes) — dynamická data, ať test nezastará
    const addDaysUTC = (days) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

    // týdně, s termínem v budoucnu → posun od termínu
    const wkDl = addDaysUTC(3);
    const wk = (await mk({ title: 'Týdenní', deadline: wkDl, recurrence: 'weekly' })).json;
    expect(wk.recurrence === 'weekly', `pole recurrence uloženo (${wk.recurrence})`);
    let all = await listByTitle('Týdenní');
    expect(all.length === 1, `před dokončením 1 výskyt (${all.length})`);
    await api('PATCH', `/api/collections/tasks/records/${wk.id}`, { token: T, body: { status: 'done' } });
    await sleep(300);
    all = await listByTitle('Týdenní');
    const next = all.find((t) => t.status === 'todo');
    expect(all.length === 2 && !!next, `po dokončení vznikl další výskyt (${all.length})`);
    expect(next && next.deadline === addDaysUTC(10), `týdně posunulo termín +7 dní od budoucího termínu (${next && next.deadline})`);
    expect(next && next.recurrence === 'weekly', 'nový výskyt nese recurrence dál');

    // PROŠLÝ termín → posun ode dneška, ne od termínu (max(termín, dnes))
    const od = (await mk({ title: 'Prošlý denní', deadline: '2026-01-01', recurrence: 'daily' })).json;
    await api('PATCH', `/api/collections/tasks/records/${od.id}`, { token: T, body: { status: 'done' } });
    await sleep(300);
    const odNext = (await listByTitle('Prošlý denní')).find((t) => t.status === 'todo');
    expect(odNext && odNext.deadline === addDaysUTC(1), `prošlý denní → zítra, ne 2.1. (${odNext && odNext.deadline})`);

    // denně bez termínu → od dneška +1
    const dl = (await mk({ title: 'Denní', recurrence: 'daily' })).json;
    await api('PATCH', `/api/collections/tasks/records/${dl.id}`, { token: T, body: { status: 'done' } });
    await sleep(300);
    const dNext = (await listByTitle('Denní')).find((t) => t.status === 'todo');
    const tomorrow = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
    expect(dNext && dNext.deadline === tomorrow, `denně bez termínu → zítra (${dNext && dNext.deadline} vs ${tomorrow})`);

    // měsíčně — budoucí 31.1. → clamp na konec února (ne přetečení do března)
    const Y = new Date().getUTCFullYear() + 1;
    const febLast = new Date(Date.UTC(Y, 2, 0)).getUTCDate(); // 28/29 dle přestupnosti
    const mo = (await mk({ title: 'Měsíční', deadline: `${Y}-01-31`, recurrence: 'monthly' })).json;
    await api('PATCH', `/api/collections/tasks/records/${mo.id}`, { token: T, body: { status: 'done' } });
    await sleep(300);
    const moNext = (await listByTitle('Měsíční')).find((t) => t.status === 'todo');
    expect(moNext && moNext.deadline === `${Y}-02-${febLast}`, `měsíčně 31.1.→konec února (clamp, ne přetečení) (${moNext && moNext.deadline} vs ${Y}-02-${febLast})`);

    // neopakující se úkol další výskyt NEVytvoří
    const once = (await mk({ title: 'Jednorázový', deadline: '2026-07-20' })).json;
    await api('PATCH', `/api/collections/tasks/records/${once.id}`, { token: T, body: { status: 'done' } });
    await sleep(300);
    expect((await listByTitle('Jednorázový')).length === 1, 'neopakující se úkol nevytvoří další');

    // opakované uložení hotového nedubluje
    await api('PATCH', `/api/collections/tasks/records/${wk.id}`, { token: T, body: { description: 'znovu' } });
    await sleep(300);
    expect((await listByTitle('Týdenní')).length === 2, 're-save hotového úkolu nevytvoří další výskyt');

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
