// Přechod ze zkušebky (bez stropu lidí) na Cloud Lite (dva) — účtů je víc,
// než na kolik tarif je.
//
// Richardův nález 6. 8. 2026: „nemůžu přece mít v lite 5 lidí, když je pro 2.
// To by ve zkušebce mohl dát 100 lidí a pak přijít na lite a zůstali by mu."
// Přesně tak by to dopadlo — strop se dosud kontroloval jen při ZAKLÁDÁNÍ účtu
// (`>= max`), takže účty, které vznikly ve zkušebce, na placeném tarifu klidně
// běžely dál. Tarif pro dva by si tak koupil kdokoli pro celou firmu.
//
// Zámek drží, dokud si zákazník účty neprobere. Mazat je za něj nebudeme —
// kdo zůstane, je jeho rozhodnutí; odebírání účtů proto musí projít, jinak
// by se z toho nedalo dostat.
const { execSync } = require('child_process');

const PORT = 20553;
const BASE = `http://127.0.0.1:${PORT}`;
const NAME = 'kb-e2e-strop-prechod';
const VOLUME = 'kb-e2e-strop-data';
const HESLO = 'TestHeslo.2026';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* prázdné tělo */ }
  return { status: res.status, json };
}

async function start(env) {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  execSync(`docker run -d --name ${NAME} -v ${VOLUME}:/app/pb_data ${env} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`,
    { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch (e) { /* ještě ne */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('kontejner nenaskočil');
}

async function zaloz(email, role = 'member') {
  return api('POST', '/api/collections/users/records', {
    body: { email, password: HESLO, passwordConfirm: HESLO, name: email.split('@')[0], role },
  });
}

async function prihlas(email) {
  const r = await api('POST', '/api/collections/users/auth-with-password', {
    body: { identity: email, password: HESLO },
  });
  return r.json?.token;
}

async function main() {
  try {
    console.log('== ve zkušebce vznikne pět lidí (strop tam není) ==');
    execSync(`docker volume rm ${VOLUME} 2>/dev/null; true`);
    const zitra = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    await start(`-e KB_TRIAL_UNTIL=${zitra}`);   // zkušebka: BEZ KB_MAX_USERS
    const lide = ['sef@firma.cz', 'a@firma.cz', 'b@firma.cz', 'c@firma.cz', 'd@firma.cz'];
    let zalozeno = 0;
    for (const [i, mail] of lide.entries()) {
      const r = await zaloz(mail, i === 0 ? 'admin' : 'member');
      if (r.status === 200) zalozeno++;
    }
    expect(zalozeno === 5, `ve zkušebce vzniklo všech 5 účtů (${zalozeno})`);
    const cfg1 = await api('GET', '/api/kb/config');
    expect(cfg1.json?.user_count === 5, `config hlásí počet účtů (${cfg1.json?.user_count})`);
    expect(cfg1.json?.lite_max_users === 2,
      `a strop tarifu, na který se překlápí (${cfg1.json?.lite_max_users}) — lze varovat PŘED nákupem`);
    expect(cfg1.json?.over_user_limit === false, 've zkušebce se nad stropem není (žádný tam není)');

    const tok = await prihlas('sef@firma.cz');
    let zapis = await api('POST', '/api/collections/goalmaps/records', {
      token: tok, body: { title: 'Práce ze zkušebky', nodes: [], edges: [] } });
    expect(zapis.status === 200, 'a normálně se pracuje');

    console.log('== zaplatí Cloud Lite (pro dva) — zámek, dokud účty neprobere ==');
    await start(`-e KB_MAX_USERS=2`);   // povýšeno: strop 2, zkušebka pryč
    const tok2 = await prihlas('sef@firma.cz');
    expect(!!tok2, 'přihlášení funguje dál (nikoho jsme nevyhodili)');
    const cfg2 = await api('GET', '/api/kb/config');
    expect(cfg2.json?.over_user_limit === true,
      `config hlásí překročený strop (${cfg2.json?.user_count} účtů / ${cfg2.json?.max_users})`);

    zapis = await api('POST', '/api/collections/goalmaps/records', {
      token: tok2, body: { title: 'Nová mapa', nodes: [], edges: [] } });
    expect(zapis.status === 409, `zápis se zamkne, dokud je účtů moc (${zapis.status})`);
    const hlaska = String(zapis.json?.error || '');
    expect(/5/.test(hlaska) && /2/.test(hlaska), `hláška říká KOLIK účtů a KOLIK smí ("${hlaska.slice(0, 70)}…")`);
    expect(zapis.json?.code === 'user_limit_exceeded', 'nese strojově čitelný důvod');

    const cti = await api('GET', '/api/collections/goalmaps/records', { token: tok2 });
    expect(cti.status === 200, `čtení jde dál — o data zákazník nepřijde (${cti.status})`);

    console.log('== odebrání účtů z toho ven vede ==');
    // Kdyby zámek blokoval i mazání účtů, zákazník by se z něj nedostal.
    const seznam = await api('GET', '/api/collections/users/records?perPage=50', { token: tok2 });
    const kSmazani = (seznam.json?.items || []).filter((u) => u.email !== 'sef@firma.cz').slice(0, 3);
    let smazano = 0;
    for (const u of kSmazani) {
      const r = await api('DELETE', `/api/collections/users/records/${u.id}`, { token: tok2 });
      if (r.status === 204 || r.status === 200) smazano++;
    }
    expect(smazano === 3, `přebývající účty jde odebrat i při zamčeném zápisu (${smazano}/3)`);

    const cfg3 = await api('GET', '/api/kb/config');
    expect(cfg3.json?.over_user_limit === false, `po úklidu už strop překročený není (${cfg3.json?.user_count})`);
    zapis = await api('POST', '/api/collections/goalmaps/records', {
      token: tok2, body: { title: 'Zase se pracuje', nodes: [], edges: [] } });
    expect(zapis.status === 200, `a zápis zase funguje (${zapis.status})`);

    console.log('== během stěhování se nedá psát ==');
    // Zákazníkovi přišel e-mail „připravujeme váš vlastní server". Od té chvíle
    // nemá do staré instance psát: snímek dat se pořizuje o pár minut později
    // a co napíše potom, by zůstalo na sdíleném boxu. (Richard 6. 8. 2026.)
    await start('-e KB_STEHUJEME=1');
    const tokS = await prihlas('sef@firma.cz');
    expect(!!tokS, 'přihlásit se jde i během stěhování');
    const cfgS = await api('GET', '/api/kb/config');
    expect(cfgS.json?.stehujeme === true, 'config hlásí probíhající stěhování (pruh v UI)');
    const zapisS = await api('POST', '/api/collections/goalmaps/records', {
      token: tokS, body: { title: 'Během stěhování', nodes: [], edges: [] } });
    expect(zapisS.status === 503, `zápis se odmítne jako DOČASNÝ stav (${zapisS.status})`);
    expect(/přesouváme|stěhu|server/i.test(String(zapisS.json?.error || '')),
      `a řekne PROČ ("${String(zapisS.json?.error || '').slice(0, 55)}…")`);
    expect(zapisS.json?.code === 'migrating', 'nese strojově čitelný důvod');
    const ctiS = await api('GET', '/api/collections/goalmaps/records', { token: tokS });
    expect(ctiS.status === 200, `čtení jde dál — do svých dat zákazník vidí (${ctiS.status})`);

    console.log('== šestý účet se stejně nepřidá ==');
    await start('-e KB_MAX_USERS=2');
    const navic = await zaloz('e@firma.cz');
    expect(navic.status !== 200, `nad stropem účet nevznikne (${navic.status})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker volume rm ${VOLUME} 2>/dev/null; true`);
  }

  console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main();
