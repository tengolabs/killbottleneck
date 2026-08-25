// GET /api/kb/portfolio — přehled „Organizace" (P2-02 + P3-03, rozhodnutí 25. 8. 2026).
// Hlídá to, na čem rozhodnutí stojí a co se při úpravách nejsnáz rozbije:
//   • kdo vidí: admin + manager 200, člen 403, nepřihlášený 401;
//   • SOUKROMÍ: mapa jen s vlastníkem se NEPOČÍTÁ ani do součtů (ani propadlý
//     uzel v ní) — mutačně: build bez téhle podmínky by ji započítal;
//   • sdílená přes map_shares ANO, týmová ANO, archivovaná a org mapa NE,
//     mapa sdílená jen mezi dvěma jinými lidmi manažerovi NE (není „vševidoucí");
//   • po termínu = dní podle termínu, plán ho neschová;
//   • % hotovo = listy pod vrcholem (stejné číslo jako dashboard projektu);
//   • nehýbe se = 14 dní bez pohybu v záznamníku (přes ?today= posunutý dopředu);
//   • lidé + „bez řešitele"; dedup úkol↔uzel; změny za 7 dní; ?today= z klienta.
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20565';
const NAME = 'flowmap-e2e-portfolio';
const PW = 'testheslo123';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (offset) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA'); };

const api = async (path, { token, bearer, body, method } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = token;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  let json = null; try { json = await res.json(); } catch { /* SPA HTML na starém buildu → {} */ }
  return { status: res.status, json: json || {} };
};
const register = async (email) => {
  const rec = (await api('/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } })).json;
  const r = await api('/api/collections/users/auth-with-password', { body: { identity: email, password: PW } });
  const klic = (await api('/api/kb/api-keys', { token: r.json.token, body: { label: 'seed', scope: 'read_write' } })).json.token;
  return { token: r.json.token, id: rec.id, email, klic };
};
const titles = (list) => (list || []).map((i) => i.title);
const portfolio = (u, today) => api(`/api/kb/portfolio?today=${today || day(0)}`, { token: u.token });

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_UVODNI_MAPA=0 -e KB_PURPOSE_ASK=0 -p 20565:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    const admin = await register('admin@e2e.cz');       // první = admin
    const manazer = await register('manazer@e2e.cz');
    const clen = await register('clen@e2e.cz');
    const eva = await register('eva@e2e.cz');
    await api(`/api/collections/users/records/${manazer.id}`, { token: admin.token, method: 'PATCH', body: { role: 'manager' } });

    // mapy přes v1 API (tree[0] = vrchol, položky = děti); sdílení přes /share
    const mapa = async (u, title, tree) => (await api('/api/kb/v1/maps', { bearer: u.klic, body: { title, tree } })).json;
    const share = (u, mapId, body) => api('/api/kb/share', { token: u.token, body: { mapId, ...body } });

    // TÝMOVÁ (admin): 2 po termínu, 1 bez termínu (kandidát na „nehýbe se"), 1 hotový list; pilíř s 2 listy
    const tymova = await mapa(admin, 'TYMOVA', [
      { title: 'T-PO-TERMINU-5', owner: clen.email, deadline: day(-5) },
      { title: 'T-PO-TERMINU-1', owner: eva.email, deadline: day(-1), status: 'in_progress' },
      { title: 'T-BEZ-TERMINU', owner: eva.email },
      { title: 'T-HOTOVO', owner: clen.email, status: 'done' },
      { title: 'T-PILIR', children: [{ title: 'T-LIST-A', owner: clen.email, deadline: day(3) }, { title: 'T-LIST-B', status: 'done' }] },
    ]);
    await share(admin, tymova.id, { action: 'set_team_access', access: 'read' });
    // SDÍLENÁ (člen → adminovi i manažerovi): 1 po termínu
    const sdilena = await mapa(clen, 'SDILENA', [
      { title: 'S-PO-TERMINU-10', owner: clen.email, deadline: day(-10) },
      { title: 'S-HOTOVO', owner: clen.email, status: 'done' },
    ]);
    await share(clen, sdilena.id, { action: 'share', email: admin.email, permission: 'read' });
    await share(clen, sdilena.id, { action: 'share', email: manazer.email, permission: 'work' });
    // SOUKROMÁ adminova s propadlým uzlem — NESMÍ se objevit
    await mapa(admin, 'SOUKROMA', [{ title: 'P-PO-TERMINU-30', owner: admin.email, deadline: day(-30) }]);
    // sdílená jen mezi členem a Evou — manažer ji NEVIDÍ
    const cizi = await mapa(clen, 'CIZI-SDILENA', [{ title: 'C-PO-TERMINU-7', owner: eva.email, deadline: day(-7) }]);
    await share(clen, cizi.id, { action: 'share', email: eva.email, permission: 'work' });
    // archivovaná týmová — NE
    const archiv = await mapa(admin, 'ARCHIV', [{ title: 'A-PO-TERMINU-3', owner: clen.email, deadline: day(-3) }]);
    await share(admin, archiv.id, { action: 'set_team_access', access: 'edit' });
    await api(`/api/collections/goalmaps/records/${archiv.id}`, { token: admin.token, method: 'PATCH', body: { archived: true } });
    // org mapa — NE
    await api('/api/kb/org-map', { token: admin.token, body: {} });

    console.log('== kdo vidí ==');
    let r = await api('/api/kb/portfolio');
    expect(r.status === 401, `nepřihlášený → 401 (${r.status})`);
    r = await portfolio(clen);
    expect(r.status === 403, `člen (role user) → 403 (${r.status})`);
    r = await portfolio(admin);
    expect(r.status === 200, `admin → 200 (${r.status})`);
    const A = r.json;
    r = await portfolio(manazer);
    expect(r.status === 200, `manažer → 200 (${r.status})`);
    const M = r.json;
    expect(A.today === day(0), `dnešek podle klienta (${A.today})`);

    console.log('== rozsah: jen týmové a sdílené, které vidím ==');
    const projA = titles(A.sections.projects);
    expect(projA.includes('TYMOVA') && projA.includes('SDILENA'), `admin: týmová i sdílená (${projA})`);
    expect(!projA.includes('SOUKROMA'), 'admin: vlastní SOUKROMÁ mapa se nepočítá (mutační pojistka soukromí)');
    expect(!projA.includes('ARCHIV') && !projA.includes('CIZI-SDILENA'), 'admin: archiv ani mapa sdílená mezi dvěma jinými lidmi ne');
    expect(!projA.some((t) => /struktur|structure/i.test(t)), `org mapa se nepočítá (${projA})`);
    expect(A.scope.team === 1 && A.scope.shared === 1, `scope team=1 shared=1 (${A.scope.team}/${A.scope.shared})`);
    expect((A.scope.excluded || []).some((e) => e.title === 'SOUKROMA' && e.why === 'private'), 'soukromá mapa je v patičce přiznaná jako nezapočítaná');
    const projM = titles(M.sections.projects);
    expect(projM.includes('TYMOVA') && projM.includes('SDILENA') && !projM.includes('CIZI-SDILENA'), `manažer vidí totéž, ale ne cizí sdílenou (${projM})`);
    expect(!(M.scope.excluded || []).some((e) => e.title === 'SOUKROMA'), 'manažer o adminově soukromé mapě neví ani z patičky');

    console.log('== po termínu napříč projekty ==');
    const ov = A.sections.overdue;
    expect(titles(ov).join(',') === 'S-PO-TERMINU-10,T-PO-TERMINU-5,T-PO-TERMINU-1', `řazení od nejdelšího skluzu (${titles(ov)})`);
    expect(ov[0].daysOver === 10 && ov[1].daysOver === 5 && ov[2].daysOver === 1, `dní po termínu 10/5/1 (${ov.map((o) => o.daysOver)})`);
    expect(!titles(ov).includes('P-PO-TERMINU-30') && !titles(ov).includes('A-PO-TERMINU-3') && !titles(ov).includes('C-PO-TERMINU-7'), 'propadlé položky ze soukromé/archivované/cizí mapy NEJSOU v součtech');
    expect(A.counts.overdue === 3 && M.counts.overdue === 3, `počet po termínu 3 u obou (${A.counts.overdue}/${M.counts.overdue})`);
    expect(ov[0].mapTitle === 'SDILENA' && ov[0].owner === clen.email, 'řádek nese projekt a řešitele');
    // plán termín neschová: naplánuju propadlý uzel na zítra — zůstane po termínu
    const gm = (await api(`/api/collections/goalmaps/records/${tymova.id}`, { token: admin.token })).json;
    const nodes = gm.nodes.map((n) => (n.data?.title === 'T-PO-TERMINU-5' ? { ...n, data: { ...n.data, plannedOn: day(1) } } : n));
    await api(`/api/collections/goalmaps/records/${tymova.id}`, { token: admin.token, method: 'PATCH', body: { nodes } });
    r = await portfolio(admin);
    expect(titles(r.json.sections.overdue).includes('T-PO-TERMINU-5'), 'plán na zítra propadlý termín NESCHOVÁ (termín je dohoda)');

    console.log('== % hotovo = listy pod vrcholem (jako dashboard projektu) ==');
    const pt = A.sections.projects.find((p) => p.title === 'TYMOVA');
    // listy: T-PO-TERMINU-5, T-PO-TERMINU-1, T-BEZ-TERMINU, T-HOTOVO, T-LIST-A, T-LIST-B = 6, hotové 2 → 33 %
    expect(pt.total === 6 && pt.done === 2 && pt.pct === 33, `TYMOVA 2/6 = 33 % (${pt.done}/${pt.total} = ${pt.pct})`);
    const ps = A.sections.projects.find((p) => p.title === 'SDILENA');
    expect(ps.pct === 50 && ps.access === 'shared' && pt.access === 'team', `SDILENA 50 %, štítky team/shared (${ps.pct}, ${ps.access}/${pt.access})`);
    expect(A.sections.projects[0].title === 'TYMOVA', 'projekty řazené od nejnižšího %');
    expect(pt.overdue === 2 && ps.overdue === 1, `po termínu na projekt 2/1 (${pt.overdue}/${ps.overdue})`);
    expect(pt.open === 4, `otevřené položky práce TYMOVA = 4 (${pt.open})`);

    console.log('== lidé s nejvíc resty ==');
    const lide = A.sections.people;
    expect(lide[0].email === clen.email && lide[0].overdue === 2 && lide[0].worst === 10, `první je člen: 2 po termínu, nejdéle 10 dní (${lide[0].email} ${lide[0].overdue}/${lide[0].worst})`);
    expect(lide.some((p) => p.email === eva.email && p.overdue === 1 && p.open === 2), 'Eva: 1 po termínu, 2 otevřené');
    expect(A.counts.people === 2, `lidí s resty = 2 (${A.counts.people})`);
    expect(!lide.some((p) => p.email === admin.email), 'admin nemá v týmových mapách práci → v tabulce lidí není');

    console.log('== nehýbe se (14 dní podle záznamníku) ==');
    expect(A.counts.stuck === 0, `dnes založené uzly se nehýbou 0 dní → stuck 0 (${A.counts.stuck})`);
    r = await portfolio(admin, day(20));
    const st = r.json.sections.stuck;
    expect(titles(st).includes('T-BEZ-TERMINU'), `o 20 dní později uzel bez termínu „leží" (${titles(st)})`);
    expect(!titles(st).includes('T-PO-TERMINU-5'), 'propadlá položka do „nehýbe se" nepatří (má vlastní sekci)');
    expect((st.find((s) => s.title === 'T-BEZ-TERMINU') || {}).daysIdle >= 19, `dní bez pohybu ≈ 20 (${(st[0] || {}).daysIdle})`);
    expect(r.json.sections.projects.find((p) => p.title === 'TYMOVA').stuck === 1, 'projekt nese počet „nehýbe se"');

    console.log('== úkoly: dedup do uzlu, změny za 7 dní ==');
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    const nodeId = (t) => (gm.nodes.find((n) => n.data?.title === t) || {}).id;
    await api('/api/collections/tasks/records', { token: ST, body: { map: tymova.id, node_id: nodeId('T-PO-TERMINU-5'), owner: admin.id, owner_email: admin.email, title: 'UKOL-DETAIL-UZLU', status: 'todo', assignee_email: clen.email, deadline: day(-2) } });
    await api('/api/collections/tasks/records', { token: ST, body: { map: tymova.id, node_id: nodeId('T-BEZ-TERMINU'), owner: admin.id, owner_email: admin.email, title: 'UKOL-JINY-RESITEL', status: 'todo', assignee_email: clen.email, deadline: day(-4) } });
    r = await portfolio(admin);
    const ov2 = titles(r.json.sections.overdue);
    expect(!ov2.includes('UKOL-DETAIL-UZLU'), 'úkol na uzlu se STEJNÝM řešitelem je detail uzlu — nepočítá se dvakrát');
    expect(ov2.includes('UKOL-JINY-RESITEL'), 'úkol s JINÝM řešitelem než uzel se počítá zvlášť');
    const ch = r.json.sections.changes;
    expect(r.json.counts.changes > 0 && ch.every((c) => ['TYMOVA', 'SDILENA'].includes(c.mapTitle)), `změny za 7 dní jen ze sledovaných map (${r.json.counts.changes})`);
    expect(ch.some((c) => c.field === 'created' && c.title === 'T-PO-TERMINU-5'), 'založení uzlu je mezi změnami');
    expect(!ch.some((c) => c.title === 'P-PO-TERMINU-30'), 'změny ze soukromé mapy tam nejsou');
    expect(ch.length > 1 && ch[0].when >= ch[ch.length - 1].when, 'změny od nejnovější');
    expect(r.json.truncated === null, 'bez zkrácení = null (kontrakt jako Můj den)');

    console.log('== okraje: velikost písmen, smazaný uzel, hotový uzel s otevřeným úkolem ==');
    // úkol s řešitelem v jiné velikosti písmen než uzel → složí se (jeden člověk, ne dva)
    await api('/api/collections/tasks/records', { token: ST, body: { map: tymova.id, node_id: nodeId('T-PO-TERMINU-1'), owner: admin.id, owner_email: admin.email, title: 'UKOL-VELKA-PISMENA', status: 'todo', assignee_email: 'EVA@E2E.CZ', deadline: day(-6) } });
    // úkol na smazaném uzlu → počítá se samostatně, nesmí se ztratit
    await api('/api/collections/tasks/records', { token: ST, body: { map: tymova.id, node_id: 'node-neexistuje', owner: admin.id, owner_email: admin.email, title: 'UKOL-SIROTEK', status: 'todo', assignee_email: clen.email, deadline: day(-8) } });
    // úkol na HOTOVÉM uzlu téhož řešitele → nesmí zmizet spolu s uzlem
    await api('/api/collections/tasks/records', { token: ST, body: { map: tymova.id, node_id: nodeId('T-HOTOVO'), owner: admin.id, owner_email: admin.email, title: 'UKOL-NA-HOTOVEM', status: 'todo', assignee_email: clen.email, deadline: day(-9) } });
    r = await portfolio(admin);
    const ov3 = titles(r.json.sections.overdue);
    expect(!ov3.includes('UKOL-VELKA-PISMENA'), 'řešitel EVA@E2E.CZ = eva@e2e.cz → úkol složen do uzlu, nepočítá se dvakrát');
    expect(r.json.sections.people.filter((p) => /eva@e2e\.cz/i.test(p.email)).length === 1, 'Eva je v tabulce lidí jednou (bez ohledu na velikost písmen)');
    expect(ov3.includes('UKOL-SIROTEK'), 'úkol na smazaném uzlu se počítá samostatně');
    expect(ov3.includes('UKOL-NA-HOTOVEM'), 'otevřený úkol na hotovém uzlu z přehledu nezmizí');
  } catch (e) {
    fail++; console.log('  ❌ výjimka', e.message);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} portfolio-api: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
