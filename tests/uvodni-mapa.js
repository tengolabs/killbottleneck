// Úvodní mapa pro KAŽDÉHO nového uživatele, obsahem podle role.
//
// Richard 6. 8. 2026 po ostré registraci: po přihlášení je prázdná obrazovka
// a není čím začít. Večer 6. 8. doplnil dvě zásadní věci:
//  · „mapa je dost chudá, mělo by být více úkolů" → obsah podle role
//    (admin zavádí instanci, manažer tým, člen svou rutinu),
//  · první verze sypala do uzlů úkolové záznamy — DRIFT proti závaznému
//    modelu z 27. 7. („uzel JE ta práce; termín z něj dělá úkol", tag
//    v0.7/v0.9), žádná jiná šablona to nedělá a nikdo to neschválil.
//
// Proto tenhle test hlídá MODEL: položky jsou UZLY s termínem a řešitelem
// a NEVZNIKÁ ŽÁDNÝ úkolový záznam. Kdyby se drift vrátil, spadne to tady.
//
// Hlídá se i to, co by zákazníka poškodilo: mapa musí být SOUKROMÁ.
const { execSync } = require('child_process');

const PORT = 20569;
const BASE = `http://127.0.0.1:${PORT}`;
const NAME = 'kb-e2e-uvodni-mapa';
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

async function start(env = '') {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  execSync(`docker run -d --name ${NAME} -e TZ=Europe/Prague ${env} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch (e) { /* ještě ne */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('kontejner nenaskočil');
}

async function zaloz(email, jazyk = 'cs') {
  return api('POST', '/api/collections/users/records', {
    body: { email, password: HESLO, passwordConfirm: HESLO, name: email.split('@')[0], role: 'admin', language: jazyk },
  });
}
async function prihlas(email, heslo = HESLO) {
  const r = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: heslo } });
  return r.json?.token;
}
const den = (posun) => {
  const d = new Date(Date.now() + posun * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Položky mapy = uzly s termínem (oblasti a kořen termín nemají).
function polozky(mapa) {
  return (mapa.nodes || [])
    .filter((n) => n.type === 'goalNode' && ((n.data || {}).deadline || '') !== '')
    .map((n) => ({ title: (n.data || {}).title || '', deadline: ((n.data || {}).deadline || '').slice(0, 10),
                   owner: (n.data || {}).owner || '', description: (n.data || {}).description || '' }))
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
}
// Očekávané tempo: dvě položky na den, první dvě DNES.
const ockavaneTerminy = (n) => Array.from({ length: n }, (_, i) => den(Math.floor(i / 2))).sort();

async function main() {
  try {
    console.log('== zakladatel (admin) dostane bohatou mapu ==');
    await start();
    await zaloz('zakladatel@firma.cz');
    await new Promise((r) => setTimeout(r, 1500));
    const tok = await prihlas('zakladatel@firma.cz');
    const mapy = (await api('GET', '/api/collections/goalmaps/records', { token: tok })).json?.items || [];
    expect(mapy.length === 1, `vznikla právě 1 mapa (${mapy.length})`);
    const mapa = mapy[0] || {};
    expect(/Zaveden/i.test(mapa.title || ''), `jmenuje se podle zavedení nástroje („${mapa.title}")`);
    expect((mapa.nodes || []).length >= 20, `admin má bohatou mapu (${(mapa.nodes || []).length} uzlů)`);
    expect((mapa.edges || []).length === (mapa.nodes || []).length - 1,
      `strom je propojený hranami (${(mapa.edges || []).length} hran)`);

    console.log('== je SOUKROMÁ ==');
    expect(mapa.is_public === false, 'není veřejná');
    expect((mapa.shared_with || []).length === 0, 'není s nikým sdílená');

    console.log('== MODEL: položky jsou uzly s termínem, ŽÁDNÉ úkolové záznamy ==');
    // Závazné rozhodnutí 27. 7.: „uzel JE ta práce; termín z něj dělá úkol."
    // První verze mapy zakládala tasks záznamy — drift, který nikdo neschválil.
    const ukolyZaznamy = (await api('GET', '/api/collections/tasks/records?perPage=50', { token: tok })).json?.items || [];
    expect(ukolyZaznamy.length === 0,
      `úvodní mapa NEZAKLÁDÁ úkolové záznamy (${ukolyZaznamy.length}) — drift z 6. 8. se nesmí vrátit`);
    const pol = polozky(mapa);
    expect(pol.length >= 14, `admin má aspoň 14 položek (${pol.length})`);
    expect(pol.every((p) => p.owner === 'zakladatel@firma.cz'),
      'řešitelem VŠECH položek je zakladatel — jinak by mu nesvítily v „Můj den"');
    expect(pol[0].deadline === den(0), `první položka je na DNES (${pol[0].deadline})`);
    expect(JSON.stringify(pol.map((p) => p.deadline)) === JSON.stringify(ockavaneTerminy(pol.length)),
      `termíny jdou po DVOU na den bez děr (${pol[0].deadline} … ${pol[pol.length - 1].deadline})`);

    console.log('== obsah podle role: admin zavádí instanci ==');
    const nazvy = pol.map((p) => p.title).join(' | ');
    for (const [co, vzor] of [['vzhled', /vzhled/i], ['pozvání lidí', /pozvat/i], ['první projekt', /první projekt/i],
                              ['obarvení uzlu', /obarvit/i], ['ikona projektu', /ikonu/i],
                              ['nastavení organizace', /organizaci/i], ['správce AI', /správce AI/i],
                              ['denní fokus', /fokus/i], ['telefon', /telefon/i], ['šablona', /šablon/i]]) {
      expect(vzor.test(nazvy), `je tam ${co}`);
    }
    const ai = pol.filter((p) => /\bAI\b/.test(p.title) && !/správce/i.test(p.title));
    expect(ai.length >= 2, `AI má aspoň dvě položky (${ai.length})`);
    expect(ai.some((p) => /vylepšit|stávající/i.test(p.title)), 'jedna je vylepšit stávající mapu');
    expect(ai.some((p) => /celou mapu/i.test(p.title)), 'druhá je vytvořit celou mapu');

    console.log('== v popisech jsou odkazy do dokumentace ==');
    expect(pol.every((p) => /https:\/\//.test(p.description)), 'každá položka nese odkaz na návod');
    expect(pol.every((p) => !/killbottleneck\.com/.test(p.description)), 'česká mapa odkazuje na .cz, ne na .com');

    console.log('== ČLEN dostane mapu taky: osobní rutinu, bez správy a zvaní ==');
    await api('POST', '/api/collections/users/records', {
      body: { email: 'kolega@firma.cz', password: HESLO, passwordConfirm: HESLO, name: 'Kolega', role: 'user' },
    });
    await new Promise((r) => setTimeout(r, 1500));
    const tok2 = await prihlas('kolega@firma.cz');
    const jeho = (await api('GET', '/api/collections/goalmaps/records', { token: tok2 })).json?.items || [];
    expect(jeho.length === 1, `člen mapu DOSTANE (${jeho.length})`);
    expect(!/Zaveden/i.test(jeho[0]?.title || ''), `a jinak pojmenovanou („${jeho[0]?.title}")`);
    const jehoPol = polozky(jeho[0] || {});
    expect(jehoPol.length >= 8, `má vlastní položky (${jehoPol.length})`);
    const jehoNazvy = jehoPol.map((p) => p.title).join(' | ');
    expect(!/pozvat|organizaci|správce AI|šablon/i.test(jehoNazvy),
      'zvaní lidí ani správa instance mezi nimi NENÍ');
    expect(/fokus/i.test(jehoNazvy) && /telefon/i.test(jehoNazvy), 'rutina (fokus, telefon) tam JE');
    expect(jehoPol.length < pol.length, `člen má míň položek než admin (${jehoPol.length} < ${pol.length})`);
    expect(JSON.stringify(jehoPol.map((p) => p.deadline)) === JSON.stringify(ockavaneTerminy(jehoPol.length)),
      'termíny jdou od dneška bez díry i po odfiltrování');
    expect(jehoPol.every((p) => p.owner === 'kolega@firma.cz'), 'a řešitelem je on sám');

    console.log('== POZVANÝ kolega mapu dostane taky ==');
    // ⚠️ Pozvánka zakládá účet přes $app.save — record hook se NESPUSTÍ,
    // tatáž past „dvě cesty do users" jako u stropu křesel.
    const pozvani = await api('POST', '/api/kb/invite', {
      token: tok, body: { email: 'pozvany@firma.cz', role: 'user' } });
    expect(pozvani.status === 200, `pozvánka projde (${pozvani.status})`);
    await new Promise((r) => setTimeout(r, 1500));
    const docasne = pozvani.json?.temp_password;
    expect(!!docasne, 'pozvánka vrátila dočasné heslo (bez SMTP)');
    const tokP = await prihlas('pozvany@firma.cz', docasne);
    const jehoMapy = (await api('GET', '/api/collections/goalmaps/records', { token: tokP })).json?.items || [];
    expect(jehoMapy.length === 1, `pozvaný má vlastní mapu (${jehoMapy.length})`);
    const polP = polozky(jehoMapy[0] || {});
    expect(polP.length >= 8 && !/pozvat/i.test(polP.map((p) => p.title).join(' | ')),
      `a jako člen nemá položku zvát lidi (${polP.length} položek)`);

    console.log('== zvoucí dostane zprávu o PRVNÍM přihlášení pozvaného ==');
    // Richard 6. 8. pozdě večer: „když někoho pozvu a on se přihlásí, měl
    // bych dostat notifikaci." Loginlog zakládá frontend po přihlášení —
    // založíme ho tady stejně. Druhý login už budit nesmí (žádný spam).
    await api('POST', '/api/collections/loginlogs/records', { token: tokP, body: {} });
    await new Promise((r) => setTimeout(r, 1000));
    const notif = (await api('GET', '/api/collections/notifications/records?perPage=50', { token: tok })).json?.items || [];
    const vstup = notif.filter((n) => n.type === 'user_joined');
    expect(vstup.length === 1, `zvoucí má právě 1 notifikaci user_joined (${vstup.length})`);
    expect(/pozvany@firma\.cz/.test(vstup[0]?.text || ''), `a je v ní, KDO vstoupil („${vstup[0]?.text}")`);
    // ⚠️ OSTRÝ PROVOZ 9. 8. 2026: tohle tvrzení bylo zelené, a přesto zvoucí dostal
    // zprávu DVAKRÁT (3 pozvaní ze 3). Test to nechytil, protože nesimuloval SOUBĚH:
    // frontend hned po přihlášení PATCHuje `users` a nese v těle ještě prázdné
    // `last_login`, čímž přepíše zápis serverového hooku. Pojistka „už se přihlásil"
    // pak při druhém loginu opět nevidí nic. Simulujeme to přesně tím PATCHem.
    const pozvanyId = (await api('POST', '/api/collections/users/auth-with-password',
      { body: { identity: 'pozvany@firma.cz', password: docasne } })).json?.record?.id;
    const pokus = await api('PATCH', `/api/collections/users/records/${pozvanyId}`, {
      token: tokP, body: { last_login: '' },
    });
    expect(pokus.status === 200, `klientský PATCH users projde (${pokus.status})`);
    expect(!!pokus.json?.last_login,
      `ale last_login NEsmaže — je serverové („${pokus.json?.last_login || 'PRÁZDNÉ'}")`);
    await api('POST', '/api/collections/loginlogs/records', { token: tokP, body: {} });
    await new Promise((r) => setTimeout(r, 1000));
    const notif2 = (await api('GET', '/api/collections/notifications/records?perPage=50', { token: tok })).json?.items || [];
    expect(notif2.filter((n) => n.type === 'user_joined').length === 1,
      'druhé přihlášení už zvoucího NEbudí — ani po pokusu pojistku shodit');
    expect((notif2.find((n) => n.type === 'user_joined') || {}).dedup_key === 'joined:pozvany@firma.cz',
      'a drží to TVRDÁ závora (dedup_key), ne jen měkká kontrola last_login');

    console.log('== první položka svítí v „Můj den" ==');
    // Celý důvod, proč mapa vzniká — uzel s termínem a řešitelem se musí
    // v přehledu objevit jako práce (kind node), ne zapadnout.
    const dnes = den(0);
    const myDay = await api('GET', `/api/kb/my-day?today=${dnes}`, { token: tok });
    const dnesni = [].concat(myDay.json?.sections?.today || [], myDay.json?.sections?.overdue || []);
    expect(dnesni.some((i) => /vzhled/i.test(i.title || '')),
      `dnešní položka svítí v Můj den (${dnesni.map((i) => i.title).join(', ') || 'nic'})`);

    console.log('== anglicky ==');
    await start();
    await zaloz('founder@firma.cz', 'en');
    await new Promise((r) => setTimeout(r, 1500));
    const tokEn = await prihlas('founder@firma.cz');
    const mapaEn = ((await api('GET', '/api/collections/goalmaps/records', { token: tokEn })).json?.items || [])[0] || {};
    expect(/Getting started/i.test(mapaEn.title || ''), `anglický účet dostane anglickou mapu („${mapaEn.title}")`);
    const polEn = polozky(mapaEn);
    expect(polEn.length >= 14 && !polEn.some((p) => /vzhled|pozvat/i.test(p.title)),
      'a položky taky anglicky (žádné české názvy)');
    expect(polEn.every((p) => /killbottleneck\.com/.test(p.description)), 'a odkazy míří na .com, ne na .cz');
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }

  console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main();
