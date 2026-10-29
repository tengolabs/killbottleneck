// UI e2e: STYL PROCES (Richard 21. 10. 2026, maketa 8099/kb-proces schválena
// 25. 10.). Prochází v prohlížeči to, co si Richard proklikal v prototypu:
// založení procesu dlaždicí → štítek a vrchol bez % → „Přidat krok" s rytmem
// → podkrok → odškrtnutí (hláška „prošlo", návrat s dalším termínem, obnovený
// podkrok) → Přehled se Zdravím běhu → přepnutí na projekt a zpět (menu ⋮ +
// potvrzení) → karta Procesy v Organizaci, štítek na kartě projektu →
// změna z asistenta se projeví bez znovunačtení → čtenář vidí rytmus slovy →
// telefon bez vodorovného posunu.
const H = require('./_harness');
const { expect, sleep } = H;

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-proces', env: { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0 } });
  await inst.register('admin@e2e.cz');
  await inst.register('ctenar@e2e.cz');
  const TA = await inst.login('admin@e2e.cz');
  const TR = await inst.login('ctenar@e2e.cz');
  const tok = (x) => x.token || x;
  const mapaApi = async (id, t = TA) => (await inst.api('GET', `/api/collections/goalmaps/records/${id}`, { token: tok(t) })).json;
  const pravidla = async (id) => ((await inst.api('GET', `/api/kb/rules?map=${id}`, { token: tok(TA) })).json || {}).rules || [];

  const { page, chyby, novaStranka } = await H.browser();
  const login = async (p, email) => {
    await p.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
    await p.waitForSelector('#email');
    await p.type('#email', email);
    await p.type('#password', H.PW);
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type="submit"]')]);
    await sleep(1200);
  };
  const klikText = (p, sel, re) => p.evaluate((s, src) => {
    const r = new RegExp(src);
    const el = [...document.querySelectorAll(s)].find((x) => r.test((x.innerText || '').trim()));
    if (!el) return false;
    el.click();
    return true;
  }, sel, re.source);
  const karta = (p, nazev) => p.evaluate((n) => {
    const k = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.querySelector('[data-nazev-uzlu]') || {}).innerText === n);
    return k ? k.innerText.replace(/\s+/g, ' ') : '';
  }, nazev);
  const klikStav = (p, nazev) => p.evaluate((n) => {
    const k = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.querySelector('[data-nazev-uzlu]') || {}).innerText === n);
    const b = k && [...k.querySelectorAll('button')].find((x) => /Založeno|Probíhá|Hotovo/.test(x.innerText));
    if (!b) return false;
    b.click();
    return true;
  }, nazev);
  await login(page, 'admin@e2e.cz');

  console.log('== Nový projekt: dlaždice Proces ==');
  expect(await klikText(page, 'button', /^Nový projekt$/), 'tlačítko Nový projekt');
  await page.waitForSelector('[data-testid="create-kind-process"]', { timeout: 10000 });
  let dialog = await page.$eval('[role="dialog"]', (d) => d.innerText);
  expect(/Chci něco dokončit/.test(dialog) && /Chci, aby něco běželo/.test(dialog), 'dialog nabízí Projekt i Proces');
  await page.click('[data-testid="create-kind-process"]');
  await sleep(300);
  dialog = await page.$eval('[role="dialog"]', (d) => d.innerText);
  expect(/Co má běžet/.test(dialog) && /Založit proces/.test(dialog), 'po volbě Procesu: „Co má běžet" a „Založit proces"');
  await page.type('#project-name', 'Úklid kanceláře');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), klikText(page, '[role="dialog"] button', /^Založit proces$/)]);
  await sleep(2500);
  const mapId = (page.url().match(/\/map\/([a-z0-9]+)/) || [])[1];
  expect(!!mapId && (await mapaApi(mapId)).kind === 'process', `vznikl proces (${mapId})`);
  expect(await page.$eval('[data-testid="map-style-chip"]', (e) => e.dataset.kind).catch(() => '') === 'process', 'u názvu štítek 🔁 Proces');
  let vrchol = await page.$eval('[data-testid="apex-process-health"]', (e) => e.innerText).catch(() => '');
  expect(/popis procesu/.test(vrchol), `vrchol bez % — „popis procesu · zatím bez opakovaných kroků" (${vrchol})`);
  expect(!(await page.evaluate(() => /Celkový pokrok/.test(document.body.innerText))), 'na vrcholu není Celkový pokrok');

  console.log('== Přidat krok s rytmem ==');
  expect(await klikText(page, 'button', /^Přidat krok$/), 'tlačítko Přidat krok v liště');
  await page.waitForSelector('[data-testid="add-step-dialog"]', { timeout: 8000 });
  await page.type('[data-testid="add-step-title"]', 'Vynést koše');
  await page.click('[data-testid="add-step-dialog"] [data-testid="recurrence-freq-weekly"]');
  await sleep(200);
  // přidat úterý i čtvrtek (dnešní den v týdnu je zapnutý od začátku) — dva dny = text „každý týden: …"
  for (const d of [2, 4]) {
    const on = await page.$eval(`[data-testid="add-step-dialog"] [data-testid="recurrence-day-${d}"]`, (e) => e.getAttribute('aria-pressed'));
    if (on !== 'true') await page.click(`[data-testid="add-step-dialog"] [data-testid="recurrence-day-${d}"]`);
  }
  const hint = await page.$eval('[data-testid="add-step-hint"]', (e) => e.innerText);
  expect(/První termín/.test(hint), `dialog řekne první termín (${hint})`);
  await page.click('[data-testid="add-step-confirm"]');
  let rr = [];
  for (let i = 0; i < 20 && !rr.length; i++) { await sleep(500); rr = await pravidla(mapId); }
  const pr = rr[0];
  const dl = pr && pr.actions.find((a) => a.type === 'set_deadline');
  expect(!!pr && dl.advance === 'weekly' && dl.days.includes(2) && dl.days.includes(4) && pr.actions.some((a) => a.type === 'reset_subtree'), `pravidlo opakování vzniklo i s obnovou podkroků (${JSON.stringify(pr && pr.actions)})`);
  const krok = (await mapaApi(mapId)).nodes.find((n) => n.data.title === 'Vynést koše');
  expect(!!krok && /^\d{4}-\d{2}-\d{2}$/.test(krok.data.deadline || ''), `krok má první termín (${krok && krok.data.deadline})`);
  expect(!!krok && krok.data.owner === 'admin@e2e.cz', `nový krok má řešitele „mě“ jako v prototypu (${krok && krok.data.owner})`);
  await sleep(800);
  let k = await karta(page, 'Vynést koše');
  expect(/každý týden:/.test(k) && /Út/.test(k) && /Čt/.test(k), `karta ukazuje rytmus slovy (${k})`);

  console.log('== podkrok a odškrtnutí opakovaného kroku ==');
  await page.evaluate(() => {
    const k2 = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.querySelector('[data-nazev-uzlu]') || {}).innerText === 'Vynést koše');
    const b = [...k2.querySelectorAll('button')].find((x) => /Přidat podkrok/.test(x.innerText));
    b.click();
  });
  await sleep(1200);
  expect(/Nový podkrok/.test(await page.evaluate(() => document.body.innerText)), '„Přidat podkrok" přidá podkrok rovnou (bez dialogu)');
  expect(!/krok procesu · bez rytmu/.test(await karta(page, 'Nový podkrok')), 'podkrok nemá štítek „krok procesu"');
  await klikStav(page, 'Nový podkrok'); await sleep(300); await klikStav(page, 'Nový podkrok');
  await sleep(2500); // autosave
  await klikStav(page, 'Vynést koše'); await sleep(300); await klikStav(page, 'Vynést koše');
  await sleep(700);
  const toast = await page.evaluate(() => document.body.innerText);
  expect(/„Vynést koše“ prošlo/.test(toast) && /Další termín/.test(toast) && /1 podkrok obnoven/.test(toast), 'hláška: prošlo, další termín, 1 podkrok obnoven');
  let zpet = false;
  for (let i = 0; i < 24 && !zpet; i++) { await sleep(500); zpet = /Založeno/.test(await karta(page, 'Vynést koše')) && /Založeno/.test(await karta(page, 'Nový podkrok')); }
  expect(zpet, `krok i podkrok jsou na plátně zpět na Založeno (${await karta(page, 'Vynést koše')} | ${await karta(page, 'Nový podkrok')})`);
  const krok2 = (await mapaApi(mapId)).nodes.find((n) => n.data.title === 'Vynést koše');
  expect(krok2.data.deadline > krok.data.deadline, `termín se posunul (${krok.data.deadline} → ${krok2.data.deadline})`);
  vrchol = '';
  for (let i = 0; i < 10 && !/naposledy prošlo dnes/.test(vrchol); i++) { await sleep(600); vrchol = await page.$eval('[data-testid="apex-process-health"]', (e) => e.innerText).catch(() => ''); }
  expect(/1 včas/.test(vrchol) && /naposledy prošlo dnes/.test(vrchol), `vrchol: 1 včas · naposledy prošlo dnes (${vrchol.replace(/\s+/g, ' ')})`);

  console.log('== Přehled: Zdraví běhu místo Celkového pokroku ==');
  await page.goto(`${inst.base}/map/${mapId}?view=dashboard`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="process-health-card"]', { timeout: 15000 }).catch(() => {});
  const runs = await page.$eval('[data-testid="health-runs"]', (e) => e.innerText).catch(() => '');
  expect(/Průchodů\s*1/.test(runs), `Zdraví běhu: 1 průchod za 30 dní (${runs.replace(/\s+/g, ' ')})`);
  expect(!(await page.evaluate(() => /Celkový pokrok/.test(document.body.innerText))), 'Celkový pokrok v Přehledu procesu není');

  console.log('== přepnutí stylu v menu ⋮ (oběma směry) ==');
  await page.goto(`${inst.base}/map/${mapId}`, { waitUntil: 'networkidle2' });
  await sleep(2000);
  await page.click('button[title="Další akce"]');
  await sleep(500);
  expect(await klikText(page, '[role="menuitem"]', /Změnit na projekt/), 'v menu je „Změnit na projekt"');
  await page.waitForSelector('[data-testid="process-style-dialog"]', { timeout: 5000 });
  const potvrzeni = await page.$eval('[data-testid="process-style-dialog"]', (e) => e.innerText);
  expect(/Vrátí se „% hotovo“/.test(potvrzeni) && /Zpátky to jde kdykoliv/.test(potvrzeni), 'potvrzení vysvětlí, co se změní');
  await page.click('[data-testid="process-style-confirm"]');
  await sleep(1500);
  expect((await mapaApi(mapId)).kind === '' && (await page.$eval('[data-testid="map-style-chip"]', (e) => e.dataset.kind)) === 'project', 'mapa je projekt, štítek 🎯 Projekt');
  await page.click('button[title="Další akce"]');
  await sleep(500);
  await klikText(page, '[role="menuitem"]', /Změnit na proces/);
  await page.waitForSelector('[data-testid="process-style-confirm"]', { timeout: 5000 });
  await page.click('[data-testid="process-style-confirm"]');
  await sleep(1500);
  expect((await mapaApi(mapId)).kind === 'process', 'a zpátky na proces');

  console.log('== změna z asistenta (mimo editor) se na otevřeném plátně projeví ==');
  // asistent po provedené kartě pošle kb-map-changed s mapIds — editor si přenačte pravidla i styl
  // (klik-test 25. 10. 2026: krok s rytmem od asistenta zůstal „jednorázově“, styl by zůstal starý)
  const sRytmem = new Set((await pravidla(mapId)).map((r) => r.node_id));
  const mAs = await mapaApi(mapId);
  const volny = mAs.nodes.find((n) => n.type === 'goalNode' && !sRytmem.has(n.id) && mAs.edges.some((e) => e.source === 'root' && e.target === n.id))
    || mAs.nodes.find((n) => n.type === 'goalNode' && !sRytmem.has(n.id));
  expect(!!volny, `krok bez rytmu pro zásah asistenta (${volny && volny.data.title})`);
  await inst.api('POST', '/api/kb/rules/save', { token: tok(TA), body: { map: mapId, name: 'Opakování (týdně): asistent', node_id: volny.id,
    trigger: { type: 'node_status_changed', status: 'done' }, conditions: [], actions: [{ type: 'set_status', status: 'todo' }, { type: 'set_deadline', advance: 'weekly', days: [2] }, { type: 'reset_subtree' }] } });
  await inst.api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token: tok(TA), body: { kind: '' } });
  await sleep(800);
  expect(!/každé úterý/.test(await karta(page, volny.data.title)), 'bez ohlášení plátno o změně neví (výchozí stav)');
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent('kb-map-changed', { detail: { mapIds: [id] } })), mapId);
  await page.waitForFunction((n) => [...document.querySelectorAll('.react-flow__node')].some((x) => (x.querySelector('[data-nazev-uzlu]') || {}).innerText === n && /každé úterý/.test(x.innerText)), { timeout: 8000 }, volny.data.title).catch(() => {});
  expect(/každé úterý/.test(await karta(page, volny.data.title)), `rytmus od asistenta hned na kartě (${(await karta(page, volny.data.title)).slice(0, 90)})`);
  await page.waitForFunction(() => (document.querySelector('[data-testid="map-style-chip"]') || {}).dataset?.kind === 'project', { timeout: 8000 }).catch(() => {});
  expect((await page.$eval('[data-testid="map-style-chip"]', (e) => e.dataset.kind)) === 'project', 'styl přepnutý asistentem hned u názvu (🎯 Projekt)');
  await inst.api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token: tok(TA), body: { kind: 'process' } });
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent('kb-map-changed', { detail: { mapIds: [id] } })), mapId);
  await page.waitForFunction(() => (document.querySelector('[data-testid="map-style-chip"]') || {}).dataset?.kind === 'process', { timeout: 8000 }).catch(() => {});
  expect((await page.$eval('[data-testid="map-style-chip"]', (e) => e.dataset.kind)) === 'process', 'a zpátky na proces');

  console.log('== Projekty a Organizace ==');
  await inst.api('POST', '/api/kb/share', { token: tok(TA), body: { mapId, action: 'set_team_access', access: 'read' } });
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  await sleep(1500);
  const stitek = await page.$eval('[data-testid="card-process-badge"]', (e) => e.innerText).catch(() => '');
  expect(/Proces/.test(stitek) && /běží včas/.test(stitek), `karta projektu: 🔁 Proces · běží včas (${stitek.replace(/\s+/g, ' ')})`);
  await page.goto(`${inst.base}/organizace`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="organizace-processes"]', { timeout: 15000 }).catch(() => {});
  const proc = await page.$eval('[data-testid="organizace-processes"]', (e) => e.innerText).catch(() => '');
  expect(/Procesy/.test(proc) && /Úklid kanceláře/.test(proc), 'Organizace: karta Procesy s procesem');
  expect(!(await page.$eval('[data-testid="organizace-projects"]', (e) => e.innerText).catch(() => '')).includes('Úklid kanceláře'), 'proces není mezi projekty podle %');
  expect(!!(await page.$('[data-testid="organizace-kpi-processes"]')), 'dlaždice Procesů');

  console.log('== titulka: filtr Vše · Projekty · Procesy (Richard 29. 10.) ==');
  const projekt = (await inst.api('POST', '/api/collections/goalmaps/records', { token: tok(TA), body: {
    title: 'Stěhování skladu', nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Stěhování skladu', title: 'Stěhování skladu', status: 'todo' } }], edges: [] } })).json;
  expect(!!projekt.id, 'vedle procesu i obyčejný projekt');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="home-kind-filter"]', { timeout: 10000 }).catch(() => {});
  const filtrText = await page.$eval('[data-testid="home-kind-filter"]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  expect(/Vše \(2\)/.test(filtrText) && /Projekty \(1\)/.test(filtrText) && /Procesy \(1\)/.test(filtrText), `přepínač s počty (${filtrText})`);
  // jen sekce projektů pod přepínačem (Můj den nahoře ukazuje i krok procesu s názvem mapy)
  const titulka = () => page.evaluate(() => (document.querySelector('[data-testid="home-kind-filter"]')?.parentElement || document.body).innerText);
  await page.click('[data-testid="home-kind-process"]');
  await sleep(300);
  let tx = await titulka();
  expect(/MOJE PROCESY|Moje procesy/i.test(tx) && tx.includes('Úklid kanceláře') && !tx.includes('Stěhování skladu'), 'Procesy: nadpis „Moje procesy“, jen proces');
  await page.click('[data-testid="home-kind-project"]');
  await sleep(300);
  tx = await titulka();
  expect(/Moje projekty/i.test(tx) && tx.includes('Stěhování skladu') && !tx.includes('Úklid kanceláře'), 'Projekty: jen projekt');
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="home-kind-project"]', { timeout: 10000 }).catch(() => {});
  expect(await page.$eval('[data-testid="home-kind-project"]', (e) => e.getAttribute('aria-pressed')).catch(() => '') === 'true', 'volba se pamatuje po obnovení stránky');
  await page.click('[data-testid="home-kind-all"]');

  console.log('== Úkoly: proces poznám (štítek, cíl/krok procesu, rytmus) ==');
  await page.goto(`${inst.base}/tasks?view=table`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="task-section-process"]', { timeout: 10000 }).catch(() => {});
  const sekceUkolu = (nazev) => page.evaluate((n) => {
    const radky = [...document.querySelectorAll('tbody tr')];
    const i = radky.findIndex((r) => r.querySelector('a') && r.querySelector('a').innerText.trim() === n);
    if (i < 0) return '';
    const out = [radky[i].innerText];
    for (let j = i + 1; j < radky.length && !radky[j].querySelector('td a[href^="/map/"]'); j++) out.push(radky[j].innerText + ' ' + ((radky[j].querySelector('input') || {}).placeholder || ''));
    return out.join(' | ').replace(/\s+/g, ' ');
  }, nazev);
  const su = await sekceUkolu('Úklid kanceláře');
  expect(/🔁 Proces/.test(su.split('|')[0]), `hlavička procesu se štítkem 🔁 Proces (${su.split('|')[0]})`);
  expect(/cíl procesu/.test(su) && /krok procesu/.test(su) && !/cíl projektu/.test(su), 'cíl procesu / krok procesu místo „cíl projektu“');
  expect(/Nový krok procesu/.test(su), 'řádek pro psaní: „Nový krok procesu…“');
  let ry = '';
  for (let i = 0; i < 10 && !ry; i++) { await sleep(400); ry = await page.$eval('[data-testid="task-node-rhythm"]', (e) => e.innerText).catch(() => ''); }
  expect(/🔁 každ/.test(ry), `opakovaný krok s rytmem (${ry})`);
  const sp = await sekceUkolu('Stěhování skladu');
  expect(/cíl projektu/.test(sp) && !/🔁 Proces/.test(sp) && /Nový cíl do mapy projektu/.test(sp), `projekt beze změny (${sp.slice(0, 120)})`);

  console.log('== čtenář vidí rytmus slovy (pravidla nevidí) ==');
  const p2 = await novaStranka();
  await login(p2, 'ctenar@e2e.cz');
  await p2.goto(`${inst.base}/map/${mapId}`, { waitUntil: 'networkidle2' });
  let kc = '';
  for (let i = 0; i < 16 && !/každý týden/.test(kc); i++) { await sleep(500); kc = await karta(p2, 'Vynést koše'); }
  expect(/každý týden/.test(kc), `čtenář: 🔁 rytmus na kartě (${kc})`);
  const ruleR = await inst.api('GET', `/api/kb/rules?map=${mapId}`, { token: tok(TR) });
  expect(ruleR.status >= 400 || !((ruleR.json || {}).rules || []).length, `pravidla mapy čtenáři dál nedostupná (${ruleR.status})`);

  console.log('== telefon: bez vodorovného posunu ==');
  const { page: tel } = await H.browser({ mobil: true });
  await login(tel, 'admin@e2e.cz');
  for (const url of ['/', `/map/${mapId}`, `/map/${mapId}?view=dashboard`]) {
    await tel.goto(inst.base + url, { waitUntil: 'networkidle2' });
    await sleep(1500);
    const sire = await tel.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sire[0] <= sire[1] + 1, `${url}: bez vodorovného posunu (${sire[0]} ≤ ${sire[1]})`);
  }

  expect(chyby.length === 0, `konzole bez chyb (${chyby.slice(0, 2).join(' | ') || 'čistá'})`);
}, { nazev: 'UI-PROCES' });
