// A3 „Co se změnilo od minule" — záznamník změn projektu.
//
// Hlídá to, na čem tenhle bod stojí a co se nejsnáz rozbije:
//   • loguje se jen skutečný POHYB (stav/termín/řešitel), NE posun uzlu po plátně —
//     jinak by autosave editoru záznamník zaplavil a souhrn by byl nečitelný,
//   • souhrn míchá obě vrstvy: uzly (záměr) i úkoly (exekuce),
//   • okno se NEPOSOUVÁ tím, že se podíváš (jinak by druhé otevření ukázalo prázdno),
//   • VIDITELNOST: do cizí historie se nikdo nedostane.
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20516';
const NAME = 'flowmap-e2e-map-changes';
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
const titles = (list) => (list || []).map((i) => i.title);

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 20516:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    const me = await register('admin@e2e.cz');
    const cizi = await register('cizi@e2e.cz');

    const mapa = (await api('POST', '/api/collections/goalmaps/records', {
      token: me.token,
      body: {
        title: 'Projekt A3',
        nodes: [
          node('apex', { nodeType: 'apex', apexText: 'Projekt A3', title: 'Projekt A3', status: 'todo' }),
          node('n1', { title: 'Vybrat název', status: 'todo', owner: me.email, deadline: '2026-08-01' }, 0),
          node('n2', { title: 'Napsat ceník', status: 'todo' }, 200),
        ],
        edges: [{ id: 'e1', source: 'apex', target: 'n1' }, { id: 'e2', source: 'apex', target: 'n2' }],
      },
    })).json;

    console.log('== pohyb na uzlech se zapíše ==');
    await api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, {
      token: me.token,
      body: {
        nodes: [
          node('apex', { nodeType: 'apex', apexText: 'Projekt A3', title: 'Projekt A3', status: 'todo' }),
          node('n1', { title: 'Vybrat název', status: 'done', owner: me.email, deadline: '2026-08-05' }, 0),
          node('n2', { title: 'Napsat ceník', status: 'in_progress', owner: cizi.email }, 200),
          node('n3', { title: 'Natočit video', status: 'todo' }, 400),
        ],
        edges: [{ id: 'e1', source: 'apex', target: 'n1' }, { id: 'e2', source: 'apex', target: 'n2' }],
      },
    });
    let r = await api('GET', `/api/flowmap/map-changes?map=${mapa.id}&range=7`, { token: me.token });
    expect(r.status === 200, `endpoint odpovídá 200 (${r.status})`);
    expect(titles(r.json.groups.done).includes('Vybrat název'), `hotovo (${titles(r.json.groups.done)})`);
    expect(titles(r.json.groups.started).includes('Napsat ceník'), `rozjelo se (${titles(r.json.groups.started)})`);
    expect(titles(r.json.groups.added).includes('Natočit video'), `přibylo (${titles(r.json.groups.added)})`);
    const dl = (r.json.groups.deadline || [])[0];
    expect(dl && dl.from === '2026-08-01' && dl.to === '2026-08-05', `posun termínu i s hodnotami (${dl && dl.from}→${dl && dl.to})`);
    expect((r.json.groups.owner || []).some((i) => i.to === cizi.email), `změna řešitele (${titles(r.json.groups.owner)})`);
    expect((r.json.groups.done[0] || {}).actor === me.email, `u změny je autor (${(r.json.groups.done[0] || {}).actor})`);

    console.log('== JÁDRO: posun po plátně se NEloguje (jinak autosave zaplaví) ==');
    const pred = JSON.stringify(r.json.counts);
    await api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, {
      token: me.token,
      body: {
        nodes: [
          { ...node('apex', { nodeType: 'apex', apexText: 'Projekt A3', title: 'Projekt A3', status: 'todo' }), position: { x: 111, y: 222 } },
          { ...node('n1', { title: 'Vybrat název', status: 'done', owner: me.email, deadline: '2026-08-05' }), position: { x: 999, y: 888 } },
          { ...node('n2', { title: 'Napsat ceník', status: 'in_progress', owner: cizi.email }), position: { x: 5, y: 5 } },
          { ...node('n3', { title: 'Natočit video', status: 'todo' }), position: { x: 7, y: 7 } },
        ],
        edges: [{ id: 'e1', source: 'apex', target: 'n1' }, { id: 'e2', source: 'apex', target: 'n2' }],
      },
    });
    r = await api('GET', `/api/flowmap/map-changes?map=${mapa.id}&range=7`, { token: me.token });
    expect(JSON.stringify(r.json.counts) === pred, `po samotném přesunu uzlů žádný nový záznam (${pred} → ${JSON.stringify(r.json.counts)})`);

    console.log('== okno se neposouvá tím, že se podíváš ==');
    const znovu = await api('GET', `/api/flowmap/map-changes?map=${mapa.id}&range=7`, { token: me.token });
    expect(JSON.stringify(znovu.json.counts) === JSON.stringify(r.json.counts),
      'druhé otevření ukáže totéž, ne prázdno');

    console.log('== zbytkové položky: dokončení je v souhrnu vidět ==');
    // SLOVNÍK 17. 8. 2026: create je zakázán (položku sází superuser); vytvoření
    // se do „přírůstků" už neloguje (v reálu nenastane), ale odbavení zbytku ano.
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    const ukol = (await api('POST', '/api/collections/tasks/records', {
      token: ST, body: { title: 'Poslat nabídku', status: 'todo', map: mapa.id, node_id: 'n2', assignee_email: me.email, owner: me.id, owner_email: me.email },
    })).json;
    await api('PATCH', `/api/collections/tasks/records/${ukol.id}`, { token: me.token, body: { status: 'done' } });
    r = await api('GET', `/api/flowmap/map-changes?map=${mapa.id}&range=7`, { token: me.token });
    expect((r.json.groups.done || []).some((i) => i.kind === 'task' && i.title === 'Poslat nabídku'),
      'dokončená zbytková položka je mezi hotovými a je označena jako úkol');

    console.log('== smazaný uzel zůstane v historii čitelný ==');
    await api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, {
      token: me.token,
      body: {
        nodes: [
          node('apex', { nodeType: 'apex', apexText: 'Projekt A3', title: 'Projekt A3', status: 'todo' }),
          node('n1', { title: 'Vybrat název', status: 'done', owner: me.email, deadline: '2026-08-05' }),
        ],
        edges: [{ id: 'e1', source: 'apex', target: 'n1' }],
      },
    });
    r = await api('GET', `/api/flowmap/map-changes?map=${mapa.id}&range=7`, { token: me.token });
    expect(titles(r.json.groups.removed).includes('Napsat ceník'),
      `zmizelé položky nesou svůj název i po smazání (${titles(r.json.groups.removed)})`);

    console.log('== rozsahy 7 / 30 / vše ==');
    for (const range of ['7', '30', 'all']) {
      const x = await api('GET', `/api/flowmap/map-changes?map=${mapa.id}&range=${range}`, { token: me.token });
      expect(x.status === 200 && x.json.range === range, `rozsah ${range} funguje`);
    }
    const all = await api('GET', `/api/flowmap/map-changes?map=${mapa.id}&range=all`, { token: me.token });
    expect(all.json.since === '', '„vše" nemá dolní hranici');

    console.log('== viditelnost cizí historie ==');
    r = await api('GET', `/api/flowmap/map-changes?map=${mapa.id}&range=7`, { token: cizi.token });
    expect(r.status === 404, `cizí uživatel se do historie nedostane (${r.status})`);
    r = await api('GET', `/api/collections/map_changes/records?perPage=200`, { token: cizi.token });
    const cizich = ((r.json || {}).items || []).length;
    expect(cizich === 0, `ani přes přímý výpis kolekce (${cizich} záznamů)`);
    r = await api('GET', `/api/flowmap/map-changes?map=${mapa.id}&range=7`);
    expect(r.status === 401 || r.status === 403, `nepřihlášený dostane 401/403 (${r.status})`);

    console.log('== do historie se nedá psát ani ji přepsat ==');
    r = await api('POST', '/api/collections/map_changes/records', {
      token: me.token, body: { map: mapa.id, kind: 'node', item_id: 'x', field: 'status', to: 'done' },
    });
    expect(r.status === 400 || r.status === 403, `ruční zápis odmítnut (${r.status})`);
    const mine = await api('GET', '/api/collections/map_changes/records?perPage=1', { token: me.token });
    const rowId = (((mine.json || {}).items || [])[0] || {}).id;
    r = await api('PATCH', `/api/collections/map_changes/records/${rowId}`, { token: me.token, body: { to: 'podvrh' } });
    expect(r.status === 400 || r.status === 403 || r.status === 404, `úprava historie odmítnuta (${r.status})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
