// E-maily účtů malými písmeny (Richard 27. 8. 2026; dluh 1+2 po v0.46, nálezy S4-01/S6-02/S3-04).
//  • registrace `Velky.Pismeno@Example.com` → uloží se lowercase; přihlášení jde velkými i malými
//  • sdílení takovému účtu z UI (/share ukládá lowercase) DORUČÍ — mapa 200, ne 404
//  • migrace users_email_lowercase: data z image BEZ opravy (KB_STARY_IMAGE) → nový image:
//    users.email, owner_email, map_shares.email, shared_with*, nodes[].data.owner přepsané;
//    dvojčata (Dup@ + dup@) se NEmění, jen zalogují; uživatel se po migraci přihlásí
// Mutačně: proti buildu bez opravy zčervená registrace (uloží velká písmena) i sdílení (404).
const H = require('./_harness');
const { expect, sleep, PW } = H;
const STARY = process.env.KB_STARY_IMAGE || ''; // image před opravou (pro upgrade test); bez něj se sekce přeskočí

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'lowercase', env: { KB_UVODNI_MAPA: 0 } });
  const { api } = inst;

  console.log('== registrace a přihlášení ==');
  let r = await inst.register('Velky.Pismeno@Example.com', { name: 'Velký' });
  expect(r.status === 200 && r.json.email === 'velky.pismeno@example.com', `registrace uloží e-mail malými písmeny (${r.json && r.json.email})`);
  r = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'velky.pismeno@example.com', password: PW } });
  expect(r.status === 200, `přihlášení malými písmeny (${r.status})`);
  const VP = r.json && r.json.token;
  // registrace „dvojčete" jinou velikostí písmen → unikát chytí (obě se ukládají lowercase)
  r = await inst.register('VELKY.PISMENO@example.com');
  expect(r.status !== 200, `druhá registrace lišící se jen velikostí písmen neprojde (${r.status})`);
  await inst.register('vlastnik@example.com');
  const A = await inst.login('vlastnik@example.com');

  console.log('== sdílení z UI doručí (dřív 404 pro mixed-case účet) ==');
  const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Sdílená', nodes: [
    { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { title: 'Cíl', status: 'todo' } },
    { id: 'n1', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'Úkol', status: 'todo', owner: 'velky.pismeno@example.com' } },
  ], edges: [{ id: 'e1', source: 'root', target: 'n1' }] } })).json;
  r = await api('POST', '/api/kb/share', { token: A, body: { action: 'share', mapId: map.id, email: 'Velky.Pismeno@Example.com', permission: 'edit' } });
  expect(r.status === 200, `sdílení projde (${r.status})`);
  r = await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: VP });
  expect(r.status === 200, `sdílený účet mapu VIDÍ (${r.status})`);
  r = await api('GET', '/api/kb/my-day', { token: VP });
  expect(r.status === 200 && JSON.stringify(r.json).includes('Úkol'), 'a má úkol v Můj den');

  // ZMĚNA e-mailu obcházela lowercase (panel 31. 8. 2026): create hook normalizuje
  // jen registraci; PB confirm-email-change zapisuje record.setEmail + app.save →
  // modelový hook onRecordUpdate (users) — TÝŽ hook chytá i PATCH users. Testuje
  // se PATCH (e2e confirm flow s mailem netřeba — zápisová cesta je společná).
  console.log('== změna e-mailu účtu (update) → lowercase ==');
  const SUP = await inst.superuser();
  r = await api('GET', `/api/collections/users/records?filter=${encodeURIComponent('email = "velky.pismeno@example.com"')}`, { token: SUP });
  const uid = r.json && r.json.items && r.json.items[0] && r.json.items[0].id;
  expect(!!uid, 'účet velky.pismeno nalezen');
  r = await api('PATCH', `/api/collections/users/records/${uid}`, { token: SUP, body: { email: 'Zmeneny.Mail@Example.com' } });
  expect(r.status === 200 && r.json.email === 'zmeneny.mail@example.com', `změna e-mailu se uloží malými písmeny (${r.status}, ${r.json && r.json.email})`);
  r = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'zmeneny.mail@example.com', password: PW } });
  expect(r.status === 200, `účet se po změně přihlásí malými písmeny (${r.status})`);
  // kolize: nová adresa se od JINÉHO účtu liší jen velikostí písmen → po
  // normalizaci narazí na unikát (standardní PB chyba), žádné tiché dvojče
  r = await api('PATCH', `/api/collections/users/records/${uid}`, { token: SUP, body: { email: 'VLASTNIK@example.com' } });
  expect(r.status === 400, `změna na adresu existujícího účtu (jinou velikostí) skončí chybou unikátu (${r.status})`);

  if (!STARY) { console.log('== upgrade test přeskočen (KB_STARY_IMAGE není) =='); return; }
  console.log('== migrace: data z image bez opravy → nový image ==');
  // ⚠️ harness stop() maže volume → upgrade test používá vlastní pojmenovaný volume a kontejner ruší přímo
  const { execSync } = require('child_process');
  const V = `kb-lc-vol-${Date.now()}`;
  execSync(`docker volume create ${V}`, { stdio: 'ignore' });
  const old2 = await H.startInstance({ slug: 'lowercase-old2', env: { KB_UVODNI_MAPA: 0 }, volume: V, image: STARY });
  await old2.register('Mixed.Case@Example.com'); await old2.register('kolega@example.com');
  await old2.register('Dup@example.com'); await old2.register('dup@example.com');
  const MC2 = await old2.login('Mixed.Case@Example.com'); const K2 = await old2.login('kolega@example.com');
  // shared_with rovnou při založení: starý hook z něj založí i řádek map_shares s velkými písmeny (reálný tvar starých dat)
  const mm = (await old2.api('POST', '/api/collections/goalmaps/records', { token: K2, body: { title: 'Kolegova', shared_with: ['Mixed.Case@Example.com'], shared_with_edit: ['Mixed.Case@Example.com'], nodes: [
    { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { title: 'Cíl', status: 'todo' } },
    { id: 'n1', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'Pro MC', status: 'todo', owner: 'Mixed.Case@Example.com' } },
  ], edges: [{ id: 'e1', source: 'root', target: 'n1' }] } })).json;
  // E-mailová pole UVNITŘ node.data pro migraci 2 (panel 31. 8. 2026): assignedBy
  // vzniká VÝHRADNĚ serverovým razítkem (stampAssignedBy z e-mailu aktéra) — ve
  // starém image je aktér Mixed.Case@Example.com, takže PRVNÍ nastavení termínu
  // vyrazítkuje mixed-case (přesný vznik dat v terénu). holder/deputy jsou
  // kanonická pole a na běžné (ne-org) mapě se zapisují přímo; deputy dostane
  // adresu BEZ účtu — kontrola, že migrace 2 přepisuje jen hodnoty kotvené na users.
  const mcMapa = (await old2.api('GET', `/api/collections/goalmaps/records/${mm.id}`, { token: MC2 })).json;
  const rPatch = await old2.api('PATCH', `/api/collections/goalmaps/records/${mm.id}`, { token: MC2, body: { nodes: (mcMapa.nodes || []).map((n) => (n.id === 'n1'
    ? { ...n, data: { ...n.data, deadline: '2026-12-31', holder: 'Mixed.Case@Example.com', deputy: 'Externista@Nikde.cz' } }
    : n)) } });
  expect(rPatch.status === 200, `MC nastavil termín (razítko assignedBy) + holder/deputy (${rPatch.status})`);
  // předpoklad PŘED migrací (superuser): mapa má shared_with s velkými písmeny a řádek map_shares
  const SU2 = await old2.superuser();
  const pred = (await old2.api('GET', `/api/collections/goalmaps/records/${mm.id}`, { token: SU2 })).json;
  expect((pred.shared_with || []).includes('Mixed.Case@Example.com'), `PŘED: shared_with nese velká písmena (${JSON.stringify(pred.shared_with)})`);
  const n1Pred = (((pred.nodes || []).find((n) => n.id === 'n1') || {}).data) || {};
  expect(n1Pred.assignedBy === 'Mixed.Case@Example.com' && n1Pred.holder === 'Mixed.Case@Example.com',
    `PŘED: assignedBy (serverové razítko) i holder nesou velká písmena (${n1Pred.assignedBy} / ${n1Pred.holder})`);
  const shPred = (await old2.api('GET', `/api/collections/map_shares/records?filter=${encodeURIComponent(`map="${mm.id}"`)}`, { token: SU2 })).json;
  expect(shPred.items && shPred.items.some((s) => s.email === 'Mixed.Case@Example.com'), `PŘED: map_shares má řádek s velkými písmeny (${JSON.stringify((shPred.items || []).map((s) => s.email))})`);
  execSync(`docker rm -f ${old2.name}`, { stdio: 'ignore' }); // jen kontejner, volume zůstává
  const nov = await H.startInstance({ slug: 'lowercase-new', env: { KB_UVODNI_MAPA: 0 }, volume: V });
  const ST = await nov.superuser();
  const users = (await nov.api('GET', '/api/collections/users/records?perPage=50', { token: ST })).json.items.map((u) => u.email).sort();
  expect(users.includes('mixed.case@example.com') && !users.includes('Mixed.Case@Example.com'), `users.email přepsán na lowercase (${users.join(',')})`);
  expect(users.includes('Dup@example.com') && users.includes('dup@example.com'), 'dvojčata Dup@/dup@ se NEMĚNÍ (rozhodne člověk)');
  const logy = nov.logs(300);
  console.log(logy.split('\n').filter((l) => /users_email_lowercase/.test(l)).map((l) => '   log: ' + l.slice(0, 160)).join('\n'));
  expect(/DVOJČE/.test(logy), 'dvojče je zalogované');
  r = await nov.api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'mixed.case@example.com', password: PW } });
  expect(r.status === 200, `migrovaný účet se přihlásí malými písmeny (${r.status})`);
  const MC3 = r.json.token;
  const mapa = (await nov.api('GET', `/api/collections/goalmaps/records/${mm.id}`, { token: MC3 })).json;
  const po = (await nov.api('GET', `/api/collections/goalmaps/records/${mm.id}`, { token: ST })).json;
  console.log('   PO: shared_with=' + JSON.stringify(po.shared_with) + ' owners=' + JSON.stringify((po.nodes || []).map((n) => n.data && n.data.owner)));
  expect(mapa && mapa.id === mm.id, `migrovaný účet vidí sdílenou mapu (${mapa && mapa.id ? 'ano' : JSON.stringify(mapa).slice(0, 60)})`);
  expect(mapa && (mapa.shared_with || []).includes('mixed.case@example.com') && (mapa.nodes || []).some((n) => n.data && n.data.owner === 'mixed.case@example.com'),
    'shared_with i data.owner v mapě přepsány na lowercase');
  // migrace 2 (users_email_lowercase_2): další e-mailová pole node.data
  const n1Po = (((po.nodes || []).find((n) => n.id === 'n1') || {}).data) || {};
  expect(n1Po.assignedBy === 'mixed.case@example.com' && n1Po.holder === 'mixed.case@example.com',
    `migrace 2: assignedBy i holder v uzlech přepsány na lowercase (${n1Po.assignedBy} / ${n1Po.holder})`);
  expect(n1Po.deputy === 'Externista@Nikde.cz', `hodnota bez odpovídajícího účtu se NEMĚNÍ (deputy: ${n1Po.deputy})`);
  expect(/users_email_lowercase_2:.*přepsáno polí/.test(logy), 'migrace 2 zalogovala počty');
  const sh = (await nov.api('GET', `/api/collections/map_shares/records?filter=${encodeURIComponent(`map="${mm.id}"`)}`, { token: ST })).json;
  expect(sh.items.some((s) => s.email === 'mixed.case@example.com'), 'map_shares.email přepsán');
  execSync(`docker rm -f ${nov.name}; docker volume rm -f ${V}`, { stdio: 'ignore' });
}, { nazev: 'E-MAILY LOWERCASE' });
