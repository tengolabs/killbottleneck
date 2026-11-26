// A deadline, a plan or a requested date must be a REAL day of the calendar (whole-app analysis 5, c11-1).
// The public API and MCP used to check only the shape \d{4}-\d{2}-\d{2}: an agent wrote the deadline
// 2026-13-45 or 2027-02-31, got 200, and the map and the management overview showed "Invalid Date".
// Every write path that takes such a day is asked here: v1 update_node, v1 create_map and add_nodes
// (the tree), the same three through MCP, the deadline-change request of the app and a rule's set_deadline.
// What is refused must also leave the stored map untouched, and the message must say what is wrong.
const H = require('./_harness');
const { expect } = H;

const BAD = ['2026-13-45', '2027-02-31', '2026-00-10', '2026-04-31', '2025-02-29'];
const GOOD = ['2028-02-29', '2027-12-31'];

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'real-day', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register('agent@e2e.cz');
  const T = await inst.login('agent@e2e.cz');
  const key = (await inst.api('POST', '/api/kb/api-keys', { token: T, body: { label: 'rw', scope: 'read_write' } })).json.token;
  const v1 = (method, path, body) => inst.api(method, `/api/kb/v1${path}`, { bearer: key, body });
  let rpc = 1;
  const mcp = async (name, args) => {
    const r = await inst.api('POST', '/mcp', { bearer: key, body: { jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name, arguments: args } } });
    const res = (r.json && r.json.result) || {};
    return { isError: !!res.isError || !!(r.json && r.json.error), text: ((res.content || [])[0] || {}).text || JSON.stringify(r.json) };
  };

  let r = await v1('POST', '/maps', { title: 'Hotel', tree: [{ title: 'Reception survey', deadline: '2027-03-03' }, { title: 'Snag list' }] });
  expect(r.status === 200 && !!r.json.id, `map created through v1 (${r.status})`);
  const mapId = r.json.id;
  const read = async () => (await v1('GET', `/maps/${mapId}`)).json;
  const flat = (tree, out = []) => { for (const n of tree || []) { out.push(n); flat(n.children, out); } return out; };
  const nodeOf = async (title) => flat((await read()).tree).find((n) => n.title === title);
  const survey = await nodeOf('Reception survey');
  expect(!!survey && survey.deadline === '2027-03-03', 'the step has its deadline 2027-03-03');

  console.log('== v1 update_node: a day that does not exist → 400, nothing stored ==');
  for (const bad of BAD) {
    const base = (await read()).updated;
    r = await v1('POST', `/maps/${mapId}/nodes/${survey.id}`, { deadline: bad, base_updated: base });
    const kept = (await nodeOf('Reception survey')).deadline;
    expect(r.status === 400 && kept === '2027-03-03', `${bad} → 400 and the deadline stays (${r.status}, stored ${kept})`);
  }
  r = await v1('POST', `/maps/${mapId}/nodes/${survey.id}`, { deadline: '2026-13-45', base_updated: (await read()).updated });
  expect(/2026-13-45/.test(r.json.error || '') && /kalendáři není/.test(r.json.error || ''), `Czech message names the date and says it is not in the calendar (${r.json.error})`);
  // the language of a key is the language of its account
  await inst.register('english@e2e.cz', { language: 'en' });
  const keyEn = (await inst.api('POST', '/api/kb/api-keys', { token: await inst.login('english@e2e.cz'), body: { label: 'rw', scope: 'read_write' } })).json.token;
  r = await inst.api('POST', '/api/kb/v1/maps', { bearer: keyEn, body: { title: 'English', tree: [{ title: 'Step', deadline: '2026-13-45' }] } });
  expect(r.status === 400 && /2026-13-45/.test(r.json.error || '') && /not a day of the calendar/.test(r.json.error || ''), `English account gets the English message (${r.json.error})`);
  r = await v1('POST', `/maps/${mapId}/nodes/${survey.id}`, { deadline: '27. 11. 2026', base_updated: (await read()).updated });
  expect(r.status === 400 && /RRRR-MM-DD/.test(r.json.error || '') && !/kalendáři není/.test(r.json.error || ''), `a wrong SHAPE keeps its own message (${r.json.error})`);
  for (const good of GOOD) {
    r = await v1('POST', `/maps/${mapId}/nodes/${survey.id}`, { deadline: good, base_updated: (await read()).updated });
    expect(r.status === 200 && r.json.node.deadline === good, `${good} is a real day → 200 (${r.status})`);
  }
  r = await v1('POST', `/maps/${mapId}/nodes/${survey.id}`, { deadline: '', base_updated: (await read()).updated });
  expect(r.status === 200 && !r.json.node.deadline, `an empty string still clears the deadline (${r.status})`);

  console.log('== v1 create_map and add_nodes: the tree ==');
  r = await v1('POST', '/maps', { title: 'Bad tree', tree: [{ title: 'Kick-off', children: [{ title: 'Deep step', deadline: '2027-02-31' }] }] });
  expect(r.status === 400 && /2027-02-31/.test(r.json.error || '') && /Deep step/.test(r.json.error || ''), `create_map with 2027-02-31 → 400 naming the step and the date (${r.status}: ${r.json.error})`);
  r = await v1('GET', '/maps');
  expect(!(r.json.maps || r.json.items || []).some((m) => m.title === 'Bad tree'), 'the refused map was not created');
  const before = flat((await read()).tree).length;
  r = await v1('POST', `/maps/${mapId}/nodes`, { items: [{ title: 'Added', deadline: '2026-13-45' }], base_updated: (await read()).updated });
  expect(r.status === 400 && flat((await read()).tree).length === before, `add_nodes with 2026-13-45 → 400, no step added (${r.status})`);
  r = await v1('POST', `/maps/${mapId}/nodes`, { items: [{ title: 'Added', planned_on: '2026-02-30' }], base_updated: (await read()).updated });
  expect(r.status === 400 && flat((await read()).tree).length === before, `add_nodes with the plan 2026-02-30 → 400 (${r.status})`);
  r = await v1('POST', `/maps/${mapId}/nodes`, { items: [{ title: 'Added fine', deadline: '2028-02-29' }], base_updated: (await read()).updated });
  expect(r.status === 200 && (await nodeOf('Added fine')).deadline === '2028-02-29', `add_nodes with a real day → 200 (${r.status})`);

  console.log('== MCP: update_node, add_nodes, create_map ==');
  let m = await mcp('update_node', { map_id: mapId, node_id: survey.id, deadline: '2026-13-45' });
  expect(m.isError && !(await nodeOf('Reception survey')).deadline, `update_node 2026-13-45 → error, nothing stored (${m.text.slice(0, 90)})`);
  m = await mcp('add_nodes', { map_id: mapId, items: [{ title: 'From MCP', deadline: '2027-02-31' }] });
  expect(m.isError && !(await nodeOf('From MCP')), `add_nodes 2027-02-31 → error, no step (${m.text.slice(0, 90)})`);
  m = await mcp('create_map', { title: 'MCP bad', outline: [{ title: 'Step', deadline: '2026-04-31' }] });
  expect(m.isError, `create_map 2026-04-31 → error (${m.text.slice(0, 90)})`);
  m = await mcp('update_node', { map_id: mapId, node_id: survey.id, deadline: '2027-06-30' });
  expect(!m.isError && (await nodeOf('Reception survey')).deadline === '2027-06-30', `update_node with a real day works (${m.text.slice(0, 60)})`);

  console.log('== the app: deadline-change request, rule set_deadline ==');
  r = await inst.api('POST', '/api/kb/deadline-requests', { token: T, body: { action: 'request', mapId, nodeId: survey.id, date: '2027-02-31', note: 'x' } });
  expect(r.status === 400 && /2027-02-31/.test((r.json || {}).error || ''), `deadline request for 2027-02-31 → 400 (${r.status}: ${(r.json || {}).error})`);
  const rule = (date) => ({ name: 'Due', trigger: { type: 'node_status_changed', status: 'done' }, actions: [{ type: 'set_deadline', date }] });
  r = await v1('POST', `/maps/${mapId}/rules`, rule('2026-13-45'));
  expect(r.status === 400 && /2026-13-45/.test((r.json || {}).error || ''), `rule with set_deadline 2026-13-45 → 400 naming the date (${r.status}: ${(r.json || {}).error})`);
  r = await v1('POST', `/maps/${mapId}/rules`, rule('2027-06-30'));
  expect(r.status === 200, `rule with a real day → 200 (${r.status}: ${(r.json || {}).error || ''})`);
}, { nazev: 'REAL-DAY-DATES' });
