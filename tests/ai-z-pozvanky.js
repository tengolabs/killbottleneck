// Z POZVÁNKY DO KALENDÁŘE přes asistenta (Richard 22. 10. 2026) — proti PODVRŽENÉMU modelu a vision modelu.
//
// Co se hlídá: fotka rozpisu (jen data, bez času a slova „kalendář“) otevře skupinu událostí; přepis fotky
// má pravidlo „data/časy/místa přesně“; model zavolá create_events → JEDNA karta se VŠEMI termíny (den v týdnu,
// místo, „už v kalendáři“), nic se nezapíše bez potvrzení; po potvrzení odpoví APLIKACE (model se nevolá) a
// nabídne čip „Založit i projekt s přípravou“; klik na čip = tah s pravidlem PŘÍPRAVA A POVINNOSTI a nástrojem
// create_project; vadná položka = chyba pro model PŘED kartou; Ne = nic se nezapíše; dlouhý vložený e-mail
// s daty otevře skupinu událostí taky.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ai-z-pozvanky.js
const H = require('./_harness');
const { expect } = H;

const fronta = [];
const volani = [];
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const text = (s) => ({ content: s });
const posledniVolani = () => volani[volani.length - 1];
const systemZ = (v) => (v.messages.find((m) => m.role === 'system') || {}).content || '';
const toolZ = (v) => v.messages.filter((m) => m.role === 'tool');
const nabidnuto = (v, jm) => (v.tools || []).some((t) => t.function.name === jm);

const den = (n) => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const kratce = (ymd) => { const [, m, d] = ymd.split('-').map(Number); return `${d}. ${m}.`; };
const JPG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAEAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDkKKKK8U/TD//Z';

H.beh(async () => {
  const mock = await H.httpMock((req, res, body) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('{}'); return; }
    volani.push(JSON.parse(body));
    const o = fronta.shift() || text('(fronta prázdná)');
    const message = { role: 'assistant', content: o.content || '' };
    if (o.tool_calls) message.tool_calls = o.tool_calls;
    res.end(JSON.stringify({ message, prompt_eval_count: 111, eval_count: 22, done: true }));
  });
  const frontaVize = [];
  const volaniVize = [];
  const vize = await H.httpMock((req, res, body) => {
    res.setHeader('Content-Type', 'application/json');
    volaniVize.push(JSON.parse(body || '{}'));
    res.end(JSON.stringify({ message: { role: 'assistant', content: frontaVize.shift() || '(žádný text)' }, prompt_eval_count: 452, eval_count: 40, done: true }));
  });
  const inst = await H.startInstance({ slug: 'ai-z-pozvanky', addHostGateway: true, env: {
    // produkční výchozí: po potvrzení jednoduché karty dopoví aplikace (harness jinak dává KB_CHAT_POTVRZENI=model)
    KB_CHAT_POTVRZENI: null, TZ: 'Europe/Prague', KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
    KB_VISION_PROVIDER: 'ollama', KB_VISION_URL: vize.base, KB_VISION_MODEL: 'vize-a', KB_VISION_POKUSY: 0,
  } });
  await inst.register('rodic@example.com', { name: 'Petra' });
  const A = await inst.login('rodic@example.com');
  const udalosti = async () => ((await inst.api('GET', '/api/kb/events', { token: A })).json.events || []);

  // jedna událost už v kalendáři je (pozvánka poslaná podruhé / ručně zapsaný první termín)
  let r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Přednáška: Fyzika I', day: den(7), time: '10:00' } });
  expect(r.status === 200, 'první přednáška už v kalendáři');
  // a v čase třetí přednášky má schůzku (jen upozornění, neblokuje)
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Schůzka s účetní', day: den(21), time: '10:30', end_time: '11:00' } });
  expect(r.status === 200, 'kolidující schůzka');

  console.log('== fotka rozpisu na dveřích → jedna karta se všemi termíny ==');
  frontaVize.push(`Fyzika I — přednášky\n- ${kratce(den(7))} posluchárna T1\n- ${kratce(den(14))} posluchárna T1\n- ${kratce(den(21))} posluchárna T1`);
  const items = [7, 14, 21].map((n) => ({ title: 'Přednáška: Fyzika I', day: den(n), time: '10:00', end_time: '11:30', place: 'Posluchárna T1' }));
  fronta.push(nastroj('create_events', { items, remind_before_min: 30 })); // zápis = karta, tah tím končí
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '', image_base64: JPG } });
  expect(r.status === 200, `tah s fotkou (${r.status} ${JSON.stringify(r.json).slice(0, 160)})`);
  let chat = r.json.chat;
  expect(/data, dny v týdnu, časy|Data, dny v týdnu, časy/.test((volaniVize[0].messages || []).map((m) => m.content).join('\n')), 'přepis fotky má pravidlo opsat data, časy a místa přesně');
  const v0 = volani[0];
  expect(nabidnuto(v0, 'create_events') && nabidnuto(v0, 'list_calendars'), 'fotka s daty otevřela skupinu událostí (create_events, list_calendars)');
  expect(/POZVÁNKA \/ ROZPIS/.test(systemZ(v0)) && /create_events/.test(systemZ(v0)), 'systém nese pravidlo POZVÁNKA');
  expect(/POZVÁNK|ROZPIS TERMÍNŮ/.test(systemZ(v0)) && /NE projekt ani zásobník/.test(systemZ(v0)), 'u přepisu fotky má pozvánka přednost před projektem/zásobníkem');
  const karty = chat.messages.flatMap((m) => m.karty || []).filter((k) => k.type === 'akce');
  expect(karty.length === 1 && chat.pending.length === 1, `JEDNA karta, jedna čekající akce (${karty.length}/${chat.pending.length})`);
  const k = karty[0];
  expect(/^Přidat do kalendáře 3 události „Přednáška: Fyzika I“ \(.+–.+\) · připomenout 30 min předem$/.test(k.popis), `popis karty (${k.popis})`);
  expect(Array.isArray(k.udalosti) && k.udalosti.length === 3, `karta nese všechny 3 termíny (${JSON.stringify(k.udalosti)})`);
  expect(k.udalosti[0].stav === 'dup' && k.udalosti[1].stav === '' && k.udalosti[2].stav === 'prekryv' && /účetní/.test(k.udalosti[2].info), 'řádky: 1. už v kalendáři, 2. nový, 3. v tu dobu schůzka');
  expect(/^(po|út|st|čt|pá|so|ne) /.test(k.udalosti[1].kdy) && /10:00–11:30/.test(k.udalosti[1].kdy) && k.udalosti[1].place === 'Posluchárna T1', `řádek: den v týdnu, čas od–do, místo (${k.udalosti[1].kdy})`);
  expect((await udalosti()).length === 2, 'bez potvrzení se nic nezapsalo');

  console.log('== potvrzení: zápis, odpověď aplikace, nabídka projektu ==');
  const volaniPred = volani.length;
  r = await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: chat.id, action_id: k.id, ok: true } });
  expect(r.status === 200, `potvrzeno (${r.status})`);
  chat = r.json.chat;
  const ev = (await udalosti()).filter((e) => /Fyzika/.test(e.title));
  expect(ev.length === 3, `v kalendáři 3 přednášky — dvě nové, první nezdvojená (${ev.length})`);
  const nove = ev.filter((e) => e.series);
  expect(nove.length === 2 && nove[0].series === nove[1].series && nove.every((e) => e.place === 'Posluchárna T1' && e.remind_before_min === 30), 'nové dvě v jedné sérii s místem a připomínkou');
  expect(volani.length === volaniPred, `po potvrzení odpověděla aplikace — model se nevolal (${volani.length - volaniPred})`);
  const posl = chat.messages[chat.messages.length - 1];
  expect(posl.role === 'assistant' && posl.app === true && /^Do kalendáře přidány 2 události \(1 už tam byla\)\. Mám k tomu založit i projekt s přípravou/.test(posl.content), `text aplikace (${posl.content})`);
  const navrhy = (posl.karty || []).find((x) => x.type === 'navrhy');
  expect(!!navrhy && navrhy.items[0] === 'Založit i projekt s přípravou' && navrhy.items.includes('Ne, díky'), `čipy (${navrhy && navrhy.items})`);
  const kPo = chat.messages.flatMap((m) => m.karty || []).find((x) => x.id === k.id);
  expect(kPo.stav === 'hotovo' && kPo.odkaz && kPo.odkaz.serie === true && !!kPo.odkaz.udalost_id, 'karta hotovo s odkazem do kalendáře (série)');

  console.log('== klik na čip „Založit i projekt s přípravou“ ==');
  fronta.push(nastroj('create_project', { title: 'Fyzika I', description: 'Termíny: 3× přednáška v kalendáři', outline: [{ title: 'Zapsat se do předmětu' }, { title: 'Koupit skripta' }] }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Založit i projekt s přípravou' } });
  const vP = posledniVolani();
  expect(nabidnuto(vP, 'create_project'), 'tah po čipu nabídl create_project');
  expect(/PŘÍPRAVA A POVINNOSTI/.test(systemZ(vP)) && /NEKOPÍRUJ/.test(systemZ(vP)), 'systém nese pravidlo projektu s přípravou (termíny nekopírovat)');
  chat = r.json.chat;
  expect(chat.pending.length === 1 && chat.pending[0].name === 'create_project', 'projekt jde přes kartu');

  console.log('== Ne = nic; vadná položka = chyba pro model před kartou ==');
  fronta.push(nastroj('create_events', { items: [{ title: 'Golf', day: den(9), time: '15:00' }, { title: 'Golf', day: den(16), time: '15:00' }] }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Golf pro děti: ' + kratce(den(9)) + ' a ' + kratce(den(16)) + ' vždy v 15:00' } });
  chat = r.json.chat;
  const kG = chat.messages.flatMap((m) => m.karty || []).find((x) => x.type === 'akce');
  fronta.push(text('Dobře, nic nezapisuji.'));
  r = await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: chat.id, action_id: kG.id, ok: false } });
  expect(!(await udalosti()).some((e) => e.title === 'Golf'), 'Ne → žádný golf v kalendáři');
  fronta.push(nastroj('create_events', { items: [{ title: 'Fotbal', day: den(3), time: '16:00' }, { title: 'Fotbal', day: '2026-02-30', time: '16:00' }] }), text('Druhé datum neexistuje, které myslíte?'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'a fotbal' } });
  expect(r.json.chat.pending.length === 0 && toolZ(posledniVolani()).some((m) => /#2/.test(m.content) && /Nothing was written/.test(m.content)), 'vadné datum položky č. 2 → chyba pro model, žádná karta');

  console.log('== plakát s JEDNÍM termínem (fotka): nabídka projektu i tak; termín bez konce hlásí překryv ==');
  // schválený plán: projekt nabídnout při ≥ 2 událostech NEBO když zdrojem byla fotka/PDF/e-mail (/checkup 2. 11.)
  // porada začíná PŘESNĚ v čas koncertu — bez výchozí délky by měl termín bez konce nulovou délku a nic nepřekryl
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Porada rodičů', day: den(22), time: '10:30', end_time: '11:00' } });
  frontaVize.push(`ZUŠ — koncert žáků\n${kratce(den(22))} v 10:30, sál ZUŠ`);
  fronta.push(nastroj('create_events', { items: [{ title: 'Koncert ZUŠ', day: den(22), time: '10:30', place: 'Sál ZUŠ' }] }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '', image_base64: JPG } });
  chat = r.json.chat;
  const kZ = chat.messages.flatMap((m) => m.karty || []).find((x) => x.type === 'akce' && x.stav !== 'hotovo');
  expect(!!kZ && Array.isArray(kZ.udalosti) && kZ.udalosti[0].stav === 'prekryv' && /Porada rodičů/.test(kZ.udalosti[0].info),
    `termín jen se začátkem 10:30 × porada 10:30–11:00 → „v tu dobu máte“ (${kZ && JSON.stringify(kZ.udalosti)})`);
  r = await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: chat.id, action_id: kZ.id, ok: true } });
  const poslZ = r.json.chat.messages[r.json.chat.messages.length - 1];
  const navrhyZ = (poslZ.karty || []).find((x) => x.type === 'navrhy');
  expect(/^Do kalendáře přidána 1 událost\. Mám k tomu založit i projekt/.test(poslZ.content) && !!navrhyZ && navrhyZ.items[0] === 'Založit i projekt s přípravou',
    `jedna událost z fotky → nabídka projektu (${poslZ.content} | ${navrhyZ && navrhyZ.items})`);

  console.log('== krátká zpráva s jednou událostí: projekt se NEnabízí ==');
  fronta.push(nastroj('create_events', { items: [{ title: 'Zubař', day: den(5), time: '08:00' }] }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'zubař ' + kratce(den(5)) + ' v 8' } });
  chat = r.json.chat;
  const kZu = chat.messages.flatMap((m) => m.karty || []).find((x) => x.type === 'akce' && x.stav !== 'hotovo');
  r = await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: chat.id, action_id: kZu.id, ok: true } });
  const poslZu = r.json.chat.messages[r.json.chat.messages.length - 1];
  const navrhyZu = (poslZu.karty || []).find((x) => x.type === 'navrhy');
  expect(/^Do kalendáře přidána 1 událost\.$/.test(poslZu.content) && !!navrhyZu && !navrhyZu.items.includes('Založit i projekt s přípravou'),
    `„zubař“ bez nabídky projektu (${poslZu.content} | ${navrhyZu && navrhyZu.items})`);

  console.log('== vložený e-mail s pozvánkou (bez času, bez slova kalendář) otevře skupinu událostí ==');
  const mail = `Dobrý den, zveme Vás na cyklus seminářů o digitalizaci účetnictví pro malé firmy. Semináře proběhnou ${kratce(den(30))} a ${kratce(den(37))} v budově Hospodářské komory, Freyova 27, Praha 9. Účast je zdarma, přihlášky posílejte do ${kratce(den(20))} na adresu seminare@example.org. Těšíme se na Vás, organizační tým.`;
  fronta.push(text('Mám to přidat?'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: mail } });
  expect(nabidnuto(posledniVolani(), 'create_events'), 'dlouhý text se 2+ daty nabídl create_events');
  fronta.push(text('Dobře.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Napiš mi básničku o podzimu' } });
  expect(!nabidnuto(posledniVolani(), 'create_events'), 'běžná krátká zpráva skupinu událostí neotevře');
  fronta.push(text('Dobře.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Shrnutí týdne: máme 2 nové úkoly a 3 nové nápady, Marek 5× volal zákazníkovi, marketing 2 týmy, verze 1.2 venku. Prosím projdi, co z toho dát do projektu a co do zásobníku, a co bys doporučil dál.' } });
  expect(!nabidnuto(posledniVolani(), 'create_events'), 'dlouhý text bez skutečných dat („2 nové“, „Marek 5“) skupinu událostí neotevře');

  inst.stop();
}, { nazev: 'AI Z POZVÁNKY' });
