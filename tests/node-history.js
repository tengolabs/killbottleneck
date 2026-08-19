// ŽIVOTOPIS CÍLE — /api/kb/node-history.
//
// Hlídá to, na čem funkce stojí a co se nejsnáz rozbije:
//   • ČAS, ne jen datum (Richard 19. 8. 2026: „potřebuji tam ne jen datumy, ale i časy"),
//   • nová pole ve `field` SELECTu se OPRAVDU zapíšou — bez migrace by řádek
//     TIŠE ZMIZEL (logMapChanges polyká chyby záměrně), a nikdo by si nevšiml,
//   • komentáře a přílohy se berou z jejich kolekcí, takže historie platí i ZPĚTNĚ,
//   • VIDITELNOST: veřejná mapa životopis NEVYDÁ (historie není součást
//     veřejné prezentace projektu — nález panelu 27. 7. 2026).
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20520';
const NAME = 'flowmap-e2e-node-history';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdná odpověď */ }
  return { status: res.status, json };
};

const register = async (email) => {
  await api('POST', '/api/collections/users/records', { body: { email, password: 'testheslo123', passwordConfirm: 'testheslo123' } });
  const r = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: 'testheslo123' } });
  return { token: r.json.token, id: r.json.record.id, email };
};

const node = (id, data, x = 0) => ({ id, type: id === 'apex' ? 'apexNode' : 'goalNode', position: { x, y: 300 }, data });
const poli = (h, f) => (h.items || []).filter((i) => i.field === f);

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 20520:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    const me = await register('admin@e2e.cz');
    const cizi = await register('cizi@e2e.cz');

    const nodes = [
      node('apex', { apexText: 'Projekt' }),
      node('c1', { title: 'Napsat ceník', status: 'todo' }, 200),
    ];
    const edges = [{ id: 'e1', source: 'apex', target: 'c1', type: 'deletable' }];
    const mapa = (await api('POST', '/api/collections/goalmaps/records', {
      token: me.token, body: { title: 'Životopis', owner: me.id, owner_email: me.email, nodes, edges },
    })).json;

    const uloz = (ns) => api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, { token: me.token, body: { nodes: ns, edges } });
    const zivotopis = (token, nodeId = 'c1') =>
      api('GET', `/api/kb/node-history?map=${mapa.id}&node=${nodeId}`, { token });

    console.log('== JÁDRO: nová pole se opravdu zapíšou (bez migrace by tiše zmizela) ==');
    // stav + zadání + ikona + barva najednou
    await uloz([nodes[0], node('c1', {
      title: 'Napsat ceník', status: 'in_progress',
      description: 'Nové zadání', icon: '📌', color: '#3b82f6',
    }, 200)]);
    await sleep(300);
    let h = (await zivotopis(me.token)).json;
    expect(poli(h, 'status').length === 1, 'změna stavu je v životopisu');
    expect(poli(h, 'description').length === 1, 'změna zadání je v životopisu (nové pole SELECTu)');
    expect(poli(h, 'icon').length === 1, 'změna ikony je v životopisu (nové pole SELECTu)');
    expect(poli(h, 'color').length === 1, 'změna barvy je v životopisu (nové pole SELECTu)');
    // obsah zadání se do historie NEDÁVÁ — jinak by z ní byla druhá kopie dat.
    // ?? kvůli tomu, aby jeden výpadek nezhasl celý zbytek sady: bez migrace
    // řádek chybí a `[0].from` by shodilo běh dřív, než doběhnou kontroly
    // viditelnosti (ověřeno mutací 19. 8. 2026 — sada tehdy skončila výjimkou).
    const zad = poli(h, 'description')[0];
    expect(!!zad && zad.from === '' && zad.to === '',
      'u zadání se loguje jen TO, ŽE se změnilo, ne jeho obsah');

    console.log('== čas, ne jen datum ==');
    const cas = ((h.items || [])[0] || {}).when || '';
    expect(/\d{4}-\d{2}-\d{2}/.test(cas) && /\d{2}:\d{2}:\d{2}/.test(cas), `razítko nese i čas (${cas})`);

    console.log('== vykonavatel: dvě pole, JEDEN řádek ==');
    await uloz([nodes[0], node('c1', {
      title: 'Napsat ceník', status: 'in_progress', description: 'Nové zadání', icon: '📌', color: '#3b82f6',
      executorKind: 'ai', executorName: 'Hermes',
    }, 200)]);
    await sleep(300);
    h = (await zivotopis(me.token)).json;
    expect(poli(h, 'executor').length === 1, 'přepnutí vykonavatele je JEDEN řádek, ne dva');

    console.log('== komentáře a přílohy platí ZPĚTNĚ (čtou se z kolekcí) ==');
    await api('POST', '/api/collections/comments/records', {
      token: me.token, body: { goalmap: mapa.id, node_id: 'c1', text: 'Tohle je poznámka k ceníku' },
    });
    await sleep(300);
    h = (await zivotopis(me.token)).json;
    const kom = (h.items || []).filter((i) => i.kind === 'comment');
    expect(kom.length === 1, 'komentář je v životopisu');
    expect(!!kom[0] && kom[0].actor === me.email, 'u komentáře je autor');
    // ⚠️ JÁDRO SOUKROMÍ (Richard 19. 8. 2026): text komentáře se do životopisu
    // NEPOSÍLÁ — ani zkrácený. Životopis říká jen „kdo kdy sáhl na co"; text
    // patří tam, kam ho autor psal. Kontrola jede na CELÉ odpovědi, ne na jednom
    // poli — jinak by ji obešlo pouhé přejmenování klíče.
    expect(JSON.stringify(h).indexOf('Tohle je poznámka') === -1,
      'text komentáře v odpovědi NENÍ (ani jako náhled)');
    expect(!Object.prototype.hasOwnProperty.call(kom[0] || {}, 'nahled'),
      'položka komentáře nemá pole s textem');

    console.log('== cizí uzel se nemíchá dovnitř ==');
    const jiny = (await zivotopis(me.token, 'apex')).json;
    expect((jiny.items || []).every((i) => i.kind !== 'comment'), 'komentář u c1 se neobjeví u vrcholu');

    console.log('== JÁDRO: zásah pravidla se přizná jako PRAVIDLO, ne jako člověk ==');
    // Kvůli tomuhle pole `via` vzniklo. Bez kontroly by mohlo nikam netéct,
    // všechny sady by zůstaly zelené a historie by tiše tvrdila, že u cíle
    // klikal autor pravidla. Pravidlo se zakládá SESSION ROUTOU — stejnou
    // cestou jako builder v UI, ne přímým zápisem do kolekce.
    const pravidlo = (await api('POST', '/api/kb/rules/save', {
      token: me.token,
      body: {
        map: mapa.id, name: 'Po dokončení předej', enabled: true,
        trigger: { type: 'node_status_changed', status: 'done' },
        conditions: [], actions: [{ type: 'set_owner', owner: cizi.email }],
      },
    })).json;
    expect(!!(pravidlo && pravidlo.rule && pravidlo.rule.id), 'pravidlo prošlo validací routy');

    // odbavit cíl → pravidlo přepíše řešitele
    const mR = (await api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: me.token })).json;
    for (const n of mR.nodes) if (n.id === 'c1') n.data.status = 'done';
    await api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, { token: me.token, body: { nodes: mR.nodes, edges: mR.edges } });
    await sleep(800);

    const hp = (await zivotopis(me.token)).json;
    const odPravidla = (hp.items || []).filter((i) => i.via && i.via.indexOf('rule:') === 0);
    expect(odPravidla.length > 0, `zásah pravidla je v životopisu označený (via=${(odPravidla[0] || {}).via || 'CHYBÍ'})`);
    expect(odPravidla.some((i) => i.field === 'owner'), 'a je to právě ta změna řešitele, kterou pravidlo udělalo');
    // protikontrola: člověkem udělané změny `via` NEMAJÍ, jinak by test prošel
    // i tehdy, kdyby se `via` sypalo do všeho
    const odCloveka = (hp.items || []).filter((i) => i.kind === 'change' && i.field === 'status' && !i.via);
    expect(odCloveka.length > 0, 'změny udělané člověkem zůstávají bez via');

    console.log('== VIDITELNOST ==');
    expect((await zivotopis(cizi.token)).status === 404, 'cizí uživatel se do životopisu nedostane (404)');
    expect((await api('GET', `/api/kb/node-history?map=${mapa.id}&node=c1`)).status === 401, 'nepřihlášený dostane 401');

    // veřejná mapa: stav ANO, historie NE
    await api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, { token: me.token, body: { is_public: true } });
    await sleep(200);
    expect((await zivotopis(cizi.token)).status === 404, 'ani u VEŘEJNÉ mapy životopis cizímu účtu nepatří');

    console.log('== chybějící parametry ==');
    expect((await api('GET', `/api/kb/node-history?map=${mapa.id}`, { token: me.token })).status === 400, 'bez uzlu 400');
    expect((await api('GET', '/api/kb/node-history?map=neexistuje&node=c1', { token: me.token })).status === 404, 'neznámá mapa 404');
  } catch (err) {
    fail++; console.log('  ❌ výjimka:', err.message);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
