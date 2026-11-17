// Node data shape (code analysis 4, S2-04): the length caps of text fields applied to strings only. An array
// or an object as a title went through whole (megabytes into one node) and a number was stored as a number
// instead of text. Text fields are now text: numbers become text, anything else is dropped; caps apply always.
//
// Mutation proof: on the image before the fix the array title is stored whole and numbers stay numbers.
const H = require('./_harness');
const { expect } = H;

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'mapa-tvar-dat', env: { TZ: 'Europe/Prague', KB_UVODNI_MAPA: 0 } });
  await inst.register('a@e2e.cz');
  const A = await inst.login('a@e2e.cz');
  const uzel = (id, data) => ({ id, type: id === 'root' ? 'apexNode' : 'goalNode', position: { x: 0, y: 0 }, data: Object.assign({ status: 'todo' }, data) });
  const zaloz = (nodes) => inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Tvar', nodes, edges: nodes.slice(1).map((n) => ({ id: 'e-' + n.id, source: 'root', target: n.id })) } });
  const koren = uzel('root', { apexText: 'Tvar', title: 'Tvar' });

  console.log('== pole a objekt v textovém poli ==');
  const velke = Array(20000).fill('xxxxx');
  let r = await zaloz([koren, uzel('a', { title: velke, description: { x: velke }, icon: ['🙂'], owner: { e: 1 }, color: [1, 2] })]);
  expect(r.status === 200, `mapa s polem v názvu se uloží (${r.status})`);
  let d = ((r.json.nodes || []).find((n) => n.id === 'a') || {}).data || {};
  expect(JSON.stringify(r.json.nodes || []).length < 5000, `uzel nenese megabajty (${JSON.stringify(r.json.nodes || []).length} znaků)`);
  expect((d.title === '' || d.title === undefined) && (d.description === '' || d.description === undefined) && d.icon === '' && d.owner === '' && d.color === '',
    `pole/objekt v textovém poli se zahodí (${JSON.stringify(d).slice(0, 160)})`);

  console.log('== číslo v textovém poli ==');
  r = await zaloz([koren, uzel('b', { title: 12345, description: 7, deadlineChangeNote: 42, executorName: 3, automationNote: 9 })]);
  expect(r.status === 200, `číslo v poznámce k termínu požadavek neshodí (${r.status} ${JSON.stringify(r.json).slice(0, 120)})`);
  d = ((r.json.nodes || []).find((n) => n.id === 'b') || {}).data || {};
  expect(d.title === '12345' && d.description === '7' && d.deadlineChangeNote === '42', `čísla jsou text (${JSON.stringify([d.title, d.description, d.deadlineChangeNote])})`);

  console.log('== úprava existující mapy stejnou cestou ==');
  const id = r.json.id;
  r = await inst.api('PATCH', `/api/collections/goalmaps/records/${id}`, { token: A, body: { nodes: [koren, uzel('b', { title: 'x'.repeat(900), description: velke })] } });
  d = ((r.json.nodes || []).find((n) => n.id === 'b') || {}).data || {};
  expect(r.status === 200 && d.title.length === 500 && !d.description, `řetězec se dál ořízne na 500, pole v popisu zmizí (${r.status} ${d.title && d.title.length})`);
  r = await inst.api('PATCH', `/api/collections/goalmaps/records/${id}`, { token: A, body: { nodes: [koren, uzel('b', { title: 'Běžný krok', description: 'Popis', owner: 'a@e2e.cz', deadline: '2030-01-15' })] } });
  d = ((r.json.nodes || []).find((n) => n.id === 'b') || {}).data || {};
  expect(r.status === 200 && d.title === 'Běžný krok' && d.description === 'Popis' && d.owner === 'a@e2e.cz' && d.deadline === '2030-01-15', 'běžný uzel beze změny');
  inst.stop();
}, { nazev: 'MAPA-TVAR-DAT' });
