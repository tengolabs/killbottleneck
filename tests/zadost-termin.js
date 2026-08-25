// ŽÁDOST O ZMĚNU TERMÍNU (Richard 7. 8. 2026): řešitel termín měnit nesmí,
// ale navrhne nový (datum + důvod) → notifikace zadavateli → schválení =
// zadavatel termín prostě změní (satisfyDeadlineRequests), zamítnutí =
// explicitní akce routy /deadline-requests. Razítko žadatele drží server.
//
// Mutační pojistky: podvržené razítko v přímém PATCHi se přerazítkuje,
// dedup drží jednu notifikaci na uzel/hodinu, public-maps nic neleakuje,
// a povolené cesty (žádost, schválení, zamítnutí, stažení) MUSÍ projít.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-zadost-termin';
const PORT = 20549;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'TajneHeslo.2026';
const VLASTNIK = 'vlastnik@e2e.cz';
const RESITEL = 'resitel@e2e.cz';
const EDITOR = 'editor@e2e.cz';
const CTENAR = 'ctenar@e2e.cz'; // sdíleno KE ČTENÍ, garant uzlu n2
const TERMIN = '2026-08-20';
const NAVRH = '2026-09-15';

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
const notifsOf = async (token, type) =>
  ((await api('GET', '/api/collections/notifications/records?perPage=100', { token })).json?.items || [])
    .filter((n) => n.type === type);
// stejný typ + uzel se do 10 min slévá do jednoho řádku (count) — počítat součet
const notifCount = async (token, type) => (await notifsOf(token, type)).reduce((a, n) => a + (n.count || 1), 0);

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch (e) { /* startuje */ } await sleep(1000); }

    await reg(VLASTNIK); await reg(RESITEL); await reg(EDITOR); await reg(CTENAR);
    const V = await login(VLASTNIK), W = await login(RESITEL), E = await login(EDITOR), C = await login(CTENAR);

    const mapa = await api('POST', '/api/collections/goalmaps/records', {
      token: V,
      body: {
        title: 'Vyjednávání',
        nodes: [
          { id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'PROJEKT', title: 'PROJEKT', status: 'todo' } },
          { id: 'n1', type: 'goalNode', position: { x: 300, y: 380 }, data: { title: 'Termínovaný krok', status: 'todo', deadline: TERMIN, owner: RESITEL } },
          { id: 'n2', type: 'goalNode', position: { x: 620, y: 380 }, data: { title: 'Krok čtenáře', status: 'todo', deadline: TERMIN, owner: CTENAR } },
        ],
        edges: [{ id: 'e1', source: 'apex', target: 'n1' }, { id: 'e2', source: 'apex', target: 'n2' }],
      },
    });
    const mapId = mapa.json?.id;
    expect(mapa.status === 200 && !!mapId, `mapa založena (${mapa.status})`);
    await api('POST', '/api/kb/share', { token: V, body: { action: 'share', mapId, email: RESITEL, permission: 'work' } });
    await api('POST', '/api/kb/share', { token: V, body: { action: 'share', mapId, email: EDITOR, permission: 'edit' } });
    await api('POST', '/api/kb/share', { token: V, body: { action: 'share', mapId, email: CTENAR, permission: 'read' } });

    const n1 = async (token) => ((await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token })).json?.nodes || []).find((n) => n.id === 'n1');

    console.log('== žádost řešitele + notifikace zadavateli ==');
    let r = await api('POST', '/api/kb/deadline-requests', { token: W, body: { action: 'request', mapId, nodeId: 'n1', date: NAVRH, note: 'Čekám na podklady' } });
    expect(r.status === 200, `žádost odeslána (${r.status})`);
    let node = await n1(V);
    expect(node?.data?.deadlineChangeWanted === NAVRH && node?.data?.deadlineChangeRequestedBy === RESITEL,
      `uzel nese žádost s razítkem žadatele (${node?.data?.deadlineChangeRequestedBy})`);
    expect(node?.data?.deadline === TERMIN, 'samotný termín se žádostí NEZMĚNIL');
    let ntf = await notifsOf(V, 'deadline_request');
    expect(ntf.length === 1 && (ntf[0].text || '').includes(NAVRH), `zadavatel dostal 1 notifikaci s datem (${ntf.length})`);
    r = await api('POST', '/api/kb/deadline-requests', { token: W, body: { action: 'request', mapId, nodeId: 'n1', date: '2026-09-16', note: 'jiný návrh' } });
    ntf = await notifsOf(V, 'deadline_request');
    expect(ntf.length === 1, `dedup: opakovaná žádost v téže hodině nespamuje (${ntf.length})`);

    r = await api('POST', '/api/kb/deadline-requests', { token: E, body: { action: 'request', mapId, nodeId: 'n1', date: '2026-12-24' } });
    expect(r.status === 409, `cizí běžící žádost nejde přepsat routou (${r.status})`);

    console.log('== podvržené razítko v přímém PATCHi se přerazítkuje ==');
    const mapState = (await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: E })).json;
    const forged = (mapState.nodes || []).map((n) => (n.id === 'n1'
      ? { ...n, data: { ...n.data, deadlineChangeWanted: '2026-10-01', deadlineChangeNote: 'podvrh', deadlineChangeRequestedBy: 'obet@e2e.cz' } }
      : n));
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token: E, body: { nodes: forged, edges: mapState.edges } });
    expect(r.status === 200, `editor smí žádost upravit PATCHem (${r.status})`);
    node = await n1(V);
    expect(node?.data?.deadlineChangeRequestedBy === RESITEL,
      `běžící žádost drží PŮVODNÍHO žadatele, podvrh neprošel (${node?.data?.deadlineChangeRequestedBy})`);

    console.log('== zamítnutí: jen zadavatel/vlastník ==');
    r = await api('POST', '/api/kb/deadline-requests', { token: W, body: { action: 'decline', mapId, nodeId: 'n1' } });
    expect(r.status === 403, `řešitel sám nezamítne (${r.status})`);
    r = await api('POST', '/api/kb/deadline-requests', { token: E, body: { action: 'decline', mapId, nodeId: 'n1' } });
    expect(r.status === 403, `editor (ne-zadavatel) nezamítne (${r.status})`);
    r = await api('POST', '/api/kb/deadline-requests', { token: V, body: { action: 'decline', mapId, nodeId: 'n1' } });
    expect(r.status === 200, `zadavatel zamítne (${r.status})`);
    node = await n1(V);
    expect(!node?.data?.deadlineChangeWanted && !node?.data?.deadlineChangeRequestedBy, 'žádost je po zamítnutí pryč');
    let res = await notifsOf(W, 'deadline_request_resolved');
    expect(res.length === 1, `žadatel dostal zamítnutí (${res.length})`);

    console.log('== schválení = zadavatel změní termín (kteroukoli cestou) ==');
    r = await api('POST', '/api/kb/deadline-requests', { token: W, body: { action: 'request', mapId, nodeId: 'n1', date: NAVRH } });
    expect(r.status === 200, `nová žádost (${r.status})`);
    const st = (await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: V })).json;
    const approved = (st.nodes || []).map((n) => (n.id === 'n1' ? { ...n, data: { ...n.data, deadline: NAVRH } } : n));
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token: V, body: { nodes: approved, edges: st.edges } });
    expect(r.status === 200, `zadavatel uložil nový termín (${r.status})`);
    node = await n1(V);
    expect(node?.data?.deadline === NAVRH && !node?.data?.deadlineChangeWanted, 'termín změněn a žádost uzavřena');
    const cResolved = await notifCount(W, 'deadline_request_resolved');
    expect(cResolved === 2, `žadateli přišlo schválení (slévá se se zamítnutím do count; ${cResolved})`);

    console.log('== stažení žádosti žadatelem ==');
    r = await api('POST', '/api/kb/deadline-requests', { token: W, body: { action: 'request', mapId, nodeId: 'n1', date: '2026-10-20' } });
    r = await api('POST', '/api/kb/deadline-requests', { token: E, body: { action: 'cancel', mapId, nodeId: 'n1' } });
    expect(r.status === 403, `cizí člověk žádost nestáhne (${r.status})`);
    r = await api('POST', '/api/kb/deadline-requests', { token: W, body: { action: 'cancel', mapId, nodeId: 'n1' } });
    expect(r.status === 200, `žadatel žádost stáhne (${r.status})`);
    expect((await notifCount(W, 'deadline_request_resolved')) === 2, 'stažení negeneruje další notifikaci');

    console.log('== ČTENÁŘ žádá jen u SVÉHO kroku (právo z práce, 21. 8. 2026) ==');
    // Kdo práci dostal, musí umět říct, že termín nestíhá — i s právem jen ke
    // čtení. Cizí uzly čtenáři dál nežádají (spam argument trvá). Mutační
    // pojistka: na buildu před změnou vrací žádost čtenáře 403.
    r = await api('POST', '/api/kb/deadline-requests', { token: C, body: { action: 'request', mapId, nodeId: 'n2', date: NAVRH, note: 'Nestíhám' } });
    expect(r.status === 200, `čtenář-garant požádá o termín u SVÉHO kroku (${r.status} ${r.json?.error || ''})`);
    let n2 = ((await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: V })).json?.nodes || []).find((n) => n.id === 'n2');
    expect(n2?.data?.deadlineChangeWanted === NAVRH && n2?.data?.deadlineChangeRequestedBy === CTENAR,
      `uzel nese žádost s razítkem čtenáře (${n2?.data?.deadlineChangeRequestedBy})`);
    expect(n2?.data?.deadline === TERMIN, 'samotný termín se čtenářovou žádostí NEZMĚNIL');
    r = await api('POST', '/api/kb/deadline-requests', { token: C, body: { action: 'cancel', mapId, nodeId: 'n2' } });
    expect(r.status === 200, `čtenář svou žádost stáhne (${r.status})`);
    r = await api('POST', '/api/kb/deadline-requests', { token: C, body: { action: 'request', mapId, nodeId: 'n1', date: NAVRH } });
    expect(r.status === 403, `u CIZÍHO kroku čtenář nežádá (${r.status})`);

    console.log('== public-maps neleakuje žádost ==');
    await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token: V, body: { is_public: true } });
    await api('POST', '/api/kb/deadline-requests', { token: W, body: { action: 'request', mapId, nodeId: 'n1', date: '2026-11-01', note: 'soukromý důvod' } });
    r = await api('POST', '/api/kb/public-maps', { body: { mapId } });
    const pub = JSON.stringify(r.json || {});
    expect(r.status === 200 && !pub.includes('deadlineChange') && !pub.includes('soukromý důvod') && !pub.includes('@e2e.cz'),
      'veřejný DTO bez žádosti, důvodu i e-mailů');

    console.log('== UI: tlačítko žádosti u řešitele, panel u zadavatele ==');
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const dialogText = async (email) => {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1600, height: 950 });
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('#email');
      await page.type('#email', email);
      await page.type('#password', PW);
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
      await sleep(1500);
      await page.goto(`${BASE}/map/${mapId}`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('.react-flow__node', { timeout: 15000 });
      await sleep(2000);
      const badge = await page.evaluate(() => document.body.innerText.includes('Žádost o termín'));
      await page.evaluate(() => {
        const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes('Termínovaný krok'));
        const tuzka = [...(n?.querySelectorAll('button') || [])].find((b) => b.querySelector('.lucide-pencil'));
        if (tuzka) tuzka.click();
        else n?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      });
      await sleep(1200);
      // editor mapy má od 14. 8. 2026 VELKÉ okno s kategoriemi — žádost o termín
      // je v kategorii „Zadání" (work sdílení má zjednodušené okno bez kategorií)
      await page.evaluate(() => document.querySelector('[role="dialog"] [data-cat="assignment"]')?.click());
      await sleep(600);
      const txt = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || '');
      await ctx.close();
      return { badge, txt };
    };
    const stV = await dialogText(VLASTNIK);
    expect(stV.badge, 'uzel nese badge otevřené žádosti');
    expect(stV.txt.includes('navrhuje termín') && stV.txt.includes('Schválit') && stV.txt.includes('Zamítnout'),
      'zadavatel vidí panel žádosti se Schválit/Zamítnout');
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
