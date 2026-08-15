// Termín ÚKOLOVÉHO ZÁZNAMU smí měnit jen zadavatel (tasks.owner) nebo vlastník
// projektu — pokračování Richardova nálezu 7. 8. 2026 (u uzlů opraveno dřív,
// tasks měly stejnou díru ve všech vrstvách: RLS pouští řešitele i editory na
// všechna pole, hook ani v1 routa termín nehlídaly).
//
// Navíc hlídá dvě opravené regrese createRule (migrace 1786100000):
// multi-match při 2+ sdílených a chybějící team_access="edit" větev,
// a nové logování smazání úkolu do map_changes.
// Mutační pojistky: povolené cesty MUSÍ projít (první nastavení řešitelem,
// změna zadavatelem, status řešitelem, založení úkolu editorem/týmem).
const { execSync } = require('child_process');

const NAME = 'kb-e2e-tasks-termin';
const PORT = 20546;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'TajneHeslo.2026';
const ZADAVATEL = 'zadavatel@e2e.cz';
const RESITEL = 'resitel@e2e.cz';
const KOLEGA = 'kolega@e2e.cz';
const TYMAK = 'tymak@e2e.cz';
const TERMIN = '2026-08-15';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { token, bearer, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch (e) { /* prázdné tělo */ }
  return { status: res.status, json };
}
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch (e) { /* startuje */ } await sleep(1000); }

    await reg(ZADAVATEL); await reg(RESITEL); await reg(KOLEGA); await reg(TYMAK);
    const Z = await login(ZADAVATEL), R = await login(RESITEL), K = await login(KOLEGA), T = await login(TYMAK);

    // mapa se DVĚMA sdílenými s právem editace (multi-match past) — vlastník = zadavatel
    const mapa = await api('POST', '/api/collections/goalmaps/records', {
      token: Z,
      body: {
        title: 'Termíny úkolů',
        shared_with: [RESITEL, KOLEGA], shared_with_edit: [RESITEL, KOLEGA],
        nodes: [
          { id: 'apex', type: 'apexNode', position: { x: 300, y: 0 },
            data: { nodeType: 'apex', apexText: 'PROJEKT', title: 'PROJEKT', status: 'todo' } },
          { id: 'n1', type: 'goalNode', position: { x: 300, y: 380 },
            data: { title: 'Krok', status: 'todo' } },
        ],
        edges: [{ id: 'e1', source: 'apex', target: 'n1' }],
      },
    });
    const mapId = mapa.json?.id;
    expect(mapa.status === 200 && !!mapId, `mapa založena (${mapa.status})`);

    const ukol = await api('POST', '/api/collections/tasks/records', {
      token: Z, body: { title: 'Zadaný úkol', status: 'todo', map: mapId, node_id: 'n1', assignee_email: RESITEL, deadline: TERMIN },
    });
    const taskId = ukol.json?.id;
    expect(ukol.status === 200 && !!taskId, `zadavatel založil úkol s termínem (${ukol.status})`);

    console.log('== řešitel/editor NESMÍ změnit ani smazat existující termín ==');
    let r = await api('PATCH', `/api/collections/tasks/records/${taskId}`, { token: R, body: { deadline: '2026-12-31' } });
    expect(r.status === 400, `řešitel: změna termínu odmítnuta (${r.status})`);
    expect(JSON.stringify(r.json || {}).includes('zadavatel'), 'chyba vysvětluje, že termín mění jen zadavatel');
    r = await api('PATCH', `/api/collections/tasks/records/${taskId}`, { token: R, body: { deadline: '' } });
    expect(r.status === 400, `řešitel: smazání termínu odmítnuto (${r.status})`);
    r = await api('PATCH', `/api/collections/tasks/records/${taskId}`, { token: K, body: { deadline: '2026-12-31' } });
    expect(r.status === 400, `edit-share kolega: změna termínu odmítnuta (${r.status})`);
    r = await api('GET', `/api/collections/tasks/records/${taskId}`, { token: Z });
    expect(r.json?.deadline === TERMIN, `termín v DB nedotčen (${r.json?.deadline})`);

    console.log('== mutační pojistky: povolené cesty projít MUSÍ ==');
    r = await api('PATCH', `/api/collections/tasks/records/${taskId}`, { token: R, body: { status: 'done' } });
    expect(r.status === 200, `řešitel smí označit hotovo (${r.status})`);
    r = await api('PATCH', `/api/collections/tasks/records/${taskId}`, { token: Z, body: { deadline: '2026-08-20' } });
    expect(r.status === 200, `zadavatel termín změní (${r.status})`);
    const bezTerminu = await api('POST', '/api/collections/tasks/records', {
      token: Z, body: { title: 'Bez termínu', status: 'todo', map: mapId, node_id: 'n1', assignee_email: RESITEL },
    });
    r = await api('PATCH', `/api/collections/tasks/records/${bezTerminu.json.id}`, { token: R, body: { deadline: '2026-09-01' } });
    expect(r.status === 200, `první nastavení termínu řešitelem projde (${r.status})`);

    console.log('== v1 API: stejné pravidlo (hooky se u $app.save nespouští) ==');
    const rKey = (await api('POST', '/api/flowmap/api-keys', { token: R, body: { label: 'rw', scope: 'read_write' } })).json.token;
    const zKey = (await api('POST', '/api/flowmap/api-keys', { token: Z, body: { label: 'rw', scope: 'read_write' } })).json.token;
    r = await api('POST', `/api/flowmap/v1/tasks/${taskId}`, { bearer: rKey, body: { deadline: '2026-12-31' } });
    expect(r.status === 400, `v1: řešitel změnu termínu neprosadí (${r.status})`);
    r = await api('POST', `/api/flowmap/v1/tasks/${taskId}`, { bearer: rKey, body: { status: 'todo' } });
    expect(r.status === 200, `v1: řešitel smí měnit status (${r.status})`);
    r = await api('POST', `/api/flowmap/v1/tasks/${taskId}`, { bearer: zKey, body: { deadline: '2026-08-25' } });
    expect(r.status === 200, `v1: zadavatel termín změní (${r.status})`);

    console.log('== regrese createRule: 2+ sdílených + team_access ==');
    r = await api('POST', '/api/collections/tasks/records', {
      token: K, body: { title: 'Úkol od kolegy', status: 'todo', map: mapId, node_id: 'n1' },
    });
    expect(r.status === 200, `edit-share založí úkol i na mapě se 2 sdílenými (${r.status})`);
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token: Z, body: { team_access: 'edit' } });
    expect(r.status === 200, `vlastník zapnul team_access=edit (${r.status})`);
    r = await api('POST', '/api/collections/tasks/records', {
      token: T, body: { title: 'Úkol od týmáka', status: 'todo', map: mapId, node_id: 'n1' },
    });
    expect(r.status === 200, `člen týmu (team_access=edit) založí úkol (${r.status})`);

    console.log('== mazání: řešitel ne, zadavatel ano + stopa v záznamníku ==');
    r = await api('DELETE', `/api/collections/tasks/records/${taskId}`, { token: R });
    expect(r.status === 404 || r.status === 403, `řešitel úkol nesmaže (${r.status})`);
    r = await api('DELETE', `/api/collections/tasks/records/${taskId}`, { token: Z });
    expect(r.status === 204, `zadavatel úkol smaže (${r.status})`);
    r = await api('GET', `/api/flowmap/map-changes?map=${mapId}&range=7`, { token: Z });
    const removed = (r.json?.groups?.removed || []).filter((x) => x.kind === 'task' && x.title === 'Zadaný úkol');
    expect(removed.length === 1 && removed[0].actor === ZADAVATEL, `smazání úkolu zalogováno v „Co se změnilo" (${removed.length})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
