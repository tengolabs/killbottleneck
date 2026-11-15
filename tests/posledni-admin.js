// The last administrator can be neither demoted nor deleted (decision 11 Nov 2026,
// finding S4-03 of code analysis 4) — an instance without an administrator can only be
// repaired by its operator.
//
// What is measured: REST PATCH of the own role and REST DELETE of the own account by the
// only administrator are refused with a clear message (cs + en) and nothing changes; the
// same through a superuser ("another process" — the model hooks); with a second
// administrator both work; the remaining one is the last again.
const H = require('./_harness');
const { expect } = H;

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'posladm', env: { KB_UVODNI_MAPA: 0 } });
  const ST = await inst.superuser();
  const ucet = async (email, extra) => {
    const r = await inst.register(email, extra || {});
    if (r.status !== 200) throw new Error(`registrace ${email}: ${r.status}`);
    return { id: r.json.id, email, token: await inst.login(email) };
  };
  const adminu = async () => (await inst.api('GET', `/api/collections/users/records?filter=${encodeURIComponent('role="admin"')}`, { token: ST })).json.totalItems;
  const role = async (u) => (await inst.api('GET', `/api/collections/users/records/${u.id}`, { token: ST })).json.role;
  const patch = (kdo, u, body, headers) => inst.api('PATCH', `/api/collections/users/records/${u.id}`, { token: kdo, body, headers });
  const del = (kdo, u, headers) => inst.api('DELETE', `/api/collections/users/records/${u.id}`, { token: kdo, headers });
  const hlaska = (r) => String((r.json || {}).message || (r.json || {}).error || '');

  const A = await ucet('a@pa.cz');                       // first account = administrator
  const B = await ucet('b@pa.cz');
  const EN = await ucet('en@pa.cz', { language: 'en' });
  expect((await adminu()) === 1, 'předpoklad: instance má jednoho administrátora');

  console.log('== jediný administrátor se nedegraduje ==');
  let r = await patch(A.token, A, { role: 'user' });
  expect(r.status === 400 && /Poslední administrátor nemůže o roli přijít/.test(hlaska(r)), `PATCH role → user odmítnut srozumitelně (${r.status}: ${hlaska(r).slice(0, 70)})`);
  r = await patch(A.token, A, { role: 'manager' });
  expect(r.status === 400, `ani na manažera (${r.status})`);
  expect((await role(A)) === 'admin' && (await adminu()) === 1, 'role zůstala, administrátor je dál jeden');
  r = await patch(A.token, A, { name: 'Jiné jméno' });
  expect(r.status === 200 && r.json.name === 'Jiné jméno', `běžnou úpravu vlastního účtu to neblokuje (${r.status})`);
  r = await patch(A.token, A, { role: 'admin', name: 'Stejná role' });
  expect(r.status === 200, `PATCH se STEJNOU rolí projde (celý záznam z klienta) (${r.status})`);
  r = await patch(ST, A, { role: 'user' });
  expect(r.status === 400 && (await role(A)) === 'admin', `ani superuživatel (jiný proces) posledního administrátora nedegraduje (${r.status})`);

  console.log('== jediný administrátor se nesmaže ==');
  r = await del(A.token, A);
  expect(r.status === 400 && /posledního administrátora nejde smazat/.test(hlaska(r)), `DELETE vlastního účtu odmítnut srozumitelně (${r.status}: ${hlaska(r).slice(0, 70)})`);
  r = await del(ST, A);
  expect(r.status === 400, `ani superuživatel ho nesmaže (${r.status})`);
  expect((await adminu()) === 1 && (await role(A)) === 'admin', 'účet žije, administrátor je dál jeden');

  console.log('== s druhým administrátorem to jde ==');
  r = await patch(A.token, EN, { role: 'admin' });
  expect(r.status === 200 && (await adminu()) === 2, `druhý administrátor jmenován (${r.status})`);
  r = await patch(A.token, A, { role: 'user' });
  expect(r.status === 200 && (await role(A)) === 'user', `první se teď degradovat smí (${r.status})`);
  // EN is the last one now — and gets the message in English
  r = await patch(EN.token, EN, { role: 'user' });
  expect(r.status === 400 && /only administrator/.test(hlaska(r)), `zbývající je zase poslední; anglický účet dostane anglickou hlášku (${r.status}: ${hlaska(r).slice(0, 60)})`);
  r = await del(EN.token, EN);
  expect(r.status === 400 && /last administrator's account cannot be deleted/.test(hlaska(r)), `a smazat se nesmí (${r.status}: ${hlaska(r).slice(0, 60)})`);
  r = await patch(EN.token, B, { role: 'admin' });
  expect(r.status === 200, `jmenuje dalšího (${r.status})`);
  r = await del(EN.token, EN);
  expect(r.status === 204 && (await adminu()) === 1, `teprve pak se smazat smí; instance má dál administrátora (${r.status})`);
  r = await del(B.token, A);
  expect(r.status === 204, `běžného člena administrátor smaže jako dřív (${r.status})`);

  console.log('== souběh: dva administrátoři se ve stejný okamžik degradují / smažou navzájem ==');
  // Security review 11 Nov 2026: read-then-write let both requests pass. Repeated, because a race does not show every time.
  const povys = (u) => inst.api('PATCH', `/api/collections/users/records/${u.id}`, { token: ST, body: { role: 'admin' } });
  let nulaDegradace = 0, obaProsly = 0;
  const X = await ucet('x@pa.cz'); const Y = await ucet('y@pa.cz');
  await del(ST, B).catch(() => {}); // B was the remaining administrator — from here only X and Y matter
  for (let i = 0; i < 25; i++) {
    await povys(X); await povys(Y);
    const zbyli = (await inst.api('GET', `/api/collections/users/records?filter=${encodeURIComponent('role="admin"')}`, { token: ST })).json.items.filter((u) => u.id !== X.id && u.id !== Y.id);
    for (const u of zbyli) await inst.api('PATCH', `/api/collections/users/records/${u.id}`, { token: ST, body: { role: 'user' } });
    const [a, b] = await Promise.all([patch(X.token, Y, { role: 'user' }), patch(Y.token, X, { role: 'user' })]);
    if (a.status === 200 && b.status === 200) obaProsly += 1;
    if ((await adminu()) === 0) nulaDegradace += 1;
  }
  expect(nulaDegradace === 0, `po 25 souběžných vzájemných degradacích nikdy nezůstala instance bez administrátora (bez správce: ${nulaDegradace}×, oba požadavky prošly: ${obaProsly}×)`);
  let nulaSmazani = 0;
  for (let i = 0; i < 12; i++) {
    const P = await ucet(`p${i}@pa.cz`); const Q = await ucet(`q${i}@pa.cz`);
    await povys(P); await povys(Q);
    const ostatni = (await inst.api('GET', `/api/collections/users/records?perPage=200&filter=${encodeURIComponent('role="admin"')}`, { token: ST })).json.items.filter((u) => u.id !== P.id && u.id !== Q.id);
    for (const u of ostatni) await inst.api('PATCH', `/api/collections/users/records/${u.id}`, { token: ST, body: { role: 'user' } });
    await Promise.all([del(P.token, Q), del(Q.token, P)]);
    if ((await adminu()) === 0) { nulaSmazani += 1; await povys(X); }
  }
  expect(nulaSmazani === 0, `po 12 souběžných vzájemných smazáních nikdy nezůstala instance bez administrátora (bez správce: ${nulaSmazani}×)`);
}, { nazev: 'POSLEDNI-ADMIN' });
