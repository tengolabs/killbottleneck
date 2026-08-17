// Externí kontakty (Richard 11. 8. 2026): adresář lidí mimo systém (účetní,
// dodavatelé) — zadat jim jde s termínem, ale NIKDY jim nic nechodí. Řešitel
// se nese jako pseudo-e-mail ext-<id>@kontakt.invalid.
//
// Hlídá se MUTACEMI (poučení z reference-testy-vzdy-zelene-past):
//  · RLS privátního kontaktu: cizí ho nesmí číst/změnit/smazat — čekáme 404,
//    a PO pokusu ověřujeme, že se záznam opravdu nezměnil;
//  · autorství: podvržený owner při create se přerazítkuje na přihlášeného;
//  · pojistka notifikací: pseudo-adresa nezíská účet (registrace i pozvánka)
//    a termínový cron externímu nic nezaloží — upozornění dostane ZADAVATEL
//    s textem „u externích lidí…";
//  · pseudo-e-mail projde email polem úkolu (riziko TLD .invalid — kdyby ne,
//    spadne to tady, ne u zákazníka);
//  · přejmenování kontaktu se promítne do „Zadal jsem" (jméno žije jen
//    v adresáři), smazání nechá data čitelná (anonymní fallback).
const { execSync } = require('child_process');

const PORT = 20591;
const BASE = `http://127.0.0.1:${PORT}`;
const NAME = 'kb-e2e-externi-kontakty';
const PW = 'TestHeslo.2026';
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
const reg = (email, role) => api('POST', '/api/collections/users/records', {
  body: { email, password: PW, passwordConfirm: PW, ...(role ? { role } : {}) },
});
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json?.token;
const pseudo = (id) => `ext-${id}@kontakt.invalid`;

const pragueDate = (offset = 0) => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e TZ=Europe/Prague -e KB_UVODNI_MAPA=0 -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert ${SU.email} ${SU.pw}`, { stdio: 'ignore' });

    await reg('sef@example.com');       // první = admin
    await reg('anna@example.com');
    await reg('bara@example.com');
    const ADMIN = await login('sef@example.com');
    const A = await login('anna@example.com');
    const B = await login('bara@example.com');
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: SU.email, password: SU.pw } })).json.token;
    const uid = async (token) => (await api('GET', '/api/collections/users/records?perPage=1&filter=' + encodeURIComponent('email != ""'), { token })).json; // nevyužito — id bereme z auth
    void uid;

    console.log('== adresář: veřejný a privátní kontakt ==');
    const ucetni = (await api('POST', '/api/collections/external_contacts/records', {
      token: A, body: { name: 'Účetní Nováková', note: 'závěrky', email: 'ucetni@firma.example' } })).json;
    expect(!!ucetni?.id, `veřejný kontakt vznikl (${ucetni?.id})`);
    expect(ucetni?.owner_email === 'anna@example.com', 'owner_email razítkuje server z přihlášení');

    // podvržené autorství: owner z těla se musí přepsat na přihlášeného
    const bId = (await api('GET', '/api/collections/users/records?perPage=1&filter=' + encodeURIComponent('email = "bara@example.com"'), { token: ADMIN })).json?.items?.[0]?.id;
    const podvrh = (await api('POST', '/api/collections/external_contacts/records', {
      token: A, body: { name: 'Podvrh', owner: bId, owner_email: 'bara@example.com' } })).json;
    expect(podvrh?.owner_email === 'anna@example.com', 'podvržený owner při create se přerazítkuje na autora');
    await api('DELETE', `/api/collections/external_contacts/records/${podvrh.id}`, { token: A });

    const tajny = (await api('POST', '/api/collections/external_contacts/records', {
      token: B, body: { name: 'Tajný dodavatel', private: true } })).json;
    expect(!!tajny?.id && tajny.private === true, 'privátní kontakt vznikl');

    console.log('== RLS: privátní kontakt nevidí a nezmění NIKDO jiný (ani admin) ==');
    for (const [kdo, tok] of [['anna', A], ['admin', ADMIN]]) {
      const list = (await api('GET', '/api/collections/external_contacts/records?perPage=100', { token: tok })).json;
      const jmena = (list?.items || []).map((c) => c.name);
      expect(!jmena.includes('Tajný dodavatel'), `${kdo}: privátní kontakt NENÍ ve výpisu (vidí: ${jmena.join(', ') || 'nic'})`);
      const primo = await api('GET', `/api/collections/external_contacts/records/${tajny.id}`, { token: tok });
      expect(primo.status === 404, `${kdo}: přímé čtení privátního → 404 (${primo.status})`);
      const patch = await api('PATCH', `/api/collections/external_contacts/records/${tajny.id}`, { token: tok, body: { name: 'HACK' } });
      expect(patch.status === 404, `${kdo}: PATCH privátního → 404 (${patch.status})`);
      const smaz = await api('DELETE', `/api/collections/external_contacts/records/${tajny.id}`, { token: tok });
      expect(smaz.status === 404, `${kdo}: DELETE privátního → 404 (${smaz.status})`);
    }
    // mutace se opravdu NEPROPSALA a záznam žije
    const poPokusech = (await api('GET', `/api/collections/external_contacts/records/${tajny.id}`, { token: B })).json;
    expect(poPokusech?.name === 'Tajný dodavatel', 'privátní kontakt po útocích beze změny');

    console.log('== veřejný kontakt: upraví autor a admin, cizí člen ne ==');
    const ciziPatch = await api('PATCH', `/api/collections/external_contacts/records/${ucetni.id}`, { token: B, body: { name: 'HACK2' } });
    expect(ciziPatch.status === 404 || ciziPatch.status === 403, `cizí člen veřejný kontakt neupraví (${ciziPatch.status})`);
    const adminPatch = await api('PATCH', `/api/collections/external_contacts/records/${ucetni.id}`, { token: ADMIN, body: { note: 'závěrky + DPH' } });
    expect(adminPatch.status === 200, `admin veřejný kontakt upraví (${adminPatch.status})`);
    expect((await api('GET', `/api/collections/external_contacts/records/${ucetni.id}`, { token: B })).json?.name === 'Účetní Nováková', 'bara veřejný kontakt VIDÍ (instance-wide)');

    console.log('== pojistka: pseudo-adresa nezíská účet ==');
    const regPseudo = await api('POST', '/api/collections/users/records', {
      body: { email: pseudo(ucetni.id), password: PW, passwordConfirm: PW } });
    expect(regPseudo.status >= 400, `self-registrace na ext-adresu odmítnuta (${regPseudo.status})`);
    const invPseudo = await api('POST', '/api/kb/invite', { token: ADMIN, body: { email: pseudo(ucetni.id) } });
    expect(invPseudo.status === 400, `pozvánka na ext-adresu odmítnuta (${invPseudo.status})`);

    console.log('== zadání externímu: uzel i úkol s termínem ==');
    const OLD = pragueDate(-2);
    const mapa = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Účetnictví',
      nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Účetnictví', title: 'Účetnictví', status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 1 }, data: { title: 'Roční závěrka', status: 'todo', owner: pseudo(ucetni.id), deadline: OLD } },
        { id: 'n2', type: 'goalNode', position: { x: 0, y: 2 }, data: { title: 'Podklady pro závěrku', status: 'todo', owner: 'anna@example.com' } },
      ],
      edges: [
        { id: 'e1', source: 'root', target: 'n1' },
        { id: 'e2', source: 'root', target: 'n2' },
      ],
    } })).json;
    expect(!!mapa?.id, 'mapa s externím garantem uzlu vznikla');
    // ⚠️ tady se láme riziko TLD .invalid: email pole úkolu musí pseudo-adresu vzít
    // SLOVNÍK 17. 8. 2026: položku sází superuser (uživatelský create = 403)
    const uidA3 = ((await api('GET', `/api/collections/users/records?filter=${encodeURIComponent("email='anna@example.com'")}`, { token: ST })).json.items || [])[0].id;
    const ukol = (await api('POST', '/api/collections/tasks/records', { token: ST, body: {
      title: 'Zpracovat DPH', status: 'todo', deadline: OLD,
      assignee_email: pseudo(ucetni.id), map: mapa.id, node_id: 'n2',
      owner: uidA3, owner_email: 'anna@example.com',
    } })).json;
    expect(!!ukol?.id, `tasks.assignee_email přijal pseudo-adresu ${pseudo(ucetni.id)}`);

    console.log('== „Zadal jsem": jméno kontaktu, ne pseudo-e-mail ==');
    const den = (await api('GET', '/api/kb/my-day', { token: A })).json;
    const deleg = den?.sections?.delegated || [];
    const uzelDeleg = deleg.find((d) => d.title === 'Roční závěrka');
    const ukolDeleg = deleg.find((d) => d.title === 'Zpracovat DPH');
    expect(!!uzelDeleg, `uzel externího je v sekci Zadal jsem (${deleg.length} položek)`);
    expect(!!ukolDeleg, 'úkol externího je v sekci Zadal jsem');
    expect(uzelDeleg?.assignee_label === 'Účetní Nováková' && uzelDeleg?.external === true, `uzel nese jméno kontaktu (${uzelDeleg?.assignee_label})`);
    expect(ukolDeleg?.assignee_label === 'Účetní Nováková', `úkol nese jméno kontaktu (${ukolDeleg?.assignee_label})`);

    console.log('== termínový cron: upozornění dostane ZADAVATEL, externí NIC ==');
    const notifs = async (token) => (await api(
      'GET', `/api/collections/notifications/records?perPage=50&sort=created&filter=${encodeURIComponent('type="deadline"')}`, { token }
    )).json?.items || [];
    const r1 = await api('POST', '/api/flowmap/run-deadline-notices', { token: ST });
    expect(r1.status === 200, `cron proběhl (${r1.status})`);
    const uA = await notifs(A);
    const extNotif = uA.filter((n) => (n.text || '').toLowerCase().includes('extern'));
    expect(extNotif.length === 1, `anna má PRÁVĚ JEDNO souhrnné „u externích lidí po termínu" (${uA.map((n) => n.text).join(' | ') || 'nic'})`);
    expect(extNotif[0] && /2/.test(extNotif[0].text), `souhrn počítá obě položky (uzel + úkol): „${extNotif[0]?.text}"`);
    // nikomu jinému nic nevzniklo: JEDINÉ termínové notifikace v celé instanci
    // patří zadavatelce (externí nemá users záznam, notify() ho nenajde → skip)
    expect((await notifs(B)).length === 0, 'bara žádné termínové upozornění nemá');
    const annaId = (await api('GET', '/api/collections/users/records?perPage=1&filter=' + encodeURIComponent('email = "anna@example.com"'), { token: ST })).json?.items?.[0]?.id;
    const vse = (await api('GET', '/api/collections/notifications/records?perPage=200&filter=' + encodeURIComponent('type="deadline"'), { token: ST })).json?.items || [];
    expect(vse.length > 0 && vse.every((n) => n.user === annaId), `všechny termínové notifikace instance patří zadavatelce (${vse.length})`);
    // idempotence: druhé force spuštění nesmí přidat další řádek
    await api('POST', '/api/flowmap/run-deadline-notices', { token: ST });
    expect((await notifs(A)).filter((n) => (n.text || '').toLowerCase().includes('extern')).length === 1, 'druhý běh cronu externí souhrn neduplikuje');

    console.log('== import: vlastní kontakt se zachová, cizí privátní a neznámý se zahodí ==');
    const imp = await api('POST', '/api/kb/map-import', { token: A, body: {
      format: 'killbottleneck.map/1',
      map: {
        title: 'Import s externisty',
        nodes: [
          { id: 'r', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'R', title: 'R', status: 'todo' } },
          { id: 'a', type: 'goalNode', position: { x: 0, y: 1 }, data: { title: 'Můj kontakt', status: 'todo', owner: pseudo(ucetni.id) } },
          { id: 'b', type: 'goalNode', position: { x: 0, y: 2 }, data: { title: 'Cizí privátní', status: 'todo', owner: pseudo(tajny.id) } },
          { id: 'c', type: 'goalNode', position: { x: 0, y: 3 }, data: { title: 'Neznámé id', status: 'todo', owner: pseudo('neexistujexxxxx') } },
        ],
        edges: [
          { id: 'e1', source: 'r', target: 'a' },
          { id: 'e2', source: 'r', target: 'b' },
          { id: 'e3', source: 'r', target: 'c' },
        ],
      },
      tasks: [{ id: 't1', title: 'Import DPH', status: 'todo', assignee_email: pseudo(ucetni.id), node_id: 'a' }],
    } });
    expect(imp.status === 200, `import prošel (${imp.status})`);
    expect(imp.json?.assignments_dropped === 2, `zahozena PRÁVĚ 2 přiřazení: cizí privátní + neznámé id (${imp.json?.assignments_dropped})`);
    const impMapa = (await api('GET', `/api/collections/goalmaps/records/${imp.json.id}`, { token: A })).json;
    const ownersImp = Object.fromEntries((impMapa?.nodes || []).map((n) => [n.data?.title, n.data?.owner || '']));
    expect(ownersImp['Můj kontakt'] === pseudo(ucetni.id), 'viditelný kontakt import ZACHOVAL');
    expect(ownersImp['Cizí privátní'] === '' && ownersImp['Neznámé id'] === '', 'cizí privátní i neznámé id import vyprázdnil');
    const impUkoly = (await api('GET', `/api/collections/tasks/records?filter=${encodeURIComponent(`map = "${imp.json.id}"`)}`, { token: A })).json?.items || [];
    expect(impUkoly.length === 0 && imp.json?.tasks_skipped >= 1,
      `import položky NEzakládá (slovník 17. 8.) a poctivě je počítá jako přeskočené (${impUkoly.length}/${imp.json?.tasks_skipped})`);

    console.log('== přejmenování kontaktu se promítne, smazání nechá čitelný fallback ==');
    await api('PATCH', `/api/collections/external_contacts/records/${ucetni.id}`, { token: A, body: { name: 'Nová účetní s.r.o.' } });
    const den2 = (await api('GET', '/api/kb/my-day', { token: A })).json;
    const po = (den2?.sections?.delegated || []).find((d) => d.title === 'Roční závěrka');
    expect(po?.assignee_label === 'Nová účetní s.r.o.', `po přejmenování všude nové jméno (${po?.assignee_label})`);

    await api('DELETE', `/api/collections/external_contacts/records/${ucetni.id}`, { token: A });
    const den3 = (await api('GET', '/api/kb/my-day', { token: A })).json;
    const sirotek = (den3?.sections?.delegated || []).find((d) => d.title === 'Roční závěrka');
    expect(!!sirotek && sirotek.external === true && !sirotek.assignee_label, 'po smazání kontaktu položka zůstává, bez jména (FE ukáže „Externí kontakt")');
    expect((await api('GET', `/api/collections/tasks/records/${ukol.id}`, { token: A })).status === 200, 'úkol je po smazání kontaktu dál čitelný');

    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    console.error('CHYBA SADY:', e);
    process.exitCode = 1;
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
})();
