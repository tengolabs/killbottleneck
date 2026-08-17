// GET /api/flowmap/my-day — serverový „Můj den".
//
// Hlídá to, kvůli čemu endpoint vznikl a co se při úpravách nejsnáz rozbije:
//   • dedup uzel+úkol (úkol pověšený na můj uzel se NEsmí počítat dvakrát),
//   • „zadal jsem" jako samostatná sekce, která se nemíchá do mých čísel,
//   • plán („kdy to chci řešit") NEPŘEPISUJE termín a sám vyprší,
//   • ?today= z klienta (kontejner běží v UTC — bez toho se panel po půlnoci
//     rozejde s tím, co má člověk na hodinkách),
//   • VIDITELNOST: cizí soukromá mapa se nesmí do přehledu dostat ani názvem.
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20513';
const NAME = 'flowmap-e2e-myday-api';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const day = (offset) => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('en-CA');
};

const api = async (path, { token, body, method } = {}) => {
  const res = await fetch(BASE + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdná odpověď */ }
  return { status: res.status, json };
};

// Stejný dotaz, jaký posílá prohlížeč: kromě místního data i MOJI půlnoc v UTC.
// Bez `since` počítá server „hotovo dnes" od 00:00 UTC, což je v SELČ o dvě
// hodiny jinde — tahle sada to odhalila při nočním běhu (00:00–02:00 prázdno).
const mojePulnocVUtc = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const myDayUrl = (today) => `/api/flowmap/my-day?today=${today}&since=${encodeURIComponent(mojePulnocVUtc())}`;

const register = async (email) => {
  await api('/api/collections/users/records', { body: { email, password: 'testheslo123', passwordConfirm: 'testheslo123' } });
  const r = await api('/api/collections/users/auth-with-password', { body: { identity: email, password: 'testheslo123' } });
  return { token: r.json.token, id: r.json.record.id, email };
};

const titlesIn = (list) => (list || []).map((i) => i.title);

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_UVODNI_MAPA=0 -p 20513:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    const me = await register('admin@e2e.cz');
    const kolega = await register('kolega@e2e.cz');
    // SLOVNÍK 17. 8. 2026: položky-úkoly nejde založit uživatelem (403) — zbytková
    // data pro tenhle test zakládá superuser s explicitním owner/owner_email.
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    const today = day(0);

    // moje mapa: uzel přiřazený mně (s termínem dnes) + uzel delegovaný kolegovi
    const mapa = (await api('/api/collections/goalmaps/records', {
      token: me.token,
      body: {
        title: 'Můj projekt',
        nodes: [
          { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Můj projekt', title: 'Můj projekt', status: 'todo' } },
          { id: 'n1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'UZEL-MUJ', status: 'todo', owner: me.email, deadline: today } },
          { id: 'n2', type: 'goalNode', position: { x: 200, y: 300 }, data: { title: 'UZEL-KOLEGOVI', status: 'todo', owner: kolega.email, deadline: day(3) } },
          // n0 = neutrální uzel pro úkoly (bez garanta/termínu nic nepřidá do
          // sekcí ani nesloží úkoly do uzlu) — úkol musí viset na NE-vrcholu
          { id: 'n0', type: 'goalNode', position: { x: 400, y: 300 }, data: { title: 'ZAZEMI-UKOLU', status: 'todo' } },
        ],
        edges: [{ id: 'e1', source: 'apex', target: 'n1' }, { id: 'e2', source: 'apex', target: 'n2' }, { id: 'e0', source: 'apex', target: 'n0' }],
      },
    })).json;

    // výchozí node_id = neutrální n0; konkrétní test si ho může přebít (viz n1 níž)
    const mkTask = (body, zadal) => api('/api/collections/tasks/records', { token: ST, body: { map: mapa.id, node_id: 'n0', owner: (zadal || me).id, owner_email: (zadal || me).email, ...body } });
    await mkTask({ title: 'UKOL-PO-TERMINU', status: 'todo', assignee_email: me.email, deadline: day(-4) });
    await mkTask({ title: 'UKOL-PRISTI-TYDEN', status: 'todo', assignee_email: me.email, deadline: day(4) });
    await mkTask({ title: 'UKOL-HOTOVY', status: 'done', assignee_email: me.email, deadline: today });
    await mkTask({ title: 'UKOL-ZADANY-KOLEGOVI', status: 'todo', assignee_email: kolega.email, deadline: day(2) });
    // úkol pověšený na MŮJ uzel — detail uzlu, NESMÍ se počítat podruhé
    await mkTask({ title: 'UKOL-NA-MEM-UZLU', status: 'todo', assignee_email: me.email, node_id: 'n1', deadline: today });

    console.log('== základní sekce a počty ==');
    let r = await api(myDayUrl(today), { token: me.token });
    expect(r.status === 200, `endpoint odpovídá 200 (${r.status})`);
    const d = r.json || {};
    expect(d.today === today, `dnešek podle klienta (${d.today} vs ${today})`);
    expect(titlesIn(d.sections.overdue).includes('UKOL-PO-TERMINU'), `sekce Po termínu (${titlesIn(d.sections.overdue)})`);
    expect(titlesIn(d.sections.today).includes('UZEL-MUJ'), `sekce Dnes obsahuje můj uzel (${titlesIn(d.sections.today)})`);
    expect(titlesIn(d.sections.week).includes('UKOL-PRISTI-TYDEN'), `sekce Tento týden (${titlesIn(d.sections.week)})`);
    // „hotovo" = CO JSEM DNES ODBAVIL, ne kolik mám hotové práce celkem.
    // Dřív se počítala všechna hotová práce, takže hlavička tvrdila „hotovo: 47"
    // i ve dne, kdy člověk nezvedl prst. Bere se ze záznamníku změn, proto se
    // úkol ZALOŽENÝ rovnou jako hotový nepočítá — nikdo ho neodbavil.
    expect(d.counts.done === 0, `úkol založený rovnou jako hotový se nepočítá (${d.counts.done})`);
    const kOdbaveni = (d.sections.week.find((i) => i.title === 'UKOL-PRISTI-TYDEN') || {}).id;
    await api(`/api/collections/tasks/records/${kOdbaveni}`, { token: me.token, method: 'PATCH', body: { status: 'done' } });
    let po = await api(myDayUrl(today), { token: me.token });
    expect(po.json.counts.done === 1, `odbavený úkol se započítal (${po.json.counts.done})`);
    expect(titlesIn(po.json.sections.doneToday).includes('UKOL-PRISTI-TYDEN'),
      `a je dohledatelný v „hotovo dnes" (${titlesIn(po.json.sections.doneToday)})`);
    // vrátit zpět, ať navazující části sady sedí
    await api(`/api/collections/tasks/records/${kOdbaveni}`, { token: me.token, method: 'PATCH', body: { status: 'todo' } });

    console.log('== vrácení hotového ho VYNDÁ z „hotovo dnes" ==');
    // Nález z ostrého provozu 8. 8. 2026 (viděno v lite): uživatelka práci
    // odbavila, rozmyslela si to a vrátila ji. Objevila se zpátky mezi úkoly,
    // ale ZÁROVEŇ pořád svítila v „HOTOVO DNES (1)" — vypadalo to, že ji tam má
    // dvakrát. Příčina: seznam se skládal ze VŠECH záznamů „status → done" za
    // dnešek a ten starý v deníku po vrácení zůstal. Rozhodovat musí POSLEDNÍ
    // změna stavu. Tuhle díru měla sada přímo pod rukou: vrácení výš dělala,
    // ale nikdy se nepodívala, co po něm v „hotovo dnes" zbylo.
    let zpet = await api(myDayUrl(today), { token: me.token });
    expect(zpet.json.counts.done === 0, `po vrácení se už nepočítá jako hotový (${zpet.json.counts.done})`);
    expect(!titlesIn(zpet.json.sections.doneToday).includes('UKOL-PRISTI-TYDEN'),
      `a zmizel z „hotovo dnes" (${titlesIn(zpet.json.sections.doneToday)})`);
    expect(titlesIn(zpet.json.sections.week).includes('UKOL-PRISTI-TYDEN'),
      'zároveň je zpátky mezi otevřenou prací — zmizet by bylo horší');
    // Filtrace nesmí položku vyřadit NAVŽDY: kdo si to rozmyslí dvakrát, musí
    // druhé odbavení taky vidět.
    await api(`/api/collections/tasks/records/${kOdbaveni}`, { token: me.token, method: 'PATCH', body: { status: 'done' } });
    zpet = await api(myDayUrl(today), { token: me.token });
    expect(titlesIn(zpet.json.sections.doneToday).includes('UKOL-PRISTI-TYDEN'),
      'druhé odbavení téže položky se v „hotovo dnes" objeví znovu');
    await api(`/api/collections/tasks/records/${kOdbaveni}`, { token: me.token, method: 'PATCH', body: { status: 'todo' } });

    console.log('== totéž u UZLU (přesný případ uživatelky: uzel v úvodní mapě) ==');
    // Uzly jdou do deníku jinou cestou než úkoly (logMapChanges při uložení
    // mapy, ne hook úkolu) — a uživatelka klikala právě na uzel. Kdyby se
    // opravila jen cesta úkolů, v provozu by se nezměnilo nic.
    const uzly = (await api(`/api/collections/goalmaps/records/${mapa.id}`, { token: me.token })).json.nodes;
    const prepniUzel = (stav) => api(`/api/collections/goalmaps/records/${mapa.id}`, {
      token: me.token, method: 'PATCH',
      body: { nodes: uzly.map((n) => (n.id === 'n1' ? { ...n, data: { ...n.data, status: stav } } : n)) },
    });
    await prepniUzel('done');
    let uzel = await api(myDayUrl(today), { token: me.token });
    expect(titlesIn(uzel.json.sections.doneToday).includes('UZEL-MUJ'),
      `odbavený uzel je v „hotovo dnes" (${titlesIn(uzel.json.sections.doneToday)})`);
    await prepniUzel('todo');
    uzel = await api(myDayUrl(today), { token: me.token });
    expect(!titlesIn(uzel.json.sections.doneToday).includes('UZEL-MUJ'),
      `vrácený uzel z „hotovo dnes" zmizel (${titlesIn(uzel.json.sections.doneToday)})`);
    expect(titlesIn(uzel.json.sections.today).includes('UZEL-MUJ'),
      'a je zpátky v sekci Dnes podle svého termínu');
    // Sentinel na celý přehled: co je vidět jako otevřené, NESMÍ zároveň svítit
    // jako hotové — ať se to příště nerozejde jinou cestou (jiné pole, jiný hook).
    const OTEVRENE = ['overdue', 'today', 'tomorrow', 'week', 'blocking', 'stuck', 'later', 'noDate'];
    const klic = (i) => `${i.kind}:${i.mapId}:${i.id}`;
    const otevrene = OTEVRENE.flatMap((s) => (uzel.json.sections[s] || []).map(klic));
    const dvakrat = (uzel.json.sections.doneToday || []).map(klic).filter((k) => otevrene.includes(k));
    expect(dvakrat.length === 0, `žádná položka není zároveň hotová i otevřená (${dvakrat})`);

    console.log('== dedup uzel + úkol ==');
    const vsechny = [].concat(d.sections.overdue, d.sections.today, d.sections.week, d.sections.blocking);
    expect(!titlesIn(vsechny).includes('UKOL-NA-MEM-UZLU'),
      `úkol pověšený na můj uzel se nepočítá podruhé (${titlesIn(vsechny)})`);
    expect(d.counts.open === 3, `otevřená práce = 3 položky (${d.counts.open})`);

    console.log('== „zadal jsem" se nemíchá do mých čísel ==');
    const deleg = titlesIn(d.sections.delegated);
    expect(deleg.includes('UKOL-ZADANY-KOLEGOVI') && deleg.includes('UZEL-KOLEGOVI'),
      `delegovaný úkol i uzel jsou v sekci Zadal jsem (${deleg})`);
    expect(!titlesIn(vsechny).some((t) => deleg.includes(t)), 'delegované položky nejsou v mých sekcích');
    expect((d.sections.delegated[0] || {}).assignee === kolega.email
      || (d.sections.delegated[1] || {}).assignee === kolega.email,
    'delegovaná položka nese e-mail řešitele');

    console.log('== plán („kdy to chci řešit") NEPŘEPISUJE termín ==');
    const tydenniId = (d.sections.week.find((i) => i.title === 'UKOL-PRISTI-TYDEN') || {}).id;
    const tydenniDeadline = (d.sections.week.find((i) => i.title === 'UKOL-PRISTI-TYDEN') || {}).deadline;
    await api(`/api/collections/tasks/records/${tydenniId}`, { token: me.token, method: 'PATCH', body: { planned_on: today } });
    r = await api(myDayUrl(today), { token: me.token });
    expect(titlesIn(r.json.sections.today).includes('UKOL-PRISTI-TYDEN'),
      `naplánované na dnes vyskočí do sekce Dnes (${titlesIn(r.json.sections.today)})`);
    expect((r.json.sections.today[0] || {}).title === 'UKOL-PRISTI-TYDEN',
      `naplánované se řadí první (${(r.json.sections.today[0] || {}).title})`);
    // JÁDRO celé změny: termín musí zůstat netknutý
    const poPlanu = (await api(`/api/collections/tasks/records/${tydenniId}`, { token: me.token })).json;
    expect(poPlanu.deadline === tydenniDeadline,
      `TERMÍN se plánováním NEZMĚNIL (${poPlanu.deadline} = ${tydenniDeadline})`);

    console.log('== propadlý úkol naplánovaný na zítra ==');
    const zitra = day(1);
    const propadlyId = (d.sections.overdue.find((i) => i.title === 'UKOL-PO-TERMINU') || {}).id;
    await api(`/api/collections/tasks/records/${propadlyId}`, { token: me.token, method: 'PATCH', body: { planned_on: zitra } });
    r = await api(myDayUrl(today), { token: me.token });
    // Richard 27. 7. 2026: plán se respektuje (položka jde do „Zítra"),
    // ale zpoždění nesmí zmizet — proto termín zůstává v minulosti a UI ho
    // ukazuje červeně.
    expect(titlesIn(r.json.sections.tomorrow).includes('UKOL-PO-TERMINU'),
      `propadlý úkol naplánovaný na zítra je v sekci Zítra (${titlesIn(r.json.sections.tomorrow)})`);
    expect(!titlesIn(r.json.sections.overdue).includes('UKOL-PO-TERMINU'),
      'a už neleží zároveň v Po termínu');
    const propadly = (await api(`/api/collections/tasks/records/${propadlyId}`, { token: me.token })).json;
    expect(propadly.deadline === day(-4), `jeho propadlý termín zůstal (${propadly.deadline})`);

    console.log('== vzdálený plán NESCHOVÁ blížící se termín ==');
    // Kdyby plán vyhrál vždycky, naplánování na za měsíc by uklidilo do
    // „Ostatní" i úkol s termínem za tři dny — a termín je dohoda s někým jiným.
    await api(`/api/collections/tasks/records/${tydenniId}`, { token: me.token, method: 'PATCH', body: { planned_on: day(30) } });
    r = await api(myDayUrl(today), { token: me.token });
    expect(titlesIn(r.json.sections.week).includes('UKOL-PRISTI-TYDEN'),
      `úkol s termínem do týdne zůstal v Tento týden i s plánem na za měsíc (${titlesIn(r.json.sections.week)})`);
    // dopředu naopak plán posunout SMÍ — to je celý jeho smysl
    await api(`/api/collections/tasks/records/${tydenniId}`, { token: me.token, method: 'PATCH', body: { planned_on: today } });
    r = await api(myDayUrl(today), { token: me.token });
    expect(titlesIn(r.json.sections.today).includes('UKOL-PRISTI-TYDEN'), 'plán na dnes položku dopředu posune');

    console.log('== termín DNES: rozhoduje PLÁN (Richard 8. 8. 2026) ==');
    // Dnešek byl jediný den, kdy plán neposlechl: u propadlého termínu i u termínu
    // v budoucnu se položka podle plánu přesunula, u dneška zůstala v „Dnes" a
    // změnila se jen ikonka. Richard 8. 8. z ostrého provozu: „jediné, kdy mi to
    // nefunguje." Vědomý důsledek: „řešit příští týden" u dnešního termínu
    // položku z dnešního seznamu odklidí — termín se ale NEMĚNÍ.
    const dnesId = (await mkTask({ title: 'UKOL-TERMIN-DNES', status: 'todo', assignee_email: me.email, deadline: today })).json.id;
    r = await api(myDayUrl(today), { token: me.token });
    expect(titlesIn(r.json.sections.today).includes('UKOL-TERMIN-DNES'), 'bez plánu leží podle termínu v Dnes');
    await api(`/api/collections/tasks/records/${dnesId}`, { token: me.token, method: 'PATCH', body: { planned_on: day(1) } });
    r = await api(myDayUrl(today), { token: me.token });
    expect(titlesIn(r.json.sections.tomorrow).includes('UKOL-TERMIN-DNES'),
      `plán na zítra ho přenese do Zítra (${titlesIn(r.json.sections.tomorrow)})`);
    expect(!titlesIn(r.json.sections.today).includes('UKOL-TERMIN-DNES'),
      `a v Dnes už neleží zároveň (${titlesIn(r.json.sections.today)})`);
    // JÁDRO celého modelu: termín je dohoda s někým jiným a plánování ho nesmí hnout
    expect((await api(`/api/collections/tasks/records/${dnesId}`, { token: me.token })).json.deadline === today,
      'termín zůstal dnešní');
    // zítra to bude po termínu a NEZMIZÍ — zpoždění se schovat nedá
    r = await api(myDayUrl(day(1)), { token: me.token });
    expect(titlesIn(r.json.sections.today).includes('UKOL-TERMIN-DNES'),
      `zítra je to práce na dnes a propadlý termín zůstává vidět (${titlesIn(r.json.sections.today)})`);
    // „řešit příští týden" u dnešního termínu — vědomě schválený důsledek
    await api(`/api/collections/tasks/records/${dnesId}`, { token: me.token, method: 'PATCH', body: { planned_on: day(7) } });
    r = await api(myDayUrl(today), { token: me.token });
    expect(titlesIn(r.json.sections.week).includes('UKOL-TERMIN-DNES'),
      `plán na příští týden ho odklidí do Do týdne (${titlesIn(r.json.sections.week)})`);
    expect(!titlesIn(r.json.sections.today).includes('UKOL-TERMIN-DNES'), 'a z dnešního seznamu je pryč');
    // ZÍTŘEJŠÍ termín taky ustoupí plánu (Richard 8. 8. 2026: „ten zítřek taky
    // oprav"). Nejdřív se opravil jen dnešek, čímž tatáž nevysvětlitelnost zůstala
    // o den dál: „rozhodnu se to řešit v pondělí" a položka mi visela v Zítra,
    // protože zítřejší termín byl blíž než plán.
    await api(`/api/collections/tasks/records/${dnesId}`, { token: me.token, method: 'PATCH', body: { deadline: day(1), planned_on: day(7) } });
    r = await api(myDayUrl(today), { token: me.token });
    expect(titlesIn(r.json.sections.week).includes('UKOL-TERMIN-DNES'),
      `termín zítra + plán na pondělí jde podle plánu (${titlesIn(r.json.sections.week)})`);
    expect(!titlesIn(r.json.sections.tomorrow).includes('UKOL-TERMIN-DNES'),
      `a v Zítra už neleží (${titlesIn(r.json.sections.tomorrow)})`);
    // ⚠️ HRANICE: dál než týden dopředu plán neposune — „ať to nikdo neposouvá moc
    // dozadu" (Richard 8. 8. 2026). Z lišty to ani nejde (nejpozdější volba je
    // nejbližší pondělí, tedy ≤ 7 dní), ale přes API/MCP ano — a tam by se jinak
    // dal blížící se termín schovat.
    await api(`/api/collections/tasks/records/${dnesId}`, { token: me.token, method: 'PATCH', body: { deadline: day(1), planned_on: day(30) } });
    r = await api(myDayUrl(today), { token: me.token });
    expect(titlesIn(r.json.sections.tomorrow).includes('UKOL-TERMIN-DNES'),
      `plán na za měsíc zítřejší termín NEschová (${titlesIn(r.json.sections.tomorrow)})`);
    await api(`/api/collections/tasks/records/${dnesId}`, { token: me.token, method: 'PATCH', body: { deadline: day(3), planned_on: day(30) } });
    r = await api(myDayUrl(today), { token: me.token });
    expect(titlesIn(r.json.sections.week).includes('UKOL-TERMIN-DNES'),
      'ani termín za tři dny');
    await api(`/api/collections/tasks/records/${dnesId}`, { token: me.token, method: 'PATCH', body: { status: 'done' } });

    console.log('== plán vyprší sám ==');
    await api(`/api/collections/tasks/records/${tydenniId}`, { token: me.token, method: 'PATCH', body: { planned_on: day(-1) } });
    r = await api(myDayUrl(today), { token: me.token });
    expect(titlesIn(r.json.sections.week).includes('UKOL-PRISTI-TYDEN'),
      'včerejší plán neplatí a položka se vrátila podle termínu (bez úklidového cronu)');

    console.log('== dnešek podle klienta (kontejner běží v UTC) ==');
    r = await api(`/api/flowmap/my-day?today=${day(4)}`, { token: me.token });
    expect(titlesIn(r.json.sections.today).includes('UKOL-PRISTI-TYDEN'),
      'posun dneška přeřadí položky do jiných sekcí');
    r = await api('/api/flowmap/my-day?today=nesmysl', { token: me.token });
    expect(r.status === 200 && /^\d{4}-\d{2}-\d{2}$/.test(r.json.today),
      `neplatný dnešek spadne na datum serveru (${r.json.today})`);

    console.log('== viditelnost: cizí soukromá mapa ==');
    await api('/api/collections/goalmaps/records', {
      token: kolega.token,
      body: {
        title: 'TAJNY-PROJEKT-KOLEGY',
        nodes: [{ id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Tajné', title: 'Tajné', status: 'todo', owner: 'admin@e2e.cz' } }],
        edges: [],
      },
    });
    r = await api(myDayUrl(today), { token: me.token });
    const dump = JSON.stringify(r.json);
    expect(!dump.includes('TAJNY-PROJEKT-KOLEGY'),
      'název cizí soukromé mapy se do přehledu nedostane ani přes uzel přiřazený mně');

    // Na „hotovo dnes" hlídají DVĚ nezávislé obrany (poslední změna stavu v deníku
    // + pojistka „co je otevřené, není hotové"). Kdyby je hlídal jen scénář výš,
    // stačila by jedna a druhá by mohla tiše přestat platit — proto má každá svůj
    // vlastní případ, ve kterém ta druhá NEDOSAHUJE.
    console.log('== jen deník: vrácená práce v ARCHIVOVANÉM projektu ==');
    // Archivovaná práce se v žádné otevřené sekci neukazuje, takže pojistka na ni
    // nedosáhne — rozhodnout musí poslední změna stavu v deníku.
    const archMapa = (await api('/api/collections/goalmaps/records', {
      token: me.token,
      body: { title: 'ARCHIV-PROJEKT', nodes: [{ id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Archiv', title: 'Archiv', status: 'todo' } }, { id: 'arch1', type: 'goalNode', position: { x: 0, y: 120 }, data: { title: 'Archivní krok', status: 'todo' } }], edges: [{ id: 'e-arch1', source: 'apex', target: 'arch1' }] },
    })).json;
    const archUkol = (await api('/api/collections/tasks/records', {
      token: ST, body: { map: archMapa.id, node_id: 'arch1', title: 'UKOL-V-ARCHIVU', status: 'todo', assignee_email: me.email, deadline: today, owner: me.id, owner_email: me.email },
    })).json;
    await api(`/api/collections/tasks/records/${archUkol.id}`, { token: me.token, method: 'PATCH', body: { status: 'done' } });
    await api(`/api/collections/tasks/records/${archUkol.id}`, { token: me.token, method: 'PATCH', body: { status: 'todo' } });
    await api(`/api/collections/goalmaps/records/${archMapa.id}`, { token: me.token, method: 'PATCH', body: { archived: true } });
    r = await api(myDayUrl(today), { token: me.token });
    expect(!titlesIn(r.json.sections.doneToday).includes('UKOL-V-ARCHIVU'),
      `vrácená práce v archivovaném projektu v „hotovo dnes" nesvítí (${titlesIn(r.json.sections.doneToday)})`);

    console.log('== jen pojistka: vrátil mi to NĚKDO JINÝ ==');
    // Šéf mi úkol vrátí sám. Jeho záznam v deníku má JEHO e-mail, takže do mého
    // „co jsem dnes odbavil" nespadne a poslední změna, kterou vidím, je pořád
    // moje „→ hotovo". Tady zabírá jen pojistka podle aktuálního stavu.
    const sefovaMapa = (await api('/api/collections/goalmaps/records', {
      token: kolega.token,
      body: { title: 'SEFUV-PROJEKT', nodes: [{ id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Šéf', title: 'Šéf', status: 'todo' } }, { id: 's1', type: 'goalNode', position: { x: 0, y: 120 }, data: { title: 'Šéfův krok', status: 'todo' } }], edges: [{ id: 'e-s1', source: 'apex', target: 's1' }] },
    })).json;
    const zadany = (await api('/api/collections/tasks/records', {
      token: ST, body: { map: sefovaMapa.id, node_id: 's1', title: 'UKOL-OD-SEFA', status: 'todo', assignee_email: me.email, deadline: today, owner: kolega.id, owner_email: kolega.email },
    })).json;
    await api(`/api/collections/tasks/records/${zadany.id}`, { token: me.token, method: 'PATCH', body: { status: 'done' } });
    r = await api(myDayUrl(today), { token: me.token });
    expect(titlesIn(r.json.sections.doneToday).includes('UKOL-OD-SEFA'),
      `co jsem odbavil, vidím v „hotovo dnes" (${titlesIn(r.json.sections.doneToday)})`);
    await api(`/api/collections/tasks/records/${zadany.id}`, { token: kolega.token, method: 'PATCH', body: { status: 'todo' } });
    r = await api(myDayUrl(today), { token: me.token });
    expect(!titlesIn(r.json.sections.doneToday).includes('UKOL-OD-SEFA'),
      `po vrácení šéfem už jako hotové nesvítí (${titlesIn(r.json.sections.doneToday)})`);
    expect(titlesIn(r.json.sections.today).includes('UKOL-OD-SEFA'),
      'a je zpátky mezi mou dnešní prací');

    console.log('== bez přihlášení ==');
    r = await api(myDayUrl(today));
    expect(r.status === 401 || r.status === 403, `nepřihlášený dostane 401/403 (${r.status})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
