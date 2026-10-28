// Zámek po konci předplatného (KB_PREDPLATNE_SKONCILO=1) — Richard 28. 10. 2026:
// neplatič po zrušení předplatného Stripe jel naplno dalších 90 dnů až do smazání.
// Stejný mechanismus jako vypršená zkušebka (trial-limity.js), jiná hláška.
//
// Mutačně:
//  - data vzniknou PŘED zámkem a po zámku jsou čitelná (export není zablokovaný),
//  - přihlášení funguje, config hlásí subscription_ended (frontend ukáže pruh),
//  - zápis 402 s hláškou o PŘEDPLATNÉM (ne o zkušebce) — i vlastní routy,
//  - instance si nepracuje ani sama (šablony/sumáře/upomínky = 0),
//  - čtecí POST (veřejná mapa) jde dál,
//  - sundání příznaku (odemknout / upgrade) zápis zase pustí.
const { execSync } = require('child_process');

const PORT = 20548;
const BASE = `http://127.0.0.1:${PORT}`;
const NAME = 'kb-e2e-predplatne-skoncilo';
const VOLUME = 'kb-e2e-predplatne-data';
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
  execSync(`docker run -d --name ${NAME} -v ${VOLUME}:/app/pb_data ${env} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
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
    console.log('== placená instance: data vzniknou za běhu předplatného ==');
    execSync(`docker volume rm ${VOLUME} 2>/dev/null; true`);
    await start('');
    await zaloz('majitel@e2e.cz');
    const tok0 = await prihlas('majitel@e2e.cz');
    const mapa = await api('POST', '/api/collections/goalmaps/records', {
      token: tok0, body: { title: 'Práce za předplatného', nodes: [], edges: [] } });
    expect(mapa.status === 200, 'za běhu předplatného se zapisuje');
    const verMapa = await api('POST', '/api/collections/goalmaps/records', {
      token: tok0, body: { title: 'Veřejná mapa', nodes: [], edges: [] } });
    await api('POST', '/api/kb/share', { token: tok0, body: { action: 'toggle_public', mapId: verMapa.json?.id } });
    const dnesDow = ((new Date().getUTCDay() + 6) % 7) + 1;
    const tpl = await api('POST', '/api/collections/templates/records', { token: tok0, body: {
      title: 'Šablona na dnešek', node_type: 'mise',
      ai_nodes: [{ id: 'n1', title: 'Kořen', parentId: null }],
      auto_create: 'weekly', auto_day: dnesDow, auto_last: '',
    } });
    expect(!!tpl.json?.id, 'šablona na dnešek založena ještě před zámkem');
    const mapPred = (await api('GET', '/api/collections/goalmaps/records', { token: tok0 })).json?.items?.length ?? 0;
    const cfg0 = await api('GET', '/api/kb/config');
    expect(cfg0.json?.subscription_ended === false, 'config: předplatné běží (subscription_ended=false)');

    console.log('== předplatné SKONČILO: jen pro čtení, data zůstanou ==');
    await start('-e KB_PREDPLATNE_SKONCILO=1');
    const tok = await prihlas('majitel@e2e.cz');
    expect(!!tok, 'PŘIHLÁŠENÍ funguje i po konci předplatného (cesta k datům)');
    const cfg = await api('GET', '/api/kb/config');
    expect(cfg.json?.subscription_ended === true, 'config hlásí konec předplatného (frontend ukáže pruh)');
    expect(cfg.json?.trial_expired === false && !cfg.json?.trial_until, 'a NEtvrdí, že jde o zkušebku');
    const cti = await api('GET', '/api/collections/goalmaps/records', { token: tok });
    expect(cti.status === 200 && cti.json?.items?.some((m) => m.title === 'Práce za předplatného'),
      'ČTENÍ jde dál a DATA JSOU TAM — export není zablokovaný');
    const zapis = await api('POST', '/api/collections/goalmaps/records', {
      token: tok, body: { title: 'Po konci', nodes: [], edges: [] } });
    expect(zapis.status === 402, `ZÁPIS odmítnut s 402 (${zapis.status})`);
    expect(/Předplatné skončilo|subscription has ended/i.test(JSON.stringify(zapis.json)), 'hláška mluví o PŘEDPLATNÉM a kam jít');
    expect(!/Zkušební|trial/i.test(JSON.stringify(zapis.json)), 'hláška NEmluví o zkušebce — je to placený zákazník');
    expect(zapis.json?.code === 'subscription_ended', `kód chyby subscription_ended (${zapis.json?.code})`);
    const routa = await api('POST', '/api/kb/invite', { token: tok, body: { email: 'kdokoli@e2e.cz' } });
    expect(routa.status === 402, `i VLASTNÍ ROUTY jsou zamčené (${routa.status})`);
    const verejne = await api('POST', '/api/kb/public-maps', { body: { mapId: verMapa.json?.id } });
    expect(verejne.status === 200, `veřejná mapa (čtecí POST) jde otevřít dál (${verejne.status})`);
    // instance si nesmí pracovat ani sama (crony: šablony, sumáře, upomínky)
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.cz superheslo123`, { stdio: 'ignore' });
    const suTok = (await api('POST', '/api/collections/_superusers/auth-with-password',
      { body: { identity: 'su@e2e.cz', password: 'superheslo123' } })).json?.token;
    expect(!!suTok, 'provozovatel se na zamčenou instanci dostane');
    const sablony = await api('POST', '/api/kb/run-auto-templates', { token: suTok });
    expect(sablony.json?.created === 0, `opakované šablony NEZALOŽILY nic (${sablony.json?.created})`);
    const mapPo = (await api('GET', '/api/collections/goalmaps/records', { token: tok })).json?.items?.length ?? -1;
    expect(mapPo === mapPred, `v datech nic nepřibylo (${mapPred} → ${mapPo})`);
    const sumare = await api('POST', '/api/kb/run-daily-summaries', { token: suTok });
    expect(sumare.json?.generated === 0, `AI sumáře se NEGENERUJÍ (${sumare.json?.generated})`);
    const upominky = await api('POST', '/api/kb/run-deadline-notices', { token: suTok });
    expect(upominky.json?.sent === 0, `upomínky se NEPOSÍLAJÍ (${upominky.json?.sent})`);

    console.log('== odemknout (nová platba / ruční obnova): zápis zase jde ==');
    await start('');
    const tok2 = await prihlas('majitel@e2e.cz');
    const zapis2 = await api('POST', '/api/collections/goalmaps/records', {
      token: tok2, body: { title: 'Po obnově', nodes: [], edges: [] } });
    expect(zapis2.status === 200, `po sundání příznaku se zapisuje (${zapis2.status})`);
    const cfg2 = await api('GET', '/api/kb/config');
    expect(cfg2.json?.subscription_ended === false, 'config: odemčeno');

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
