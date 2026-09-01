// UI e2e: SERIALIZACE VLASTNÍCH PATCHŮ + KANONICKÝ OTISK PŘI NAČTENÍ
// (nálezy F1-01 a F1-03, analýza kódu 27. 8. 2026; oprava hooks/useMapAutosave.js).
//   • F1-01: vlastní PATCH letí déle než debounce 1,2 s (odpověď pozdržená přes
//     CDP Fetch, requestStage=Response) a uživatel mezitím píše dál → druhé kolo
//     NESMÍ odejít se starým base_updated. Dřív: 409 → dialog „Mapa byla mezitím
//     změněna" kvůli VLASTNÍMU uložení a „Načíst znovu" = ztráta poslední úpravy.
//     Po opravě autosave počká a odešle AKTUÁLNÍ stav — žádný 409, žádný dialog,
//     v DB jsou OBĚ úpravy.
//   • F1-03: STARÝ záznam v DB (data uzlů jen title/status, bez novějších
//     kanonických klíčů) → otisk z načtení byl dřív SYROVÝ, nerovnal se
//     kanonickému, a první `dimensions` změna (stisk Čitelnosti) poslala PATCH
//     shodný s DB. Po opravě NEODEJDE ŽÁDNÝ zápis. POCTIVĚ: dnešním API takový
//     záznam nevyrobíš (create/update hook data kanonizuje normalizeNodeShapes,
//     superuser nevyjímaje) — starý tvar se zapisuje PŘÍMO do SQLite přes named
//     volume, jako by ho uložila verze před přidáním klíčů canonicalNodeData.
// Mutační důkaz: na image z mainu (kb-autosave-0) MUSÍ obě sekce zčervenat.
const { execSync } = require('child_process');
const H = require('./_harness');
const { expect, sleep } = H;

const EMAIL = 'editor@example.com';

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'autosave-serializace', env: { KB_UVODNI_MAPA: 0 }, volume: true });
  await inst.register(EMAIL, { name: 'Editor', role: 'admin' });
  const A = await inst.login(EMAIL);

  const uzly = (pref) => [
    { id: 'root', type: 'apexNode', position: { x: 250, y: 0 }, data: { title: `Cíl ${pref}`, status: 'todo' } },
    { id: 'n1', type: 'goalNode', position: { x: 40, y: 260 }, data: { title: `${pref} Alfa`, status: 'todo' } },
    { id: 'n2', type: 'goalNode', position: { x: 460, y: 260 }, data: { title: `${pref} Beta`, status: 'todo' } },
  ];
  const hrany = [{ id: 'e1', source: 'root', target: 'n1' }, { id: 'e2', source: 'root', target: 'n2' }];
  const zalozMapu = async (title) => {
    const r = await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title, nodes: uzly(title[0]), edges: hrany } });
    if (!r.json?.id) throw new Error(`založení mapy „${title}" selhalo: ${r.status}`);
    return r.json;
  };

  const { page, chyby } = await H.browser({ viewport: { width: 1920, height: 1000 } });
  await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email');
  await page.type('#email', EMAIL);
  await page.type('#password', H.PW);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1000);

  // ======================= F1-01: serializace vlastních PATCHů =======================
  console.log('== F1-01: PATCH pomalejší než debounce + další psaní → žádný 409, žádný dialog, obě úpravy v DB ==');
  const mapA = await zalozMapu('Serializace');
  await page.goto(`${inst.base}/map/${mapA.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.react-flow__node[data-id="n1"]', { timeout: 45000 });
  await sleep(4000); // usadit — případný otiskový PATCH po načtení (vada F1-03 na mainu) musí doběhnout PŘED scénářem

  const patchOdpovedi = [];
  page.on('response', (r) => {
    if (r.request().method() === 'PATCH' && /\/api\/collections\/goalmaps\/records\//.test(r.url())) patchOdpovedi.push(r.status());
  });
  // Pozdržení ODPOVĚDI prvního PATCHe o 4 s (server ho už zpracoval — přesně
  // scénář nálezu: PATCH1 v letu, debounce druhé úpravy vyprší dřív).
  const cdp = await page.target().createCDPSession();
  let zdrzujeme = false; let zdrzenychPatchu = 0;
  cdp.on('Fetch.requestPaused', (ev) => {
    const pokracuj = () => cdp.send('Fetch.continueResponse', { requestId: ev.requestId })
      .catch(() => cdp.send('Fetch.continueRequest', { requestId: ev.requestId }).catch(() => { /* stránka už jinde */ }));
    if (zdrzujeme && ev.request.method === 'PATCH' && zdrzenychPatchu === 0) { zdrzenychPatchu++; setTimeout(pokracuj, 4000); } else pokracuj();
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/collections/goalmaps/records/*', requestStage: 'Response' }] });
  zdrzujeme = true;

  // přejmenování mapy = úprava TÉHOŽ pole dvakrát po sobě („A", pak „AB") —
  // přesně příklad z nálezu; kolizi na hlavičce tichý merge nikdy nesmí slít
  const prejmenujMapu = async (stary, novy) => {
    const klik = await page.evaluate((s) => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '') === s);
      if (!b) return false; b.click(); return true;
    }, stary);
    if (!klik) return false;
    await sleep(400);
    const pole = await page.evaluate((s) => {
      const el = [...document.querySelectorAll('input')].find((i) => i.value === s);
      if (!el) return false; el.focus(); el.setSelectionRange(0, el.value.length); return true;
    }, stary);
    if (!pole) return false;
    await page.keyboard.type(novy);
    await page.keyboard.press('Enter');
    return true;
  };
  expect(await prejmenujMapu('Serializace', 'Serializace A'), 'přejmenování 1 („Serializace A")');
  await H.waitFor(() => zdrzenychPatchu === 1, { timeout: 8000, popis: 'PATCH 1 odeslán (odpověď držíme 4 s)' });
  expect(await prejmenujMapu('Serializace A', 'Serializace AB'), 'přejmenování 2 („Serializace AB") BĚHEM letícího PATCHe');
  await sleep(9000); // držená odpověď 4 s + debounce + druhé kolo + rezerva
  zdrzujeme = false;
  expect(!(await page.evaluate(() => document.body.innerText.includes('Mapa byla mezitím změněna'))),
    'dialog konfliktu se NEOBJEVIL (vlastní uložení není cizí změna)');
  expect(patchOdpovedi.length >= 1 && patchOdpovedi.length <= 4, `PATCHe odešly a netočí se dokola (${patchOdpovedi.length}×)`);
  expect(!patchOdpovedi.includes(409), `žádný PATCH neskončil 409 (statusy: ${patchOdpovedi.join(', ') || 'žádné'})`);
  const poA = (await inst.api('GET', `/api/collections/goalmaps/records/${mapA.id}`, { token: A })).json;
  expect(poA.title === 'Serializace AB', `v DB jsou OBĚ úpravy názvu („${poA.title}")`);
  expect((poA.nodes || []).length === 3, `uzly mapy zůstaly netknuté (${(poA.nodes || []).length})`);
  await cdp.send('Fetch.disable');

  // ======================= F1-03: kanonický otisk při načtení =======================
  console.log('== F1-03: starý záznam (syrové minimální data) + stisk Čitelnosti → žádný zápis ==');
  const mapB = await zalozMapu('Otisk');
  // starý tvar záznamu: uzly jen s title/status, zapsané rovnou do SQLite
  // (kontejner stojí, PocketBase DB zavřel) — API cesta by je kanonizovala
  await page.goto('about:blank'); // ať hlídač na pozadí nehází síťové chyby do konzole, když server stojí
  inst.pause();
  execSync(`docker run --rm -e RAW -e MID -v ${inst.volume}:/d python:3.12-slim python -c "import sqlite3,os; db=sqlite3.connect('/d/data.db'); db.execute('update goalmaps set nodes=? where id=?',(os.environ['RAW'],os.environ['MID'])); db.commit(); print('prepsanych radku:', db.total_changes)"`, {
    stdio: 'inherit', env: { ...process.env, RAW: JSON.stringify(uzly('O')), MID: mapB.id },
  });
  await inst.resume(); // ⚠️ nový port = nový origin — přihlášení v prohlížeči se musí zopakovat
  const B = await inst.login(EMAIL);
  const tvarDb = (await inst.api('GET', `/api/collections/goalmaps/records/${mapB.id}`, { token: B })).json;
  const klicuN1 = Object.keys(((tvarDb.nodes || []).find((n) => n.id === 'n1') || {}).data || {}).length;
  expect(klicuN1 === 2, `záznam v DB je OPRAVDU starý tvar — data[n1] má 2 klíče (${klicuN1})`);
  const predRazitko = tvarDb.updated;

  await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email');
  await page.type('#email', EMAIL);
  await page.type('#password', H.PW);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1000);

  const zapisy = [];
  const sleduj = (r) => { if (['PATCH', 'POST', 'PUT'].includes(r.method()) && r.url().includes('/goalmaps/records')) zapisy.push(r.method()); };
  page.on('request', sleduj); // počítá se UŽ OD NAČTENÍ — na mainu PATCH pošle i první dimensions po startu
  await page.goto(`${inst.base}/map/${mapB.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.react-flow__node[data-id="n2"]', { timeout: 45000 });
  await sleep(2500);
  const stupen = () => page.evaluate(() => [...document.querySelectorAll('[data-citelnost]')].find((x) => x.offsetParent)?.getAttribute('data-citelnost') || '');
  const stupenPred = await stupen();
  expect(await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-citelnost]')].find((x) => x.offsetParent);
    if (!b) return false; b.click(); return true;
  }), 'stisk Čitelnosti');
  await sleep(3500); // debounce autosave 1,2 s + rezerva
  page.off('request', sleduj);
  expect((await stupen()) !== stupenPred, `stupeň čitelnosti se OPRAVDU přepnul („${stupenPred}" → „${await stupen()}")`);
  expect(zapisy.length === 0, `od načtení po Čitelnost neodešel ŽÁDNÝ zápis do mapy (${zapisy.join(', ') || 'žádný'})`);
  const poRazitko = (await inst.api('GET', `/api/collections/goalmaps/records/${mapB.id}`, { token: B })).json.updated;
  expect(predRazitko === poRazitko, `razítko „naposledy upraveno" se nehnulo (${predRazitko === poRazitko ? 'beze změny' : predRazitko + ' → ' + poRazitko})`);

  expect(chyby.length === 0, `konzole bez chyb (${chyby.slice(0, 2).join(' | ') || 'čistá'})`);
}, { nazev: 'UI AUTOSAVE SERIALIZACE' });
