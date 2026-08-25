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
// Proto tenhle test hlídá MODEL: položky jsou UZLY s řešitelem a NEVZNIKÁ
// ŽÁDNÝ úkolový záznam. Kdyby se drift vrátil, spadne to tady.
//
// ⭐ 25. 8. 2026 (Richard, „sedm pohledů" P5-03): položky mají PLÁN („chci
// řešit", plannedOn) místo TERMÍNU — nováček druhý den vítal „Po termínu (2)".
// Termín je dohoda s někým jiným, prohlídka ne. Test hlídá: deadline PRÁZDNÝ,
// plán jde po dvou na den od dneška, první položka svítí v Můj den, a den poté
// v „Po termínu" NENÍ nic. Dále ÚČEL instance (team/family/solo, dotazník
// prvního admina): obsah podle role A účelu, nedotčená mapa se po odpovědi
// nahradí, pozvaní účel dědí, přeskočení = team.
//
// Hlídá se i to, co by zákazníka poškodilo: mapa musí být SOUKROMÁ.
const { execSync } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');

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

// Položky mapy = uzly s PLÁNEM a řešitelem (oblasti a kořen plán nemají).
function polozky(mapa) {
  return (mapa.nodes || [])
    .filter((n) => n.type === 'goalNode' && ((n.data || {}).plannedOn || '') !== '')
    .map((n) => ({ title: (n.data || {}).title || '', plan: ((n.data || {}).plannedOn || '').slice(0, 10),
                   deadline: (n.data || {}).deadline || '', tour: (n.data || {}).tour === true,
                   owner: (n.data || {}).owner || '', description: (n.data || {}).description || '' }))
    .sort((a, b) => a.plan.localeCompare(b.plan));
}
// Očekávané tempo: dvě položky na den, první dvě DNES.
const ockavaneTerminy = (n) => Array.from({ length: n }, (_, i) => den(Math.floor(i / 2))).sort();
const nazvyPol = (pol) => pol.map((p) => p.title).join(' | ');

async function main() {
  try {
    console.log('== zakladatel (admin) dostane bohatou mapu ==');
    await start();
    await zaloz('zakladatel@firma.cz');
    await new Promise((r) => setTimeout(r, 1500));
    const tok = await prihlas('zakladatel@firma.cz');
    const mapy = (await api('GET', '/api/collections/goalmaps/records', { token: tok })).json?.items || [];
    // Richard 25. 8. 2026: „po založení účtu 2 testovací projekty" — úvodní mapa
    // + druhý jednoduchý pozitivní projekt podle účelu, ať Moje mapa dává smysl
    expect(mapy.length === 2, `vznikly právě 2 mapy: úvodní + zkušební projekt (${mapy.length})`);
    const mapa = mapy.find((m) => /Zaveden/i.test(m.title || '')) || {};
    const druha = mapy.find((m) => !/Zaveden/i.test(m.title || '')) || {};
    expect(/Lepší pracovní den/.test(druha.title || ''), `druhý projekt pro firmu („${druha.title}")`);
    expect(/Zkušební projekt/.test(druha.description || ''), 'v poznámce projektu stojí, že je zkušební');
    const druhePol = (druha.nodes || []).filter((n) => n.type === 'goalNode' && (n.data || {}).owner);
    expect(druhePol.length === 6 && druhePol.every((n) => n.data.owner === 'zakladatel@firma.cz'), `6 položek s řešitelem = zakladatel (${druhePol.length})`);
    expect(druhePol.every((n) => !n.data.deadline && !n.data.plannedOn && n.data.tour === true), 'bez termínu i plánu (nezaplaví Můj den), s příznakem tour');
    expect(druhePol.every((n) => /Zkušební projekt/.test(n.data.description || '')), 'každá položka nese poznámku, že je zkušební');
    expect(druha.is_public === false && (druha.shared_with || []).length === 0, 'druhý projekt je taky soukromý');
    expect(/Zaveden/i.test(mapa.title || ''), `jmenuje se podle zavedení nástroje („${mapa.title}")`);
    expect((mapa.nodes || []).length >= 20, `admin má bohatou mapu (${(mapa.nodes || []).length} uzlů)`);
    expect((mapa.edges || []).length === (mapa.nodes || []).length - 1,
      `strom je propojený hranami (${(mapa.edges || []).length} hran)`);

    console.log('== je SOUKROMÁ ==');
    expect(mapa.is_public === false, 'není veřejná');
    expect((mapa.shared_with || []).length === 0, 'není s nikým sdílená');

    console.log('== MODEL: položky jsou uzly s plánem a řešitelem, ŽÁDNÉ úkolové záznamy, ŽÁDNÉ termíny ==');
    // Závazné rozhodnutí 27. 7.: „uzel JE ta práce; termín z něj dělá úkol."
    // První verze mapy zakládala tasks záznamy — drift, který nikdo neschválil.
    const ukolyZaznamy = (await api('GET', '/api/collections/tasks/records?perPage=50', { token: tok })).json?.items || [];
    expect(ukolyZaznamy.length === 0,
      `úvodní mapa NEZAKLÁDÁ úkolové záznamy (${ukolyZaznamy.length}) — drift z 6. 8. se nesmí vrátit`);
    const pol = polozky(mapa);
    expect(pol.length >= 14, `admin má aspoň 14 položek (${pol.length})`);
    expect(pol.every((p) => p.owner === 'zakladatel@firma.cz'),
      'řešitelem VŠECH položek je zakladatel — jinak by mu nesvítily v „Můj den"');
    expect(pol.every((p) => p.deadline === ''), 'ŽÁDNÁ položka nemá termín — prohlídka nesmí nováčka stavět do role toho, kdo nestíhá');
    expect(pol.every((p) => p.tour), 'každá položka nese příznak tour (lite ji řadí pod vlastní zápisy)');
    expect((mapa.nodes || []).every((n) => (n.data || {}).tour === true), 'tour nese i vrchol a oblasti — podle něj se pozná nedotčená mapa');
    expect(pol[0].plan === den(0), `první položka má plán na DNES (${pol[0].plan})`);
    expect(JSON.stringify(pol.map((p) => p.plan)) === JSON.stringify(ockavaneTerminy(pol.length)),
      `plány jdou po DVOU na den bez děr (${pol[0].plan} … ${pol[pol.length - 1].plan})`);

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
    const jehoVse = (await api('GET', '/api/collections/goalmaps/records', { token: tok2 })).json?.items || [];
    expect(jehoVse.length === 2, `člen dostane obě mapy (${jehoVse.length})`);
    const jeho = jehoVse.filter((m) => /Vítejte/i.test(m.title || ''));
    expect(jeho.length === 1, `úvodní mapu člen má (${jeho.length})`);
    expect(!/Zaveden/i.test(jeho[0]?.title || ''), `a jinak pojmenovanou („${jeho[0]?.title}")`);
    const jehoPol = polozky(jeho[0] || {});
    expect(jehoPol.length >= 8, `má vlastní položky (${jehoPol.length})`);
    const jehoNazvy = jehoPol.map((p) => p.title).join(' | ');
    expect(!/pozvat|organizaci|správce AI|šablon/i.test(jehoNazvy),
      'zvaní lidí ani správa instance mezi nimi NENÍ');
    expect(/fokus/i.test(jehoNazvy) && /telefon/i.test(jehoNazvy), 'rutina (fokus, telefon) tam JE');
    expect(jehoPol.length < pol.length, `člen má míň položek než admin (${jehoPol.length} < ${pol.length})`);
    expect(JSON.stringify(jehoPol.map((p) => p.plan)) === JSON.stringify(ockavaneTerminy(jehoPol.length)),
      'plány jdou od dneška bez díry i po odfiltrování');
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
    const jehoMapy = ((await api('GET', '/api/collections/goalmaps/records', { token: tokP })).json?.items || []).filter((m) => /Vítejte/i.test(m.title || ''));
    expect(jehoMapy.length === 1, `pozvaný má vlastní úvodní mapu (${jehoMapy.length})`);
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
    const dnesni = myDay.json?.sections?.today || [];
    expect(dnesni.some((i) => /vzhled/i.test(i.title || '')),
      `dnešní položka svítí v Můj den v sekci DNES (${dnesni.map((i) => i.title).join(', ') || 'nic'})`);
    expect((myDay.json?.counts || {}).overdue === 0, `po termínu je 0 (${(myDay.json?.counts || {}).overdue})`);
    // druhý den: plán z včerejška vypršel → NIC po termínu (dřív „Po termínu (2)")
    const zitra = await api('GET', `/api/kb/my-day?today=${den(1)}`, { token: tok });
    expect((zitra.json?.counts || {}).overdue === 0, `ani druhý den nic po termínu (${(zitra.json?.counts || {}).overdue})`);
    expect((zitra.json?.sections?.today || []).length >= 2, 'druhý den svítí další dvě položky prohlídky');
    // vlastní zápis (plán na dnes) se řadí NAD položky prohlídky (P4-01)
    const mapaId = mapa.id;
    const uzly = (await api('GET', `/api/collections/goalmaps/records/${mapaId}`, { token: tok })).json.nodes;
    const apex = uzly.find((n) => n.type === 'apexNode');
    uzly.push({ id: 'muj', type: 'goalNode', position: { x: 0, y: 900 }, data: { title: 'MŮJ VLASTNÍ ZÁPIS', status: 'todo', owner: 'zakladatel@firma.cz', plannedOn: dnes } });
    const hrany = (await api('GET', `/api/collections/goalmaps/records/${mapaId}`, { token: tok })).json.edges;
    hrany.push({ id: 'e-muj', source: apex.id, target: 'muj', type: 'deletable' });
    await api('PATCH', `/api/collections/goalmaps/records/${mapaId}`, { token: tok, body: { nodes: uzly, edges: hrany } });
    const poZapisu = (await api('GET', `/api/kb/my-day?today=${dnes}`, { token: tok })).json?.sections?.today || [];
    expect(poZapisu[0] && /VLASTNÍ/.test(poZapisu[0].title), `vlastní zápis je v Dnes PRVNÍ, nad prohlídkou (${poZapisu.map((i) => i.title).slice(0, 2).join(' | ')})`);
    // uložení PŘES EDITOR (lib/cleanMap.js cleanMapData) — panel /checkup 25. 8.: surový PATCH
    // whitelist FE obcházel a test tvrdil, co nehlídal; autosave z editoru tour mazal
    const { cleanMapData } = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'cleanMap.js')).href);
    const cisty = cleanMapData(uzly, hrany);
    expect(cisty.cleanNodes.filter((n) => n.data.tour === true).length === uzly.filter((n) => n.data.tour === true).length,
      'cleanMapData (autosave editoru) příznak tour zachová');
    await api('PATCH', `/api/collections/goalmaps/records/${mapaId}`, { token: tok, body: { nodes: cisty.cleanNodes, edges: cisty.cleanEdges } });
    const poEditoru = (await api('GET', `/api/kb/my-day?today=${dnes}`, { token: tok })).json?.sections?.today || [];
    expect(poEditoru[0] && /VLASTNÍ/.test(poEditoru[0].title) && poEditoru.filter((i) => i.tour).length >= 2,
      'i po uložení editorem je vlastní zápis první a prohlídka nese tour');

    console.log('== ÚČEL instance: dotazník prvního admina ==');
    // purpose vrací config jen PŘIHLÁŠENÉMU (nepřihlášený dostane prázdno)
    expect((await api('GET', '/api/kb/config')).json?.purpose === '', 'nepřihlášenému config účel neprozradí');
    let r = await api('GET', '/api/kb/config', { token: tok });
    expect(r.json?.purpose === '', `před odpovědí je purpose prázdné (${JSON.stringify(r.json?.purpose)})`);
    r = await api('POST', '/api/kb/purpose', { token: tok2, body: { purpose: 'solo' } });
    expect(r.status === 403 && /administr/i.test(r.json?.error || ''), `člen účel nastavit nesmí, s přeloženou hláškou (${r.status}: ${r.json?.error})`);
    r = await api('POST', '/api/kb/purpose', { token: tok, body: { purpose: 'firma' } });
    expect(r.status === 400, `neplatná hodnota → 400 (${r.status})`);
    r = await api('POST', '/api/kb/purpose', { token: tok, body: { purpose: 'team' } });
    expect(r.status === 200 && r.json.regenerated === false, `přeskočení = team, mapa se NEnahrazuje (${r.status}, regenerated=${r.json?.regenerated})`);
    expect((await api('GET', '/api/kb/config', { token: tok })).json?.purpose === 'team', 'config vrací team');
    // team → family už mapu nenahradí (nahrazuje se jen PRVNÍ odpověď) — admin mapu upravoval
    r = await api('POST', '/api/kb/purpose', { token: tok, body: { purpose: 'family' } });
    expect(r.status === 200 && r.json.regenerated === false, 'pozdější změna účelu nesahá na hotové mapy');
    const mapyPo = (await api('GET', '/api/collections/goalmaps/records', { token: tok })).json?.items || [];
    expect(mapyPo.length === 2 && mapyPo.some((m) => /Zaveden/i.test(m.title)), 'zakladatelovy mapy zůstaly (upravené, team)');

    console.log('== ÚČEL rodina & přátelé: pozvaný člen dědí (bez správy, jinak stejně) ==');
    const pozvani2 = await api('POST', '/api/kb/invite', { token: tok, body: { email: 'teta@rodina.cz', role: 'user' } });
    const tokT = await prihlas('teta@rodina.cz', pozvani2.json?.temp_password);
    const mapyT = (await api('GET', '/api/collections/goalmaps/records', { token: tokT })).json?.items || [];
    const mapaT = mapyT.find((m) => /Vítejte/i.test(m.title || '')) || {};
    expect(mapyT.some((m) => /Společná radost/.test(m.title || '')), 'člen v rodinné instanci dostal rodinný zkušební projekt');
    const polT = polozky(mapaT);
    expect(polT.length === jehoPol.length && !/pozvat|organizaci|správce AI/i.test(nazvyPol(polT)), `člen v rodinné instanci má rutinu bez správy (${polT.length})`);
    const pozvani3 = await api('POST', '/api/kb/invite', { token: tok, body: { email: 'strejda@rodina.cz', role: 'manager' } });
    const tokS = await prihlas('strejda@rodina.cz', pozvani3.json?.temp_password);
    const polS = polozky(((await api('GET', '/api/collections/goalmaps/records', { token: tokS })).json?.items || []).find((m) => /Vítejte/i.test(m.title || '')) || {});
    expect(/Pozvat rodinu a přátele/.test(nazvyPol(polS)) && /někomu blízkému/.test(nazvyPol(polS)) && /z party/.test(nazvyPol(polS)),
      `manažer v rodinné instanci: pozvat rodinu, sdílet blízkému, předat partě (${polS.length})`);
    expect(!/kolegovi|kolegy/i.test(nazvyPol(polS)), 'žádní „kolegové" v rodinné mapě');

    console.log('== ÚČEL jen pro sebe: první odpověď NAHRADÍ nedotčenou mapu ==');
    await start();
    await zaloz('samotar@doma.cz');
    await new Promise((r) => setTimeout(r, 1500));
    const tokSam = await prihlas('samotar@doma.cz');
    const pred = ((await api('GET', '/api/collections/goalmaps/records', { token: tokSam })).json?.items || []);
    const predUvodni = pred.find((m) => /Zaveden/i.test(m.title || '')) || {};
    expect(pred.length === 2 && polozky(predUvodni).length >= 14, `při registraci vznikly plné (team) projekty (${pred.length}, ${polozky(predUvodni).length})`);
    r = await api('POST', '/api/kb/purpose', { token: tokSam, body: { purpose: 'solo', replace: true } });
    expect(r.status === 200 && r.json.regenerated === true, `volba „jen pro sebe" mapu nahradila (${r.status}, regenerated=${r.json?.regenerated})`);
    const poVse = ((await api('GET', '/api/collections/goalmaps/records', { token: tokSam })).json?.items || []);
    expect(poVse.length === 2, `pořád právě dvě mapy (${poVse.length})`);
    const po = poVse.filter((m) => /pro sebe/i.test(m.title || ''));
    expect(po.length === 1, `úvodní mapa se jmenuje pro sebe („${poVse.map((m) => m.title).join(' | ')}")`);
    expect(poVse.some((m) => /Udělat si radost/.test(m.title || '')), 'druhý projekt sólisty: Udělat si radost');
    const polSam = polozky(po[0] || {});
    expect(polSam.length === 12, `sólista má 12 položek (${polSam.length})`);
    expect(!/pozvat|organizaci|správce AI|kolegovi|kolegy/i.test(nazvyPol(polSam)), 'bez zvaní, rolí a kolegů');
    expect(/vzhled/i.test(nazvyPol(polSam)) && /první projekt/i.test(nazvyPol(polSam)) && /šablon/i.test(nazvyPol(polSam)) && /fokus/i.test(nazvyPol(polSam)),
      'rutina, projekt i šablona tam jsou');
    expect(polSam[0].plan === den(0) && polSam.every((p) => p.deadline === ''), 'i nahrazená mapa má plán od dneška a žádné termíny');
    // druhá odpověď už nic nenahradí, i kdyby byla mapa nedotčená
    r = await api('POST', '/api/kb/purpose', { token: tokSam, body: { purpose: 'family', replace: true } });
    expect(r.json?.regenerated === false, 'opakovaná odpověď mapu nemění');

    console.log('== select ve Správě organizace (bez replace) mapy NIKDY nenahrazuje ==');
    await start();
    await zaloz('spravce@doma.cz');
    await new Promise((r) => setTimeout(r, 1500));
    const tokSpr = await prihlas('spravce@doma.cz');
    const predSel = ((await api('GET', '/api/collections/goalmaps/records', { token: tokSpr })).json?.items || []).map((m) => m.id).sort();
    r = await api('POST', '/api/kb/purpose', { token: tokSpr, body: { purpose: 'family' } });
    const poSel = ((await api('GET', '/api/collections/goalmaps/records', { token: tokSpr })).json?.items || []).map((m) => m.id).sort();
    expect(r.status === 200 && r.json.regenerated === false && JSON.stringify(predSel) === JSON.stringify(poSel),
      `bez replace:true se nic nemaže (regenerated=${r.json?.regenerated}, mapy stejné)`);

    console.log('== dotčená mapa (cíl bez řešitele) se NEnahradí ani z dialogu ==');
    await start();
    await zaloz('upravil@doma.cz');
    await new Promise((r) => setTimeout(r, 1500));
    const tokUp = await prihlas('upravil@doma.cz');
    const mapyUp = (await api('GET', '/api/collections/goalmaps/records', { token: tokUp })).json?.items || [];
    const uvUp = mapyUp.find((m) => /Zaveden/i.test(m.title || ''));
    const apexUp = uvUp.nodes.find((n) => n.type === 'apexNode');
    // panel /checkup 25. 8.: cíl BEZ řešitele (ani poznámka, ani příloha) první verze neviděla → smazala by práci
    const uzlyUp = uvUp.nodes.concat([{ id: 'muj-cil', type: 'goalNode', position: { x: 0, y: 900 }, data: { title: 'Můj vlastní cíl', status: 'todo' } }]);
    const hranyUp = uvUp.edges.concat([{ id: 'e-muj', source: apexUp.id, target: 'muj-cil', type: 'deletable' }]);
    await api('PATCH', `/api/collections/goalmaps/records/${uvUp.id}`, { token: tokUp, body: { nodes: uzlyUp, edges: hranyUp } });
    r = await api('POST', '/api/kb/purpose', { token: tokUp, body: { purpose: 'solo', replace: true } });
    const poUp = (await api('GET', '/api/collections/goalmaps/records', { token: tokUp })).json?.items || [];
    expect(r.json?.regenerated === false && poUp.some((m) => m.id === uvUp.id) && poUp.length === 2,
      `mapa s vlastním cílem bez řešitele zůstala (regenerated=${r.json?.regenerated}, ${poUp.length} map)`);

    console.log('== anglicky ==');
    await start();
    await zaloz('founder@firma.cz', 'en');
    await new Promise((r) => setTimeout(r, 1500));
    const tokEn = await prihlas('founder@firma.cz');
    const mapaEn = ((await api('GET', '/api/collections/goalmaps/records', { token: tokEn })).json?.items || []).find((m) => /Getting started/i.test(m.title || '')) || {};
    expect(/Getting started/i.test(mapaEn.title || ''), `anglický účet dostane anglickou mapu („${mapaEn.title}")`);
    const polEn = polozky(mapaEn);
    expect(polEn.length >= 14 && !polEn.some((p) => /vzhled|pozvat/i.test(p.title)),
      'a položky taky anglicky (žádné české názvy)');
    expect(polEn.every((p) => /killbottleneck\.com/.test(p.description)), 'a odkazy míří na .com, ne na .cz');
    r = await api('POST', '/api/kb/purpose', { token: tokEn, body: { purpose: 'family', replace: true } });
    const mapyEn2 = (await api('GET', '/api/collections/goalmaps/records', { token: tokEn })).json?.items || [];
    const mapaEn2 = mapyEn2.find((m) => /together/i.test(m.title || '')) || {};
    expect(r.json?.regenerated === true && /together/i.test(mapaEn2.title || '') && /Invite family and friends/.test(nazvyPol(polozky(mapaEn2))),
      `anglická rodinná varianta („${mapaEn2.title}")`);
    expect(mapyEn2.some((m) => /Shared joy/.test(m.title || '')), 'anglický druhý projekt: Shared joy');
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }

  console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main();
