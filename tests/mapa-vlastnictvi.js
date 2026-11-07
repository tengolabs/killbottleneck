// Vlastnictví a archivace projektu + auto-sdílení řešitelům při zápisu PŘÍMO do
// kolekce (analýza funkcí 5. 11. 2026, vady „bez rozhodnutí"):
//   • archivace nevlastníkem → nahlas 400, ne tichá 200 bez účinku;
//   • /maps/{id}/transfer (vlastník nebo admin): owner + owner_email, nový vlastník
//     bez řádku sdílení, dosavadní zůstává spolusprávcem; cizí adresa ne;
//   • /users/{id}/maps + /users/{id}/transfer-maps (jen admin) — krok před smazáním účtu:
//     mazaný vlastník spolusprávcem NEzůstává a po smazání účtu jeho e-mail zmizí ze sdílení
//     VŠECH map (jinak by znovuregistrace téže adresy přístup oživila — nález 17. 8. u org mapy);
//   • PATCH pole owner vlastníkem jde stejnou cestou (owner_email dopočítán);
const { execSync } = require('child_process');
const PORT = 20533;
const BASE = `http://127.0.0.1:${PORT}`;
const NAME = 'flowmap-e2e-vlastnictvi';
const PW = 'testheslo123';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', 'Accept-Language': 'cs', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { /* prázdná odpověď */ }
  return { status: res.status, json };
};
const errOf = (r) => String((r.json || {}).error || (r.json || {}).message || '');
const register = async (email) => {
  await api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW, language: 'cs' } });
  const r = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } });
  return { token: r.json.token, id: r.json.record.id, email };
};
const uzel = (id, title, owner) => ({ id, type: 'goalNode', position: { x: 0, y: 300 },
  data: { title, status: 'todo', description: '', collapsed: false, color: '', nodeType: 'normal', goalType: '', apexText: '', deadline: '', owner: owner || '' } });
const mapaTelo = (title, nodes) => ({
  title, nodes: [{ id: 'R', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: title, title: '', status: 'todo' } }, ...nodes],
  edges: nodes.map((n) => ({ id: 'e' + n.id, source: 'R', target: n.id })),
});
const mapu = async (id, who) => (await api('GET', `/api/collections/goalmaps/records/${id}`, { token: who.token }));

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d -e KB_RATE_LIMITS=0 --name ${NAME} -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    const admin = await register('admin@vl.cz');     // první účet = admin
    const clen1 = await register('clen1@vl.cz');
    const clen2 = await register('clen2@vl.cz');
    const clen3 = await register('clen3@vl.cz');

    const m = (await api('POST', '/api/collections/goalmaps/records', { token: admin.token,
      body: Object.assign(mapaTelo('Projekt A', [uzel('a', 'Krok pro clena1', clen1.email), uzel('b', 'Volny krok')]), { owner: admin.id, owner_email: admin.email }) })).json;
    expect(!!m.id, `mapa založená přímo v kolekci (${m.id || errOf({ json: m })})`);
    let r;

    console.log('== archivace nevlastníkem je nahlas odmítnutá ==');
    r = await api('POST', '/api/kb/share', { token: admin.token, body: { action: 'share', mapId: m.id, email: clen1.email, permission: 'edit' } });
    expect(r.status === 200, `clen1 povýšen na spolusprávce (edit) (${r.status})`);
    await sleep(300);
    r = await api('PATCH', `/api/collections/goalmaps/records/${m.id}`, { token: clen1.token, body: { archived: true } });
    expect(r.status === 400 && /vlastník/i.test(errOf(r)), `spolusprávce archivovat nesmí a dozví se to (${r.status}: ${errOf(r).slice(0, 60)})`);
    expect((await mapu(m.id, admin)).json.archived === false, 'mapa zůstala nearchivovaná');
    r = await api('PATCH', `/api/collections/goalmaps/records/${m.id}`, { token: clen1.token, body: { title: 'Projekt A (upraveno)' } });
    expect(r.status === 200, `obsah (název) spolusprávce měnit smí (${r.status})`);
    r = await api('PATCH', `/api/collections/goalmaps/records/${m.id}`, { token: clen1.token, body: { archived: false, description: 'beze změny archivace' } });
    expect(r.status === 200, `PATCH se STEJNOU hodnotou archived projde (celý záznam z klienta) (${r.status})`);

    console.log('== předání vlastnictví routou ==');
    r = await api('POST', `/api/kb/maps/${m.id}/transfer`, { token: clen2.token, body: { email: clen2.email } });
    expect(r.status === 403, `cizí člen vlastnictví nepředá (${r.status})`);
    r = await api('POST', `/api/kb/maps/${m.id}/transfer`, { token: admin.token, body: { email: 'nikdo@vl.cz' } });
    expect(r.status === 400, `cizí adresa bez účtu → 400 (${r.status})`);
    r = await api('POST', `/api/kb/maps/${m.id}/transfer`, { token: admin.token, body: { email: admin.email } });
    expect(r.status === 400, `předat sám sobě → 400 (${r.status})`);
    r = await api('POST', `/api/kb/maps/${m.id}/transfer`, { token: admin.token, body: { email: clen1.email } });
    expect(r.status === 200 && r.json.owner_email === clen1.email, `vlastník předal clen1 (${r.status} ${errOf(r)})`);
    let mm = (await mapu(m.id, clen1)).json;
    expect(mm.owner === clen1.id && mm.owner_email === clen1.email, 'owner i owner_email ukazují na nového vlastníka');
    expect(!(mm.shared_with || []).includes(clen1.email) && !(mm.shared_with_edit || []).includes(clen1.email), 'nový vlastník nemá řádek sdílení');
    expect((mm.shared_with_edit || []).includes(admin.email), 'dosavadní vlastník zůstal spolusprávcem (Upravovat)');
    const podily = (await api('GET', `/api/collections/map_shares/records?filter=${encodeURIComponent(`map="${m.id}"`)}`, { token: clen1.token })).json.items || [];
    expect(!podily.some((s) => s.email === clen1.email) && podily.some((s) => s.email === admin.email && s.permission === 'edit'),
      `map_shares srovnané (${podily.map((s) => s.email + ':' + s.permission).join(', ')})`);
    r = await mapu(m.id, admin);
    expect(r.status === 200, `bývalý vlastník mapu dál vidí (${r.status})`);
    // admin (ne vlastník) smí předat taky
    r = await api('POST', `/api/kb/maps/${m.id}/transfer`, { token: admin.token, body: { email: clen3.email } });
    expect(r.status === 200, `administrátor předá i cizí mapu (${r.status} ${errOf(r)})`);
    mm = (await mapu(m.id, admin)).json;
    expect(mm.owner === clen3.id && (mm.shared_with_edit || []).includes(clen1.email), 'clen1 (předchozí vlastník) zůstal spolusprávcem');

    console.log('== projekty účtu a jejich převzetí před smazáním ==');
    r = await api('GET', `/api/kb/users/${clen3.id}/maps`, { token: clen1.token });
    expect(r.status === 403, `výčet projektů cizího účtu vidí jen admin (${r.status})`);
    r = await api('GET', `/api/kb/users/${clen3.id}/maps`, { token: admin.token });
    expect(r.status === 200 && r.json.count >= 1 && r.json.maps.some((x) => x.id === m.id), `admin vidí, co clen3 vlastní (${r.json && r.json.count})`);
    r = await api('POST', `/api/kb/users/${clen3.id}/transfer-maps`, { token: clen1.token, body: {} });
    expect(r.status === 403, `převzetí všech projektů jen admin (${r.status})`);
    // clen3 má navíc work sdílení na cizí mapě (adminově druhé) — po smazání účtu musí zmizet i to
    const m2 = (await api('POST', '/api/collections/goalmaps/records', { token: admin.token,
      body: Object.assign(mapaTelo('Projekt B', [uzel('x', 'Krok')]), { owner: admin.id, owner_email: admin.email }) })).json;
    await api('POST', '/api/kb/share', { token: admin.token, body: { action: 'share', mapId: m2.id, email: clen3.email, permission: 'work' } });
    const pocetPred = (await api('GET', `/api/kb/users/${clen3.id}/maps`, { token: admin.token })).json.count;
    r = await api('POST', `/api/kb/users/${clen3.id}/transfer-maps`, { token: admin.token, body: {} });
    expect(r.status === 200 && r.json.transferred === pocetPred && Array.isArray(r.json.skipped) && r.json.skipped.length === 0 && r.json.owner_email === admin.email,
      `admin převzal projekty clen3 (${r.status} ${JSON.stringify(r.json)})`);
    mm = (await mapu(m.id, admin)).json;
    expect(mm.owner === admin.id && mm.owner_email === admin.email, 'mapa je adminova');
    expect(!(mm.shared_with_edit || []).includes(clen3.email) && !(mm.shared_with || []).includes(clen3.email),
      'mazaný vlastník NEzůstal spolusprávcem (krok před smazáním účtu)');
    r = await api('GET', `/api/kb/users/${clen3.id}/maps`, { token: admin.token });
    expect(r.status === 200 && r.json.count === 0, `clen3 už nic nevlastní (${r.json && r.json.count})`);
    r = await api('DELETE', `/api/collections/users/records/${clen3.id}`, { token: admin.token });
    expect(r.status === 204, `účet clen3 smazán (${r.status})`);
    r = await mapu(m.id, admin);
    expect(r.status === 200, `a projekt přežil (${r.status})`);
    const m2po = (await mapu(m2.id, admin)).json;
    expect(!(m2po.shared_with || []).includes(clen3.email) && !(m2po.shared_with_work || []).includes(clen3.email),
      'po smazání účtu zmizel jeho e-mail ze sdílení i cizí mapy');
    const podilyPo = (await api('GET', `/api/collections/map_shares/records?filter=${encodeURIComponent(`email="${clen3.email}"`)}`, { token: admin.token })).json.items || [];
    expect(podilyPo.length === 0, `map_shares bez řádků smazané adresy (${podilyPo.length})`);
    // znovuregistrace téže adresy přístup NEoživí
    const clen3b = await register(clen3.email);
    expect((await mapu(m.id, clen3b)).status === 404 && (await mapu(m2.id, clen3b)).status === 404, 'znovu založený účet se stejnou adresou bývalé projekty nevidí');

    console.log('== PATCH pole owner vlastníkem = stejná cesta ==');
    // clen2 je na mapě sdílený (work) — po převodu musí z listů zmizet (vlastník řádek nemá)
    await api('POST', '/api/kb/share', { token: admin.token, body: { action: 'share', mapId: m.id, email: clen2.email, permission: 'work' } });
    mm = (await mapu(m.id, admin)).json;
    expect((mm.shared_with_work || []).includes(clen2.email), 'předpoklad: clen2 je před převodem sdílený (work)');
    r = await api('PATCH', `/api/collections/goalmaps/records/${m.id}`, { token: admin.token, body: { owner: clen2.id } });
    expect(r.status === 200, `vlastník přepsal owner PATCHem (${r.status} ${errOf(r)})`);
    mm = (await mapu(m.id, clen2)).json;
    expect(mm.owner === clen2.id && mm.owner_email === clen2.email, `owner_email se dopočítal (${mm.owner_email})`);
    expect(!(mm.shared_with_work || []).includes(clen2.email) && !(mm.shared_with || []).includes(clen2.email) && (mm.shared_with_edit || []).includes(admin.email),
      'nový vlastník bez řádku sdílení, starý spolusprávce');
    // klient, který posílá owner + owner_email NAJEDNOU (celý záznam): starý vlastník nesmí vypadnout
    r = await api('PATCH', `/api/collections/goalmaps/records/${m.id}`, { token: clen2.token, body: { owner: clen1.id, owner_email: clen1.email } });
    expect(r.status === 200, `PATCH owner + owner_email zároveň prošel (${r.status} ${errOf(r)})`);
    mm = (await mapu(m.id, clen1)).json;
    expect(mm.owner === clen1.id && (mm.shared_with_edit || []).includes(clen2.email), `i tak zůstal předchozí vlastník spolusprávcem (${(mm.shared_with_edit || []).join(',')})`);
    r = await api('PATCH', `/api/collections/goalmaps/records/${m.id}`, { token: clen1.token, body: { owner: 'neexistuje123' } });
    expect(r.status === 400, `owner na neexistující účet → 400 (${r.status})`);
  } catch (err) {
    fail++; console.log('  ❌ výjimka:', err.message);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
