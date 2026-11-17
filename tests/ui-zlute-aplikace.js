// UI e2e (headless Chrome): yellow findings of code analysis 4 on the app side.
//
//   F3-07  timeline: the bar of a task includes the day of its deadline (before: it ended the day before)
//   F3-08  calendar: quick stats count tasks only — an event is neither a deadline nor "to do"
//   F3-09  calendar: a list of events cut by the server says so (before: the flag was thrown away)
//   F5-08  calendar: a failed load of events shows an error with "Zkusit znovu", not an empty calendar
//   F5-07  a failed FIRST config request no longer hides the assistant until a manual reload
//   F5-03  a server answer opened as a navigation (/api/…) does not replace the offline shell of the app
//
// Not measured here: F5-04 (reload after the live connection comes back) — a headless browser going
// "offline" keeps the open event stream alive, so the suite cannot make the connection drop.
//
// The person's path: the real pages, a click on "Zkusit znovu"; failures are injected on the network.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

const SEF = 'sef@example.com';
const dnes = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.toLocaleDateString('en-CA'); };
const uzel = (id, title, data = {}) => ({ id, type: 'goalNode', position: { x: 0, y: 260 }, data: { title, status: 'todo', ...data } });

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-zlute-aplikace', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register(SEF, { name: 'Šéf' });
  const T = await inst.login(SEF);
  const nodes = [uzel('u1', 'DNES-OTEVRENY', { owner: SEF, deadline: dnes() }), uzel('u2', 'DNES-HOTOVY', { owner: SEF, deadline: dnes(), status: 'done' })];
  const mapa = (await inst.api('POST', '/api/collections/goalmaps/records', { token: T, body: {
    title: 'Projekt Žluté', nodes: [{ id: 'root', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', title: 'Projekt Žluté', apexText: 'Projekt Žluté', status: 'todo' } }, ...nodes],
    edges: nodes.map((n) => ({ id: `e-${n.id}`, source: 'root', target: n.id })),
  } })).json;
  expect(!!mapa.id, 'projekt se dvěma kroky s termínem dnes založen');
  let r = await inst.api('POST', '/api/kb/events/save', { token: T, body: { title: 'UDALOST-DNES', day: dnes(), time: '10:00' } });
  expect(r.status === 200, `událost na dnešek založena (${r.status})`);

  const { browser } = await H.browser();
  const chyby = [];
  const S = await E.clovek(browser, inst, SEF, chyby);
  const { page } = S;

  // network switchboard: what GET /api/kb/events answers ('' = the real server)
  let udalostiRezim = '';
  let udalostiCteni = 0;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (req.method() === 'GET' && /\/api\/kb\/events(\?|$)/.test(u)) {
      udalostiCteni += 1;
      if (udalostiRezim === 'chyba') return req.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Chyba serveru.' }) });
      if (udalostiRezim === 'zkraceno') return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [], truncated: true }) });
    }
    return req.continue();
  });

  console.log('== F3-08: rychlý přehled kalendáře počítá jen úkoly ==');
  await page.goto(`${inst.base}/kalendar`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.gcal-wrapper', { timeout: 20000 });
  await page.waitForFunction(() => /UDALOST-DNES/.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
  expect(/UDALOST-DNES/.test(await page.evaluate(() => document.body.innerText)), 'událost je v kalendáři vidět');
  const prehled = await page.evaluate(() => ({
    celkem: (document.querySelector('.gcal-metrics-body .gcal-metric-num') || {}).textContent,
    procenta: ((document.querySelector('.gcal-progress-header') || {}).textContent || '').match(/(\d+)\s*%/)?.[1],
  }));
  expect(prehled.celkem === '2', `„termínů celkem“ = 2 kroky, událost se nepočítá (${prehled.celkem})`);
  expect(prehled.procenta === '50', `splněno 50 % (1 ze 2 kroků), událost výsledek neředí (${prehled.procenta} %)`);
  expect(!(await page.$('[data-testid="calendar-load-error"]')) && !(await page.$('[data-testid="calendar-truncated"]')), 'bez chyby a bez zkrácení žádný pruh navíc');

  console.log('== F3-09: zkrácený seznam událostí se přizná ==');
  udalostiRezim = 'zkraceno';
  await page.evaluate(() => window.dispatchEvent(new Event('kb-udalosti-changed')));
  expect(!!(await page.waitForSelector('[data-testid="calendar-truncated"]', { timeout: 8000 }).catch(() => null)), 'kalendář řekne, že neukazuje všechny události');

  console.log('== F5-08: nepovedené načtení událostí = hláška se „Zkusit znovu“ ==');
  udalostiRezim = 'chyba';
  await page.evaluate(() => window.dispatchEvent(new Event('kb-udalosti-changed')));
  expect(!!(await page.waitForSelector('[data-testid="calendar-load-error"]', { timeout: 8000 }).catch(() => null)), 'chyba načtení je vidět');
  expect(/nepodařilo načíst/.test(await page.$eval('[data-testid="calendar-load-error"]', (el) => el.innerText).catch(() => '')), 'hláška je česky');
  udalostiRezim = '';
  await page.click('[data-testid="calendar-load-retry"]').catch(() => {});
  await page.waitForFunction(() => !document.querySelector('[data-testid="calendar-load-error"]') && /UDALOST-DNES/.test(document.body.innerText), { timeout: 10000 }).catch(() => {});
  expect(!(await page.$('[data-testid="calendar-load-error"]')) && /UDALOST-DNES/.test(await page.evaluate(() => document.body.innerText)), '„Zkusit znovu“ kalendář načte a hláška zmizí');

  console.log('== F3-07: pruh na časové ose zahrnuje den termínu ==');
  await page.goto(`${inst.base}/tasks`, { waitUntil: 'networkidle2' });
  for (const h of await page.$$('[role="tab"]')) {
    if ((await page.evaluate((el) => (el.textContent || '').trim(), h)) === 'Časová osa') { await h.click(); break; }
  }
  const pruh = `[data-testid="osa-pruh-node-${mapa.id}-node-item-${mapa.id}-u1"]`;
  await page.waitForSelector(pruh, { timeout: 15000 }).catch(() => {});
  const osa = await page.$eval(pruh, (el) => ({ od: el.getAttribute('data-od'), dni: el.getAttribute('data-dni') })).catch(() => null);
  const pred3 = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - 3); return d.toLocaleDateString('en-CA'); })();
  expect(!!osa && osa.od === pred3 && osa.dni === '4', `krok s termínem dnes: pruh od ${pred3} přes 4 dny včetně dneška (${JSON.stringify(osa)})`);

  console.log('== F5-03: odpověď serveru otevřená jako stránka nepřepíše offline podobu aplikace ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  const swBezi = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((res) => setTimeout(() => res(false), 15000))])).catch(() => false);
  if (!swBezi) H.preskoceno('service worker v tomhle prohlížeči neběží — F5-03 se neměřilo');
  else {
    await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' }); // now under the worker's control
    await page.goto(`${inst.base}/api/health`, { waitUntil: 'networkidle2' }).catch(() => {});
    // read the cache right here, on the JSON answer — the next visit of the app would repair the shell
    const skorapka = await page.evaluate(async () => { const hit = await caches.match('/'); return hit ? { typ: hit.headers.get('content-type') || '', html: /<div id="root"/.test(await hit.text()) } : null; });
    expect(!!skorapka && /text\/html/.test(skorapka.typ) && skorapka.html, `pod „/“ je dál stránka aplikace, ne odpověď /api/health (${JSON.stringify(skorapka)})`);
    await page.goto(`${inst.base}/kalendar`, { waitUntil: 'networkidle2' });
  }

  console.log('== F5-07: selhání PRVNÍHO načtení nastavení neschová asistenta natrvalo ==');
  const maAsistenta = !!(await page.$('[data-testid="chat-toggle"]'));
  if (!maAsistenta) H.preskoceno('tlačítko asistenta na téhle instanci není ani při běžném načtení — F5-07 se neměřilo');
  else {
    const S2 = await E.clovek(browser, inst, SEF, null);
    let configPokusu = 0;
    let start = Date.now();
    await S2.page.setRequestInterception(true);
    S2.page.on('request', (req) => {
      // every config request of the first 6 s fails (the page asks from several places at once)
      if (/\/api\/kb\/config(\?|$)/.test(req.url())) { configPokusu += 1; if (Date.now() - start < 6000) return req.abort('failed'); }
      return req.continue();
    });
    start = Date.now();
    await S2.page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
    expect(configPokusu >= 1 && Date.now() - start < 6000 && !(await S2.page.$('[data-testid="chat-toggle"]')), `po selhání prvního dotazu asistent zatím vidět není (dotazů ${configPokusu})`);
    const objevilSe = !!(await S2.page.waitForSelector('[data-testid="chat-toggle"]', { timeout: 40000 }).catch(() => null));
    expect(objevilSe, `asistent se do 40 s objeví sám, bez obnovení stránky (dotazů na nastavení ${configPokusu})`);
    await S2.ctx.close();
  }

  console.log('== poznámka „(auto-stop po 12 h)“ se anglickému uživateli ukáže anglicky ==');
  {
    await inst.register('en-stopky@example.com', { name: 'Ann', language: 'en' });
    const su = await inst.superuser();
    const An = await E.clovek(browser, inst, 'en-stopky@example.com', null);
    const z = await inst.api('POST', '/api/collections/time_entries/records', { token: An.token, body: { started: new Date(Date.now() - 13 * 3600000).toISOString(), ended: '', label: 'Forgotten timer', note: 'Client call' } });
    await inst.api('POST', '/api/kb/run-auto-stop', { token: (su && su.token) || su });
    const ulozeno = (await inst.api('GET', `/api/collections/time_entries/records/${z.json.id}`, { token: An.token })).json.note || '';
    expect(/\(auto-stop po 12 h\)/.test(ulozeno), `v datech zůstává značka, podle které server záznam pozná („${ulozeno}“)`);
    await An.page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
    await An.page.evaluate(() => window.dispatchEvent(new CustomEvent('kb-time-fix', { detail: { entryId: '' } })));
    await An.page.waitForSelector('[data-testid="time-entry-note"]', { timeout: 15000 }).catch(() => null);
    const videt = await An.page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="time-entry-note"]')).map((e) => e.innerText).join(' | '));
    expect(/Client call \(stopped automatically after 12 h\)/.test(videt) && !/auto-stop po/.test(videt), `v přehledu času čte anglicky („${videt}“)`);
    await An.ctx.close();
  }

  const vazne = chyby.filter((c) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_FAILED|net::|500|EventSource|realtime/i.test(c));
  expect(vazne.length === 0, `konzole bez chyb mimo podvržené výpadky (${vazne.length}${vazne.length ? ': ' + vazne.slice(0, 2).join(' | ').slice(0, 200) : ''})`);
  await browser.close();
  inst.stop();
}, { nazev: 'UI-ZLUTE-APLIKACE' });
