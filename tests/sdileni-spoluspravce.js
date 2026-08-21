// „Upravovat" = SPOLUSPRÁVCE — smí mapu i dál sdílet (Richard 20. 8. 2026).
//
// Rozhodnutí modelu práv (podklad ~/Claude_Holly/kb-prava-model-zadani.md):
// kdo rozdává práci, umí zařídit i přístup. Sdílení (jmenovitý seznam) spravuje
// vlastník NEBO JMENOVANÝ spolusprávce — řádek v map_shares s permission=edit.
// ⚠️ Plošné týmové „edit" (team_access) sdílet NESMÍ — jinak by adresné sdílení
// rozdával kdokoli ve firmě. Týmový přístup a zveřejnění mění dál JEN vlastník.
// K tomu poznámka „má tu práci": člen s úrovní „Číst", který je garant/řešitel,
// si svůj krok odškrtne (právo z práce) — seznam sdílení to musí přiznat.
//
// Mutační pojistky: na buildu PŘED touto změnou spolusprávcovy akce vrací 403
// a `has_work` v listu není → povolené cesty padají. Zákazy (týmový edit, work,
// read, team_access/toggle_public ne-vlastníkem, org mapa) musí držet v obou.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-sdileni-spoluspravce';
const PORT = 20641;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'TajneHeslo.2026';
const VLASTNIK = 'vlastnik@e2e.cz';  // první registrace = admin instance
const SPRAVCE = 'spravce@e2e.cz';    // JMENOVANÉ „edit" — spolusprávce
const TYMAK = 'tymak@e2e.cz';        // edit jen plošně přes team_access
const DELNIK = 'delnik@e2e.cz';      // úroveň work
const CTENAR = 'ctenar@e2e.cz';      // úroveň read + GARANT uzlu (má tu práci)
const NOVY = 'novy@e2e.cz';          // koho spolusprávce přizve

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
const share = (token, body) => api('POST', '/api/kb/share', { token, body });

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch (e) { /* startuje */ } await sleep(1000); }

    for (const email of [VLASTNIK, SPRAVCE, TYMAK, DELNIK, CTENAR, NOVY]) await reg(email);
    const V = await login(VLASTNIK), S = await login(SPRAVCE), T = await login(TYMAK),
      W = await login(DELNIK), C = await login(CTENAR), N = await login(NOVY);

    const mapa = await api('POST', '/api/collections/goalmaps/records', {
      token: V,
      body: {
        title: 'Sdílená mapa',
        nodes: [
          { id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'PROJEKT', title: 'PROJEKT', status: 'todo' } },
          { id: 'n-ctenar', type: 'goalNode', position: { x: 60, y: 420 }, data: { title: 'Krok čtenáře', status: 'todo', owner: CTENAR } },
          { id: 'n-volny', type: 'goalNode', position: { x: 340, y: 420 }, data: { title: 'Volný krok', status: 'todo' } },
          { id: 'n-tymak', type: 'goalNode', position: { x: 620, y: 420 }, data: { title: 'Krok týmáka', status: 'todo', owner: TYMAK } },
        ],
        edges: ['n-ctenar', 'n-volny', 'n-tymak'].map((tgt, i) => ({ id: `e${i}`, source: 'apex', target: tgt })),
      },
    });
    const mapId = mapa.json?.id;
    expect(mapa.status === 200 && !!mapId, `mapa založena (${mapa.status})`);

    let r = await share(V, { action: 'share', mapId, email: SPRAVCE, permission: 'edit' });
    expect(r.status === 200, `vlastník jmenoval spolusprávce (${r.status})`);
    await share(V, { action: 'share', mapId, email: DELNIK, permission: 'work' });
    await share(V, { action: 'share', mapId, email: CTENAR, permission: 'read' });
    r = await share(V, { action: 'set_team_access', mapId, access: 'edit' });
    expect(r.status === 200, `vlastník zapnul týmové „edit" (${r.status})`);

    console.log('== SPOLUSPRÁVCE (jmenované edit) spravuje jmenovitý seznam ==');
    r = await share(S, { action: 'share', mapId, email: NOVY, permission: 'read' });
    expect(r.status === 200, `spolusprávce přizve nového člověka (${r.status} ${r.json?.error || ''})`);
    r = await share(S, { action: 'update_permission', mapId, memberEmail: NOVY, permission: 'work' });
    expect(r.status === 200, `spolusprávce povýší člena (${r.status})`);
    r = await share(S, { action: 'update_permission', mapId, memberEmail: NOVY, permission: 'read' });
    expect(r.status === 200, `spolusprávce smí i SNÍŽIT úroveň (${r.status})`);
    r = await share(S, { action: 'list', mapId });
    expect(r.status === 200 && (r.json?.members || []).some((m) => m.email === NOVY), `spolusprávce vidí seznam sdílení (${r.status})`);
    r = await share(S, { action: 'share', mapId, email: VLASTNIK, permission: 'read' });
    expect(r.status === 400, `řádek sdílení pro VLASTNÍKA nevznikne (${r.status})`);
    // stráž vlastníka čte pole PODLE AKCE — přibalené nevyužité `email` ji
    // nesmí obejít (nález panelu 21. 8.; před opravou tudy prošel unshare)
    r = await share(S, { action: 'unshare', mapId, memberEmail: VLASTNIK, email: 'kdokoli@e2e.cz' });
    expect(r.status === 400, `unshare vlastníka neprojde ani s přibaleným polem email (${r.status})`);
    // e-maily se porovnávají bez ohledu na velikost písmen (mixed-case řádky
    // z org syncu) — před opravou vrátil update_permission 400 userNoAccess
    r = await share(S, { action: 'update_permission', mapId, memberEmail: NOVY.toUpperCase(), permission: 'work' });
    expect(r.status === 200, `update_permission bere e-mail case-insensitive (${r.status})`);
    r = await share(S, { action: 'unshare', mapId, memberEmail: NOVY });
    expect(r.status === 200, `spolusprávce smí člena odebrat (${r.status})`);

    console.log('== hranice: plošná expozice a mazání zůstávají vlastníkovi ==');
    r = await share(S, { action: 'set_team_access', mapId, access: 'read' });
    expect(r.status === 403, `spolusprávce NEZMĚNÍ týmový přístup (${r.status})`);
    r = await share(S, { action: 'toggle_public', mapId });
    expect(r.status === 403, `spolusprávce mapu NEZVEŘEJNÍ (${r.status})`);
    r = await share(V, { action: 'list', mapId });
    expect(r.json?.team_access === 'edit' && r.json?.is_public === false, 'týmový přístup i soukromí zůstaly, jak je vlastník nechal');

    console.log('== MUTAČNÍ POJISTKA: plošné týmové „edit" sdílet nesmí ==');
    r = await share(T, { action: 'share', mapId, email: NOVY, permission: 'read' });
    expect(r.status === 403, `týmový editor (bez jmenovaného řádku) sdílení NEDOSTAL (${r.status})`);
    r = await share(T, { action: 'list', mapId });
    expect(r.status === 403, `…ani seznam sdílení nevidí (${r.status})`);

    console.log('== nižší úrovně sdílet nesmí ==');
    r = await share(W, { action: 'share', mapId, email: NOVY, permission: 'read' });
    expect(r.status === 403, `spolupracovník (work) sdílet nesmí (${r.status})`);
    r = await share(C, { action: 'share', mapId, email: NOVY, permission: 'read' });
    expect(r.status === 403, `čtenář sdílet nesmí (${r.status})`);
    r = await share(N, { action: 'share', mapId, email: NOVY, permission: 'read' });
    expect(r.status === 403, `kdo v mapě není, sdílet nesmí (${r.status})`);

    // ⚠️ Pro kontroly 5c týmový přístup DOLŮ na „read": s týmovým „edit" je
    // KAŽDÝ člen instance editorem mapy a smí legitimně přepnout kterýkoli
    // uzel — assert „cizí krok nepřepne" by lhal o něčem jiném, než měří.
    r = await share(V, { action: 'set_team_access', mapId, access: 'read' });
    expect(r.status === 200, `vlastník přepnul týmový přístup na „read" (${r.status})`);

    console.log('== seznam PŘIZNÁVÁ právo z práce: has_work + týmoví pracanti ==');
    r = await share(V, { action: 'list', mapId });
    const clen = Object.fromEntries((r.json?.members || []).map((m) => [m.email, m]));
    expect(clen[CTENAR]?.has_work === true, `čtenář-garant má has_work=true (${clen[CTENAR]?.has_work})`);
    expect(clen[DELNIK]?.has_work === false, `člen bez práce má has_work=false (${clen[DELNIK]?.has_work})`);
    // TYMAK není jmenovaný, mapu vidí přes týmový přístup a má na ní krok —
    // seznam o něm nesmí mlčet (Richard 21. 8.; před změnou pole neexistovalo)
    const tymaci = (r.json?.team_workers || []).map((m) => m.email);
    expect(tymaci.includes(TYMAK), `týmový pracant je v team_workers (${JSON.stringify(tymaci)})`);
    expect(!tymaci.includes(DELNIK) && !tymaci.includes(CTENAR) && !tymaci.includes(VLASTNIK),
      'jmenovaní členové ani vlastník v team_workers nefigurují');

    console.log('== regrese: právo z práce (5c) beze změny ==');
    r = await api('POST', '/api/kb/node-status', { token: C, body: { mapId, nodeId: 'n-ctenar', status: 'done' } });
    expect(r.status === 200, `čtenář-garant si svůj krok dál odškrtne (${r.status} ${r.json?.error || ''})`);
    r = await api('POST', '/api/kb/node-status', { token: C, body: { mapId, nodeId: 'n-volny', status: 'done' } });
    expect(r.status === 403, `cizí krok čtenář dál nepřepne (${r.status})`);

    console.log('== org mapa: sdílení jen admin, spolusprávcovství to neobchází ==');
    r = await api('POST', '/api/kb/org-map', { token: V }); // první účet = admin
    const orgId = r.json?.map?.id;
    expect(r.status === 200 && !!orgId, `admin založil org mapu (${r.status})`);
    if (orgId) {
      r = await share(V, { action: 'share', mapId: orgId, email: SPRAVCE, permission: 'edit' });
      // ať už admin jmenování pustí, nebo ne, ne-admin přes routu NEPROJDE:
      r = await share(S, { action: 'share', mapId: orgId, email: NOVY, permission: 'read' });
      expect(r.status === 403, `ne-admin org mapu nesdílí ani jako jmenovaný edit (${r.status})`);
      // ani ADMIN-NEVLASTNÍK: org sync dává adminům edit řádky v map_shares,
      // takže by spolusprávcovský gate jinak prošel (nález panelu 21. 8. —
      // před opravou tu bylo 200 a admin-nevlastník mohl org mapu sdílet)
      execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
      const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
      const sId = ((await api('GET', `/api/collections/users/records?filter=${encodeURIComponent(`email='${SPRAVCE}'`)}`, { token: ST })).json.items || [])[0].id;
      await api('PATCH', `/api/collections/users/records/${sId}`, { token: ST, body: { role: 'admin' } });
      const S2 = await login(SPRAVCE); // čerstvý token s rolí admin
      r = await share(S2, { action: 'share', mapId: orgId, email: NOVY, permission: 'read' });
      expect(r.status === 403, `org mapu nesdílí ani ADMIN, který není vlastník (${r.status})`);
      await api('PATCH', `/api/collections/users/records/${sId}`, { token: ST, body: { role: 'member' } });
    }

    console.log('== odebráním sebe sama spolusprávcovství KONČÍ ==');
    r = await share(S, { action: 'unshare', mapId, memberEmail: SPRAVCE });
    expect(r.status === 200, `spolusprávce smí odejít z mapy (${r.status})`);
    r = await share(S, { action: 'share', mapId, email: NOVY, permission: 'read' });
    expect(r.status === 403, `po odchodu už sdílet nesmí (${r.status})`);
    r = await share(V, { action: 'share', mapId, email: SPRAVCE, permission: 'edit' });
    expect(r.status === 200, `vlastník ho jmenoval zpět (${r.status})`);

    console.log('== notifikace: povýšení oznámí, zadání práce nedubluje ==');
    // Richard 21. 8.: povýšení sdílení má adresáta informovat, ALE nesmí chodit
    // 2 notifikace — přisdílení v rámci zadání práce (quiet) mlčí, protože hned
    // nato přijde souhrnná notifikace o přidělené práci.
    const mapSharedCount = async (token) =>
      ((await api('GET', '/api/collections/notifications/records?perPage=100', { token })).json?.items || [])
        .filter((n) => n.type === 'map_shared').reduce((a, n) => a + (n.count || 1), 0);
    // NOVY už notifikace z dřívějších sekcí MÁ — měří se ROZDÍL, ne absolutní počet
    const zaklad = await mapSharedCount(N);
    r = await share(V, { action: 'share', mapId, email: NOVY, permission: 'read' });
    expect(r.status === 200 && (await mapSharedCount(N)) === zaklad + 1, `nové sdílení poslalo 1 notifikaci (+${(await mapSharedCount(N)) - zaklad})`);
    r = await share(V, { action: 'share', mapId, email: NOVY, permission: 'work' });
    expect(r.status === 200 && r.json?.upgraded === true, `povýšení read→work prošlo (${r.status})`);
    expect((await mapSharedCount(N)) === zaklad + 2, `povýšení poslalo druhou notifikaci (+${(await mapSharedCount(N)) - zaklad})`);
    await share(V, { action: 'unshare', mapId, memberEmail: NOVY });
    r = await share(V, { action: 'share', mapId, email: NOVY, permission: 'read', quiet: true });
    expect(r.status === 200 && (await mapSharedCount(N)) === zaklad + 2, `quiet sdílení (zadání práce) NEposlalo notifikaci (+${(await mapSharedCount(N)) - zaklad})`);
    r = await share(V, { action: 'share', mapId, email: NOVY, permission: 'work', quiet: true });
    expect(r.status === 200 && (await mapSharedCount(N)) === zaklad + 2, `quiet povýšení NEposlalo notifikaci (+${(await mapSharedCount(N)) - zaklad})`);

    // Pro UI část zpět týmové „edit": TYMAK má být plnohodnotný EDITOR mapy,
    // a přesto bez tlačítka Sdílet — to je ta zajímavá hranice.
    r = await share(V, { action: 'set_team_access', mapId, access: 'edit' });
    expect(r.status === 200, `vlastník vrátil týmové „edit" (${r.status})`);

    console.log('== UI: spolusprávce má Sdílet, týmový editor ne; „má tu práci" vidět ==');
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const prihlas = async (email) => {
      const page = await browser.newPage();
      // šířka ≥1850 px: tlačítko Sdílet je v liště, ne schované v ⋮ menu
      await page.setViewport({ width: 1920, height: 950 });
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('#email');
      await page.type('#email', email);
      await page.type('#password', PW);
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
      await sleep(1500);
      await page.goto(`${BASE}/map/${mapId}`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('.react-flow__node', { timeout: 15000 });
      await sleep(2500);
      return page;
    };
    const najdiSdilet = (page) => page.evaluate(() => {
      const btn = [...document.querySelectorAll('header button, button')]
        .find((b) => /sdílet|share/i.test((b.innerText || '').trim()) && b.querySelector('svg'));
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, trefa: btn === top || btn.contains(top) };
    });

    // vlastník: dialog ukazuje „má tu práci" u čtenáře-garanta + sekce vlastníka
    let page = await prihlas(VLASTNIK);
    let sdilet = await najdiSdilet(page);
    expect(!!sdilet && sdilet.trefa, `vlastník: tlačítko Sdílet je a myš ho trefí (${JSON.stringify(sdilet)})`);
    // ⚠️ MYŠÍ, ne btn.click() — programový klik ignoruje pointer-events
    await page.mouse.click(sdilet.x, sdilet.y);
    await page.waitForSelector('[data-testid="share-has-work"]', { timeout: 10000 }).catch(() => {});
    const uVlastnika = await page.evaluate(() => ({
      maPraci: !!document.querySelector('[data-testid="share-has-work"]'),
      sekce: document.body.innerText.includes('Celá organizace') || document.body.innerText.includes('Entire organization'),
      tymaci: !!document.querySelector('[data-testid="share-team-workers"]'),
    }));
    expect(uVlastnika.maPraci, 'vlastník vidí u čtenáře-garanta štítek „má tu práci"');
    expect(uVlastnika.sekce, 'vlastník vidí sekci týmového přístupu');
    expect(uVlastnika.tymaci, 'vlastník vidí sekci „mají tu práci přes týmový přístup"');
    await page.close();

    // spolusprávce: Sdílet má, dialog se načte, sekce vlastníka NEVIDÍ
    page = await prihlas(SPRAVCE);
    sdilet = await najdiSdilet(page);
    expect(!!sdilet && sdilet.trefa, `spolusprávce: tlačítko Sdílet je a myš ho trefí (${JSON.stringify(sdilet)})`);
    await page.mouse.click(sdilet.x, sdilet.y);
    await sleep(2000);
    const uSpravce = await page.evaluate(() => ({
      dialog: !!document.querySelector('[role="dialog"]'),
      chyba: /nepodařilo|failed/i.test(document.querySelector('[role="dialog"]')?.innerText || ''),
      sekce: document.body.innerText.includes('Celá organizace') || document.body.innerText.includes('Entire organization'),
    }));
    expect(uSpravce.dialog && !uSpravce.chyba, `spolusprávci se dialog načte bez chyby (${JSON.stringify(uSpravce)})`);
    expect(!uSpravce.sekce, 'týmový přístup/zveřejnění spolusprávce nevidí (jen vlastník)');
    await page.close();

    // týmový editor: mapu edituje, ale Sdílet NEMÁ (dřív měl a dostával 403)
    page = await prihlas(TYMAK);
    sdilet = await najdiSdilet(page);
    expect(sdilet === null, `týmový editor tlačítko Sdílet NEVIDÍ (${JSON.stringify(sdilet)})`);
    await page.close();
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
