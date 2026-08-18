// SPRÁVCE ORGANIZAČNÍ STRUKTURY (users.is_org_manager) — server e2e.
//
// Zadání Richarda 17. 8. 2026:
//  - příznak kolmý na roli, vzor `is_ai_manager` (nastavuje ho JEN admin)
//  - správce smí OBOJÍ: měnit strom pozic i jmenovat lidi do pozic
//  - org mapu SMAZAT NESMÍ — mazání struktury zůstává adminovi
//  - když příznak nemá nikdo, zastává správcovství admin (jako dosud)
//
// ⚠️ Nestačí ověřit, že routy pouštějí: bez edit sdílení org mapy by správce
// narazil na RLS a editor by mu strukturu ukázal jen ke čtení. Sada proto čte
// i shared_with_edit a zkouší PATCH mapy přímo.
const { execSync } = require('child_process');

const NAME = 'kb-e2e-org-spravce';
const PORT = 20793;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0, code = 1;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    const rA = await reg('admin@example.com');   // první = admin
    const rH = await reg('hr@example.com');      // budoucí správce struktury
    const rC = await reg('clen@example.com');    // běžný člen — kontrolní vzorek
    const A = await login('admin@example.com');
    const H = await login('hr@example.com');
    const C = await login('clen@example.com');

    console.log('== příznak si nikdo nedá sám ==');
    expect(rH.json.is_org_manager !== true, 'registrace správcovství struktury NEdává');
    // ⚠️ Tvrzení musí ověřovat i STATUS. Tvar `r.json.X !== 'admin'` projde
    // i tehdy, když routa vrátí chybu a v odpovědi žádné X není — sada by
    // zůstala zelená, i kdyby zápis vůbec nefungoval (nález panelu 17. 8.).
    let r = await api('PATCH', `/api/collections/users/records/${rH.json.id}`, { token: H, body: { is_org_manager: true } });
    expect(r.status === 200 && r.json.is_org_manager === false, 'člen si příznak sám nenastaví');
    r = await api('PATCH', `/api/collections/users/records/${rC.json.id}`, { token: H, body: { is_org_manager: true } });
    expect(r.status >= 400 || r.json.is_org_manager !== true, `ani ho nedá kolegovi (${r.status})`);

    console.log('== bez příznaku strukturu spravuje jen admin (jako dosud) ==');
    let om = await api('POST', '/api/flowmap/org-map', { token: H, body: {} });
    expect(om.status === 403, `HR bez příznaku org mapu nezaloží (${om.status})`);
    om = await api('POST', '/api/flowmap/org-map', { token: A, body: {} });
    expect(om.status === 200 && !!om.json.map, 'admin org mapu založí');
    const orgId = om.json.map.id;

    console.log('== admin příznak udělí a sdílení se srovná HNED ==');
    r = await api('PATCH', `/api/collections/users/records/${rH.json.id}`, { token: A, body: { is_org_manager: true } });
    expect(r.status === 200 && r.json.is_org_manager === true, 'admin příznak nastaví');
    await sleep(400);
    let mapa = (await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: A })).json;
    expect((mapa.shared_with_edit || []).includes('hr@example.com'),
      `správce dostal edit na org mapu bez otevírání struktury (${JSON.stringify(mapa.shared_with_edit || [])})`);
    const members = (await api('GET', '/api/flowmap/members', { token: C })).json.members;
    expect(members.find((m) => m.email === 'hr@example.com').is_org_manager === true, '/members vrací příznak');

    console.log('== o jmenování se člověk DOZVÍ (zvoneček) ==');
    // Richard 17. 8.: „čekal bych, že dostane notifikaci na zvonek". Tichá
    // pravomoc je k ničemu — člověk neví, že ji má, ani kde ji použít.
    const zvonek = (await api('GET', '/api/collections/notifications/records?perPage=20&sort=-created', { token: H })).json.items || [];
    const oJmenovani = zvonek.find((n) => /správcem organizační struktury|structure manager/.test(String(n.text || '')));
    expect(!!oJmenovani, `na zvonku je oznámení o jmenování (${(zvonek[0] || {}).text || 'zvonek prázdný'})`);
    expect(oJmenovani && /panáčkem|avatar/.test(String(oJmenovani.text)),
      'a rovnou navádí, kde strukturu najít');

    console.log('== správce má vlastní vstupní bod (nabídka pod panáčkem) ==');
    // Tabulka struktury je ve Správě uživatelů, kam se ne-admin nedostane.
    // Jediná cesta správce vede přes /org-map — ta ho tedy MUSÍ pustit,
    // jinak nemá kde začít (Richard 17. 8.: „kde má Jana začít upravovat?").
    const otevri = await api('POST', '/api/flowmap/org-map', { token: H, body: {} });
    expect(otevri.status === 200 && otevri.json.map && otevri.json.map.id === orgId,
      `správce otevře strukturu sám a dostane TUTÉŽ mapu (${otevri.status})`);

    console.log('== správce SMÍ měnit strom pozic i jmenovat lidi ==');
    const pridej = await api('POST', '/api/flowmap/org-structure/add', { token: H, body: { title: 'Vedoucí výroby' } });
    expect(pridej.status === 200 && !!pridej.json.position, `správce založí pozici (${pridej.status})`);
    const pozId = pridej.json.position && pridej.json.position.node_id;
    const jmenuj = await api('POST', '/api/flowmap/org-structure/assign', { token: H, body: { node_id: pozId, holder: 'clen@example.com' } });
    expect(jmenuj.status === 200, `správce jmenuje držitele pozice (${jmenuj.status})`);
    const struktura = (await api('GET', '/api/flowmap/org-structure', { token: H })).json;
    const radek = (struktura.positions || []).find((p) => p.node_id === pozId);
    expect(radek && radek.holder === 'clen@example.com', `jmenování se opravdu zapsalo (${radek && radek.holder})`);
    // a přímý PATCH mapy (editor kreslí strukturu tudy, ne přes /org-structure)
    const cerstva = (await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: H })).json;
    const patch = await api('PATCH', `/api/collections/goalmaps/records/${orgId}`, { token: H, body: {
      nodes: (cerstva.nodes || []).map((n) => (n.id === pozId ? { ...n, data: { ...n.data, title: 'Vedoucí provozu' } } : n)),
      edges: cerstva.edges || [], base_updated: cerstva.updated,
    } });
    expect(patch.status === 200, `správce edituje org mapu i přímo v editoru (${patch.status})`);

    console.log('== personální agenda: zástupce, pozvánky, reset hesla ANO ==');
    // Richard 17. 8.: „nemohla by měnit role ani správce, ale mohla by dávat
    // zástupce… vlastně i zvát uživatele a měnit hesla."
    const dep = await api('POST', '/api/flowmap/member-deputy', { token: H, body: { id: rC.json.id, deputy: 'admin@example.com' } });
    expect(dep.status === 200 && dep.json.deputy === 'admin@example.com', `správce zapíše zástupce (${dep.status}, ${dep.json && dep.json.deputy})`);
    // ⚠️ a NIC JINÉHO než zástupce: přímý PATCH cizího účtu mu databáze nepustí,
    // jinak by mohl přepsat cizí e-mail a s právem měnit hesla převzít identitu
    const cizi = await api('PATCH', `/api/collections/users/records/${rC.json.id}`, { token: H, body: { email: 'utok@example.com' } });
    expect(cizi.status >= 400, `na cizí účet přímo NEsmí (${cizi.status})`);
    const pozvanka = await api('POST', '/api/flowmap/invite', { token: H, body: { email: 'novy@example.com' } });
    expect(pozvanka.status === 200, `správce pozve nového uživatele (${pozvanka.status})`);
    // ⚠️ vlastní „oběť": reset hesla zneplatní relaci, a kdybych sáhl na clen@,
    // padala by pak další tvrzení na 401 místo očekávaného 403 (naběhl jsem na to)
    await reg('obet@example.com');
    const resetHesla = await api('POST', '/api/flowmap/reset-user-password', { token: H, body: { email: 'obet@example.com' } });
    expect(resetHesla.status === 200, `správce obnoví heslo člena (${resetHesla.status})`);

    console.log('== ale ROLE ani SPRÁVCOVSTVÍ měnit nesmí (nesmí si povýšit sebe) ==');
    let esk = await api('PATCH', `/api/collections/users/records/${rH.json.id}`, { token: H, body: { role: 'admin' } });
    expect(esk.status === 200 && esk.json.role === 'user', `správce si NEudělá roli admina (${esk.status}, ${esk.json && esk.json.role})`);
    esk = await api('PATCH', `/api/collections/users/records/${rC.json.id}`, { token: H, body: { role: 'admin' } });
    expect(esk.status >= 400 || esk.json.role !== 'admin', `ani nepovýší kolegu (${esk.status})`);
    esk = await api('PATCH', `/api/collections/users/records/${rC.json.id}`, { token: H, body: { is_org_manager: true } });
    expect(esk.status >= 400 || esk.json.is_org_manager !== true, `ani nejmenuje dalšího správce struktury (${esk.status})`);
    esk = await api('PATCH', `/api/collections/users/records/${rC.json.id}`, { token: H, body: { is_ai_manager: true } });
    expect(esk.status >= 400 || esk.json.is_ai_manager !== true, `ani správce AI (${esk.status})`);

    // ⭐ NEJDŮLEŽITĚJŠÍ TVRZENÍ CELÉ SADY. Tudy vedla ověřená eskalace: routa
    // srážela roli jen manažerovi, takže správce struktury (role `user`) si
    // pozvánkou založil administrátorský účet — a bez SMTP dostal heslo rovnou
    // v odpovědi. Sada dřív ověřovala jen „pozvánka projde", ne s jakou rolí.
    const eskPozvanka = await api('POST', '/api/flowmap/invite', { token: H, body: { email: 'podvrzeny-admin@example.com', role: 'admin' } });
    expect(eskPozvanka.status === 200 && eskPozvanka.json.role === 'user',
      `pozvánka s rolí admin vyrobí jen ČLENA (${eskPozvanka.status}, role=${eskPozvanka.json && eskPozvanka.json.role})`);
    const clenove = (await api('GET', '/api/flowmap/members', { token: A })).json.members || [];
    const podvrzeny = clenove.find((m) => m.email === 'podvrzeny-admin@example.com');
    expect(podvrzeny && podvrzeny.role === 'user',
      `a v databázi má opravdu roli člen (${podvrzeny && podvrzeny.role})`);
    // ⚠️ Nejdůležitější hranice: přepsáním hesla ADMINA by si převzal instanci
    const resetAdmina = await api('POST', '/api/flowmap/reset-user-password', { token: H, body: { email: 'admin@example.com' } });
    expect(resetAdmina.status === 403, `heslo ADMINA přepsat NESMÍ (${resetAdmina.status})`);
    // ⚠️ Hranice „role je hranice" z 11. 8. nepočítala s tím, že vedle rolí
    // porostou PŘÍZNAKY se skutečnou mocí. Přepsáním hesla správci AI by si
    // správce struktury převzal registr agentů i s klíči.
    await api('PATCH', `/api/collections/users/records/${rC.json.id}`, { token: A, body: { is_ai_manager: true } });
    const resetAi = await api('POST', '/api/flowmap/reset-user-password', { token: H, body: { email: 'clen@example.com' } });
    expect(resetAi.status === 403, `heslo SPRÁVCE AI přepsat NESMÍ (${resetAi.status})`);
    const depAi = await api('POST', '/api/flowmap/member-deputy', { token: H, body: { id: rC.json.id, deputy: 'hr@example.com' } });
    expect(depAi.status === 403, `a nevetře se mu ani jako zástupce (${depAi.status})`);
    await api('PATCH', `/api/collections/users/records/${rC.json.id}`, { token: A, body: { is_ai_manager: false } });
    // totéž vůči adminovi: `users.deputy` je fallback dynamického cíle „zástupce
    // zodpovědné osoby", takže zápisem k adminovi by si správce přesměroval
    // jeho práci i notifikace na sebe (ověřeno živě 17. 8.)
    const admId = (await api('GET', '/api/flowmap/members', { token: A })).json.members.find((m) => m.email === 'admin@example.com').id;
    const depAdmin = await api('POST', '/api/flowmap/member-deputy', { token: H, body: { id: admId, deputy: 'hr@example.com' } });
    expect(depAdmin.status === 403, `zástupcem ADMINA se neudělá (${depAdmin.status})`);
    expect(depAdmin.json && /administrátor/i.test(String(depAdmin.json.error || '')),
      `a hláška ŘEKNE PROČ, ne „něco se pokazilo" (${(depAdmin.json || {}).error})`);
    // ⚠️ SÁM SOBĚ zástupce nastavit SMÍ — spravovat zastupování je jeho práce
    // a nikomu tím nic nebere. Stráž výš byla nejdřív tak široká, že vyloučila
    // i jeho vlastní účet (Richardův klik-test 18. 8.).
    const depSam = await api('POST', '/api/flowmap/member-deputy', { token: H, body: { id: rH.json.id, deputy: 'clen@example.com' } });
    expect(depSam.status === 200 && depSam.json.deputy === 'clen@example.com',
      `sám sobě zástupce nastaví (${depSam.status}, ${depSam.json && depSam.json.deputy})`);

    console.log('== SPRÁVA mapy zůstává adminovi: archivace, zveřejnění, sdílení ==');
    // ⚠️ Archivace má prakticky stejný účinek jako smazání — findOrgMap
    // archivovanou mapu nevrací, takže zmizí tabulka zastupování i cíle
    // pravidel „position:". Panel 17. 8. tudy zákaz mazání obešel a admin
    // to nedokázal vrátit, protože ta pole smí měnit jen vlastník mapy.
    const cerstva2 = (await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: A })).json;
    const arch = await api('PATCH', `/api/collections/goalmaps/records/${orgId}`, { token: H, body: { archived: true, base_updated: cerstva2.updated } });
    const poArch = (await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: A })).json;
    expect(!poArch.archived, `správce strukturu NEARCHIVUJE (odpověď ${arch.status}, archived=${poArch.archived})`);
    const strukturaZiva = await api('GET', '/api/flowmap/org-structure', { token: C });
    expect(strukturaZiva.json.exists === true, 'a struktura je pro celou firmu pořád živá');

    // vlastníkem org mapy MUSÍ být admin, i když ji zakládal někdo jiný —
    // vlastnictví je silnější než role (archivace, zveřejnění, v1 zápis)
    // a `owner` má cascadeDelete: smazáním účtu personalisty by struktura zmizela
    expect(poArch.owner_email === 'admin@example.com',
      `org mapu vlastní ADMIN, ne zakladatel (${poArch.owner_email})`);

    const zverejni = await api('POST', '/api/flowmap/share', { token: H, body: { action: 'toggle_public', mapId: orgId } });
    expect(zverejni.status === 403, `strukturu firmy NEZVEŘEJNÍ (${zverejni.status})`);
    const rozda = await api('POST', '/api/flowmap/share', { token: H, body: { action: 'share', mapId: orgId, email: 'cizi@example.com', permission: 'edit' } });
    expect(rozda.status === 403, `ani ji nerozdá cizí adrese (${rozda.status})`);

    console.log('== ani přes API klíč (v1 má strukturu jen ke ČTENÍ) ==');
    // Závazné rozhodnutí z v0.30: „klíč nesmí eskalovat, jmenování jen v aplikaci."
    // Bez brány stačilo být vlastníkem mapy a přes klíč se dalo zapisovat
    // i po odebrání práv.
    const klic = (await api('POST', '/api/flowmap/api-keys', { token: H, body: { label: 'test', scope: 'read_write' } })).json.token;
    const v1zapis = await fetch(`${BASE}/api/kb/v1/maps/${orgId}/nodes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${klic}` },
      body: JSON.stringify({ nodes: [{ title: 'Podvržená pozice' }] }),
    });
    expect(v1zapis.status >= 400, `zápis do struktury přes API klíč ODMÍTNUT (${v1zapis.status})`);
    const v1cteni = await fetch(`${BASE}/api/kb/v1/org-structure`, { headers: { Authorization: `Bearer ${klic}` } });
    expect(v1cteni.status === 200, `ale ČTENÍ struktury přes klíč dál funguje (${v1cteni.status})`);
    // ⚠️ Předchozí tvrzení odmítlo zápis kvůli VLASTNICTVÍ (mapu vlastní admin),
    // takže samotnou bránu „v1 = jen čtení" netestuje. Tohle ano: klíč ADMINA,
    // který vlastníkem JE. Bez toho by brána mohla být rozbitá a nikdo by to
    // nepoznal, dokud by se nezměnilo vlastnictví.
    const klicA = (await api('POST', '/api/flowmap/api-keys', { token: A, body: { label: 'admin-test', scope: 'read_write' } })).json.token;
    // routa chce verzi mapy DŘÍV, než se dostane ke stráži — bez ní by tvrzení
    // měřilo jen chybějící base_updated, ne bránu samotnou
    const verze = await (await fetch(`${BASE}/api/kb/v1/maps/${orgId}`, { headers: { Authorization: `Bearer ${klicA}` } })).json();
    const v1zapisA = await fetch(`${BASE}/api/kb/v1/maps/${orgId}/nodes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${klicA}` },
      body: JSON.stringify({ items: [{ title: "Podvržená pozice adminovým klíčem" }], base_updated: (verze.map || verze).updated }),
    });
    let telo = null; try { telo = await v1zapisA.json(); } catch { /* prázdné */ }
    expect(v1zapisA.status === 403, `ani ADMINŮV klíč do struktury nezapíše (${v1zapisA.status}: ${(telo && telo.error) || ''})`);
    const poV1 = (await api('GET', '/api/flowmap/org-structure', { token: A })).json;
    expect(!(poV1.positions || []).some((x) => /Podvržená/.test(String(x.title || ''))),
      'a žádná podvržená pozice ve struktuře nepřibyla');

    console.log('== ale SMAZAT strukturu nesmí (mazání ≠ editace) ==');
    const smaz = await api('DELETE', `/api/collections/goalmaps/records/${orgId}`, { token: H });
    expect(smaz.status >= 400, `správce org mapu NEsmaže (${smaz.status})`);
    const poradPlati = (await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: A })).json;
    expect(!!poradPlati.id, 'org mapa po pokusu o smazání pořád existuje');

    console.log('== běžný člen dál nesmí nic ==');
    const clenAdd = await api('POST', '/api/flowmap/org-structure/add', { token: C, body: { title: 'Podvržená pozice' } });
    expect(clenAdd.status === 403, `člen pozici nezaloží (${clenAdd.status})`);
    const clenAssign = await api('POST', '/api/flowmap/org-structure/assign', { token: C, body: { node_id: pozId, holder: 'clen@example.com' } });
    expect(clenAssign.status === 403, `člen nejmenuje (${clenAssign.status})`);
    // ⚠️ číst se MUSÍ tokenem ČLENA — dřív se tu měřila `struktura` načtená
    // tokenem správce, což o právech člena nedokazovalo nic
    const strukturaC = await api('GET', '/api/flowmap/org-structure', { token: C });
    expect(strukturaC.status === 200 && (strukturaC.json.positions || []).length > 0,
      `ČÍST strukturu ale smí každý (${strukturaC.status}, ${(strukturaC.json.positions || []).length} pozic)`);

    console.log('== odebrání příznaku právo VEZME (i sdílení) ==');
    r = await api('PATCH', `/api/collections/users/records/${rH.json.id}`, { token: A, body: { is_org_manager: false } });
    expect(r.status === 200 && r.json.is_org_manager === false, 'admin příznak odebere');
    await sleep(400);
    mapa = (await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: A })).json;
    expect(!(mapa.shared_with_edit || []).includes('hr@example.com'),
      `bývalý správce přišel i o edit sdílení (${JSON.stringify(mapa.shared_with_edit || [])})`);
    const poOdebrani = await api('POST', '/api/flowmap/org-structure/add', { token: H, body: { title: 'Už ne' } });
    expect(poOdebrani.status === 403, `bývalý správce už pozici nezaloží (${poOdebrani.status})`);

    console.log('== admin má práva pořád, i když je jmenovaný jiný správce ==');
    await api('PATCH', `/api/collections/users/records/${rH.json.id}`, { token: A, body: { is_org_manager: true } });
    const adminPoJmenovani = await api('POST', '/api/flowmap/org-structure/add', { token: A, body: { title: 'Adminova pozice' } });
    expect(adminPoJmenovani.status === 200, `admin zakládá pozice dál (${adminPoJmenovani.status})`);

    code = fail === 0 ? 0 : 1;
  } catch (e) {
    console.error('NEOČEKÁVANÁ CHYBA SADY:', e);
    fail++;
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} ORG-SPRAVCE-STRUKTURY PASS ${pass} / FAIL ${fail}`);
  process.exit(code);
})();
