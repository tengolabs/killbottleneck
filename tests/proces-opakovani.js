// OPAKOVÁNÍ PRO NEPŘETRŽITÝ BĚH (styl Proces, Richard 21. 10. 2026, maketa
// 8099/kb-proces schválena 25. 10.): rytmus „každý N-tý" + dny v týdnu,
// akce reset_subtree (podcíle a úkoly zpět na Založeno), vyčištění plánu,
// připomínka k uzlu přežije odškrtnutí, zdraví běhu z historie průchodů.
// Další termín počítá server (helpers.js dalsiTermin) i klient (lib/rhythm.js)
// — sada je porovná na stejných vstupech (parita), ať karta neslibuje jiný den.
// Data VŽDY z kontejneru (past UTC×hostitel).
const path = require('path');
const { pathToFileURL } = require('url');
const H = require('./_harness');
const { expect } = H;

const node = (id, data, type) => ({ id, type: type || 'goalNode', position: { x: 0, y: 100 }, data });
const findNode = (m, id) => (m.nodes || []).find((n) => n.id === id);

H.beh(async () => {
  const R = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'rhythm.js')).href);
  const RR = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'recurrenceRule.js')).href);

  console.log('== jednotkově: den v měsíci drží (31. po únoru zase 31.) a „dnes“ v pásmu instance ==');
  global.__hooks = path.join(__dirname, '..', 'server', 'pb_hooks');
  const SH = require(path.join(__dirname, '..', 'server', 'pb_hooks', 'helpers.js'));
  const SkutecnyDate = Date;
  const vCase = (iso, fn) => {   // „teď“ = iso (pro new Date() bez argumentů i Date.now)
    global.Date = class extends SkutecnyDate { constructor(...a) { super(...(a.length ? a : [iso])); } static now() { return new SkutecnyDate(iso).getTime(); } };
    try { return fn(); } finally { global.Date = SkutecnyDate; }
  };
  const retez = (od, akce, kroku) => { const out = [od]; for (let i = 0; i < kroku; i++) { const b = out[out.length - 1]; out.push(vCase(`${b}T12:00:00Z`, () => SH.dalsiTermin(b, akce.advance, { every: akce.every, days: akce.days, monthDay: akce.month_day }))); } return out; };
  let rt = retez('2027-01-31', { advance: 'monthly', month_day: 31 }, 3);
  expect(rt.join() === '2027-01-31,2027-02-28,2027-03-31,2027-04-30', `každý měsíc 31.: ${rt.join(' → ')}`);
  rt = retez('2026-12-31', { advance: 'monthly', every: 2, month_day: 31 }, 3);
  expect(rt.join() === '2026-12-31,2027-02-28,2027-04-30,2027-06-30', `každý 2. měsíc 31.: ${rt.join(' → ')}`);
  rt = retez('2028-02-29', { advance: 'monthly', month_day: 30 }, 2);
  expect(rt.join() === '2028-02-29,2028-03-30,2028-04-30', `přestupný rok, 30.: ${rt.join(' → ')}`);
  const rFe = (akce) => RR.recurrenceOf([{ node_id: 'n', trigger: { type: 'node_status_changed', status: 'done' }, conditions: [], actions: [{ type: 'set_status', status: 'todo' }, Object.assign({ type: 'set_deadline' }, akce)] }], 'n');
  let shoda = true;
  for (const [b, akce] of [['2027-02-28', { advance: 'monthly', month_day: 31 }], ['2027-02-28', { advance: 'monthly', every: 2, month_day: 31 }], ['2026-11-30', { advance: 'monthly', month_day: 31 }]]) {
    const srv = vCase(`${b}T12:00:00Z`, () => SH.dalsiTermin(b, akce.advance, { every: akce.every, monthDay: akce.month_day }));
    const kl = R.nextDue(b, rFe(akce), b);
    if (srv !== kl) { shoda = false; console.log('   ', b, JSON.stringify(akce), srv, '≠', kl); }
  }
  expect(shoda, 'parita server × klient pro den v měsíci (recurrenceOf → day → nextDue)');
  expect(R.rhythmLabel((k, o) => `${k}:${(o || {}).d}`, rFe({ advance: 'monthly', month_day: 31 }), '2027-02-28') === 'common:rhythm.monthlyDay:31', 'popis rytmu bere den z pravidla, ne z oříznutého termínu');
  const puvTZ = process.env.TZ;
  process.env.TZ = 'Pacific/Kiritimati';   // UTC+14: 28. 10. 12:00 UTC = 29. 10. 02:00 místně
  const poPulnoci = vCase('2026-10-28T12:00:00Z', () => SH.dalsiTermin('2026-10-27', 'daily'));
  const poPulnociRytmus = vCase('2026-10-28T12:00:00Z', () => SH.dalsiTermin('2026-10-27', 'daily', { every: 2 }));
  if (puvTZ === undefined) delete process.env.TZ; else process.env.TZ = puvTZ;
  expect(poPulnoci === '2026-10-30' && poPulnociRytmus === '2026-10-31', `„dnes“ = místní den instance, ne UTC (${poPulnoci}, ${poPulnociRytmus})`);
  expect(!!RR.buildRecurrenceRule('n', { freq: 'monthly', every: 1, day: 31 }, 'x').actions.find((x) => x.month_day === 31), 'buildRecurrenceRule nese month_day');

  const inst = await H.startInstance({ slug: 'proces-opak', env: { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0 } });
  const { api } = inst;
  await inst.register('a@example.com');
  const A = await inst.login('a@example.com');
  const tok = (x) => x.token || x;
  const dnes = inst.exec('date +%F').trim(); // server počítá „dnes" v pásmu kontejneru (TZ; v testu UTC)
  const plusDny = (n) => R.addDays(dnes, n);
  const fresh = async (id) => (await api('GET', `/api/collections/goalmaps/records/${id}`, { token: tok(A) })).json;
  const patch = async (m, nodes, edges) => {
    const f = await fresh(m.id);
    return api('PATCH', `/api/collections/goalmaps/records/${m.id}`, { token: tok(A), body: { nodes, edges: edges || f.edges, base_updated: f.updated } });
  };
  const hotovo = async (m, id) => {
    const f = await fresh(m.id);
    return patch(m, f.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, status: 'done' } } : n)), f.edges);
  };
  const ulozPravidlo = (m, nodeId, deadlineAkce, extra = []) => api('POST', '/api/kb/rules/save', { token: tok(A), body: {
    map: m.id, name: `Opakování ${nodeId}`, node_id: nodeId,
    trigger: { type: 'node_status_changed', status: 'done' }, conditions: [],
    actions: [{ type: 'set_status', status: 'todo' }, Object.assign({ type: 'set_deadline' }, deadlineAkce), ...extra],
  } });

  const map = (await api('POST', '/api/collections/goalmaps/records', { token: tok(A), body: {
    title: 'Vyřizování objednávek', kind: 'process',
    nodes: [node('root', { apexText: 'Vyřizování objednávek', title: 'Vyřizování objednávek', status: 'todo' }, 'apexNode')], edges: [],
  } })).json;

  console.log('== validace rytmu a nové akce ==');
  let f = await fresh(map.id);
  await patch(map, f.nodes.concat([
    node('ZK', { title: 'Zkontrolovat objednávky', status: 'todo', owner: 'a@example.com', deadline: plusDny(-1), plannedOn: plusDny(2) }),
    node('S1', { title: 'Spočítat krabice', status: 'done' }),
    node('S2', { title: 'Zkontrolovat křehké zboží', status: 'in_progress' }),
    node('S3', { title: 'Zapsat rozdíly', status: 'todo' }),
    node('S21', { title: 'Hlubší podkrok', status: 'done' }),
    node('JINY', { title: 'Jiná větev', status: 'done' }),
  ]), f.edges.concat([
    { id: 'eZK', source: 'root', target: 'ZK' }, { id: 'eS1', source: 'ZK', target: 'S1' },
    { id: 'eS2', source: 'ZK', target: 'S2' }, { id: 'eS3', source: 'ZK', target: 'S3' },
    { id: 'eS21', source: 'S2', target: 'S21' }, { id: 'eJ', source: 'root', target: 'JINY' },
  ]));
  let r = await ulozPravidlo(map, 'ZK', { advance: 'daily', days: [1, 3] });
  expect(r.status === 400 && /days/.test(JSON.stringify(r.json)), `days jen u týdne (${r.status})`);
  r = await ulozPravidlo(map, 'ZK', { advance: 'weekly', every: 5 });
  expect(r.status === 400 && /every/.test(JSON.stringify(r.json)), `every jen 1–4 (${r.status})`);
  r = await ulozPravidlo(map, 'ZK', { advance: 'weekly', days: [0, 8] });
  expect(r.status === 400, `den mimo 1–7 odmítnut (${r.status})`);
  r = await ulozPravidlo(map, 'ZK', { relative_days: 3, every: 2 });
  expect(r.status === 400, `every bez advance odmítnut (${r.status})`);
  r = await api('POST', '/api/kb/rules/save', { token: tok(A), body: { map: map.id, name: 'Reset bez uzlu', trigger: { type: 'schedule', freq: 'daily' }, actions: [{ type: 'reset_subtree' }] } });
  expect(r.status === 400, `reset_subtree na celomapovém plánu bez uzlu odmítnut (${r.status})`);
  r = await ulozPravidlo(map, 'ZK', { advance: 'weekly', days: [5, 1, 3], every: 1 }, [{ type: 'reset_subtree' }]);
  expect(r.status === 200 && r.json.rule, `weekly po/st/pá + reset_subtree uloženo (${r.status})`);
  const akce = r.json.rule ? r.json.rule.actions : [];
  expect(akce[1] && akce[1].advance === 'weekly' && JSON.stringify(akce[1].days) === '[1,3,5]' && akce[1].every === undefined, `dny seřazené, every=1 se neukládá (${JSON.stringify(akce[1])})`);
  expect(akce[2] && akce[2].type === 'reset_subtree', 'akce reset_subtree je v pravidle');

  console.log('== odškrtnutí: krok zpět, podkroky celého podstromu zpět, plán pryč, termín dle dnů ==');
  await hotovo(map, 'ZK');
  let m = await fresh(map.id);
  const zk = findNode(m, 'ZK').data;
  const ocekavany = R.nextDue(plusDny(-1), { freq: 'weekly', every: 1, days: [1, 3, 5] }, dnes);
  expect(zk.status === 'todo', 'opakovaný krok je zpět na Založeno');
  expect(zk.deadline === ocekavany, `termín = další po/st/pá po dnešku — server i klient se shodnou (${zk.deadline} vs ${ocekavany})`);
  expect(!zk.plannedOn, `plán „kdy to chci řešit" vyčištěn (${zk.plannedOn})`);
  expect(['S1', 'S2', 'S3', 'S21'].every((id) => findNode(m, id).data.status === 'todo'), 'všechny podkroky (i hlubší) zpět na Založeno');
  expect(findNode(m, 'JINY').data.status === 'done', 'jiná větev mapy nedotčena');

  console.log('== připomínka k opakovanému kroku přežije odškrtnutí a posune se ==');
  f = await fresh(map.id);
  await patch(map, f.nodes.concat([node('PR', { title: 'Předat doklady', status: 'todo', owner: 'a@example.com', deadline: plusDny(3) })]), f.edges.concat([{ id: 'ePR', source: 'root', target: 'PR' }]));
  r = await ulozPravidlo(map, 'PR', { advance: 'weekly' }, [{ type: 'reset_subtree' }]);
  expect(r.status === 200, `pravidlo PR uloženo (${r.status})`);
  r = await api('POST', '/api/kb/node-reminders/save', { token: tok(A), body: { map: map.id, node_id: 'PR', offset_days: 1, time: '08:00' } });
  expect(r.status === 200, `připomínka den předem založena (${r.status} ${JSON.stringify(r.json).slice(0, 80)})`);
  await hotovo(map, 'PR');
  const pr = findNode(await fresh(map.id), 'PR').data;
  expect(pr.status === 'todo' && pr.deadline === plusDny(10), `PR: další týden (${pr.deadline})`);
  r = await api('GET', `/api/kb/node-reminders?map=${map.id}&node_id=PR`, { token: tok(A) });
  const pripominky = r.json.reminders || [];
  expect(pripominky.length === 1, `připomínka přežila odškrtnutí opakovaného kroku (${JSON.stringify(r.json).slice(0, 120)})`);
  expect(pripominky[0] && pripominky[0].day === plusDny(9), `a posunula se na den před novým termínem (${pripominky[0] && pripominky[0].day} vs ${plusDny(9)})`);

  console.log('== projektový (neopakovaný) krok: připomínka po Hotovo dál zaniká ==');
  f = await fresh(map.id);
  await patch(map, f.nodes.concat([node('JED', { title: 'Jednorázový', status: 'todo', owner: 'a@example.com', deadline: plusDny(5) })]), f.edges.concat([{ id: 'eJED', source: 'root', target: 'JED' }]));
  await api('POST', '/api/kb/node-reminders/save', { token: tok(A), body: { map: map.id, node_id: 'JED', offset_days: 1, time: '09:00' } });
  await hotovo(map, 'JED');
  r = await api('GET', `/api/kb/node-reminders?map=${map.id}&node_id=JED`, { token: tok(A) });
  const zbyle = r.json.reminders || r.json.items || r.json || [];
  expect(Array.isArray(zbyle) && zbyle.length === 0, 'hotový jednorázový krok připomínku nemá (beze změny)');

  console.log('== úkoly kroku se obnoví taky ==');
  // kolekce úkolů je od 17. 8. 2026 legacy (nové úkoly = uzly) — starý úkol založí superuser
  const ST = await inst.superuser();
  r = await api('POST', '/api/collections/tasks/records', { token: ST, body: { title: 'Úkol u kroku', map: map.id, node_id: 'S1', status: 'done', assignee_email: 'a@example.com', owner: (await fresh(map.id)).owner, owner_email: 'a@example.com' } });
  const ukol = r.json;
  expect(r.status === 200 && ukol.id, `úkol u podkroku založen (${r.status})`);
  await hotovo(map, 'ZK');
  r = await api('GET', `/api/collections/tasks/records/${ukol.id}`, { token: ST });
  expect(r.json.status === 'todo', `úkol v podstromu zpět na todo (${r.json.status})`);

  console.log('== každý N-tý: týden po 2, měsíc po 2, den po 3 — parita server × klient ==');
  const pripady = [
    { id: 'W2', deadline: plusDny(-3), akce: { advance: 'weekly', every: 2, days: [2, 4] }, r: { freq: 'weekly', every: 2, days: [2, 4] } },
    { id: 'W1', deadline: plusDny(-10), akce: { advance: 'weekly' }, r: { freq: 'weekly', every: 1 } },
    { id: 'M2', deadline: plusDny(-40), akce: { advance: 'monthly', every: 2 }, r: { freq: 'monthly', every: 2 } },
    { id: 'D3', deadline: plusDny(-1), akce: { advance: 'daily', every: 3 }, r: { freq: 'daily', every: 3 } },
    { id: 'BEZ', deadline: '', akce: { advance: 'weekly', days: [7] }, r: { freq: 'weekly', every: 1, days: [7] } },
  ];
  f = await fresh(map.id);
  await patch(map, f.nodes.concat(pripady.map((p) => node(p.id, { title: `Rytmus ${p.id}`, status: 'todo', deadline: p.deadline }))),
    f.edges.concat(pripady.map((p) => ({ id: `e${p.id}`, source: 'root', target: p.id }))));
  for (const p of pripady) {
    r = await ulozPravidlo(map, p.id, p.akce);
    expect(r.status === 200, `pravidlo ${p.id} uloženo (${r.status})`);
    await hotovo(map, p.id);
    m = await fresh(map.id);
    const d = findNode(m, p.id).data;
    const exp = R.nextDue(p.deadline, p.r, dnes);
    expect(d.status === 'todo' && d.deadline === exp, `${p.id}: server ${d.deadline} = klient ${exp}`);
  }

  console.log('== zdraví běhu: průchody, po termínu, poslední průchod ==');
  r = await api('GET', `/api/kb/process-health?map=${map.id}&today=${dnes}`, { token: tok(A) });
  const h = r.json;
  const stZK = (h.steps || []).find((s) => s.id === 'ZK');
  expect(h.recurring === 2 + pripady.length, `opakovaných kroků ${2 + pripady.length} (${h.recurring})`);
  expect(stZK && stZK.runs90 === 2 && stZK.runs30 === 2, `ZK prošel 2× (${stZK && stZK.runs90})`);
  expect(stZK && stZK.late90 === 1, `z toho 1× po termínu — první odškrtnutí měl termín včera (${stZK && stZK.late90})`);
  expect(stZK && stZK.rhythm && stZK.rhythm.freq === 'weekly' && JSON.stringify(stZK.rhythm.days) === '[1,3,5]' && stZK.rhythm.reset === true, `rytmus kroku pro čtenáře (${JSON.stringify(stZK && stZK.rhythm)})`);
  expect(h.late === 0 && h.ok === h.recurring, `teď nic po termínu (${h.late}/${h.ok})`);
  expect(h.last && h.last.at && (h.steps || []).some((s) => s.id === h.last.node_id), 'poslední průchod je známý');
  expect(h.runs30 >= 3 + pripady.length, `průchodů za 30 dní ${h.runs30}`);
  // krok po termínu se do „po termínu" počítá, dokud je otevřený
  f = await fresh(map.id);
  await patch(map, f.nodes.map((n) => (n.id === 'W1' ? { ...n, data: { ...n.data, deadline: plusDny(-2) } } : n)), f.edges);
  r = await api('GET', `/api/kb/process-health?map=${map.id}&today=${dnes}`, { token: tok(A) });
  expect(r.json.late === 1 && (r.json.steps || []).find((s) => s.id === 'W1').late === true, `propadlý výskyt = 1 po termínu (${r.json.late})`);

  console.log('== Můj den: opakovaný krok nese rytmus ==');
  r = await api('GET', `/api/kb/my-day?today=${dnes}`, { token: tok(A) });
  const vse = [].concat(...Object.values(r.json.sections || {}).filter(Array.isArray));
  const radekZK = vse.find((x) => x.kind === 'node' && x.id === 'ZK');
  expect(radekZK && radekZK.rhythm && radekZK.rhythm.freq === 'weekly', `řádek ZK v Můj den má rytmus (${JSON.stringify(radekZK && radekZK.rhythm)})`);

  console.log('== přepnutí na projekt: pravidla zůstanou, opakování běží dál ==');
  f = await fresh(map.id);
  await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: tok(A), body: { kind: '', base_updated: f.updated } });
  const pred = findNode(await fresh(map.id), 'ZK').data.deadline;
  await hotovo(map, 'ZK');
  m = await fresh(map.id);
  expect(m.kind === '' && findNode(m, 'ZK').data.status === 'todo' && findNode(m, 'ZK').data.deadline > pred, `v projektu se krok dál opakuje (${pred} → ${findNode(m, 'ZK').data.deadline})`);
}, { nazev: 'PROCES-OPAKOVANI' });
