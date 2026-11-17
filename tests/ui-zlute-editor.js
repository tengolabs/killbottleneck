// UI e2e (headless Chrome): yellow findings of code analysis 4 — the map editor, the bell, My day, lite.
//
//   F1-05  a publicly shared map opens for a signed-in colleague it is not shared with (before: "Mapa nebyla nalezena")
//   F1-13  a failed load of a map (server error / no connection) says so and offers "Zkusit znovu"
//          (before: "Mapa nebyla nalezena" — the person thought the map was gone)
//   F1-12  the title and the description of a step carry the server's caps (500 / 10 000 characters)
//   F5-08  the bell: a failed load shows an error with "Zkusit znovu", not "Zatím žádné notifikace"
//   F3-09  My day says that the overview is shortened (lite did, the full app did not)
//   F4-08  lite on a locked instance says why nothing can be written
//
// The person's path: the real pages; failures and server flags are injected on the network.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

const SEF = 'sef@example.com';
const KOLEGA = 'kolega@example.com';

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-zlute-editor', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register(SEF, { name: 'Šéf' });
  await inst.register(KOLEGA, { name: 'Kolega' });
  const T = await inst.login(SEF);
  const verejna = await E.zalozMapu(inst, T, 'Veřejná mapa', { is_public: true });
  const soukroma = await E.zalozMapu(inst, T, 'Soukromá mapa');
  expect(!!verejna.id && verejna.is_public === true && !!soukroma.id, 'šéf má veřejnou a soukromou mapu');
  const cfg = (await inst.api('GET', '/api/kb/config')).json;

  const { browser } = await H.browser();
  const chyby = [];

  console.log('== F1-05: veřejnou mapu otevře i přihlášený kolega bez sdílení ==');
  const K = await E.clovek(browser, inst, KOLEGA, chyby);
  await K.page.goto(`${inst.base}/map/${verejna.id}`, { waitUntil: 'networkidle2' });
  const videl = !!(await K.page.waitForSelector('.react-flow__node[data-id="k1"]', { timeout: 20000 }).catch(() => null));
  const textK = await K.page.evaluate(() => document.body.innerText);
  expect(videl && !/Mapa nebyla nalezena/.test(textK), `kolega vidí kroky veřejné mapy (uzel ${videl}, „nenalezena“ ${/Mapa nebyla nalezena/.test(textK)})`);
  await K.page.goto(`${inst.base}/map/${soukroma.id}`, { waitUntil: 'networkidle2' });
  await K.page.waitForFunction(() => /Mapa nebyla nalezena/.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
  expect(/Mapa nebyla nalezena/.test(await K.page.evaluate(() => document.body.innerText)) && !(await K.page.$('[data-testid="map-load-error"]')), 'soukromá mapa zůstává „nenalezena“ (žádná chyba načtení)');
  await K.ctx.close();

  console.log('== F1-13: chyba při načtení mapy není „Mapa nebyla nalezena“ ==');
  const S = await E.clovek(browser, inst, SEF, chyby);
  const { page } = S;
  let rezim = { mapy: '', zvonek: '', myday: '', config: '' };
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (req.method() === 'GET') {
      if (rezim.mapy === 'chyba' && /\/api\/collections\/goalmaps\/records/.test(u)) return req.respond({ status: 500, contentType: 'application/json', body: '{"message":"Something went wrong."}' });
      if (rezim.zvonek === 'chyba' && /\/api\/collections\/notifications\/records/.test(u)) return req.respond({ status: 500, contentType: 'application/json', body: '{"message":"Something went wrong."}' });
      if (rezim.config && /\/api\/kb\/config(\?|$)/.test(u)) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(Object.assign({}, cfg, rezim.config)) });
    }
    return req.continue();
  });
  rezim.mapy = 'chyba';
  await page.goto(`${inst.base}/map/${soukroma.id}`, { waitUntil: 'networkidle2' });
  const maChybu = !!(await page.waitForSelector('[data-testid="map-load-error"]', { timeout: 15000 }).catch(() => null));
  const textS = await page.evaluate(() => document.body.innerText);
  expect(maChybu && /nepodařilo načíst/.test(textS) && !/Mapa nebyla nalezena/.test(textS), `při chybě serveru stránka říká „nepodařilo se načíst“, ne „nenalezena“ (${textS.replace(/\s+/g, ' ').slice(0, 90)})`);
  rezim.mapy = '';
  await page.click('[data-testid="map-load-retry"]').catch(() => {});
  expect(!!(await page.waitForSelector('.react-flow__node[data-id="k1"]', { timeout: 20000 }).catch(() => null)), '„Zkusit znovu“ mapu načte');

  console.log('== F1-12: název a popis kroku mají strop serveru ==');
  await sleep(1500);
  const otevreno = await S.otevriDialog('k1');
  const stropy = await page.evaluate(() => {
    const t = document.querySelector('[role="dialog"] #title');
    return { nazev: t ? t.maxLength : null };
  });
  expect(otevreno && stropy.nazev === 500, `pole názvu nepustí víc než 500 znaků (${JSON.stringify(stropy)})`);
  // the description opens for writing on an empty step — its textarea carries the cap too
  const popis = await page.evaluate(() => { const el = document.querySelector('[role="dialog"] textarea#description'); return el ? el.maxLength : null; });
  expect(popis === 10000, `pole popisu nepustí víc než 10 000 znaků (${popis})`);
  await page.keyboard.press('Escape');

  console.log('== F5-08: zvonek při chybě načtení neříká „žádné notifikace“ ==');
  rezim.zvonek = 'chyba';
  await page.goto(`${inst.base}/tasks`, { waitUntil: 'networkidle2' });
  const zvonek = await page.evaluateHandle(() => [...document.querySelectorAll('header button, button')].find((b) => b.querySelector('svg.lucide-bell')) || null);
  const zEl = zvonek.asElement();
  expect(!!zEl, 'zvonek je v hlavičce');
  if (zEl) {
    await zEl.click();
    const chybaZ = !!(await page.waitForSelector('[data-testid="bell-load-error"]', { timeout: 8000 }).catch(() => null));
    const textZ = await page.evaluate(() => (document.querySelector('[role="menu"]') || document.body).innerText);
    expect(chybaZ && !/Zatím žádné notifikace/.test(textZ), `zvonek ukáže chybu načtení místo prázdného stavu (${textZ.replace(/\s+/g, ' ').slice(0, 80)})`);
    rezim.zvonek = '';
    await page.click('[data-testid="bell-load-retry"]').catch(() => {});
    await page.waitForFunction(() => !document.querySelector('[data-testid="bell-load-error"]'), { timeout: 8000 }).catch(() => {});
    expect(!(await page.$('[data-testid="bell-load-error"]')), '„Zkusit znovu“ notifikace načte a chyba zmizí');
    await page.keyboard.press('Escape');
  }

  console.log('== F3-09: Můj den přizná zkrácený přehled ==');
  const S3 = await E.clovek(browser, inst, SEF, chyby);
  // the service worker fetches /my-day itself (offline copy) — requests made by it never reach the interception
  await S3.page.setBypassServiceWorker(true);
  await S3.page.setRequestInterception(true);
  let zkratit = true;
  const den = (await inst.api('GET', '/api/kb/my-day?today=' + new Date().toLocaleDateString('en-CA'), { token: T })).json;
  S3.page.on('request', (req) => {
    if (zkratit && req.method() === 'GET' && /\/api\/kb\/my-day(\?|$)/.test(req.url())) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(Object.assign({}, den, { truncated: true })) });
    return req.continue();
  });
  await S3.page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' }); // the panel is open on the home page (collapsed on /tasks)
  const zkraceno = !!(await S3.page.waitForSelector('[data-testid="myday-truncated"]', { timeout: 15000 }).catch(() => null));
  expect(zkraceno, 'panel Můj den říká, že přehled je zkrácený');
  zkratit = false;
  await S3.page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' }); // the panel is open on the home page (collapsed on /tasks)
  await sleep(1500);
  expect(!(await S3.page.$('[data-testid="myday-truncated"]')), 'úplný přehled žádný pruh nemá');
  await S3.ctx.close();

  console.log('== F4-08: lite na zamčené instanci řekne proč ==');
  for (const [nazev, priznak, veta] of [['po konci zkušební doby', { trial_until: '2020-01-01', trial_expired: true }, /Zkušební doba skončila/], ['po konci předplatného', { subscription_ended: true }, /Předplatné skončilo/]]) {
    const L = await E.clovek(browser, inst, SEF, chyby, { viewport: { width: 390, height: 844 } });
    await L.page.setRequestInterception(true);
    L.page.on('request', (req) => {
      if (req.method() === 'GET' && /\/api\/kb\/config(\?|$)/.test(req.url())) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(Object.assign({}, cfg, priznak)) });
      return req.continue();
    });
    await L.page.goto(`${inst.base}/lite`, { waitUntil: 'networkidle2' });
    await L.page.waitForSelector('[data-testid="lite-hlavicka"]', { timeout: 20000 }).catch(() => {});
    const pruh = await L.page.waitForSelector('[data-testid="lite-zamceno"]', { timeout: 8000 }).then((el) => el.evaluate((x) => x.innerText)).catch(() => '');
    expect(veta.test(pruh), `lite ${nazev}: pruh s vysvětlením (${pruh || 'žádný'})`);
    await L.ctx.close();
  }
  const L0 = await E.clovek(browser, inst, SEF, chyby, { viewport: { width: 390, height: 844 } });
  await L0.page.goto(`${inst.base}/lite`, { waitUntil: 'networkidle2' });
  await L0.page.waitForSelector('[data-testid="lite-hlavicka"]', { timeout: 20000 }).catch(() => {});
  await sleep(1000);
  expect(!!(await L0.page.$('[data-testid="lite-hlavicka"]')) && !(await L0.page.$('[data-testid="lite-zamceno"]')), 'lite na běžné instanci žádný pruh nemá');
  await L0.ctx.close();

  const vazne = chyby.filter((c) => !/Failed to load resource|ERR_FAILED|net::|500|EventSource|realtime|404|403/i.test(c));
  expect(vazne.length === 0, `konzole bez chyb mimo podvržené výpadky (${vazne.length}${vazne.length ? ': ' + vazne.slice(0, 2).join(' | ').slice(0, 200) : ''})`);
  await browser.close();
  inst.stop();
}, { nazev: 'UI-ZLUTE-EDITOR' });
