// AUDIT VLNA 0 + vlna 1 — zamyká bezpečnostní opravy (audit 8. a 14. 10. 2026, checkup 2. 11. 2026):
//  B2-01: nepřihlášený host NESMÍ číst ani listovat cizí události (events).
//         (main to má od v0.9x migracemi 1792080000/1792090000 — tady jen regresní zámek.)
//  B1-1:  přihlašovací endpoint MÁ serverovou brzdu, když KB_RATE_LIMITS != 0 (*:auth 20 pokusů / 60 s na IP;
//         Richard 2. 11. 2026 — PB výchozí 2/3 s brzdilo tým za NATem).
//  B1-2:  bez KB_TRUSTED_PROXY_HEADER se hlavičce klienta NEVĚŘÍ (podvržená X-Forwarded-For
//         nevytvoří nový kbelík); s KB_TRUSTED_PROXY_HEADER=X-Forwarded-For se počítá IP z ní.
//  S6:    po odeslání komentáře nejde přes PATCH změnit autora, e-mail autora, mapu ani uzel.
//  S7a:   vlastní změna hesla zruší API klíče. S7b: reset přes e-mail (confirm-password-reset) taky.
//  S13:   do kolekce `uploads` už přihlášený uživatel nenahraje (createRule null).
// Mutační důkaz na obrazu v0.94 (kb-app:20261029): B1-1, B1-2 (druhá část), S6, S7a, S7b, S13 padají.
const H = require('./_harness');
const { expect } = H;

const den = (posun) => {
  const d = new Date(); d.setDate(d.getDate() + posun);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// quoted-printable → text (soft konce řádků `=\n`, `=XX`), kvůli tokenu v těle mailu
const qp = (raw) => raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
const spatne = (inst, headers) => inst.api('POST', '/api/collections/users/auth-with-password',
  { body: { identity: 'nikdo@e2e.cz', password: 'spatne' }, headers });

H.beh(async () => {
  // ---------- B2-01: guard čtení událostí ----------
  console.log('== B2-01: anonym nečte cizí události ==');
  const inst = await H.startInstance({ slug: 'audit-events', env: { KB_UVODNI_MAPA: 0 } });
  await inst.superuser();
  await inst.register('owner@e2e.cz');
  const OW = await inst.login('owner@e2e.cz');
  let r = await inst.api('POST', '/api/kb/events/save', { token: OW, body: { title: 'Zubař tajne', day: den(3) } });
  expect(r.status === 200, `vlastník založí událost (${r.status} ${r.json && r.json.error || ''})`);
  const eid = r.json.id || (r.json.event && r.json.event.id);
  expect(!!eid, 'událost má id');
  r = await inst.api('GET', '/api/collections/events/records?perPage=50');
  expect(r.status === 200 && (r.json.totalItems === 0), `anon list událostí = 0 položek (${r.status}/${r.json && r.json.totalItems})`);
  r = await inst.api('GET', `/api/collections/events/records/${eid}`);
  expect(r.status !== 200, `anon view události NENÍ 200 (${r.status})`);
  r = await inst.api('GET', '/api/collections/events/records?perPage=50', { token: OW });
  expect(r.status === 200 && r.json.totalItems === 1, `vlastník vidí svou událost (${r.status}/${r.json && r.json.totalItems})`);
  r = await inst.api('GET', `/api/collections/events/records/${eid}`, { token: OW });
  expect(r.status === 200, `vlastník view 200 (${r.status})`);
  await inst.stop();

  // ---------- B1-1 + B1-2a: brzda přihlášení, hlavičce klienta se nevěří ----------
  console.log('== B1-1: přihlášení má brzdu (KB_RATE_LIMITS=1) ==');
  const inst2 = await H.startInstance({ slug: 'audit-brzda', env: { KB_UVODNI_MAPA: 0, KB_RATE_LIMITS: 1 } });
  const kody = [];
  for (let i = 0; i < 23; i++) kody.push((await spatne(inst2)).status);
  console.log('   kódy:', kody.join(' '));
  expect(kody.slice(0, 20).every((k) => k === 400), `prvních 20 pokusů projde k ověření (400) — kancelář za NATem se přihlásí (${kody.slice(0, 20).join(' ')})`);
  expect(kody.slice(20).every((k) => k === 429), `21.–23. pokus dostane 429 (${kody.slice(20).join(' ')})`);
  console.log('== B1-2a: bez KB_TRUSTED_PROXY_HEADER podvržená X-Forwarded-For nepomůže ==');
  const kody2 = [];
  for (let i = 0; i < 3; i++) kody2.push((await spatne(inst2, { 'X-Forwarded-For': `203.0.113.${10 + i}` })).status);
  console.log('   kódy s podvrženou hlavičkou:', kody2.join(' '));
  expect(kody2.every((k) => k === 429), `každý pokus s jinou podvrženou IP dál dostává 429 (${kody2.join(' ')})`);
  await inst2.stop();

  // ---------- B1-2b: s KB_TRUSTED_PROXY_HEADER se IP bere z hlavičky (za Caddy) ----------
  console.log('== B1-2b: KB_TRUSTED_PROXY_HEADER=X-Forwarded-For → kbelík podle hlavičky ==');
  const inst3 = await H.startInstance({ slug: 'audit-proxy', env: { KB_UVODNI_MAPA: 0, KB_RATE_LIMITS: 1, KB_TRUSTED_PROXY_HEADER: 'X-Forwarded-For' } });
  const kodyA = [];
  for (let i = 0; i < 22; i++) kodyA.push((await spatne(inst3, { 'X-Forwarded-For': '198.51.100.7' })).status);
  const kodyB = [];
  for (let i = 0; i < 2; i++) kodyB.push((await spatne(inst3, { 'X-Forwarded-For': '198.51.100.8' })).status);
  console.log('   klient A (posledních 4):', kodyA.slice(-4).join(' '), '| klient B:', kodyB.join(' '));
  expect(kodyA.includes(429), `klient A (jedna IP v hlavičce) narazí na 429 (${kodyA.join(' ')})`);
  expect(kodyB.every((k) => k === 400), `klient B (jiná IP v hlavičce) má vlastní kbelík — 400, ne 429 (${kodyB.join(' ')})`);
  await inst3.stop();

  // ---------- S6 / S7 / S13 ----------
  console.log('== S6: komentář — autor, e-mail, mapa a uzel jsou po odeslání zamčené ==');
  const sink = await H.smtpSink();
  const inst4 = await H.startInstance({ slug: 'audit-s6s7', addHostGateway: true, env: { KB_UVODNI_MAPA: 0 } });
  const ST = await inst4.superuser();
  await sink.zapoj(inst4, ST);
  const a = await inst4.register('alice@e2e.cz'); const aliceId = a.json.id;
  const b = await inst4.register('bob@e2e.cz'); const bobId = b.json.id;
  const A = await inst4.login('alice@e2e.cz');
  const B = await inst4.login('bob@e2e.cz');
  r = await inst4.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Mapa A', owner: aliceId, nodes: [], edges: [] } });
  expect(r.status === 200, `Alice založí mapu (${r.status})`); const mid = r.json.id;
  r = await inst4.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Mapa A2', owner: aliceId, nodes: [], edges: [] } });
  const mid2 = r.json.id;
  r = await inst4.api('POST', '/api/collections/comments/records', { token: A, body: { goalmap: mid, node_id: 'n1', text: 'puvodni', author: aliceId, author_email: 'alice@e2e.cz' } });
  expect(r.status === 200, `Alice založí komentář (${r.status} ${JSON.stringify(r.json && r.json.data || '')})`); const cid = r.json.id;
  r = await inst4.api('PATCH', `/api/collections/comments/records/${cid}`, { token: A, body: { author: bobId, author_email: 'reditel@e2e.cz', goalmap: mid2, node_id: 'n2', text: 'upraveno' } });
  expect(r.status === 200, `PATCH textu projde (${r.status})`);
  r = await inst4.api('GET', `/api/collections/comments/records/${cid}`, { token: A });
  expect(r.json.text === 'upraveno', `text se změnil (${r.json.text})`);
  expect(r.json.author === aliceId && r.json.author_email === 'alice@e2e.cz', `autor a e-mail zůstaly (${r.json.author === aliceId}/${r.json.author_email})`);
  expect(r.json.goalmap === mid && r.json.node_id === 'n1', `mapa a uzel zůstaly (${r.json.goalmap === mid}/${r.json.node_id})`);

  console.log('== S7a: vlastní změna hesla zruší API klíče ==');
  r = await inst4.api('POST', '/api/flowmap/api-keys', { token: A, body: { label: 'test' } });
  expect(r.status === 200 && r.json.token, `Alice dostane API klíč (${r.status})`); const klicA = r.json.token;
  r = await inst4.api('GET', '/api/flowmap/v1/maps', { bearer: klicA });
  expect(r.status === 200, `klíč před změnou hesla funguje (${r.status})`);
  r = await inst4.api('PATCH', `/api/collections/users/records/${aliceId}`, { token: A, body: { oldPassword: H.PW, password: 'NoveHeslo.123', passwordConfirm: 'NoveHeslo.123' } });
  expect(r.status === 200, `Alice si změní heslo (${r.status} ${JSON.stringify(r.json && r.json.data || '')})`);
  r = await inst4.api('GET', '/api/flowmap/v1/maps', { bearer: klicA });
  expect(r.status === 401, `klíč po změně hesla NEfunguje (${r.status})`);

  console.log('== S7b: reset hesla e-mailem (confirm-password-reset) zruší API klíče ==');
  r = await inst4.api('POST', '/api/flowmap/api-keys', { token: B, body: { label: 'test' } });
  expect(r.status === 200 && r.json.token, `Bob dostane API klíč (${r.status})`); const klicB = r.json.token;
  r = await inst4.api('GET', '/api/flowmap/v1/maps', { bearer: klicB });
  expect(r.status === 200, `Bobův klíč funguje (${r.status})`);
  const od = sink.maily.length;
  r = await inst4.api('POST', '/api/collections/users/request-password-reset', { body: { email: 'bob@e2e.cz' } });
  expect(r.status === 204, `žádost o reset (${r.status})`);
  const raw = await sink.cekejNaMail((m) => sink.maily.indexOf(m) >= od && /^To:.*bob@e2e\.cz/mi.test(m), 10000);
  const tok = (qp(raw).match(/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/) || [])[0];
  expect(!!tok, 'v mailu je resetovací token');
  r = await inst4.api('POST', '/api/collections/users/confirm-password-reset', { body: { token: tok, password: 'NoveHeslo.456', passwordConfirm: 'NoveHeslo.456' } });
  expect(r.status === 204, `reset hesla tokenem z mailu (${r.status} ${JSON.stringify(r.json && r.json.data || '')})`);
  r = await inst4.api('GET', '/api/flowmap/v1/maps', { bearer: klicB });
  expect(r.status === 401, `Bobův klíč po resetu e-mailem NEfunguje (${r.status})`);
  const B2 = await inst4.login('bob@e2e.cz', 'NoveHeslo.456');
  r = await inst4.api('GET', '/api/flowmap/api-keys', { token: B2 });
  expect(r.status === 200 && Array.isArray(r.json.keys) && r.json.keys.length === 0, `seznam klíčů je prázdný (${r.status}/${r.json && r.json.keys && r.json.keys.length})`);

  console.log('== S13: do kolekce uploads už nejde nahrávat ==');
  const fd = new FormData();
  fd.append('owner', bobId);
  fd.append('file', new Blob(['tajny obsah'], { type: 'text/plain' }), 'tajne.txt');
  // multipart přímo fetchem (harness `form` je urlencoded)
  r = await fetch(inst4.base + '/api/collections/uploads/records', { method: 'POST', headers: { Authorization: B2 }, body: fd }).then(async (res) => ({ status: res.status, json: await res.json().catch(() => ({})) }));
  expect(r.status !== 200, `přihlášený uživatel do uploads nenahraje (${r.status})`);
  r = await inst4.api('GET', '/api/collections/uploads/records?perPage=10');
  expect(r.status !== 200 || r.json.totalItems === 0, `anonym nic nevidí (${r.status}/${r.json && r.json.totalItems})`);
  await inst4.stop();
});
