// Soukromá mapa je soukromá i s ÚKOLY — ani admin, ani manažer je nevidí.
//
// Richard 6. 8. 2026: „počkej, jestli mám privátní mapu, tak ji nemá vidět
// nikdo jiný." Do té doby platilo, že vedení vidí úkoly všech (migrace
// 1751900007_team_roles.js). Mapa přitom soukromá byla — admin ji ve výpisu
// neviděl, ale její úkoly ano. Nesrovnalosti si nikdo nevšiml, dokud úvodní
// mapa nezačala každému účtu vyrábět šest až sedm úkolů.
//
// Hlídá se OBOJÍ: že se cizí soukromé úkoly schovají, a že vedení NEPŘIŠLO
// o dohled nad společnou prací (týmová mapa, sdílená mapa) — jinak by z opravy
// soukromí byla oprava, která rozbije práci týmu.
const { execSync } = require('child_process');

const PORT = 20584;
const BASE = `http://127.0.0.1:${PORT}`;
const NAME = 'kb-e2e-ukoly-soukromi';
const HESLO = 'TestHeslo.2026';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* prázdné tělo */ }
  return { status: res.status, json };
}

async function start() {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  // ⚠️ bez úvodní mapy: sada měří POČTY cizích úkolů, výchozí obsah by je posunul
  execSync(`docker run -d --name ${NAME} -e TZ=Europe/Prague -e KB_UVODNI_MAPA=0 -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`,
    { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch (e) { /* ještě ne */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('kontejner nenaskočil');
}

const zaloz = (email, role) => api('POST', '/api/collections/users/records', {
  body: { email, password: HESLO, passwordConfirm: HESLO, name: email.split('@')[0], role },
});
const prihlas = async (email) => (await api('POST', '/api/collections/users/auth-with-password',
  { body: { identity: email, password: HESLO } })).json?.token;

async function main() {
  try {
    await start();
    await zaloz('sef@firma.cz', 'admin');
    await zaloz('vedouci@firma.cz', 'manager');
    await zaloz('clen@firma.cz', 'user');
    const admin = await prihlas('sef@firma.cz');
    const manazer = await prihlas('vedouci@firma.cz');
    const clen = await prihlas('clen@firma.cz');

    console.log('== člen má soukromou mapu s úkolem ==');
    // úkol musí mít konkrétní ne-vrcholový uzel (13. 8.) — mapy dostávají apex + krok
    const uzly = (nazev) => ({ nodes: [
      { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: nazev, title: nazev, status: 'todo' } },
      { id: 'krok', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Krok', status: 'todo' } },
    ], edges: [{ id: 'e1', source: 'apex', target: 'krok' }] });
    const mapa = (await api('POST', '/api/collections/goalmaps/records', {
      token: clen, body: { title: 'Moje soukromá', ...uzly('Moje soukromá') } })).json;
    const ukol = (await api('POST', '/api/collections/tasks/records', {
      token: clen, body: { title: 'TAJNY-UKOL', map: mapa.id, node_id: 'krok', status: 'todo' } })).json;
    expect(!!ukol?.id, 'úkol vznikl');

    console.log('== nevidí ho ani admin, ani manažer ==');
    for (const [kdo, tok] of [['admin', admin], ['manažer', manazer]]) {
      const seznam = (await api('GET', '/api/collections/tasks/records?perPage=100', { token: tok })).json;
      const nazvy = (seznam?.items || []).map((u) => u.title);
      expect(!nazvy.includes('TAJNY-UKOL'), `${kdo} cizí soukromý úkol ve výpisu NEMÁ (${nazvy.length} úkolů)`);
      const primo = await api('GET', `/api/collections/tasks/records/${ukol.id}`, { token: tok });
      expect(primo.status === 404, `${kdo} ho nedostane ani přímo přes id (${primo.status})`);
    }

    console.log('== ale mapu člena taky nevidí (kontrola, že se ptáme správně) ==');
    // Kdyby admin mapu viděl, byl by test bezcenný — úkoly by se schovaly
    // „náhodou". Tohle drží celý předpoklad.
    const mapyAdmina = (await api('GET', '/api/collections/goalmaps/records', { token: admin })).json;
    expect(!(mapyAdmina?.items || []).some((m) => m.id === mapa.id), 'admin nevidí ani tu mapu');

    console.log('== dohled nad SPOLEČNOU prací zůstal ==');
    // Oprava soukromí nesmí rozbít práci týmu: na týmové mapě vedení úkoly
    // vidět MUSÍ, jinak by z toho byla jiná vada.
    const tymova = (await api('POST', '/api/collections/goalmaps/records', {
      token: clen, body: { title: 'Týmová', ...uzly('Týmová') } })).json;
    await api('POST', '/api/kb/share', {
      token: clen, body: { action: 'set_team_access', mapId: tymova.id, access: 'read' } });
    await api('POST', '/api/collections/tasks/records', {
      token: clen, body: { title: 'TYMOVY-UKOL', map: tymova.id, node_id: 'krok', status: 'todo' } });
    for (const [kdo, tok] of [['admin', admin], ['manažer', manazer]]) {
      const nazvy = ((await api('GET', '/api/collections/tasks/records?perPage=100', { token: tok })).json?.items || [])
        .map((u) => u.title);
      expect(nazvy.includes('TYMOVY-UKOL'), `${kdo} úkol na TÝMOVÉ mapě vidí dál (${nazvy.join(', ') || 'nic'})`);
    }

    console.log('== a na SDÍLENÉ mapě taky ==');
    const sdilena = (await api('POST', '/api/collections/goalmaps/records', {
      token: clen, body: { title: 'Sdílená s šéfem', ...uzly('Sdílená s šéfem') } })).json;
    await api('POST', '/api/kb/share', {
      token: clen, body: { action: 'share', mapId: sdilena.id, email: 'sef@firma.cz', canEdit: false } });
    await api('POST', '/api/collections/tasks/records', {
      token: clen, body: { title: 'SDILENY-UKOL', map: sdilena.id, node_id: 'krok', status: 'todo' } });
    const nazvyA = ((await api('GET', '/api/collections/tasks/records?perPage=100', { token: admin })).json?.items || [])
      .map((u) => u.title);
    expect(nazvyA.includes('SDILENY-UKOL'), `komu je mapa nasdílená, ten úkol vidí (${nazvyA.join(', ')})`);
    expect(!nazvyA.includes('TAJNY-UKOL'), 'a soukromý pořád ne');

    console.log('== vlastník vidí všechno svoje ==');
    const svoje = ((await api('GET', '/api/collections/tasks/records?perPage=100', { token: clen })).json?.items || [])
      .map((u) => u.title);
    expect(svoje.includes('TAJNY-UKOL') && svoje.includes('TYMOVY-UKOL'),
      `člen o nic nepřišel (${svoje.join(', ')})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }

  console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main();
