// Strop počtu uživatelů instance (KB_MAX_USERS) — zkušebka a Cloud Lite mají 2 křesla.
//
// Zavedeno 6. 8. 2026 s registračním trychtýřem. Produkt do té doby žádný strop
// NEZNAL, takže by zkušebka byla neomezená a slib „2 lidé" na webu by nebyl pravda.
//
// Mutačně (ne jen „nad strop to nejde"):
//  - do stropu to JDE (jinak by test prošel i tehdy, kdyby se nedalo nic),
//  - obě cesty do users: self-registrace i POZVÁNKA adminem ($app.save obchází
//    record hook — na tom se dá strop obejít a přesně to test hlídá),
//  - strop platí i na admina,
//  - uvolněné místo po smazání účtu jde znovu obsadit,
//  - bez KB_MAX_USERS je instance neomezená (self-host a Privát).
const { execSync } = require('child_process');

const PORT = 20542;
const BASE = `http://127.0.0.1:${PORT}`;
const NAME = 'kb-e2e-trial-limity';
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

const VOLUME = 'kb-e2e-trial-data';

async function start(env, { volume = false } = {}) {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  const v = volume ? `-v ${VOLUME}:/app/pb_data` : '';
  execSync(`docker run -d --name ${NAME} ${v} ${env} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch (e) { /* ještě ne */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('kontejner nenaskočil');
}

const zaloz = (email) => api('POST', '/api/collections/users/records',
  { body: { email, password: HESLO, passwordConfirm: HESLO } });
const prihlas = async (email) => (await api('POST', '/api/collections/users/auth-with-password',
  { body: { identity: email, password: HESLO } })).json?.token;

(async () => {
  try {
    console.log('== strop 2 křesla ==');
    await start('-e KB_MAX_USERS=2');
    const r1 = await zaloz('prvni@e2e.cz');
    expect(r1.status === 200, `první účet projde (${r1.status})`);
    const r2 = await zaloz('druhy@e2e.cz');
    expect(r2.status === 200, `druhý účet projde — strop je 2, ne 1 (${r2.status})`);
    const r3 = await zaloz('treti@e2e.cz');
    expect(r3.status === 403, `třetí účet ODMÍTNUT (${r3.status})`);
    expect(/místa|seats/i.test(JSON.stringify(r3.json)), 'uživatel se dozví, proč to nejde a kam jít');

    console.log('== strop nejde obejít pozvánkou (jiná cesta do users!) ==');
    const tokenAdmin = await prihlas('prvni@e2e.cz');
    expect(!!tokenAdmin, 'admin přihlášen');
    const inv = await api('POST', '/api/kb/invite', { token: tokenAdmin, body: { email: 'pozvany@e2e.cz' } });
    expect(inv.status === 403, `pozvánka nad strop ODMÍTNUTA (${inv.status})`);
    const po = await api('GET', '/api/collections/users/records?perPage=50', { token: tokenAdmin });
    expect(po.json?.totalItems === 2, `pořád jsou 2 účty (${po.json?.totalItems})`);

    console.log('== uvolněné místo jde obsadit ==');
    const druhy = po.json.items.find((u) => u.email === 'druhy@e2e.cz');
    const smaz = await api('DELETE', `/api/collections/users/records/${druhy.id}`, { token: tokenAdmin });
    expect(smaz.status === 204 || smaz.status === 200, `admin smazal účet (${smaz.status})`);
    const r4 = await zaloz('novy@e2e.cz');
    expect(r4.status === 200, `po uvolnění místa registrace zase projde (${r4.status})`);

    console.log('== bez stropu je instance neomezená (self-host, Privát) ==');
    await start('');
    for (let i = 0; i < 4; i++) await zaloz(`bez${i}@e2e.cz`);
    const r5 = await zaloz('paty@e2e.cz');
    expect(r5.status === 200, `pátý účet bez KB_MAX_USERS projde (${r5.status})`);

    console.log('== zkušebka VYPRŠELA: jen pro čtení, data zůstanou ==');
    // Realistický sled: účet a data vzniknou BĚHEM zkušebky, teprve pak vyprší.
    // (Registrace po vypršení je zápis, takže ji zámek právem odmítne — kdyby
    // test zakládal účet až potom, testoval by nesmysl.)
    execSync(`docker volume rm ${VOLUME} 2>/dev/null; true`);
    const zitra0 = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await start(`-e KB_TRIAL_UNTIL=${zitra0}`, { volume: true });
    await zaloz('majitel@e2e.cz');
    const tokPred = await prihlas('majitel@e2e.cz');
    const predTim = await api('POST', '/api/collections/goalmaps/records', {
      token: tokPred, body: { title: 'Práce ze zkušebky', nodes: [], edges: [] } });
    expect(predTim.status === 200, 'během zkušebky vznikla data');
    // API klíč se musí vydat TEĎ — po vypršení je jeho vydání taky zápis (402)
    const klicRes = await api('POST', '/api/kb/api-keys', {
      token: tokPred, body: { name: 'kontrola obejiti', scope: 'read_write' } });
    const apiKey = klicRes.json?.key || klicRes.json?.token;
    const mapaId = predTim.json?.id;
    const mapaUpdated = predTim.json?.updated;
    // Veřejná mapa se musí založit TEĎ — po vypršení je zápis zamčený.
    // (Sdílení nastavuje server, proto zvlášť routou.)
    const verMapa = await api('POST', '/api/collections/goalmaps/records', {
      token: tokPred, body: { title: 'Veřejná ze zkušebky', nodes: [], edges: [] } });
    await api('POST', '/api/kb/share', {
      token: tokPred, body: { action: 'toggle_public', mapId: verMapa.json?.id } });
    // Šablona, která je DNES na řadě. Bez ní by „šablony nic nezaložily" vyšlo
    // nula i s vypnutou brzdou — test by byl vždy zelený a nic by nedokazoval.
    // ⚠️ V UTC, ne v našem čase: kontejner běží bez TZ, takže po půlnoci SELČ
    // je tam ještě včerejšek a šablona by nebyla na řadě. Kvůli tomu test
    // nejdřív procházel i s vypnutou brzdou — tedy nedokazoval nic.
    const dnesDow = ((new Date().getUTCDay() + 6) % 7) + 1;
    const tplRes = await api('POST', '/api/collections/templates/records', { token: tokPred, body: {
      title: 'Šablona na dnešek', node_type: 'mise',
      ai_nodes: [{ id: 'n1', title: 'Kořen', parentId: null }],
      auto_create: 'weekly', auto_day: dnesDow, auto_last: '',
    } });
    expect(!!tplRes.json?.id, `šablona na dnešek založena ještě za běhu zkušebky (den ${dnesDow})`);
    const projektuPred = (await api('GET', '/api/collections/goalmaps/records', { token: tokPred }))
      .json?.items?.length ?? 0;
    await start('-e KB_TRIAL_UNTIL=2020-01-01', { volume: true });   // ...a zkušebka skončila
    const tok = await prihlas('majitel@e2e.cz');
    expect(!!tok, 'PŘIHLÁŠENÍ funguje i po vypršení (jinak by se nedostal ke svým datům)');
    const cfg = await api('GET', '/api/kb/config');
    expect(cfg.json?.trial_expired === true, 'config hlásí vypršenou zkušebku (frontend ukáže pruh)');
    expect(cfg.json?.trial_until === '2020-01-01', `config nese datum konce (${cfg.json?.trial_until})`);
    // ⚠️ Instance si po vypršení nesmí pracovat ANI SAMA. Zámek je middleware nad
    // HTTP requestem, jenže crony přes něj neprocházejí — vypršelá instance si
    // dál zakládala projekty ze šablon a odbavovala agentní běhy (= AI na náš
    // účet), a uživatel to nemohl ani smazat. Spouštíme tytéž funkce ručně
    // routou pro provozovatele, protože cron by se čekal až hodinu.
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.cz superheslo123`, { stdio: 'ignore' });
    const suTok = (await api('POST', '/api/collections/_superusers/auth-with-password',
      { body: { identity: 'su@e2e.cz', password: 'superheslo123' } })).json?.token;
    expect(!!suTok, 'provozovatel se na zamčenou instanci dostane (jinak by ji nešlo opravit)');
    const sablony = await api('POST', '/api/kb/run-auto-templates', { token: suTok });
    expect(sablony.status === 200, `ruční spuštění šablon projde provozovateli (${sablony.status})`);
    expect(sablony.json?.created === 0, `opakované šablony NEZALOŽILY nic (${sablony.json?.created})`);
    const projektuPo = (await api('GET', '/api/collections/goalmaps/records', { token: tok }))
      .json?.items?.length ?? -1;
    expect(projektuPo === projektuPred, `a v datech vážně nic nepřibylo (${projektuPred} → ${projektuPo})`);
    const sumare = await api('POST', '/api/kb/run-daily-summaries', { token: suTok });
    expect(sumare.json?.generated === 0, `AI sumáře se NEGENERUJÍ (${sumare.json?.generated})`);
    const upominky = await api('POST', '/api/kb/run-deadline-notices', { token: suTok });
    expect(upominky.json?.sent === 0, `upomínky na termíny se NEPOSÍLAJÍ (${upominky.json?.sent})`);

    // Čtecí POSTy naopak zhasnout NESMÍ — veřejný odkaz, který zákazník někomu
    // poslal, má platit dál. Bez výjimky vracel i tenhle dotaz 402.
    // ⚠️ Ptát se na SEZNAM tu nic nedokazuje: ten je od 6. 8. jen pro
    // přihlášené a vrací 400, takže „není to 402" projde i s rozbitým zámkem.
    // Ptáme se proto na KONKRÉTNÍ veřejnou mapu — to je ta cesta, která má po
    // vypršení dál fungovat (odkaz, který zákazník někomu poslal).
    const verejne = await api('POST', '/api/kb/public-maps', { body: { mapId: verMapa.json?.id } });
    expect(verejne.status === 200, `veřejná mapa jde otevřít i po vypršení (${verejne.status})`);

    const cti = await api('GET', '/api/collections/goalmaps/records', { token: tok });
    expect(cti.status === 200, `ČTENÍ map jde dál — export není zablokovaný (${cti.status})`);
    expect(cti.json?.items?.some((m) => m.title === 'Práce ze zkušebky'),
      'DATA ZE ZKUŠEBKY JSOU TAM — nic se nesmazalo');
    const zapis = await api('POST', '/api/collections/goalmaps/records', {
      token: tok, body: { title: 'Po vypršení', nodes: [], edges: [] } });
    expect(zapis.status === 402, `ZÁPIS odmítnut s 402 Payment Required (${zapis.status})`);
    expect(/Zkušební doba|trial/i.test(JSON.stringify(zapis.json)), 'uživatel se dozví proč a kam jít');
    const zapisRouta = await api('POST', '/api/kb/invite', { token: tok, body: { email: 'kdokoli@e2e.cz' } });
    expect(zapisRouta.status === 402, `i VLASTNÍ ROUTY jsou zamčené (${zapisRouta.status}) — record hooky je nevidí`);

    console.log('== zámek nejde obejít jménem uzlu ==');
    // ⚠️ Výjimka pro přihlašovací cesty byla kotvená na KONEC cesty, takže uzel
    // pojmenovaný „auth-refresh" propašoval zápis i po vypršení. (Panel 6. 8.)
    if (apiKey && mapaId) {
      const podvrh = await fetch(`${BASE}/api/kb/v1/maps/${mapaId}/nodes/auth-refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ items: [{ title: 'ZAPSANO PO VYPRSENI' }], base_updated: mapaUpdated }),
      });
      expect(podvrh.status === 402, `uzel jménem „auth-refresh" NEPROJDE (${podvrh.status})`);
      // pojistka, že test není vždy-zelený: běžný název uzlu musí padnout stejně
      const bezny = await fetch(`${BASE}/api/kb/v1/maps/${mapaId}/nodes/jinyuzel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ items: [{ title: 'x' }], base_updated: mapaUpdated }),
      });
      expect(bezny.status === 402, `běžný uzel taky 402 (${bezny.status})`);
    } else {
      expect(false, 'nepodařilo se připravit API klíč a mapu za běhu zkušebky');
    }

    console.log('== zkušebka BĚŽÍ: nic se neblokuje ==');
    const zitra = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await start(`-e KB_TRIAL_UNTIL=${zitra}`);
    await zaloz('bezici@e2e.cz');
    const tok2 = await prihlas('bezici@e2e.cz');
    const zapis2 = await api('POST', '/api/collections/goalmaps/records', {
      token: tok2, body: { title: 'Během zkušebky', nodes: [], edges: [] } });
    expect(zapis2.status === 200, `během zkušebky se normálně zapisuje (${zapis2.status})`);
    const cfg2 = await api('GET', '/api/kb/config');
    expect(cfg2.json?.trial_expired === false, 'config: zkušebka běží');

    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
  } catch (err) {
    console.error('CHYBA BĚHU:', err.message);
    process.exitCode = 1;
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker volume rm ${VOLUME} 2>/dev/null; true`);
  }
})();
