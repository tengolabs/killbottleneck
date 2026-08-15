// Notifikace: nové spouštěče (přiřazení uzlu v UŽ EXISTUJÍCÍ mapě, sdílení,
// komentář u uzlu), uživatelské preference (vynucené na SERVERU uvnitř notify),
// hromadné označení přečtených jedním dotazem a dedup přes UNIQUE index.
//
// Největší z opravovaných děr: dřív se node_assigned posílalo JEN při zakládání
// mapy — přiřazení kolegovi v otevřeném editoru neposlalo nic.
const { execSync } = require('child_process');

const NAME = 'flowmap-e2e-notifications';
const PORT = 20509;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

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
const notifs = async (token, type) => (await api(
  'GET',
  `/api/collections/notifications/records?perPage=50&sort=-created${type ? `&filter=${encodeURIComponent(`type="${type}"`)}` : ''}`,
  { token }
)).json;

const nodesWith = (ownerN1) => ([
  { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Cíl', title: 'Cíl', status: 'todo' } },
  { id: 'n1', type: 'goalNode', position: { x: 0, y: 100 }, data: { title: 'První krok', status: 'todo', owner: ownerN1, deadline: '2026-09-01' } },
]);
const EDGES = [{ id: 'e1', source: 'root', target: 'n1' }];

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    const rA = await reg('a@example.com');
    const rB = await reg('b@example.com');
    const A = await login('a@example.com');
    const B = await login('b@example.com');

    console.log('== přiřazení uzlu v UŽ EXISTUJÍCÍ mapě ==');
    const map = (await api('POST', '/api/collections/goalmaps/records', {
      token: A, body: { title: 'Projekt X', nodes: nodesWith(''), edges: EDGES },
    })).json;
    expect((await notifs(B)).totalItems === 0, 'po založení mapy bez přiřazení nikomu nic nechodí');

    await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, {
      token: A, body: { nodes: nodesWith('b@example.com'), edges: EDGES },
    });
    let n = await notifs(B, 'node_assigned');
    expect(n.totalItems === 1, `přiřazení v existující mapě → node_assigned (${n.totalItems})`);
    expect(/2026-09-01/.test(n.items[0]?.text || ''), 'souhrn nese nejbližší termín');

    // autosave beze změny garanta nesmí notifikovat znovu
    await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, {
      token: A,
      body: { nodes: nodesWith('b@example.com').map((x) => (x.id === 'n1' ? { ...x, data: { ...x.data, title: 'Jiný název' } } : x)), edges: EDGES },
    });
    expect((await notifs(B, 'node_assigned')).totalItems === 1, 'autosave beze změny garanta nedubluje');

    console.log('== komentář u uzlu mapy ==');
    const c = await api('POST', '/api/collections/comments/records', {
      token: A, body: { goalmap: map.id, node_id: 'n1', text: 'Co s tím?' },
    });
    n = await notifs(B, 'node_comment');
    expect(c.status === 200 && n.totalItems === 1, `komentář u uzlu → node_comment (${n.totalItems})`);

    console.log('== sdílení projektu ==');
    const s = await api('POST', '/api/flowmap/share', {
      token: A, body: { action: 'share', mapId: map.id, email: 'b@example.com' },
    });
    n = await notifs(B, 'map_shared');
    expect(s.status === 200 && n.totalItems === 1, `sdílení → map_shared (${n.totalItems})`);

    console.log('== uživatelské preference (vynucené serverem) ==');
    let r = await api('PATCH', `/api/collections/users/records/${rB.json.id}`, {
      token: B, body: { notify_prefs: { node_assigned: { in_app: false, email: false }, NEZNAMY: { in_app: true }, deadline: 'nesmysl' } },
    });
    expect(r.status === 200 && !!r.json.notify_prefs.node_assigned && r.json.notify_prefs.NEZNAMY === undefined
      && r.json.notify_prefs.deadline === undefined,
    'sanitizace: známý typ projde, neznámý klíč i nesmyslná hodnota se zahodí');

    const map2 = (await api('POST', '/api/collections/goalmaps/records', {
      token: A, body: { title: 'Projekt Y', nodes: nodesWith(''), edges: EDGES },
    })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${map2.id}`, {
      token: A, body: { nodes: nodesWith('b@example.com'), edges: EDGES },
    });
    expect((await notifs(B, 'node_assigned')).totalItems === 1, 'vypnutý typ notifikaci NEVYTVOŘÍ');
    const beforeShare = (await notifs(B, 'map_shared')).totalItems;
    await api('POST', '/api/flowmap/share', { token: A, body: { action: 'share', mapId: map2.id, email: 'b@example.com' } });
    expect((await notifs(B, 'map_shared')).totalItems === beforeShare + 1, 'ostatní typy chodí dál');

    console.log('== hromadné označení přečtených ==');
    const unread = async (token) => (await api('GET', `/api/collections/notifications/records?perPage=1&filter=${encodeURIComponent('read=false')}`, { token })).json.totalItems;
    const before = await unread(B);
    expect(before > 0, `B má nepřečtené (${before})`);
    r = await api('POST', '/api/flowmap/notifications/read-all', { token: B });
    expect(r.status === 200 && (await unread(B)) === 0, `read-all vynulovalo nepřečtené (${before}→${await unread(B)})`);
    r = await api('POST', '/api/flowmap/notifications/read-all', {});
    expect(r.status === 401 || r.status === 403, `read-all bez přihlášení odmítnuto (${r.status})`);

    console.log('== RLS: cizí notifikace ==');
    const all = await notifs(A);
    expect(all.items.every((x) => x.user === rA.json.id), 'A vidí jen svoje notifikace');
    r = await api('POST', '/api/collections/notifications/records', {
      token: A, body: { user: rB.json.id, type: 'task_assigned', text: 'podvrh' },
    });
    expect(r.status === 400 || r.status === 403, `klient notifikaci nezaloží (${r.status})`);
  } catch (err) {
    fail++;
    console.log('  ❌ výjimka: ' + (err && err.stack ? err.stack : err));
  } finally {
    try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch { /* už je pryč */ }
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} NOTIFICATIONS PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
