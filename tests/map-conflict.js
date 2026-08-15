// B3: detekce konfliktu při zápisu mapy. base_updated v těle → když nesedí s aktuálním
// updated, 409; jinak 200. Sekvenční save jednoho klienta (autosave) NIKDY nesmí hodit
// falešný konflikt. Bez base_updated = zpětně kompatibilní (200). Čerstvý kontejner :20501.
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20501';
const NAME = 'flowmap-e2e-conflict';
const PW = 'testheslo123';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 20501:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }
    await api('POST', '/api/collections/users/records', { body: { email: 'a@x.cz', password: PW, passwordConfirm: PW } });
    const T = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@x.cz', password: PW } })).json.token;

    const node = (t) => ({ id: 'n1', type: 'goalNode', position: { x: 0, y: 0 }, data: { title: t } });
    const m = (await api('POST', '/api/collections/goalmaps/records', { token: T, body: { title: 'M', nodes: [node('a')], edges: [] } })).json;
    const patch = (base, title) => api('PATCH', `/api/collections/goalmaps/records/${m.id}`, {
      token: T, body: { nodes: [node(title)], ...(base !== undefined ? { base_updated: base } : {}) },
    });

    console.log('== base_updated přijato + konflikt jen mezi klienty ==');
    let r = await patch(m.updated, 'b');
    expect(r.status === 200, `PB base_updated v těle přijme, update projde (${r.status})`);
    const v2 = r.json.updated;
    expect(v2 && v2 !== m.updated, 'updated se po save posunul');

    // stará verze (jiný klient, který neví o v2) → 409
    r = await patch(m.updated, 'c');
    expect(r.status === 409, `stará base_updated → 409 (${r.status})`);

    // čerstvá verze → 200
    r = await patch(v2, 'd');
    expect(r.status === 200, `čerstvá base_updated → 200 (${r.status})`);
    const v3 = r.json.updated;

    console.log('== sekvenční autosave jednoho klienta = 0 falešných konfliktů ==');
    let cur = v3, ok = true;
    for (let i = 0; i < 6; i++) {
      const rr = await patch(cur, `iter${i}`);
      if (rr.status !== 200) { ok = false; break; }
      cur = rr.json.updated; // klient převezme novou verzi (jako frontend)
      await sleep(50);
    }
    expect(ok, '6 rychlých po sobě jdoucích saveů s převzatou verzí = vždy 200');

    console.log('== zpětná kompatibilita ==');
    r = await patch(undefined, 'x');
    expect(r.status === 200, `update BEZ base_updated projde (share/rekurence nedotčeny) (${r.status})`);
    // prázdné base_updated se také ignoruje
    r = await patch('', 'y');
    expect(r.status === 200, `prázdné base_updated ignorováno (${r.status})`);
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', e.message.slice(0, 160));
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
