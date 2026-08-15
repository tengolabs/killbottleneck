// Termínová upozornění: denní souhrn na uzly i úkoly ve třech kbelících
// (po termínu / dnes / zítra), agregovaně jednou zprávou na kbelík a den.
//
// Kontejner běží v TZ=Europe/Prague — „dnešek" se počítá LOKÁLNĚ (fmtDateLocal),
// ne v UTC, jinak by se v Praze mezi 22:00 a půlnocí posílal „zítřejší" dnešek.
// Idempotenci drží partial UNIQUE index nad notifications.dedup_key, takže ani
// opakované (force) spuštění nesmí poslat nic navíc.
const { execSync } = require('child_process');

const NAME = 'flowmap-e2e-deadlines';
const PORT = 20510;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';
const SU = { email: 'su@example.com', pw: 'superheslo123' };

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, p, { token, body } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;

// pražský dnešek + posun (musí sedět na fmtDateLocal v kontejneru s TZ=Europe/Prague)
const pragueDate = (offset = 0) => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e TZ=Europe/Prague -e KB_UVODNI_MAPA=0 -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert ${SU.email} ${SU.pw}`, { stdio: 'ignore' });

    await reg('a@example.com');
    await reg('b@example.com');
    const A = await login('a@example.com');
    const B = await login('b@example.com');
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: SU.email, password: SU.pw } })).json.token;

    const OLD = pragueDate(-3), TODAY = pragueDate(0), TOM = pragueDate(1), FAR = pragueDate(10);

    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Termíny',
      nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'C', title: 'C', status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 1 }, data: { title: 'Prošlý', status: 'todo', owner: 'b@example.com', deadline: OLD } },
        { id: 'n2', type: 'goalNode', position: { x: 0, y: 2 }, data: { title: 'Dnes', status: 'todo', owner: 'b@example.com', deadline: TODAY } },
        { id: 'n3', type: 'goalNode', position: { x: 0, y: 3 }, data: { title: 'Zítra', status: 'todo', owner: 'b@example.com', deadline: TOM } },
        { id: 'n4', type: 'goalNode', position: { x: 0, y: 4 }, data: { title: 'Daleko', status: 'todo', owner: 'b@example.com', deadline: FAR } },
        { id: 'n5', type: 'goalNode', position: { x: 0, y: 5 }, data: { title: 'Hotový', status: 'done', owner: 'b@example.com', deadline: OLD } },
        // neutrální uzel pro úkoly (bez garanta a termínu, ať sám nic nehlásí)
        // — úkol musí viset na konkrétním NE-vrcholovém uzlu
        { id: 'tn', type: 'goalNode', position: { x: 0, y: 6 }, data: { title: 'Zázemí úkolů', status: 'todo' } },
      ],
      edges: [1, 2, 3, 4, 5].map((i) => ({ id: `e${i}`, source: 'root', target: `n${i}` })).concat([{ id: 'etn', source: 'root', target: 'tn' }]),
    } })).json;

    // úkol po termínu patří do stejného kbelíku jako prošlý uzel → jedna zpráva
    await api('POST', '/api/collections/tasks/records', { token: A, body: {
      title: 'Prošlý úkol', status: 'todo', deadline: OLD, assignee_email: 'b@example.com', map: map.id, node_id: 'tn',
    } });
    // hotový úkol se nepočítá
    await api('POST', '/api/collections/tasks/records', { token: A, body: {
      title: 'Hotový úkol', status: 'done', deadline: OLD, assignee_email: 'b@example.com', map: map.id, node_id: 'tn',
    } });

    // archivovaný projekt se nepřipomíná (archiv = hotovo)
    const arch = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Archiv',
      nodes: [
        { id: 'r', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'C', title: 'C', status: 'todo' } },
        { id: 'z', type: 'goalNode', position: { x: 0, y: 1 }, data: { title: 'V archivu', status: 'todo', owner: 'b@example.com', deadline: OLD } },
      ],
      edges: [{ id: 'ez', source: 'r', target: 'z' }],
    } })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${arch.id}`, { token: A, body: { archived: true } });

    const deadlineNotifs = async (token) => (await api(
      'GET', `/api/collections/notifications/records?perPage=50&sort=created&filter=${encodeURIComponent('type="deadline"')}`, { token }
    )).json;

    console.log('== souhrn ve třech kbelících ==');
    let r = await api('POST', '/api/flowmap/run-deadline-notices', { token: ST });
    expect(r.status === 200, `superuser routa dostupná (${r.status})`);
    const n1 = await deadlineNotifs(B);
    expect(n1.totalItems === 3, `tři kbelíky = tři zprávy (${n1.totalItems})`);
    const texts = n1.items.map((x) => x.text).join(' | ');
    n1.items.forEach((x) => console.log(`     • ${x.text}`));
    expect(/2 položky/.test(texts), 'kbelík „po termínu" sloučil uzel i úkol do 2 položek');
    expect(new RegExp(OLD).test(texts), 'zpráva nese nejstarší prošlý termín');
    expect(!/Daleko|V archivu|Hotov/.test(texts), 'vzdálený termín, archiv ani hotové položky se nepřipomínají');

    console.log('== idempotence ==');
    r = await api('POST', '/api/flowmap/run-deadline-notices', { token: ST });
    expect(r.json?.sent === 0, `druhé (force) spuštění nepošle nic (sent=${r.json?.sent})`);
    expect((await deadlineNotifs(B)).totalItems === 3, 'počet zpráv se nezměnil');

    console.log('== „kdy to chci řešit" upozornění umlčí, propadlé NE ==');
    // Nález Richarda z ostrého provozu 8. 8. 2026: „pořád máme sumáře, kde bude,
    // že je dnes po termínu nebo zítra, i když se ho rozhodnu řešit za týden."
    // Připomínat člověku něco, co si právě vědomě odložil, ho učí notifikace
    // ignorovat. Propadlý termín se ale hlásí DÁL — termín je dohoda s někým
    // jiným a zpoždění se schovat nesmí.
    // Dvojice C/D je vestavěná kontrola: stejné termíny, jen C má plán. Kdyby
    // ticho u C způsobilo cokoli jiného než plán, D by mlčel taky.
    await reg('c@example.com');
    await reg('d@example.com');
    const C = await login('c@example.com');
    const D = await login('d@example.com');
    const PRISTE = pragueDate(7);
    const mapCD = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Plánovaná práce',
      nodes: [
        { id: 'r', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'P', title: 'P', status: 'todo' } },
        // uzel má plán pod `plannedOn` — druhá cesta do notifikací než úkol
        { id: 'cu', type: 'goalNode', position: { x: 0, y: 1 }, data: { title: 'Uzel dnes s plánem', status: 'todo', owner: 'c@example.com', deadline: TODAY, plannedOn: PRISTE } },
        { id: 'du', type: 'goalNode', position: { x: 0, y: 2 }, data: { title: 'Uzel dnes bez plánu', status: 'todo', owner: 'd@example.com', deadline: TODAY } },
        // neutrální uzel pro úkoly — bez garanta a termínu sám nic nehlásí
        { id: 'tu', type: 'goalNode', position: { x: 0, y: 3 }, data: { title: 'Zázemí úkolů', status: 'todo' } },
      ],
      edges: [{ id: 'ec', source: 'r', target: 'cu' }, { id: 'ed', source: 'r', target: 'du' }, { id: 'et', source: 'r', target: 'tu' }],
    } })).json;
    for (const [email, planned] of [['c@example.com', PRISTE], ['d@example.com', '']]) {
      await api('POST', '/api/collections/tasks/records', { token: A, body: {
        title: 'Zítřejší úkol', status: 'todo', deadline: TOM, assignee_email: email, map: mapCD.id, node_id: 'tu', planned_on: planned,
      } });
      await api('POST', '/api/collections/tasks/records', { token: A, body: {
        title: 'Propadlý úkol', status: 'todo', deadline: OLD, assignee_email: email, map: mapCD.id, node_id: 'tu', planned_on: planned,
      } });
    }
    r = await api('POST', '/api/flowmap/run-deadline-notices', { token: ST });
    expect(r.status === 200, `běh proběhl (${r.status})`);
    const nC = await deadlineNotifs(C);
    const textC = nC.items.map((x) => x.text).join(' | ');
    nC.items.forEach((x) => console.log(`     • C: ${x.text}`));
    expect(nC.totalItems === 1, `s plánem na příští týden zbyla jediná zpráva (${nC.totalItems})`);
    expect(new RegExp(OLD).test(textC), 'a je to ta o PROPADLÉM termínu — zpoždění se schovat nesmí');
    const nD = await deadlineNotifs(D);
    nD.items.forEach((x) => console.log(`     • D: ${x.text}`));
    expect(nD.totalItems === 3, `bez plánu chodí všechny tři kbelíky (${nD.totalItems}) — rozdíl dělá vážně plán`);

    console.log('== plán dál než týden upozornění NEumlčí ==');
    // Musí to držet stejnou hranici jako zařazování v přehledu (bucketFor: plán
    // posouvá jen do týdne). Plán na za měsíc položku v přehledu NEPOSUNE, takže
    // by bylo nekonzistentní, aby kvůli němu zmlklo upozornění: přehled by ji
    // ukazoval na zítra a upozornění by nepřišlo. Z lišty se takový plán nedá
    // nastavit (nejpozději nejbližší pondělí), přes API/MCP ano.
    await reg('e@example.com');
    const E = await login('e@example.com');
    await api('POST', '/api/collections/tasks/records', { token: A, body: {
      title: 'Zítřejší s plánem na měsíc', status: 'todo', deadline: TOM,
      assignee_email: 'e@example.com', map: mapCD.id, node_id: 'tu', planned_on: pragueDate(30),
    } });
    r = await api('POST', '/api/flowmap/run-deadline-notices', { token: ST });
    const nE = await deadlineNotifs(E);
    nE.items.forEach((x) => console.log(`     • E: ${x.text}`));
    expect(nE.totalItems === 1 && /zítra/.test(nE.items.map((x) => x.text).join(' ')),
      `upozornění na zítřejší termín přišlo (${nE.totalItems}: ${nE.items.map((x) => x.text).join(' | ')})`);

    console.log('== komu to nechodí ==');
    expect((await deadlineNotifs(A)).totalItems === 0, 'vlastníkovi mapy bez vlastních termínů nic nechodí');
    r = await api('POST', '/api/flowmap/run-deadline-notices', { token: A });
    expect(r.status === 404, `běžný uživatel routu nevidí (${r.status})`);
  } catch (err) {
    fail++;
    console.log('  ❌ výjimka: ' + (err && err.stack ? err.stack : err));
  } finally {
    try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch { /* už je pryč */ }
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} DEADLINE NOTICES PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
