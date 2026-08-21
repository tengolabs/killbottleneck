// „Dostal jsem úkol v cizí mapě, ale nemám ho jak dokončit" — Richard 20. 8. 2026.
//
// Nález z ostrého provozu: mapa nasdílená KE ČTENÍ (nebo viditelná jen přes
// týmový přístup) + zadaný úkol = řešitel odškrtne úkolový ZÁZNAM, ale STAV UZLU
// mu server odmítne (403). Uzel je přitom ta práce — mapa i procento projektu
// tedy dál hlásí „nehotovo" a zadavatel nevidí, že je uděláno.
//
// ZÁVAZNÉ PRAVIDLO (rozhodnuto 20. 8. 2026): právo plyne z PRÁCE. Kdo mapu VIDÍ
// a má na uzlu svou práci (garant `data.owner` nebo řešitel úkolu), smí přepnout
// stav TOHO uzlu — bez ohledu na to, jakou cestou se k mapě dostal. Zadání úkolu
// navíc POVÝŠÍ sdílení na „spolupracovníka", ať to vlastník v seznamu vidí.
//
// Mutační pojistky (jinak by sada byla vždy zelená): musí projít povolené cesty
// (čtenář se svou prací, týmový přístup, spolupracovník) A ZÁROVEŇ musí padnout
// cizí uzel, cizí mapa i veřejná vývěska. Sada JE ověřená proti starému buildu —
// tam padá na těch samých místech, na kterých nález vznikl.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-ukol-bez-prav';
const PORT = 20563;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'TajneHeslo.2026';
const VLASTNIK = 'vlastnik@e2e.cz';
const CTENAR = 'ctenar@e2e.cz';      // sdíleno ke čtení, má na uzlu ÚKOL
const GARANT = 'garant@e2e.cz';      // sdíleno ke čtení, je GARANT uzlu
const TYM = 'tym@e2e.cz';            // mapu vidí jen přes team_access = read
const CIZI = 'cizi@e2e.cz';          // nemá k mapě žádný přístup
const EDITOR = 'editor@e2e.cz';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch (e) { /* prázdné tělo */ }
  return { status: res.status, json };
}
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;
const stavUzlu = async (token, mapId, nodeId) =>
  ((await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token })).json?.nodes || [])
    .find((n) => n.id === nodeId)?.data?.status;

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch (e) { /* startuje */ } await sleep(1000); }

    for (const email of [VLASTNIK, CTENAR, GARANT, TYM, CIZI, EDITOR]) await reg(email);
    const V = await login(VLASTNIK), C = await login(CTENAR), G = await login(GARANT),
      T = await login(TYM), X = await login(CIZI), E = await login(EDITOR);
    // ⚠️ LEGACY VĚTEV: položky v `tasks` se od 17. 8. 2026 NEZAKLÁDAJÍ (slovník:
    // úkol = uzel s řešitelem; prázdná kolekce je detektor chyby, badge v UI).
    // Sada je sem sází superuserem SCHVÁLNĚ — na starých instancích taková data
    // pořád leží a řešitel je musí umět odškrtnout. Klik-testovací scénáře je
    // stavět NESMÍ, jinak si vyrobí oranžový odznak „0/1" jako 20. 8. 2026.
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    const vId = ((await api('GET', `/api/collections/users/records?filter=${encodeURIComponent(`email='${VLASTNIK}'`)}`, { token: ST })).json.items || [])[0].id;
    const suTask = (body) => api('POST', '/api/collections/tasks/records', { token: ST, body: { owner: vId, owner_email: VLASTNIK, ...body } });

    // ⚠️ KAŽDÝ uzel na SVÉ souřadnici. Se společnou pozicí leží karty na sobě
    // a měření „trefí myš tlačítko?" testuje překryv, ne opravu (20. 8. 2026).
    let poradi = 0;
    const uzel = (id, title, owner) => ({
      id, type: 'goalNode', position: { x: 60 + (poradi++) * 280, y: 420 },
      data: { title, status: 'todo', ...(owner ? { owner } : {}) },
    });
    const mapa = await api('POST', '/api/collections/goalmaps/records', {
      token: V,
      body: {
        title: 'Zavedení',
        nodes: [
          { id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'PROJEKT', title: 'PROJEKT', status: 'todo' } },
          uzel('n-ukol', 'Úkol čtenáře'),
          uzel('n-garant', 'Krok garanta', GARANT),
          uzel('n-tym', 'Krok týmu', TYM),
          uzel('n-cizi', 'Cizí krok'),
        ],
        edges: ['n-ukol', 'n-garant', 'n-tym', 'n-cizi'].map((t, i) => ({ id: `e${i}`, source: 'apex', target: t })),
      },
    });
    const mapId = mapa.json?.id;
    expect(mapa.status === 200 && !!mapId, `mapa založena (${mapa.status})`);

    await api('POST', '/api/kb/share', { token: V, body: { action: 'share', mapId, email: CTENAR, permission: 'read' } });
    await api('POST', '/api/kb/share', { token: V, body: { action: 'share', mapId, email: GARANT, permission: 'read' } });
    await api('POST', '/api/kb/share', { token: V, body: { action: 'share', mapId, email: EDITOR, permission: 'edit' } });
    await api('POST', '/api/kb/share', { token: V, body: { action: 'set_team_access', mapId, access: 'read' } });
    let r = await suTask({ title: 'Úkol pro čtenáře', status: 'todo', map: mapId, node_id: 'n-ukol', assignee_email: CTENAR });
    expect(r.status === 200, `úkol čtenáři na uzlu založen (${r.status})`);
    r = await suTask({ title: 'Úkol pro člena týmu', status: 'todo', map: mapId, node_id: 'n-tym', assignee_email: TYM });
    expect(r.status === 200, `úkol členovi týmu založen (${r.status})`);

    console.log('== POVOLENÉ cesty: kdo má práci, ten ji odškrtne ==');
    r = await api('POST', '/api/kb/node-status', { token: C, body: { mapId, nodeId: 'n-ukol', status: 'done' } });
    expect(r.status === 200, `čtenář odškrtne uzel se SVÝM ÚKOLEM (${r.status} ${r.json?.error || ''})`);
    expect(await stavUzlu(V, mapId, 'n-ukol') === 'done', 'stav se propsal do mapy (vidí vlastník)');
    r = await api('POST', '/api/kb/node-status', { token: G, body: { mapId, nodeId: 'n-garant', status: 'in_progress' } });
    expect(r.status === 200, `čtenář přepne uzel, kde je GARANT (${r.status} ${r.json?.error || ''})`);
    r = await api('POST', '/api/kb/node-status', { token: T, body: { mapId, nodeId: 'n-tym', status: 'done' } });
    expect(r.status === 200, `člen týmu (mapa jen týmově ke čtení) odškrtne svůj uzel (${r.status} ${r.json?.error || ''})`);
    r = await api('POST', '/api/kb/node-status', { token: E, body: { mapId, nodeId: 'n-cizi', status: 'done' } });
    expect(r.status === 200, `editor smí kterýkoli uzel — beze změny (${r.status})`);

    console.log('== ZAKÁZANÉ cesty: rozvolnění se nesmí přelít jinam ==');
    r = await api('POST', '/api/kb/node-status', { token: C, body: { mapId, nodeId: 'n-garant', status: 'todo' } });
    expect(r.status === 403, `čtenář NEPŘEPNE cizí uzel (${r.status})`);
    r = await api('POST', '/api/kb/node-status', { token: X, body: { mapId, nodeId: 'n-ukol', status: 'todo' } });
    expect(r.status === 403, `kdo mapu nevidí, nezmění nic — ani přes routu (${r.status})`);
    const puvodni = (await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: V })).json;
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token: C, body: { nodes: puvodni.nodes, edges: puvodni.edges } });
    expect(r.status !== 200, `čtenář dál NEUKLÁDÁ celou mapu — RLS beze změny (${r.status})`);
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token: T, body: { title: 'Přepsáno' } });
    expect(r.status !== 200, `týmový čtenář dál NEPŘEPÍŠE mapu (${r.status})`);

    console.log('== obchvat přes PŘESUN úkolu na cizí uzel ==');
    // `node_id` je od 20. 8. 2026 autorizační pole (/node-status podle něj pouští
    // změnu stavu), takže si ho řešitel NESMÍ přepsat. Bez zámku si čtenář přesunul
    // svůj úkol na cizí krok a získal právo ho přepnout — změřeno panelem, a šlo to
    // i před touhle vlnou (tehdy úrovni „spolupracovník").
    const mujUkol = ((await api('GET', `/api/collections/tasks/records?filter=${encodeURIComponent(`assignee_email='${CTENAR}'`)}`, { token: C })).json.items || [])[0];
    r = await api('PATCH', `/api/collections/tasks/records/${mujUkol.id}`, { token: C, body: { node_id: 'n-cizi' } });
    const poPresunu = (await api('GET', `/api/collections/tasks/records/${mujUkol.id}`, { token: C })).json;
    expect(poPresunu?.node_id === 'n-ukol', `řešitel si úkol NEPŘESUNE na cizí krok (zůstalo ${poPresunu?.node_id})`);
    r = await api('POST', '/api/kb/node-status', { token: C, body: { mapId, nodeId: 'n-cizi', status: 'done' } });
    expect(r.status === 403, `a tím pádem cizí krok nepřepne (${r.status})`);
    r = await api('PATCH', `/api/collections/tasks/records/${mujUkol.id}`, { token: C, body: { assignee_email: 'nekdo@jiny.cz' } });
    const poPredani = (await api('GET', `/api/collections/tasks/records/${mujUkol.id}`, { token: C })).json;
    expect(poPredani?.assignee_email === CTENAR, `řešitel si úkol NEPŘEDÁ dál (zůstalo ${poPredani?.assignee_email})`);
    r = await api('PATCH', `/api/collections/tasks/records/${mujUkol.id}`, { token: V, body: { node_id: 'n-cizi' } });
    const poZadavateli = (await api('GET', `/api/collections/tasks/records/${mujUkol.id}`, { token: V })).json;
    expect(poZadavateli?.node_id === 'n-cizi', `ZADAVATEL úkol přesunout smí (${poZadavateli?.node_id})`);
    await api('PATCH', `/api/collections/tasks/records/${mujUkol.id}`, { token: V, body: { node_id: 'n-ukol' } });

    console.log('== veřejná vývěska nepouští k zápisu ==');
    const verejna = await api('POST', '/api/collections/goalmaps/records', {
      token: V,
      body: {
        title: 'Vývěska',
        nodes: [uzel('v1', 'Krok s cizí adresou v garantovi', CIZI)], edges: [],
      },
    });
    r = await api('POST', '/api/kb/share', { token: V, body: { action: 'toggle_public', mapId: verejna.json.id } });
    expect(r.json?.is_public === true, `vývěska je opravdu veřejná (${r.json?.is_public})`);
    r = await api('POST', '/api/kb/node-status', { token: X, body: { mapId: verejna.json.id, nodeId: 'v1', status: 'done' } });
    expect(r.status === 403, `garant zapsaný ve VEŘEJNÉ mapě bez sdílení stav nepřepne (${r.status})`);

    console.log('== zadání úkolu POVÝŠÍ sdílení, nesnižuje ==');
    r = await api('POST', '/api/kb/share', { token: V, body: { action: 'share', mapId, email: CTENAR, permission: 'work' } });
    expect(r.status === 200 && r.json?.member?.permission === 'work',
      `čtenář se přisdílením při zadání úkolu POVÝŠÍ na spolupracovníka (${r.status}/${r.json?.member?.permission || r.json?.error})`);
    r = await api('POST', '/api/kb/share', { token: V, body: { action: 'list', mapId } });
    let perms = Object.fromEntries((r.json?.members || []).map((m) => [m.email, m.permission]));
    expect(perms[CTENAR] === 'work', `vlastník to vidí v seznamu sdílení (${perms[CTENAR]})`);
    r = await api('POST', '/api/kb/share', { token: V, body: { action: 'share', mapId, email: EDITOR, permission: 'work' } });
    expect(r.status === 400, `editorovi se zadáním úkolu práva NESEBEROU (${r.status})`);
    r = await api('POST', '/api/kb/share', { token: V, body: { action: 'list', mapId } });
    perms = Object.fromEntries((r.json?.members || []).map((m) => [m.email, m.permission]));
    expect(perms[EDITOR] === 'edit', `editor zůstal editorem (${perms[EDITOR]})`);
    r = await api('POST', '/api/kb/share', { token: V, body: { action: 'share', mapId, email: CTENAR, permission: 'work' } });
    expect(r.status === 400, `stejná úroveň podruhé = pořád „už je sdílena" (${r.status})`);

    console.log('== UI: čtenář má tlačítko u SVÉHO kroku, u cizího ne ==');
    // GARANT zůstal čtenářem (nepovyšoval se) — na něm se měří pohled „jen pro čtení"
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 950 });
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', GARANT);
    await page.type('#password', PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1500);
    await page.goto(`${BASE}/map/${mapId}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node', { timeout: 15000 });
    await sleep(2500);
    const stavBtn = (titul) => page.evaluate((tt) => {
      const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes(tt));
      const btn = n?.querySelector('button');
      return btn ? { disabled: btn.disabled, text: (btn.innerText || '').trim() } : null;
    }, titul);
    const muj = await stavBtn('Krok garanta');
    const cizi = await stavBtn('Cizí krok');
    expect(muj && !muj.disabled, `štítek stavu VLASTNÍHO kroku je klikatelný (${JSON.stringify(muj)})`);
    expect(cizi && cizi.disabled, `štítek stavu CIZÍHO kroku klikatelný NENÍ (${JSON.stringify(cizi)})`);
    const tuzky = await page.evaluate(() => {
      const naKroku = (tt) => {
        const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes(tt));
        return [...(n?.querySelectorAll('button') || [])].filter((b) => b.querySelector('.lucide-pencil')).length;
      };
      return { muj: naKroku('Krok garanta'), cizi: naKroku('Cizí krok') };
    });
    expect(tuzky.muj === 1 && tuzky.cizi === 0, `detail (tužka) jen u vlastního kroku (${JSON.stringify(tuzky)})`);

    // Hodiny (měření času) zůstávají i u CIZÍHO kroku — vědomé rozhodnutí
    // Richarda 20. 8. 2026: výkaz času je osobní záznam, vidí ho jen jeho autor.
    // Kdyby je někdo „uklidil" k štítku a tužce, spadne tahle kontrola.
    const hodiny = await page.evaluate(() => {
      const naKroku = (tt) => {
        const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes(tt));
        return [...(n?.querySelectorAll('button') || [])].filter((b) => b.querySelector('.lucide-timer')).length;
      };
      return { muj: naKroku('Krok garanta'), cizi: naKroku('Cizí krok') };
    });
    expect(hodiny.muj === 1 && hodiny.cizi === 1, `hodiny zůstávají i u cizího kroku — rozhodnutí, ne vada (${JSON.stringify(hodiny)})`);

    const trefa = await page.evaluate(() => {
      const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes('Krok garanta'));
      const btn = n.querySelector('button');
      const r = btn.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return btn === top || btn.contains(top);
    });
    expect(trefa, 'myš na štítek stavu trefí TLAČÍTKO, ne plátno pod kartou');

    const predKlikem = await stavUzlu(V, mapId, 'n-garant');
    // ⚠️ MYŠÍ na souřadnice, NE btn.click(). Programový klik ignoruje
    // pointer-events, takže by prošel i přes kartu, kterou xyflow ve čtecím
    // režimu dělá pro myš průhlednou — přesně ta vada z 20. 8. 2026 (tlačítko
    // vidím, zmáčknout nejde). Sada s .click() byla na tenhle stav slepá.
    const stred = await page.evaluate(() => {
      const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes('Krok garanta'));
      const r = n.querySelector('button').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(stred.x, stred.y);
    await sleep(2000);
    const poKliku = await stavUzlu(V, mapId, 'n-garant');
    expect(poKliku !== predKlikem, `klik ve mapě stav opravdu změnil (${predKlikem} → ${poKliku})`);

    // ⚠️ POCTIVĚ: tahle kontrola NEDOKAZUJE podmínku `mujPracovniUzel` u dvojkliku.
    // Ve čtecím režimu je TĚLO karty pro myš průhledné (pointer-events vrací jen
    // tlačítkům), takže dvojklik nedopadne na kartu ani u VLASTNÍHO kroku — změřeno
    // 20. 8. 2026 i na buildu BEZ opravy, kde by tedy prošla taky. Měří se proto obojí
    // a tvrdí se jen to, co z toho plyne: dvojklikem se čtenář do okna nedostane.
    // Podmínka v GoalNode je obrana do hloubky, kdyby se pointer-events na kartě vrátily.
    const dvojklik = {};
    for (const [klic, titul] of [['muj', 'Krok garanta'], ['cizi', 'Cizí krok']]) {
      const xy = await page.evaluate((tt) => {
        const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes(tt));
        const r = n.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height - 18 };
      }, titul);
      await page.mouse.click(xy.x, xy.y, { clickCount: 2 });
      await sleep(1800);
      dvojklik[klic] = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
      if (dvojklik[klic]) { await page.keyboard.press('Escape'); await sleep(600); }
    }
    expect(!dvojklik.cizi, `dvojklikem se čtenář do okna CIZÍHO kroku nedostane (${JSON.stringify(dvojklik)})`);

    console.log('== UI: okno kroku nabízí jen to, co čtenář smí ==');
    // vlastník přiloží ODKAZ — seznam příloh musí zůstat vidět (číst je smí),
    // ale tlačítka „Přidat přílohu/odkaz" ne: jdou do kolekce, která chce EDIT.
    await api('POST', '/api/collections/node_files/records', {
      token: V, body: { map: mapId, node_id: 'n-garant', url: 'https://example.com/zadani', name: 'zadani.pdf', size: 0 },
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node', { timeout: 15000 });
    await sleep(2500);
    const tuzka = await page.evaluate(() => {
      const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes('Krok garanta'));
      const b = [...n.querySelectorAll('button')].find((x) => x.querySelector('.lucide-pencil'));
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(tuzka.x, tuzka.y);
    await sleep(4000);
    const okno = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return null;
      const txt = dlg.innerText;
      return {
        stav: /Založeno/.test(txt) && /Probíhá/.test(txt) && /Hotovo/.test(txt),
        termin: /Navrhnout jiný termín/i.test(txt),
        priloha: /Přidat přílohu/i.test(txt),
        odkaz: /Přidat odkaz/i.test(txt),
        seznam: /zadani\.pdf/i.test(txt),
        komentare: /koment/i.test(txt),
      };
    });
    expect(okno && okno.stav, `okno nabízí přepnutí stavu (${JSON.stringify(okno)})`);
    expect(okno && !okno.priloha && !okno.odkaz, 'okno NENABÍZÍ přílohu ani odkaz — server je čtenáři nedovolí');
    expect(okno && !okno.termin, 'okno NENABÍZÍ žádost o termín — tu pouští až spolupracovníkovi');
    expect(okno && okno.seznam, 'seznam už přiložených souborů čtenář VIDÍ');
    expect(okno && okno.komentare, 'komentáře zůstávají');
    await page.keyboard.press('Escape');
    await sleep(800);

    console.log('== UI: stránka Úkoly — odškrtnutí projde na uzel ==');
    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    const klik = await page.evaluate(() => {
      const row = [...document.querySelectorAll('tr')].find((x) => (x.innerText || '').includes('Krok garanta'));
      const btn = row?.querySelector('button');
      if (!btn) return false;
      btn.click();
      return true;
    });
    expect(klik, 'řádek vlastního kroku má klikatelný stav');
    await sleep(2000);
    const poTabulce = await stavUzlu(V, mapId, 'n-garant');
    expect(poTabulce !== poKliku, `stav se změnil i ze stránky Úkoly (${poKliku} → ${poTabulce})`);
    console.log('== UI: zadavatel dostane nabídku povýšit čtenáře ==');
    // ⚠️ Povýšení se dosud ověřovalo JEN přes API — a produkt tu cestu nevolal
    // („má přístup" = kdokoli ze sdílení, tedy i čtenář). Tohle projde UI cestu
    // vlastníka: v okně cíle vybere řešitele, který mapu jen ČTE.
    const stranka = await browser.newPage();
    await stranka.setViewport({ width: 1500, height: 950 });
    const dotazy = [];
    stranka.on('dialog', async (d) => { dotazy.push(d.message().slice(0, 60)); await d.accept(); });
    await stranka.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await stranka.waitForSelector('#email');
    await stranka.type('#email', VLASTNIK);
    await stranka.type('#password', PW);
    await Promise.all([stranka.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), stranka.click('button[type="submit"]')]);
    await sleep(1500);
    await stranka.goto(`${BASE}/map/${mapId}`, { waitUntil: 'networkidle2' });
    await stranka.waitForSelector('.react-flow__node', { timeout: 15000 });
    await sleep(2500);
    // otevřít cizí krok (vlastník má velké okno) a přiřadit řešitele-čtenáře
    const kartaXY = await stranka.evaluate(() => {
      const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes('Cizí krok'));
      const b = [...n.querySelectorAll('button')].find((x) => x.querySelector('.lucide-pencil'));
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await stranka.mouse.click(kartaXY.x, kartaXY.y);
    await sleep(3000);
    const doZadani = await stranka.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const b = [...(dlg?.querySelectorAll('button') || [])].find((x) => /^Zadání$/.test((x.innerText || '').trim()));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    expect(!!doZadani, 'vlastník má v okně cíle záložku Zadání');
    if (doZadani) {
      await stranka.mouse.click(doZadani.x, doZadani.y);
      await sleep(1200);
      // Radix Select: otevřít a vybrat čtenáře podle textu
      const vybrano = await stranka.evaluate(async (email) => {
        // select řešitele má id `<prefix>owner` (AssignmentSection → OwnerSelect)
        const trigger = document.querySelector('[id$="owner"][role="combobox"], [id$="owner"]');
        if (!trigger) return 'trigger nenalezen';
        trigger.click();
        await new Promise((r) => setTimeout(r, 900));
        const opt = [...document.querySelectorAll('[role="option"]')].find((o) => (o.innerText || '').includes(email));
        if (!opt) return `volba nenalezena (${[...document.querySelectorAll('[role="option"]')].length} voleb)`;
        opt.click();
        return 'ok';
      }, GARANT);
      expect(vybrano === 'ok', `řešitel se dá vybrat ze seznamu (${vybrano})`);
      await sleep(2500);
      expect(dotazy.some((d) => /jen ke čtení/.test(d)), `aplikace se ZEPTALA na povýšení (${JSON.stringify(dotazy)})`);
      const perms = await api('POST', '/api/kb/share', { token: V, body: { action: 'list', mapId } });
      const uroven = (perms.json?.members || []).find((m) => m.email === GARANT)?.permission;
      expect(uroven === 'work', `po potvrzení má čtenář úroveň spolupracovník (${uroven})`);
      const radku = (perms.json?.members || []).filter((m) => m.email === GARANT).length;
      expect(radku === 1, `a v seznamu sdílení je JEDNOU, ne dvakrát (${radku})`);
    }
    await stranka.close();

    console.log('== UI: „Moje mapa" žádná tlačítka nedostane ==');
    // Osobní mapa je dopočítaný POHLED bez uložené mapy pod sebou — tlačítka by
    // klikala do prázdna (404). Regrese z 20. 8. 2026, kterou nehlídala žádná sada.
    await page.goto(`${BASE}/my-map`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node', { timeout: 15000 }).catch(() => {});
    await sleep(3000);
    const osobni = await page.evaluate(() => {
      const uzly = [...document.querySelectorAll('.react-flow__node')];
      return {
        pocet: uzly.length,
        aktivni: uzly.filter((n) => n.querySelector('button')?.disabled === false).length,
        tuzky: uzly.filter((n) => [...n.querySelectorAll('button')].some((b) => b.querySelector('.lucide-pencil'))).length,
      };
    });
    expect(osobni.pocet > 0, `„Moje mapa" se vykreslila (${osobni.pocet} karet)`);
    expect(osobni.aktivni === 0 && osobni.tuzky === 0, `na „Mojí mapě" nesvítí stav ani tužka (${JSON.stringify(osobni)})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
