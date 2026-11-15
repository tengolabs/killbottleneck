// UI e2e (headless Chrome) for wave 3B of code analysis 4 — what the person SEES:
//
//  A) F6-01: a rule "on a schedule" saves with what the form shows. The frequency select
//     displays "daily" for a fresh schedule trigger; the saved rule now carries it too (the
//     server refuses a schedule without `freq`, so the rule could not be saved at all).
//  B) F6-03: texts with a number are declined — project cards on the home page ("1 cíl",
//     "2 cíle", "5 cílů" / "1 goal", "3 goals"), the kanban wizard button and its toast
//     ("2 pravidla" / "1 rule"), the calendar delete confirmation in administration
//     ("1 událost", "2 události" / "1 event"). Czech and English account.
//  C) F6-04: the work timer in two tabs. Tab A measures, tab B starts another timer (the
//     server closes A's entry). Stop in the stale tab A no longer rewrites the end of the
//     closed entry: the entry keeps its end, the person is told, the tab shows what really
//     runs — and coming back to a tab re-reads the timer. (Server side: stopky-dvoji-stop.js.)
const H = require('./_harness');
const { expect, sleep } = H;

const uzel = (id, title, x, y) => ({ id, type: 'goalNode', position: { x, y }, data: { title, status: 'todo' } });
const telo = (title, n) => {
  const nodes = [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: title, title, status: 'todo' } }];
  const edges = [];
  for (let i = 1; i < n; i++) { nodes.push(uzel(`k${i}`, `Krok ${i}`, (i - 1) * 300 - 300, 380)); edges.push({ id: `e${i}`, source: 'root', target: `k${i}` }); }
  return { title, nodes, edges };
};

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-chyby4-ruzne', env: { KB_UVODNI_MAPA: 0 } });
  const ST = await inst.superuser();
  const ucet = async (email, extra) => {
    const r = await inst.register(email, extra || {});
    if (r.status !== 200) throw new Error(`registrace ${email}: ${r.status}`);
    return { id: r.json.id, email, token: await inst.login(email) };
  };
  const mapa = async (kdo, title, n) => (await inst.api('POST', '/api/collections/goalmaps/records', { token: kdo.token, body: Object.assign(telo(title, n), { owner: kdo.id, owner_email: kdo.email }) })).json;
  const cs = await ucet('cs@ruzne.cz');                       // first account = administrator
  const en = await ucet('en@ruzne.cz', { language: 'en' });
  await inst.api('PATCH', `/api/collections/users/records/${en.id}`, { token: ST, body: { role: 'admin' } });
  en.token = await inst.login(en.email);
  await mapa(cs, 'PROJEKT-JEDNA', 1);
  await mapa(cs, 'PROJEKT-DVA', 2);
  await mapa(cs, 'PROJEKT-PET', 5);
  const KAN = await mapa(cs, 'KANBAN-CS', 4);                 // root + 3 columns → 2 rules
  await mapa(en, 'PROJECT-ONE', 1);
  const KANEN = await mapa(en, 'KANBAN-EN', 3);               // root + 2 columns → 1 rule
  const kalendar = async (kdo, name, udalosti) => {
    const r = await inst.api('POST', '/api/kb/calendars/save', { token: kdo.token, body: { name, kind: 'shared' } });
    if (r.status !== 200) throw new Error(`kalendář ${name}: ${r.status} ${JSON.stringify(r.json)}`);
    const den = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    for (let i = 0; i < udalosti; i++) {
      const e = await inst.api('POST', '/api/kb/events/save', { token: kdo.token, body: { title: `${name} ${i}`, day: den, time: `1${i}:00`, calendar: name } });
      if (e.status !== 200) throw new Error(`událost ${name}: ${e.status} ${JSON.stringify(e.json)}`);
    }
    return r.json.calendar.id;
  };
  const KAL1 = await kalendar(cs, 'Jedna-udalost', 1);
  const KAL2 = await kalendar(cs, 'Dve-udalosti', 2);
  const KALEN = await kalendar(en, 'One-event', 1);

  const { browser, page, chyby } = await H.browser({ viewport: { width: 1900, height: 950 } });
  const prihlas = async (p, email) => {
    await p.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
    await p.waitForSelector('#email');
    await p.type('#email', email);
    await p.type('#password', H.PW);
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type="submit"]')]);
    await sleep(1500);
  };
  const text = (p) => p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const kartaProjektu = async (p, nazev) => {
    const t = await text(p);
    const i = t.indexOf(nazev);
    return i < 0 ? '' : t.slice(i, i + nazev.length + 40);
  };
  const otevriMapu = async (p, id) => {
    await p.goto(`${inst.base}/map/${id}`, { waitUntil: 'networkidle2' });
    await p.waitForSelector('.react-flow__node', { timeout: 45000 });
    await sleep(1500);
  };
  const toasty = (p) => p.evaluate(() => [...document.querySelectorAll('[data-testid="toast-viewport"]')].map((x) => x.innerText.replace(/\s+/g, ' ')).join(' | '));
  const kanban = async (p, mapId) => {
    await otevriMapu(p, mapId);
    await (await p.$('[data-testid="toolbar-rules"]')).click();
    await p.waitForSelector('[data-testid="rules-kanban"]', { timeout: 10000 });
    await (await p.$('[data-testid="rules-kanban"]')).click();
    await p.waitForSelector('[data-testid="kanban-seed"]', { timeout: 10000 });
    await p.select('[data-testid="kanban-seed"]', 'k1');
    await sleep(600);
    const tlacitko = await p.$eval('[data-testid="kanban-create"]', (b) => b.innerText.trim());
    await (await p.$('[data-testid="kanban-create"]')).click();
    await p.waitForSelector('[data-testid="rule-row"]', { timeout: 10000 }).catch(() => {});
    await sleep(400);
    return { tlacitko, toast: await toasty(p) };
  };
  const potvrzeniKalendare = async (p, id) => {
    await p.goto(`${inst.base}/admin/users?oddil=kalendare`, { waitUntil: 'networkidle2' });
    await p.waitForSelector(`[data-testid="kal-smazat-${id}"]`, { timeout: 20000 });
    await (await p.$(`[data-testid="kal-smazat-${id}"]`)).click(); // first click only asks
    await sleep(400);
    return p.$eval(`[data-testid="kal-smazat-${id}"]`, (b) => b.innerText.trim());
  };

  await prihlas(page, cs.email);

  console.log('== A) F6-01: pravidlo „v naplánovaný čas" se uloží s tím, co formulář ukazuje ==');
  await otevriMapu(page, KAN.id);
  await (await page.$('[data-testid="toolbar-rules"]')).click();
  await page.waitForSelector('[data-testid="rules-new"]', { timeout: 10000 });
  await (await page.$('[data-testid="rules-new"]')).click();
  await page.waitForSelector('[data-testid="rule-builder"]', { timeout: 10000 });
  await page.type('#rule-name', 'Denni hlaseni');
  await page.select('[data-testid="rule-trigger"]', 'schedule');
  await sleep(400);
  const ukazuje = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="rule-trigger"]').parentElement;
    const s = [...box.querySelectorAll('select')][1];
    return s ? s.options[s.selectedIndex].text : '';
  });
  expect(ukazuje === 'denně', `formulář po volbě spouštěče ukazuje četnost „denně" („${ukazuje}")`);
  await (await page.$('[data-testid="rule-save"]')).click();
  await page.waitForSelector('[data-testid="rule-row"]', { timeout: 8000 }).catch(() => {});
  const pravidla = ((await inst.api('GET', `/api/kb/rules?map=${KAN.id}`, { token: cs.token })).json || {}).rules || [];
  const denni = pravidla.find((r) => r.name === 'Denni hlaseni');
  expect(!!denni, `pravidlo se uložilo bez přepínání četnosti tam a zpět (na serveru ${pravidla.length} pravidel)`);
  expect(!!denni && denni.trigger && denni.trigger.type === 'schedule' && denni.trigger.freq === 'daily', `uložený spouštěč nese četnost „daily" (${JSON.stringify(denni && denni.trigger)})`);
  expect(await page.evaluate(() => !document.querySelector('[data-testid="rule-builder"]') && [...document.querySelectorAll('[data-testid="rule-row"]')].some((r) => r.innerText.includes('Denni hlaseni'))), 'formulář se zavřel a pravidlo je v přehledu');
  if (denni) await inst.api('POST', '/api/kb/rules/delete', { token: cs.token, body: { id: denni.id } });

  console.log('== B) F6-03 česky: karty projektů, kanban, kalendář ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('PROJEKT-PET'), { timeout: 20000 }).catch(() => {});
  let k = await kartaProjektu(page, 'PROJEKT-JEDNA');
  expect(/\b1 cíl(?![eů])/.test(k), `karta s jedním uzlem: „1 cíl" („${k}")`);
  k = await kartaProjektu(page, 'PROJEKT-DVA');
  expect(/\b2 cíle/.test(k), `karta se dvěma: „2 cíle" („${k}")`);
  k = await kartaProjektu(page, 'PROJEKT-PET');
  expect(/\b5 cílů/.test(k), `karta s pěti: „5 cílů" („${k}")`);
  let kb = await kanban(page, KAN.id);
  expect(kb.tlacitko === 'Zapnout kanban (2 pravidla)', `tlačítko průvodce: „Zapnout kanban (2 pravidla)" („${kb.tlacitko}")`);
  expect(/Kanban zapnut — vznikla 2 pravidla/.test(kb.toast), `hláška po zapnutí: „vznikla 2 pravidla" („${kb.toast}")`);
  let pk = await potvrzeniKalendare(page, KAL1);
  expect(pk === 'opravdu smazat (1 událost)', `potvrzení smazání kalendáře s jednou událostí („${pk}")`);
  pk = await potvrzeniKalendare(page, KAL2);
  expect(pk === 'opravdu smazat (2 události)', `… se dvěma událostmi („${pk}")`);

  console.log('== B) F6-03 anglicky (účet s jazykem en, čistý profil) ==');
  const ctx = await (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
  const ep = await ctx.newPage();
  await ep.setViewport({ width: 1900, height: 950 });
  ep.on('console', (m) => { if (m.type() === 'error' && !H.cizihoPuvodu(m)) chyby.push(m.text()); });
  await prihlas(ep, en.email);
  await ep.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  await ep.waitForFunction(() => document.body.innerText.includes('PROJECT-ONE'), { timeout: 20000 }).catch(() => {});
  expect(await ep.evaluate(() => document.documentElement.lang === 'en'), 'rozhraní účtu je anglicky');
  k = await kartaProjektu(ep, 'PROJECT-ONE');
  expect(/\b1 goal(?!s)/.test(k), `card with one node: "1 goal" („${k}")`);
  k = await kartaProjektu(ep, 'KANBAN-EN');
  expect(/\b3 goals/.test(k), `card with three: "3 goals" („${k}")`);
  kb = await kanban(ep, KANEN.id);
  expect(kb.tlacitko === 'Enable kanban (1 rule)', `wizard button: "Enable kanban (1 rule)" („${kb.tlacitko}")`);
  expect(/Kanban enabled — 1 rule created/.test(kb.toast), `toast: "1 rule created" („${kb.toast}")`);
  pk = await potvrzeniKalendare(ep, KALEN);
  expect(pk === 'really delete (1 event)', `calendar delete confirmation („${pk}")`);
  await ctx.close();

  console.log('== C) F6-04: stopky ve dvou kartách ==');
  const casy = async () => ((await inst.api('GET', '/api/collections/time_entries/records?sort=started', { token: cs.token })).json.items || []);
  const hodinky = (p, nazev, title) => p.evaluateHandle((n, t) => {
    const u = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes(n));
    return u ? u.querySelector(`button[title="${t}"]`) : null;
  }, nazev, title);
  const START = 'Spustit měření času na tomto cíli', STOP = 'Zastavit měření času';
  const klik = async (p, nazev, title) => { const h = (await hodinky(p, nazev, title)).asElement(); if (!h) return false; await h.click(); return true; };
  await otevriMapu(page, KAN.id);
  expect(await klik(page, 'Krok 1', START), 'karta A: hodinky na cíli „Krok 1" spuštěny');
  await H.waitFor(async () => (await casy()).length === 1, { timeout: 8000, popis: 'první měření' }).catch(() => {});
  // Tab B is a second WINDOW of the same browser profile (same sign-in, same storage): a
  // background tab of headless Chrome is frozen, so two tabs of one window cannot both be clicked.
  const [B] = await Promise.all([
    new Promise((res) => browser.once('targetcreated', async (t) => res(await t.page()))),
    page.evaluate((u) => { window.open(u, '_blank', 'popup,width=1900,height=950'); }, `${inst.base}/map/${KAN.id}`),
  ]);
  await B.setViewport({ width: 1900, height: 950 });
  B.on('console', (m) => { if (m.type() === 'error' && !H.cizihoPuvodu(m)) chyby.push(m.text()); });
  await otevriMapu(B, KAN.id);
  await sleep(1200);
  expect(await klik(B, 'Krok 2', START), 'karta B: hodinky na cíli „Krok 2" spuštěny');
  await H.waitFor(async () => (await casy()).length === 2, { timeout: 8000, popis: 'druhé měření' }).catch(() => {});
  let z = await casy();
  const prvni = z.find((x) => x.node_id === 'k1') || {}, druhe = z.find((x) => x.node_id === 'k2') || {};
  expect(!!prvni.ended && !druhe.ended, `server první měření zavřel, druhé běží (konec prvního ${prvni.ended})`);
  await sleep(2500); // the stale tab keeps "ticking" — its Stop would move the end by these seconds
  const tika = !!(await hodinky(page, 'Krok 1', STOP)).asElement();
  expect(tika, 'karta A o zavření neví — u „Krok 1" dál nabízí Stop');
  await klik(page, 'Krok 1', STOP);
  await page.waitForFunction((t) => {
    const u = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes('Krok 2'));
    return u && u.querySelector(`button[title="${t}"]`);
  }, { timeout: 8000 }, STOP).catch(() => {});
  z = await casy();
  const prvniPo = z.find((x) => x.id === prvni.id) || {}, druhePo = z.find((x) => x.id === druhe.id) || {};
  expect(prvniPo.ended === prvni.ended && prvniPo.duration_min === prvni.duration_min, `Stop ve staré kartě konec zavřeného měření NEpřepsal (${prvni.ended} → ${prvniPo.ended})`);
  expect(druhePo.ended === '' && z.length === 2, 'druhé měření běží dál, žádný záznam nepřibyl');
  const t1 = await toasty(page);
  expect(/už bylo ukončeno jinde/.test(t1), `karta A řekne, že měření už bylo ukončeno jinde („${t1.slice(0, 90)}")`);
  expect(!!(await hodinky(page, 'Krok 2', STOP)).asElement() && !!(await hodinky(page, 'Krok 1', START)).asElement(), 'karta A teď ukazuje, co opravdu běží: Stop u „Krok 2", Start u „Krok 1"');

  // stop in tab B; tab A learns it when the person comes back to it
  await klik(B, 'Krok 2', STOP);
  await H.waitFor(async () => (await casy()).every((x) => x.ended), { timeout: 8000, popis: 'zastavení druhého měření' }).catch(() => {});
  expect((await casy()).every((x) => x.ended), 'karta B druhé měření zastavila');
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); // headless Chrome does not fire focus on bringToFront
  const srovnano = await page.waitForFunction((t) => !document.querySelector(`.react-flow__node button[title="${t}"]`), { timeout: 8000 }, STOP).then(() => true).catch(() => false);
  expect(srovnano, 'návrat do karty A stav stopek dočte — Stop už nenabízí');
  await B.close();

  const vazne = chyby.filter((c) => !/status of 409|ClientResponseError/.test(c));
  expect(vazne.length === 0, `konzole bez nečekaných chyb (${vazne.slice(0, 2).join(' | ').slice(0, 200)})`);
}, { nazev: 'UI-CHYBY4-RUZNE' });
